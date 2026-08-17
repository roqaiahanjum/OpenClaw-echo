@echo off
title OpenClaw Echo
cd /d "C:\Users\Roqaiah Anjum E\OneDrive\Attachments\Desktop\my project\open claw project"

echo [OpenClaw] Working directory: %CD%
echo [OpenClaw] Checking .env file...

if not exist ".env" (
  echo [ERROR] .env file not found at %CD%\.env
  echo [ERROR] Bot cannot start without API keys.
  pause
  exit /b 1
)

echo [OpenClaw] .env file found. Starting agent...

:: Kill any existing process on ports 3005 and 3006
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3005 " ^| findstr LISTENING') do (
  taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3006 " ^| findstr LISTENING') do (
  taskkill /PID %%a /F >nul 2>&1
)

timeout /t 2 /nobreak >nul

:: Create logs folder if it doesn't exist
if not exist "logs" mkdir logs

:: Start with explicit working directory so .env is found
node -r ts-node/register src/index.ts >> logs\openclaw.log 2>&1
