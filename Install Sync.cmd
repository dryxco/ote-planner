@echo off
rem Double-click to install or update Sync (Windows).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install\bootstrap.ps1" %*
echo.
pause
