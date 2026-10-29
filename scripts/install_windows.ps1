$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "School Security Analytics System — установка Windows" -ForegroundColor Cyan
foreach ($command in @("git", "py", "node", "npm.cmd")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Не найдена команда '$command'. Установите Git, Python 3.13 и Node.js 22 LTS, затем откройте новый PowerShell." }
}
if (-not (Test-Path ".venv\Scripts\python.exe")) { py -3.13 -m venv .venv }
& ".venv\Scripts\python.exe" -m pip install --upgrade pip
& ".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
if (-not (Test-Path ".env")) { & ".venv\Scripts\python.exe" scripts\setup_env.py }
Push-Location frontend
npm.cmd ci
Pop-Location
Write-Host "Готово. Запустите .\scripts\start_windows.ps1" -ForegroundColor Green
