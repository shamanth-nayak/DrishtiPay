@echo off
title DrishtiPay Launcher
echo ==============================================
echo       Starting DrishtiPay Application
echo ==============================================
echo.

cd /d "%~dp0"

echo [1/2] Starting Backend (FastAPI on port 8000)...
start "DrishtiPay Backend" cmd /k "python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000"

echo [2/2] Starting Frontend (Node.js on port 5173)...
start "DrishtiPay Frontend" cmd /k "node server.mjs"

echo.
echo ==============================================
echo DrishtiPay is running in the background windows.
echo - Access on PC:     http://localhost:5173
echo - Access on Mobile: Check the Frontend window for your Network IP
echo ==============================================
pause
