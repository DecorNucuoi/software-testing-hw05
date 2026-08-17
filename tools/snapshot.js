#!/usr/bin/env node
"use strict";
/*
 * snapshot.js — HW05 Performance Testing (MSSV 23127362)
 * -----------------------------------------------------------------------------
 * Chup trang thai database SAU MOI RUN. Mo file SQLite o che do READ-ONLY nen
 * khong the lam thay doi du lieu dang do.
 *
 * KHONG require("./database") — file do goi initDatabase() ngay khi duoc nap
 * va DROP toan bo 6 bang.
 *
 * Cach chay:
 *   node D:\HW05\software-testing-hw05\tools\snapshot.js
 *   node ...\snapshot.js --db D:\eshop-sut_1\eshop-sut\backend\database.sqlite
 *   node ...\snapshot.js --label load        (ghi nhan vao dong ket qua)
 *
 * Exit code: 0 = moi thu dung ky vong | 1 = co canh bao
 * -----------------------------------------------------------------------------
 */
const fs = require("fs");
const path = require("path");

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const LABEL = arg("--label") || "";

// ---- Tim file database ------------------------------------------------------
function resolveDbPath() {
  const explicit = arg("--db");
  if (explicit) return path.resolve(explicit);

  const candidates = [
    path.join(process.cwd(), "database.sqlite"),
    path.join(process.cwd(), "backend", "database.sqlite"),
    "D:\\eshop-sut_1\\eshop-sut\\backend\\database.sqlite",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;

  console.error("[LOI] Khong tim thay database.sqlite.");
  console.error("      Da tim trong:");
  candidates.forEach((c) => console.error("        " + c));
  console.error("      Dung --db de chi ro duong dan.");
  process.exit(1);
}

const DB_PATH = resolveDbPath();

// ---- Nap sqlite3 theo dung thu muc chua node_modules -------------------------
// Node phan giai module theo thu muc chua FILE SCRIPT, khong theo cwd.
let sqlite3;
try {
  const searchPaths = [
    path.dirname(DB_PATH),
    path.join(path.dirname(DB_PATH), ".."),
    process.cwd(),
    __dirname,
  ].filter((p, i, a) => p && a.indexOf(p) === i);
  sqlite3 = require(require.resolve("sqlite3", { paths: searchPaths }));
} catch (e) {
  console.error("[LOI] Khong nap duoc module 'sqlite3'.");
  console.error("      Chay script tu thu muc backend cua SUT, hoac:");
  console.error("        npm install sqlite3");
  process.exit(1);
}

// ---- Gia tri ky vong sau mot run hop le --------------------------------------
const EXPECT = {
  users: 302, // 2 seed + 300 provisioning
  products: 5, // nhanh admin phai don sach
  categories: 3,
  coupons: 4,
  coupon_usage: 0, // test plan CO Y khong goi /api/coupon-usage
};

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
const get = (sql) =>
  new Promise((res, rej) => db.get(sql, [], (e, r) => (e ? rej(e) : res(r))));
const all = (sql) =>
  new Promise((res, rej) => db.all(sql, [], (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const stamp = new Date().toISOString();
  console.log("=".repeat(66));
  console.log("SNAPSHOT DATABASE" + (LABEL ? "  [" + LABEL + "]" : ""));
  console.log("  Thoi diem : " + stamp);
  console.log("  Database  : " + DB_PATH + "  (READONLY)");
  console.log("=".repeat(66));

  let warn = 0;
  const tables = [
    "users",
    "products",
    "categories",
    "coupons",
    "orders",
    "coupon_usage",
  ];

  for (const t of tables) {
    let n;
    try {
      n = (await get("SELECT COUNT(*) AS c FROM " + t)).c;
    } catch (e) {
      console.log("  " + t.padEnd(14) + " LOI: " + e.message);
      warn++;
      continue;
    }

    if (t === "orders") {
      // orders khong co gia tri ky vong co dinh, chi can > 0
      const ok = n > 0;
      if (!ok) warn++;
      console.log(
        "  " + (ok ? "OK  " : "CANH BAO ") + t.padEnd(14) +
          String(n).padStart(6) + "   (ky vong > 0)",
      );
    } else {
      const want = EXPECT[t];
      const ok = n === want;
      if (!ok) warn++;
      console.log(
        "  " + (ok ? "OK  " : "SAI ") + t.padEnd(14) +
          String(n).padStart(6) + "   (ky vong " + want + ")",
      );
    }
  }

  // ---- Tai khoan bi khoa ----
  const locked = await all(
    "SELECT email, login_attempts, locked_until FROM users " +
      "WHERE login_attempts != 0 OR locked_until IS NOT NULL",
  );
  if (locked.length === 0) {
    console.log("  OK   tai khoan bi khoa      0   (ky vong 0)");
  } else {
    warn++;
    console.log("  SAI  tai khoan bi khoa " + String(locked.length).padStart(6));
    console.table(locked.slice(0, 10));
  }

  // ---- San pham sot lai cua nhanh admin ----
  const leftover = await all(
    "SELECT id, name FROM products WHERE id > 5 OR name LIKE '%LTPERF%'",
  );
  if (leftover.length > 0) {
    warn++;
    console.log("\n  SAN PHAM SOT LAI (nhanh admin chua don sach):");
    leftover.forEach((p) => console.log("    id=" + p.id + "  " + p.name));
  }

  // ---- Vai con so bo sung cho bao cao ----
  const rev = await get(
    "SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS s FROM orders",
  );
  console.log("\n  Don hang tao ra trong run : " + rev.n);
  console.log("  Tong total_amount         : " + rev.s.toLocaleString("vi-VN"));

  const bug = await get(
    "SELECT COUNT(*) AS c FROM orders WHERE total_amount > 1000000",
  );
  console.log(
    "  Don > 1.000.000 (BUG-03) : " + bug.c +
      "   <- he qua loi cong thuc coupon percent",
  );

  console.log("=".repeat(66));
  if (warn === 0) {
    console.log("KET QUA: HOP LE — run nay dung de bao cao duoc.");
  } else {
    console.log(
      "KET QUA: CO " + warn + " CANH BAO — xem lai truoc khi dua vao bao cao.",
    );
  }
  console.log("Dan dong nay vao metadata cua run:");
  console.log("  [" + stamp + "] " + (LABEL || "run") + " snapshot: warn=" + warn);
  console.log("=".repeat(66));

  db.close();
  process.exit(warn === 0 ? 0 : 1);
})().catch((e) => {
  console.error("\n[FATAL] " + (e && e.stack ? e.stack : e));
  db.close();
  process.exit(1);
});
