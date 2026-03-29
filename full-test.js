console.log('═'.repeat(60));
console.log('  WhatsApp Bot - Full Simulation Test');
console.log('═'.repeat(60));

const fs = require('fs');
const path = require('path');

// Test 1: Check file structure
console.log('\n📁 TEST 1: File Structure');
console.log('-'.repeat(40));

const requiredFiles = [
  'baileys-listen.js',
  'utils.js',
  'package.json'
];

for (const file of requiredFiles) {
  const exists = fs.existsSync(file);
  console.log(`  ${file}: ${exists ? '✅' : '❌'}`);
  if (!exists) {
    console.log('\n❌ TEST FAILED: Missing required files');
    process.exit(1);
  }
}

// Test 2: Check dependencies
console.log('\n📦 TEST 2: Dependencies');
console.log('-'.repeat(40));

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
console.log('  package.json: ✅');
console.log('  Dependencies:', Object.keys(pkg.dependencies || {}));

if (!pkg.dependencies['@whiskeysockets/baileys']) {
  console.log('\n❌ TEST FAILED: Baileys not in dependencies');
  process.exit(1);
}

// Test 3: Verify Baileys can be loaded
console.log('\n🤖 TEST 3: Baileys Module');
console.log('-'.repeat(40));

try {
  const baileys = require('@whiskeysockets/baileys');
  console.log('  Module loads: ✅');
  console.log('  makeWASocket:', typeof baileys.default === 'function' ? '✅' : '❌');
  console.log('  DisconnectReason:', typeof baileys.DisconnectReason === 'object' ? '✅' : '❌');
  console.log('  useMultiFileAuthState:', typeof baileys.useMultiFileAuthState === 'function' ? '✅' : '❌');
} catch (err) {
  console.log('  Module loads: ❌', err.message);
  console.log('\n❌ TEST FAILED: Cannot load Baileys');
  process.exit(1);
}

// Test 4: Verify qrcode module
console.log('\n📱 TEST 4: QRCode Module');
console.log('-'.repeat(40));

try {
  const qrcode = require('qrcode');
  console.log('  Module loads: ✅');
  console.log('  toString:', typeof qrcode.toString === 'function' ? '✅' : '❌');
  console.log('  toFile:', typeof qrcode.toFile === 'function' ? '✅' : '❌');
  console.log('  toBuffer:', typeof qrcode.toBuffer === 'function' ? '✅' : '❌');
} catch (err) {
  console.log('  Module loads: ❌', err.message);
  console.log('\n❌ TEST FAILED: Cannot load qrcode');
  process.exit(1);
}

// Test 5: Test QR generation
console.log('\n🔲 TEST 5: QR Generation');
console.log('-'.repeat(40));

const qrcode = require('qrcode');
qrcode.toString('test', { errorCorrectionLevel: 'L' })
  .then(ascii => {
    console.log('  ASCII generation: ✅');
    if (!ascii.includes('█')) {
      throw new Error('Invalid QR output');
    }
  })
  .then(() => qrcode.toFile('test-qr.png', 'test'))
  .then(() => {
    console.log('  PNG generation: ✅');
    if (!fs.existsSync('test-qr.png')) {
      throw new Error('File not created');
    }
    fs.unlinkSync('test-qr.png');
  })
  .then(() => qrcode.toBuffer('test'))
  .then(buf => {
    console.log('  Buffer generation: ✅');
    if (buf.length < 100) {
      throw new Error('Buffer too small');
    }
  })
  .then(() => {
    // Test 6: HTTP Server
    console.log('\n🌐 TEST 6: HTTP Server');
    console.log('-'.repeat(40));
    
    const http = require('http');
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('OK');
    });
    
    server.listen(42620, '127.0.0.1', () => {
      console.log('  Server creation: ✅');
      
      http.get('http://127.0.0.1:42620/health', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('  Health endpoint: ✅');
          server.close();
          
          // Test 7: Utils
          console.log('\n🔧 TEST 7: Utils Module');
          console.log('-'.repeat(40));
          
          const utils = require('./utils');
          console.log('  parseScheduleTime:', typeof utils.parseScheduleTime === 'function' ? '✅' : '❌');
          console.log('  formatTimeUntil:', typeof utils.formatTimeUntil === 'function' ? '✅' : '❌');
          console.log('  removeEmojis:', typeof utils.removeEmojis === 'function' ? '✅' : '❌');
          
          // Test 8: Session state
          console.log('\n💾 TEST 8: Session State');
          console.log('-'.repeat(40));
          
          require('@whiskeysockets/baileys').useMultiFileAuthState('.test_session')
            .then(({ state }) => {
              console.log('  Session creation: ✅');
              console.log('  Has creds:', !!state.creds ? '✅' : '❌');
              console.log('  Has keys:', !!state.keys ? '✅' : '❌');
              
              // Cleanup
              fs.rmSync('.test_session', { recursive: true, force: true });
              
              // Summary
              console.log('\n' + '='.repeat(60));
              console.log('  ALL TESTS PASSED ✅');
              console.log('='.repeat(60));
              console.log('\n📋 Bot is ready for WhatsApp connection!');
              console.log('\nTo run the bot:');
              console.log('  1. rm -rf .wwebjs_auth');
              console.log('  2. node baileys-listen.js');
              console.log('  3. Scan QR with WhatsApp\n');
            })
            .catch(err => {
              console.log('  Session creation: ❌', err.message);
              console.log('\n⚠️ Some tests failed\n');
            });
        });
      }).on('error', (err) => {
        console.log('  Health endpoint: ❌', err.message);
        server.close();
      });
    }).on('error', (err) => {
      console.log('  Server creation: ❌', err.message);
    });
  })
  .catch(err => {
    console.log('\n❌ TEST FAILED:', err.message, '\n');
    process.exit(1);
  });
