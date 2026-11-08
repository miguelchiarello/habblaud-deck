# Starts Habblaud (http://localhost:4747) in its own window, then the deck daemon here (simulator on :4748).
# Close the Rise Mode / Mirabox app first (also from the tray): it holds the USB device.
#   -Sim    simulator only, no hardware
param([switch]$Sim)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$hab = Join-Path (Split-Path -Parent $here) 'habblaud'

$up = $false
try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:4747/api/snapshot | Out-Null; $up = $true } catch {}
if (-not $up) {
  Write-Host 'Starting Habblaud in a new window…' -ForegroundColor Cyan
  Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$hab'; npm start" -WorkingDirectory $hab
}
Get-Process | Where-Object { $_.ProcessName -match 'StreamDock|Mirabox|RiseMode|Rise Mode' } | ForEach-Object {
  Write-Host "Heads up: '$($_.ProcessName)' is running and may hold the deck. Close it (tray icon > Exit)." -ForegroundColor Yellow
}
Set-Location $here
Start-Process 'http://localhost:4748'
if ($Sim) { npm run sim } else { npm start }
