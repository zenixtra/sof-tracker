@echo off
rem Opens the always-on-top overlay. The tracker (start.bat) must already be running.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0overlay.ps1"
