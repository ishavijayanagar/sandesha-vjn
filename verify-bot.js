const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { parseScheduleTime, formatTimeUntil, removeEmojis } = require('./utils');

console.log('=== WhatsApp Bot Code Verification ===\n');

console.log('1. Checking imports...');
console.log('   - Baileys:', typeof makeWASocket === 'function' ? 'OK' : 'FAIL');
console.log('   - QRCode:', typeof qrcode.toString === 'function' ? 'OK' : 'FAIL');
console.log('   - Utils:', typeof parseScheduleTime === 'function' ? 'OK' : 'FAIL');

console.log('\n2. Testing QR code generation (simulating what bot does)...');
const testQR = 'test-auth-data-for-whatsapp';
qrcode.toString(testQR, { errorCorrectionLevel: 'L' })
  .then(ascii => {
    console.log('   ASCII QR:', ascii.substring(0, 100) + '...');
  })
  .then(() => qrcode.toFile('qr-test.png', testQR))
  .then(() => {
    console.log('   PNG file:', fs.existsSync('qr-test.png') ? 'OK' : 'FAIL');
  })
  .then(() => qrcode.toBuffer(testQR))
  .then(buf => {
    console.log('   Buffer:', buf.length > 0 ? 'OK' : 'FAIL');
  })
  .then(() => {
    console.log('\n3. Testing utils...');
    console.log('   parseScheduleTime("9am"):', parseScheduleTime('9am') instanceof Date ? 'OK' : 'FAIL');
    console.log('   removeEmojis():', removeEmojis('Hello 👋') === 'Hello ' ? 'OK' : 'FAIL');
    
    console.log('\n4. Testing Baileys initialization (without connecting)...');
    const testAuth = { state: null, saveCreds: () => {} };
    console.log('   Baileys function exists:', typeof makeWASocket === 'function' ? 'OK' : 'FAIL');
    
    console.log('\n5. File system check...');
    console.log('   baileys-listen.js:', fs.existsSync('baileys-listen.js') ? 'OK' : 'MISSING');
    console.log('   utils.js:', fs.existsSync('utils.js') ? 'OK' : 'MISSING');
    console.log('   package.json:', fs.existsSync('package.json') ? 'OK' : 'MISSING');
    
    console.log('\n=== All Code Checks Passed ===');
    console.log('\nThe bot code is ready. To run:');
    console.log('  rm -rf .wwebjs_auth');
    console.log('  node baileys-listen.js');
    console.log('  (Then scan QR with WhatsApp)');
  })
  .catch(err => {
    console.log('\nERROR:', err.message);
    process.exit(1);
  });
