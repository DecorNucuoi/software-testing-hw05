/**
 * reset_lockout.js — HW05 Performance Testing (MSSV 23127362)
 *
 * Mở khóa toàn bộ tài khoản bị lock do đăng nhập sai trong lúc chạy Stress/Spike test.
 *
 * QUAN TRỌNG: script này KHÔNG require('./database') vì file đó gọi initDatabase()
 * ngay khi được nạp, và initDatabase() DROP toàn bộ bảng. Ở đây ta mở thẳng file
 * SQLite để chỉ UPDATE, giữ nguyên các tài khoản test đã seed.
 *
 * Cách chạy (từ thư mục backend của SUT, nơi có node_modules):
 *   cd D:\HW05\eshop-sut\backend
 *   node D:\HW05\submission\tools\reset_lockout.js
 *   node D:\HW05\submission\tools\reset_lockout.js --check
 */

const path = require("path");
const fs = require("fs");

// Ưu tiên biến môi trường, sau đó tìm database.sqlite ở cwd (thư mục backend)
const DB_PATH =
  process.env.ESHOP_DB || path.resolve(process.cwd(), "database.sqlite");

if (!fs.existsSync(DB_PATH)) {
  console.error(`[LOI] Khong tim thay database tai: ${DB_PATH}`);
  console.error(`      Hay chay script nay tu thu muc backend cua SUT, hoac dat`);
  console.error(`      bien moi truong ESHOP_DB tro toi duong dan database.sqlite.`);
  process.exit(1);
}

// Node phan giai module theo thu muc chua FILE SCRIPT, khong phai theo cwd.
// Script nay nam ngoai thu muc backend nen phai chi ro noi tim node_modules.
let sqlite3;
try {
  const searchPaths = [
    path.dirname(DB_PATH), // thu muc backend cua SUT
    process.cwd(),
    __dirname,
  ];
  sqlite3 = require(require.resolve("sqlite3", { paths: searchPaths }));
} catch (e) {
  console.error("[LOI] Khong nap duoc module sqlite3.");
  console.error("      Da tim trong:", path.dirname(DB_PATH));
  console.error("      Hay chay `npm install` trong thu muc backend cua SUT truoc,");
  console.error("      va chay script tu thu muc do:");
  console.error("        cd D:\\HW05\\eshop-sut\\backend");
  console.error("        node D:\\HW05\\submission\\tools\\reset_lockout.js");
  process.exit(1);
}

const CHECK_ONLY = process.argv.includes("--check");
const db = new sqlite3.Database(DB_PATH);
const stamp = new Date().toISOString();

function showLocked(label, cb) {
  db.all(
    `SELECT id, email, login_attempts, locked_until
       FROM users
      WHERE login_attempts > 0 OR locked_until IS NOT NULL
      ORDER BY id`,
    (err, rows) => {
      if (err) {
        console.error("[LOI]", err.message);
        return cb(err);
      }
      if (!rows.length) {
        console.log(`${label}: khong co tai khoan nao bi khoa. OK`);
      } else {
        console.log(`${label}: ${rows.length} tai khoan co van de`);
        console.table(rows);
      }
      cb(null, rows);
    },
  );
}

console.log("========================================");
console.log(" RESET ACCOUNT LOCKOUT - EShop SUT");
console.log(" Thoi diem :", stamp);
console.log(" Database  :", DB_PATH);
console.log("========================================");

showLocked("TRUOC KHI RESET", (err) => {
  if (err) return db.close(() => process.exit(1));

  if (CHECK_ONLY) {
    console.log("\n(che do --check: chi kiem tra, khong thay doi du lieu)");
    return db.close();
  }

  db.run(
    `UPDATE users SET login_attempts = 0, locked_until = NULL
      WHERE login_attempts > 0 OR locked_until IS NOT NULL`,
    function (uErr) {
      if (uErr) {
        console.error("[LOI]", uErr.message);
        return db.close(() => process.exit(1));
      }
      console.log(`\n>> Da reset ${this.changes} tai khoan.\n`);
      showLocked("SAU KHI RESET", () => {
        console.log(
          "\nGhi lai dong nay vao report (muc B6.2) lam bang chung:\n" +
            `  [${stamp}] reset_lockout.js -> ${this.changes} row(s) updated`,
        );
        db.close();
      });
    },
  );
});
