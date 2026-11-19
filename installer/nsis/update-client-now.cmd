@echo off
rem Updates the Foundry AI Tool client to the version the table runs, right now.
rem Quit Claude Desktop completely first (tray icon, Quit). Works with or without the tunnel.
setlocal
set "STATE=%~dp0update"
if exist "%~dp0tunnel\tunnel.json" set "STATE=%~dp0tunnel"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0client-update.ps1" -Action Check -Now -StateDir "%STATE%"
echo.
if exist "%STATE%\update-status.json" type "%STATE%\update-status.json"
echo.
pause
