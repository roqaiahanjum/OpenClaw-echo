@echo off
echo [Setup] Registering OpenClaw Echo as Windows startup task...

schtasks /create /tn "OpenClawEcho" /tr "wscript.exe \"C:\Users\Roqaiah Anjum E\OneDrive\Attachments\Desktop\my project\open claw project\launch-silent.vbs\"" /sc ONLOGON /ru "%USERNAME%" /rl HIGHEST /f

if %errorlevel% == 0 (
  echo [Setup] SUCCESS — OpenClaw Echo will now start automatically on login.
  echo [Setup] To test it now without restarting, double-click launch-silent.vbs
) else (
  echo [Setup] FAILED — Try running this file as Administrator.
)
pause
