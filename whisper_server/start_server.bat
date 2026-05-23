@echo off
pushd "%~dp0"
powershell -NoProfile -Command "Get-Content 'start_server.ps1' -Raw | Invoke-Expression"
pause
