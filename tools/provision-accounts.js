#!/usr/bin/env node
"use strict";
/*
 * provision-accounts.js
 * -----------------------------------------------------------------------------
 * Tao N=300 tai khoan load-test qua POST /api/register, roi chay cong kiem tra
 * truc tiep tren file SQLite (READONLY).
 *
 * KHONG require("./database") -- file do goi initDatabase() ngay khi duoc nap va
 * DROP toan bo 6 bang. Script nay mo file .db o che do READ-ONLY nen khong the
 * lam thay doi trang thai du lieu trong bat ky truong hop nao.
 *
 * Chay NGAY SAU khi restart server, TRUOC moi lan do.
 *
 *   node tools/provision-accounts.js --dir ./backend
 *   node tools/provision-accounts.js --db  ./backend/eshop.db
 *
 * Bien moi truong tuy chon:
 *   ESHOP_URL     mac dinh http://localhost:3000
 *   LT_PASSWORD   mac dinh Loadtest123!   (phai khop UDV LT_PASSWORD trong .jmx)
 *   LT_OUT        thu muc ghi manifest, mac dinh cwd
 *
 * Exit codes: 0 OK | 1 tham so/module | 2 baseline sai | 3 register loi | 4 verify sai
 * -----------------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------- Cau hinh ---
const BASE_URL = process.env.ESHOP_URL || "http://localhost:3000";
const PASSWORD = process.env.LT_PASSWORD || "Loadtest123!";
const OUT_DIR = process.env.LT_OUT || process.cwd();

// Hai khoi ROI NHAU. Offset 1000 khien chong lan bat kha thi ve cau truc voi
// moi cau hinh duoi 1000 thread (tran thuc te cua JMeter voi -Xmx1g).
const BLOCKS = [
  { name: "MAIN", offset: 0, count: 220 }, // TG-1, dinh Stress = 210
  { name: "AUTH", offset: 1000, count: 80 }, // TG-2, dinh Stress =  75
];

const N = BLOCKS.reduce((s, b) => s + b.count, 0); // 300
const SEED_USERS = 2;
const EXPECTED_USERS = SEED_USERS + N; // 302

// Trang thai seed sau moi lan restart server. Kiem du ca 6 bang -- cong nay
// khong kiem "users co 2 dong khong" ma kiem "server co that su vua restart khong".
const SEED_BASELINE = {
  users: 2,
  products: 5,
  categories: 3,
  coupons: 4,
  orders: 0,
  coupon_usage: 0,
};

const TABLES = Object.keys(SEED_BASELINE);
const EXIT = { OK: 0, ARGS: 1, BASELINE: 2, REGISTER: 3, VERIFY: 4 };

// ------------------------------------------------------------- Tien ich -----
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const die = (code, msg) => {
  console.error("\n[FAIL] " + msg);
  process.exit(code);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------- Phan giai duong dan DB -
function resolveDbPath() {
  const explicit = arg("--db");
  if (explicit) {
    const p = path.resolve(explicit);
    if (!fs.existsSync(p)) die(EXIT.ARGS, "Khong tim thay file DB: " + p);
    return p;
  }
  const dir = path.resolve(arg("--dir") || path.join(process.cwd(), "backend"));
  if (!fs.existsSync(dir)) {
    die(
      EXIT.ARGS,
      "Khong tim thay thu muc: " + dir + "\n       Dung --dir hoac --db de chi ro."
    );
  }
  const hits = fs
    .readdirSync(dir)
    .filter((f) => /\.(db|sqlite|sqlite3|db3)$/i.test(f));
  if (hits.length === 0) {
    die(EXIT.ARGS, "Khong co file .db/.sqlite nao trong: " + dir);
  }
  if (hits.length > 1) {
    die(
      EXIT.ARGS,
      "Co " + hits.length + " file DB trong " + dir + ": " + hits.join(", ") +
        "\n       Dung --db de chi dich danh file can dung."
    );
  }
  return path.join(dir, hits[0]);
}

// ---------------------------------------------------------- Nap sqlite3 -----
// Node phan giai module theo thu muc chua FILE SCRIPT, KHONG theo cwd.
// Script nay nam o tools/ trong khi node_modules nam o backend/, nen require
// tran se that bai. Phai chi dinh ro danh sach thu muc tim kiem.
let sqlite3 = null;
let SQLITE3_PATH = null;

function loadSqlite3(dbPath) {
  const searchPaths = [
    path.dirname(dbPath), // canh file .db (thuong la backend/)
    path.join(path.dirname(dbPath), ".."), // cha cua no
    process.cwd(), // noi go lenh
    __dirname, // noi dat script (tools/)
    path.join(__dirname, ".."), // goc repo
  ].filter((p, i, a) => p && a.indexOf(p) === i);

  try {
    SQLITE3_PATH = require.resolve("sqlite3", { paths: searchPaths });
    return require(SQLITE3_PATH);
  } catch (e) {
    console.error("\n[FATAL] Khong nap duoc module 'sqlite3'.");
    console.error("        Da tim trong cac thu muc sau (va node_modules cua chung):");
    searchPaths.forEach((p) => {
      const nm = path.join(p, "node_modules", "sqlite3");
      console.error("          " + (fs.existsSync(nm) ? "[co]     " : "[khong]  ") + nm);
    });
    console.error("");
    console.error("        Cach xu ly:");
    console.error("          - chay lai voi --dir tro dung thu muc backend, hoac");
    console.error("          - npm install sqlite3 tai thu muc chua script nay");
    process.exit(EXIT.ARGS);
  }
}

// ------------------------------------------------------------- Truy van -----
function openReadonly(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) =>
      err ? reject(err) : resolve(db)
    );
  });
}

function get(db, sql) {
  return new Promise((resolve, reject) =>
    db.get(sql, [], (err, row) => (err ? reject(err) : resolve(row)))
  );
}

async function snapshot(db) {
  const out = {};
  for (const t of TABLES) {
    out[t] = (await get(db, `SELECT COUNT(*) AS c FROM ${t}`)).c;
  }
  out.users_distinct_email = (
    await get(db, "SELECT COUNT(DISTINCT email) AS c FROM users")
  ).c;
  return out;
}

function emailFor(block, i) {
  // i chay tu 1..count
  return "lt" + (block.offset + i) + "@eshop.com";
}

// ------------------------------------------------------------ Cong 1: base --
async function gateBaseline(db) {
  console.log("\n=== CONG 1: BASELINE (server co vua restart khong?) ===");
  const s = await snapshot(db);
  let ok = true;
  for (const t of TABLES) {
    const good = s[t] === SEED_BASELINE[t];
    if (!good) ok = false;
    console.log(
      "  " + (good ? "OK   " : "SAI  ") + t.padEnd(14) +
        " thuc te=" + String(s[t]).padStart(5) +
        "   mong doi=" + SEED_BASELINE[t]
    );
  }
  if (!ok) {
    die(
      EXIT.BASELINE,
      "DB khong o trang thai seed sach.\n" +
        "       Nguyen nhan thuong gap: server chua duoc restart, hoac provisioning\n" +
        "       da chay roi. Restart server (initDatabase() se DROP + seed lai) roi thu lai."
    );
  }
  console.log("  -> Baseline sach.");
}

// -------------------------------------------------------- Cong 2: register --
async function registerAll() {
  console.log("\n=== CONG 2: REGISTER " + N + " TAI KHOAN ===");
  console.log("  Target: " + BASE_URL + "/api/register");

  const manifest = [];
  let done = 0;

  for (const block of BLOCKS) {
    for (let i = 1; i <= block.count; i++) {
      const email = emailFor(block, i);
      let res, body;
      try {
        res = await fetch(BASE_URL + "/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "LoadTest " + block.name + " " + i,
            email: email,
            password: PASSWORD,
          }),
        });
        body = await res.text();
      } catch (e) {
        die(
          EXIT.REGISTER,
          "Khong ket noi duoc toi " + BASE_URL + " (" + e.message + ")\n" +
            "       Server da chay chua?"
        );
      }

      if (!res.ok) {
        die(
          EXIT.REGISTER,
          "register that bai o dong " + (done + 1) + " (" + email + ")\n" +
            "       HTTP " + res.status + " | " + body.slice(0, 300)
        );
      }

      let id = "";
      try {
        const j = JSON.parse(body);
        id = j.id == null ? "" : j.id;
      } catch (ignored) {}

      manifest.push({
        index: block.offset + i,
        block: block.name,
        email: email,
        password: PASSWORD,
        http_status: res.status,
        returned_id: id,
      });
      done++;

      // Kiem tra som: neu tai khoan DAU TIEN hong (rang buoc mat khau, thieu
      // field...) thi dung ngay thay vi bao 300 loi giong het nhau.
      if (done === 1) console.log("  Tai khoan dau tien OK -> " + body.trim());
      if (done % 50 === 0) console.log("  ... " + done + "/" + N);
    }
  }

  console.log("  -> Da gui " + done + " request register, tat ca HTTP 200.");
  return manifest;
}

// ---------------------------------------------------------- Cong 3: verify --
async function gateVerify(db) {
  console.log("\n=== CONG 3: VERIFY ===");

  // Backend co nhieu cho goi db.run KHONG kem callback, tuc lenh ghi chi duoc
  // day vao hang doi noi bo cua connection va HTTP response tra ve TRUOC khi
  // ghi xong. Vi vay phai POLL, khong duoc doc mot lan roi ket luan.
  const deadline = Date.now() + 20000;
  let s = null;
  for (;;) {
    s = await snapshot(db);
    if (s.users >= EXPECTED_USERS) break;
    if (Date.now() > deadline) break;
    await sleep(500);
  }

  console.log("  COUNT(*)              = " + s.users);
  console.log("  COUNT(DISTINCT email) = " + s.users_distinct_email);
  console.log("  Mong doi ca hai       = " + EXPECTED_USERS + "   (2 seed + " + N + ")");

  if (s.users !== s.users_distinct_email) {
    die(
      EXIT.VERIFY,
      "Co email TRUNG trong bang users (" +
        (s.users - s.users_distinct_email) + " dong thua).\n" +
        "       Cot email khong co rang buoc UNIQUE nen API khong bao loi gi.\n" +
        "       Gan nhu chac chan provisioning da chay hai lan ma khong restart server."
    );
  }
  if (s.users !== EXPECTED_USERS) {
    die(
      EXIT.VERIFY,
      "So tai khoan khong dung: " + s.users + " thay vi " + EXPECTED_USERS + "."
    );
  }
  if (s.products !== SEED_BASELINE.products) {
    die(
      EXIT.VERIFY,
      "Bang products co " + s.products + " dong thay vi 5.\n" +
        "       Nhanh admin LTPERF cua mot run truoc da khong DELETE het. Restart server."
    );
  }

  console.log("  -> Verify PASS.");
  return s;
}

// ------------------------------------------------------------------- Main ---
(async () => {
  const dbPath = resolveDbPath();
  sqlite3 = loadSqlite3(dbPath);

  console.log("=".repeat(70));
  console.log("PROVISION LOAD-TEST ACCOUNTS");
  console.log("  DB      : " + dbPath + "   (READONLY)");
  console.log("  sqlite3 : " + SQLITE3_PATH);
  console.log("  API     : " + BASE_URL);
  console.log(
    "  N       : " + N + "  =  " +
      BLOCKS.map(
        (b) => b.name + " lt" + (b.offset + 1) + "..lt" + (b.offset + b.count)
      ).join("   |   ")
  );
  console.log("=".repeat(70));

  const db = await openReadonly(dbPath);

  await gateBaseline(db);
  const manifest = await registerAll();
  const finalSnap = await gateVerify(db);

  // Manifest -- JMeter KHONG doc file nay. Credentials duoc suy ra bang cong
  // thuc lt{TG_OFFSET + __threadNum}@eshop.com ngay trong test plan.
  // File nay la bang chung kiem toan, luu kem metadata cua moi lan chay.
  const csvPath = path.join(OUT_DIR, "users_manifest.csv");
  fs.writeFileSync(
    csvPath,
    "index,block,email,password,http_status,returned_id\r\n" +
      manifest
        .map((r) =>
          [r.index, r.block, r.email, r.password, r.http_status, r.returned_id].join(",")
        )
        .join("\r\n") + "\r\n",
    "utf8"
  );

  const jsonPath = path.join(OUT_DIR, "provision-report.json");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        base_url: BASE_URL,
        db_path: dbPath,
        sqlite3_path: SQLITE3_PATH,
        N: N,
        expected_users: EXPECTED_USERS,
        blocks: BLOCKS,
        snapshot: finalSnap,
      },
      null,
      2
    ),
    "utf8"
  );

  db.close();

  console.log("\n" + "=".repeat(70));
  console.log("PROVISION OK");
  console.log("  " + csvPath);
  console.log("  " + jsonPath);
  console.log(
    "  Dan vao metadata cua run: N=" + N +
      " users=" + finalSnap.users +
      " distinct=" + finalSnap.users_distinct_email +
      " products=" + finalSnap.products
  );
  console.log("=".repeat(70));
  process.exit(EXIT.OK);
})().catch((e) => {
  console.error("\n[FATAL] " + (e && e.stack ? e.stack : e));
  process.exit(EXIT.VERIFY);
});
