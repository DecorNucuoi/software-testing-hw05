# HW05 — Performance Testing (Đề 2)

> **Lưu ý về đề bài:** Bài tập HW05 có **hai đề** để lựa chọn, sinh viên chỉ thực hiện một đề.
> Sinh viên chọn thực hiện **ĐỀ 2 — Performance Testing**. Toàn bộ nội dung repo và báo cáo dưới đây thuộc Đề 2.

| | |
|---|---|
| **Họ tên** | _(điền)_ |
| **MSSV** | **23127362** |
| **Môn** | Kiểm thử phần mềm |
| **Bài tập** | HW05 — Performance Testing (Đề 2) |
| **SUT** | EShop — https://github.com/ttbhanh/eshop-sut |
| **Công cụ** | Apache JMeter 5.6.3 (Java 1.8.0_501) |
| **Repo này** | https://github.com/DecorNucuoi/software-testing-hw05 |

---

## 1. Test Summary Report

### 1.1 Kịch bản đã chạy

| Kịch bản | File test plan | Report view sử dụng | Ngày chạy | Kết quả |
|---|---|---|---|---|
| Load | `testplans/23127362_Load_20260815.jmx` | Summary Report | | _(điền)_ |
| Stress | `testplans/23127362_Stress_20260815.jmx` | Aggregate Report | | _(điền)_ |
| Spike | `testplans/23127362_Spike_20260815.jmx` | View Results Tree | | _(điền)_ |
| Endurance / Soak | `testplans/23127362_Endurance_20260815.jmx` | Response Times Over Time | | _(điền)_ |

### 1.2 Nhóm endpoint đã phủ

| Nhóm endpoint | FR | API | Bước trong workflow E2E |
|---|---|---|---|
| **Auth-heavy** | FR-02 | `POST /api/login` | Bước 1 |
| **Read-heavy** | FR-05 | `GET /api/products?search=` | Bước 2 |
| **Read-heavy** | **FR-06** ⭐ | `GET /api/products/{id}` | Bước 3 |
| **Transactional** | FR-07 | `POST /api/cart` | Bước 4 |
| **Transactional** | **FR-09** ⭐ | `POST /api/apply-coupon` | Bước 5 |
| **Transactional** | FR-08 | `POST /api/checkout` | Bước 6 |
| **Transactional (write)** | **FR-15** ⭐ | `POST/PUT/DELETE /api/products` | Nhánh admin |

⭐ = ba FR được phân công từ bài tập trước.

### 1.3 Ngưỡng endurance (bằng số)

| Chỉ số | Giá trị đo được |
|---|---|
| RPS ổn định tối đa | _(điền)_ |
| p95 tại mức tải ổn định | _(điền)_ |
| Trần bộ nhớ tiến trình `node` (RSS) | _(điền)_ |
| Thời điểm bắt đầu suy giảm | _(điền)_ |
| Error rate tại ngưỡng | _(điền)_ |

### 1.4 Số lượng bug / performance issue

| Loại | Số lượng | Ghi chú |
|---|---|---|
| Bug chức năng | _(điền)_ | xem `docs/bug_report.md` |
| Performance issue | _(điền)_ | |
| Đã log lên GitHub Issues | _(điền)_ | |

### 1.5 Video demo

| Video | Link (unlisted) | Thời lượng |
|---|---|---|
| Demo 3 kịch bản (tool + resource monitor cùng khung hình, thuyết minh tiếng Việt) | _(điền)_ | ≥ 6 phút |
| Demo Agent Skill trên một nhóm endpoint hoàn chỉnh | _(điền)_ | |

---

## 2. Cấu hình máy chạy test

| Hạng mục | Giá trị |
|---|---|
| CPU | Intel Core i5-11400F — 6 nhân / 12 luồng, 2.60 GHz |
| RAM | 16 GB |
| OS | Windows 11 Pro 64-bit (build 26200) |
| Mainboard | Gigabyte B560M AORUS PRO (BIOS F9) |
| **Hostname** | **DESKTOP-6G4PPE1** |
| Node.js | v25.9.0 |
| Java | 1.8.0_501 |

Screenshot dxdiag: `evidence/hardware_dxdiag.png`

---

## 3. Cấu trúc repo

```
testplans/   4 test plan .jmx theo chuan {MSSV}_{ScenarioType}_{YYYYMMDD}
data/        cac file CSV cho workflow data-driven
results/     raw .jtl + HTML report folder cho tung kich ban
evidence/    screenshot JMeter + Task Manager + dxdiag
tools/       reset_lockout.js, monitor_node.ps1
docs/        report.md, AI_Audit_Report.md, AI_Critique.md, bug_report.md, git_commit_log.txt
```

---

## 4. Cách chạy lại

```powershell
# 1. Khoi dong SUT
cd D:\eshop-sut_1\eshop-sut\backend
node database.js
node server.js

# 2. Reset lockout truoc moi run
node <repo>\tools\reset_lockout.js

# 3. Giam sat tai nguyen (cua so rieng)
.\tools\monitor_node.ps1 -IntervalSeconds 5 -OutFile results\load\resource.csv

# 4. Chay test o che do non-GUI
jmeter -n -t testplans\23127362_Load_20260815.jmx `
       -l results\load\result.jtl `
       -e -o results\load\html-report
```

---

## 5. Bảng tự đánh giá

| No. | Criteria | Grade | Self-Assessed Grade |
|-----|----------|-------|---------------------|
| 1 | Task 1 — Load testing | 20 | |
| 2 | Task 1 — Stress testing | 20 | |
| 3 | Task 1 — Spike testing | 20 | |
| 4 | Task 2 — AI analysis + misinterpretation hunt (with correct values from raw logs) | 10 | |
| 5 | Task 3 — Continuous Performance Testing proposal (G9.6) | 10 | |
| 6 | Agent Skills | 10 | |
| | **Total** | **100** | |

---

## 6. Khai báo sử dụng AI

**I use AI tools for the following tasks,** — chi tiết đầy đủ (tên công cụ, ngày giờ, prompt, output) trong `docs/AI_Audit_Report.md`.
Phần phản biện AI: `docs/AI_Critique.md`.
