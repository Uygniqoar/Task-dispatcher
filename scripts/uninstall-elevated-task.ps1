$ErrorActionPreference = "Stop"

$taskName = "Traego"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
