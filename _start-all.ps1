$root = $PSScriptRoot
$serverDir = Join-Path $root "server"
$clientDir = Join-Path $root "client"
$serverLog = Join-Path $serverDir "restart.log"
$serverErr = Join-Path $serverDir "restart.err"
$clientLog = Join-Path $clientDir "client.log"
$clientErr = Join-Path $clientDir "client.err"
Remove-Item $serverLog, $serverErr, $clientLog, $clientErr -ErrorAction SilentlyContinue
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","npm","run","dev" -WorkingDirectory $serverDir -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverErr
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","npm","run","dev" -WorkingDirectory $clientDir -WindowStyle Hidden -RedirectStandardOutput $clientLog -RedirectStandardError $clientErr
Write-Host "launched both"
