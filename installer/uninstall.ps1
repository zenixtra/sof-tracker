# Removes SoF Tracker: stops it, removes shortcuts and the program files. Asks whether to keep your data.
Add-Type -AssemblyName System.Windows.Forms
$dir = $PSScriptRoot
$Title = 'Uninstall SoF Tracker'
if ([System.Windows.Forms.MessageBox]::Show("Remove SoF Tracker from this PC?", $Title, 'YesNo', 'Question') -ne 'Yes') { exit 0 }

# stop this folder's tracker only (its tray, server and screen readers, and what they started)
$esc = [regex]::Escape($dir.TrimEnd('\'))
$all = Get-CimInstance Win32_Process
$ours = @($all | Where-Object { $_.Name -in 'node.exe', 'powershell.exe', 'wscript.exe' -and $_.CommandLine -match $esc -and $_.ProcessId -ne $PID })
$ours += @($all | Where-Object { $ours.ProcessId -contains $_.ParentProcessId -and $_.Name -in 'node.exe', 'powershell.exe' })
$ours | Where-Object { $_.CommandLine -like '*tray.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$listener = try { (Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess } catch { $null }
if ($listener -and ($ours.ProcessId -contains $listener)) { try { Invoke-RestMethod -Method Post -Uri 'http://localhost:7777/api/shutdown' -TimeoutSec 3 | Out-Null; Start-Sleep 2 } catch { } }
$ours | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Remove-Item -Recurse -Force (Join-Path ([Environment]::GetFolderPath('Programs')) 'SoF Tracker') -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path ([Environment]::GetFolderPath('Desktop')) 'SoF Tracker.lnk') -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path ([Environment]::GetFolderPath('Startup')) 'SoF Tracker.lnk') -ErrorAction SilentlyContinue

$keep = [System.Windows.Forms.MessageBox]::Show("Keep your tracker data (sessions, notes, history) in`n$dir\data ?`n`nChoose No to delete everything.", $Title, 'YesNo', 'Question') -eq 'Yes'
Get-ChildItem $dir -Force | Where-Object { -not ($keep -and $_.Name -eq 'data') } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
if (-not $keep) { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
[System.Windows.Forms.MessageBox]::Show($(if ($keep) { "SoF Tracker was removed. Your data is still in $dir\data." } else { 'SoF Tracker was removed.' }), $Title) | Out-Null
