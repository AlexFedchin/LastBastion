@echo off
REM Last Bastion - one-click launcher for Windows (needs Node.js 22+)
cd /d "%~dp0"
node scripts\prelaunch.mjs || goto :error
call npx electron .
goto :eof
:error
echo.
echo Launch failed. Make sure Node.js 22 or newer is installed: https://nodejs.org
pause
