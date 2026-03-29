# WhatsApp Bot - Termux Setup Guide

A complete guide to run your WhatsApp bot on Android using Termux.

---

## What is Termux?

Termux is an Android app that gives you a **Linux command-line environment** on your phone. You can install Node.js and run your WhatsApp bot just like on a computer.

---

## Prerequisites

- Android phone (Android 7.0 or higher recommended)
- ~500MB free storage
- Internet connection

---

## Step 1: Install Termux

1. **Uninstall** any existing Termux from Google Play (outdated version)
2. **Download** Termux from F-Droid:
   - Visit: https://f-droid.org/en/packages/com.termux/
   - Download and install the APK
3. **Also download Termux:Boot** (for auto-start):
   - https://f-droid.org/en/packages/com.termux.boot/

---

## Step 2: First Time Setup

Open Termux app and run these commands:

```bash
# Update package list
pkg update && pkg upgrade -y

# Install Node.js
pkg install nodejs

# Install Git
pkg install git

# Give storage permission (will prompt for approval)
termux-setup-storage
```

---

## Step 3: Clone Your Repository

```bash
# Go to shared storage (accessible by other apps)
cd /storage/emulated/0

# Create folder for the bot
mkdir wa-bot
cd wa-bot

# Clone your GitHub repo
git clone https://github.com/debug1ife/wa-bot.git

# Enter the folder
cd wa-bot
```

**Note:** You'll need to enter your GitHub credentials when prompted.

---

## Step 4: Install Dependencies

```bash
cd wa-bot
npm install
```

This may take a few minutes. Wait for it to complete.

---

## Step 5: Copy Configuration Files

You need to copy these files from your laptop to your phone:

1. `groups.json` - Your group configurations
2. `contacts.json` - Your saved contacts (optional)
3. `schedules.json` - Scheduled messages (optional)

**How to copy:**
- Share via WhatsApp/email
- Use Google Drive
- Use a USB cable

**Place them in:**
```
/storage/emulated/0/wa-bot/
```

---

## Step 6: Run the Bot (First Time)

```bash
cd /storage/emulated/0/wa-bot
node listen.js
```

**What happens:**
1. Bot will generate a QR code
2. Scan the QR with WhatsApp on your phone
3. Bot connects to WhatsApp

**To scan QR:**
- Keep the terminal visible
- Open WhatsApp on the same phone
- Go to WhatsApp Web or linked devices
- Scan the QR from the Termux screen

---

## Step 7: Verify Bot is Running

You should see:
```
WhatsApp connected
My number: 91XXXXXXXXXX@c.us
Send server on http://127.0.0.1:42620
```

---

## Step 8: Send Commands via WhatsApp

1. Open WhatsApp
2. Go to your "Me Commands" group
3. Send commands like:
   - `!groups` - List all groups
   - `!help` - Show all commands
   - `Hello family` - Send to family group

---

## Daily Usage (After Setup)

### To Start the Bot:
```bash
cd /storage/emulated/0/wa-bot
node listen.js
```

### To Stop the Bot:
```bash
# Press Ctrl+C in Termux
# Or type
exit
```

### To Close Termux:
- Just close the app (swipe it away)
- Bot stops running
- No battery drain

---

## Keep Bot Running (Optional)

### Method 1: Background Mode
1. Open Termux
2. Run `node listen.js`
3. **Long press** on the screen
4. Select **"Background"**
5. Close Termux
6. Bot continues running!

### Method 2: Auto-Start (Using Termux:Boot)
1. Install Termux:Boot from F-Droid
2. Create a startup script:
```bash
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/start-bot.sh << 'EOF'
cd /storage/emulated/0/wa-bot
node listen.js
EOF
chmod +x ~/.termux/boot/start-bot.sh
```
3. When phone restarts, Termux:Boot will run the script

---

## Troubleshooting

### QR Code Not Visible?
- Make sure your phone screen is on
- Termux should display QR in ASCII art
- If not, check terminal settings

### "Session not found" Error?
- Delete the `.wwebjs_auth` folder:
```bash
rm -rf .wwebjs_auth
node listen.js
# Scan QR again
```

### Dependencies Failed to Install?
```bash
pkg update
pkg install nodejs git
npm install
```

### Bot Disconnected?
- Check internet connection
- Restart Termux:
```bash
exit
node listen.js
```

---

## Common Commands Reference

```bash
# Navigate to bot folder
cd /storage/emulated/0/wa-bot

# Start bot
node listen.js

# Stop bot
exit

# Update code from GitHub
git pull

# Check what's running
ps aux | grep node

# Kill all node processes
pkill node

# Check storage
ls -la /storage/emulated/0/wa-bot/
```

---

## File Locations

| File | Location |
|------|----------|
| Bot code | `/storage/emulated/0/wa-bot/` |
| WhatsApp session | `.wwebjs_auth/` |
| Logs | Same folder as code |
| Schedules | `schedules.json` |

---

## Tips

1. **Backup your session:** The `.wwebjs_auth` folder contains your WhatsApp session. Keep a backup.

2. **Don't clear Termux data:** This will delete your session and you'll need to scan QR again.

3. **Use a simple password for Git:** Use a Personal Access Token instead of password for git operations.

4. **Keep the bot folder simple:** Don't move files around after setup.

---

## Quick Reference Card

Print or screenshot this:

```
╔══════════════════════════════════════╗
║         TERMUX QUICK REFERENCE       ║
╠══════════════════════════════════════╣
║ START BOT:                          ║
║   cd /storage/emulated/0/wa-bot     ║
║   node listen.js                    ║
╠══════════════════════════════════════╣
║ STOP BOT:                           ║
║   Ctrl+C                            ║
║   OR type: exit                      ║
╠══════════════════════════════════════╣
║ UPDATE CODE:                        ║
║   git pull                          ║
╠══════════════════════════════════════╣
║ HELP:                               ║
║   !help (in WhatsApp)              ║
╚══════════════════════════════════════╝
```

---

## Support

For issues:
1. Check troubleshooting section above
2. Check bot console for error messages
3. Verify your internet connection

---

**Last Updated:** March 2026
