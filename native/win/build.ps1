# Builds native/win/scissors.exe from selector.cs with the .NET Framework
# compiler that ships with Windows. The plugin also compiles on demand at
# runtime, so this script is only needed when preparing a release or testing
# source changes before packaging.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$csc = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
  $csc = Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
  throw 'No .NET Framework C# compiler (csc.exe) was found.'
}

& $csc /nologo /target:winexe /optimize `
  /out:"$here\scissors.exe" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  "$here\selector.cs"

if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
Write-Host "Built $here\scissors.exe"
