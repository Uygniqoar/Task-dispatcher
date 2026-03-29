$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Output "NEED_ADMIN"
  Write-Output "请以管理员身份运行此脚本（右键 PowerShell/Terminal → 以管理员身份运行），再执行："
  Write-Output "powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit 1
}

$taskName = "traego"
$repo = Split-Path $PSScriptRoot -Parent
$scriptPath = Join-Path $repo "scripts\\run-dispatcher.ps1"

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$userId = "$env:USERDOMAIN\\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
