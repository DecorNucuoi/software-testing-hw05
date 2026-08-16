<#
.SYNOPSIS
    Phan tich bang chung ro ri bo nho userCarts tu mot run ENDURANCE duy nhat.

.DESCRIPTION
    Ghep endurance_r1.jtl voi resource_endurance.csv theo timestamp, roi dua ra
    HAI nguon bang chung doc lap:

      (1) HOI QUY LIEU-DAP UNG
          RSS theo SO POST /api/cart TICH LUY (khong phai theo thoi gian).
          Leak userCarts la ham cua SO LAN PUSH; mot duong thang di len theo thoi
          gian co the do bat cu thu gi, nhung mot quan he tuyen tinh chat che voi
          so lan push thi chi ro CO CHE. Bao cao he so goc (bytes/push) kem R2.

      (2) COOL-DOWN
          Sau khi JMeter ket thuc, tai = 0 nhung server van chay. Hai co che tang
          RAM tach nhau ra o day:
            - hang doi ghi cua SQLite  -> RUT CAN  -> RSS TUT
            - userCarts (chi push, khong bao gio xoa) -> RSS DUNG YEN o muc cao

    Vi chi co MOT run (mot muc lieu), quan he lieu-dap ung chi duoc chung minh
    TRONG MOT MUC LIEU. Xem phan Limitations o cuoi ket qua.

.PARAMETER Jtl
    File .jtl cua run endurance. Mac dinh ..\results\endurance_r1.jtl

.PARAMETER Resource
    File CSV do monitor_node_2s.ps1 sinh ra. Mac dinh ..\results\resource_endurance.csv

.PARAMETER CartLabel
    Nhan cua sampler cart trong .jtl. Mac dinh CART.

.PARAMETER SkipSeconds
    Bo bao nhieu giay dau (ramp-up + on dinh JIT/page cache) khoi hoi quy.
    Mac dinh 120 (60s ramp + 60s on dinh).

.PARAMETER HeapLimitMB
    Tran heap cua Node, dung de ngoai suy time_to_ceiling.
    Kiem gia tri that bang:
        node -e "console.log(require('v8').getHeapStatistics().heap_size_limit/1048576)"

.EXAMPLE
    .\analyze-leak.ps1
    .\analyze-leak.ps1 -HeapLimitMB 4144 -SkipSeconds 150
#>
[CmdletBinding()]
param(
    [string] $Jtl         = "..\results\endurance_r1.jtl",
    [string] $Resource    = "..\results\resource_endurance.csv",
    [string] $CartLabel   = "CART",
    [int]    $SkipSeconds = 120,
    [double] $HeapLimitMB = 4096
)

$ErrorActionPreference = "Stop"

function Die($msg) { Write-Host ""; Write-Host "[FATAL] $msg" -ForegroundColor Red; exit 1 }
function Hr { Write-Host ("=" * 78) }

foreach ($f in @($Jtl, $Resource)) {
    if (-not (Test-Path $f)) { Die "Khong tim thay $f" }
}

Hr
Write-Host "PHAN TICH RO RI BO NHO  --  ENDURANCE"
Write-Host "  .jtl      : $Jtl"
Write-Host "  resource  : $Resource"
Hr

# ------------------------------------------------------------- Doc du lieu --
$samples = @(Import-Csv -Path $Jtl)
if ($samples.Count -eq 0) { Die "$Jtl khong co dong nao." }
if (-not ($samples[0].PSObject.Properties.Name -contains "timeStamp")) {
    Die "$Jtl khong co cot timeStamp. Kiem jmeter.save.saveservice.print_field_names=true"
}

$res = @(Import-Csv -Path $Resource)
if ($res.Count -lt 5) { Die "$Resource chi co $($res.Count) mau -- qua it de hoi quy." }

# Bo moi nhan phu tro khoi thong ke chung
$measured = @($samples | Where-Object { $_.label -notlike "OBS_*" -and $_.label -notlike "TEARDOWN_*" })
$cart     = @($measured | Where-Object { $_.label -eq $CartLabel } |
              ForEach-Object { [long]$_.timeStamp } | Sort-Object)

if ($cart.Count -eq 0) { Die "Khong co sample nao mang nhan '$CartLabel' trong $Jtl" }

$allTs   = @($measured | ForEach-Object { [long]$_.timeStamp } | Sort-Object)
$tStart  = $allTs[0]
$tLoadEnd= $allTs[-1]
$loadSec = ($tLoadEnd - $tStart) / 1000.0

Write-Host ""
Write-Host "GIAI DOAN TAI"
Write-Host ("  Sample do luong        : {0:N0}" -f $measured.Count)
Write-Host ("  POST /api/cart         : {0:N0}" -f $cart.Count)
Write-Host ("  Thoi luong             : {0:N1} s" -f $loadSec)
Write-Host ("  Throughput trung binh  : {0:N2} req/s" -f ($measured.Count / $loadSec))

# ---------------------------------------------------- Ghep RSS voi so push --
$rows = @()
$idx  = 0
foreach ($r in ($res | Sort-Object { [long]$_.timestamp_ms })) {
    $t = [long]$r.timestamp_ms
    while ($idx -lt $cart.Count -and $cart[$idx] -le $t) { $idx++ }
    $rows += [pscustomobject]@{
        Ts     = $t
        Sec    = ($t - $tStart) / 1000.0
        Rss    = [double]$r.working_set_bytes
        Pushes = $idx
        Phase  = if ($t -le $tLoadEnd) { "load" } else { "cooldown" }
    }
}

$baseRss = ($rows | Where-Object { $_.Sec -ge 0 } | Select-Object -First 1).Rss
if (-not $baseRss) { $baseRss = $rows[0].Rss }

# --------------------------------------------------------------- Hoi quy ----
$fit = @($rows | Where-Object { $_.Phase -eq "load" -and $_.Sec -ge $SkipSeconds })
if ($fit.Count -lt 5) {
    Die "Chi con $($fit.Count) diem sau khi bo $SkipSeconds giay dau. Giam -SkipSeconds."
}

$n = $fit.Count
$sx = 0.0; $sy = 0.0; $sxy = 0.0; $sxx = 0.0; $syy = 0.0
foreach ($p in $fit) {
    $x = [double]$p.Pushes; $y = $p.Rss
    $sx += $x; $sy += $y; $sxy += $x*$y; $sxx += $x*$x; $syy += $y*$y
}
$den = ($n*$sxx - $sx*$sx)
if ($den -eq 0) { Die "So push khong doi trong cua so hoi quy -- khong the hoi quy." }

$slope     = ($n*$sxy - $sx*$sy) / $den
$intercept = ($sy - $slope*$sx) / $n
$r2den     = $den * ($n*$syy - $sy*$sy)
$r2        = if ($r2den -gt 0) { [math]::Pow(($n*$sxy - $sx*$sy), 2) / $r2den } else { 0 }

$rssLoadEnd = ($rows | Where-Object { $_.Phase -eq "load" } | Select-Object -Last 1).Rss
$pushRate   = ($fit[-1].Pushes - $fit[0].Pushes) / ($fit[-1].Sec - $fit[0].Sec)

Write-Host ""
Hr
Write-Host "(1) HOI QUY LIEU-DAP UNG   RSS ~ so POST /api/cart tich luy"
Hr
Write-Host ("  Cua so hoi quy       : t = {0:N0}s .. {1:N0}s  ({2} diem)" -f $fit[0].Sec, $fit[-1].Sec, $n)
Write-Host ("  Khoang so push       : {0:N0} .. {1:N0}" -f $fit[0].Pushes, $fit[-1].Pushes)
Write-Host ""
Write-Host ("  HE SO GOC            : {0:N1} byte / push" -f $slope) -ForegroundColor Cyan
Write-Host ("  R2                   : {0:N4}" -f $r2) -ForegroundColor Cyan
Write-Host ("  Chan (RSS khi 0 push): {0:N2} MB" -f ($intercept/1MB))
Write-Host ""
Write-Host ("  RSS baseline         : {0:N2} MB" -f ($baseRss/1MB))
Write-Host ("  RSS cuoi giai doan tai: {0:N2} MB" -f ($rssLoadEnd/1MB))
Write-Host ("  Muc tang             : {0:N2} MB" -f (($rssLoadEnd - $baseRss)/1MB))
Write-Host ("  Toc do push          : {0:N2} push/s" -f $pushRate)

Write-Host ""
if ($r2 -ge 0.90) {
    Write-Host "  => R2 >= 0.90: quan he tuyen tinh CHAT CHE. Day la bang chung co che," -ForegroundColor Green
    Write-Host "     khong phai tuong quan ngau nhien. Bao cao he so goc lam ket qua chinh." -ForegroundColor Green
} elseif ($r2 -ge 0.70) {
    Write-Host "  => R2 trong khoang 0.70-0.90: co xu huong nhung con nhieu. Bao cao kem" -ForegroundColor Yellow
    Write-Host "     canh bao, khong khang dinh manh." -ForegroundColor Yellow
} else {
    Write-Host "  => R2 < 0.70: KHONG do duoc trong 15 phut. Ket luan trung thuc la" -ForegroundColor Yellow
    Write-Host "     'khong quan sat duoc quan he lieu-dap ung o quy mo nay', KHONG duoc" -ForegroundColor Yellow
    Write-Host "     suy dien tu mot duong di len mo ho." -ForegroundColor Yellow
}

# -------------------------------------------------------------- Cool-down ---
$cool = @($rows | Where-Object { $_.Phase -eq "cooldown" })
Write-Host ""
Hr
Write-Host "(2) COOL-DOWN   tai = 0, server van chay"
Hr
if ($cool.Count -lt 3) {
    Write-Host "  Khong co du lieu cool-down (chi $($cool.Count) mau sau khi tai ket thuc)." -ForegroundColor Yellow
    Write-Host "  Phai de monitor_node_2s.ps1 chay them 5 phut SAU khi JMeter ket thuc."
    Write-Host "  Thieu buoc nay thi khong tach duoc hai co che tang RAM."
} else {
    $rssCoolEnd = $cool[-1].Rss
    $drop    = $rssLoadEnd - $rssCoolEnd
    $growth  = $rssLoadEnd - $baseRss
    $recPct  = if ($growth -gt 0) { $drop / $growth * 100.0 } else { 0 }
    Write-Host ("  Thoi luong cool-down : {0:N0} s ({1} mau)" -f ($cool[-1].Sec - $cool[0].Sec), $cool.Count)
    Write-Host ("  RSS cuoi giai doan tai: {0:N2} MB" -f ($rssLoadEnd/1MB))
    Write-Host ("  RSS cuoi cool-down   : {0:N2} MB" -f ($rssCoolEnd/1MB))
    Write-Host ("  Tut xuong            : {0:N2} MB  ({1:N1}% cua muc da tang)" -f ($drop/1MB), $recPct)
    Write-Host ""
    if ($recPct -lt 20) {
        Write-Host "  => HOI PHUC < 20%: RSS dung yen o muc cao du tai bang 0." -ForegroundColor Green
        Write-Host "     Hang doi ghi da rut can tu lau, nen phan con lai KHONG phai hang doi." -ForegroundColor Green
        Write-Host "     Phu hop voi userCarts khong bao gio duoc giai phong." -ForegroundColor Green
    } elseif ($recPct -lt 60) {
        Write-Host "  => HOI PHUC 20-60%: hon hop. Mot phan la hang doi/GC, mot phan giu lai." -ForegroundColor Yellow
    } else {
        Write-Host "  => HOI PHUC > 60%: RSS tro ve gan baseline. Phan lon muc tang la" -ForegroundColor Yellow
        Write-Host "     hang doi ghi va ap luc GC tam thoi, KHONG phai leak." -ForegroundColor Yellow
    }
}

# ------------------------------------------------------- Ngoai suy tran -----
Write-Host ""
Hr
Write-Host "(3) NGOAI SUY TRAN BO NHO"
Hr
$limit = $HeapLimitMB * 1MB
if ($slope -le 0) {
    Write-Host "  He so goc <= 0 -> khong ngoai suy duoc." -ForegroundColor Yellow
} elseif ($rssLoadEnd -ge $limit) {
    Write-Host "  RSS da vuot tran gia dinh -- kiem lai -HeapLimitMB." -ForegroundColor Yellow
} else {
    $sec = ($limit - $rssLoadEnd) / ($slope * $pushRate)
    Write-Host ("  Cong thuc: (tran - RSS_cuoi) / (bytes_per_push x push_rate)")
    Write-Host ("           = ({0:N0} - {1:N0}) / ({2:N1} x {3:N2})" -f $limit, $rssLoadEnd, $slope, $pushRate)
    Write-Host ""
    Write-Host ("  Tran gia dinh        : {0:N0} MB" -f $HeapLimitMB)
    Write-Host ("  TIME TO CEILING      : {0:N0} s  =  {1:N1} gio  =  {2:N1} ngay" -f $sec, ($sec/3600), ($sec/86400)) -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Kiem tran that bang:"
    Write-Host "    node -e `"console.log(require('v8').getHeapStatistics().heap_size_limit/1048576)`""
}

# ------------------------------------------------------------ Bieu do ASCII -
Write-Host ""
Hr
Write-Host "RSS THEO THOI GIAN   ( | = moc ket thuc tai )"
Hr
$W = 68; $H = 14
$minR = ($rows | Measure-Object Rss -Minimum).Minimum
$maxR = ($rows | Measure-Object Rss -Maximum).Maximum
$span = [math]::Max($maxR - $minR, 1)
$tMin = $rows[0].Sec; $tMax = $rows[-1].Sec
$grid = New-Object 'char[,]' $H, $W
for ($y=0; $y -lt $H; $y++) { for ($x=0; $x -lt $W; $x++) { $grid[$y,$x] = ' ' } }
$loadCol = -1
foreach ($p in $rows) {
    $x = [int][math]::Round(($p.Sec - $tMin) / [math]::Max($tMax-$tMin,1) * ($W-1))
    $y = ($H-1) - [int][math]::Round(($p.Rss - $minR) / $span * ($H-1))
    if ($x -ge 0 -and $x -lt $W -and $y -ge 0 -and $y -lt $H) {
        $grid[$y,$x] = if ($p.Phase -eq "cooldown") { 'o' } else { '#' }
    }
    if ($p.Phase -eq "load") { $loadCol = $x }
}
for ($y=0; $y -lt $H; $y++) {
    $lbl = $minR + ($span * ($H-1-$y) / ($H-1))
    $line = ""
    for ($x=0; $x -lt $W; $x++) {
        if ($x -eq $loadCol -and $grid[$y,$x] -eq ' ') { $line += "|" } else { $line += $grid[$y,$x] }
    }
    Write-Host ("{0,8:N1} MB |{1}" -f ($lbl/1MB), $line)
}
Write-Host ("{0,11} +{1}" -f "", ("-" * $W))
Write-Host ("{0,12}{1,-34}{2,34}" -f "", ("t=" + [int][math]::Round($tMin) + "s"), ("t=" + [int][math]::Round($tMax) + "s"))
Write-Host "            # = giai doan tai      o = cool-down (tai = 0)"

# ------------------------------------------------------------ Limitations ---
Write-Host ""
Hr
Write-Host "LIMITATIONS  --  chep thang vao bao cao"
Hr
Write-Host @"
  1. CHI MOT MUC LIEU. Ke hoach ban dau co hai run (3 va 15 push moi iteration) de
     chung minh nhan qua bang cach doi chieu HAI he so goc: neu bytes/push cua hai
     run xap xi bang nhau trong khi toc do tang theo thoi gian khac han, do la bang
     chung nhan qua manh. Quy thoi gian chi cho phep mot run lieu cao, nen quan he
     lieu-dap ung o day chi duoc chung minh TRONG MOT MUC LIEU. Han che nay khong
     bac bo ket qua nhung lam yeu no: mot yeu to dong bien voi so push (vi du chinh
     thoi gian troi qua) chua bi loai tru bang thuc nghiem. Buoc cool-down bu lai
     mot phan, vi thoi gian van troi trong cool-down ma RSS thi khong tang nua.

  2. DO LON TIN HIEU NHO. Voi ~18.600 push va 120-250 byte moi push, muc tang ky
     vong chi khoang 2-4.5 MB -- co the nam trong nhieu dao dong cua GC va working
     set cua Windows. Vi vay ket luan phai dua vao R2 cua hoi quy chu KHONG dua vao
     do lon tuyet doi. R2 thap = "khong do duoc o quy mo nay", khong phai "khong co
     leak", va cung khong phai "co leak".

  3. NGOAI SUY, KHONG PHAI QUAN SAT. time_to_ceiling la phep ngoai suy tuyen tinh
     tu 15 phut. No khong tinh den phan manh bo nho, hanh vi old-space cua V8, hay
     cac hieu ung chi xuat hien sau nhieu gio. Doc no nhu bac do lon, khong phai
     nhu mot du bao.

  4. MOT LUOT CHAY. Khong co uoc luong phuong sai nen khong co khoang tin cay.
"@
Hr
