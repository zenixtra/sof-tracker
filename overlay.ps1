# Opens the tracker overlay as a small borderless Edge app window and pins it on top of other windows.
# The game must run in windowed or borderless-windowed mode for anything to stay on top of it.
param(
  [int]$Width = 300,
  [int]$Height = 360,
  [int]$Opacity = 88   # percent
)

Add-Type -AssemblyName System.Windows.Forms
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Host 'Microsoft Edge not found; open http://localhost:7777/overlay in any browser instead.'; exit 1 }

$already = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*overlay-profile*' }
if ($already) { Write-Host 'Overlay is already open.'; exit 0 }

$profileDir = Join-Path $PSScriptRoot 'data\overlay-profile'
$left = [int]([System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Width) - $Width - 20
if ($left -lt 0) { $left = 20 }
# no component / background downloads: the overlay only shows a local page (they filled the profile with ~400 MB)
Start-Process $edge -ArgumentList "--app=http://localhost:7777/overlay", "--window-size=$Width,$Height", "--window-position=$left,80", "--user-data-dir=`"$profileDir`"", '--no-first-run', '--disable-component-update', '--disable-background-networking'

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
  public static IntPtr Find(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (sb.ToString().StartsWith(title)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 40 -and $hwnd -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 250; $hwnd = [Win]::Find('SoF Overlay') }
if ($hwnd -eq [IntPtr]::Zero) { Write-Host 'Overlay window did not appear.'; exit 1 }

$HWND_TOPMOST = [IntPtr](-1)
[void][Win]::SetWindowPos($hwnd, $HWND_TOPMOST, 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) # NOSIZE | NOMOVE | SHOWWINDOW
$GWL_EXSTYLE = -20; $WS_EX_LAYERED = 0x80000
[void][Win]::SetWindowLong($hwnd, $GWL_EXSTYLE, ([Win]::GetWindowLong($hwnd, $GWL_EXSTYLE) -bor $WS_EX_LAYERED))
[void][Win]::SetLayeredWindowAttributes($hwnd, 0, [byte]([Math]::Round(255 * $Opacity / 100)), 0x2)
Write-Host 'Overlay pinned on top. Close it like any window.'
