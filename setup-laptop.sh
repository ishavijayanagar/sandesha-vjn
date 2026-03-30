#!/bin/bash
# WhatsApp Bot - Laptop Setup

echo "==================================="
echo "  WhatsApp Bot - Laptop Setup"
echo "==================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from: https://nodejs.org"
    exit 1
fi

echo "✅ Node.js: $(node --version)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    exit 1
fi

echo "✅ npm: $(npm --version)"

# Clone or update repo
if [ -d "wa-bot" ]; then
    echo ""
    echo "📁 wa-bot folder exists"
    cd wa-bot
    echo "🔄 Pulling latest..."
    git pull
else
    echo ""
    echo "📥 Cloning repo..."
    git clone https://github.com/debug1ife/wa-bot.git
    cd wa-bot
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Check for Chrome
echo ""
echo "🔍 Checking Chrome..."
if command -v google-chrome &> /dev/null; then
    echo "✅ Chrome found: $(google-chrome --version)"
elif command -v chrome &> /dev/null; then
    echo "✅ Chrome found"
elif [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    echo "✅ Chrome found (Mac)"
else
    echo "⚠️ Chrome not found in PATH"
    echo "   Download Chrome from: https://www.google.com/chrome/"
    echo "   Or install chromium: sudo apt install chromium"
fi

# Clear old session
echo ""
echo "🗑️ Clearing old session (fresh login)..."
rm -rf .wwebjs_auth

echo ""
echo "==================================="
echo "  Ready to start!"
echo "==================================="
echo ""
echo "Run: node listen.js"
echo ""
echo "A browser window will open for QR code."
echo "Scan with WhatsApp: Settings > Linked Devices > Link Device"
echo ""
