# Sandesha — Setup Guide

A step-by-step guide to install, configure, and run the Sandesha WhatsApp bot on your machine.

---

## What is Sandesha?

Sandesha is a WhatsApp bot that lets you:

- Send messages to one or many groups from a **commands group**
- Schedule messages for later delivery
- Use natural language (e.g. `send hello to family`)
- Control the bot via a local HTTP API and CLI (`send.js`)

The main process is `listen.js`. It runs 24/7, connects via WhatsApp Web, and exposes an API on port **42620**.

---

## Requirements

| Requirement | Details |
|-------------|---------|
| Node.js | 18 or higher (`node --version`) |
| WhatsApp account | Your personal number |
| Internet | Stable connection |
| OS | Linux, macOS, or Windows |

**Linux note:** Puppeteer downloads Chromium on first run. If you want to skip the download and use system Chrome:

```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm install
```

---

## 1. Install

```bash
# Clone or copy the project, then:
cd sandesha
npm install
```

---

## 2. Configure Groups

Group sets live in `groups.json`. Each key is a **set name** you use in commands; the value is a list of **group JIDs**.

### Option A — Web dashboard (easiest)

1. Start the bot: `./start.sh`
2. Open **http://127.0.0.1:42620/**
3. Search your groups, tick checkboxes, enter a set name, click **Save set**

No JIDs to copy manually.

### Option B — WhatsApp `!settings`

In **Me Commands**:

```
!settings
```

Reply with the menu numbers to add, edit, or delete sets. Search groups by keyword (e.g. `vjn`), pick by number (`1 3 5`), then `done`.

### Option C — Edit `groups.json` manually

Example:

```json
{
  "family": [
    "120363356653014076@g.us",
    "120363419744937952@g.us"
  ],
  "all_vols_grps": [
    "120363356653014076@g.us",
    "120363419744937952@g.us"
  ]
}
```

### How to get group JIDs (if needed)

**While the bot is running**

```bash
# List all groups with JIDs
node send.js --list

# Or via API
curl http://127.0.0.1:42620/groups
curl http://127.0.0.1:42620/sets
```

### GitHub Pages

The `docs/` folder can be published on GitHub Pages (repo Settings → Pages → `/docs`).  
For day-to-day use, open **http://127.0.0.1:42620/** on the machine running the bot — the GitHub URL cannot reach your local API.

**Option B — Resolve names to JIDs (helper script)**

1. Put group names in a text file (one per line), e.g. `MyGroups.txt`
2. Start the bot and scan QR (see below)
3. Run:

```bash
node scripts/generate-group-jids.js --file MyGroups.txt --json all_vols_grps
```

Copy the printed JSON into `groups.json`.

---

## 3. Configure the Commands Group

The bot only reacts to messages **you send** in a dedicated WhatsApp group (default name: **"Me Commands"**).

1. Create a WhatsApp group named **Me Commands** (or use an existing one)
2. Add yourself — the bot uses your linked WhatsApp Web session
3. Update the JID in `listen.js` if your group differs:

```javascript
const COMMANDS_GROUP_NAME = 'Me Commands';
const COMMANDS_GROUP_JID = '120363426133559474@g.us';  // your group JID
```

To find your group JID: run `node send.js --list` after the bot is connected and look for "Me Commands".

---

## 4. Start the Bot

```bash
node listen.js
```

**Only one instance can run at a time.** The bot creates a `.lock` file to prevent duplicates.

### Link WhatsApp (first time or after session reset)

1. Run `node listen.js`
2. A QR code appears in the terminal
3. A copy is also saved as `qr-code.png` in the project folder
4. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device**
5. Scan the QR code

When connected, you should see logs like:

```
WhatsApp connected
Send server on http://127.0.0.1:42620
Setup complete!
```

The HTTP API is only available **after** WhatsApp connects.

---

## 5. Verify It Works

```bash
# Health check
curl http://127.0.0.1:42620/health

# List groups
curl http://127.0.0.1:42620/groups
```

In the **Me Commands** group on WhatsApp, send:

```
!help
```

You should get a help message within a few seconds.

---

## 6. Using the Bot

### In WhatsApp (Me Commands group)

| Type | Example |
|------|---------|
| Help | `!help` |
| List sets | `!sets` |
| List groups | `!groups` |
| Send to set | `!send family Hello everyone` |
| Broadcast | `!all Good morning` |
| Natural language | `send hello to family` |
| Schedule | `Hello !schedule to family at 9am` |
| AI chat | `!ai tell me a joke` |

Scheduling time formats: `9am`, `2pm`, `14:30`, `tomorrow`, `monday`, `march 30`, etc.

### CLI (`send.js`)

Requires `listen.js` to be running.

```bash
node send.js --list
node send.js --sets
node send.js --set family --msg "Hello"
node send.js --group "Isha Kengeri" --msg "Hi"
node send.js --all --msg "Broadcast message"
node send.js --set family --file ./photo.jpg --caption "Look!"
```

Or use npm scripts:

```bash
npm run list
npm run send -- --set family --msg "Hello"
```

### HTTP API (port 42620)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Bot status |
| GET | `/groups` | All groups with JIDs |
| GET | `/chats?limit=20` | Recent chats |
| POST | `/send` | Send text message |
| POST | `/send-media` | Send file with caption |

**Send text:**

```bash
curl -X POST http://127.0.0.1:42620/send \
  -H "Content-Type: application/json" \
  -d '{"recipient": "family", "message": "Hello"}'
```

`recipient` can be a set name, group name, or JID. Use `jid` instead of `recipient` for a direct JID.

**Send media:**

```bash
curl -X POST http://127.0.0.1:42620/send-media \
  -H "Content-Type: application/json" \
  -d '{"recipient": "family", "filePath": "/path/to/image.jpg", "caption": "Hi"}'
```

---

## 7. Important Files

| File | Purpose |
|------|---------|
| `listen.js` | Main bot (run this) |
| `send.js` | CLI for sending via API |
| `groups.json` | Group sets (you edit this) |
| `schedules.json` | Scheduled messages (auto-managed) |
| `state.json` | Bot state / timestamps (auto-generated) |
| `sandesha.log` | Activity log |
| `qr-code.png` | Latest QR code image |
| `.wwebjs_auth/` | WhatsApp session (do not delete unless re-linking) |
| `.lock` | Single-instance lock (auto-managed) |

Optional: create `contacts.json` for contact commands (`!contacts`, `!addcontact`):

```json
{
  "contacts": {
    "John": "919844400000"
  }
}
```

---

## 8. Stopping and Restarting

### Graceful stop

Press `Ctrl+C` in the terminal where `listen.js` is running.

### Clean restart (Linux / macOS)

If the bot won't start or Chrome is stuck:

```bash
# Stop bot and orphaned browser
pkill -f "node listen.js"
pkill -f "user-data-dir=$(pwd)/.wwebjs_auth/session"

# Remove stale lock (only if no bot is running)
rm -f .lock

# Start again
node listen.js
```

### Full reset (re-scan QR)

```bash
pkill -f "node listen.js"
pkill -f "user-data-dir=$(pwd)/.wwebjs_auth/session"
rm -f .lock
rm -rf .wwebjs_auth
node listen.js
```

### Windows

Use `start-fresh.bat` in the project folder, or:

```bat
taskkill /F /IM node.exe
del /F .lock
node listen.js
```

---

## 9. Troubleshooting

### `Bot is already running! Delete .lock file if not.`

Another `listen.js` process is running, or a previous run crashed without cleaning up.

```bash
pgrep -af "node listen.js"    # check if really running
# If nothing is running:
rm -f .lock
node listen.js
```

### `The browser is already running for .../.wwebjs_auth/session`

An orphaned Puppeteer Chrome process is holding the session. **Do not start a second `node listen.js`.**

```bash
pkill -f "user-data-dir=$(pwd)/.wwebjs_auth/session"
node listen.js
```

### Bot not responding to commands

1. Confirm `listen.js` is running and WhatsApp is connected (`curl http://127.0.0.1:42620/health`)
2. Send commands only in the **Me Commands** group
3. Messages must be sent **from your account** (the linked session)
4. Wait up to ~5 seconds (message polling interval)

### Stuck on QR / session expired

```bash
rm -rf .wwebjs_auth
node listen.js
# Scan new QR code
```

### `send.js` says "Is listen.js running?"

Start the bot first and wait until WhatsApp is connected.

### Duplicate messages

You likely have two instances. Stop all and start one:

```bash
pkill -f "node listen.js"
rm -f .lock
node listen.js
```

### View logs

```bash
tail -f sandesha.log
```

---

## 10. Running 24/7

### Raspberry Pi (recommended at home)

See **[RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md)** for a full checklist: Node.js, Chromium, QR scan over SSH, systemd auto-start, GitHub workflow, and `.gitignore` rules.

### Simple background (Linux)

```bash
nohup node listen.js >> sandesha.log 2>&1 &
```

### systemd (Linux server)

Create `/etc/systemd/system/sandesha.service`:

```ini
[Unit]
Description=Sandesha WhatsApp Bot
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/sandesha
ExecStart=/usr/bin/node listen.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl enable sandesha
sudo systemctl start sandesha
sudo systemctl status sandesha
```

### Android (Termux)

See [TERMUX_SETUP_GUIDE.md](TERMUX_SETUP_GUIDE.md) for running on your phone.

---

## 11. Testing

```bash
npm test                 # All tests
npm run test:unit        # Unit tests
npm run test:mock        # Mock integration tests
npm run test:http        # HTTP API tests (requires listen.js running)
```

---

## Quick Reference

```bash
# Install
npm install

# Run
node listen.js

# Verify
curl http://127.0.0.1:42620/health

# Send from CLI
node send.js --set family --msg "Hello"

# Stop
Ctrl+C

# Force clean restart
pkill -f "node listen.js"; pkill -f "wwebjs_auth/session"; rm -f .lock; node listen.js
```

---

## Support

- Check `sandesha.log` for errors
- Run `!help` in the Me Commands group
- See [README.md](README.md) for feature overview
