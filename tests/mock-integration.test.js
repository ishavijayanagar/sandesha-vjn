const http = require('http');
const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(__dirname, 'test-data');
const TEST_GROUPS = path.join(TEST_DIR, 'groups.json');
const TEST_SCHEDULES = path.join(TEST_DIR, 'schedules.json');
const TEST_CONTACTS = path.join(TEST_DIR, 'contacts.json');

function setup() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function loadSets() {
  try { return JSON.parse(fs.readFileSync(TEST_GROUPS, 'utf8')); } catch { return {}; }
}

function saveSets(data) {
  fs.writeFileSync(TEST_GROUPS, JSON.stringify(data, null, 2));
}

function loadSchedules() {
  try { return JSON.parse(fs.readFileSync(TEST_SCHEDULES, 'utf8')); } catch { return []; }
}

function saveSchedules(data) {
  fs.writeFileSync(TEST_SCHEDULES, JSON.stringify(data, null, 2));
}

function loadContacts() {
  try { return JSON.parse(fs.readFileSync(TEST_CONTACTS, 'utf8')); } catch { return { contacts: {} }; }
}

function saveContacts(data) {
  fs.writeFileSync(TEST_CONTACTS, JSON.stringify(data, null, 2));
}

function resolveContact(name) {
  const contacts = loadContacts();
  const nameLower = name.toLowerCase();
  for (const [key, number] of Object.entries(contacts.contacts)) {
    if (key.toLowerCase() === nameLower || number.toLowerCase().includes(nameLower)) {
      return number;
    }
  }
  return null;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Mock WhatsApp Client
class MockMessage {
  constructor(data) {
    Object.assign(this, data);
  }
  async getChat() {
    return this.chat || new MockChat({ name: 'Test Group' });
  }
}

class MockChat {
  constructor(data) {
    Object.assign(this, data);
    this.isGroup = this.isGroup !== false;
  }
  async sendMessage(text) {
    return { id: { _serialized: 'mock-id' } };
  }
  async fetchMessages() {
    return this.messages || [];
  }
}

class MockClient {
  constructor() {
    this.info = { wid: { _serialized: 'test@c.us' } };
    this.sentMessages = [];
  }
  async getChatById(jid) {
    return new MockChat({ jid, name: 'Test Group', messages: [] });
  }
  async sendMessage(jid, text) {
    this.sentMessages.push({ jid, text });
    return { id: { _serialized: 'mock-' + Date.now() } };
  }
}

// Mock functions from listen.js
async function botReply(msg, text) {
  if (!msg || !msg.from) return null;
  try {
    const chat = await msg.getChat();
    const result = await chat.sendMessage(text);
    return result;
  } catch (err) {
    console.error('[botReply error]', err.message);
    return null;
  }
}

async function sendToTarget(target, message, msg, silent = false) {
  const client = new MockClient();
  const sets = loadSets();
  
  let targetJid = target;
  
  // Check if target is a group set
  const setGroups = sets[target.toLowerCase()];
  if (setGroups && Array.isArray(setGroups)) {
    // Send to each group in set
    for (const group of setGroups) {
      await client.sendMessage(group, message);
    }
    return { type: 'set', count: setGroups.length };
  }
  
  // Check if target is a contact
  const contact = resolveContact(target);
  if (contact) {
    targetJid = contact;
  }
  
  // Check if it's a valid JID
  if (!targetJid.includes('@')) {
    targetJid = targetJid + '@c.us';
  }
  
  await client.sendMessage(targetJid, message);
  return { type: 'single', target: targetJid };
}

async function handleNaturalSchedule(message, schedulePart, msg) {
  // Extract target and time from schedulePart
  const timeMatch = schedulePart.match(/to\s+(\w+)\s+at\s+(.+)/i);
  if (!timeMatch) {
    return { error: 'Invalid schedule format. Use: <message> !schedule to <target> at <time>' };
  }
  
  const target = timeMatch[1];
  const timeStr = timeMatch[2];
  
  // Parse time - use a simple parser for testing
  const runAt = parseTimeSimple(timeStr);
  if (!runAt) {
    return { error: 'Invalid time format' };
  }
  
  const schedule = {
    id: Date.now(),
    message: message,
    target: target,
    runAt: runAt.toISOString(),
    createdAt: new Date().toISOString()
  };
  
  const schedules = loadSchedules();
  schedules.push(schedule);
  saveSchedules(schedules);
  
  return { success: true, schedule };
}

function parseTimeSimple(timeStr) {
  const now = new Date();
  const lower = timeStr.toLowerCase().trim();
  
  // Simple hour:minute parsing
  const match = lower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/);
  if (!match) return null;
  
  let hours = parseInt(match[1]);
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const period = match[3]?.toLowerCase();
  
  if (period === 'pm' && hours < 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;
  
  const result = new Date();
  result.setHours(hours, minutes, 0, 0);
  
  // If time has passed today, schedule for tomorrow
  if (result <= now) {
    result.setDate(result.getDate() + 1);
  }
  
  return result;
}

// HTTP Server mock for testing
function createMockHttpServer() {
  const NOTIFY_FILE = path.join(TEST_DIR, 'notify.log');
  
  function startSendServer(port = 42620) {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:${port}`);
        
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }
        
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            if (url.pathname === '/health') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
            }
            else if (url.pathname === '/groups') {
              const sets = loadSets();
              const groups = Object.entries(sets).flatMap(([key, vals]) => 
                vals.map(g => ({ name: g, key }))
              );
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(groups));
            }
            else if (url.pathname === '/send') {
              if (!body || !body.trim()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing message body' }));
                return;
              }
              
              let data;
              try {
                data = JSON.parse(body);
              } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
                return;
              }
              
              if (!data.message) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing message' }));
                return;
              }
              
              const client = new MockClient();
              await client.sendMessage('test@c.us', data.message);
              
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            }
            else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Not found' }));
            }
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
      
      server.listen(port, () => {
        console.log(`[TEST] HTTP server started on port ${port}`);
        resolve(server);
      });
      
      server.on('error', (err) => {
        reject(err);
      });
    });
  }
  
  return { startSendServer, NOTIFY_FILE };
}

// Test counters
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.log(`❌ FAIL: ${testName}`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, testName) {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (passed) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.log(`❌ FAIL: ${testName}`);
    console.log(`   Expected: ${JSON.stringify(expected)}`);
    console.log(`   Actual:   ${JSON.stringify(actual)}`);
    testsFailed++;
  }
}

function assertContains(actual, expected, testName) {
  const passed = actual.includes(expected);
  if (passed) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.log(`❌ FAIL: ${testName}`);
    console.log(`   Expected to contain: ${expected}`);
    console.log(`   Actual:   ${actual}`);
    testsFailed++;
  }
}

function assertThrows(fn, testName) {
  try {
    fn();
    console.log(`❌ FAIL: ${testName} - Expected to throw but didn't`);
    testsFailed++;
  } catch (err) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  }
}

async function runMockTests() {
  setup();
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        SANDESHA - MOCK-BASED INTEGRATION TESTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // ============================================
  // TEST SUITE 1: botReply Function
  // ============================================
  console.log('--- Test Suite 1: botReply Function ---');
  
  const mockMsg = new MockMessage({
    from: 'test@c.us',
    body: 'test',
    chat: new MockChat({ name: 'Test' })
  });
  
  let result = await botReply(mockMsg, 'Hello');
  assert(result !== null, 'botReply sends message successfully');
  
  // Test with null msg
  result = await botReply(null, 'Hello');
  assert(result === null, 'botReply handles null msg');
  
  // Test with missing from
  result = await botReply({ body: 'test' }, 'Hello');
  assert(result === null, 'botReply handles missing from');

  console.log('');

  // ============================================
  // TEST SUITE 2: sendToTarget Function
  // ============================================
  console.log('--- Test Suite 2: sendToTarget Function ---');
  
  // Setup test data
  saveSets({
    family: ['family-group-1@c.us', 'family-group-2@c.us'],
    work: ['work-group@c.us']
  });
  
  const msg = { from: 'me@c.us' };
  
  // Test sending to group set
  let response = await sendToTarget('family', 'Hello family', msg);
  assert(response.type === 'set', 'sendToTarget sends to group set');
  assert(response.count === 2, 'sendToTarget sends to correct number of groups');
  
  // Test sending to single target
  response = await sendToTarget('919844400000@c.us', 'Hello', msg);
  assert(response.type === 'single', 'sendToTarget sends to single target');
  
  // Test sending to contact
  saveContacts({ contacts: { john: '919844411111' } });
  response = await sendToTarget('john', 'Hello John', msg);
  assert(response.type === 'single', 'sendToTarget resolves contact');
  
  // Test invalid target (no @)
  response = await sendToTarget('invalid', 'Hello', msg);
  assert(response.type === 'single', 'sendToTarget handles invalid target');

  console.log('');

  // ============================================
  // TEST SUITE 3: handleNaturalSchedule Function
  // ============================================
  console.log('--- Test Suite 3: handleNaturalSchedule Function ---');
  
  // Clean schedules
  saveSchedules([]);
  
  // Test valid schedule
  let scheduleResult = await handleNaturalSchedule(
    'Hello world',
    '!schedule to family at 9am',
    msg
  );
  assert(scheduleResult.success === true, 'handleNaturalSchedule creates schedule');
  assert(scheduleResult.schedule.message === 'Hello world', 'handleNaturalSchedule saves message');
  assert(scheduleResult.schedule.target === 'family', 'handleNaturalSchedule saves target');
  
  // Verify schedule was saved
  let schedules = loadSchedules();
  assert(schedules.length === 1, 'handleNaturalSchedule saves to file');
  
  // Test invalid format
  scheduleResult = await handleNaturalSchedule(
    'Hello',
    'invalid-format',
    msg
  );
  assert(scheduleResult.error !== undefined, 'handleNaturalSchedule handles invalid format');
  
  // Test invalid time
  scheduleResult = await handleNaturalSchedule(
    'Hello',
    '!schedule to family at invalid-time',
    msg
  );
  assert(scheduleResult.error !== undefined, 'handleNaturalSchedule handles invalid time');

  console.log('');

  // ============================================
  // TEST SUITE 4: HTTP Server
  // ============================================
  console.log('--- Test Suite 4: HTTP Server ---');
  
  const { startSendServer, NOTIFY_FILE } = createMockHttpServer();
  
  let server;
  try {
    server = await startSendServer(42621);
    
    // Test /health endpoint
    const healthRes = await makeRequest('GET', 'http://127.0.0.1:42621/health');
    assert(healthRes.status === 200, 'HTTP /health returns 200');
    assert(healthRes.data.status === 'ok', 'HTTP /health returns ok status');
    
    // Test /groups endpoint
    const groupsRes = await makeRequest('GET', 'http://127.0.0.1:42621/groups');
    assert(groupsRes.status === 200, 'HTTP /groups returns 200');
    assert(Array.isArray(groupsRes.data), 'HTTP /groups returns array');
    
    // Test /send endpoint with valid data
    const sendRes = await makeRequest('POST', 'http://127.0.0.1:42621/send', {
      message: 'Test message'
    });
    assert(sendRes.status === 200, 'HTTP /send returns 200');
    assert(sendRes.data.success === true, 'HTTP /send returns success');
    
    // Test /send endpoint with missing body
    const sendRes400 = await makeRequest('POST', 'http://127.0.0.1:42621/send', null);
    assert(sendRes400.status === 400, 'HTTP /send returns 400 for missing body');
    
    // Test /send endpoint with missing message
    const sendRes400b = await makeRequest('POST', 'http://127.0.0.1:42621/send', {});
    assert(sendRes400b.status === 400, 'HTTP /send returns 400 for missing message');
    
    // Test invalid JSON
    const invalidRes = await makeRawRequest('POST', 'http://127.0.0.1:42621/send', 'invalid json');
    assert(invalidRes.status === 400, 'HTTP /send returns 400 for invalid JSON');
    
    // Test 404 endpoint
    const notFoundRes = await makeRequest('GET', 'http://127.0.0.1:42621/unknown');
    assert(notFoundRes.status === 404, 'HTTP returns 404 for unknown endpoint');
    
  } finally {
    if (server) {
      server.close();
    }
  }

  console.log('');

  // ============================================
  // TEST SUITE 5: Error Handling
  // ============================================
  console.log('--- Test Suite 5: Error Handling ---');
  
  // Test with corrupted JSON files
  fs.writeFileSync(TEST_GROUPS, 'invalid json');
  const corruptedSets = loadSets();
  assert(typeof corruptedSets === 'object', 'loadSets handles corrupted file');
  assert(Object.keys(corruptedSets).length === 0, 'loadSets returns empty for corrupted');
  
  fs.writeFileSync(TEST_SCHEDULES, 'invalid json');
  const corruptedSchedules = loadSchedules();
  assert(Array.isArray(corruptedSchedules), 'loadSchedules handles corrupted file');
  assert(corruptedSchedules.length === 0, 'loadSchedules returns empty for corrupted');
  
  fs.writeFileSync(TEST_CONTACTS, 'invalid json');
  const corruptedContacts = loadContacts();
  assert(typeof corruptedContacts === 'object', 'loadContacts handles corrupted file');
  assert(typeof corruptedContacts.contacts === 'object', 'loadContacts returns empty contacts');

  console.log('');

  // ============================================
  // TEST SUITE 6: Concurrent Operations
  // ============================================
  console.log('--- Test Suite 6: Concurrent Operations ---');
  
  // Test concurrent schedule creation
  saveSchedules([]);
  
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(handleNaturalSchedule(
      `Message ${i}`,
      `!schedule to target${i} at 9am`,
      msg
    ));
  }
  
  const results = await Promise.all(promises);
  const successCount = results.filter(r => r.success).length;
  assert(successCount === 10, 'Concurrent schedule creation works');
  
  schedules = loadSchedules();
  assert(schedules.length === 10, 'All concurrent schedules saved');

  console.log('');

  // ============================================
  // TEST SUITE 7: Data Integrity
  // ============================================
  console.log('--- Test Suite 7: Data Integrity ---');
  
  // Test that existing data is preserved
  saveSets({ test: ['group1', 'group2'] });
  saveSchedules([{ id: 1, message: 'test' }]);
  saveContacts({ contacts: { test: '123' } });
  
  // Run some operations
  await sendToTarget('test', 'hello', msg);
  await handleNaturalSchedule('test', '!schedule to test at 10am', msg);
  
  // Verify data integrity
  const setsAfter = loadSets();
  assert(setsAfter.test.length === 2, 'Groups data preserved after sendToTarget');
  
  const schedulesAfter = loadSchedules();
  assert(schedulesAfter.length === 2, 'Schedules data preserved');

  console.log('');

  // ============================================
  // TEST SUITE 8: parseTimeSimple Function
  // ============================================
  console.log('--- Test Suite 8: parseTimeSimple Function ---');
  
  let time = parseTimeSimple('9am');
  assert(time !== null, 'parseTimeSimple parses 9am');
  if (time) assert(time.getHours() === 9, 'parseTimeSimple returns hour 9');
  
  time = parseTimeSimple('2pm');
  assert(time !== null, 'parseTimeSimple parses 2pm');
  if (time) assert(time.getHours() === 14, 'parseTimeSimple returns hour 14');
  
  time = parseTimeSimple('12pm');
  assert(time !== null, 'parseTimeSimple parses 12pm');
  if (time) assert(time.getHours() === 12, 'parseTimeSimple returns hour 12');
  
  time = parseTimeSimple('12am');
  assert(time !== null, 'parseTimeSimple parses 12am');
  if (time) assert(time.getHours() === 0, 'parseTimeSimple returns hour 0');
  
  time = parseTimeSimple('9:30am');
  assert(time !== null, 'parseTimeSimple parses 9:30am');
  if (time) {
    assert(time.getHours() === 9, 'parseTimeSimple returns hour 9');
    assert(time.getMinutes() === 30, 'parseTimeSimple returns minutes 30');
  }
  
  time = parseTimeSimple('invalid');
  assert(time === null, 'parseTimeSimple returns null for invalid');

  console.log('');

  // ============================================
  // FINAL SUMMARY
  // ============================================
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    MOCK TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📊 Total:  ${testsPassed + testsFailed}`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  cleanup();
  
  if (testsFailed > 0) {
    console.log('\n⚠️  Some tests failed.');
    process.exit(1);
  } else {
    console.log('\n🎉 All mock tests passed!');
  }
}

function makeRequest(method, url, body = null) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: method,
      headers: { 'Content-Type': 'application/json' }
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
      resolve({ status: 0, error: err.message });
    });
    
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function makeRawRequest(method, url, body) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: method,
      headers: { 'Content-Type': 'application/json' }
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
      resolve({ status: 0, error: err.message });
    });
    
    req.write(body);
    req.end();
  });
}

runMockTests();
