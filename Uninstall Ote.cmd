@echo off
rem Double-click to remove Ote (your data stays).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install\bootstrap.ps1" --uninstall %*
echo.
pause
