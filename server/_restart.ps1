$serverDir = $PSScriptRoot
$logFile = Join-Path $serverDir "restart.log"
$errFile = Join-Path $serverDir "restart.err"
Remove-Item $logFile -ErrorAction SilentlyContinue
Remove-Item $errFile -ErrorAction SilentlyContinue
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","npm","run","dev" -WorkingDirectory $serverDir -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errFile
Write-Host "launched"
