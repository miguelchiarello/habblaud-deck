# Habblaud Deck — one-time setup on Windows (PowerShell). Run from this folder:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
# Puts Habblaud next to this folder (..\habblaud), installs both, builds Habblaud and installs its Claude Code mod
# (needed to answer permissions from the deck and to read the 5h/weekly usage).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$hab = Join-Path (Split-Path -Parent $here) 'habblaud'

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "Missing '$cmd'. $hint" -ForegroundColor Red; exit 1 }
}
Need node 'Install Node.js 22.12+ from https://nodejs.org'
Need git 'Install Git from https://git-scm.com'
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 22) { Write-Host "Node $(node -v) is too old; Habblaud needs 22.12+." -ForegroundColor Red; exit 1 }

if (-not (Test-Path $hab)) {
  Write-Host '==> Cloning Habblaud' -ForegroundColor Cyan
  git clone https://github.com/marmottajr/habblaud $hab
}
Push-Location $hab
Write-Host '==> Installing and building Habblaud' -ForegroundColor Cyan
npm install
npm run build
Write-Host '==> Installing the Habblaud mod into Claude Code (permissions, messages, usage)' -ForegroundColor Cyan
npm run mod:install
Pop-Location

Write-Host '==> Installing Habblaud Deck' -ForegroundColor Cyan
Push-Location $here
npm install
Pop-Location

Write-Host ''
Write-Host 'Done. Start everything with:  powershell -ExecutionPolicy Bypass -File .\start.ps1' -ForegroundColor Green
Write-Host 'Open sessions of Claude Code need /reload-plugins (or a restart) to pick up the mod.'
