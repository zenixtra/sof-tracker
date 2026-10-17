# Builds dist\SoF-Tracker-Setup-<version>.exe: a small setup program (compiled with the C# compiler that
# ships with Windows) carrying the program files and installer script inside it.
# The setup contains the program files only: never your data folder, tokens or backups.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'stage'
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

# 1. program files -> app.zip
& node (Join-Path $PSScriptRoot 'pack.js') (Join-Path $stage 'app.zip')
if ($LASTEXITCODE) { throw 'packing failed' }
Copy-Item (Join-Path $PSScriptRoot 'install.ps1') $stage

# 2. icon: the tracker's gold "S"
$ico = Join-Path $stage 'sof.ico'
$bmp = New-Object System.Drawing.Bitmap 64, 64
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(214, 168, 74))), 2, 2, 60, 60)
$fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$g.DrawString('S', (New-Object System.Drawing.Font('Georgia', 34, [System.Drawing.FontStyle]::Bold)), (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(26, 20, 8))), (New-Object System.Drawing.RectangleF(0, 2, 64, 64)), $fmt)
$g.Dispose()
$fs = [IO.File]::Create($ico); [System.Drawing.Icon]::FromHandle($bmp.GetHicon()).Save($fs); $fs.Close()

# 3. compile the setup program with app.zip and install.ps1 embedded
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$target = Join-Path $dist "SoF-Tracker-Setup-$version.exe"
Remove-Item $target -ErrorAction SilentlyContinue
$v = "$version.0"
$verSrc = Join-Path $stage 'Version.cs'
"using System.Reflection;`r`n[assembly: AssemblyVersion(`"$v`")]`r`n[assembly: AssemblyFileVersion(`"$v`")]`r`n" | Set-Content $verSrc -Encoding UTF8
& $csc /nologo /target:exe /optimize+ "/out:$target" "/win32icon:$ico" /reference:System.Windows.Forms.dll `
  "/resource:$(Join-Path $stage 'app.zip'),app.zip" "/resource:$(Join-Path $stage 'install.ps1'),install.ps1" (Join-Path $PSScriptRoot 'SetupLauncher.cs') $verSrc
if ($LASTEXITCODE -or -not (Test-Path $target)) { throw 'compiling the setup failed' }
Remove-Item -Recurse -Force $stage
Write-Host "Built $target ($([math]::Round((Get-Item $target).Length / 1KB)) KB)"
