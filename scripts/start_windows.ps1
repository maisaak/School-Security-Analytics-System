$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not (Test-Path ".venv\Scripts\python.exe")) { throw "Сначала выполните .\scripts\install_windows.ps1" }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "Установите Node.js LTS и npm" }
if (-not (Test-Path "frontend\node_modules")) { throw "Сначала установите зависимости frontend: npm.cmd ci в папке frontend" }

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
        if ($process.HasExited) { throw "Процесс завершился до готовности. См. журнал в logs." }
        Start-Sleep -Seconds 1
    }
    throw "Истекло время ожидания $url. Проверьте журналы в logs."
}

New-Item -ItemType Directory -Force -Path "logs" | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
if (Test-Port 8000) {
    if (-not (Test-Endpoint "http://127.0.0.1:8000/api/system/status")) { throw "Порт 8000 занят, но API не готов. Проверьте запущенный процесс." }
    Write-Host "Backend уже запущен." -ForegroundColor Green
} else {
    $backend = Start-Process -FilePath (Resolve-Path ".venv\Scripts\python.exe") -ArgumentList "-m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000" -WorkingDirectory $root -RedirectStandardOutput "logs\backend_$stamp.log" -RedirectStandardError "logs\backend_$stamp.error.log" -PassThru
    Set-Content -Path ".backend.pid" -Value $backend.Id
    Wait-Endpoint "http://127.0.0.1:8000/api/system/status" $backend
}
if (Test-Port 3000) {
    if (-not (Test-Endpoint "http://127.0.0.1:3000/api/system/status")) { throw "Порт 3000 занят, но frontend не подключён к API." }
    Write-Host "Frontend уже запущен." -ForegroundColor Green
} else {
    $frontend = Start-Process -FilePath "npm.cmd" -ArgumentList "run dev -- --strictPort" -WorkingDirectory (Join-Path $root "frontend") -RedirectStandardOutput "logs\frontend_$stamp.log" -RedirectStandardError "logs\frontend_$stamp.error.log" -PassThru
    Set-Content -Path ".frontend.pid" -Value $frontend.Id
    Wait-Endpoint "http://127.0.0.1:3000/api/system/status" $frontend
}
Write-Host "Система готова: http://localhost:3000" -ForegroundColor Green
Write-Host "Журналы: logs. Для остановки: .\scripts\stop_windows.ps1"
