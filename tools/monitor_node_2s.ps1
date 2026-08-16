<#
.SYNOPSIS
    Giam sat tien trinh node cho kich ban ENDURANCE, chu ky 2 giay.

.DESCRIPTION
    Bien the chu ky ngan cua monitor_node.ps1. Chu ky 2s (thay vi 30s) la bat buoc:
    voi run 15 phut, chu ky 30s chi cho 30 diem -- khong du de chay hoi quy va
    khong du de nhin thay hinh dang cua giai doan cool-down.

    Cot disk write lay tu Win32_Process.WriteTransferCount (byte tich luy) chu
    KHONG lay tu Get-Counter "\Process(node)\IO Write Bytes/sec". Ly do: ten
    performance counter cua Windows BI DICH theo ngon ngu he thong, nen ban tieng
    Viet se lam lenh do that bai am tham. WMI/CIM dung ten thuoc tinh co dinh.

    Script GIU TIEN TRINH NODE CHAY -- no chi doc, khong dung cham gi.
    Chay no trong mot cua so PowerShell RIENG, bat dau TRUOC khi chay JMeter va
    ket thuc SAU khi da quan sat xong 5 phut cool-down.

.PARAMETER ProcessId
    PID cua tien trinh node. Bo trong = tu do neu chi co dung mot tien trinh node.

.PARAMETER IntervalSeconds
    Chu ky lay mau, mac dinh 2 giay.

.PARAMETER OutFile
    File CSV dau ra. Mac dinh ..\results\resource_endurance.csv

.PARAMETER DurationSeconds
    Tu dung sau bao nhieu giay. 0 = chay den khi Ctrl+C.
    Cho Endurance nen dat 1300 (900s tai + 300s cool-down + 100s du).

.EXAMPLE
    .\monitor_node_2s.ps1 -DurationSeconds 1300 -OutFile ..\results\resource_endurance.csv
#>
[CmdletBinding()]
param(
    [int]    $ProcessId       = 0,
    [double] $IntervalSeconds = 2,
    [string] $OutFile         = "..\results\resource_endurance.csv",
    [int]    $DurationSeconds = 0
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------- Xac dinh PID ----
if ($ProcessId -eq 0) {
    $procs = @(Get-Process -Name node -ErrorAction SilentlyContinue)
    if ($procs.Count -eq 0) {
        Write-Host "[FATAL] Khong tim thay tien trinh node nao dang chay." -ForegroundColor Red
        Write-Host "        Khoi dong server truoc, roi chay lai script nay."
        exit 1
    }
    if ($procs.Count -gt 1) {
        Write-Host "[FATAL] Co $($procs.Count) tien trinh node. Phai chi ro -ProcessId:" -ForegroundColor Red
        $procs | Select-Object Id, StartTime, @{n='WS_MB';e={[math]::Round($_.WorkingSet64/1MB,1)}} |
            Format-Table -AutoSize | Out-String | Write-Host
        exit 1
    }
    $ProcessId = $procs[0].Id
}

$proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if (-not $proc) { Write-Host "[FATAL] Khong co tien trinh PID $ProcessId." -ForegroundColor Red; exit 1 }

$cores = [Environment]::ProcessorCount

# ------------------------------------------------------------- Chuan bi -----
$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$header = "timestamp_ms,iso_utc,elapsed_s,working_set_bytes,private_bytes,cpu_percent," +
          "io_write_bytes_per_sec,io_read_bytes_per_sec,handles,threads"
Set-Content -Path $OutFile -Value $header -Encoding ASCII

Write-Host ("=" * 72)
Write-Host "GIAM SAT TIEN TRINH NODE  --  chu ky $IntervalSeconds giay"
Write-Host "  PID       : $ProcessId"
Write-Host "  Bat dau   : $($proc.StartTime)"
Write-Host "  CPU cores : $cores (logical)"
Write-Host "  Ghi ra    : $OutFile"
if ($DurationSeconds -gt 0) { Write-Host "  Tu dung sau: $DurationSeconds giay" }
else { Write-Host "  Tu dung   : khong (Ctrl+C de dung)" }
Write-Host ("=" * 72)
Write-Host ""
Write-Host ("{0,9} {1,12} {2,8} {3,14} {4,10}" -f "elapsed", "RSS_MB", "CPU_%", "write_KB/s", "threads")

$t0Ms      = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$prevCpu   = $null
$prevWrite = $null
$prevRead  = $null
$prevMs    = $null
$n         = 0

try {
    while ($true) {
        $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $elapsed = ($nowMs - $t0Ms) / 1000.0

        if ($DurationSeconds -gt 0 -and $elapsed -ge $DurationSeconds) { break }

        $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if (-not $p) {
            Write-Host ""
            Write-Host "[CANH BAO] Tien trinh node PID $ProcessId da bien mat o t=$([math]::Round($elapsed,1))s." -ForegroundColor Yellow
            Write-Host "           Neu day la giua run thi bang chung leak da mat -- KHONG duoc restart giua chung."
            break
        }

        # IO tich luy tu CIM (ten thuoc tinh co dinh, khong bi dich ngon ngu)
        $wBytes = $null; $rBytes = $null
        try {
            $cim = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
            $wBytes = [double]$cim.WriteTransferCount
            $rBytes = [double]$cim.ReadTransferCount
        } catch { }

        $cpuNow = $p.TotalProcessorTime.TotalSeconds
        $cpuPct = ""; $wRate = ""; $rRate = ""
        if ($null -ne $prevMs) {
            $dt = ($nowMs - $prevMs) / 1000.0
            if ($dt -gt 0) {
                $cpuPct = [math]::Round((($cpuNow - $prevCpu) / $dt / $cores) * 100.0, 2)
                if ($null -ne $wBytes -and $null -ne $prevWrite) {
                    $wRate = [math]::Round(($wBytes - $prevWrite) / $dt, 0)
                }
                if ($null -ne $rBytes -and $null -ne $prevRead) {
                    $rRate = [math]::Round(($rBytes - $prevRead) / $dt, 0)
                }
            }
        }

        $iso = [DateTimeOffset]::FromUnixTimeMilliseconds($nowMs).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        $line = "{0},{1},{2},{3},{4},{5},{6},{7},{8},{9}" -f `
                $nowMs, $iso, [math]::Round($elapsed,2), $p.WorkingSet64, $p.PrivateMemorySize64,
                $cpuPct, $wRate, $rRate, $p.Handles, $p.Threads.Count
        Add-Content -Path $OutFile -Value $line -Encoding ASCII

        $n++
        if ($n % 5 -eq 0) {
            $wDisp = if ($wRate -eq "") { "-" } else { [math]::Round([double]$wRate/1KB, 1) }
            $cDisp = if ($cpuPct -eq "") { "-" } else { $cpuPct }
            Write-Host ("{0,9} {1,12} {2,8} {3,14} {4,10}" -f `
                ([math]::Round($elapsed,0).ToString() + "s"),
                [math]::Round($p.WorkingSet64/1MB, 2), $cDisp, $wDisp, $p.Threads.Count)
        }

        $prevCpu = $cpuNow; $prevWrite = $wBytes; $prevRead = $rBytes; $prevMs = $nowMs

        # Ngu bu tru do troi, de chu ky bam sat 2s that su
        $sleepMs = ($IntervalSeconds * 1000) - ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $nowMs)
        if ($sleepMs -gt 0) { Start-Sleep -Milliseconds $sleepMs }
    }
}
finally {
    Write-Host ""
    Write-Host ("=" * 72)
    Write-Host "Da ghi $n mau vao $OutFile"
    Write-Host "Buoc tiep theo: .\analyze-leak.ps1"
    Write-Host ("=" * 72)
}
