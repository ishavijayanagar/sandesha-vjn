@echo off
echo ========================================
echo Sandesha Bot - Starting Fresh
echo ========================================

echo.
echo [1/3] Killing any existing node processes...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul
if exist ".lock" del /F ".lock"

echo [2/3] Clearing old session (optional)...
echo Press Y to clear WhatsApp session and re-scan QR, or N to skip:
set /p choice="(Y/N)? "
if /i "%choice%"=="Y" (
    if exist ".wwebjs_auth\session" (
        echo Cleaning session folder...
        rmdir /S /Q ".wwebjs_auth\session"
    )
)

echo [3/3] Starting bot...
echo.
node listen.js

echo.
echo Bot stopped.
pause
