'use strict';

const assert = require('assert');
const { createApiHandlers } = require('../api-handlers');

function makeDeps(overrides = {}) {
  const schedules = [];
  const contacts = { contacts: { alice: '919876543210' } };
  const sets = { family: ['111@g.us', '222@g.us'] };
  const jobs = new Map();

  return {
    client: {
      getChats: async () => [
        { isGroup: true, name: 'Test Group', id: { _serialized: '111@g.us' }, participants: [{ id: { _serialized: '1@c.us', user: '1' } }] },
        { isGroup: false, name: 'DM', id: { _serialized: '999@c.us' } },
      ],
      getChatById: async (jid) => ({
        name: 'Test Group',
        id: { _serialized: jid },
        participants: [{ id: { _serialized: '1@c.us', user: '111' }, name: 'Bob' }],
        fetchParticipants: async () => {},
      }),
    },
    loadSchedules: () => schedules,
    saveSchedules: (s) => { schedules.length = 0; schedules.push(...s); },
    loadContacts: () => contacts,
    saveContacts: (c) => { contacts.contacts = c.contacts; },
    loadSets: () => sets,
    parseScheduleTime: (str) => {
      if (str === '9am') {
        const d = new Date();
        d.setHours(9, 0, 0, 0);
        if (d <= new Date()) d.setDate(d.getDate() + 1);
        return d;
      }
      return null;
    },
    validateScheduleTarget: async () => {},
    resolveAndSend: async () => {},
    formatTimeAgo: () => '1 day ago',
    getGroupParticipantCount: () => 5,
    isAnnouncementGroup: () => false,
    getGroupTypeLabel: () => 'group',
    normalizePhoneDigits: (n) => n.replace(/\D/g, ''),
    delay: async () => {},
    forwardToZeroClaw: async (msg) => `echo: ${msg}`,
    MEDIA_DIR: '/tmp',
    log: () => {},
    resolveGroupByName: async () => null,
    resolveParticipantWids: async (nums) => ({
      wids: nums.map((n) => `${n}@c.us`),
      failed: [],
      entries: nums.map((n) => ({ digits: n, wid: `${n}@c.us` })),
    }),
    ...overrides,
  };
}

function mockRes() {
  const res = {
    statusCode: 0,
    body: '',
    writeHead(code) { this.statusCode = code; },
    end(data) { this.body = data; },
  };
  return res;
}

function mockReq(method, body = '') {
  return { method, headers: { 'content-type': 'application/json' }, on: () => {} , ...{} };
}

async function readBodyHandler(req, body) {
  return {
    method: req.method,
    headers: req.headers,
    [Symbol.asyncIterator]: async function* () { yield Buffer.from(body); },
  };
}

async function run() {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  await test('GET /schedules returns list', async () => {
    const deps = makeDeps();
    const h = createApiHandlers(deps);
    const res = mockRes();
    const ok = await h.handleRequest(
      { method: 'GET' },
      res,
      { pathname: '/schedules' },
      () => true
    );
    assert.ok(ok);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data.schedules));
  });

  await test('POST /schedules creates schedule with timeStr', async () => {
    const deps = makeDeps();
    const h = createApiHandlers(deps);
    const res = mockRes();
    const req = { method: 'POST' };
    const origRead = require('../api-handlers');
    // use inline body via patching readBody path - call handler with JSON parse path
    const body = JSON.stringify({ message: 'hi', target: 'family', timeStr: '9am' });
    const req2 = {
      method: 'POST',
      on(evt, fn) {
        if (evt === 'data') fn(body);
        if (evt === 'end') fn();
      },
    };
    const ok = await h.handleRequest(req2, res, { pathname: '/schedules' }, () => true);
    assert.ok(ok);
    const data = JSON.parse(res.body);
    assert.ok(data.schedule);
    assert.strictEqual(data.schedule.message, 'hi');
  });

  await test('DELETE /schedules/:id removes schedule', async () => {
    const deps = makeDeps();
    deps.saveSchedules([{ id: 123, message: 'x', target: 'a', runAt: new Date().toISOString() }]);
    const h = createApiHandlers(deps);
    const res = mockRes();
    const ok = await h.handleRequest({ method: 'DELETE' }, res, { pathname: '/schedules/123' }, () => true);
    assert.ok(ok);
    assert.strictEqual(deps.loadSchedules().length, 0);
  });

  await test('GET /contacts returns contacts', async () => {
    const h = createApiHandlers(makeDeps());
    const res = mockRes();
    const ok = await h.handleRequest({ method: 'GET' }, res, { pathname: '/contacts' }, () => true);
    assert.ok(ok);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.contacts.alice, '919876543210');
  });

  await test('POST /contacts adds contact', async () => {
    const deps = makeDeps();
    const h = createApiHandlers(deps);
    const res = mockRes();
    const body = JSON.stringify({ name: 'bob', number: '911111111111' });
    const req = {
      method: 'POST',
      on(evt, fn) {
        if (evt === 'data') fn(body);
        if (evt === 'end') fn();
      },
    };
    await h.handleRequest(req, res, { pathname: '/contacts' }, () => true);
    assert.ok(deps.loadContacts().contacts.bob);
  });

  await test('GET /groups/inactive filters by days', async () => {
    const deps = makeDeps({
      client: {
        getChats: async () => [{
          isGroup: true,
          name: 'Old',
          id: { _serialized: '111@g.us' },
          fetchMessages: async () => [{ timestamp: Math.floor(Date.now() / 1000) - 86400 * 60 }],
        }],
      },
    });
    const h = createApiHandlers(deps);
    const groups = await h.getGroupsEnriched(true);
    assert.ok(groups[0].daysInactive >= 30);
    const res = mockRes();
    await h.handleRequest({ method: 'GET' }, res, { pathname: '/groups/inactive', query: { days: '30' } }, () => true);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data));
  });

  await test('POST /send/bulk requires numbers and message', async () => {
    const h = createApiHandlers(makeDeps());
    const res = mockRes();
    const body = JSON.stringify({ numbers: '9876543210', message: 'test' });
    const req = {
      method: 'POST',
      on(evt, fn) {
        if (evt === 'data') fn(body);
        if (evt === 'end') fn();
      },
    };
    await h.handleRequest(req, res, { pathname: '/send/bulk' }, () => true);
    const data = JSON.parse(res.body);
    assert.ok(data.results);
  });

  await test('unknown route returns false', async () => {
    const h = createApiHandlers(makeDeps());
    const ok = await h.handleRequest({ method: 'GET' }, mockRes(), { pathname: '/nope' }, () => true);
    assert.strictEqual(ok, false);
  });

  console.log('');
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  if (failed) process.exit(1);
}

run();
