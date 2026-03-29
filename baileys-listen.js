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
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log(`[${new Date().toISOString()}] QR Code received! Saving...`);
      try {
        await qrcode.toFile(QR_PATH, qr);
        console.log(`[${new Date().toISOString()}] QR saved to ${QR_PATH}`);
        console.log(`[${new Date().toISOString()}] Scan QR at: http://localhost:${PORT}/qr`);
      } catch (err) {
        console.error(`[QR ERROR] ${err.message}`);
      }
    }
    
    if (connection === 'open') {
      myNumber = sock.user?.id?.split(':')[0];
      console.log(`[${new Date().toISOString()}] WhatsApp connected`);
      console.log(`[${new Date().toISOString()}] My number: ${myNumber}`);
      startServer();
    }
    
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`[${new Date().toISOString()}] Connection closed. Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) startBot();
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
  
  await sock.sendMessage(jid, { text: `Unknown command: !${raw.split(' ')[0]}\nType !help` });
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
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(fs.readFileSync(QR_PATH));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>QR not available</h1></body></html>');
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

console.log('Starting WhatsApp Bot...');
startBot();
