const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { parseScheduleTime, formatTimeUntil, removeEmojis } = require('./utils');

const PORT = 42620;
const SESSION_PATH = '.wwebjs_auth';
const GROUPS_FILE = 'groups.json';
const CONTACTS_FILE = 'contacts.json';
const SCHEDULES_FILE = 'schedules.json';
const QR_PATH = 'qr-code.png';

let sock;
let myNumber = null;
let commandsGroupJid = null;
let COMMANDS_GROUP_NAME = 'Me Commands';
let lastReplyText = null;
let trackMessages = new Map();
let sentMessages = new Map();

function loadGroups() {
  try { return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')); } catch { return {}; }
}

function loadContacts() {
  try { return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8')); } catch { return { contacts: {} }; }
}

function loadSchedules() {
  try { return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8')); } catch { return []; }
}

function saveSchedules(data) {
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(data, null, 2));
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

async function sendToNumber(jid, message) {
  try {
    await sock.sendMessage(jid, { text: message });
    console.log(`[SEND] Sent to ${jid}: ${message.substring(0, 50)}`);
    return true;
  } catch (err) {
    console.error(`[SEND ERROR] ${err.message}`);
    return false;
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  
  sock = makeWASocket({
    auth: state,
  });

  sock.ev.on('creds.update', saveCreds);

  let currentQR = null;
  
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      currentQR = qr;
      console.log('\n===========================================');
      console.log('    SCAN THIS QR CODE WITH WHATSAPP!');
      console.log('===========================================\n');
      try {
        const qrAscii = await qrcode.toString(qr, { errorCorrectionLevel: 'L' });
        console.log(qrAscii);
        await qrcode.toFile(QR_PATH, qr);
        console.log('QR saved to: ./' + QR_PATH);
      } catch (err) {
        console.log('QR save error:', err.message);
      }
      console.log('\nOptions to scan:');
      console.log('1. Screenshot this terminal');
      console.log('2. Open browser: http://localhost:' + PORT + '/qr');
      console.log('===========================================\n');
    }
    
    if (connection === 'open') {
      myNumber = sock.user?.id?.split(':')[0];
      console.log(`\n✅ WhatsApp connected! Number: ${myNumber}\n`);
      if (currentQR) {
        console.log('QR has been cleared after successful login.');
        currentQR = null;
      }
      startServer();
    }
    
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log('Connection closed. Reconnecting...');
        startBot();
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      
      const jid = msg.key.remoteJid;
      const text = msg.message?.conversation?.[0] || msg.message?.extendedTextMessage?.text;
      if (!text) continue;
      
      console.log(`[MSG] ${jid}: ${text.substring(0, 50)}`);
      
      if (text.startsWith('!')) {
        await handleCommand(text, msg);
      }
    }
  });
}

async function handleCommand(text, msg) {
  const raw = text.slice(1).trim();
  const jid = msg.key.remoteJid;
  
  if (raw === 'help') {
    const help = `🤖 *WhatsApp Bot Help*

━━━━━━━━━━━━━━━━━━━━
📝 *Natural Messaging*
━━━━━━━━━━━━━━━━━━━━
Just type naturally:
• "hi family" → send to family
• "send hi to hebbal" → send to hebbal
• "say hi to all" → broadcast to all

━━━━━━━━━━━━━━━━━━━━
⚡ *Commands*
━━━━━━━━━━━━━━━━━━━━
🎨 !ai <text>      - Chat with AI
📤 !send <t> <msg> - Send to target
📢 !all <msg>      - Broadcast to all
📋 !sets           - List group sets
📱 !groups         - List all groups
👥 !members <name> - List group members
📊 !inactive [d]  - Show inactive groups
📅 !schedules      - List scheduled msgs
❌ !cancel         - Cancel last schedule
👤 !contacts       - List saved contacts
➕ !addcontact <n> <num> - Add contact
🔎 !track <msg>   - Track replies
📋 !replies       - Show tracked replies
📱 !qr            - Get QR code (if auth needed)
📊 !status        - Bot status
🆘 !help           - Show this help`;
    
    await sock.sendMessage(jid, { text: help });
    return;
  }
  
  if (raw === 'groups') {
    const chats = Object.values(sock.store?.chats || {});
    const groups = chats.filter(c => c.isGroup);
    let reply = `📱 *Groups (${groups.length}):*\n\n`;
    for (const g of groups.slice(0, 30)) {
      reply += `• ${g.name}\n`;
    }
    if (groups.length > 30) reply += `\n...and ${groups.length - 30} more`;
    await sock.sendMessage(jid, { text: reply });
    return;
  }
  
  if (raw === 'sets') {
    const groups = loadGroups();
    const keys = Object.keys(groups);
    if (keys.length === 0) {
      await sock.sendMessage(jid, { text: 'No sets defined' });
      return;
    }
    let reply = '📋 *Group Sets:*\n\n';
    for (const [name, list] of Object.entries(groups)) {
      reply += `• ${name}: ${list.join(', ')}\n`;
    }
    await sock.sendMessage(jid, { text: reply });
    return;
  }
  
  if (raw === 'contacts') {
    const contacts = loadContacts();
    const keys = Object.keys(contacts.contacts);
    if (keys.length === 0) {
      await sock.sendMessage(jid, { text: 'No contacts saved.\nUse: !addcontact <name> <number>' });
      return;
    }
    let reply = '👤 *Contacts:*\n\n';
    for (const [name, number] of Object.entries(contacts.contacts)) {
      reply += `• ${name}: ${number}\n`;
    }
    await sock.sendMessage(jid, { text: reply });
    return;
  }
  
  if (raw.startsWith('addcontact ')) {
    const parts = raw.replace('addcontact ', '').split(' ');
    if (parts.length < 2) {
      await sock.sendMessage(jid, { text: 'Usage: !addcontact <name> <number>' });
      return;
    }
    const name = parts[0];
    const number = parts.slice(1).join(' ').replace(/\D/g, '');
    const contacts = loadContacts();
    contacts.contacts[name] = number;
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
    await sock.sendMessage(jid, { text: `✅ Contact added: ${name} (${number})` });
    return;
  }
  
  if (raw === 'schedules') {
    const schedules = loadSchedules();
    if (schedules.length === 0) {
      await sock.sendMessage(jid, { text: 'No scheduled messages.' });
      return;
    }
    let reply = `📅 *Scheduled Messages (${schedules.length}):*\n\n`;
    for (const s of schedules.slice(0, 10)) {
      reply += `• "${s.message.substring(0, 30)}" → ${s.target}\n`;
      reply += `  At: ${new Date(s.runAt).toLocaleString()}\n\n`;
    }
    await sock.sendMessage(jid, { text: reply });
    return;
  }
  
  if (raw.startsWith('schedule ')) {
    const match = raw.match(/^schedule\s+(.+?)\s+to\s+(\S+)\s+at\s+(.+)$/i);
    if (!match) {
      await sock.sendMessage(jid, { text: 'Usage: !schedule <msg> to <target> at <time>\nExample: !schedule Hello all to family at 9am' });
      return;
    }
    const [_, message, target, timeStr] = match;
    const runAt = parseScheduleTime(timeStr);
    if (!runAt) {
      await sock.sendMessage(jid, { text: `Could not understand time: "${timeStr}"\nTry: 9am, 9am tomorrow, 9am monday` });
      return;
    }
    const schedules = loadSchedules();
    schedules.push({ id: Date.now(), message, target, runAt: runAt.toISOString(), createdAt: new Date().toISOString() });
    saveSchedules(schedules);
    await sock.sendMessage(jid, { text: `✅ Scheduled!\n"${message}" → ${target}\nAt: ${runAt.toLocaleString()}` });
    return;
  }
  
  if (raw === 'cancel') {
    const schedules = loadSchedules();
    if (schedules.length > 0) {
      schedules.pop();
      saveSchedules(schedules);
      await sock.sendMessage(jid, { text: '❌ Cancelled last scheduled message.' });
    } else {
      await sock.sendMessage(jid, { text: 'No scheduled messages to cancel.' });
    }
    return;
  }
  
  if (raw.startsWith('track ')) {
    const messageToTrack = raw.replace('track ', '').trim();
    const trackId = `track_${Date.now()}`;
    trackMessages.set(trackId, {
      message: messageToTrack,
      sender: myNumber,
      time: new Date().toISOString(),
      replies: []
    });
    await sock.sendMessage(jid, { text: `🔎 *Tracking started!*\n\n"${messageToTrack}"\n\nI'll notify when someone replies.` });
    return;
  }
  
  if (raw === 'replies' || raw === 'tracked') {
    if (trackMessages.size === 0) {
      await sock.sendMessage(jid, { text: 'No messages being tracked. Use !track <msg> to start.' });
      return;
    }
    let reply = `📋 *Tracked Messages (${trackMessages.size}):*\n\n`;
    for (const [id, data] of trackMessages) {
      reply += `• "${data.message.substring(0, 40)}"\n`;
      reply += `  ${data.replies.length} replies\n`;
    }
    await sock.sendMessage(jid, { text: reply });
    return;
  }
  
  if (raw.startsWith('send ')) {
    const parts = raw.replace('send ', '').split(' ');
    if (parts.length < 2) {
      await sock.sendMessage(jid, { text: 'Usage: !send <target> <message>' });
      return;
    }
    const target = parts[0];
    const message = parts.slice(1).join(' ');
    
    const groups = loadGroups();
    const setGroups = groups[target.toLowerCase()];
    if (setGroups) {
      let sent = 0;
      for (const g of setGroups) {
        if (await sendToNumber(g, message)) sent++;
      }
      await sock.sendMessage(jid, { text: `✅ Sent to ${sent} groups` });
    } else {
      await sendToNumber(target, message);
      await sock.sendMessage(jid, { text: `✅ Sent to ${target}` });
    }
    return;
  }
  
  if (raw === 'qr') {
    await handleQRCommand(jid);
    return;
  }
  
  if (raw === 'status') {
    const groups = loadGroups();
    const contacts = loadContacts();
    const schedules = loadSchedules();
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    
    await sock.sendMessage(jid, { text: `🤖 *Bot Status*

📱 WhatsApp: ${myNumber || 'Connecting...'}
⏱️ Uptime: ${days}d ${hours}h ${mins}m
👥 Contacts: ${Object.keys(contacts.contacts).length}
📋 Sets: ${Object.keys(groups).length}
📅 Schedules: ${schedules.length}
🆙 Server: Port ${PORT}` });
    return;
  }
  
  await sock.sendMessage(jid, { text: `Unknown command: !${raw.split(' ')[0]}\nType !help` });
}

async function handleQRCommand(jid) {
  if (currentQR) {
    try {
      const qrBuffer = await qrcode.toBuffer(currentQR);
      await sock.sendMessage(jid, { image: qrBuffer, caption: '📱 Scan this QR code with WhatsApp!' });
      return;
    } catch (err) {
      await sock.sendMessage(jid, { text: 'Could not generate QR: ' + err.message });
      return;
    }
  }
  await sock.sendMessage(jid, { text: 'No QR code available.\nQR is only shown during initial login.\nIf disconnected, restart the bot.' });
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    
    if (req.method === 'GET' && parsed.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', number: myNumber }));
      return;
    }
    
    if (req.method === 'GET' && parsed.pathname === '/qr') {
      if (fs.existsSync(QR_PATH)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        const imgBase64 = fs.readFileSync(QR_PATH).toString('base64');
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp QR Code</title>
  <style>
    body { font-family: Arial; text-align: center; padding: 20px; background: #111; color: #fff; }
    h1 { color: #25D366; }
    img { max-width: 100%; border: 4px solid #25D366; border-radius: 8px; }
    p { color: #888; }
  </style>
</head>
<body>
  <h1>📱 WhatsApp QR Code</h1>
  <img src="data:image/png;base64,${imgBase64}" alt="QR Code">
  <p>Scan with WhatsApp on your phone</p>
  <p><a href="/qr" style="color:#25D366;">Refresh</a></p>
</body>
</html>`);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:Arial;text-align:center;padding:50px;background:#111;color:#fff"><h1 style="color:#25D366">QR Not Available</h1><p>Start the bot to get QR code</p></body></html>');
      }
      return;
    }
    
    res.writeHead(404);
    res.end('Not found');
  });
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[${new Date().toISOString()}] Server on http://0.0.0.0:${PORT}`);
    console.log(`[${new Date().toISOString()}] QR code: http://localhost:${PORT}/qr`);
  });
}

process.on('uncaughtException', (err) => {
  console.log('[ERROR] Uncaught:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.log('[ERROR] Unhandled:', err);
});

console.log('Starting WhatsApp Bot...');
console.log('Press Ctrl+C to stop (or close terminal)\n');
startBot();
