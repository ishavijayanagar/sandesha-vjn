const http = require('http');
const { URL } = require('url');

const BASE_URL = 'http://127.0.0.1:42620';
const TEST_PASSWORD = process.env.SANDESHA_ADMIN_PASSWORD || process.env.TEST_AUTH_PASSWORD || '';

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(path, BASE_URL);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers,
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

  let authRequired = false;
  let sharedToken = null;

  async function getAuthToken() {
    if (!authRequired) return null;
    if (sharedToken) return sharedToken;
    if (!TEST_PASSWORD) return null;
    const login = await request('POST', '/auth/login', { password: TEST_PASSWORD });
    sharedToken = login.data?.token || null;
    return sharedToken;
  }

  await test('GET /health - Reports authRequired', async () => {
    const res = await request('GET', '/health');
    authRequired = res.data && res.data.authRequired === true;
    return res.status === 200 && typeof res.data.authRequired === 'boolean';
  });

  if (authRequired) {
    console.log('');
    console.log('--- Test Suite: Auth (server has SANDESHA_ADMIN_PASSWORD set) ---');
    console.log('');

    await test('GET /groups - Returns 401 without token', async () => {
      const res = await request('GET', '/groups');
      return res.status === 401;
    });

    if (TEST_PASSWORD) {
      let authToken = null;

      await test('POST /auth/login - Returns token with valid password', async () => {
        const res = await request('POST', '/auth/login', { password: TEST_PASSWORD });
        if (res.status === 200 && res.data.token) {
          authToken = res.data.token;
          return true;
        }
        return false;
      });

      await test('GET /groups - Works with Bearer token', async () => {
        if (!authToken) return false;
        const res = await request('GET', '/groups', null, authToken);
        return res.status === 200 && Array.isArray(res.data);
      });
    } else {
      console.log('  (Skip login tests — set TEST_AUTH_PASSWORD or SANDESHA_ADMIN_PASSWORD env var)');
    }
  } else {
    console.log('');
    console.log('--- Auth disabled or no password — skipping 401/login tests ---');
    console.log('');
  }

  await test('GET /groups - Returns groups array', async () => {
    const token = await getAuthToken();
    const res = await request('GET', '/groups', null, token);
    if (authRequired && !token) return res.status === 401;
    return res.status === 200 && Array.isArray(res.data);
  });

  await test('GET /groups - Groups have required fields', async () => {
    const token = await getAuthToken();
    const res = await request('GET', '/groups', null, token);
    if (authRequired && !token) return res.status === 401;
    if (Array.isArray(res.data) && res.data.length > 0) {
      const g = res.data[0];
      return g.name && g.jid;
    }
    return res.status === 200;
  });

  await test('GET /chats - Returns chats', async () => {
    const token = await getAuthToken();
    const res = await request('GET', '/chats', null, token);
    if (authRequired && !token) return res.status === 401;
    return res.status === 200;
  });

  await test('GET /chats - Supports limit parameter', async () => {
    const token = await getAuthToken();
    const res = await request('GET', '/chats?limit=5', null, token);
    if (authRequired && !token) return res.status === 401;
    return res.status === 200 && res.data.chats.length <= 5;
  });

  await test('POST /send - Missing body returns 400', async () => {
    const token = await getAuthToken();
    const res = await request('POST', '/send', {}, token);
    if (authRequired && !token) return res.status === 401;
    return res.status === 400;
  });

  await test('POST /send - Valid request structure', async () => {
    const token = await getAuthToken();
    const res = await request('POST', '/send', { message: 'test' }, token);
    if (authRequired && !token) return res.status === 401;
    return res.status === 400 || res.status === 500;
  });

  await test('POST /send-media - Missing body returns 400', async () => {
    const token = await getAuthToken();
    const res = await request('POST', '/send-media', {}, token);
    if (authRequired && !token) return res.status === 401;
    return res.status === 400;
  });

  await test('Unknown endpoint returns 404', async () => {
    const res = await request('GET', '/unknown');
    return res.status === 404;
  });

  console.log('');
  console.log('--- Test Suite: Extended API routes ---');
  console.log('');

  await test('GET /schedules - Returns schedules', async () => {
    const token = await getAuthToken();
    const res = await request('GET', '/schedules', null, token);
    if (authRequired && !token) return res.status === 401;
    return res.status === 200 && Array.isArray(res.data.schedules);
  });

  await test('GET /contacts - Returns contacts object', async () => {
    const token = await getAuthToken();
    const res = await request('GET', '/contacts', null, token);
    if (authRequired && !token) return res.status === 401;
    return res.status === 200;
  });

  await test('GET /ai/status - Returns availability', async () => {
    const token = await getAuthToken();
    const res = await request('GET', '/ai/status', null, token);
    if (authRequired && !token) return res.status === 401;
    return res.status === 200 && typeof res.data.available === 'boolean';
  });

  await test('POST /send/bulk - Missing message returns 400', async () => {
    const token = await getAuthToken();
    const res = await request('POST', '/send/bulk', { numbers: ['123'] }, token);
    if (authRequired && !token) return res.status === 401;
    return res.status === 400;
  });

  await test('GET /groups/inactive - Returns array', async () => {
    const token = await getAuthToken();
    const res = await request('GET', '/groups/inactive?days=30', null, token);
    if (authRequired && !token) return res.status === 401;
    return res.status === 200 && Array.isArray(res.data);
  });

  await test('POST /upload - Missing body returns 400', async () => {
    const token = await getAuthToken();
    return new Promise(async (resolve) => {
      const headers = { 'Content-Type': 'multipart/form-data; boundary=----test' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const options = {
        hostname: '127.0.0.1',
        port: 42620,
        path: '/upload',
        method: 'POST',
        headers,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (authRequired && !token) resolve(res.statusCode === 401);
          else resolve(res.statusCode === 400);
        });
      });
      req.on('error', () => resolve(false));
      req.end('------test--\r\n\r\n');
    });
  });

  console.log('');
  console.log('--- Test Suite: Error Handling ---');
  console.log('');

  await test('Invalid JSON body handles gracefully', async () => {
    return new Promise(async (resolve) => {
      const token = await getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const options = {
        hostname: '127.0.0.1',
        port: 42620,
        path: '/send',
        method: 'POST',
        headers,
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
