@echo off
echo ========================================
echo Clearing WhatsApp Session
echo ========================================

echo.
echo Killing any running bot...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul

echo.
echo Removing session folder...
if exist ".wwebjs_auth\session" (
    rmdir /S /Q ".wwebjs_auth\session"
    echo Session cleared!
) else (
    echo No session folder found.
)

echo.
echo ========================================
echo Session cleared. Now:
echo 1. Run: start-fresh.bat
echo 2. Scan QR code with WhatsApp
echo 3. Make sure "Me Commands" group is NOT archived
echo ========================================
pause
