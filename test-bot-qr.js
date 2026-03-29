const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');

const PORT = 42620;
const QR_PATH = 'qr-code-test.png';

let currentQR = null;

function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;
    
    if (req.method === 'GET' && pathname === '/qr') {
      if (fs.existsSync(QR_PATH)) {
        const imgBase64 = fs.readFileSync(QR_PATH).toString('base64');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp QR Code</title>
  <style>
    body { font-family: Arial; text-align: center; padding: 20px; background: #111; color: #fff; }
    h1 { color: #25D366; }
    img { max-width: 100%; border: 4px solid #25D366; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>WhatsApp QR Code</h1>
  <img src="data:image/png;base64,${imgBase64}" alt="QR">
  <p>Scan with WhatsApp!</p>
</body>
</html>`);
      } else {
        res.writeHead(200);
        res.end('QR not ready');
      }
      return;
    }
    
    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    
    res.writeHead(404);
    res.end('Not found');
  });
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nServer running on http://0.0.0.0:${PORT}`);
    console.log(`QR page: http://localhost:${PORT}/qr\n`);
  });
}

async function simulateQRLogin() {
  console.log('=== WhatsApp Bot QR Test ===\n');
  console.log('This simulates the QR code generation process.\n');
  
  const testQR = `test-auth-${Date.now()}`;
  currentQR = testQR;
  
  console.log('1. Generating ASCII QR...');
  try {
    const ascii = await qrcode.toString(currentQR, { errorCorrectionLevel: 'L' });
    console.log(ascii);
    console.log('ASCII QR: OK\n');
  } catch (err) {
    console.log('ERROR:', err.message);
    return;
  }
  
  console.log('2. Saving QR to file...');
  try {
    await qrcode.toFile(QR_PATH, currentQR);
    console.log('File saved:', QR_PATH);
    console.log('File size:', fs.statSync(QR_PATH).size, 'bytes\n');
  } catch (err) {
    console.log('ERROR:', err.message);
    return;
  }
  
  console.log('3. Starting HTTP server for QR display...');
  startServer();
  
  console.log('4. Testing buffer generation (for WhatsApp message)...');
  try {
    const buffer = await qrcode.toBuffer(currentQR);
    console.log('Buffer size:', buffer.length, 'bytes\n');
  } catch (err) {
    console.log('ERROR:', err.message);
  }
  
  console.log('=== TEST COMPLETE ===');
  console.log('\nAll QR operations work correctly!');
  console.log('The bot will generate real QR codes when connecting to WhatsApp.');
}

simulateQRLogin();
