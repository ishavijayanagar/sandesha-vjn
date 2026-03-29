const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
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
  console.log('\n🚀 Starting WhatsApp Bot...\n');
  
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  
  console.log('📁 Session state loaded');
  console.log('   Has existing creds:', !!state.creds && Object.keys(state.creds).length > 0);
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    console.log('\n📡 CONNECTION UPDATE:');
    console.log('   connection:', connection);
    console.log('   has QR:', !!qr);
    
    if (qr) {
      currentQR = qr;
      console.log('\n🎉 QR CODE RECEIVED!\n');
      console.log('═'.repeat(50));
      console.log('    SCAN THIS QR CODE WITH WHATSAPP!');
      console.log('═'.repeat(50) + '\n');
      
      qrcode.toString(qr, { errorCorrectionLevel: 'L' })
        .then(ascii => {
          console.log(ascii);
        })
        .catch(err => {
          console.log('ASCII QR error:', err.message);
        });
      
      qrcode.toFile(QR_PATH, qr)
        .then(() => {
          console.log('📷 QR saved to: ./' + QR_PATH);
          console.log('🌐 View in browser: http://localhost:' + PORT + '/qr\n');
        })
        .catch(err => {
          console.log('QR file error:', err.message);
        });
      
      console.log('═'.repeat(50) + '\n');
    }
    
    if (connection === 'open') {
      myNumber = sock.user?.id?.split(':')[0];
      console.log('\n✅ CONNECTED! Phone:', myNumber);
      startServer();
    }
    
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason = DisconnectReason[code] || code;
      console.log('\n❌ Connection closed:', reason);
      
      if (code !== DisconnectReason.loggedOut) {
        console.log('   Reconnecting in 10 seconds...\n');
        setTimeout(startBot, 10000);
      }
    }
  });

  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const text = msg.message?.conversation?.[0] || msg.message?.extendedTextMessage?.text;
      if (text?.startsWith('!')) {
        console.log('\n📩 COMMAND:', text);
      }
    }
  });
}

function startServer() {
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    
    if (parsed.pathname === '/qr') {
      if (fs.existsSync(QR_PATH)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        const img = fs.readFileSync(QR_PATH).toString('base64');
        res.end(`<html><body style="text-align:center;background:#111;color:#fff;font-family:Arial;padding:50px">
          <h1 style="color:#25D366">WhatsApp QR Code</h1>
          <img src="data:image/png;base64,${img}" style="max-width:400px;border:4px solid #25D366;border-radius:8px">
          <p style="color:#888">Scan with WhatsApp</p>
        </body></html>`);
      } else {
        res.writeHead(200);
        res.end('QR not ready yet');
      }
      return;
    }
    
    if (parsed.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', number: myNumber }));
      return;
    }
    
    res.writeHead(404);
    res.end('Not found');
  });
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log('🌐 Server running on http://localhost:' + PORT);
    console.log('   QR page: http://localhost:' + PORT + '/qr');
    console.log('   Health:  http://localhost:' + PORT + '/health\n');
  });
}

console.log('═'.repeat(50));
console.log('  WhatsApp Bot v2.0');
console.log('═'.repeat(50));

startBot();
