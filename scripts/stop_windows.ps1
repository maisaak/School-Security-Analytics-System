function Stop-Tree([int]$processId) {
    $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $processId }
    foreach ($child in $children) { Stop-Tree $child.ProcessId }
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
foreach ($file in @(".backend.pid", ".frontend.pid")) {
    if (Test-Path $file) {
        $processId = Get-Content $file | Select-Object -First 1
        Stop-Tree ([int]$processId)
        Remove-Item $file -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "Локальные backend/frontend процессы остановлены." -ForegroundColor Yellow
