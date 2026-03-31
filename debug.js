const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');

const SESSION_PATH = path.join(__dirname, '.wwebjs_auth');
const QR_PATH = path.join(__dirname, 'qr-code.png');

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  }
});

client.on('qr', async (qr) => {
  await QRCode.toFile(QR_PATH, qr, { width: 400 });
  console.error(`[${new Date().toISOString()}] QR saved to ${QR_PATH}`);
});

client.on('authenticated', () => console.error(`[${new Date().toISOString()}] AUTHENTICATED`));
client.on('ready', () => console.error(`[${new Date().toISOString()}] READY`));
client.on('disconnected', (r) => console.error(`[${new Date().toISOString()}] DISCONNECTED: ${r}`));

// Log EVERYTHING
client.on('message', (msg) => {
  console.log(`[${new Date().toISOString()}] [message] from=${msg.from} to=${msg.to} fromMe=${msg.fromMe} body="${msg.body}"`);
});

client.on('message_create', (msg) => {
  console.log(`[${new Date().toISOString()}] [message_create] from=${msg.from} to=${msg.to} fromMe=${msg.fromMe} body="${msg.body}"`);
});

client.on('message_revoke_everyone', (msg) => {
  console.log(`[${new Date().toISOString()}] [message_revoke] from=${msg.from}`);
});

client.initialize();
