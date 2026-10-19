@echo off
title The Lotus Cross Server
cd /d "%~dp0"
echo Starting The Lotus Cross server...
echo.
echo Public site:  http://localhost:3000/
echo Login:        http://localhost:3000/login.html
echo Admin panel:  http://localhost:3000/admin.html
echo.
echo Press Ctrl+C to stop.
echo.
node server.js
pause
