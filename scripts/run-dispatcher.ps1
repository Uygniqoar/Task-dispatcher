$ErrorActionPreference = "Stop"

$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

$logsDir = Join-Path $repo "logs"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

foreach ($port in @(3200, 4100)) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

$node = (Get-Command node -ErrorAction Stop).Source
$out = Join-Path $logsDir "dispatcher.out.log"
$err = Join-Path $logsDir "dispatcher.err.log"

Start-Process -FilePath $node -ArgumentList @("server.js") -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
