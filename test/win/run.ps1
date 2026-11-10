$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'The native selector tests only run on Windows.'
}

$scripts = @(
  'selector-esc.ps1',
  'selector-drag.ps1',
  'selector-hide.ps1'
)

foreach ($name in $scripts) {
  $script = Join-Path $PSScriptRoot $name
  Write-Host "==> $name"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script
  if ($LASTEXITCODE -ne 0) {
    throw "$name failed with exit code $LASTEXITCODE"
  }
}

Write-Host 'All native selector tests passed.'
