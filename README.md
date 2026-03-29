# WhatsApp Group Bot

A powerful WhatsApp bot for managing groups, scheduling messages, tracking replies, and more.

## Features

- 🤖 AI Chat Integration
- 📤 Send messages to groups
- 📅 Schedule messages
- 👥 List group members
- 🔍 Find members in groups
- 📊 Track inactive groups
- 🔎 Track replies and reactions
- 👤 Contact management
- 📋 Group sets

## Installation

```bash
# Clone the repository
git clone https://github.com/debug1ife/wa-bot.git
cd wa-bot

# Install dependencies
npm install

# Start the bot
node listen.js
```

## Commands

### Natural Messaging
- "hi family" → Send "hi" to family set
- "send hi to hebbal" → Send to hebbal group
- "say hi to all" → Broadcast to all groups

### Commands (!)
```
!ai <text>       - Chat with AI
!send <t> <msg>  - Send to target
!all <msg>       - Broadcast to all
!sets            - List group sets
!groups          - List all groups
!members <name>  - List group members
!find <name>     - Find member in groups
!inactive [d]    - Show inactive groups
!schedules       - List scheduled messages
!cancel          - Cancel last schedule
!contacts        - List saved contacts
!addcontact <n> <num> - Add contact
!track <msg>     - Track replies
!seen <msg>      - Track message reads
!readstatus      - Show read status
!help            - Show this help
```

### Scheduling
Format: `<message> !schedule to <target> at <time>`

Examples:
- `Hello all !schedule to family at 9am tomorrow`
- `Good morning !schedule to hebbal at 8am`
- `Today's quote !schedule to all at 7am daily`

## Configuration

Edit `groups.json` to add your group sets:
```json
{
  "family": ["Group1", "Group2"],
  "work": ["WorkGroup1"],
  "all": ["Group1", "Group2", "Group3"]
}
```

Edit `listen.js` to configure:
- `COMMANDS_GROUP_JID` - Your commands group ID
- `LISTEN_PORT` - HTTP server port (default: 42620)
- `ZC_WEBHOOK` - AI webhook URL

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/send` | POST | Send message |
| `/send-media` | POST | Send media |
| `/groups` | GET | List groups |
| `/health` | GET | Health check |
| `/chats` | GET | List chats |

## License

MIT License
