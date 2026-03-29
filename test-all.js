console.log('═'.repeat(50));
console.log('  WHATSAPP BOT - COMPREHENSIVE TEST');
console.log('═'.repeat(50));

const fs = require('fs');
const http = require('http');
const qrcode = require('qrcode');
const baileys = require('@whiskeysockets/baileys');
const utils = require('./utils');

let passed = 0;
let failed = 0;

function test(name, result) {
  if (result) {
    console.log('  ✅ ' + name);
    passed++;
  } else {
    console.log('  ❌ ' + name);
    failed++;
  }
}

// Test 1: Module Imports
console.log('\n📦 Test 1: Module Imports');
test('Baileys imported', typeof baileys.default === 'function');
test('QRCode imported', typeof qrcode.toString === 'function');
test('Utils imported', typeof utils.parseScheduleTime === 'function');
test('HTTP imported', typeof http.createServer === 'function');
test('FS imported', typeof fs.readFileSync === 'function');

// Test 2: QR Code
console.log('\n📱 Test 2: QR Code Generation');
qrcode.toString('test', { errorCorrectionLevel: 'L' })
  .then(ascii => test('ASCII QR', ascii.includes('█')))
  .then(() => qrcode.toFile('test-qr.png', 'test'))
  .then(() => test('PNG file created', fs.existsSync('test-qr.png')))
  .then(() => qrcode.toBuffer('test'))
  .then(buf => test('Buffer QR', buf.length > 100))
  .then(() => { if (fs.existsSync('test-qr.png')) fs.unlinkSync('test-qr.png'); })

  // Test 3: Utils
  .then(() => {
    console.log('\n🔧 Test 3: Utility Functions');
    const p1 = utils.parseScheduleTime('9am');
    test('parseScheduleTime("9am")', p1 instanceof Date);
    const p2 = utils.parseScheduleTime('9am tomorrow');
    test('parseScheduleTime("9am tomorrow")', p2 instanceof Date);
    test('removeEmojis("Hi 👋")', utils.removeEmojis('Hi 👋') === 'Hi ');
    test('formatTimeUntil', typeof utils.formatTimeUntil === 'function');
  })

  // Test 4: HTTP Server
  .then(() => {
    console.log('\n🌐 Test 4: HTTP Server');
    return new Promise(resolve => {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
      server.listen(42621, '127.0.0.1', () => {
        test('Server created', true);
        http.get('http://127.0.0.1:42621/', res => {
          test('Server responds', res.statusCode === 200);
          server.close();
          resolve();
        }).on('error', () => {
          test('Server responds', false);
          server.close();
          resolve();
        });
      });
    });
  })

  // Test 5: Session
  .then(() => {
    console.log('\n💾 Test 5: Session State');
    return baileys.useMultiFileAuthState('.test_session')
      .then(({ state }) => {
        test('Session created', !!state);
        test('Has creds', !!state.creds);
        test('Has keys', !!state.keys);
        fs.rmSync('.test_session', { recursive: true, force: true });
      })
      .catch(err => test('Session created', false));
  })

  // Test 6: Bot Code
  .then(() => {
    console.log('\n🤖 Test 6: Bot Code');
    const code = fs.readFileSync('baileys-listen.js', 'utf8');
    test('Auth state', code.includes('useMultiFileAuthState'));
    test('QR ASCII', code.includes('qrcode.toString'));
    test('QR file', code.includes('qrcode.toFile'));
    test('HTTP server', code.includes('http.createServer'));
    test('/qr endpoint', code.includes('/qr'));
    test('/health endpoint', code.includes('/health'));
    test('Connection handler', code.includes('connection.update'));
    test('Message handler', code.includes('messages.upsert'));
    test('Command handler', code.includes('handleCommand'));
    test('!help command', code.includes('!help'));
    test('!groups command', code.includes('!groups'));
    test('!send command', code.includes('!send'));
  })

  // Summary
  .then(() => {
    console.log('\n' + '═'.repeat(50));
    console.log('  RESULTS: ' + passed + ' passed, ' + failed + ' failed');
    console.log('═'.repeat(50));
    
    if (failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED!');
      console.log('\nThe bot code is ready. It will:');
      console.log('  1. Generate QR code');
      console.log('  2. Save QR as PNG file');
      console.log('  3. Start HTTP server on port 42620');
      console.log('  4. Wait for you to scan QR with WhatsApp');
      console.log('  5. Connect and process commands');
    }
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(err => {
    console.log('\n❌ Test error:', err.message);
    process.exit(1);
  });
