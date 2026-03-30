# Understanding Sandesha - Complete Guide

## 1. What is Sandesha? (In Simple Terms)

**Sandesha** (meaning "message" in Sanskrit) is a WhatsApp automation bot that helps you send messages to multiple WhatsApp groups easily.

### Everyday Use Case
```
You: "Hey bot, send 'Happy Birthday' to all my family groups tomorrow at 9am"
Bot: "Done! Scheduled for tomorrow at 9am"
```

Think of it as a **remote control for WhatsApp messaging**:
- Send messages to ONE group or MANY groups at once
- Create "group sets" (family, work, all) for quick sending
- Schedule messages to be sent later
- Control it from a special WhatsApp group using commands

---

## 2. Technical Stack Explained

### Core Technologies

| Technology | Purpose | Simple Explanation |
|------------|---------|-------------------|
| **Node.js** | JavaScript runtime | Engine that runs your code on computer |
| **whatsapp-web.js** | WhatsApp library | Ready-made toolbox to control WhatsApp Web |
| **Puppeteer** | Browser automation | Robot that controls a hidden Chrome browser |

### Analogy

| Component | Real-world Analogy |
|-----------|-------------------|
| Node.js | The car engine |
| Puppeteer | Robot driver |
| whatsapp-web.js | The car (WhatsApp Web) |

---

## 3. How Connection Works (Step by Step)

### The Login Process

```
1. You run: node listen.js
         ↓
2. Library launches Puppeteer (headless Chrome)
         ↓
3. Opens web.whatsapp.com in hidden browser
         ↓
4. WhatsApp shows QR code
         ↓
5. You scan QR with WhatsApp phone app
         ↓
6. WhatsApp verifies it's really you
         ↓
7. Session saved in .wwebjs_auth/ folder
         ↓
8. Bot is now "logged in" and ready
```

### Session Persistence
```
.wwebjs_auth/
└── session/
    └── cookies.json  ← Saved login (never scan again)
```

---

## 4. How Communication Happens

### After Login - Two-Way Communication

#### Receiving Messages (Reading)
```
WhatsApp Web receives new message
         ↓
Library intercepts it from browser memory
         ↓
Fires 'message' event
         ↓
Your code receives: msg.body, msg.from, msg.author
```

Code:
```javascript
client.on('message', (msg) => {
  console.log(msg.body);  // Message text
});
```

#### Sending Messages (Writing)
```
Your code: chat.sendMessage("Hello")
         ↓
Library finds chat input box in browser
         ↓
Types message + presses Enter
         ↓
WhatsApp Web sends to server
         ↓
Message appears in group
```

Code:
```javascript
const chat = await client.getChatById('group@g.us');
chat.sendMessage('Hello!');
```

### Visual Flow
```
Your Code ←→ whatsapp-web.js ←→ Puppeteer ←→ WhatsApp Web ←→ WhatsApp Server
```

---

## 5. What Data Does WhatsApp Web Store?

When you log in, WhatsApp syncs ALL your data to browser memory:

### Data Available to Read

| Data | How to Access |
|------|---------------|
| Your info | `client.info` |
| All contacts | `client.getContacts()` |
| All groups | `client.getChats()` then filter `isGroup` |
| Group members | `group.fetchParticipants()` |
| Messages | `chat.fetchMessages()` |
| Profile pictures | `contact.getProfilePicUrl()` |

### What Each Looks Like

**Groups:**
```javascript
{
  name: "Family Group",
  id: "123456789@g.us",
  isGroup: true,
  participants: [
    { id: "919999999999@c.us", isAdmin: true },
    { id: "919888888888@c.us", isAdmin: false }
  ]
}
```

**Contacts:**
```javascript
{
  "919888888888": {
    name: "John",
    shortName: "John",
    profilePicUrl: "https://..."
  }
}
```

### What CAN'T Be Accessed
- Full message history (only recent)
- Who exactly read group messages
- Voice calls

---

## 6. How Bot Commands Work

### Command Processing Flow

```
You send: "!groups" in WhatsApp
         ↓
Message received via client.on('message')
         ↓
Check: Does message start with "!" ?
         ↓
Yes → handleCommand(msg.body, msg)
         ↓
Parse command, execute function
         ↓
Send reply via botReply(msg, text)
```

### Available Commands

| Command | Function | What It Does |
|---------|----------|--------------|
| `!groups` | List all groups | Shows all WhatsApp groups you're in |
| `!sets` | List group sets | Shows groups defined in groups.json |
| `!find <name>` | Search members | Find a person across all groups |
| `!inactive [days]` | Check groups | Find inactive groups |
| `!schedule <msg> to <target> at <time>` | Schedule | Send message at specific time |
| `!contacts` | List contacts | Show saved contacts |
| `!addcontact <name> <number>` | Add contact | Save a contact |
| `!help` | Help | Show all commands |

### Natural Language (No "!" Needed)
```
"hi family"       → Send "hi" to family set
"send hello to work" → Send "hello" to work set
"say good morning to all" → Broadcast to all groups
```

---

## 7. Message Tracking - What's Possible?

### What You CAN Track

| Feature | Available? | How |
|---------|------------|-----|
| Who REPLIED | ✅ Yes | Monitor group messages |
| Who REACTED | ✅ Yes | `client.on('message_reaction')` |
| Message READ (in group) | ✅ Yes | But NOT who or how many |
| Message FORWARDED | ⚠️ Limited | Just True/False |

### The Reality of Group Read Receipts

**1-on-1 Chat:**
```
✓✓ (double blue) = The ONE person read it
```

**Group Chat:**
```
✓✓ (double blue) = At least ONE person read it
                    BUT NOT who, NOT how many
```

WhatsApp intentionally hides this to protect privacy.

### Code for Tracking

```javascript
// Track replies
client.on('message', (msg) => {
  if (msg.from === 'group@g.us' && !msg.fromMe) {
    console.log(`${msg.author} replied: ${msg.body}`);
  }
});

// Track reactions
client.on('message_reaction', (reaction) => {
  console.log(`${reaction.sender} reacted: ${reaction.reaction}`);
});

// Track read status
client.on('message_ack', (msg, ack) => {
  // ack: 1=sent, 2=delivered, 3=read
  if (ack === 3) {
    console.log('Message read (but not by whom)');
  }
});
```

---

## 8. Project Structure

```
Sandesha/
├── listen.js           # Main bot (runs 24/7)
├── send.js            # CLI tool for sending messages
├── groups.json        # Group sets (family, work, all)
├── contacts.json      # Saved contacts
├── schedules.json    # Scheduled messages
├── sandesha.log      # Activity log
├── qr-code.png       # QR code for login
├── .wwebjs_auth/     # Session data (login persistence)
├── media/            # Media files
└── package.json      # Dependencies
```

---

## 9. Key Technical Details

| Detail | Value |
|--------|-------|
| HTTP API Port | 42620 |
| AI Webhook Port | 42617 |
| Message Delay | 2 seconds between messages |
| Session Location | `.wwebjs_auth/` |
| Scheduler Check | Every 30 seconds |

---

## 10. Quick Summary

### How It All Fits Together

1. **Login**: Puppeteer opens WhatsApp Web, you scan QR once
2. **Sync**: WhatsApp Web loads ALL your groups & contacts into browser memory
3. **Read**: whatsapp-web.js reads that memory to get groups/chats
4. **Commands**: You send commands → bot processes → executes action
5. **Send**: Bot types into WhatsApp Web input box → message sent

### The Bot is Essentially:
- **You** logged into WhatsApp Web
- **Controlled** by code instead of human clicks
- **Automated** to do repetitive messaging tasks

---

## Common Questions

**Q: Do I need to scan QR every time?**
A: No - session is saved in `.wwebjs_auth/`

**Q: Can I track who read group messages?**
A: No - only know IF read, not WHO or how many

**Q: Can I see all message history?**
A: No - only recent messages synced to Web

**Q: Is this against WhatsApp ToS?**
A: Yes - unofficial API use can lead to temporary bans

---

*Created for educational purposes to understand how WhatsApp automation bots work.*
