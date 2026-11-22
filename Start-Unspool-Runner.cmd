@echo off
setlocal
cd /d "%~dp0"
title Unspool Runner
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-runner.ps1" %*
if errorlevel 1 (
  echo.
  echo Unspool Runner stopped or could not start. Review the message above.
  pause
)
endlocal
