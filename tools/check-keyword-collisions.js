#!/usr/bin/env node
"use strict";
/*
 * check-keyword-collisions.js
 * -----------------------------------------------------------------------------
 * Cong kiem BAT BIEN TU KHOA TIM KIEM cua bo test hieu nang EShop.
 *
 *   Khong tu khoa nao trong data/search_keywords.csv duoc la chuoi con
 *   (KHONG phan biet hoa thuong) cua bat ky ten san pham nao nhanh admin sinh
 *   ra tu data/newproduct.csv -- KE CA phan __threadNum va __counter.
 *
 * Vi sao can cong nay: SUT tim kiem bang
 *     SELECT * FROM products WHERE name LIKE '%<kw>%'
 * nen co HAI co che de mot tu khoa khop nham:
 *   (1) trong SQL LIKE, "_" la wildcard MOT KY TU va "%" la wildcard nhieu ky tu
 *   (2) LIKE cua SQLite KHONG phan biet hoa thuong voi ky tu ASCII (mac dinh)
 * Da tung dinh that: tien to don dep "LT_" khop "U-l-t-r-a" trong
 * "Samsung Galaxy S24 Ultra" -> tearDown xoa san pham seed id=2.
 * Va tu khoa "15" khop "LTPERF_Widget_15_7" o phan thread number.
 *
 * Truy van chi cham cot `name`. Cot description KHONG duoc tim kiem, nen noi
 * dung cot description cua newproduct.csv khong anh huong toi bat bien nay.
 *
 * CHAY:
 *   node tools/check-keyword-collisions.js
 *   node tools/check-keyword-collisions.js --max-threads 320 --max-counter 1000
 *   node tools/check-keyword-collisions.js --live          (doi chieu voi SUT dang chay)
 *
 * Exit: 0 = moi bat bien dat | 1 = co va cham / lech so lieu
 * -----------------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const KW_CSV = path.join(REPO, "data", "search_keywords.csv");
const NP_CSV = path.join(REPO, "data", "newproduct.csv");

const BASE_URL = process.env.ESHOP_URL || "http://localhost:3000";
const TEARDOWN_PREFIX = "LTPERF"; // phai khop sampler TEARDOWN_SEARCH_LTPERF trong .jmx

// 5 san pham seed do initDatabase() tao. Che do --live se doi chieu lai danh
// sach nay voi SUT dang chay, de no khong lang le lac hau.
const SEED_NAMES = [
  "iPhone 15 Pro Max",
  "Samsung Galaxy S24 Ultra",
  "MacBook Pro M3",
  "Tai nghe AirPods Pro 2",
  "Bàn phím cơ Keychron Q1",
];

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
};
const MAX_THREADS = parseInt(arg("--max-threads", "320"), 10);
const MAX_COUNTER = parseInt(arg("--max-counter", "1000"), 10);
const LIVE = process.argv.includes("--live");

let failures = 0;
const fail = (m) => {
  failures++;
  console.log("  [FAIL] " + m);
};
const pass = (m) => console.log("  [ ok ] " + m);

// ------------------------------------------------ Mo phong SQL LIKE ---------
// SUT dung:  WHERE name LIKE '%<kw>%'
// Phai mo phong DUNG ngu nghia do, khong duoc dung so khop chuoi con thuong:
//   "_"  = mot ky tu bat ky
//   "%"  = chuoi bat ky
//   khong phan biet hoa thuong, nhung CHI VOI ASCII (mac dinh cua SQLite)
// So khop chuoi con literal se BO SOT dung lop loi da tung xay ra:
// tien to "LT_" khong xuat hien literal trong "Samsung Galaxy S24 Ultra",
// nhung mau LIKE '%LT_%' thi CO khop (U-l-t-r-a).
const asciiLower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const hasWildcard = (kw) => kw.includes("_") || kw.includes("%");

// Dich mau LIKE sang regex. `anyOne` la lop ky tu dung cho "_".
// Khi quet tren haystack ghep bang '|', phai dung [^|] thay cho '.' de wildcard
// khong the khop qua bien giua hai ten.
function likeRegex(kw, anyOne) {
  const one = anyOne || ".";
  const many = anyOne ? anyOne + "*" : "[\\s\\S]*";
  const body = asciiLower(kw)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/_/g, one)
    .replace(/%/g, many);
  return new RegExp(body);
}

// Duong nhanh: tu khoa khong wildcard thi so khop chuoi con ASCII-lower la
// tuong duong ngu nghia LIKE va nhanh hon regex hai bac do lon.
function makeMatcher(kw, anyOne) {
  if (!hasWildcard(kw)) {
    const lo = asciiLower(kw);
    return (loweredText) => loweredText.includes(lo);
  }
  const rx = likeRegex(kw, anyOne);
  return (loweredText) => rx.test(loweredText);
}

const likeContains = (kw, text) => makeMatcher(kw)(asciiLower(text));

// ------------------------------------------------------------- Doc CSV ------
function readCsv(file) {
  if (!fs.existsSync(file)) {
    console.error("[FATAL] khong tim thay " + file);
    process.exit(1);
  }
  const lines = fs
    .readFileSync(file, "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const c = l.split(",");
    const o = {};
    head.forEach((h, i) => (o[h.trim()] = (c[i] === undefined ? "" : c[i]).trim()));
    return o;
  });
}

const keywords = readCsv(KW_CSV);
const newprods = readCsv(NP_CSV);
const bases = newprods.map((r) => r.base_name);

console.log("=".repeat(72));
console.log("KIEM BAT BIEN TU KHOA TIM KIEM");
console.log("  search_keywords.csv : " + keywords.length + " tu khoa");
console.log("  newproduct.csv      : " + bases.length + " base_name -> " + bases.join(", "));
console.log("  Pham vi enumerate   : __threadNum 1.." + MAX_THREADS +
            "  x  __counter 1.." + MAX_COUNTER);
console.log("=".repeat(72));

// ------------------------------------------ A. Wildcard trong tu khoa --------
console.log("\n[A] Tu khoa khong duoc chua wildcard cua SQL LIKE ( _ hoac % )");
for (const r of keywords) {
  const k = r.keyword;
  if (k.includes("_") || k.includes("%")) {
    fail(`'${k}' chua wildcard -> LIKE se khop rong hon y muon`);
  }
}
if (failures === 0) pass("khong tu khoa nao chua _ hoac %");

// ------------------------------------------ B. Tien to tearDown --------------
console.log("\n[B] Tien to tearDown '" + TEARDOWN_PREFIX + "'");
let bFail = failures;
if (TEARDOWN_PREFIX.includes("_") || TEARDOWN_PREFIX.includes("%")) {
  fail("tien to chua wildcard");
}
for (const s of SEED_NAMES) {
  if (likeContains(TEARDOWN_PREFIX, s)) {
    fail(`tien to khop san pham SEED "${s}" -> tearDown se XOA du lieu seed`);
  }
}
for (const b of bases) {
  if (!asciiLower(b).startsWith(asciiLower(TEARDOWN_PREFIX))) {
    fail(`base_name "${b}" khong bat dau bang tien to -> tearDown se BO SOT no`);
  }
}
if (failures === bFail) {
  pass("khong wildcard, khong khop seed, phu het " + bases.length + " base_name");
}

// ------------------------------------------ C. Va cham voi ten admin ---------
console.log("\n[C] Tu khoa vs ten san pham tam cua nhanh admin");
// Ghep tat ca ten cua mot base thanh mot haystack, ngan cach bang '|'.
// Khong tu khoa nao chua '|' nen khong the tao khop gia qua bien.
let cFail = failures;
const matchers = keywords.map((r) => ({ kw: r.keyword, m: makeMatcher(r.keyword, "[^|]") }));
for (const b of bases) {
  const parts = [];
  for (let t = 1; t <= MAX_THREADS; t++) {
    const pre = asciiLower(`${b}_${t}_`);
    for (let c = 1; c <= MAX_COUNTER; c++) {
      parts.push(pre + c, pre + c + "_v2");
    }
  }
  const hay = "|" + parts.join("|") + "|";
  for (const { kw, m } of matchers) {
    if (!m(hay)) continue;
    // Tim lai doan ten cu the de bao cao cho de doc
    const rx = new RegExp(likeRegex(kw, "[^|]").source);
    const hit = parts.find((n) => rx.test(n)) || "(khong xac dinh)";
    fail(`'${kw}' khop ten tam "${hit}" (base ${b})`);
  }
}
if (failures === cFail) {
  pass(`khong tu khoa nao khop ${bases.length * MAX_THREADS * MAX_COUNTER * 2} ten tam`);
}

// ------------------------------------------ D. expect_count offline ----------
console.log("\n[D] expect_count vs so lan khop trong 5 ten seed (case-insensitive)");
let dFail = failures;
const covered = new Set();
for (const r of keywords) {
  const hits = SEED_NAMES.filter((s) => likeContains(r.keyword, s));
  const want = parseInt(r.expect_count, 10);
  if (hits.length !== want) {
    fail(`'${r.keyword}' tinh duoc ${hits.length} nhung CSV ghi ${want}`);
  }
  hits.forEach((h) => covered.add(h));
}
if (failures === dFail) pass("toan bo expect_count khop voi tap seed");

const missing = SEED_NAMES.filter((s) => !covered.has(s));
if (missing.length) {
  fail("san pham seed khong duoc tu khoa nao phu: " + missing.join(" | "));
} else {
  pass("ca 5 san pham seed deu duoc it nhat mot tu khoa phu");
}

// ------------------------------------------ E. Doi chieu SUT (tuy chon) ------
async function liveCheck() {
  console.log("\n[E] --live : doi chieu voi SUT dang chay tai " + BASE_URL);
  let all;
  try {
    const res = await fetch(BASE_URL + "/api/products");
    all = await res.json();
  } catch (e) {
    fail("khong goi duoc " + BASE_URL + "/api/products : " + e.message);
    return;
  }
  if (!Array.isArray(all)) {
    fail("GET /api/products khong tra ve mang tran");
    return;
  }
  if (all.length !== 5) {
    fail(`bang products co ${all.length} dong thay vi 5 -- DB khong sach, restart server`);
  }
  const liveNames = all.map((p) => p.name);
  for (const s of SEED_NAMES) {
    if (!liveNames.includes(s)) {
      fail(`danh sach SEED_NAMES trong script da lac hau: khong thay "${s}" tren SUT`);
    }
  }
  for (const r of keywords) {
    let n = -1;
    try {
      const res = await fetch(
        BASE_URL + "/api/products?search=" + encodeURIComponent(r.keyword)
      );
      const arr = await res.json();
      n = Array.isArray(arr) ? arr.length : -1;
    } catch (e) {
      fail(`'${r.keyword}' loi goi API: ${e.message}`);
      continue;
    }
    const want = parseInt(r.expect_count, 10);
    if (n !== want) {
      fail(`'${r.keyword}' SUT tra ${n} nhung CSV ghi ${want}`);
    }
  }
  const res = await fetch(
    BASE_URL + "/api/products?search=" + encodeURIComponent(TEARDOWN_PREFIX)
  );
  const arr = await res.json();
  if (Array.isArray(arr) && arr.length !== 0) {
    fail(
      `search='${TEARDOWN_PREFIX}' tra ${arr.length} ket qua tren DB sach -- ` +
        `co san pham tam con sot lai, hoac tien to khop du lieu seed`
    );
  } else {
    pass(`search='${TEARDOWN_PREFIX}' tra 0 ket qua tren DB sach`);
  }
}

(async () => {
  if (LIVE) await liveCheck();
  console.log("\n" + "=".repeat(72));
  if (failures === 0) {
    console.log("KET QUA: PASS -- moi bat bien tu khoa deu dat.");
    process.exit(0);
  }
  console.log(`KET QUA: FAIL -- ${failures} vi pham. Xem chi tiet o tren.`);
  console.log("Sua data/search_keywords.csv hoac data/newproduct.csv roi chay lai.");
  process.exit(1);
})();
