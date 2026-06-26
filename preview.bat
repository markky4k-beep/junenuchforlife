@echo off
setlocal

cd /d "%~dp0"
set "PORT=3000"
set "BASE_URL=http://localhost:%PORT%/"

echo [POD] Checking preview server...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"try { Invoke-WebRequest -UseBasicParsing '%BASE_URL%api/health' -TimeoutSec 2 | Out-Null; Start-Process '%BASE_URL%'; exit 0 } catch { exit 1 }"

if %errorlevel%==0 (
  echo [POD] Preview is already running. Opened %BASE_URL%
  goto :end
)

echo [POD] Starting preview server...
start "POD Preview Server" cmd /k "cd /d ""%~dp0"" && npm start"

echo [POD] Waiting for server to be ready...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"$url='%BASE_URL%'; for ($i = 0; $i -lt 40; $i++) { try { Invoke-WebRequest -UseBasicParsing ($url + 'api/health') -TimeoutSec 2 | Out-Null; Start-Process $url; Write-Host '[POD] Preview opened at' $url; exit 0 } catch { Start-Sleep -Seconds 1 } }; Write-Host '[POD] Server may still be starting. Open manually:' $url"

:end
endlocal
