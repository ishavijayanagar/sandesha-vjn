const { spawn } = require('child_process');
const path = require('path');

console.log('='.repeat(60));
console.log('SANDESHA BOT - FULL TEST SUITE');
console.log('='.repeat(60));
console.log('');

let testsFailed = false;

function runTest(name, script) {
  return new Promise((resolve) => {
    console.log(`\n>>> Running: ${name}`);
    console.log('-'.repeat(40));
    
    const proc = spawn('node', [script], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.log(`\n❌ ${name} failed with code ${code}`);
        testsFailed = true;
      }
      resolve(code);
    });
  });
}

async function main() {
  await runTest('Unit Tests', './tests/run-tests.js');
  
  console.log('\n' + '='.repeat(60));
  console.log('FULL TEST SUITE COMPLETE');
  console.log('='.repeat(60));
  
  if (testsFailed) {
    console.log('\n⚠️  Some tests failed.');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
  }
}

main();
