const http = require('http');
const { URL } = require('url');

const BASE_URL = 'http://127.0.0.1:42620';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(path, BASE_URL);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        resolve({ status: 0, data: null, error: 'Connection refused - is listen.js running?' });
      } else {
        resolve({ status: 0, data: null, error: err.message });
      }
    });

    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('SANDESHA BOT - HTTP ENDPOINT TESTS');
  console.log('='.repeat(60));
  console.log('');
  console.log('Note: These tests require listen.js to be running!');
  console.log('Run: node listen.js');
  console.log('');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      const result = await fn();
      if (result) {
        console.log(`✅ PASS: ${name}`);
        passed++;
      } else {
        console.log(`❌ FAIL: ${name}`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ FAIL: ${name} - ${err.message}`);
      failed++;
    }
  }

  console.log('--- Test Suite: HTTP Endpoints ---');
  console.log('');

  await test('GET /health - Server is running', async () => {
    const res = await request('GET', '/health');
    return res.status === 200;
  });

  await test('GET /health - Returns status', async () => {
    const res = await request('GET', '/health');
    return res.status === 200 && res.data.status === 'ok';
  });

  await test('GET /groups - Returns groups array', async () => {
    const res = await request('GET', '/groups');
    return res.status === 200 && Array.isArray(res.data);
  });

  await test('GET /groups - Groups have required fields', async () => {
    const res = await request('GET', '/groups');
    if (res.data.length > 0) {
      const g = res.data[0];
      return g.name && g.jid;
    }
    return true;
  });

  await test('GET /chats - Returns chats', async () => {
    const res = await request('GET', '/chats');
    return res.status === 200;
  });

  await test('GET /chats - Supports limit parameter', async () => {
    const res = await request('GET', '/chats?limit=5');
    return res.status === 200 && res.data.chats.length <= 5;
  });

  await test('POST /send - Missing body returns 400', async () => {
    const res = await request('POST', '/send', {});
    return res.status === 400;
  });

  await test('POST /send - Valid request structure', async () => {
    const res = await request('POST', '/send', {
      message: 'test'
    });
    return res.status === 400 || res.status === 500;
  });

  await test('POST /send-media - Missing body returns 400', async () => {
    const res = await request('POST', '/send-media', {});
    return res.status === 400;
  });

  await test('Unknown endpoint returns 404', async () => {
    const res = await request('GET', '/unknown');
    return res.status === 404;
  });

  console.log('');
  console.log('--- Test Suite: Error Handling ---');
  console.log('');

  await test('Invalid JSON body handles gracefully', async () => {
    return new Promise((resolve) => {
      const options = {
        hostname: '127.0.0.1',
        port: 42620,
        path: '/send',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve(res.statusCode >= 400);
        });
      });

      req.on('error', () => resolve(false));
      req.write('invalid json');
      req.end();
    });
  });

  console.log('');
  console.log('='.repeat(60));
  console.log('HTTP TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log('\n⚠️  Some tests failed.');
    console.log('Make sure listen.js is running before these tests.');
    process.exit(1);
  } else {
    console.log('\n🎉 All HTTP endpoint tests passed!');
  }
}

runTests();
