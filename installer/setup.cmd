@echo off
rem Entry point inside SoF-Tracker-Setup.exe: IExpress unpacks the files to a temp folder and runs this.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 pause
