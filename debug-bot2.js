const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, useWWebJS_AUTH } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const fs = require('fs');

const PORT = 42620;
const SESSION_PATH = '.wwebjs_auth';
const QR_PATH = 'qr-code.png';

let sock;
let myNumber = null;
let currentQR = null;

async function startBot() {
  console.log('Starting bot...\n');
  
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  
  sock = makeWASocket({
    auth: state,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      currentQR = qr;
      console.log('\n!!! QR CODE RECEIVED !!!\n');
      console.log('===========================================');
      console.log('    SCAN THIS QR CODE WITH WHATSAPP!');
      console.log('===========================================\n');
      try {
        const qrAscii = await qrcode.toString(qr, { errorCorrectionLevel: 'L' });
        console.log(qrAscii);
        await qrcode.toFile(QR_PATH, qr);
        console.log('QR saved to: ./' + QR_PATH);
      } catch (err) {
        console.log('QR error:', err.message);
      }
      console.log('\n===========================================');
      return;
    }
    
    console.log('\n[UPDATE] connection:', connection);
    
    if (connection === 'open') {
      myNumber = sock.user?.id?.split(':')[0];
      console.log('\n✅ CONNECTED! Number:', myNumber);
      startServer();
    }
    
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('\n❌ Connection closed. Code:', code);
      if (code !== DisconnectReason.loggedOut) {
        console.log('Reconnecting in 5 seconds...');
        setTimeout(startBot, 5000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const text = msg.message?.conversation?.[0] || msg.message?.extendedTextMessage?.text;
      if (text?.startsWith('!')) {
        console.log('[CMD]', text);
      }
    }
  });
}

function startServer() {
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    if (parsed.pathname === '/qr' && fs.existsSync(QR_PATH)) {
      const imgBase64 = fs.readFileSync(QR_PATH).toString('base64');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="text-align:center;background:#111;color:#fff;font-family:Arial;">
        <h1 style="color:#25D366">WhatsApp QR</h1>
        <img src="data:image/png;base64,${imgBase64}" style="max-width:100%;border:4px solid #25D366">
        <p>Scan with WhatsApp</p>
      </body></html>`);
    } else if (parsed.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', number: myNumber }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n🌐 Server: http://localhost:' + PORT);
  });
}

console.log('=== WhatsApp Bot v2 ===\n');
startBot();
