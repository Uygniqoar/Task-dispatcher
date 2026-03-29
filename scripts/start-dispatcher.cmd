@echo off
powershell -NoProfile -Command "Start-ScheduledTask -TaskName 'Traego'" 1>nul 2>nul
if %errorlevel% neq 0 (
  echo Failed to start scheduled task: Traego
  exit /b 1
)
echo Started: Traego
