# Sandesha - WhatsApp Group Messaging Bot

A WhatsApp bot for sending messages to groups, scheduling messages, and automation.

## Features

- 📢 Send messages to multiple groups
- ⏰ Schedule messages for later delivery
- 🤖 AI-powered natural language processing
- 📱 Works with WhatsApp Web
- 🔄 Automatic reconnection
- 💾 State persistence (survives restarts)
- ✅ 172 tests passing

## Requirements

- Node.js 18+
- WhatsApp account
- Internet connection

## Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd Sandesha

# Install dependencies
npm install
```

## Setup

### 1. Configure Groups

Edit `groups.json`:

```json
{
  "family": ["Family Group JID", "Another Family Group"],
  "work": ["Work Group JID"],
  "all": ["Group1", "Group2", "Group3"]
}
```

### 2. Configure Contacts (Optional)

Edit `contacts.json`:

```json
{
  "contacts": {
    "John": "919844400000",
    "Jane": "919844411111"
  }
}
```

### 3. Start the Bot

```bash
# Development
node listen.js

# Or use the convenience script
start-fresh.bat
```

### 4. Scan QR Code

1. Open WhatsApp on your phone
2. Go to Settings → Linked Devices
3. Tap "Link a Device"
4. Scan the QR code shown in terminal

### 5. Commands Group

The bot listens to a specific group (default: "Me Commands"). Add the bot to that group and send commands there.

## Commands

### Help Command

```
!help
```

Shows all available commands.

### List Groups

```
!groups
```

Lists all configured groups and their last activity.

### Send Message

#### Using Natural Language

```
send hello to family
hi to work
broadcast message to all
```

#### Using Command

```
!send Hello family
!broadcast Hello everyone
```

### Schedule Message

#### Natural Language

```
hello everyone !schedule to family at 9am
good morning !schedule to all at tomorrow 8am
```

#### Using Command

```
!schedule Hello to family at 9am
```

### Time Formats Supported

| Format | Example |
|--------|---------|
| Time | 9am, 2pm, 14:30 |
| Relative | tomorrow, today |
| Days | monday, tuesday, friday |
| Specific | march 30, january 15 |

### AI Chat

Simply send a message without a command:

```
how are you?
tell me a joke
what is the weather?
```

The bot will respond using AI.

## API Endpoints

The bot runs a local HTTP server on port 42620:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /groups` | List all groups |
| `POST /send` | Send message |

### API Examples

```bash
# Health check
curl http://127.0.0.1:42620/health

# List groups
curl http://127.0.0.1:42620/groups

# Send message
curl -X POST http://127.0.0.1:42620/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "target": "family"}'
```

## Troubleshooting

### Bot not responding?

1. Check if bot is running: `node listen.js`
2. Make sure you're in the "Me Commands" group
3. Wait up to 5 seconds (polling interval)

### Stuck on QR Code?

1. Delete session: `rm -rf .wwebjs_auth`
2. Restart: `node listen.js`
3. Scan new QR code

### Duplicate messages?

Check logs - may be running multiple instances:

```bash
taskkill /F /IM node.exe
node listen.js
```

### Check Logs

```bash
# View all logs
type sandesha.log

# View recent errors
findstr /i "error" sandesha.log
```

## Testing

```bash
# Run all tests
npm test

# Run specific tests
npm run test:unit      # Unit tests only
npm run test:poller    # Poller logic tests
npm run test:mock      # Integration tests
```

## Files

| File | Description |
|------|-------------|
| `listen.js` | Main bot application |
| `send.js` | CLI for sending messages |
| `groups.json` | Group configurations |
| `contacts.json` | Contact list |
| `schedules.json` | Scheduled messages |
| `state.json` | Bot state (auto-generated) |
| `sandesha.log` | Activity log |

## Deployment

### Local (Development)

```bash
node listen.js
```

### 24/7 Server

For 24/7 operation, use a VPS:

1. **DigitalOcean** - $4/month (recommended)
2. **Railway** - $5/month
3. **Oracle Cloud** - Free (requires credit card)

See deployment guides for more details.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 42620 | HTTP server port |

### Commands Group

The bot listens to messages in a specific group. Default: "Me Commands"

To change, edit `COMMANDS_GROUP_JID` in `listen.js`:

```javascript
const COMMANDS_GROUP_JID = 'your-group-jid@g.us';
```

## License

MIT

## Support

For issues and questions, check the logs or open an issue on GitHub.
