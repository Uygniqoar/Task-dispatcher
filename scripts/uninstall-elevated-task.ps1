$ErrorActionPreference = "Stop"

$taskName = "traego"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
