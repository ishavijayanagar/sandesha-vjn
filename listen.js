const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const auth = require('./auth');
const { createApiHandlers } = require('./api-handlers');
const { createSettingsWizard } = require('./settings');
const { createBulkSendWizard } = require('./bulk-send');
const { createBulkAddMembersWizard } = require('./bulk-add-members');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');

// Single instance lock - prevent running bot twice
const LOCK_FILE = path.join(__dirname, '.lock');

if (fs.existsSync(LOCK_FILE)) {
  console.error('❌ Bot is already running! Delete .lock file if not.');
  process.exit(1);
}
fs.writeFileSync(LOCK_FILE, process.pid.toString());

process.on('exit', () => {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
});
process.on('SIGINT', () => {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
});

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
const DOCS_DIR = path.join(__dirname, 'docs');
const SCHEDULES_FILE = path.join(__dirname, 'schedules.json');
const NOTIFY_FILE = path.join(__dirname, 'notifications.log');
const MEDIA_DIR = path.join(__dirname, 'media');
const LOG_FILE = path.join(__dirname, 'sandesha.log');
const ZC_WEBHOOK = 'http://127.0.0.1:42617/webhook';
const LISTEN_PORT = 42620;
const COMMANDS_GROUP_NAME = 'Me Commands';
const COMMANDS_GROUP_JID = '120363426133559474@g.us';

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
let sendServer = null;
let apiHandlers = null;

const BOT_GREETING = '> Namaskaram 🙏,';

const BOT_REPLY_PREFIXES = [
  'Group Sets:',
  'Scheduled! ✅',
  'Sent to ',
  'Contacts:',
  'No groups',
  'No sets defined',
  '📱 *Groups',
  '📋 *All Groups',
  '━━━━━━━━━━━━━━━━━━━━',
  'Unknown command:',
  'Cannot schedule',
  'Usage:',
  'Added contact:',
  'Cancelled:',
  'Scheduled messages',
  'Forwarding ',
  'Sending to ',
  'Progress: checked',
  'Inactive groups',
  'All groups have been active',
];

function formatBotReply(text) {
  const body = (text || '').trim();
  if (body.startsWith(BOT_GREETING)) return body;
  return body ? `${BOT_GREETING}\n${body}` : BOT_GREETING;
}

function isBotReplyText(body) {
  if (!body) return false;
  const text = body.trim();
  if (recentReplies.has(text)) return true;
  for (const reply of recentReplies) {
    if (text.startsWith(reply) || reply.startsWith(text)) return true;
  }
  if (text.startsWith(BOT_GREETING)) return true;
  const inner = text.replace(new RegExp(`^${BOT_GREETING}\\n?`), '').trim();
  return BOT_REPLY_PREFIXES.some(prefix => inner.startsWith(prefix) || text.startsWith(prefix));
}

function trackReply(text) {
  recentReplies.add(text);
  setTimeout(() => recentReplies.delete(text), 30000);
}

async function botReply(msg, text) {
  const full = formatBotReply(text);
  trackReply(full);
  lastReplyText = full;
  await msg.reply(full);
}

function loadSets() {
  try { return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')); } catch { return {}; }
}

function saveSets(sets) {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(sets, null, 2));
}

let settingsWizard = null;
let bulkSendWizard = null;
let bulkAddMembersWizard = null;

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

// Use system Chrome/Chromium if set (required when installing with PUPPETEER_SKIP_DOWNLOAD=1).
const puppeteerExecutable =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  process.env.CHROME_PATH ||
  undefined;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
  puppeteer: {
    headless: true,
    ...(puppeteerExecutable ? { executablePath: puppeteerExecutable } : {}),
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
  apiHandlers = createApiHandlers({
    client,
    loadSchedules,
    saveSchedules,
    loadContacts,
    saveContacts,
    loadSets,
    parseScheduleTime,
    validateScheduleTarget,
    resolveAndSend,
    formatTimeAgo,
    getGroupParticipantCount,
    isAnnouncementGroup,
    getGroupTypeLabel,
    normalizePhoneDigits,
    delay,
    forwardToZeroClaw,
    MEDIA_DIR,
    log,
    resolveGroupByName,
    resolveParticipantWids,
  });
  log('Starting send server...');
  startSendServer();
  log('Starting message poller...');
  startMessagePoller();
  log('Starting scheduler...');
  startScheduler();
  settingsWizard = createSettingsWizard({ client, loadSets, saveSets, botReply, log });
  bulkSendWizard = createBulkSendWizard({ resolveAndSend, botReply, log, delay, normalizePhoneDigits });
  bulkAddMembersWizard = createBulkAddMembersWizard({
    client,
    botReply,
    log,
    normalizePhoneDigits,
    resolveGroupByName,
    resolveParticipantWids,
  });
  log('Setup complete!');
  log(`Dashboard: http://127.0.0.1:${LISTEN_PORT}/`);
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
let pollInFlight = false;
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
  log('[POLL] Starting message poller, commandsGroupJid=' + commandsGroupJid);
  pollInterval = setInterval(async () => {
    if (pollInFlight) {
      log('[POLL] Previous tick still running, skipping');
      return;
    }
    if (!commandsGroupJid) {
      log('[POLL] No commandsGroupJid, skipping');
      return;
    }
    pollInFlight = true;
    log('[POLL] Checking for messages...');
    try {
      const chat = await Promise.race([
        client.getChatById(commandsGroupJid),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getChat timeout')), 5000))
      ]);
      if (!chat) {
        log('[POLL] Chat not found');
        return;
      }
      
      const messages = await Promise.race([
        chat.fetchMessages({ limit: 20 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('fetchMessages timeout')), 5000))
      ]);
      
      log(`[POLL] Got ${messages.length} messages`);
       
      for (const msg of messages) {
        // Track ALL messages (both phone and web) to avoid reprocessing
        if (msg.timestamp > lastProcessedTimestamp) {
          // NEW message - process it
          log(`[POLL] NEW msg: fromMe=${msg.fromMe}, timestamp=${msg.timestamp}, body="${msg.body?.substring(0, 30)}"`);
          
          // Skip bot's own replies (prevent re-processing confirmations as commands)
          if (isBotReplyText(msg.body)) {
            log(`[POLL] SKIP: bot reply`);
            lastProcessedTimestamp = msg.timestamp;
            saveTimestamp();
            continue;
          }
          
          const hasMedia = msg.hasMedia;

          try {
            if (hasMedia) {
              await handleMediaMessage(msg);
            } else if (bulkAddMembersWizard && await bulkAddMembersWizard.handleSession(msg)) {
              // active !addmembers wizard
            } else if (bulkSendWizard && await bulkSendWizard.handleSession(msg)) {
              // active !bulk wizard
            } else if (settingsWizard && await settingsWizard.handleSession(msg)) {
              // active !settings wizard
            } else if (msg.body?.startsWith('!')) {
              await handleCommand(msg.body, msg);
            } else if (parseQuotedSendTarget(msg.body)) {
              await handleQuotedSend(msg);
            } else {
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
          } catch (err) {
            log(`[POLL] Handler error: ${err.message}`);
          }

          lastProcessedTimestamp = msg.timestamp;
          saveTimestamp();
        } else {
          log(`[POLL] OLD msg: timestamp=${msg.timestamp} <= lastProcessedTimestamp=${lastProcessedTimestamp}, skipping`);
        }
      }
    } catch (err) {
      log(`[POLL ERROR] ${err.message}`);
    } finally {
      pollInFlight = false;
    }
  }, 5000);
}

async function handleMediaMessage(msg) {
  try {
    log('HANDLE-MEDIA called');
    const media = await msg.downloadMedia();
    log('Media downloaded:', media ? 'success' : 'failed');
    if (!media) { await botReply(msg, 'Failed to download media'); return; }
    
    // Check file size (max 16MB)
    const MAX_FILE_SIZE = 16 * 1024 * 1024;
    if (media.data && Buffer.from(media.data, 'base64').length > MAX_FILE_SIZE) {
      await botReply(msg, 'File too large (max 16MB)'); 
      return;
    }
    
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
  const jid = await resolveTargetJid(target);
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
  commandsGroupJid = COMMANDS_GROUP_JID;
  log(`Using pre-set Me Commands group: ${commandsGroupJid}`);

  try {
    const chat = await Promise.race([
      client.getChatById(commandsGroupJid),
      new Promise((_, reject) => setTimeout(() => reject(new Error('verify timeout after 15s')), 15000)),
    ]);
    if (chat) {
      log(`Me Commands group verified: ${chat.name}`);
    } else {
      log(`Warning: Me Commands group not found — will retry via poller`);
    }
  } catch (err) {
    log(`Commands group verify skipped (${err.message}) — bot will still listen on ${commandsGroupJid}`);
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
      if (isBotReplyText(msg.body)) {
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

  if (raw === 'settings') {
    if (!settingsWizard) { await botReply(msg, 'Settings not ready yet.'); return; }
    await settingsWizard.startSettings(msg);
    return;
  }

  if (raw === 'bulk' || raw === 'sendnumbers' || raw === 'sendlist') {
    if (!bulkSendWizard) { await botReply(msg, 'Bulk send not ready yet.'); return; }
    await bulkSendWizard.startBulk(msg);
    return;
  }

  if (raw === 'addmembers' || raw === 'addtogroup') {
    if (!bulkAddMembersWizard) { await botReply(msg, 'Add members not ready yet.'); return; }
    await bulkAddMembersWizard.startAddMembers(msg);
    return;
  }

  if (raw === 'sets') {
    const sets = loadSets();
    const keys = Object.keys(sets);
    if (keys.length === 0) { await botReply(msg, 'No sets defined'); return; }

    const chats = await client.getChats();
    const jidToName = new Map(
      chats.filter(c => c.isGroup).map(c => [c.id._serialized, c.name])
    );

    let reply = 'Group Sets:\n';
    for (const [name, jids] of Object.entries(sets)) {
      const labels = (jids || []).map(jid => jidToName.get(jid) || `? (${jid})`);
      reply += `• ${name} (${labels.length}):\n`;
      for (const label of labels) reply += `  - ${label}\n`;
    }
    await botReply(msg, reply.trim());
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

  // List all group names only
  if (raw === 'grouplist' || raw === 'allgroups') {
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup);
    if (groups.length === 0) { await botReply(msg, 'No groups found'); return; }
    
    let reply = `📋 *All Groups (${groups.length})*\n━━━━━━━━━━━━━━━━━━━━\n`;
    for (const g of groups) {
      reply += `• ${g.name}\n`;
    }
    await botReply(msg, reply);
    return;
  }

  // Show active/inactive status of all groups
  if (raw === 'groupstatus' || raw === 'groupactive') {
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup);
    if (groups.length === 0) { await botReply(msg, 'No groups found'); return; }
    
    await botReply(msg, `Checking ${groups.length} groups...`);
    
    const active = [];
    const week = [];
    const inactive = [];
    
    for (const g of groups) {
      try {
        const messages = await Promise.race([
          g.fetchMessages({ limit: 1 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        if (messages.length === 0) {
          inactive.push(g.name);
          continue;
        }
        const daysInactive = Math.floor((Math.floor(Date.now() / 1000) - messages[0].timestamp) / 86400);
        if (daysInactive > 30) inactive.push(g.name);
        else if (daysInactive > 7) week.push(g.name);
        else active.push(g.name);
      } catch (e) {
        inactive.push(g.name);
      }
    }
    
    let reply = `📊 *Group Status*\n━━━━━━━━━━━━━━━━━━━━\n`;
    reply += `🟢 Active (< 7 days): ${active.length}\n`;
    reply += `🟡 Week inactive (7-30 days): ${week.length}\n`;
    reply += `🔴 Inactive (> 30 days): ${inactive.length}\n`;
    reply += `━━━━━━━━━━━━━━━━━━━━\n`;
    reply += `Total: ${groups.length} groups`;
    
    await botReply(msg, reply);
    return;
  }

  // List members of a specific group
  if (raw.startsWith('members ') || raw.startsWith('members ')) {
    const groupName = raw.replace(/^members\s+/i, '').trim();
    if (!groupName) {
      await botReply(msg, 'Usage: !members <group_name>\nExample: !members Family');
      return;
    }
    
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup);
    const group = groups.find(g => g.name.toLowerCase().includes(groupName.toLowerCase()));
    
    if (!group) {
      await botReply(msg, `Group "${groupName}" not found`);
      return;
    }
    
    try {
      const participants = group.participants || [];
      
      if (participants.length === 0) {
        // Try to fetch participants if not available
        try {
          await group.fetchParticipants();
        } catch (e) { /* ignore */ }
      }
      
      const memberList = group.participants || [];
      
      if (memberList.length === 0) {
        await botReply(msg, `No members found in "${group.name}"`);
        return;
      }
      
      let reply = `Members in "${group.name}" (${memberList.length}):\n`;
      for (const p of memberList.slice(0, 50)) {
        const contact = p.id ? await client.getContactById(p.id._serialized).catch(() => null) : null;
        const name = contact?.pushname || contact?.name || contact?.shortName || p.name || p.shortName || 'Unknown';
        const phone = p.id?.user || 'Unknown';
        reply += `• ${name} (${phone})\n`;
      }
      if (memberList.length > 50) {
        reply += `\n...and ${memberList.length - 50} more.`;
      }
      await botReply(msg, reply);
    } catch (e) {
      await botReply(msg, `Error fetching members: ${e.message}`);
    }
    return;
  }

  // Find member across all groups
  if (raw.startsWith('find ') || raw.startsWith('search ')) {
    const searchName = raw.replace(/^(find|search)\s+/i, '').trim();
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
        const participants = g.participants || [];
        if (participants.length === 0) {
          try { await g.fetchParticipants(); } catch (e) { /* ignore */ }
        }
        const memberList = g.participants || [];
        for (const p of memberList) {
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

Reply to a message, then:
• "send to all_vols_grps" → send quoted msg to set
• "to Maa" → send quoted msg to contact/group
• "forward to family" → same as above

━━━━━━━━━━━━━━━━━━━━
⚡ Commands
━━━━━━━━━━━━━━━━━━━━
🎨 !ai <text>      - Chat with AI
📤 !send <t> <msg> - Send to target
📱 !bulk           - Send one msg to a pasted list of numbers
👥 !addmembers     - Add pasted numbers to a group (background, admin only)
📢 !all <msg>      - Broadcast to all
⚙️ !settings       - Manage sets (add/edit/delete)
📋 !sets           - List group sets
📱 !groups         - List all groups
📋 !grouplist      - List all group names
📊 !groupstatus    - Show active/inactive status
🔀 !forward <msg> to <group> - Forward to another group
👥 !members <group> - List group members
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

  if (parseQuotedSendTarget(raw)) {
    await handleQuotedSend(msg, raw);
    return;
  }

  // Forward message to another group
  if (raw.startsWith('forward ') || raw.startsWith('fwd ')) {
    const parts = raw.replace(/^(forward|fwd)\s+/i, '').split(/\s+to\s+/i);
    if (parts.length !== 2) {
      await botReply(msg, 'Usage: !forward <message> to <group>\nExample: !forward Hello everyone to family');
      return;
    }
    
    const message = parts[0].trim();
    const targetGroup = parts[1].trim().toLowerCase();
    
    await botReply(msg, `Forwarding to ${targetGroup}...`);
    
    try {
      const sets = loadSets();
      let targetJid = null;
      
      // Check if target is a set
      const setGroups = sets[targetGroup];
      if (setGroups && Array.isArray(setGroups)) {
        for (const groupName of setGroups) {
          const chat = await resolveAndSend(groupName, message);
        }
        await botReply(msg, `✅ Forwarded "${message}" to ${setGroups.length} groups in ${targetGroup}`);
        return;
      }
      
      // Find direct group
      const chats = await client.getChats();
      const group = chats.find(c => 
        c.isGroup && c.name.toLowerCase().includes(targetGroup)
      );
      
      if (group) {
        await group.sendMessage(message);
        await botReply(msg, `✅ Forwarded to ${group.name}`);
      } else {
        await botReply(msg, `Group "${targetGroup}" not found`);
      }
    } catch (err) {
      await botReply(msg, `Error: ${err.message}`);
    }
    return;
  }

  const parsed = await parseNaturalCommand(raw);
  if (parsed) {
    await executeSend(parsed, msg);
    return;
  }

  await botReply(msg, `Unknown command: !${raw.split(' ')[0]}\nType !help`);
}

function parseQuotedSendTarget(body) {
  if (!body) return null;
  const text = body.trim();
  const patterns = [
    /^(?:send|forward|fwd)\s+to\s+(.+)$/i,
    /^(?:this|it)\s+to\s+(.+)$/i,
    /^to\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

const GROUP_TYPE_QUALIFIERS = new Set(['announcement', 'announce', 'community', 'discussion', 'group']);

function parseTargetWithQualifier(raw) {
  const trimmed = (raw || '').trim();
  const words = trimmed.split(/\s+/);
  const last = words[words.length - 1]?.toLowerCase();
  if (GROUP_TYPE_QUALIFIERS.has(last)) {
    const groupType = last === 'announce' ? 'announcement' : last;
    const name = words.slice(0, -1).join(' ').trim();
    return { name: name || trimmed, groupType };
  }
  return { name: trimmed, groupType: null };
}

function formatGroupTypeHint(chat) {
  if (isAnnouncementGroup(chat)) return ' (announcement — admins only)';
  if (getGroupTypeLabel(chat) === 'community') return ' (community — not postable)';
  if (getGroupTypeLabel(chat) === 'linked') return ' (linked group)';
  return '';
}

function findChatsWithSameName(chats, name) {
  const norm = normalizeNameForMatch(name);
  return chats.filter((c) => c.isGroup && c.name && normalizeNameForMatch(c.name) === norm);
}

function findCommunityPairByName(chats, name) {
  const sameName = findChatsWithSameName(chats, name);
  const announcement = sameName.find(isAnnouncementGroup);
  const community = sameName.find((c) => getGroupTypeLabel(c) === 'community');
  if (announcement && community) return { announcement, community };
  return null;
}

function buildCommunityAdminOnlyError(chatName, isAdmin) {
  return (
    `❌ "${chatName}" is a WhatsApp Community.\n` +
    `Only admins can post in the announcement group.\n` +
    (isAdmin
      ? 'You appear to be an admin — if send still fails, try from WhatsApp directly.'
      : 'You are not an admin. Please check with a community admin to post this message.')
  );
}

function getSendPermission(chat, allChats = null) {
  if (!chat?.isGroup) return { ok: true };

  const type = getGroupTypeLabel(chat);
  const name = chat.name || 'this group';
  const isAdmin = isUserGroupAdmin(chat);

  if (type === 'community') {
    const pair = allChats ? findCommunityPairByName(allChats, name) : null;
    const annAdmin = pair ? isUserGroupAdmin(pair.announcement) : false;
    return { ok: false, reason: buildCommunityAdminOnlyError(name, annAdmin) };
  }

  if (isAnnouncementGroup(chat) && !isAdmin) {
    return {
      ok: false,
      reason:
        `❌ "${name}" is an announcement group (admins only).\n` +
        'You are not an admin. Please check with a community admin to post this message.',
    };
  }

  return { ok: true };
}

function isQuotedSendOnlyCommand(body) {
  return !!parseQuotedSendTarget(body);
}

async function getQuotedMessageSafe(msg) {
  let current = msg;
  if (!current?.hasQuotedMsg) {
    try {
      const fresh = await client.getMessageById(current.id._serialized);
      if (fresh?.hasQuotedMsg) current = fresh;
    } catch (err) {
      log(`[QUOTE] Could not refresh message: ${err.message}`);
    }
  }
  if (!current?.hasQuotedMsg) return null;
  try {
    let quoted = await current.getQuotedMessage();
    if (!quoted) return null;
    try {
      const freshQuoted = await client.getMessageById(quoted.id._serialized);
      if (freshQuoted) quoted = freshQuoted;
    } catch (err) {
      log(`[QUOTE] Could not refresh quoted message: ${err.message}`);
    }
    return quoted;
  } catch (err) {
    log(`[QUOTE] getQuotedMessage failed: ${err.message}`);
    return null;
  }
}

function isCommandLikeText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('!')) return true;
  if (isBotReplyText(trimmed)) return true;
  if (parseQuotedSendTarget(trimmed)) return true;
  return false;
}

async function findCompanionTextForQuoted(quotedMsg) {
  if (!commandsGroupJid || !quotedMsg?.timestamp) return '';

  try {
    const chat = await client.getChatById(commandsGroupJid);
    const messages = await chat.fetchMessages({ limit: 50 });
    const candidates = messages
      .filter((m) =>
        m.timestamp < quotedMsg.timestamp &&
        !m.hasMedia &&
        m.body?.trim() &&
        !isCommandLikeText(m.body)
      )
      .sort((a, b) => b.timestamp - a.timestamp);

    if (candidates.length === 0) return '';

    const previousText = candidates[0];
    const gapSeconds = quotedMsg.timestamp - previousText.timestamp;
    if (gapSeconds > 300) return '';

    log(`[QUOTE] Companion text found (${gapSeconds}s before media): "${previousText.body.substring(0, 60)}"`);
    return previousText.body.trim();
  } catch (err) {
    log(`[QUOTE] Companion text lookup failed: ${err.message}`);
    return '';
  }
}

async function resolveQuotedTextBundle(quotedMsg) {
  let inlineText = getQuotedText(quotedMsg);

  if (!inlineText && quotedMsg?.hasQuotedMsg) {
    try {
      const parent = await quotedMsg.getQuotedMessage();
      if (parent) {
        let parentMsg = parent;
        try {
          const freshParent = await client.getMessageById(parent.id._serialized);
          if (freshParent) parentMsg = freshParent;
        } catch {}
        inlineText = getQuotedText(parentMsg);
        if (inlineText) {
          log(`[QUOTE] Text from nested quoted message: "${inlineText.substring(0, 60)}"`);
        }
      }
    } catch (err) {
      log(`[QUOTE] Nested quoted text lookup failed: ${err.message}`);
    }
  }

  let companionText = '';
  if (!inlineText && quotedMsg?.hasMedia) {
    companionText = await findCompanionTextForQuoted(quotedMsg);
  }

  const text = inlineText || companionText;
  return { inlineText, companionText, text };
}

async function handleQuotedSend(msg, instructionBody) {
  const targetRaw = parseQuotedSendTarget(instructionBody || msg.body);
  if (!targetRaw) return;

  log(`[QUOTE] send-to command for "${targetRaw}", hasQuotedMsg=${msg.hasQuotedMsg}`);
  const quotedMsg = await getQuotedMessageSafe(msg);
  if (!quotedMsg) {
    await botReply(msg, '❌ Reply to a message first (swipe right → Reply), then say:\n• send to <set or group>\n• to Maa\n• forward to all_vols_grps');
    return;
  }
  const { inlineText, companionText, text: quotedText } = await resolveQuotedTextBundle(quotedMsg);
  log(`[QUOTE] payload type=${quotedMsg.type} hasMedia=${quotedMsg.hasMedia} inlineLen=${inlineText.length} companionLen=${companionText.length}`);
  if (!quotedText && !quotedMsg.hasMedia) {
    await botReply(msg, '❌ Quoted message has no text or media to send.');
    return;
  }

  const { name: targetName, groupType } = parseTargetWithQualifier(targetRaw);
  const sets = loadSets();
  const setKey = targetName.toLowerCase();
  const isSet = sets[setKey] || ['everyone', 'all', 'all groups', 'everybody'].includes(setKey);

  let targetJid = null;
  let targetLabel = targetName;

  if (!isSet) {
    const contactNumber = resolveContact(targetName);
    if (contactNumber) {
      targetJid = `${contactNumber.replace(/\D/g, '')}@s.whatsapp.net`;
      targetLabel = targetName;
    } else {
      const chats = await client.getChats();
      const matches = await findChatMatchesByName(chats, targetName, { groupType });
      if (matches.length === 0) {
        const pair = findCommunityPairByName(chats, targetName);
        if (pair && !isUserGroupAdmin(pair.announcement)) {
          await botReply(msg, buildCommunityAdminOnlyError(targetName, false));
          return;
        }
        const hint = groupType ? ` (type: ${groupType})` : '';
        await botReply(msg, `Target "${targetName}"${hint} not found. Use !sets or !groups.`);
        return;
      }
      if (matches.length > 1) {
        let text = `Multiple matches for "${targetName}". Be more specific:\n`;
        matches.slice(0, 8).forEach((c, i) => {
          text += `${i + 1}. ${c.name}${formatGroupTypeHint(c)}\n   ${c.id._serialized}\n`;
        });
        text += '\nTip: announcement groups need admin rights. Community shells are not postable.';
        await botReply(msg, text.trim());
        return;
      }
      const picked = matches[0];
      const permission = getSendPermission(picked, chats);
      if (!permission.ok) {
        await botReply(msg, permission.reason);
        return;
      }
      targetJid = picked.id._serialized;
      targetLabel = picked.name;
    }
  }

  try {
    if (setKey === 'all' || ['everyone', 'all groups', 'everybody'].includes(setKey)) {
      const setGroups = sets.all || [];
      if (setGroups.length === 0) { await botReply(msg, 'No groups in "all" set'); return; }
      await botReply(msg, `Sending quoted message to ${setGroups.length} groups...`);
      for (let i = 0; i < setGroups.length; i++) {
        await sendQuotedContent(setGroups[i], quotedMsg, { inlineText, companionText });
        if (i < setGroups.length - 1) await delay(2000);
      }
      await botReply(msg, `✅ Sent to ${setGroups.length} groups`);
      return;
    }

    const setGroups = sets[setKey];
    if (setGroups) {
      await botReply(msg, `Sending quoted message to ${setGroups.length} groups in "${setKey}"...`);
      for (let i = 0; i < setGroups.length; i++) {
        await sendQuotedContent(setGroups[i], quotedMsg, { inlineText, companionText });
        if (i < setGroups.length - 1) await delay(2000);
      }
      await botReply(msg, `✅ Sent to ${setGroups.length} groups in "${setKey}"`);
      return;
    }

    log(`[QUOTE] resolved "${targetRaw}" → "${targetLabel}" (${targetJid})`);
    await sendQuotedContent(targetJid, quotedMsg, { inlineText, companionText, text: quotedText });
    await botReply(msg, `✅ Sent to ${targetLabel}`);
  } catch (err) {
    await botReply(msg, `Error: ${err.message}`);
  }
}

function getQuotedText(quotedMsg) {
  const data = quotedMsg?._data || {};
  const raw =
    quotedMsg?.body ||
    data.caption ||
    data.body ||
    quotedMsg?.caption ||
    '';
  return String(raw).trim();
}

async function sendQuotedContent(target, quotedMsg, textBundle = null) {
  const bundle = textBundle || await resolveQuotedTextBundle(quotedMsg);
  const inlineText = bundle.inlineText || '';
  const companionText = bundle.companionText || '';
  const text = (bundle.text || inlineText || companionText || '').trim();
  const caption = inlineText || companionText || text;
  const jid = target.includes('@') ? target : await resolveTargetJid(target);

  if (quotedMsg.hasMedia) {
    const media = await quotedMsg.downloadMedia();
    if (media) {
      const msgMedia = new MessageMedia(media.mimetype, media.data, media.filename || 'file');

      // Very long text: WhatsApp caption limit ~1024 — send text first, then media
      if (caption && caption.length > 900) {
        await sendMessageToJid(jid, caption);
        await delay(800);
        await sendMessageToJid(jid, msgMedia);
        log(`[QUOTE-SEND] Sent long text + media to ${jid}`);
        return;
      }

      await sendMessageToJid(jid, msgMedia, { caption: caption || '' });
      log(`[QUOTE-SEND] Sent media with caption (${caption.length} chars) to ${jid}`);
      return;
    }
  }

  if (text) {
    await sendMessageToJid(jid, text);
    log(`[QUOTE-SEND] Sent text (${text.length} chars) to ${jid}`);
    return;
  }

  throw new Error('Nothing to send — quoted message has no text or media');
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
        if (!message.trim()) return null; // "send to X" — use reply-to-message flow
        return { target: result, message: message.trim(), isAll: allKeywords.includes(result.toLowerCase()) };
      }
    }
  }

  if (isQuotedSendOnlyCommand(input)) return null;

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
  
  const contactNumber = resolveContact(lower);
  if (contactNumber) return contactNumber;
  
  try {
    const chats = await client.getChats();
    const found = await findChatByTargetName(chats, name);
    if (found) return found.name;
  } catch (e) { /* ignore */ }
  return null;
}

async function executeSend(parsed, msg) {
  try {
    if (!parsed.message?.trim()) {
      await botReply(msg, '❌ Message is empty. Type your message first, reply to it, then say "send to <target>".');
      return;
    }

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

    try {
      const chats = await client.getChats();
      const matches = await findChatMatchesByName(chats, parsed.target);
      if (matches.length > 1) {
        let text = `Multiple matches for "${parsed.target}". Be more specific:\n`;
        matches.slice(0, 8).forEach((c, i) => { text += `${i + 1}. ${c.name}\n`; });
        await botReply(msg, text.trim());
        return;
      }
      const jid = await resolveTargetJid(parsed.target);
      const chat = await client.getChatById(jid);
      log(`[SEND] resolved "${parsed.target}" → "${chat?.name || parsed.target}" (${jid})`);
      await resolveAndSend(jid, parsed.message);
      await botReply(msg, `Sent to ${chat?.name || parsed.target}`);
      return;
    } catch (e) {
      await botReply(msg, `Target "${parsed.target}" not found. Use !groups, !contacts, or !sets.`);
      return;
    }
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

function normalizeNameForMatch(str) {
  return removeEmojis(str)
    .toLowerCase()
    .replace(/[-–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_TARGET_WORDS = new Set([
  'group', 'groups', 'sets', 'set', 'all', 'the', 'msg', 'message', 'send', 'say', 'tell',
]);

function scoreChatNameMatch(targetNorm, chatNameNorm) {
  if (!targetNorm || !chatNameNorm) return 0;
  if (chatNameNorm === targetNorm) return 10000 + chatNameNorm.length;
  if (chatNameNorm.includes(targetNorm)) return 5000 + chatNameNorm.length;
  if (targetNorm.includes(chatNameNorm) && chatNameNorm.length >= 3) return 1000 + chatNameNorm.length;
  return 0;
}

function isAnnouncementGroup(chat) {
  return !!(chat?.groupMetadata?.announce || chat?._data?.groupMetadata?.announce);
}

function getGroupParticipantCount(chat) {
  return chat.participants?.length || chat.groupMetadata?.participants?.length || 0;
}

function getGroupTypeLabel(chat) {
  if (!chat?.isGroup) return 'chat';
  if (isAnnouncementGroup(chat)) return 'announcement';
  const parentId = chat.groupMetadata?.parentGroupId?._serialized || chat.groupMetadata?.parentGroupId;
  if (parentId) return 'linked';
  if (getGroupParticipantCount(chat) <= 15) return 'community';
  return 'group';
}

function isUserGroupAdmin(chat) {
  if (!myNumber || !chat?.isGroup) return false;
  const parts = chat.groupMetadata?.participants || chat.participants || [];
  const meNorm = myNumber.replace(/@.*/, '');
  return parts.some((p) => {
    const id = p.id?._serialized || String(p.id || '');
    const idNorm = id.replace(/@.*/, '');
    return (id === myNumber || idNorm === meNorm) && (p.isAdmin || p.isSuperAdmin);
  });
}

async function canPostToGroup(chat, allChats = null) {
  return getSendPermission(chat, allChats).ok;
}

function matchesGroupTypeFilter(chat, groupType) {
  if (!groupType) return true;
  const label = getGroupTypeLabel(chat);
  if (groupType === 'announcement') return label === 'announcement';
  if (groupType === 'community') return label === 'community' || (!isAnnouncementGroup(chat) && label !== 'linked');
  if (groupType === 'discussion' || groupType === 'group') return !isAnnouncementGroup(chat);
  return true;
}

async function pickAmongSameNameChats(candidates) {
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];

  const details = await Promise.all(candidates.map(async (chat) => {
    let lastTs = 0;
    try {
      const msgs = await Promise.race([
        chat.fetchMessages({ limit: 1 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      if (msgs[0]) lastTs = msgs[0].timestamp;
    } catch { /* ignore */ }
    const announce = isAnnouncementGroup(chat);
    const isAdmin = isUserGroupAdmin(chat);
    return {
      chat,
      lastTs,
      jid: chat.id?._serialized,
      announce,
      isAdmin,
      canPost: !announce || isAdmin,
      type: getGroupTypeLabel(chat),
      participants: getGroupParticipantCount(chat),
    };
  }));

  const hasAnnounce = details.some((d) => d.announce);
  const hasCommunity = details.some((d) => d.type === 'community');
  const annDetail = details.find((d) => d.announce);

  // Community + announcement pair: community shell is never postable; need announcement admin
  if (hasAnnounce && hasCommunity && !annDetail?.isAdmin) {
    log(`[MATCH] ${candidates.length} named "${candidates[0].chat.name}" — community pair, user not admin`);
    return null;
  }

  const pickPool = details.filter((d) => d.type !== 'community');

  pickPool.sort((a, b) => {
    const aGroup = a.chat.isGroup && a.jid?.endsWith('@g.us') ? 1 : 0;
    const bGroup = b.chat.isGroup && b.jid?.endsWith('@g.us') ? 1 : 0;
    if (bGroup !== aGroup) return bGroup - aGroup;
    if (a.canPost !== b.canPost) return b.canPost - a.canPost;
    if (a.announce !== b.announce) return a.announce - b.announce;
    if (b.lastTs !== a.lastTs) return b.lastTs - a.lastTs;
    if (b.participants !== a.participants) return b.participants - a.participants;
    return (b.chat.pinned || 0) - (a.chat.pinned || 0);
  });

  const picked = pickPool[0];
  if (!picked) return null;
  const others = details.map((d) =>
    `${d.jid}${d.announce ? '(ann)' : `(${d.type})`} postable=${d.canPost} activity=${d.lastTs || 'none'}`
  ).join(' | ');
  log(`[MATCH] ${candidates.length} named "${picked.chat.name}" → picked ${picked.jid} (${picked.type}${picked.announce ? ', announcement' : ''}) | ${others}`);
  return picked.chat;
}

async function collapseDuplicateNameMatches(matches, options = {}) {
  if (matches.length <= 1) return matches;

  const byName = new Map();
  for (const chat of matches) {
    const key = normalizeNameForMatch(chat.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(chat);
  }

  const collapsed = [];
  for (const group of byName.values()) {
    if (group.length > 1) {
      const hasAnnounce = group.some(isAnnouncementGroup);
      const hasNonAnnounce = group.some((c) => !isAnnouncementGroup(c));
      if (options.groupType && hasAnnounce && hasNonAnnounce) {
        for (const chat of group) {
          if (matchesGroupTypeFilter(chat, options.groupType)) collapsed.push(chat);
        }
        continue;
      }
    }
    const picked = await pickAmongSameNameChats(group);
    if (picked) collapsed.push(picked);
  }
  return collapsed.filter(Boolean);
}

async function findChatMatchesByName(chats, target, options = {}) {
  const targetNorm = normalizeNameForMatch(target);
  if (!targetNorm || targetNorm.length < 3 || GENERIC_TARGET_WORDS.has(targetNorm)) return [];

  const scored = chats
    .filter((c) => c.name)
    .map((c) => ({
      chat: c,
      score: scoreChatNameMatch(targetNorm, normalizeNameForMatch(c.name)),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.chat.name.length - a.chat.name.length);

  if (scored.length === 0) return [];
  const topScore = scored[0].score;
  let topMatches = scored.filter((x) => x.score === topScore).map((x) => x.chat);
  topMatches = await collapseDuplicateNameMatches(topMatches, options);
  if (options.groupType) {
    topMatches = topMatches.filter((c) => matchesGroupTypeFilter(c, options.groupType));
  }
  return topMatches;
}

async function findChatByTargetName(chats, target, options = {}) {
  const { name, groupType } = parseTargetWithQualifier(target);
  const matches = await findChatMatchesByName(chats, name, { ...options, groupType: options.groupType || groupType });
  return matches[0] || null;
}

function inferDefaultCountryCode() {
  if (process.env.DEFAULT_COUNTRY_CODE) return process.env.DEFAULT_COUNTRY_CODE.replace(/\D/g, '');
  if (!myNumber) return '91';
  const digits = myNumber.replace(/\D/g, '');
  if (digits.length > 10) return digits.slice(0, digits.length - 10);
  return '91';
}

function normalizePhoneDigits(digits) {
  let d = String(digits).replace(/\D/g, '');
  if (d.length === 10 && /^[6-9]\d{9}$/.test(d)) {
    d = inferDefaultCountryCode() + d;
  }
  return d;
}

function extractPhoneDigitsFromJid(jid) {
  if (!jid || jid.includes('@g.us')) return null;
  const m = jid.match(/^(\d{10,15})@(c\.us|s\.whatsapp\.net|lid)$/);
  return m ? m[1] : null;
}

async function resolvePhoneSendCandidates(phoneInput) {
  const normalized = normalizePhoneDigits(phoneInput);
  const candidates = new Set();

  let wid = null;
  try {
    wid = await client.getNumberId(normalized);
  } catch (err) {
    log(`[SEND] getNumberId failed for ${normalized}: ${err.message}`);
  }

  if (!wid) {
    throw new Error(`${normalized} is not on WhatsApp (check country code, e.g. 91XXXXXXXXXX)`);
  }

  const widStr = wid._serialized || String(wid);
  candidates.add(widStr);
  candidates.add(`${normalized}@c.us`);
  candidates.add(`${normalized}@s.whatsapp.net`);

  try {
    const [mapping] = await client.getContactLidAndPhone([widStr, `${normalized}@c.us`]);
    if (mapping?.lid) candidates.add(mapping.lid);
    if (mapping?.pn) candidates.add(mapping.pn);
  } catch (err) {
    log(`[SEND] LID lookup for ${normalized}: ${err.message}`);
  }

  try {
    await Promise.race([
      client.getChatById(widStr),
      new Promise((_, reject) => setTimeout(() => reject(new Error('getChat timeout')), 10000)),
    ]);
    const [mapping] = await client.getContactLidAndPhone([widStr]);
    if (mapping?.lid) candidates.add(mapping.lid);
  } catch (err) {
    log(`[SEND] Chat warm-up for ${normalized}: ${err.message}`);
  }

  return [...candidates].filter(Boolean);
}

function isLidJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@lid');
}

function isGroupJid(jid) {
  return typeof jid === 'string' && (jid.endsWith('@g.us') || jid.includes('newsletter'));
}

async function resolveSendableJids(jid) {
  if (!jid) return [];
  if (isGroupJid(jid)) return [jid];

  const phoneDigits = extractPhoneDigitsFromJid(jid);
  if (phoneDigits) {
    return resolvePhoneSendCandidates(phoneDigits);
  }

  const candidates = new Set([jid]);

  if (jid.endsWith('@s.whatsapp.net')) {
    const num = normalizePhoneDigits(jid.replace('@s.whatsapp.net', ''));
    candidates.add(`${num}@c.us`);
  }

  try {
    const [mapping] = await client.getContactLidAndPhone([jid]);
    if (mapping?.lid) candidates.add(mapping.lid);
    if (mapping?.pn) {
      candidates.add(mapping.pn);
      if (mapping.pn.endsWith('@c.us')) {
        const num = mapping.pn.replace('@c.us', '');
        candidates.add(`${num}@s.whatsapp.net`);
      }
    }
  } catch (err) {
    log(`[SEND] LID/phone lookup failed for ${jid}: ${err.message}`);
  }

  if (isLidJid(jid)) {
    try {
      const chat = await client.getChatById(jid);
      if (chat) {
        const contact = await chat.getContact();
        if (contact?.number) {
          const num = contact.number.replace(/\D/g, '');
          candidates.add(`${num}@c.us`);
          candidates.add(`${num}@s.whatsapp.net`);
        }
        const contactId = contact?.id?._serialized;
        if (contactId && !contactId.endsWith('@lid')) candidates.add(contactId);
      }
    } catch (err) {
      log(`[SEND] Contact lookup failed for ${jid}: ${err.message}`);
    }
  }

  return [...candidates].filter(Boolean);
}

async function sendMessageToJid(jid, content, options = {}) {
  const jids = await resolveSendableJids(jid);
  // Groups (especially announcement) can take 60s+ to ack — don't block on delivery.
  const waitUntilMsgSent = options.waitUntilMsgSent ?? !isGroupJid(jids[0]);
  let lastErr;
  for (const attemptJid of jids) {
    try {
      const result = await client.sendMessage(attemptJid, content, {
        ...options,
        waitUntilMsgSent,
      });
      log(`[SEND] ✅ via ${attemptJid}${waitUntilMsgSent ? '' : ' (queued)'}`);
      return result;
    } catch (err) {
      lastErr = err;
      log(`[SEND] failed via ${attemptJid}: ${err.message}`);
    }
  }
  throw lastErr || new Error(`Failed to send to ${jid}`);
}

async function resolveTargetJid(target) {
  if (!target) throw new Error('No target specified');
  if (target.includes('@')) return target;

  const { name, groupType } = parseTargetWithQualifier(target);

  if (/^\+?\d{10,15}$/.test(name)) {
    return `${normalizePhoneDigits(name.replace(/\D/g, ''))}@c.us`;
  }

  const contact = resolveContact(name);
  if (contact) {
    return `${normalizePhoneDigits(contact.replace(/\D/g, ''))}@c.us`;
  }

  const chats = await client.getChats();
  const matches = await findChatMatchesByName(chats, name, { groupType });
  if (matches.length === 0) {
    const pair = findCommunityPairByName(chats, name);
    if (pair && !isUserGroupAdmin(pair.announcement)) {
      throw new Error(buildCommunityAdminOnlyError(name, false));
    }
    throw new Error(`Target "${name}" not found`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple matches for "${name}" — be more specific`);
  }
  const picked = matches[0];
  const permission = getSendPermission(picked, chats);
  if (!permission.ok) throw new Error(permission.reason);
  return picked.id._serialized;
}

async function resolveGroupByName(name) {
  const chats = await client.getChats();
  const matches = await findChatMatchesByName(chats, name);
  if (matches.length === 0) {
    return { error: `Group "${name}" not found. Use !groups to list.` };
  }
  if (matches.length > 1) {
    let text = `Multiple groups match "${name}". Be more specific:\n`;
    matches.slice(0, 6).forEach((c, i) => {
      text += `${i + 1}. ${c.name}${formatGroupTypeHint(c)}\n`;
    });
    return { error: text.trim() };
  }
  const chat = matches[0];
  if (getGroupTypeLabel(chat) === 'community') {
    return {
      error: `"${chat.name}" is a WhatsApp Community shell, not a member group. Pick a regular group you admin.`,
    };
  }
  if (!isUserGroupAdmin(chat)) {
    return { error: `You are not an admin of "${chat.name}". Only admins can add members.` };
  }
  return { chat };
}

async function resolveParticipantWids(numbers) {
  const wids = [];
  const failed = [];
  const entries = [];
  for (const raw of numbers) {
    const digits = normalizePhoneDigits(String(raw).replace(/\D/g, ''));
    try {
      const wid = await client.getNumberId(digits);
      if (!wid) {
        failed.push({ num: digits, error: 'Not on WhatsApp' });
        continue;
      }
      const widStr = wid._serialized || `${digits}@c.us`;
      wids.push(widStr);
      entries.push({ digits, wid: widStr });
    } catch (err) {
      failed.push({ num: digits, error: err.message.split('\n')[0] });
    }
  }
  return { wids, failed, entries };
}

async function validateScheduleTarget(target) {
  const lower = target.toLowerCase();
  const sets = loadSets();
  if (sets[lower]) return;
  if (resolveContact(target)) return;
  await resolveTargetJid(target);
}

async function resolveAndSend(target, message) {
  if (!message?.trim()) throw new Error('Cannot send an empty message');
  const jid = await resolveTargetJid(target);
  log(`[SEND] → ${jid}: "${message.substring(0, 80)}"`);
  await sendMessageToJid(jid, message);
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

const WEB_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function isStaticAsset(pathname) {
  if (pathname === '/' || pathname.startsWith('/dashboard')) return true;
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/icons/')) return true;
  if (pathname === '/sw.js' || pathname === '/manifest.webmanifest' || pathname === '/config.js') return true;
  return /\.(css|js|png|svg|ico|webmanifest)$/i.test(pathname);
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function requireAuth(req, res) {
  if (auth.validateAuth(req)) return true;
  jsonResponse(res, 401, { error: 'Unauthorized' });
  return false;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function serveStaticFile(req, res, parsed) {
  let reqPath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  if (reqPath.startsWith('/dashboard')) {
    reqPath = reqPath === '/dashboard' || reqPath === '/dashboard/'
      ? '/index.html'
      : reqPath.replace(/^\/dashboard/, '') || '/index.html';
  }
  const safe = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(DOCS_DIR, safe);
  if (!filePath.startsWith(DOCS_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('Not found');
    return true;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': WEB_MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function startSendServer() {
  if (sendServer) return;

  auth.checkStartupAuth(log);

  sendServer = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end();
      return;
    }

    if (req.method === 'GET' && isStaticAsset(parsed.pathname)) {
      if (serveStaticFile(req, res, parsed)) return;
    }

    if (req.method === 'POST' && parsed.pathname === '/auth/login') {
      try {
        const body = await readRequestBody(req);
        const { password } = JSON.parse(body || '{}');
        const result = auth.login(password || '');
        if (!result.ok) {
          jsonResponse(res, 401, { error: result.error });
          return;
        }
        jsonResponse(res, 200, { token: result.token, expiresAt: result.expiresAt });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message });
      }
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/auth/logout') {
      auth.logout(auth.getBearerToken(req));
      jsonResponse(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/sets') {
      if (!requireAuth(req, res)) return;
      try {
        res.writeHead(200); res.end(JSON.stringify({ sets: loadSets() }));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/sets') {
      if (!requireAuth(req, res)) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.sets || typeof data.sets !== 'object') {
            res.writeHead(400); res.end(JSON.stringify({ error: 'Body must include { sets: {...} }' }));
            return;
          }
          for (const [name, jids] of Object.entries(data.sets)) {
            if (!Array.isArray(jids)) {
              res.writeHead(400); res.end(JSON.stringify({ error: `Set "${name}" must be an array of JIDs` }));
              return;
            }
          }
          saveSets(data.sets);
          res.writeHead(200); res.end(JSON.stringify({ ok: true, sets: loadSets() }));
        } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/send') {
      if (!requireAuth(req, res)) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { recipient, message, jid } = JSON.parse(body);
          let target = jid || recipient;
          if (!target || !message) { res.writeHead(400); res.end('{}'); return; }
          const sets = loadSets();
          const setGroups = sets[target.toLowerCase()];
          if (setGroups) {
            for (const g of setGroups) { await resolveAndSend(g, message); }
            res.writeHead(200); res.end(JSON.stringify({ ok: true, count: setGroups.length }));
            return;
          }
          await resolveAndSend(target, message);
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/send-media') {
      if (!requireAuth(req, res)) return;
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
      if (!requireAuth(req, res)) return;
      try {
        const force = parsed.query.refresh === '1';
        const groups = apiHandlers
          ? await apiHandlers.getGroupsEnriched(force)
          : [];
        jsonResponse(res, 200, groups);
      } catch (err) { jsonResponse(res, 500, { error: err.message }); }
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/health') {
      const authed = auth.validateAuth(req);
      const payload = {
        status: 'ok',
        authRequired: auth.isAuthRequired(),
        commandsGroupName: COMMANDS_GROUP_NAME,
      };
      if (authed) {
        payload.info = client.info;
        payload.commandsGroup = commandsGroupJid;
      }
      jsonResponse(res, 200, payload);
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/chats') {
      if (!requireAuth(req, res)) return;
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

    if (apiHandlers) {
      const handled = await apiHandlers.handleRequest(req, res, parsed, requireAuth);
      if (handled) return;
    }

    res.writeHead(404); res.end('Not found');
  });

  sendServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log(`Port ${LISTEN_PORT} already in use. Run: ./start.sh  (or kill the process on port ${LISTEN_PORT})`);
    } else {
      log(`HTTP server error: ${err.message}`);
    }
    process.exit(1);
  });

  sendServer.listen(LISTEN_PORT, '127.0.0.1', () => {
    console.error(`[${new Date().toISOString()}] Send server on http://127.0.0.1:${LISTEN_PORT}`);
    console.error(`[${new Date().toISOString()}] Dashboard:  http://127.0.0.1:${LISTEN_PORT}/`);
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

  try {
    await validateScheduleTarget(target);
  } catch (e) {
    await botReply(msg, `Cannot schedule to "${target}": ${e.message}
Add to contacts.json, groups.json, or use an exact WhatsApp chat name.`);
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

  try {
    await validateScheduleTarget(target);
  } catch (e) {
    await botReply(msg, `Cannot schedule to "${target}": ${e.message}
Add to contacts.json, groups.json, or use an exact WhatsApp chat name.`);
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
          try {
            const sets = loadSets();
            const setGroups = sets[schedule.target.toLowerCase()];
            if (setGroups) {
              console.log(`[SCHEDULE] Sending to ${setGroups.length} groups with 2s delay...`);
              for (let i = 0; i < setGroups.length; i++) {
                await resolveAndSend(setGroups[i], schedule.message);
                if (i < setGroups.length - 1) {
                  await delay(2000);
                }
              }
            } else {
              await resolveAndSend(schedule.target, schedule.message);
            }

            sentScheduleIds.add(schedule.id);
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
