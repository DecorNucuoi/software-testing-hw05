<#
    monitor_node.ps1 - HW05 Performance Testing (MSSV 23127362)

    Lay mau CPU / RAM cua tien trinh backend (node.exe) theo chu ky va ghi ra CSV,
    de co bang chung DANG SO cho muc B8.2 (ngưỡng endurance phai bao cao bang con so).

    Cach chay:
        cd D:\HW05\submission\tools
        .\monitor_node.ps1 -IntervalSeconds 5 -OutFile ..\results\endurance\resource_endurance.csv

    Neu bi chan policy:
        Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

    Dung lai: Ctrl+C (file CSV van giu nguyen du lieu da ghi).
#>

param(
    [int]    $IntervalSeconds = 5,
    [string] $OutFile         = ".\resource_usage.csv",
    [int]    $DurationMinutes = 0,          # 0 = chay den khi Ctrl+C
    [string] $ProcessName     = "node"
)

$ErrorActionPreference = "Stop"

# Tao thu muc chua file output neu chua co
$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$cpuCount = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
Write-Host "=========================================="
Write-Host " MONITOR TIEN TRINH: $ProcessName"
Write-Host " Chu ky lay mau  : $IntervalSeconds giay"
Write-Host " Logical CPUs    : $cpuCount"
Write-Host " Ghi ra file     : $OutFile"
Write-Host " Nhan Ctrl+C de dung"
Write-Host "=========================================="

"timestamp,elapsed_sec,pid,cpu_percent,working_set_mb,private_mb,threads,handles" |
    Out-File -FilePath $OutFile -Encoding utf8

$start   = Get-Date
$prevCpu = @{}
$prevTs  = @{}

while ($true) {

    if ($DurationMinutes -gt 0 -and ((Get-Date) - $start).TotalMinutes -ge $DurationMinutes) {
        Write-Host "`nDa du $DurationMinutes phut. Dung lai."
        break
    }

    $now  = Get-Date
    $procs = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)

    if ($procs.Count -eq 0) {
        Write-Host ("[{0:HH:mm:ss}] Khong thay tien trinh '{1}' dang chay." -f $now, $ProcessName) -ForegroundColor Yellow
    }

    foreach ($p in $procs) {

        # CPU% = delta thoi gian CPU / delta thoi gian thuc / so logical CPU
        $cpuPercent = 0.0
        if ($prevCpu.ContainsKey($p.Id)) {
            $deltaCpu  = $p.TotalProcessorTime.TotalSeconds - $prevCpu[$p.Id]
            $deltaWall = ($now - $prevTs[$p.Id]).TotalSeconds
            if ($deltaWall -gt 0) {
                $cpuPercent = [math]::Round(($deltaCpu / $deltaWall / $cpuCount) * 100, 2)
            }
        }
        $prevCpu[$p.Id] = $p.TotalProcessorTime.TotalSeconds
        $prevTs[$p.Id]  = $now

        $wsMb   = [math]::Round($p.WorkingSet64  / 1MB, 2)
        $privMb = [math]::Round($p.PrivateMemorySize64 / 1MB, 2)
        $elapsed = [math]::Round(($now - $start).TotalSeconds, 0)

        "{0},{1},{2},{3},{4},{5},{6},{7}" -f `
            $now.ToString("yyyy-MM-dd HH:mm:ss"), $elapsed, $p.Id,
            $cpuPercent, $wsMb, $privMb, $p.Threads.Count, $p.HandleCount |
            Out-File -FilePath $OutFile -Append -Encoding utf8

        Write-Host ("[{0:HH:mm:ss}] pid={1}  cpu={2,6}%  ws={3,8} MB  private={4,8} MB  threads={5}" -f `
            $now, $p.Id, $cpuPercent, $wsMb, $privMb, $p.Threads.Count)
    }

    Start-Sleep -Seconds $IntervalSeconds
}
