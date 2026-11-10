$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DshScissorsHideWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  public static IntPtr FindTitle(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      StringBuilder sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (sb.ToString() == title && IsWindowVisible(h)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static IntPtr FindPid(int pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == (uint)pid && IsWindowVisible(h)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static string Title(IntPtr h) {
    StringBuilder sb = new StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString();
  }
}
"@

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$exe = Join-Path $root 'native\win\scissors.exe'
$helper = Join-Path $PSScriptRoot 'show-window.ps1'
if (-not (Test-Path $exe)) { throw "selector not found: $exe" }
if (-not (Test-Path $helper)) { throw "window helper not found: $helper" }

$dir = Join-Path $env:TEMP 'dsh-scissors-tests'
New-Item -ItemType Directory -Force $dir | Out-Null
$out = Join-Path $dir 'hide-test.png'
Remove-Item $out -Force -ErrorAction SilentlyContinue
Remove-Item "$out.hwnd" -Force -ErrorAction SilentlyContinue

$title = 'dsh-scissors test window'
$targetProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', "`"$helper`""
) -PassThru
$selector = $null
try {
  $target = [IntPtr]::Zero
  for ($i = 0; $i -lt 100; $i++) {
    Start-Sleep -Milliseconds 100
    $target = [DshScissorsHideWin]::FindTitle($title)
    if ($target -ne [IntPtr]::Zero) { break }
  }
  if ($target -eq [IntPtr]::Zero) { throw 'test window did not appear' }

  $wshell = New-Object -ComObject WScript.Shell
  $activated = $false
  for ($i = 0; $i -lt 10; $i++) {
    $wshell.AppActivate($title) | Out-Null
    Start-Sleep -Milliseconds 200
    if ([DshScissorsHideWin]::GetForegroundWindow() -eq $target) { $activated = $true; break }
  }
  if (-not $activated) { throw 'could not bring the test window to the foreground' }

  $selector = Start-Process -FilePath $exe -ArgumentList @($out, '--hide') -PassThru
  $sidecar = ''
  for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 100
    if (Test-Path "$out.hwnd") {
      $sidecar = (Get-Content "$out.hwnd" -Raw).Trim()
      if ($sidecar -ne '') { break }
    }
  }
  if ($sidecar -eq '') { throw 'the selector did not write a window sidecar' }
  if ([long]$sidecar -ne $target.ToInt64()) {
    throw "sidecar points at $sidecar instead of the foreground test window $($target.ToInt64())"
  }
  if ([DshScissorsHideWin]::IsWindowVisible($target)) {
    throw 'the test window was still visible during selection'
  }

  $selectorHandle = [IntPtr]::Zero
  for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 100
    $selectorHandle = [DshScissorsHideWin]::FindPid($selector.Id)
    if ($selectorHandle -ne [IntPtr]::Zero) { break }
  }
  if ($selectorHandle -eq [IntPtr]::Zero) { throw 'selector window did not appear' }
  [DshScissorsHideWin]::PostMessage($selectorHandle, 0x0100, [IntPtr]0x1B, [IntPtr]::Zero) | Out-Null
  [DshScissorsHideWin]::PostMessage($selectorHandle, 0x0101, [IntPtr]0x1B, [IntPtr]::Zero) | Out-Null

  if (-not $selector.WaitForExit(10000)) {
    $selector.Kill()
    throw 'selector did not exit after Escape'
  }
  $selector.Refresh()
  if ($selector.ExitCode -ne 2) { throw "expected exit code 2, got $($selector.ExitCode)" }

  Start-Sleep -Milliseconds 700
  if (-not [DshScissorsHideWin]::IsWindowVisible($target)) {
    throw 'the test window was not restored'
  }
  $foreground = [DshScissorsHideWin]::GetForegroundWindow()
  if ($foreground -ne $target) {
    throw "the test window was restored but not focused (foreground title: $([DshScissorsHideWin]::Title($foreground)))"
  }
  if (Test-Path "$out.hwnd") { throw 'the window sidecar was not cleaned up' }

  Write-Host 'PASS selector-hide'
} finally {
  if ($null -ne $selector -and -not $selector.HasExited) { $selector.Kill() }
  if (-not $targetProcess.HasExited) { $targetProcess.Kill() }
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  Remove-Item "$out.hwnd" -Force -ErrorAction SilentlyContinue
  Remove-Item "$out.err" -Force -ErrorAction SilentlyContinue
}
