@echo off
set SCRIPT=%~dp0install-elevated-task.ps1
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%SCRIPT%""'" 
