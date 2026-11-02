@echo off
title Smart Parking Management System
echo ========================================================
echo   Starting Smart Parking System on http://localhost:3000
echo ========================================================
set ELECTRON_RUN_AS_NODE=1
"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" server.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Trying fallback to standard node...
    node server.js
)
pause
