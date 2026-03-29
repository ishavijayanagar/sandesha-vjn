const qrcode = require('qrcode');
const fs = require('fs');

async function testQR() {
  console.log('=== QR Code Test ===\n');
  
  const testData = 'test-whatsapp-auth-data-12345';
  
  console.log('1. Testing ASCII QR generation...');
  try {
    const ascii = await qrcode.toString(testData, { errorCorrectionLevel: 'L' });
    console.log('ASCII QR generated successfully:');
    console.log(ascii.substring(0, 200) + '...\n');
  } catch (err) {
    console.log('ERROR: ASCII generation failed:', err.message);
    return false;
  }
  
  console.log('2. Testing PNG file generation...');
  try {
    await qrcode.toFile('test-output.png', testData);
    const exists = fs.existsSync('test-output.png');
    console.log('PNG file created:', exists);
    if (exists) {
      const stats = fs.statSync('test-output.png');
      console.log('File size:', stats.size, 'bytes');
    }
  } catch (err) {
    console.log('ERROR: PNG generation failed:', err.message);
    return false;
  }
  
  console.log('3. Testing buffer generation...');
  try {
    const buffer = await qrcode.toBuffer(testData);
    console.log('Buffer generated, size:', buffer.length, 'bytes');
  } catch (err) {
    console.log('ERROR: Buffer generation failed:', err.message);
    return false;
  }
  
  console.log('\n=== All QR tests passed! ===\n');
  return true;
}

testQR().then(success => {
  process.exit(success ? 0 : 1);
});
