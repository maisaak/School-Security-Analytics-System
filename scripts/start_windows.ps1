$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not (Test-Path ".venv\Scripts\python.exe")) { throw "Сначала выполните .\scripts\install_windows.ps1" }
$backend = Start-Process -FilePath (Resolve-Path ".venv\Scripts\python.exe") -ArgumentList "-m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000" -WorkingDirectory $root -PassThru
$frontend = Start-Process -FilePath "npm.cmd" -ArgumentList "run dev" -WorkingDirectory (Join-Path $root "frontend") -PassThru
Set-Content -Path ".backend.pid" -Value $backend.Id
Set-Content -Path ".frontend.pid" -Value $frontend.Id
Write-Host "Backend PID: $($backend.Id); frontend PID: $($frontend.Id)" -ForegroundColor Green
Write-Host "Откройте http://localhost:3000. Для остановки выполните .\scripts\stop_windows.ps1"
