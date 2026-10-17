# Scions of Fate tracker in the system tray: runs the tracker without a console window,
# shows Windows notifications for its alerts, has a right-click menu, and listens for in-game hotkeys:
#   Ctrl+Shift+M  mark the spot where you stand      Ctrl+Shift+O  show / hide the overlay
#   Ctrl+Shift+L  repeat the last alert (spoken)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try { Add-Type -AssemblyName System.Speech } catch { }

$root = $PSScriptRoot
$base = 'http://localhost:7777'
$dataDir = Join-Path $root 'data'
New-Item -ItemType Directory -Force $dataDir | Out-Null

# ---- one tray at a time
$mutex = New-Object System.Threading.Mutex($false, 'Local\SoFTrackerTray')
if (-not $mutex.WaitOne(0)) { exit 0 }

# ---- global hotkeys need a window handle and a message loop: a tiny hidden NativeWindow
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Windows.Forms;
using System.Runtime.InteropServices;
public class HotkeyWindow : NativeWindow {
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mod, uint vk);
  [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
  public event EventHandler Pressed;
  public int LastId;
  public HotkeyWindow() { CreateHandle(new CreateParams()); }
  public bool Register(int id, uint mod, uint vk) { return RegisterHotKey(Handle, id, mod, vk); }
  public void UnregisterAll() { for (int i = 1; i <= 9; i++) UnregisterHotKey(Handle, i); }
  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x0312) { LastId = m.WParam.ToInt32(); if (Pressed != null) Pressed(this, EventArgs.Empty); }
    base.WndProc(ref m);
  }
}
"@

function Test-Tracker {
  try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 7777); $c.Close(); return $true } catch { return $false }
}

$script:node = $null
function Start-Tracker {
  if (Test-Tracker) { return }   # already running (e.g. from start.bat)
  $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $nodeExe) { [System.Windows.Forms.MessageBox]::Show('Node.js was not found.', 'SoF Tracker') | Out-Null; return }
  # (the full path in the command line lets the installer stop exactly this tracker during an update)
  $script:node = Start-Process -FilePath $nodeExe -ArgumentList ('"' + (Join-Path $root 'server.js') + '"') -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $dataDir 'tracker.log') -RedirectStandardError (Join-Path $dataDir 'tracker-errors.log')
}
function Stop-Tracker {
  if ($script:node -and -not $script:node.HasExited) { Stop-Process -Id $script:node.Id -Force -ErrorAction SilentlyContinue }
  $script:node = $null
}

# ---- texts in the interface language (fetched from the tracker; English until it answers)
$script:tx = @{
  'Open dashboard' = 'Open dashboard'; 'Open overlay' = 'Open overlay'; 'Play' = 'Play'; 'Restart tracker' = 'Restart tracker'; 'Quit' = 'Quit'
  'Launcher started' = 'Launcher started'; 'Tracker restarted' = 'Tracker restarted'
  'Tracker is running. Double-click the icon to open the dashboard.' = 'Tracker is running. Double-click the icon to open the dashboard.'
  'Hotkeys: Ctrl+Shift+M mark spot, Ctrl+Shift+O overlay, Ctrl+Shift+L last alert' = 'Hotkeys: Ctrl+Shift+M mark spot, Ctrl+Shift+O overlay, Ctrl+Shift+L last alert'
  'Hotkeys: Ctrl+Shift+M mark spot, Ctrl+Shift+O overlay, Ctrl+Shift+L last alert, Ctrl+Shift+S status' = 'Hotkeys: Ctrl+Shift+M mark spot, Ctrl+Shift+O overlay, Ctrl+Shift+L last alert, Ctrl+Shift+S status'
  'No alerts yet' = 'No alerts yet'
}
$script:speechLang = 'en-US'
function Load-Texts {
  try {
    $r = Invoke-RestMethod -Uri "$base/api/i18n/tray" -TimeoutSec 3
    foreach ($p in $r.strings.PSObject.Properties) { $script:tx[$p.Name] = $p.Value }
    $script:speechLang = $r.speech
    $open.Text = $script:tx['Open dashboard']; $ovl.Text = $script:tx['Open overlay']; $play.Text = $script:tx['Play']
    $restart.Text = $script:tx['Restart tracker']; $quit.Text = $script:tx['Quit']
  } catch { }
}

# ---- icon: gold disc with a dark "S"
$bmp = New-Object System.Drawing.Bitmap 32, 32
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(214, 168, 74))), 1, 1, 30, 30)
$font = New-Object System.Drawing.Font('Georgia', 17, [System.Drawing.FontStyle]::Bold)
$fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$g.DrawString('S', $font, (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(26, 20, 8))), (New-Object System.Drawing.RectangleF(0, 1, 32, 32)), $fmt)
$g.Dispose()
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icon
$tray.Text = 'SoF Tracker'
$tray.Visible = $true

function Post($path, $body) {
  try { return Invoke-RestMethod -Method Post -Uri "$base$path" -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 5 }
  catch { $tray.ShowBalloonTip(5000, 'SoF Tracker', $_.Exception.Message, 'Warning'); return $null }
}

$script:synth = $null
function Say($text) {
  try {
    if (-not $script:synth) { $script:synth = New-Object System.Speech.Synthesis.SpeechSynthesizer }
    $v = $script:synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq $script:speechLang } | Select-Object -First 1
    if (-not $v) { $v = $script:synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name.StartsWith($script:speechLang.Substring(0, 2)) } | Select-Object -First 1 }
    if ($v) { $script:synth.SelectVoice($v.VoiceInfo.Name) }
    $script:synth.SpeakAsyncCancelAll(); $script:synth.SpeakAsync(($text -replace '[^\p{L}\p{N}\p{P}\s]', '')) | Out-Null
  } catch { }
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Open dashboard'); $open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
$open.add_Click({ Start-Process "$base/" })
$ovl = $menu.Items.Add('Open overlay'); $ovl.add_Click({ Post '/api/overlay' '{"open":true}' | Out-Null })
$play = $menu.Items.Add('Play'); $play.add_Click({ if ($null -ne (Post '/api/launch' '{}')) { $tray.ShowBalloonTip(3000, 'SoF Tracker', $script:tx['Launcher started'], 'Info') } })
$menu.Items.Add('-') | Out-Null
$restart = $menu.Items.Add('Restart tracker'); $restart.add_Click({ Stop-Tracker; Start-Sleep -Milliseconds 800; Start-Tracker; $tray.ShowBalloonTip(3000, 'SoF Tracker', $script:tx['Tracker restarted'], 'Info') })
$quit = $menu.Items.Add('Quit'); $quit.add_Click({
  $timer.Stop(); $hk.UnregisterAll(); Stop-Tracker
  $tray.Visible = $false; $tray.Dispose()
  [System.Windows.Forms.Application]::Exit()
})
$tray.ContextMenuStrip = $menu
$tray.add_DoubleClick({ Start-Process "$base/" })

# ---- hotkeys
$MOD = 0x0002 -bor 0x0004 -bor 0x4000   # Ctrl + Shift, no auto-repeat
$hk = New-Object HotkeyWindow
$okM = $hk.Register(1, $MOD, 0x4D)   # M
$okO = $hk.Register(2, $MOD, 0x4F)   # O
$okL = $hk.Register(3, $MOD, 0x4C)   # L
$okS = $hk.Register(4, $MOD, 0x53)   # S: say HP, EXP, next level, next boss
$okI = $hk.Register(5, $MOD, 0x49)   # I: +1 quest item (for when the game shows no pickup message)
# tell the tracker which hotkeys work (for its setup check); it may not be up yet, so this is tried again below
$script:hkReport = "{`"M`":$("$okM".ToLower()),`"O`":$("$okO".ToLower()),`"L`":$("$okL".ToLower()),`"S`":$("$okS".ToLower()),`"I`":$("$okI".ToLower())}"
$script:hkReported = $false
$hk.add_Pressed({
  switch ($hk.LastId) {
    1 { $r = Post '/api/mark-here' '{}'; if ($r) { Say $r.label } }
    2 { Post '/api/overlay' '{"toggle":true}' | Out-Null }
    3 {
      try { $a = @(Invoke-RestMethod -Uri "$base/api/alerts?translate=1&loud=1" -TimeoutSec 3) } catch { $a = @() }
      if ($a.Count) { $tray.ShowBalloonTip(6000, $a[0].title, $(if ($a[0].body) { $a[0].body } else { ' ' }), 'Info'); Say $a[0].title }
      else { $tray.ShowBalloonTip(3000, 'SoF Tracker', $script:tx['No alerts yet'], 'Info') }
    }
    4 {
      try { $v = Invoke-RestMethod -Uri "$base/api/voice-status" -TimeoutSec 3 } catch { $v = $null }
      if ($v -and $v.text) { $tray.ShowBalloonTip(6000, 'SoF Tracker', $v.text, 'Info'); Say $v.text }
    }
    5 { $r = Post '/api/quest-item-plus' '{}'; if ($r -and $r.label) { Say $r.label } }
  }
})

# ---- alerts -> Windows notifications, plus a watchdog that restarts a stopped tracker
$script:lastAlert = $null
$script:down = 0
$script:tick = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 4000
$timer.add_Tick({
  if (-not (Test-Tracker)) {
    $script:down++
    if ($script:down -ge 2) { $script:down = 0; Start-Tracker }
    return
  }
  $script:down = 0
  $script:tick++
  if (-not $script:hkReported -or $script:tick % 150 -eq 0) { if (Post '/api/tray-status' $script:hkReport) { $script:hkReported = $true } }
  if ($script:tick % 15 -eq 1) { Load-Texts }   # pick up language changes about once a minute
  try { $list = @(Invoke-RestMethod -Uri "$base/api/alerts?translate=1&loud=1" -TimeoutSec 2) } catch { return }
  if (-not $list.Count) { if ($null -eq $script:lastAlert) { $script:lastAlert = 0 }; return }
  $max = ($list | Measure-Object -Property id -Maximum).Maximum
  if ($null -eq $script:lastAlert) { $script:lastAlert = $max; return }   # don't replay old alerts at start-up
  $new = @($list | Where-Object { $_.id -gt $script:lastAlert } | Sort-Object id)
  $script:lastAlert = $max
  if ($new.Count) {
    $a = $new[-1]
    $body = if ($a.body) { $a.body } else { ' ' }
    if ($new.Count -gt 1) { $body = "$body (+$($new.Count - 1))" }
    $tray.ShowBalloonTip(8000, $a.title, $body, 'Info')
  }
})

Start-Tracker
$timer.Start()
$hint = $script:tx['Tracker is running. Double-click the icon to open the dashboard.']
if (-not ($okM -and $okO -and $okL -and $okS)) { $hint += ' (Some hotkeys are taken by another program.)' } else { $hint += "`n" + $script:tx['Hotkeys: Ctrl+Shift+M mark spot, Ctrl+Shift+O overlay, Ctrl+Shift+L last alert, Ctrl+Shift+S status'] }
$tray.ShowBalloonTip(4000, 'SoF Tracker', $hint, 'Info')
[System.Windows.Forms.Application]::Run()
$hk.UnregisterAll()
$mutex.ReleaseMutex()
