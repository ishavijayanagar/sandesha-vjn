'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { parsePhoneNumbers } = require('./bulk-send');
const { addParticipantsFixed } = require('./add-participants');

const GROUPS_CACHE_TTL_MS = 5 * 60 * 1000;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

function createApiHandlers(deps) {
  const {
    client,
    loadSchedules,
    saveSchedules,
    loadContacts,
    saveContacts,
    loadSets,
    parseScheduleTime,
    validateScheduleTarget,
    resolveAndSend,
    formatTimeAgo,
    getGroupParticipantCount,
    isAnnouncementGroup,
    getGroupTypeLabel,
    normalizePhoneDigits,
    delay,
    forwardToZeroClaw,
    MEDIA_DIR,
    log,
    resolveGroupByName,
    resolveParticipantWids,
    ZC_WEBHOOK_HOST = '127.0.0.1',
    ZC_WEBHOOK_PORT = 42617,
  } = deps;

  let groupsCache = { at: 0, data: null };
  const apiJobs = new Map();

  function jsonResponse(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async function enrichGroup(g) {
    let lastActive = 'Unknown';
    let daysInactive = 999;
    let status = 'unknown';
    try {
      const messages = await Promise.race([
        g.fetchMessages({ limit: 1 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      if (messages.length > 0) {
        lastActive = formatTimeAgo(messages[0].timestamp);
        daysInactive = Math.floor((Math.floor(Date.now() / 1000) - messages[0].timestamp) / 86400);
        if (daysInactive > 30) status = 'inactive';
        else if (daysInactive > 7) status = 'week';
        else status = 'active';
      } else {
        lastActive = 'Never';
        status = 'inactive';
      }
    } catch {
      status = 'unknown';
    }
    return {
      name: g.name,
      jid: g.id._serialized,
      participants: getGroupParticipantCount(g),
      announcement: isAnnouncementGroup(g),
      type: getGroupTypeLabel(g),
      lastActive,
      daysInactive,
      status,
    };
  }

  async function getGroupsEnriched(force = false) {
    if (!force && groupsCache.data && Date.now() - groupsCache.at < GROUPS_CACHE_TTL_MS) {
      return groupsCache.data;
    }
    const chats = await client.getChats();
    const groups = chats.filter((c) => c.isGroup);
    const enriched = [];
    for (const g of groups) {
      enriched.push(await enrichGroup(g));
    }
    enriched.sort((a, b) => a.name.localeCompare(b.name));
    groupsCache = { at: Date.now(), data: enriched };
    return enriched;
  }

  async function probeAiStatus() {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: ZC_WEBHOOK_HOST,
        port: ZC_WEBHOOK_PORT,
        path: '/webhook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 2000,
      }, (res) => {
        resolve({ available: res.statusCode < 500 });
      });
      req.on('error', () => resolve({ available: false }));
      req.on('timeout', () => { req.destroy(); resolve({ available: false }); });
      req.write(JSON.stringify({ message: '__ping__' }));
      req.end();
    });
  }

  function parseMultipart(buffer, boundary) {
    const parts = buffer.toString('binary').split(`--${boundary}`);
    for (const part of parts) {
      if (!part.includes('Content-Disposition')) continue;
      const nameMatch = part.match(/name="([^"]+)"/);
      const filenameMatch = part.match(/filename="([^"]+)"/);
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const body = part.slice(headerEnd + 4).replace(/\r\n$/, '');
      if (filenameMatch) {
        return {
          field: nameMatch?.[1] || 'file',
          filename: filenameMatch[1],
          data: Buffer.from(body, 'binary'),
        };
      }
    }
    return null;
  }

  async function handleUpload(req) {
    const ct = req.headers['content-type'] || '';
    const match = ct.match(/boundary=(.+)$/);
    if (!match) throw new Error('Expected multipart/form-data');
    const boundary = match[1];
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) throw new Error('File too large (max 16MB)');
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const file = parseMultipart(buffer, boundary);
    if (!file?.data?.length) throw new Error('No file in upload');
    const ext = path.extname(file.filename || '') || '.bin';
    const safeName = `upload_${Date.now()}${ext.replace(/[^a-zA-Z0-9.]/g, '')}`;
    const filePath = path.join(MEDIA_DIR, safeName);
    fs.writeFileSync(filePath, file.data);
    return { filePath, filename: safeName };
  }

  async function runBulkSend(numbers, message) {
    const results = [];
    for (const num of numbers) {
      try {
        await resolveAndSend(num, message);
        results.push({ number: num, ok: true });
      } catch (err) {
        results.push({ number: num, ok: false, error: err.message });
      }
      await delay(2500);
    }
    return results;
  }

  async function runAddMembersJob(jobId, groupJid, numbers) {
    const job = apiJobs.get(jobId);
    if (!job) return;
    job.status = 'running';
    const groupChat = await client.getChatById(groupJid);
    const { entries, failed: resolveFailed } = await resolveParticipantWids(numbers);
    job.total = entries.length + resolveFailed.length;
    job.done = resolveFailed.length;
    job.errors = resolveFailed.map((f) => `${f.num}: ${f.error}`);

    for (const entry of entries) {
      if (job.cancelled) break;
      try {
        const result = await addParticipantsFixed(client, groupJid, [entry.wid], {
          sleep: 0,
          autoSendInviteV4: true,
        });
        job.done += 1;
        if (typeof result === 'string') {
          job.errors.push(`${entry.digits}: ${result}`);
        }
      } catch (err) {
        job.done += 1;
        job.errors.push(`${entry.digits}: ${err.message}`);
      }
      await delay(90000);
    }
    job.status = job.cancelled ? 'cancelled' : 'done';
  }

  async function handleRequest(req, res, parsed, requireAuthFn) {
    const pathname = parsed.pathname;

    if (pathname === '/ai/status' && req.method === 'GET') {
      if (!requireAuthFn(req, res)) return true;
      const status = await probeAiStatus();
      jsonResponse(res, 200, status);
      return true;
    }

    if (pathname === '/ai/chat' && req.method === 'POST') {
      if (!requireAuthFn(req, res)) return true;
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const reply = await forwardToZeroClaw(body.message || '');
        jsonResponse(res, 200, { response: reply || 'No response from AI service' });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message });
      }
      return true;
    }

    if (pathname === '/schedules' && req.method === 'GET') {
      if (!requireAuthFn(req, res)) return true;
      jsonResponse(res, 200, { schedules: loadSchedules() });
      return true;
    }

    if (pathname === '/schedules' && req.method === 'POST') {
      if (!requireAuthFn(req, res)) return true;
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const { message, target, runAt, timeStr } = body;
        if (!message || !target) {
          jsonResponse(res, 400, { error: 'message and target required' });
          return true;
        }
        let when = runAt ? new Date(runAt) : (timeStr ? parseScheduleTime(timeStr) : null);
        if (!when || Number.isNaN(when.getTime())) {
          jsonResponse(res, 400, { error: 'Invalid runAt or timeStr' });
          return true;
        }
        await validateScheduleTarget(target);
        const schedule = {
          id: Date.now(),
          message,
          target,
          runAt: when.toISOString(),
          createdAt: new Date().toISOString(),
        };
        const schedules = loadSchedules();
        schedules.push(schedule);
        saveSchedules(schedules);
        jsonResponse(res, 200, { ok: true, schedule });
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    const scheduleDelete = pathname.match(/^\/schedules\/(\d+)$/);
    if (scheduleDelete && req.method === 'DELETE') {
      if (!requireAuthFn(req, res)) return true;
      const id = parseInt(scheduleDelete[1], 10);
      const schedules = loadSchedules().filter((s) => s.id !== id);
      saveSchedules(schedules);
      jsonResponse(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/contacts' && req.method === 'GET') {
      if (!requireAuthFn(req, res)) return true;
      jsonResponse(res, 200, loadContacts());
      return true;
    }

    if (pathname === '/contacts' && req.method === 'POST') {
      if (!requireAuthFn(req, res)) return true;
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        if (!body.name || !body.number) {
          jsonResponse(res, 400, { error: 'name and number required' });
          return true;
        }
        const contacts = loadContacts();
        contacts.contacts[body.name] = body.number;
        saveContacts(contacts);
        jsonResponse(res, 200, { ok: true, contacts: contacts.contacts });
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    const contactDelete = pathname.match(/^\/contacts\/([^/]+)$/);
    if (contactDelete && req.method === 'DELETE') {
      if (!requireAuthFn(req, res)) return true;
      const name = decodeURIComponent(contactDelete[1]);
      const contacts = loadContacts();
      delete contacts.contacts[name];
      saveContacts(contacts);
      jsonResponse(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/groups/inactive' && req.method === 'GET') {
      if (!requireAuthFn(req, res)) return true;
      const days = parseInt(parsed.query.days, 10) || 30;
      const groups = await getGroupsEnriched();
      jsonResponse(res, 200, groups.filter((g) => g.daysInactive >= days));
      return true;
    }

    if (pathname === '/groups/find-member' && req.method === 'GET') {
      if (!requireAuthFn(req, res)) return true;
      const q = (parsed.query.q || '').trim();
      if (!q) {
        jsonResponse(res, 400, { error: 'q required' });
        return true;
      }
      const chats = await client.getChats();
      const found = [];
      for (const g of chats.filter((c) => c.isGroup)) {
        try {
          if (!g.participants?.length) await g.fetchParticipants?.().catch(() => {});
          for (const p of g.participants || []) {
            const contact = p.id ? await client.getContactById(p.id._serialized).catch(() => null) : null;
            const name = contact?.pushname || contact?.name || p.name || '';
            if (name.toLowerCase().includes(q.toLowerCase())) {
              found.push({ group: g.name, jid: g.id._serialized, name });
            }
          }
        } catch { /* skip */ }
      }
      jsonResponse(res, 200, { results: found.slice(0, 50) });
      return true;
    }

    const membersMatch = pathname.match(/^\/groups\/([^/]+)\/members$/);
    if (membersMatch && req.method === 'GET') {
      if (!requireAuthFn(req, res)) return true;
      const jid = decodeURIComponent(membersMatch[1]);
      try {
        const chat = await client.getChatById(jid);
        if (!chat.participants?.length) await chat.fetchParticipants?.().catch(() => {});
        const members = [];
        for (const p of (chat.participants || []).slice(0, 100)) {
          const contact = p.id ? await client.getContactById(p.id._serialized).catch(() => null) : null;
          members.push({
            name: contact?.pushname || contact?.name || p.name || 'Unknown',
            phone: p.id?.user || '',
          });
        }
        jsonResponse(res, 200, { group: chat.name, jid, members, total: chat.participants?.length || members.length });
      } catch (err) {
        jsonResponse(res, 404, { error: err.message });
      }
      return true;
    }

    if (pathname === '/send/broadcast' && req.method === 'POST') {
      if (!requireAuthFn(req, res)) return true;
      try {
        const { message } = JSON.parse(await readBody(req) || '{}');
        if (!message) {
          jsonResponse(res, 400, { error: 'message required' });
          return true;
        }
        const chats = await client.getChats();
        const groups = chats.filter((c) => c.isGroup);
        let sent = 0;
        for (const g of groups) {
          try {
            await resolveAndSend(g.id._serialized, message);
            sent += 1;
            await delay(2000);
          } catch (err) {
            log(`[broadcast] ${g.name}: ${err.message}`);
          }
        }
        jsonResponse(res, 200, { ok: true, sent, total: groups.length });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message });
      }
      return true;
    }

    if (pathname === '/send/bulk' && req.method === 'POST') {
      if (!requireAuthFn(req, res)) return true;
      try {
        const { numbers, message } = JSON.parse(await readBody(req) || '{}');
        const list = Array.isArray(numbers) ? numbers : parsePhoneNumbers(String(numbers || ''), normalizePhoneDigits);
        if (!list.length || !message) {
          jsonResponse(res, 400, { error: 'numbers and message required' });
          return true;
        }
        const results = await runBulkSend(list.slice(0, 100), message);
        jsonResponse(res, 200, { ok: true, results });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message });
      }
      return true;
    }

    if (pathname === '/upload' && req.method === 'POST') {
      if (!requireAuthFn(req, res)) return true;
      try {
        const result = await handleUpload(req);
        jsonResponse(res, 200, result);
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    if (pathname === '/jobs/add-members' && req.method === 'POST') {
      if (!requireAuthFn(req, res)) return true;
      try {
        const { groupJid, numbers } = JSON.parse(await readBody(req) || '{}');
        const list = Array.isArray(numbers) ? numbers : parsePhoneNumbers(String(numbers || ''), normalizePhoneDigits);
        if (!groupJid || !list.length) {
          jsonResponse(res, 400, { error: 'groupJid and numbers required' });
          return true;
        }
        const jobId = String(Date.now());
        const job = {
          id: jobId,
          status: 'queued',
          done: 0,
          total: list.length,
          errors: [],
          cancelled: false,
          expiresAt: Date.now() + JOB_TTL_MS,
        };
        apiJobs.set(jobId, job);
        setImmediate(() => runAddMembersJob(jobId, groupJid, list.slice(0, 50)));
        jsonResponse(res, 200, { jobId });
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === 'GET') {
      if (!requireAuthFn(req, res)) return true;
      const job = apiJobs.get(jobMatch[1]);
      if (!job) {
        jsonResponse(res, 404, { error: 'Job not found' });
        return true;
      }
      jsonResponse(res, 200, {
        id: job.id,
        status: job.status,
        done: job.done,
        total: job.total,
        errors: job.errors.slice(-20),
      });
      return true;
    }

    return false;
  }

  return {
    handleRequest,
    getGroupsEnriched,
    invalidateGroupsCache: () => { groupsCache = { at: 0, data: null }; },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

module.exports = { createApiHandlers };
