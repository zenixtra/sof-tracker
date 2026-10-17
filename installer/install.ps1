# SoF Tracker installer. Run by SoF-Tracker-Setup-<version>.exe (built with installer\build.ps1).
#  - installs Node.js LTS with winget if it is missing or too old
#  - copies the tracker to %LOCALAPPDATA%\SoF Tracker; the data folder (your sessions, settings, notes) is never touched
#  - finds the Scions of Fate game folder, or asks for it
#  - creates Start-menu and desktop shortcuts, optionally starts with Windows, then starts the tray icon
# -Update: started by the tracker itself after it verified this setup (lib/updater.js): no questions, keeps the
#   shortcuts and settings, and starts the tracker again. Every run writes data\install.log.
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'SoF Tracker'),
  [string]$GameDir = '',
  [switch]$Silent,       # no questions (keeps defaults)
  [switch]$Update,       # an in-app update: silent, keeps shortcuts, restarts the tracker
  [switch]$NoShortcuts,  # for testing
  [switch]$NoStart,      # for testing
  [switch]$KeepRunning   # for testing: don't stop a tracker that is already running
)
$ErrorActionPreference = 'Stop'
if ($Update) { $Silent = $true }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$Title = 'SoF Tracker setup'
New-Item -ItemType Directory -Force (Join-Path $InstallDir 'data') | Out-Null
$log = Join-Path $InstallDir 'data\install.log'
function Log($m) { try { Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" -Encoding UTF8 } catch { } }
function Say($m) { Write-Host "  $m"; Log $m }
function Ask($q) { if ($Silent) { return $true }; return [System.Windows.Forms.MessageBox]::Show($q, $Title, 'YesNo', 'Question') -eq 'Yes' }
# errors always show a message box during an update too: the user started it and is waiting for the tracker
function Fail($m) {
  Log "ERROR: $m"
  if (-not $Silent -or $Update) { [System.Windows.Forms.MessageBox]::Show("$m`n`nDetails: $log", $Title, 'OK', 'Error') | Out-Null }
  Write-Host "  ERROR: $m" -ForegroundColor Red; exit 1
}

Write-Host ''
Write-Host '  SoF Tracker setup' -ForegroundColor Yellow
Write-Host ''
Log "---- setup started$(if ($Update) { ' (update)' }) from $PSScriptRoot"
$payload = Join-Path $PSScriptRoot 'app.zip'
if (-not (Test-Path $payload)) { Fail 'app.zip is missing next to the installer.' }

# ---- 1. Node.js (22 or newer)
function NodeMajor { try { $v = & node --version 2>$null; if ($v -match '^v(\d+)') { return [int]$Matches[1] } } catch { }; return 0 }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
$major = NodeMajor
if ($major -lt 22) {
  Say $(if ($major) { "Node.js $major is too old; version 22 or newer is needed." } else { 'Node.js is not installed.' })
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget -and ($Update -or (Ask 'SoF Tracker needs Node.js (free, from nodejs.org). Install it now with Windows Package Manager?'))) {
    Say 'Installing Node.js LTS (this can take a minute)...'
    & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
    RefreshPath
    $major = NodeMajor
  }
  if ($major -lt 22) {
    Start-Process 'https://nodejs.org/en/download'
    Fail 'Please install Node.js (LTS) from nodejs.org, then run this setup again.'
  }
}
Say "Node.js $(& node --version) found."

# ---- 2. unpack and check the new files before touching the installed ones
$new = Join-Path $env:TEMP ("sof-tracker-new-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
try { Expand-Archive -Path $payload -DestinationPath $new -Force } catch { Fail "Could not unpack the program files: $($_.Exception.Message)" }
$newVersion = try { (Get-Content (Join-Path $new 'package.json') -Raw | ConvertFrom-Json).version } catch { $null }
if (-not $newVersion -or -not (Test-Path (Join-Path $new 'server.js'))) { Fail 'The setup is incomplete (no server.js or package.json): download it again.' }
& node --check (Join-Path $new 'server.js') 2>$null
if ($LASTEXITCODE) { Fail "The new version's program files don't run with Node.js $(& node --version)." }
Say "Version $newVersion unpacked."

# never over a development copy (the project folder): that would move the source code aside
if ((Test-Path (Join-Path $InstallDir 'scripts\release.js')) -or (Test-Path (Join-Path $InstallDir '.git'))) {
  Fail "$InstallDir is a development copy of SoF Tracker (it has the release tool or .git). Update it with git, or install somewhere else."
}

# ---- 3. stop a running tracker (its files are about to be replaced)
# Only the tracker of this folder: its tray, its server and the screen readers they started (a tracker run from
# another folder, e.g. a development copy, is left alone).
function OurProcesses {
  $all = Get-CimInstance Win32_Process
  $esc = [regex]::Escape($InstallDir.TrimEnd('\'))
  $ours = @($all | Where-Object { ($_.Name -in 'node.exe', 'powershell.exe', 'wscript.exe') -and $_.CommandLine -match $esc -and $_.ProcessId -ne $PID })
  # children of those (an older tray started "node server.js" without the folder in it)
  $ids = $ours.ProcessId
  $ours += @($all | Where-Object { $ids -contains $_.ParentProcessId -and $_.Name -in 'node.exe', 'powershell.exe' -and $_.ProcessId -ne $PID })
  return $ours | Sort-Object ProcessId -Unique
}
if (-not $KeepRunning) {
  $ours = OurProcesses
  $listener = try { (Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess } catch { $null }
  # first ask our tracker to save and stop by itself, then stop what's left
  $ours | Where-Object { $_.CommandLine -like '*tray.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($listener -and ($ours.ProcessId -contains $listener)) {
    try { Invoke-RestMethod -Method Post -Uri 'http://localhost:7777/api/shutdown' -TimeoutSec 3 | Out-Null } catch { }
    for ($i = 0; $i -lt 30 -and (Get-Process -Id $listener -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
  }
  OurProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($ours) { Say 'Stopped the running tracker.' }
}

# ---- 4. swap the program files: the old ones go to .previous (kept until the next update, for going back),
# the new ones move in. The data folder stays where it is. If moving fails, the old files are put back.
$update = Test-Path (Join-Path $InstallDir 'server.js')
$prev = Join-Path $InstallDir '.previous'
$keepNames = @('data', '.previous', 'sof.ico')
try {
  if ($update) {
    Remove-Item -Recurse -Force $prev -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $prev | Out-Null
    Get-ChildItem $InstallDir -Force | Where-Object { $keepNames -notcontains $_.Name } | ForEach-Object { Move-Item $_.FullName (Join-Path $prev $_.Name) -Force }
  }
  Get-ChildItem $new -Force | ForEach-Object { Move-Item $_.FullName (Join-Path $InstallDir $_.Name) -Force }
} catch {
  $err = $_.Exception.Message
  if ($update -and (Test-Path $prev)) {
    Get-ChildItem $InstallDir -Force | Where-Object { $keepNames -notcontains $_.Name } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem $prev -Force | ForEach-Object { Move-Item $_.FullName (Join-Path $InstallDir $_.Name) -Force -ErrorAction SilentlyContinue }
    Log 'Put the previous version back.'
  }
  if (-not $NoStart) { Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"' + (Join-Path $InstallDir 'tray.vbs') + '"') }
  Fail "Could not replace the program files ($err). The previous version was kept: close anything using the SoF Tracker folder and run the setup again."
} finally { Remove-Item -Recurse -Force $new -ErrorAction SilentlyContinue }
Say $(if ($update) { "Updated $InstallDir to $newVersion" } else { "Installed $newVersion to $InstallDir" })

# ---- 5. game folder
# the tracker needs the folder where the game writes its logs: normally <game>\Client
# (the game folder itself also has a YGOnline.exe, so the Client folder is checked first)
function IsClientDir($d) { return [bool]($d -and ((Test-Path (Join-Path $d 'YGOnline.exe')) -or (Test-Path (Join-Path $d 'log3.txt')))) }
function ToClientDir($d) {
  if (-not $d -or -not (Test-Path $d)) { return $null }
  $c = Join-Path $d 'Client'
  if (IsClientDir $c) { return $c }
  if (IsClientDir $d) { return $d }
  return $null
}
$configFile = Join-Path $InstallDir 'data\config.json'
$clientDir = $null
if (Test-Path $configFile) { try { $clientDir = ToClientDir ((Get-Content $configFile -Raw | ConvertFrom-Json).clientDir) } catch { } }
if (-not $clientDir -and $GameDir) { $clientDir = ToClientDir $GameDir }
if (-not $clientDir) { $clientDir = ToClientDir 'C:\NetGame\ScionsOfFate' }
if (-not $clientDir) {
  # Steam libraries
  $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
  $libs = @()
  if ($steam) {
    $libs += $steam
    $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
    if (Test-Path $vdf) { $libs += [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"') | ForEach-Object { $_.Groups[1].Value -replace '\\\\', '\' } }
  }
  foreach ($l in $libs) {
    foreach ($g in (Get-ChildItem (Join-Path $l 'steamapps\common') -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Scions|Fate|Yulgang' })) {
      $clientDir = ToClientDir $g.FullName; if ($clientDir) { break }
    }
    if ($clientDir) { break }
  }
}
# (an update keeps going without it: the tracker asks in its setup check)
while (-not $clientDir -and -not $Update) {
  if ($Silent) { Fail 'Scions of Fate was not found. Run setup again with -GameDir.' }
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = 'Select your Scions of Fate game folder (the one with the Client folder or YGOnline.exe).'
  if ($dlg.ShowDialog() -ne 'OK') { Fail 'No game folder selected.' }
  $clientDir = ToClientDir $dlg.SelectedPath
  if (-not $clientDir) { [System.Windows.Forms.MessageBox]::Show('That folder does not look like Scions of Fate. Pick the folder that contains YGOnline.exe or the Client folder.', $Title) | Out-Null }
}
if ($clientDir) {
  $cfg = @{}; if (Test-Path $configFile) { try { (Get-Content $configFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $cfg[$_.Name] = $_.Value } } catch { } }
  $cfg.clientDir = $clientDir
  [IO.File]::WriteAllText($configFile, ($cfg | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
  Say "Game found: $clientDir"
}

# ---- 6. icon + shortcuts (an update leaves your shortcuts and "start with Windows" choice as they are)
$ico = Join-Path $InstallDir 'sof.ico'
try {
  $bmp = New-Object System.Drawing.Bitmap 64, 64
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(214, 168, 74))), 2, 2, 60, 60)
  $fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $g.DrawString('S', (New-Object System.Drawing.Font('Georgia', 34, [System.Drawing.FontStyle]::Bold)), (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(26, 20, 8))), (New-Object System.Drawing.RectangleF(0, 2, 64, 64)), $fmt)
  $g.Dispose()
  $fs = [IO.File]::Create($ico); [System.Drawing.Icon]::FromHandle($bmp.GetHicon()).Save($fs); $fs.Close()
} catch { $ico = $null }

$shell = New-Object -ComObject WScript.Shell
function Shortcut($path, $target, $arguments, $desc) {
  $s = $shell.CreateShortcut($path); $s.TargetPath = $target; $s.Arguments = $arguments; $s.WorkingDirectory = $InstallDir; $s.Description = $desc
  if ($ico) { $s.IconLocation = $ico }
  $s.Save()
}
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$trayArgs = '"' + (Join-Path $InstallDir 'tray.vbs') + '"'
if (-not $NoShortcuts -and -not $Update) {
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'SoF Tracker'
  New-Item -ItemType Directory -Force $menu | Out-Null
  Shortcut (Join-Path $menu 'SoF Tracker.lnk') $wscript $trayArgs 'Start the Scions of Fate tracker'
  Shortcut (Join-Path $menu 'Uninstall SoF Tracker.lnk') 'powershell.exe' ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $InstallDir 'uninstall.ps1') + '"') 'Remove SoF Tracker'
  Set-Content -Path (Join-Path $menu 'SoF Tracker dashboard.url') -Value "[InternetShortcut]`r`nURL=http://localhost:7777/`r`n" -Encoding ASCII
  Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'SoF Tracker.lnk') $wscript $trayArgs 'Start the Scions of Fate tracker'
  Say 'Start-menu and desktop shortcuts created.'
  $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'SoF Tracker.lnk'
  if ((Test-Path $startup) -or (Ask 'Start SoF Tracker automatically when you log in to Windows?')) {
    Shortcut $startup $wscript $trayArgs 'Scions of Fate tracker'
    Say 'Starts with Windows.'
  }
}

# ---- 7. start (after an update the dashboard that is already open reloads by itself)
if (-not $NoStart) {
  Start-Process $wscript -ArgumentList $trayArgs
  if (-not $Update) { Start-Sleep 4; Start-Process 'http://localhost:7777/' }
}
Say "Done ($newVersion)."
Write-Host ''
Write-Host '  Done! Look for the gold "S" icon in the system tray.' -ForegroundColor Green
if (-not $Silent) { [System.Windows.Forms.MessageBox]::Show("SoF Tracker $newVersion is installed.`n`nIt runs in the system tray (gold S icon). Double-click the icon to open the dashboard.", $Title, 'OK', 'Information') | Out-Null }
