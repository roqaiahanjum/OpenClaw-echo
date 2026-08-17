@echo off
echo [OpenClaw] Stopping agent...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3005 ^| findstr LISTENING') do (
  taskkill /PID %%a /F
  echo [OpenClaw] Stopped PID %%a
)
echo [OpenClaw] Agent stopped.
pause
