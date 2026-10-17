@echo off
rem Starts the tracker reachable from other devices on your home network (phone, tablet).
rem Windows may ask whether Node.js may accept connections: allow it for Private networks only.
cd /d "%~dp0"
set SOF_HOST=0.0.0.0
start "" http://localhost:7777/#alerts
node server.js
