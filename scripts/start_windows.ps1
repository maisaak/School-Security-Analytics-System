$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not (Test-Path ".venv\Scripts\python.exe")) { throw "Run scripts/install_windows.ps1 first" }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "Install Node.js LTS and npm" }
if (-not (Test-Path "frontend\node_modules")) { throw "Run npm.cmd ci in frontend first" }

function Test-Endpoint([string]$url) {
    try { return (Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3).StatusCode -eq 200 }
    catch { return $false }
}
function Test-Port([int]$port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}
function Wait-Endpoint([string]$url, [System.Diagnostics.Process]$process) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (Test-Endpoint $url) { return }
        if ($process.HasExited) { throw "Process exited before readiness. Check logs." }
        Start-Sleep -Seconds 1
    }
    throw "Timeout waiting for $url. Check logs."
}

New-Item -ItemType Directory -Force -Path "logs" | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
if (Test-Port 8000) {
    if (-not (Test-Endpoint "http://127.0.0.1:8000/api/system/status")) { throw "Port 8000 is occupied but API is not ready." }
    Write-Host "Backend is already running." -ForegroundColor Green
} else {
    $backend = Start-Process -FilePath (Resolve-Path ".venv\Scripts\python.exe") -ArgumentList "-m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000" -WorkingDirectory $root -RedirectStandardOutput "logs\backend_$stamp.log" -RedirectStandardError "logs\backend_$stamp.error.log" -PassThru
    Set-Content -Path ".backend.pid" -Value $backend.Id
    Wait-Endpoint "http://127.0.0.1:8000/api/system/status" $backend
}
if (Test-Port 3000) {
    if (-not (Test-Endpoint "http://127.0.0.1:3000/api/system/status")) { throw "Port 3000 is occupied but frontend is not connected to API." }
    Write-Host "Frontend is already running." -ForegroundColor Green
} else {
    $frontend = Start-Process -FilePath "npm.cmd" -ArgumentList "run dev -- --strictPort" -WorkingDirectory (Join-Path $root "frontend") -RedirectStandardOutput "logs\frontend_$stamp.log" -RedirectStandardError "logs\frontend_$stamp.error.log" -PassThru
    Set-Content -Path ".frontend.pid" -Value $frontend.Id
    Wait-Endpoint "http://127.0.0.1:3000/api/system/status" $frontend
}
Write-Host "System ready: http://localhost:3000" -ForegroundColor Green
Write-Host "Logs: logs. Stop with .\scripts\stop_windows.ps1"
