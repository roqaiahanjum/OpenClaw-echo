@echo off
echo [OpenClaw] Checking agent status...
netstat -ano | findstr :3005 | findstr LISTENING
if %errorlevel% == 0 (
  echo [STATUS] OpenClaw Echo is RUNNING on port 3005
) else (
  echo [STATUS] OpenClaw Echo is NOT running
)
echo.
echo [Last 20 log lines]:
powershell -command "Get-Content 'logs\openclaw.log' -Tail 20"
pause
