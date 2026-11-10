$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DshScissorsDragMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
}
"@

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$exe = Join-Path $root 'native\win\scissors.exe'
if (-not (Test-Path $exe)) { throw "selector not found: $exe" }

$dir = Join-Path $env:TEMP 'dsh-scissors-tests'
New-Item -ItemType Directory -Force $dir | Out-Null
$out = Join-Path $dir 'drag-test.png'
Remove-Item $out -Force -ErrorAction SilentlyContinue
Remove-Item "$out.hwnd" -Force -ErrorAction SilentlyContinue

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$startX = [int]($screen.Left + $screen.Width * 0.2)
$startY = [int]($screen.Top + $screen.Height * 0.2)
$dragW = [int][Math]::Min(400, $screen.Width * 0.4)
$dragH = [int][Math]::Min(250, $screen.Height * 0.3)

$process = Start-Process -FilePath $exe -ArgumentList @($out) -PassThru
$origin = [System.Windows.Forms.Cursor]::Position
try {
  Start-Sleep -Milliseconds 800

  [DshScissorsDragMouse]::SetCursorPos($startX, $startY) | Out-Null
  Start-Sleep -Milliseconds 100
  [DshScissorsDragMouse]::mouse_event([DshScissorsDragMouse]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  for ($i = 1; $i -le 12; $i++) {
    [DshScissorsDragMouse]::SetCursorPos(
      $startX + [int]($dragW * $i / 12),
      $startY + [int]($dragH * $i / 12)
    ) | Out-Null
    Start-Sleep -Milliseconds 25
  }
  [DshScissorsDragMouse]::mouse_event([DshScissorsDragMouse]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)

  if (-not $process.WaitForExit(15000)) {
    $process.Kill()
    throw 'selector did not exit after the drag'
  }
  $process.Refresh()
  if ($process.ExitCode -ne 0) { throw "expected exit code 0, got $($process.ExitCode)" }
  if (-not (Test-Path $out)) { throw 'no PNG was produced' }

  $bytes = [System.IO.File]::ReadAllBytes($out)
  if ($bytes.Length -lt 24) { throw 'PNG is too small to contain an IHDR' }
  $width = [System.BitConverter]::ToUInt32($bytes[19..16], 0)
  $height = [System.BitConverter]::ToUInt32($bytes[23..20], 0)
  if ($width -lt 50 -or $height -lt 50) {
    throw "captured region is unexpectedly small: $width x $height"
  }

  Write-Host "PASS selector-drag ($width x $height, $($bytes.Length) bytes)"
} finally {
  if (-not $process.HasExited) { $process.Kill() }
  [System.Windows.Forms.Cursor]::Position = $origin
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  Remove-Item "$out.hwnd" -Force -ErrorAction SilentlyContinue
  Remove-Item "$out.err" -Force -ErrorAction SilentlyContinue
}
