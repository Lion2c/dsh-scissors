$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DshScissorsEscWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  public static IntPtr Find(int pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == (uint)pid && IsWindowVisible(h)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$exe = Join-Path $root 'native\win\scissors.exe'
if (-not (Test-Path $exe)) { throw "selector not found: $exe" }

$dir = Join-Path $env:TEMP 'dsh-scissors-tests'
New-Item -ItemType Directory -Force $dir | Out-Null
$out = Join-Path $dir 'esc-test.png'
Remove-Item $out -Force -ErrorAction SilentlyContinue
Remove-Item "$out.hwnd" -Force -ErrorAction SilentlyContinue

$process = Start-Process -FilePath $exe -ArgumentList @($out) -PassThru
try {
  $handle = [IntPtr]::Zero
  for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 100
    $handle = [DshScissorsEscWin]::Find($process.Id)
    if ($handle -ne [IntPtr]::Zero) { break }
  }
  if ($handle -eq [IntPtr]::Zero) { throw 'selector window did not appear' }

  Start-Sleep -Milliseconds 400
  [DshScissorsEscWin]::PostMessage($handle, 0x0100, [IntPtr]0x1B, [IntPtr]::Zero) | Out-Null
  [DshScissorsEscWin]::PostMessage($handle, 0x0101, [IntPtr]0x1B, [IntPtr]::Zero) | Out-Null

  if (-not $process.WaitForExit(10000)) {
    $process.Kill()
    throw 'selector did not exit after Escape'
  }
  $process.Refresh()
  if ($process.ExitCode -ne 2) { throw "expected exit code 2 for cancel, got $($process.ExitCode)" }
  if (Test-Path $out) { throw 'a PNG was created after cancelling with Escape' }

  Write-Host 'PASS selector-esc'
} finally {
  if (-not $process.HasExited) { $process.Kill() }
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  Remove-Item "$out.hwnd" -Force -ErrorAction SilentlyContinue
  Remove-Item "$out.err" -Force -ErrorAction SilentlyContinue
}
