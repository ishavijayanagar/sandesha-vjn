const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Shutting down gracefully...');
  if (pollInterval) clearInterval(pollInterval);
  if (schedulerInterval) clearInterval(schedulerInterval);
  console.log('[SHUTDOWN] Cleanup complete. Goodbye!');
  process.exit(0);
});

const SESSION_PATH = path.join(__dirname, '.wwebjs_auth');
const QR_PATH = path.join(__dirname, 'qr-code.png');
const GROUPS_FILE = path.join(__dirname, 'groups.json');
const SCHEDULES_FILE = path.join(__dirname, 'schedules.json');
const NOTIFY_FILE = path.join(__dirname, 'notifications.log');
const MEDIA_DIR = path.join(__dirname, 'media');
const LOG_FILE = path.join(__dirname, 'sandesha.log');
const ZC_WEBHOOK = 'http://127.0.0.1:42617/webhook';
const LISTEN_PORT = 42620;
const COMMANDS_GROUP_NAME = 'Me Commands';
const COMMANDS_GROUP_JID = '120363405541245636@g.us';

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

function log(...args) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${msg}`;
  console.error(logLine);
  fs.appendFileSync(LOG_FILE, logLine + '\n');
}

let lastReplyText = null;
let recentReplies = new Set();
let myNumber = null;
let commandsGroupJid = null;

function trackReply(text) {
  recentReplies.add(text);
  setTimeout(() => recentReplies.delete(text), 10000);
}

async function botReply(msg, text) {
  trackReply(text);
  lastReplyText = text;
  await msg.reply(text);
}

function loadSets() {
  try { return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')); } catch { return {}; }
}

function loadSchedules() {
  try { return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8')); } catch { return []; }
}

function saveSchedules(schedules) {
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

function loadContacts() {
  try { return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8')); } catch { return { contacts: {} }; }
}

function saveContacts(data) {
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(data, null, 2));
}

function resolveContact(name) {
  const contacts = loadContacts();
  const nameLower = name.toLowerCase();
  for (const [key, number] of Object.entries(contacts.contacts)) {
    if (key.toLowerCase() === nameLower || number.toLowerCase().includes(nameLower)) {
      return number;
    }
  }
  return null;
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  }
});

client.on('qr', async (qr) => {
  await QRCode.toFile(QR_PATH, qr, { width: 400 });
  log('QR saved to', QR_PATH);
  console.log('\n📱 Scan QR code with WhatsApp:\n');
  const qrcode = require('qrcode-terminal');
  qrcode.generate(qr, { small: true });
  console.log('\nOr open:', QR_PATH, '\n');
});

client.on('authenticated', () => log('Authenticated'));

client.on('ready', async () => {
  log('WhatsApp connected');
  myNumber = client.info?.wid?._serialized || null;
  log('My number:', myNumber);
  
  log('Setting up commands group...');
  await setupCommandsGroup();
  log('Starting send server...');
  startSendServer();
  log('Starting message poller...');
  startMessagePoller();
  log('Starting scheduler...');
  startScheduler();
  log('Setup complete!');
});

const STATE_FILE = path.join(__dirname, 'state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      console.log(`[STATE] Loaded lastProcessedTimestamp: ${data.lastProcessedTimestamp}`);
      return data;
    }
  } catch (e) {
    console.log(`[STATE] Error loading: ${e.message}`);
  }
  const ts = Math.floor(Date.now() / 1000);
  console.log(`[STATE] Using current timestamp: ${ts}`);
  return { lastProcessedTimestamp: ts };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const initialState = loadState();
let lastProcessedTimestamp = initialState.lastProcessedTimestamp;
let pollInterval = null;
let isInitializing = false;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;

// Clear recentReplies periodically to prevent memory leak
setInterval(() => {
  if (recentReplies.size > 100) {
    recentReplies.clear();
  }
}, 60000);

function saveTimestamp() {
  saveState({ lastProcessedTimestamp });
  console.log(`[STATE] Saved lastProcessedTimestamp: ${lastProcessedTimestamp}`);
}

function startMessagePoller() {
  if (pollInterval) return;
  console.error('[POLL] Starting message poller');
  pollInterval = setInterval(async () => {
    if (!commandsGroupJid) {
      console.log('[POLL] No commandsGroupJid, skipping');
      return;
    }
    console.log('[POLL] Checking for messages...');
    try {
      const chat = await Promise.race([
        client.getChatById(commandsGroupJid),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getChat timeout')), 5000))
      ]);
      if (!chat) {
        console.log('[POLL] Chat not found');
        return;
      }
      
      const messages = await Promise.race([
        chat.fetchMessages({ limit: 20 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('fetchMessages timeout')), 5000))
      ]);
      
      console.log(`[POLL] Got ${messages.length} messages`);
       
      for (const msg of messages) {
        // Track ALL messages (both phone and web) to avoid reprocessing
        if (msg.timestamp > lastProcessedTimestamp) {
          // NEW message - process it
          console.log(`[POLL] NEW msg: fromMe=${msg.fromMe}, timestamp=${msg.timestamp}, body="${msg.body?.substring(0, 30)}"`);
          
          // Skip if already replied recently (prevent infinite loop)
          if (recentReplies.has(msg.body?.trim())) {
            console.log(`[POLL] SKIP: in recentReplies`);
            lastProcessedTimestamp = msg.timestamp;
            saveTimestamp();
            continue;
          }
          
          // Process the message
          lastProcessedTimestamp = msg.timestamp;
          saveTimestamp();
          
          const hasMedia = msg.hasMedia;
          
          if (hasMedia) {
            await handleMediaMessage(msg);
          } else if (msg.body?.startsWith('!')) {
            await handleCommand(msg.body, msg);
          } else {
            // Check for natural scheduling first
            const scheduleIdx = msg.body.indexOf(' !schedule');
            if (scheduleIdx > 0) {
              const messagePart = msg.body.substring(0, scheduleIdx).trim();
              const schedulePart = msg.body.substring(scheduleIdx + 2).trim();
              await handleNaturalSchedule(messagePart, schedulePart, msg);
            } else {
              const parsed = await parseNaturalCommand(msg.body);
              if (parsed) {
                await executeSend(parsed, msg);
              } else {
                await handleAIChat(msg.body, msg);
              }
            }
          }
        } else {
          console.log(`[POLL] OLD msg: timestamp=${msg.timestamp} <= lastProcessedTimestamp=${lastProcessedTimestamp}, skipping`);
        }
      }
    } catch (err) {
      console.error(`[POLL ERROR] ${err.message}`);
    }
  }, 5000);
}

async function handleMediaMessage(msg) {
  try {
    log('HANDLE-MEDIA called');
    const media = await msg.downloadMedia();
    log('Media downloaded:', media ? 'success' : 'failed');
    if (!media) { await botReply(msg, 'Failed to download media'); return; }
    
    const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
    const filename = `media_${Date.now()}.${ext}`;
    const filepath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
    log('Media saved to:', filepath);
    
    const body = msg.body?.trim();
    log('Media caption:', body);
    if (!body) {
      await botReply(msg, 'Media received. Add a caption like "send to family" or "send to Group1"');
      return;
    }
    
    const parsed = await parseNaturalCommand(body);
    log('Parsed:', parsed);
    if (parsed) {
      // parsed.message is already "hi" - don't override with full caption
      await executeMediaSend(parsed, media, filename, msg);
    } else {
      await botReply(msg, `Don't understand "${body}". Try: "send to family" or "send to Group1"`);
    }
  } catch (err) {
    console.error(`Media error: ${err.message}`);
    await botReply(msg, `Error: ${err.message}`);
  }
}

async function executeMediaSend(parsed, media, filename, msg) {
  try {
    const msgMedia = new MessageMedia(media.mimetype, media.data, filename);
    const sets = loadSets();
    
    if (parsed.isAll) {
      const groups = sets.all || [];
      if (groups.length === 0) { await botReply(msg, 'No groups in "all" set'); return; }
      await botReply(msg, `Sending media to ${groups.length} groups... (2s delay between each)`);
      for (let i = 0; i < groups.length; i++) {
        await resolveAndSendMedia(groups[i], msgMedia, parsed.message);
        if (i < groups.length - 1) {
          await delay(2000); // 2 second delay
        }
      }
      await botReply(msg, `Sent media to ${groups.length} groups ✅`);
      return;
    }
    
    const setGroups = sets[parsed.target.toLowerCase()];
    if (setGroups) {
      await botReply(msg, `Sending media to ${setGroups.length} groups... (2s delay between each)`);
      for (let i = 0; i < setGroups.length; i++) {
        await resolveAndSendMedia(setGroups[i], msgMedia, parsed.message);
        if (i < setGroups.length - 1) {
          await delay(2000); // 2 second delay
        }
      }
      await botReply(msg, `Sent media to ${setGroups.length} groups in "${parsed.target}" ✅`);
      return;
    }
    
    const chats = await client.getChats();
    const group = chats.find(c => c.isGroup && c.name.toLowerCase() === parsed.target.toLowerCase());
    if (group) {
      await resolveAndSendMedia(group.id._serialized, msgMedia, parsed.message);
      await botReply(msg, `Sent media to ${group.name}`);
      return;
    }
    
    await botReply(msg, `Target "${parsed.target}" not found. Use !groups to see available groups.`);
  } catch (err) {
    await botReply(msg, `Error: ${err.message}`);
  }
}

async function resolveAndSendMedia(target, media, caption) {
  let jid = target;
  if (!target.includes('@')) {
    const chats = await client.getChats();
    const targetLower = removeEmojis(target).toLowerCase();
    
    // Exact match first
    let group = chats.find(c => c.isGroup && removeEmojis(c.name).toLowerCase() === targetLower);
    
    // If no exact match, try partial match
    if (!group) {
      group = chats.find(c => c.isGroup && removeEmojis(c.name).toLowerCase().includes(targetLower));
    }
    
    // Try the other way around
    if (!group) {
      group = chats.find(c => c.isGroup && targetLower.includes(removeEmojis(c.name).toLowerCase()));
    }
    
    if (group) { jid = group.id._serialized; }
    else { throw new Error(`Group "${target}" not found`); }
  }
  const chat = await client.getChatById(jid);
  if (!chat) throw new Error(`Chat not found`);
  await chat.sendMessage(media, { caption: caption || '' });
  console.log(`Sent media to ${chat.name || jid}: ${caption || '(no caption)'}`);
}

client.on('disconnected', (reason) => {
  console.error(`[${new Date().toISOString()}] Disconnected: ${reason}`);
  
  if (isInitializing) return;
  
  if (reconnectAttempts >= MAX_RECONNECT) {
    console.error(`[${new Date().toISOString()}] Max reconnect attempts (${MAX_RECONNECT}) reached, exiting...`);
    process.exit(1);
  }
  
  reconnectAttempts++;
  console.error(`[${new Date().toISOString()}] Reconnecting... (attempt ${reconnectAttempts}/${MAX_RECONNECT})`);
  
  isInitializing = true;
  setTimeout(() => {
    client.initialize();
    isInitializing = false;
  }, 5000);
});

async function setupCommandsGroup() {
  try {
    // Use pre-set Me Commands group
    commandsGroupJid = COMMANDS_GROUP_JID;
    console.error(`[${new Date().toISOString()}] Using pre-set Me Commands group: ${commandsGroupJid}`);
    
    // Optionally verify the group exists
    const chat = await client.getChatById(commandsGroupJid);
    if (chat) {
      console.error(`[${new Date().toISOString()}] Me Commands group verified: ${chat.name}`);
    } else {
      console.error(`[${new Date().toISOString()}] Warning: Me Commands group not found`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Setup error: ${err.message}`);
    console.error(`[${new Date().toISOString()}] Skipping group setup, will retry later`);
  }
}

function handleIncomingMessage(msg) {
  return new Promise(async (resolve) => {
    try {
      if (!msg.body || msg.body.trim().length === 0) { resolve(); return; }
      if (msg.from === 'status@broadcast') { resolve(); return; }

      const isFromMe = msg.fromMe;
      const chat = await msg.getChat();

      log(`MSG fromMe=${isFromMe} from=${msg.from} chat=${chat.name} body="${msg.body?.substring(0, 80)}" hasMedia=${msg.hasMedia}`);

      // Skip messages from others (we only process commands sent through this WhatsApp Web session)
      if (!isFromMe) { resolve(); return; }

      if (!commandsGroupJid) { resolve(); return; }
      
      // Check if from Me Commands group
      const isFromCommandsGroup = 
        msg.from === commandsGroupJid ||
        chat.name === COMMANDS_GROUP_NAME ||
        (chat.isGroup && chat.name.toLowerCase() === COMMANDS_GROUP_NAME.toLowerCase());
      
      if (!isFromCommandsGroup) { resolve(); return; }

      // Skip bot's own replies (prevent infinite loops)
      if (recentReplies.has(msg.body.trim())) {
        log('SKIP: Bot reply message');
        resolve(); return;
      }
      
      // Skip if this is the bot's own message (prevent infinite loops)
      const now = Math.floor(Date.now() / 1000);
      if (msg.timestamp && (now - msg.timestamp) < 5) {
        // Message sent less than 5 seconds ago - likely our own
        if (msg.timestamp <= lastProcessedTimestamp) {
          log('SKIP: Bot own message (recent)');
          resolve(); return;
        }
      }
      
      if (msg.timestamp && msg.timestamp <= lastProcessedTimestamp) { resolve(); return; }

      // Mark as processed so poller doesn't pick it up again
      if (msg.timestamp) lastProcessedTimestamp = msg.timestamp;

      // Check for media first
      const mtype = msg._data?.mtype;
      const hasMedia = msg.hasMedia || mtype === 'imageMessage' || mtype === 'videoMessage' || mtype === 'documentMessage';
      log(`MEDIA-CHECK hasMedia=${hasMedia} mtype=${mtype}`);
      
      if (hasMedia) {
        await handleMediaMessage(msg);
        resolve(); return;
      }
      
      if (!msg.body || msg.body.trim().length === 0) { resolve(); return; }

      if (lastReplyText && msg.body.trim() === lastReplyText.trim()) {
        log('SKIP: Same as last reply');
        lastReplyText = null;
        resolve();
        return;
      }

      // Check for natural scheduling: "message !schedule to group at time"
      const scheduleIdx = msg.body.indexOf(' !schedule');
      if (scheduleIdx > 0) {
        const messagePart = msg.body.substring(0, scheduleIdx).trim();
        const schedulePart = msg.body.substring(scheduleIdx + 2).trim(); // +2 to skip " !"
        console.log(`[SCHEDULE-NL] message: "${messagePart.substring(0, 50)}", schedule: "${schedulePart.substring(0, 50)}"`);
        await handleNaturalSchedule(messagePart, schedulePart, msg);
        resolve();
        return;
      }

      if (msg.body.startsWith('!')) {
        await handleCommand(msg.body, msg);
      } else {
        const parsed = await parseNaturalCommand(msg.body);
        if (parsed) {
          await executeSend(parsed, msg);
        } else {
          await handleAIChat(msg.body, msg);
        }
      }
      resolve();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error:`, err.message);
      resolve();
    }
  });
}

// Message events handled by poller only (to prevent duplicates)
// client.on('message', (msg) => { handleIncomingMessage(msg); });

async function handleCommand(text, msg) {
  const raw = text.trim().slice(1).trim();
  console.log(`[COMMAND] raw: "${raw.substring(0, 100)}"`);
  
  if (raw === 'ai' || raw.startsWith('ai ')) {
    const prompt = raw.replace(/^ai\s+/i, '').trim();
    await handleAIChat(prompt || 'hello', msg);
    return;
  }

  if (raw === 'sets') {
    const sets = loadSets();
    const keys = Object.keys(sets);
    if (keys.length === 0) { await botReply(msg, 'No sets defined'); return; }
    let reply = 'Group Sets:\n';
    for (const [name, groups] of Object.entries(sets)) { reply += `• ${name}: ${groups.join(', ')}\n`; }
    await botReply(msg, reply);
    return;
  }

  if (raw === 'groups') {
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup);
    if (groups.length === 0) { await botReply(msg, 'No groups found'); return; }
    
    let reply = `📱 *Groups (${groups.length})*\n━━━━━━━━━━━━━━━━━━━━\n`;
    let activeCount = 0;
    let inactiveCount = 0;
    
    for (const g of groups.slice(0, 20)) {
      try {
        const messages = await Promise.race([
          g.fetchMessages({ limit: 1 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        const lastActive = messages.length > 0 ? formatTimeAgo(messages[0].timestamp) : 'Never';
        const daysInactive = messages.length > 0 ? Math.floor((Math.floor(Date.now() / 1000) - messages[0].timestamp) / 86400) : 999;
        const status = daysInactive > 30 ? '🔴' : daysInactive > 7 ? '🟡' : '🟢';
        if (daysInactive > 30) inactiveCount++; else activeCount++;
        
        reply += `${status} ${g.name}\n   Last: ${lastActive}\n`;
      } catch (e) {
        reply += `⚪ ${g.name}\n   Last: Unknown\n`;
      }
    }
    
    if (groups.length > 20) {
      reply += `\n...and ${groups.length - 20} more groups. Use !inactive to see all.\n`;
    }
    
    reply += `\n━━━━━━━━━━━━━━━━━━━━\n🟢 ${activeCount} active  🔴 ${inactiveCount} inactive (30+ days)`;
    await botReply(msg, reply);
    return;
  }

  // Find member in groups
  if (raw.startsWith('find ') || raw.startsWith('member ') || raw.startsWith('search ')) {
    const searchName = raw.replace(/^(find|member|search)\s+/i, '').trim();
    if (!searchName) {
      await botReply(msg, 'Usage: !find <name>\nExample: !find Veena amma');
      return;
    }
    
    await botReply(msg, `Searching for "${searchName}" in groups...`);
    
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup);
    const found = [];
    
    for (const g of groups) {
      try {
        await g.fetchParticipants();
        const participants = g.participants || [];
        for (const p of participants) {
          const name = p.name || p.shortName || '';
          if (name.toLowerCase().includes(searchName.toLowerCase())) {
            found.push({ group: g.name, name });
          }
        }
      } catch (e) {
        // Skip groups we can't access
      }
    }
    
    if (found.length === 0) {
      await botReply(msg, `No groups found with member matching "${searchName}"`);
      return;
    }
    
    let reply = `Found "${searchName}" in ${found.length} group(s):\n`;
    for (const f of found.slice(0, 20)) {
      reply += `• ${f.name} in "${f.group}"\n`;
    }
    if (found.length > 20) {
      reply += `\n...and ${found.length - 20} more.`;
    }
    await botReply(msg, reply);
    return;
  }

  // Check inactive groups
  if (raw.startsWith('inactive') || raw.startsWith('inactive ')) {
    await botReply(msg, 'Checking inactive groups... (this may take a moment)');
    let days = 30; // default 30 days
    const match = raw.match(/inactive\s+(\d+)/i);
    if (match) days = parseInt(match[1]);
    
    const cutoffTime = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup);
    
    let inactiveGroups = [];
    let checked = 0;
    
    for (const g of groups) {
      try {
        const messages = await g.fetchMessages({ limit: 1 });
        if (messages.length === 0 || messages[0].timestamp < cutoffTime) {
          inactiveGroups.push({
            name: g.name,
            lastActive: messages.length > 0 ? formatTimeAgo(messages[0].timestamp) : 'Never',
            jid: g.id._serialized
          });
        }
        checked++;
        if (checked % 10 === 0) {
          await botReply(msg, `Progress: checked ${checked}/${groups.length} groups...`);
        }
      } catch (e) {
        // Skip groups we can't access
      }
    }
    
    if (inactiveGroups.length === 0) {
      await botReply(msg, `All groups have been active in the last ${days} days! 🎉`);
      return;
    }
    
    let reply = `Inactive groups (no activity in ${days}+ days):\n`;
    for (const g of inactiveGroups.slice(0, 20)) {
      reply += `• ${g.name}\n  Last: ${g.lastActive}\n`;
    }
    if (inactiveGroups.length > 20) {
      reply += `\n...and ${inactiveGroups.length - 20} more.`;
    }
    reply += `\n\nTotal: ${inactiveGroups.length} inactive groups`;
    await botReply(msg, reply);
    return;
  }

  // Schedule command
  if (raw.startsWith('schedule') || raw.startsWith('remind')) {
    await handleSchedule(raw, msg);
    return;
  }

  // List schedules
  if (raw === 'schedules' || raw === 'reminders') {
    const schedules = loadSchedules();
    if (schedules.length === 0) {
      await botReply(msg, 'No scheduled messages. Use !schedule <msg> to <target> at <time>');
      return;
    }
    let reply = `Scheduled messages (${schedules.length}):\n`;
    schedules.forEach((s, i) => {
      const nextRun = new Date(s.runAt).toLocaleString();
      reply += `${i + 1}. "${s.message}" → ${s.target}\n   At: ${nextRun}\n`;
    });
    await botReply(msg, reply);
    return;
  }

  // Cancel schedule
  if (raw.startsWith('cancel') || raw.startsWith('delete')) {
    const schedules = loadSchedules();
    if (schedules.length === 0) {
      await botReply(msg, 'No scheduled messages to cancel.');
      return;
    }
    // Cancel last schedule by default
    const removed = schedules.pop();
    saveSchedules(schedules);
    await botReply(msg, `Cancelled: "${removed.message}" → ${removed.target}`);
    return;
  }

  // Add contact: !addcontact name +919344915049
  if (raw.startsWith('addcontact ') || raw.startsWith('add contact ')) {
    const parts = raw.replace(/^(addcontact|add contact)\s+/i, '').split(/\s+/);
    if (parts.length < 2) {
      await botReply(msg, 'Usage: !addcontact <name> <number>\nExample: !addcontact John +919344915049');
      return;
    }
    const name = parts[0];
    const number = parts[1];
    const contacts = loadContacts();
    contacts.contacts[name] = number;
    saveContacts(contacts);
    await botReply(msg, `Added contact: ${name} → ${number}`);
    return;
  }

  // List contacts
  if (raw === 'contacts' || raw === 'contact') {
    const contacts = loadContacts();
    const keys = Object.keys(contacts.contacts);
    if (keys.length === 0) {
      await botReply(msg, 'No contacts saved.\nUse: !addcontact <name> <number>');
      return;
    }
    let reply = 'Contacts:\n';
    for (const [name, number] of Object.entries(contacts.contacts)) {
      reply += `• ${name}: ${number}\n`;
    }
    await botReply(msg, reply);
    return;
  }

  if (raw === 'help') {
    const help = `━━━━━━━━━━━━━━━━━━━━
📝 Natural Messaging
━━━━━━━━━━━━━━━━━━━━
Just type naturally:
• "hi family" → send to family
• "send hi to hebbal" → send to hebbal
• "say hi to all" → broadcast to all

━━━━━━━━━━━━━━━━━━━━
⚡ Commands
━━━━━━━━━━━━━━━━━━━━
🎨 !ai <text>      - Chat with AI
📤 !send <t> <msg> - Send to target
📢 !all <msg>      - Broadcast to all
📋 !sets           - List group sets
📱 !groups         - List all groups
👥 !members <name> - List group members
🔍 !find <name>   - Find member in groups
📊 !inactive [d]  - Show inactive groups
📅 !schedules      - List scheduled msgs
❌ !cancel         - Cancel last schedule
👤 !contacts       - List saved contacts
  ➕ !addcontact <n> <num> - Add contact
🔎 !track <msg>   - Track replies
📋 !replies       - Show tracked replies
👁️ !seen <msg>   - Track who read your msg
🆘 !help           - Show this help

━━━━━━━━━━━━━━━━━━━━
📅 Scheduling
━━━━━━━━━━━━━━━━━━━━
Format: <msg> !schedule to <target> at <time>
Example: Hello !schedule to family at 9am`;
    await botReply(msg, help);
    return;
  }

  const parsed = await parseNaturalCommand(raw);
  if (parsed) {
    await executeSend(parsed, msg);
    return;
  }

  await botReply(msg, `Unknown command: !${raw.split(' ')[0]}\nType !help`);
}

async function parseNaturalCommand(input) {
  const sets = loadSets();
  const words = input.split(/\s+/);
  
  if (words.length < 2) return null;

  const sendVerbs = ['send', 'say', 'tell', 'broadcast', 'msg', 'message', 'this', 'it'];
  const prepWords = ['to', 'in', 'for', 'at'];
  const allKeywords = ['everyone', 'all', 'all groups', 'everybody'];

  for (const prep of prepWords) {
    const prepIndex = words.findIndex(w => w.toLowerCase() === prep);
    if (prepIndex > 0 && prepIndex < words.length - 1) {
      let message = words.slice(0, prepIndex).join(' ');
      const targetRaw = words.slice(prepIndex + 1).join(' ');
      const result = await resolveTarget(targetRaw, sets);
      if (result) {
        message = cleanMessage(message, sendVerbs);
        return { target: result, message: message.trim(), isAll: allKeywords.includes(result.toLowerCase()) };
      }
    }
  }

  for (let i = words.length - 1; i >= 1; i--) {
    const possibleTarget = words.slice(i).join(' ');
    const result = await resolveTarget(possibleTarget, sets);
    if (result) {
      let message = words.slice(0, i).join(' ');
      message = cleanMessage(message, sendVerbs);
      if (!message.trim()) continue;
      return { target: result, message: message.trim(), isAll: allKeywords.includes(result.toLowerCase()) };
    }
  }

  return null;
}

function cleanMessage(message, verbs) {
  const lower = message.toLowerCase().trim();
  for (const v of verbs) {
    if (lower === v) return '';
    if (lower.startsWith(v + ' ')) return message.substring(v.length + 1);
    if (lower.startsWith('please ' + v + ' ')) return message.substring(('please ' + v).length + 1);
  }
  return message;
}

async function resolveTarget(name, sets) {
  const lower = name.toLowerCase();
  if (['everyone', 'all', 'all groups', 'everybody'].includes(lower)) return 'all';
  if (sets[lower]) return lower;
  
  // Check contacts
  const contactNumber = resolveContact(lower);
  if (contactNumber) return contactNumber;
  
  try {
    const chats = await client.getChats();
    const found = chats.find(c => c.isGroup && c.name.toLowerCase() === lower);
    if (found) return found.name;
  } catch (e) { /* ignore */ }
  return null;
}

async function executeSend(parsed, msg) {
  try {
    const sets = loadSets();
    
    if (parsed.isAll) {
      const groups = sets.all || [];
      if (groups.length === 0) { await botReply(msg, 'No groups in "all" set'); return; }
      await botReply(msg, `Sending to ${groups.length} groups... (with 2s delay between each)`);
      for (let i = 0; i < groups.length; i++) {
        await resolveAndSend(groups[i], parsed.message);
        if (i < groups.length - 1) {
          await delay(2000); // 2 second delay between messages
        }
      }
      await botReply(msg, `Sent to ${groups.length} groups ✅`);
      return;
    }

    const setGroups = sets[parsed.target.toLowerCase()];
    if (setGroups) {
      await botReply(msg, `Sending to ${setGroups.length} groups... (with 2s delay between each)`);
      for (let i = 0; i < setGroups.length; i++) {
        await resolveAndSend(setGroups[i], parsed.message);
        if (i < setGroups.length - 1) {
          await delay(2000); // 2 second delay between messages
        }
      }
      await botReply(msg, `Sent to ${setGroups.length} groups in "${parsed.target}" ✅`);
      return;
    }

    const chats = await client.getChats();
    const group = chats.find(c => c.isGroup && c.name.toLowerCase() === parsed.target.toLowerCase());
    if (group) {
      await resolveAndSend(group.id._serialized, parsed.message);
      await botReply(msg, `Sent to ${group.name}`);
      return;
    }

    if (/^\+?\d{10,15}$/.test(parsed.target)) {
      const jid = `${parsed.target.replace(/\D/g, '')}@s.whatsapp.net`;
      await resolveAndSend(jid, parsed.message);
      await botReply(msg, `Sent to ${parsed.target}`);
      return;
    }

    await botReply(msg, `Target "${parsed.target}" not found. Use !groups to see available groups, or !sets for sets.`);
  } catch (err) {
    console.error(`Execute send error: ${err.message}`);
    await botReply(msg, `Error: ${err.message}`);
  }
}

async function sendToTarget(target, message, msg, silent = false) {
  try {
    const sets = loadSets();
    const setGroups = sets[target.toLowerCase()];
    if (setGroups) {
      console.log(`Sending to set "${target}" (${setGroups.length} groups)`);
      for (const g of setGroups) { await resolveAndSend(g, message); }
      if (!silent) { await botReply(msg, `Sent to ${setGroups.length} groups`); }
      return;
    }

    if (/^\+?\d{10,15}$/.test(target)) {
      const jid = `${target.replace('+', '')}@s.whatsapp.net`;
      await resolveAndSend(jid, message);
      if (!silent) { await botReply(msg, `Sent to ${target}`); }
      return;
    }

    await resolveAndSend(target, message);
    if (!silent) { await botReply(msg, `Sent to ${target}`); }
  } catch (err) {
    console.error(`Send error: ${err.message}`);
    if (!silent) { await botReply(msg, `Error: ${err.message}`); }
  }
}

function removeEmojis(str) {
  return str.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
}

async function resolveAndSend(target, message) {
  let jid = target;
  console.error(`[SEND] Target: ${target}, Message: "${message.substring(0, 50)}"`);
  
  if (!target.includes('@')) {
    // Check if it's a phone number
    if (/^\+?\d{10,15}$/.test(target)) {
      jid = `${target.replace(/\D/g, '')}@s.whatsapp.net`;
      console.error(`[SEND] Resolved to phone JID: ${jid}`);
    } else {
      // It's a group name
      const chats = await client.getChats();
      const targetLower = removeEmojis(target).toLowerCase();
    
    // Exact match first
    let group = chats.find(c => c.isGroup && removeEmojis(c.name).toLowerCase() === targetLower);
    
    // If no exact match, try partial match
    if (!group) {
      group = chats.find(c => c.isGroup && removeEmojis(c.name).toLowerCase().includes(targetLower));
    }
    
    // If still no match, try the other way around (target includes group name)
    if (!group) {
      group = chats.find(c => c.isGroup && targetLower.includes(removeEmojis(c.name).toLowerCase()));
    }
    
    if (group) { 
      jid = group.id._serialized;
      console.error(`[SEND] Resolved to group: ${group.name} (${jid})`);
    }
    else { throw new Error(`Group "${target}" not found`); }
    }
  }
  
  const chat = await client.getChatById(jid);
  if (!chat) throw new Error(`Chat not found`);
  console.error(`[SEND] Sending to chat: ${chat.name || jid}`);
  await chat.sendMessage(message);
  console.error(`[SEND] ✅ Sent to ${chat.name || jid}: "${message.substring(0, 50)}"`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function handleAIChat(text, msg) {
  console.log(`[AI-CHAT] ${text}`);
  const reply = await forwardToZeroClaw(text);
  if (reply) {
    await botReply(msg, reply);
    console.log(`[AI-REPLY] ${reply.substring(0, 100)}`);
  }
}

function forwardToZeroClaw(message) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ message });
    const req = http.request({
      hostname: '127.0.0.1', port: 42617, path: '/webhook', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data).response); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

function startSendServer() {
  const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);

    if (req.method === 'POST' && parsed.pathname === '/send') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { recipient, message, jid } = JSON.parse(body);
          let target = jid || recipient;
          if (!target || !message) { res.writeHead(400); res.end('{}'); return; }
          await resolveAndSend(target, message);
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/send-media') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { recipient, filePath, caption, jid } = JSON.parse(body);
          let target = jid || recipient;
          if (!target || !filePath) { res.writeHead(400); res.end('{}'); return; }
          if (!target.includes('@')) {
            const chats = await client.getChats();
            const group = chats.find(c => c.isGroup && c.name.toLowerCase() === target.toLowerCase());
            if (group) target = group.id._serialized;
          }
          const chat = await client.getChatById(target);
          if (!chat) { res.writeHead(404); res.end('{}'); return; }
          const media = MessageMedia.fromFilePath(filePath);
          await chat.sendMessage(media, { caption: caption || '' });
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/groups') {
      try {
        const chats = await client.getChats();
        const groups = chats.filter(c => c.isGroup).map(g => ({
          name: g.name, jid: g.id._serialized, participants: g.participants?.length || 0
        }));
        res.writeHead(200); res.end(JSON.stringify(groups));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/health') {
      res.writeHead(200); res.end(JSON.stringify({ 
        status: 'ok', 
        info: client.info,
        commandsGroup: commandsGroupJid,
        commandsGroupName: COMMANDS_GROUP_NAME
      }));
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/chats') {
      try {
        const limit = parseInt(parsed.query.limit) || 20;
        const chats = await client.getChats();
        const sorted = chats.sort((a, b) => (b.pinned || 0) - (a.pinned || 0));
        const page = sorted.slice(0, limit);
        res.writeHead(200); res.end(JSON.stringify({
          total: chats.length,
          chats: page.map(c => ({ name: c.name, jid: c.id._serialized, isGroup: c.isGroup }))
        }));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    res.writeHead(404); res.end('Not found');
  });

  server.listen(LISTEN_PORT, '127.0.0.1', () => {
    console.error(`[${new Date().toISOString()}] Send server on http://127.0.0.1:${LISTEN_PORT}`);
    console.error(`[${new Date().toISOString()}] =========================================`);
    console.error(`[${new Date().toISOString()}] IMPORTANT: Join the "Me Commands" group on WhatsApp to send bot commands!`);
    console.error(`[${new Date().toISOString()}] =========================================`);
  });
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)} weeks ago`;
  return `${Math.floor(seconds / 2592000)} months ago`;
}

async function handleNaturalSchedule(message, schedulePart, msg) {
  // Parse: schedule to <target> at <time>
  // schedulePart is like "schedule to family at 9am tomorrow"
  
  const match = schedulePart.match(/^schedule\s+to\s+(\S+)\s+at\s+(.+)$/i);
  if (!match) {
    await botReply(msg, `Usage: <message> !schedule to <target> at <time>
Example: Hello everyone !schedule to family at 9am tomorrow`);
    return;
  }
  
  const target = match[1].trim();
  const timeStr = match[2].trim();
  
  const runAt = parseScheduleTime(timeStr);
  if (!runAt) {
    await botReply(msg, `Could not understand time: "${timeStr}"
Try: 9am, 9:30am, 9am tomorrow, 9am monday`);
    return;
  }
  
  const schedule = {
    id: Date.now(),
    message,
    target,
    runAt: runAt.toISOString(),
    createdAt: new Date().toISOString()
  };
  
  const schedules = loadSchedules();
  schedules.push(schedule);
  saveSchedules(schedules);
  
  const timeUntil = formatTimeUntil(runAt);
  await botReply(msg, `Scheduled! ✅
"${message}" → ${target}
Will send: ${runAt.toLocaleString()}
(${timeUntil})`);
}

async function handleSchedule(raw, msg) {
  // Parse: !schedule <message> to <target> at <time>
  // Or: !remind <message> to <target> at <time>
  const text = raw.replace(/^(schedule|remind)\s+/i, '');
  
  // Find " at " (with spaces) to separate message+target from time
  // Use lastIndexOf to handle messages that contain " at "
  const atIndex = text.lastIndexOf(' at ');
  if (atIndex === -1) {
    await botReply(msg, `Usage: !schedule <msg> to <target> at <time>
Example: !schedule hello to family at 9am tomorrow
Example: !schedule good morning to everyone at 8am`);
    return;
  }
  
  const beforeAt = text.substring(0, atIndex);
  const timeStr = text.substring(atIndex + 4).trim();
  
  // Now find " to " to separate message from target
  const toIndex = beforeAt.lastIndexOf(' to ');
  if (toIndex === -1) {
    await botReply(msg, `Usage: !schedule <msg> to <target> at <time>
Example: !schedule hello to family at 9am tomorrow`);
    return;
  }
  
  const message = beforeAt.substring(0, toIndex).trim();
  const target = beforeAt.substring(toIndex + 4).trim();
  
  if (!message || !target) {
    await botReply(msg, `Usage: !schedule <msg> to <target> at <time>`);
    return;
  }
  
  const runAt = parseScheduleTime(timeStr);
  if (!runAt) {
    await botReply(msg, `Could not understand time: "${timeStr}"
Try: 9am, 9:30am, 9am tomorrow, 9am monday, 14:30`);
    return;
  }
  
  const schedule = {
    id: Date.now(),
    message,
    target,
    runAt: runAt.toISOString(),
    createdAt: new Date().toISOString()
  };
  
  const schedules = loadSchedules();
  schedules.push(schedule);
  saveSchedules(schedules);
  
  const timeUntil = formatTimeUntil(runAt);
  await botReply(msg, `Scheduled! ✅
"${message}" → ${target}
Will send: ${runAt.toLocaleString()}
(${timeUntil})`);
}

function parseScheduleTime(timeStr) {
  const now = new Date();
  let lower = timeStr.toLowerCase().trim();
  
  // Remove day names and today/tomorrow to get just the time
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  for (const day of days) {
    if (lower.includes(day)) {
      lower = lower.replace(new RegExp(day, 'gi'), '').trim();
    }
  }
  lower = lower.replace(/\btoday\b/gi, '').trim();
  lower = lower.replace(/\btomorrow\b/gi, '').trim();
  lower = lower.replace(/\s+/g, ' ').trim();
  
  // "daily at 9am" or "every day at 9am"
  if (lower.startsWith('daily') || lower.startsWith('every day')) {
    const timeMatch = lower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3]?.toLowerCase();
      if (period === 'pm' && hours < 12) hours += 12;
      if (period === 'am' && hours === 12) hours = 0;
      
      const next = new Date();
      next.setHours(hours, minutes, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    }
  }
  
  // Specific time: "9am", "9:30am", "14:30", "4.47am" (4.47 = 4:47), "6am" (no separator)
  const timeMatch = lower.match(/^(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?$/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const period = timeMatch[3]?.toLowerCase();
    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    
    const result = new Date();
    result.setHours(hours, minutes, 0, 0);
    
    if (result <= now) {
      result.setDate(result.getDate() + 1);
    }
    
    // Check for today, tomorrow, monday, etc.
    if (lower.includes('today')) {
      // Keep same day
    } else if (lower.includes('tomorrow')) {
      result.setDate(result.getDate() + 1);
    } else if (lower.includes('monday')) {
      const daysUntil = (8 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('tuesday')) {
      const daysUntil = (9 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('wednesday')) {
      const daysUntil = (10 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('thursday')) {
      const daysUntil = (11 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('friday')) {
      const daysUntil = (12 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('saturday')) {
      const daysUntil = (13 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('sunday')) {
      const daysUntil = (14 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    }
    
    return result;
  }
  
  // Date format: "march 30", "30 march", "march 30 at 9am"
  const dateMatch = lower.match(/(\w+)\s+(\d{1,2})(?:\s+at\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?)?/);
  if (dateMatch) {
    const monthStr = dateMatch[1];
    const day = parseInt(dateMatch[2]);
    let hours = dateMatch[3] ? parseInt(dateMatch[3]) : 9;
    let minutes = dateMatch[4] ? parseInt(dateMatch[4]) : 0;
    const period = dateMatch[5]?.toLowerCase();
    
    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const month = months.findIndex(m => monthStr.startsWith(m));
    if (month >= 0) {
      const result = new Date();
      result.setMonth(month, day);
      result.setHours(hours, minutes, 0, 0);
      if (result <= now) {
        result.setFullYear(result.getFullYear() + 1);
      }
      return result;
    }
  }
  
  return null;
}

function formatTimeUntil(date) {
  const diff = date - new Date();
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `in ${days} day${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes} min`;
}

let schedulerInterval = null;
let sentScheduleIds = new Set();

function writeNotification(text) {
  const entry = `[${new Date().toISOString()}] ${text}\n`;
  fs.appendFileSync(NOTIFY_FILE, entry);
  console.error(`[NOTIFY] ${text}`);
}

function startScheduler() {
  if (schedulerInterval) return;
  log('[SCHEDULER] Starting scheduler...');
  
  // Run once immediately
  runSchedulerCheck();
  
  schedulerInterval = setInterval(async () => {
    runSchedulerCheck();
  }, 30000);
}

async function runSchedulerCheck() {
  try {
      // Clean up old schedule IDs (older than 24 hours) to prevent memory leak
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      for (const id of sentScheduleIds) {
        if (id < oneDayAgo) sentScheduleIds.delete(id);
      }
      
      const schedules = loadSchedules();
      const now = new Date();
      console.error(`[SCHEDULER] Checking ${schedules.length} schedules at ${now.toISOString()}`);
      const pending = [];
      
      for (const schedule of schedules) {
        // Skip already sent schedules
        if (sentScheduleIds.has(schedule.id)) continue;
        
        const runAt = new Date(schedule.runAt);
        if (runAt <= now) {
          console.log(`[SCHEDULE] Sending: "${schedule.message}" to ${schedule.target}`);
          sentScheduleIds.add(schedule.id); // Mark as sent
          try {
            const sets = loadSets();
            
            // Try to resolve target
            const setGroups = sets[schedule.target.toLowerCase()];
            if (setGroups) {
              console.log(`[SCHEDULE] Sending to ${setGroups.length} groups with 2s delay...`);
              for (let i = 0; i < setGroups.length; i++) {
                await resolveAndSend(setGroups[i], schedule.message);
                if (i < setGroups.length - 1) {
                  await delay(2000); // 2 second delay
                }
              }
            } else {
              // Check if it's a contact
              const contact = resolveContact(schedule.target);
              const target = contact || schedule.target;
              await resolveAndSend(target, schedule.message);
            }
            
            // Write notification to log file instead of sending via WhatsApp
            writeNotification(`✅ Sent: "${schedule.message}" → ${schedule.target}`);
          } catch (err) {
            console.error(`[SCHEDULE ERROR] ${err.message}`);
            pending.push(schedule);
          }
        } else {
          pending.push(schedule);
        }
      }
      
      saveSchedules(pending);
    } catch (err) {
      console.error('[SCHEDULER ERROR]', err.message);
    }
}

client.initialize();
