$ErrorActionPreference = 'Stop'

# Manual integration helper: start this before choosing "Capture" in DSH. It
# waits for the host to spawn a new selector process, then performs a real
# mouse drag so the normal DSH request receives a PNG.
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DshScissorsExternalDragMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
}
"@

$cutoff = Get-Date
Write-Host "waiting for a scissors process started after $cutoff"
$process = $null
for ($i = 0; $i -lt 300; $i++) {
  Start-Sleep -Milliseconds 100
  $candidate = Get-Process -Name scissors -ErrorAction SilentlyContinue |
    Where-Object { $_.StartTime -ge $cutoff } |
    Sort-Object StartTime |
    Select-Object -First 1
  if ($candidate) { $process = $candidate; break }
}
if (-not $process) {
  Write-Host 'no scissors process appeared'
  exit 1
}
Write-Host "pid=$($process.Id) start=$($process.StartTime)"

for ($i = 0; $i -lt 50; $i++) {
  Start-Sleep -Milliseconds 100
  $process.Refresh()
  if ($process.MainWindowHandle -ne 0) { break }
}
Start-Sleep -Milliseconds 500

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$startX = [int]($screen.Left + $screen.Width * 0.2)
$startY = [int]($screen.Top + $screen.Height * 0.2)
$dragW = [int][Math]::Min(400, $screen.Width * 0.4)
$dragH = [int][Math]::Min(250, $screen.Height * 0.3)

$origin = [System.Windows.Forms.Cursor]::Position
try {
  [DshScissorsExternalDragMouse]::SetCursorPos($startX, $startY) | Out-Null
  Start-Sleep -Milliseconds 100
  [DshScissorsExternalDragMouse]::mouse_event([DshScissorsExternalDragMouse]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  for ($i = 1; $i -le 12; $i++) {
    [DshScissorsExternalDragMouse]::SetCursorPos(
      $startX + [int]($dragW * $i / 12),
      $startY + [int]($dragH * $i / 12)
    ) | Out-Null
    Start-Sleep -Milliseconds 25
  }
  [DshScissorsExternalDragMouse]::mouse_event([DshScissorsExternalDragMouse]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  Write-Host 'drag complete'
} finally {
  [System.Windows.Forms.Cursor]::Position = $origin
}
