$ErrorActionPreference = "Stop"

$taskName = "TraeTaskDispatcher"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
