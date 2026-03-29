@echo off
powershell -NoProfile -Command "Start-ScheduledTask -TaskName 'traego'" 1>nul 2>nul
if %errorlevel% neq 0 (
  echo Failed to start scheduled task: traego
  exit /b 1
)
echo Started: traego
