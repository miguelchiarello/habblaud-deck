# Habblaud Deck in the Windows tray: starts Habblaud and the deck daemon with no windows, keeps the daemon running
# (restarts it if it dies), and shows the office's mood in the icon: lit windows, a red badge when an agent needs you,
# a pause badge while the deck is handed to the Rise Mode app, dark when something is down.
#   powershell -ExecutionPolicy Bypass -File .\tray.ps1      (or: npm run tray)
# Logs: logs\deck.log and logs\habblaud.log. Right-click the icon for the menu, double-click for the simulator.
param([switch]$Hidden)

$here = Split-Path -Parent $PSCommandPath
if (-not $Hidden) {
  # Relaunch without a console window and give the terminal back.
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', "`"$PSCommandPath`"", '-Hidden')
  return
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$created = $false
$script:mutex = [System.Threading.Mutex]::new($true, 'Local\HabblaudDeckTray', [ref]$created)
if (-not $created) {
  [System.Windows.Forms.MessageBox]::Show('Habblaud Deck is already running in the tray.', 'Habblaud Deck') | Out-Null
  return
}

$hab = Join-Path (Split-Path -Parent $here) 'habblaud'
$logs = Join-Path $here 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$deckLog = Join-Path $logs 'deck.log'
$habLog = Join-Path $logs 'habblaud.log'
foreach ($l in $deckLog, $habLog) {
  if ((Test-Path $l) -and (Get-Item $l).Length -gt 2MB) { Move-Item -Force $l ($l -replace '\.log$', '.old.log') }
}
$sim = 'http://localhost:4748'
$habUrl = 'http://localhost:4747'
$startupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Habblaud Deck.lnk'

# ------------------------------------------------------------------ processes

function Start-Hidden([string]$dir, [string]$cmd, [string]$log) {
  Add-Content -Path $log -Value "`r`n==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $cmd"
  $psi = [System.Diagnostics.ProcessStartInfo]::new('cmd.exe', "/d /c $cmd >> `"$log`" 2>&1")
  $psi.WorkingDirectory = $dir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  [System.Diagnostics.Process]::Start($psi)
}

function Stop-Tree($p) {
  if ($p -and -not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null }
}

function Test-Up([string]$url) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 $url | Out-Null; $true } catch { $false }
}

function Get-DeckStatus {
  try { Invoke-RestMethod -TimeoutSec 1 "$sim/status" } catch { $null }
}

function Set-Device([bool]$on) {
  try { Invoke-RestMethod -Method Post -TimeoutSec 2 -Uri "$sim/device" -ContentType 'application/json' -Body (@{ on = $on } | ConvertTo-Json) | Out-Null; $true } catch { $false }
}

$script:habProc = $null      # Habblaud, when we started it
$script:deckProc = $null     # the deck daemon, when we started it
$script:restarts = @()       # times of automatic restarts (crash loop guard)
$script:quitting = $false

function Start-Deck {
  $script:deckProc = Start-Hidden $here 'node --import tsx src/main.ts' $deckLog
}

if (-not (Test-Up "$habUrl/api/snapshot")) {
  if (Test-Path (Join-Path $hab 'package.json')) { $script:habProc = Start-Hidden $hab 'npm start' $habLog }
}
if (-not (Test-Up "$sim/status")) { Start-Deck } # else: a daemon is already running (npm start); we just watch it

# ------------------------------------------------------------------ icon + menu

# Light building on a dark taskbar, navy building on a light one (follows the Windows theme as it changes).
$size = [System.Windows.Forms.SystemInformation]::SmallIconSize
$icons = @{}
foreach ($look in 'light', 'dark') {
  foreach ($m in 'ok', 'waiting', 'paused', 'offline') {
    $icons["$m-$look"] = [System.Drawing.Icon]::new((Join-Path $here "assets\tray\$m-$look.ico"), $size)
  }
}
function Get-Look {
  try {
    $light = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction Stop).SystemUsesLightTheme
    if ($light -eq 1) { 'dark' } else { 'light' }
  } catch { 'light' }
}

$tray = [System.Windows.Forms.NotifyIcon]::new()
$tray.Icon = $icons["offline-$(Get-Look)"]
$tray.Text = 'Habblaud Deck: starting...'
$tray.Visible = $true

$menu = [System.Windows.Forms.ContextMenuStrip]::new()
$title = $menu.Items.Add('Habblaud Deck')
$title.Enabled = $false
$title.Font = [System.Drawing.Font]::new($menu.Font, [System.Drawing.FontStyle]::Bold)
$state = $menu.Items.Add('starting...')
$state.Enabled = $false
[void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
$openSim = $menu.Items.Add('Open the simulator')
$openHab = $menu.Items.Add('Open Habblaud')
[void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
$pause = $menu.Items.Add('Pause the deck (free it for the Rise Mode app)')
$restart = $menu.Items.Add('Restart the deck')
[void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
$auto = [System.Windows.Forms.ToolStripMenuItem]::new('Start with Windows')
$auto.Checked = Test-Path $startupLink
[void]$menu.Items.Add($auto)
$openLog = $menu.Items.Add('Open the log')
[void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
$quit = $menu.Items.Add('Quit')
$tray.ContextMenuStrip = $menu

$openSim.add_Click({ Start-Process $sim })
$tray.add_DoubleClick({ Start-Process $sim })
$openHab.add_Click({ Start-Process $habUrl })
$openLog.add_Click({ if (Test-Path $deckLog) { Start-Process notepad.exe $deckLog } })

$pause.add_Click({
  $s = Get-DeckStatus
  if (-not $s) { return }
  [void](Set-Device ($s.deviceState -eq 'paused'))
  Update-Tray
})

$restart.add_Click({
  if (-not $script:deckProc) {
    $tray.ShowBalloonTip(4000, 'Habblaud Deck', 'This deck daemon was started outside the tray (npm start): restart it there.', 'Info')
    return
  }
  [void](Set-Device $false) # let go of the device cleanly first
  Stop-Tree $script:deckProc
  Start-Sleep -Milliseconds 500
  Start-Deck
})

$auto.add_Click({
  if ($auto.Checked) {
    Remove-Item $startupLink -ErrorAction SilentlyContinue
  } else {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($startupLink)
    $lnk.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -STA -File `"$PSCommandPath`" -Hidden"
    $lnk.WorkingDirectory = $here
    $lnk.IconLocation = Join-Path $here 'assets\tray\ok-light.ico'
    $lnk.WindowStyle = 7
    $lnk.Description = 'Habblaud Deck'
    $lnk.Save()
  }
  $auto.Checked = Test-Path $startupLink
})

$quit.add_Click({
  $script:quitting = $true
  $timer.Stop()
  if ($script:deckProc) {
    [void](Set-Device $false)
    Stop-Tree $script:deckProc
  }
  Stop-Tree $script:habProc
  $tray.Visible = $false
  $tray.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

# ------------------------------------------------------------------ watching

$script:lastDevice = ''

function Update-Tray {
  $s = Get-DeckStatus
  if (-not $s) {
    $mood = 'offline'; $text = 'starting the deck...'
  } elseif (-not $s.habblaud) {
    $mood = 'offline'; $text = 'waiting for Habblaud'
  } else {
    switch ($s.deviceState) {
      'paused' { $mood = 'paused'; $text = 'deck paused (free for Rise Mode)' }
      'stuck' { $mood = 'offline'; $text = 'deck not answering: replug it' }
      'searching' { $mood = 'offline'; $text = 'deck not found' }
      'recovering' { $mood = 'offline'; $text = 'reconnecting the deck...' }
      default { $mood = 'ok'; $text = 'deck ok' }
    }
    if ($mood -ne 'paused' -and $s.waiting -gt 0) {
      $mood = 'waiting'
      $text = if ($s.waiting -eq 1) { '1 agent needs you' } else { "$($s.waiting) agents need you" }
    }
    if ($s.deviceState -eq 'stuck' -and $script:lastDevice -ne 'stuck') {
      $tray.ShowBalloonTip(8000, 'Habblaud Deck', 'The deck stopped answering. Unplug it and plug it back in.', 'Warning')
    }
    $script:lastDevice = $s.deviceState
  }
  $icon = $icons["$mood-$(Get-Look)"]
  if ($tray.Icon -ne $icon) { $tray.Icon = $icon }
  $tray.Text = ("Habblaud Deck: $text").Substring(0, [Math]::Min(63, "Habblaud Deck: $text".Length))
  $state.Text = $text
  $pause.Text = if ($s -and $s.deviceState -eq 'paused') { 'Resume the deck' } else { 'Pause the deck (free it for the Rise Mode app)' }
  $pause.Enabled = [bool]$s
}

$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = 2000
$timer.add_Tick({
  try {
    # Keep the daemon alive: restart it if it exits, unless it keeps crashing (5 times in 2 minutes).
    if (-not $script:quitting -and $script:deckProc -and $script:deckProc.HasExited) {
      $now = Get-Date
      $script:restarts = @($script:restarts | Where-Object { ($now - $_).TotalSeconds -lt 120 }) + $now
      if ($script:restarts.Count -le 5) {
        Start-Deck
      } else {
        $script:deckProc = $null
        $tray.ShowBalloonTip(8000, 'Habblaud Deck', 'The deck daemon keeps stopping. See "Open the log".', 'Error')
      }
    }
    Update-Tray
  } catch {
    Add-Content -Path $deckLog -Value "[tray] $($_.Exception.Message)"
  }
})
$timer.Start()

if (Get-Process | Where-Object { $_.ProcessName -match 'StreamDock|Mirabox|RiseMode|Rise Mode' }) {
  $tray.ShowBalloonTip(6000, 'Habblaud Deck', 'The Rise Mode app is running and may hold the deck. Close it from its tray icon.', 'Info')
}

[System.Windows.Forms.Application]::Run()
$script:mutex.ReleaseMutex()
