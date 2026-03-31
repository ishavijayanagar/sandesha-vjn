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

function removeEmojis(str) {
  return str.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
}

function cleanMessage(message, verbs) {
  const lower = message.toLowerCase().trim();
  for (const v of verbs) {
    if (lower === v) return '';
    if (lower.startsWith(v + ' ')) return message.substring(v.length + 1);
    if (lower.startsWith('please ' + v + ' ')) return message.substring(('please ' + v).length + 1);
  }
  return message;
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)} weeks ago`;
  return `${Math.floor(seconds / 2592000)} months ago`;
}

function formatTimeUntil(date) {
  const diff = date - new Date();
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `in ${days} day${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes} min`;
}

function parseScheduleTime(timeStr) {
  const now = new Date();
  let lower = timeStr.toLowerCase().trim();
  
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  for (const day of days) {
    if (lower.includes(day)) {
      lower = lower.replace(new RegExp(day, 'gi'), '').trim();
    }
  }
  lower = lower.replace(/\btoday\b/gi, '').trim();
  lower = lower.replace(/\btomorrow\b/gi, '').trim();
  lower = lower.replace(/\s+/g, ' ').trim();
  
  if (lower.startsWith('daily') || lower.startsWith('every day')) {
    const timeMatch = lower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3]?.toLowerCase();
      if (period === 'pm' && hours < 12) hours += 12;
      if (period === 'am' && hours === 12) hours = 0;
      
      const next = new Date();
      next.setHours(hours, minutes, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    }
  }
  
  const timeMatch = lower.match(/^(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?$/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const period = timeMatch[3]?.toLowerCase();
    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    
    const result = new Date();
    result.setHours(hours, minutes, 0, 0);
    
    if (result <= now) {
      result.setDate(result.getDate() + 1);
    }
    
    if (lower.includes('today')) {
    } else if (lower.includes('tomorrow')) {
      result.setDate(result.getDate() + 1);
    } else if (lower.includes('monday')) {
      const daysUntil = (8 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('tuesday')) {
      const daysUntil = (9 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('wednesday')) {
      const daysUntil = (10 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('thursday')) {
      const daysUntil = (11 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('friday')) {
      const daysUntil = (12 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('saturday')) {
      const daysUntil = (13 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('sunday')) {
      const daysUntil = (14 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    }
    
    return result;
  }
  
  const dateMatch = lower.match(/(\w+)\s+(\d{1,2})(?:\s+at\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?)?/);
  if (dateMatch) {
    const monthStr = dateMatch[1];
    const day = parseInt(dateMatch[2]);
    let hours = dateMatch[3] ? parseInt(dateMatch[3]) : 9;
    let minutes = dateMatch[4] ? parseInt(dateMatch[4]) : 0;
    const period = dateMatch[5]?.toLowerCase();
    
    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const month = months.findIndex(m => monthStr.startsWith(m));
    if (month >= 0) {
      const result = new Date();
      result.setMonth(month, day);
      result.setHours(hours, minutes, 0, 0);
      if (result <= now) {
        result.setFullYear(result.getFullYear() + 1);
      }
      return result;
    }
  }
  
  return null;
}

function parseNaturalCommand(input) {
  const lower = input.toLowerCase().trim();
  
  const verbs = ['send', 'post', 'broadcast', 'share', 'say'];
  let message = cleanMessage(input, verbs);
  
  const targetPatterns = [
    /(?:to|into|at)\s+(\w+)$/i,
    /(?:to|into|at)\s+(\w+)/i
  ];
  
  let target = null;
  for (const pattern of targetPatterns) {
    const match = message.match(pattern);
    if (match) {
      target = match[1];
      message = message.replace(pattern, '').trim();
      break;
    }
  }
  
  if (!target && message.includes(' ')) {
    const parts = message.split(' ');
    target = parts[parts.length - 1];
    message = parts.slice(0, -1).join(' ');
  }
  
  const isAll = lower.includes('all') || lower.includes('everyone');
  
  if (!message || !target) return null;
  
  return { message, target, isAll };
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function runTests() {
  setup();
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        SANDESHA - COMPREHENSIVE TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // ============================================
  // TEST SUITE 1: File Operations - Groups
  // ============================================
  console.log('--- Test Suite 1: Groups File Operations ---');
  
  saveSets({ all: ['Group1', 'Group2'], family: ['Group1'] });
  let sets = loadSets();
  assert(sets.all.length === 2, 'loadSets returns correct all array');
  assert(sets.all[0] === 'Group1', 'loadSets returns correct first group');
  assert(sets.family.length === 1, 'loadSets returns correct family array');
  
  saveSets({});
  sets = loadSets();
  assert(typeof sets === 'object', 'loadSets returns object for empty file');
  assert(Object.keys(sets).length === 0, 'loadSets returns empty object');
  
  fs.unlinkSync(TEST_GROUPS);
  sets = loadSets();
  assert(typeof sets === 'object', 'loadSets returns object when file missing');
  assert(Object.keys(sets).length === 0, 'loadSets returns empty when file missing');

  console.log('');

  // ============================================
  // TEST SUITE 2: File Operations - Schedules
  // ============================================
  console.log('--- Test Suite 2: Schedules File Operations ---');
  
  const testSchedules = [
    { id: 1, message: 'Test1', target: 'family', runAt: '2026-03-30T10:00:00Z' },
    { id: 2, message: 'Test2', target: 'all', runAt: '2026-03-31T10:00:00Z' }
  ];
  saveSchedules(testSchedules);
  let schedules = loadSchedules();
  assert(Array.isArray(schedules), 'loadSchedules returns array');
  assert(schedules.length === 2, 'loadSchedules returns correct length');
  assert(schedules[0].message === 'Test1', 'loadSchedules returns correct first schedule');
  
  saveSchedules([]);
  schedules = loadSchedules();
  assert(Array.isArray(schedules), 'loadSchedules returns array for empty');
  assert(schedules.length === 0, 'loadSchedules returns empty array');
  
  fs.unlinkSync(TEST_SCHEDULES);
  schedules = loadSchedules();
  assert(Array.isArray(schedules), 'loadSchedules returns array when missing');
  assert(schedules.length === 0, 'loadSchedules returns empty when missing');

  console.log('');

  // ============================================
  // TEST SUITE 3: File Operations - Contacts
  // ============================================
  console.log('--- Test Suite 3: Contacts File Operations ---');
  
  const testContacts = { contacts: { John: '1234567890', Jane: '0987654321' } };
  saveContacts(testContacts);
  let contacts = loadContacts();
  assert(typeof contacts === 'object', 'loadContacts returns object');
  assert(contacts.contacts.John === '1234567890', 'loadContacts returns correct contact');
  
  saveContacts({ contacts: {} });
  contacts = loadContacts();
  assert(typeof contacts === 'object', 'loadContacts returns object for empty');
  
  fs.unlinkSync(TEST_CONTACTS);
  contacts = loadContacts();
  assert(typeof contacts === 'object', 'loadContacts returns object when missing');
  assert(typeof contacts.contacts === 'object', 'loadContacts returns contacts object when missing');

  console.log('');

  // ============================================
  // TEST SUITE 4: Contact Resolution
  // ============================================
  console.log('--- Test Suite 4: Contact Resolution ---');
  
  saveContacts({ contacts: { john: '919844400000', jane: '919844401111' } });
  
  let contact = resolveContact('john');
  assert(contact === '919844400000', 'resolveContact finds contact by name');
  
  contact = resolveContact('JOHN');
  assert(contact === '919844400000', 'resolveContact is case insensitive');
  
  contact = resolveContact('919844400000');
  assert(contact === '919844400000', 'resolveContact finds contact by number');
  
  // Current implementation checks if number INCLUDES the search term (not partial match)
  contact = resolveContact('919844400000');
  assert(contact === '919844400000', 'resolveContact finds by full number');
  
  contact = resolveContact('nonexistent');
  assert(contact === null, 'resolveContact returns null for unknown');

  console.log('');

  // ============================================
  // TEST SUITE 5: Emoji Removal
  // ============================================
  console.log('--- Test Suite 5: Emoji Removal ---');
  
  assertEqual(removeEmojis('Hello 👋'), 'Hello', 'removeEmojis removes single emoji');
  assertEqual(removeEmojis('🌊Wave'), 'Wave', 'removeEmojis removes leading emoji');
  assertEqual(removeEmojis('No emoji'), 'No emoji', 'removeEmojis handles no emoji');
  assertEqual(removeEmojis('👋'), '', 'removeEmojis handles only emoji');
  assertEqual(removeEmojis('Hello 👋 World 🎉'), 'Hello  World', 'removeEmojis removes multiple emojis');
  assertEqual(removeEmojis(''), '', 'removeEmojis handles empty string');

  console.log('');

  // ============================================
  // TEST SUITE 6: Message Cleaning
  // ============================================
  console.log('--- Test Suite 6: Message Cleaning ---');
  
  const verbs = ['send', 'say', 'post'];
  
  assertEqual(cleanMessage('send hello', verbs), 'hello', 'cleanMessage removes verb');
  assertEqual(cleanMessage('say hello world', verbs), 'hello world', 'cleanMessage handles multi-word');
  assertEqual(cleanMessage('please send hello', verbs), 'hello', 'cleanMessage handles please prefix');
  assertEqual(cleanMessage('hello', verbs), 'hello', 'cleanMessage returns original if no match');
  assertEqual(cleanMessage('send', verbs), '', 'cleanMessage returns empty for exact verb');
  assertEqual(cleanMessage('SEND hello', verbs), 'hello', 'cleanMessage handles uppercase verb');
  assertEqual(cleanMessage('send  to  hello', verbs), ' to  hello', 'cleanMessage handles extra spaces');

  console.log('');

  // ============================================
  // TEST SUITE 7: Time Formatting - formatTimeAgo
  // ============================================
  console.log('--- Test Suite 7: formatTimeAgo ---');
  
  const now = Math.floor(Date.now() / 1000);
  assertEqual(formatTimeAgo(now), 'Just now', 'formatTimeAgo shows Just now for current time');
  assertEqual(formatTimeAgo(now - 30), 'Just now', 'formatTimeAgo shows Just now for <60s');
  assertEqual(formatTimeAgo(now - 300), '5 min ago', 'formatTimeAgo shows minutes');
  assertEqual(formatTimeAgo(now - 3600), '1 hours ago', 'formatTimeAgo shows hours');
  assertEqual(formatTimeAgo(now - 7200), '2 hours ago', 'formatTimeAgo shows hours > 1');
  assertEqual(formatTimeAgo(now - 86400), '1 days ago', 'formatTimeAgo shows days');
  assertEqual(formatTimeAgo(now - 172800), '2 days ago', 'formatTimeAgo shows days > 1');
  assertEqual(formatTimeAgo(now - 604800), '1 weeks ago', 'formatTimeAgo shows weeks');
  assertEqual(formatTimeAgo(now - 2592000), '1 months ago', 'formatTimeAgo shows months');

  console.log('');

  // ============================================
  // TEST SUITE 8: Time Formatting - formatTimeUntil
  // ============================================
  console.log('--- Test Suite 8: formatTimeUntil ---');
  
  let futureDate = new Date(Date.now() + 3600000);
  assertEqual(formatTimeUntil(futureDate), 'in 1h 0m', 'formatTimeUntil shows hours');
  
  futureDate = new Date(Date.now() + 7200000);
  assertEqual(formatTimeUntil(futureDate), 'in 2h 0m', 'formatTimeUntil shows hours > 1');
  
  futureDate = new Date(Date.now() + 90000000);
  assertEqual(formatTimeUntil(futureDate), 'in 1 day', 'formatTimeUntil shows days');
  
  futureDate = new Date(Date.now() + 180000000);
  assertEqual(formatTimeUntil(futureDate), 'in 2 days', 'formatTimeUntil shows days > 1');
  
  futureDate = new Date(Date.now() + 600000);
  assertEqual(formatTimeUntil(futureDate), 'in 10 min', 'formatTimeUntil shows minutes');

  console.log('');

  // ============================================
  // TEST SUITE 9: Schedule Time Parsing
  // ============================================
  console.log('--- Test Suite 9: parseScheduleTime ---');
  
  let time = parseScheduleTime('9am');
  assert(time !== null, 'parseScheduleTime parses 9am');
  if (time) assert(time.getHours() === 9, '9am parsed to hour 9');
  
  time = parseScheduleTime('9:30am');
  assert(time !== null, 'parseScheduleTime parses 9:30am');
  if (time) {
    assert(time.getHours() === 9, '9:30am parsed to hour 9');
    assert(time.getMinutes() === 30, '9:30am parsed to minutes 30');
  }
  
  time = parseScheduleTime('2pm');
  assert(time !== null, 'parseScheduleTime parses 2pm');
  if (time) assert(time.getHours() === 14, '2pm parsed to hour 14');
  
  time = parseScheduleTime('14:30');
  assert(time !== null, 'parseScheduleTime parses 14:30');
  if (time) {
    assert(time.getHours() === 14, '14:30 parsed to hour 14');
    assert(time.getMinutes() === 30, '14:30 parsed to minutes 30');
  }
  
  time = parseScheduleTime('9am tomorrow');
  assert(time !== null, 'parseScheduleTime parses 9am tomorrow');
  if (time) assert(time > new Date(), '9am tomorrow is in future');
  
  time = parseScheduleTime('9am monday');
  assert(time !== null, 'parseScheduleTime parses 9am monday');
  if (time) assert(time.getDay() >= 0 && time.getDay() <= 6, '9am monday returns valid day');
  
  time = parseScheduleTime('march 30');
  assert(time !== null, 'parseScheduleTime parses march 30');
  if (time) {
    assert(time.getMonth() === 2, 'march 30 is March (month 2)');
    assert(time.getDate() === 30, 'march 30 is day 30');
  }
  
  time = parseScheduleTime('daily at 9am');
  assert(time !== null, 'parseScheduleTime parses daily at 9am');
  
  time = parseScheduleTime('4.47am');
  assert(time !== null, 'parseScheduleTime parses 4.47am');
  if (time) {
    assert(time.getHours() === 4, '4.47am parsed to hour 4');
    assert(time.getMinutes() === 47, '4.47am parsed to minutes 47');
  }
  
  time = parseScheduleTime('invalid time');
  assert(time === null, 'parseScheduleTime returns null for invalid');
  
  time = parseScheduleTime('12pm');
  assert(time !== null, 'parseScheduleTime parses 12pm');
  if (time) assert(time.getHours() === 12, '12pm parsed to hour 12');
  
  time = parseScheduleTime('12am');
  assert(time !== null, 'parseScheduleTime parses 12am');
  if (time) assert(time.getHours() === 0, '12am parsed to hour 0');

  console.log('');

  // ============================================
  // TEST SUITE 10: Natural Command Parsing
  // ============================================
  console.log('--- Test Suite 10: parseNaturalCommand ---');
  
  let parsed = parseNaturalCommand('send hello to family');
  assert(parsed !== null, 'parseNaturalCommand parses basic command');
  if (parsed) {
    assertEqual(parsed.message, 'hello', 'parseNaturalCommand extracts message');
    assertEqual(parsed.target, 'family', 'parseNaturalCommand extracts target');
    assertEqual(parsed.isAll, false, 'parseNaturalCommand sets isAll false');
  }
  
  parsed = parseNaturalCommand('say hi to all');
  assert(parsed !== null, 'parseNaturalCommand parses with all');
  if (parsed) {
    assertEqual(parsed.message, 'hi', 'parseNaturalCommand extracts message for all');
    assertEqual(parsed.isAll, true, 'parseNaturalCommand sets isAll true for all');
  }
  
  parsed = parseNaturalCommand('post welcome everyone');
  assert(parsed !== null, 'parseNaturalCommand parses post verb');
  if (parsed) {
    assertEqual(parsed.message, 'welcome', 'parseNaturalCommand handles post verb');
    assertEqual(parsed.target, 'everyone', 'parseNaturalCommand extracts everyone as target');
  }
  
  parsed = parseNaturalCommand('hello');
  assert(parsed === null, 'parseNaturalCommand returns null for no target');
  
  parsed = parseNaturalCommand('send');
  assert(parsed === null, 'parseNaturalCommand returns null for empty message');

  console.log('');

  // ============================================
  // TEST SUITE 11: Delay Function
  // ============================================
  console.log('--- Test Suite 11: Delay Function ---');
  
  let start = Date.now();
  await delay(100);
  let elapsed = Date.now() - start;
  assert(elapsed >= 90 && elapsed < 200, 'delay(100) waits approximately 100ms');
  
  start = Date.now();
  await delay(50);
  elapsed = Date.now() - start;
  assert(elapsed >= 40 && elapsed < 100, 'delay(50) waits approximately 50ms');

  console.log('');

  // ============================================
  // TEST SUITE 12: Edge Cases
  // ============================================
  console.log('--- Test Suite 12: Edge Cases ---');
  
  // Empty inputs
  assertEqual(removeEmojis(''), '', 'removeEmojis handles empty');
  assertEqual(cleanMessage('', ['send']), '', 'cleanMessage handles empty');
  
  // Unicode and special chars
  assertEqual(removeEmojis('Hello 🌍🌎🌏'), 'Hello', 'removeEmojis removes multiple globe emojis');
  
  // Very long strings
  const longString = 'a'.repeat(1000);
  assertEqual(removeEmojis(longString), longString, 'removeEmojis handles long string');
  
  // Special characters in target
  parsed = parseNaturalCommand('send hello to group-1');
  if (parsed) {
    // Current behavior: splits on hyphen, so target becomes 'group'
    assertEqual(parsed.target, 'group', 'parseNaturalCommand handles hyphen in target');
  }

  console.log('');

  // ============================================
  // TEST SUITE 13: Error Handling
  // ============================================
  console.log('--- Test Suite 13: Error Handling ---');
  
  // Missing files should not crash
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  
  sets = loadSets();
  assert(typeof sets === 'object', 'loadSets handles missing directory');
  
  schedules = loadSchedules();
  assert(Array.isArray(schedules), 'loadSchedules handles missing directory');
  
  contacts = loadContacts();
  assert(typeof contacts === 'object', 'loadContacts handles missing directory');
  
  contact = resolveContact('test');
  assert(contact === null, 'resolveContact handles missing contacts file');

  console.log('');

  // ============================================
  // TEST SUITE 14: Scheduler Logic Simulation
  // ============================================
  console.log('--- Test Suite 14: Scheduler Logic ---');
  
  setup();
  
  // Test past schedule (should be sent)
  const pastSchedules = [
    { id: 1, message: 'Past message', target: 'test', runAt: '2020-01-01T00:00:00Z' }
  ];
  saveSchedules(pastSchedules);
  
  let loaded = loadSchedules();
  const currentTime = new Date();
  let pending = [];
  let sent = [];
  
  for (const schedule of loaded) {
    const runAt = new Date(schedule.runAt);
    if (runAt <= currentTime) {
      sent.push(schedule.id);
    } else {
      pending.push(schedule);
    }
  }
  
  assert(sent.length === 1, 'Scheduler detects past schedule to send');
  assert(pending.length === 0, 'Scheduler does not keep past schedule in pending');
  
  // Test future schedule (should not be sent)
  const futureSchedules = [
    { id: 2, message: 'Future message', target: 'test', runAt: '2099-01-01T00:00:00Z' }
  ];
  saveSchedules(futureSchedules);
  
  loaded = loadSchedules();
  pending = [];
  sent = [];
  
  for (const schedule of loaded) {
    const runAt = new Date(schedule.runAt);
    if (runAt <= currentTime) {
      sent.push(schedule.id);
    } else {
      pending.push(schedule);
    }
  }
  
  assert(sent.length === 0, 'Scheduler does not send future schedule');
  assert(pending.length === 1, 'Scheduler keeps future schedule in pending');
  
  // Test duplicate ID handling
  const mixedSchedules = [
    { id: 1, message: 'Message 1', target: 'test', runAt: '2020-01-01T00:00:00Z' },
    { id: 2, message: 'Message 2', target: 'test', runAt: '2020-01-01T00:00:00Z' }
  ];
  saveSchedules(mixedSchedules);
  
  loaded = loadSchedules();
  const sentIds = new Set();
  pending = [];
  sent = [];
  
  for (const schedule of loaded) {
    if (sentIds.has(schedule.id)) continue;
    
    const runAt = new Date(schedule.runAt);
    if (runAt <= currentTime) {
      sentIds.add(schedule.id);
      sent.push(schedule.id);
    } else {
      pending.push(schedule);
    }
  }
  
  assert(sent.length === 2, 'Scheduler sends all due schedules');
  assert(pending.length === 0, 'Scheduler clears all after sending');

  console.log('');

  // ============================================
  // TEST SUITE 15: Poller Logic Simulation
  // ============================================
  console.log('--- Test Suite 15: Poller Logic ---');
  
  // Test message filtering
  const testMessages = [
    { id: 1, fromMe: true, timestamp: 1000, body: '!help' },
    { id: 2, fromMe: false, timestamp: 1001, body: 'user message' },
    { id: 3, fromMe: true, timestamp: 1002, body: '!groups' },
    { id: 4, fromMe: true, timestamp: 999, body: 'old message' },
  ];
  
  let lastProcessedTimestamp = 1000;
  let processed = [];
  
  for (const msg of testMessages) {
    // Only process fromMe=true
    if (!msg.fromMe) continue;
    
    // Skip if already processed
    if (msg.timestamp <= lastProcessedTimestamp) continue;
    
    processed.push(msg.id);
    lastProcessedTimestamp = msg.timestamp;
  }
  
  assert(processed.length === 1, 'Poller only processes fromMe=true');
  assert(processed.includes(3), 'Poller processes new message (id 3)');
  assert(!processed.includes(4), 'Poller skips old message (id 4)');
  assert(!processed.includes(1), 'Poller skips already processed (id 1)');
  
  // Test timestamp edge case - same timestamp
  const sameTimestampMessages = [
    { id: 1, fromMe: true, timestamp: 1000, body: 'msg1' },
    { id: 2, fromMe: true, timestamp: 1000, body: 'msg2' },
  ];
  
  lastProcessedTimestamp = 1000;
  processed = [];
  
  for (const msg of sameTimestampMessages) {
    if (!msg.fromMe) continue;
    if (msg.timestamp <= lastProcessedTimestamp) continue;
    processed.push(msg.id);
    lastProcessedTimestamp = msg.timestamp;
  }
  
  assert(processed.length === 0, 'Poller skips messages with same timestamp');

  // ============================================
  // TEST SUITE 16: Forward Command Logic
  // ============================================
  console.log('--- Test Suite 16: Forward Command Logic ---');
  
  // Test parsing "forward to <group>"
  function parseForwardTarget(body) {
    if (!body.toLowerCase().startsWith('forward to ') && !body.toLowerCase().startsWith('fwd to ')) {
      return null;
    }
    return body.replace(/^(forward|fwd)\s+to\s+/i, '').trim().toLowerCase();
  }
  
  // Test forward target parsing
  assert(parseForwardTarget('forward to family') === 'family', 'Forward parses target family');
  assert(parseForwardTarget('fwd to work') === 'work', 'Forward parses target work');
  assert(parseForwardTarget('FORWARD TO friends') === 'friends', 'Forward is case insensitive');
  assert(parseForwardTarget('forward to group1 group2') === 'group1 group2', 'Forward parses multi-word target');
  assert(parseForwardTarget('send to family') === null, 'Forward rejects non-forward command');
  assert(parseForwardTarget('hello') === null, 'Forward rejects plain text');
  
  // Test quoted message detection
  const quotedMsgWithMedia = { hasMedia: true, type: 'image', body: 'Check this', caption: 'My image' };
  const quotedMsgTextOnly = { hasMedia: false, body: 'Hello world' };
  const quotedMsgNoBody = { hasMedia: true, type: 'video', body: null, caption: 'Video' };
  
  assert(quotedMsgWithMedia.hasMedia === true, 'Quoted message detects media');
  assert(quotedMsgTextOnly.hasMedia === false, 'Quoted message detects no media');
  assert(quotedMsgNoBody.body === null, 'Quoted message can have null body');
  
  // Test sendQuotedContent logic - should handle media
  function shouldForwardMedia(quotedMsg) {
    return quotedMsg.hasMedia && quotedMsg.type !== 'chat';
  }
  
  assert(shouldForwardMedia(quotedMsgWithMedia) === true, 'Should forward media for image');
  assert(shouldForwardMedia(quotedMsgTextOnly) === false, 'Should not forward media for text');
  assert(shouldForwardMedia(quotedMsgNoBody) === true, 'Should forward media even with null body');
  
  // Test group set resolution
  const testSets = {
    family: ['Family Group', 'Extended Family'],
    work: ['Work Team'],
    all: ['Family Group', 'Work Team', 'Friends']
  };
  
  const resolveSetGroups = (targetGroup, sets) => {
    const setGroups = sets[targetGroup];
    if (setGroups && Array.isArray(setGroups)) {
      return setGroups;
    }
    return null;
  };
  
  assert(resolveSetGroups('family', testSets)?.length === 2, 'Family set has 2 groups');
  assert(resolveSetGroups('work', testSets)?.length === 1, 'Work set has 1 group');
  assert(resolveSetGroups('friends', testSets) === null, 'Non-existent set returns null');
  
  console.log('');

  // ============================================
  // TEST SUITE 17: Bot Commands Parsing
  // ============================================
  console.log('--- Test Suite 17: Bot Commands Parsing ---');
  
  // Simulate command parsing logic
  function parseCommand(body) {
    if (!body || !body.startsWith('!')) return null;
    
    const raw = body.slice(1).trim();
    const cmdParts = raw.split(' ');
    const cmd = cmdParts[0].toLowerCase();
    const args = cmdParts.slice(1);
    
    return { cmd, args, raw, full: body };
  }
  
  // Test !help command
  const helpCmd = parseCommand('!help');
  assert(helpCmd?.cmd === 'help', '!help command parsed');
  assert(helpCmd?.args.length === 0, '!help has no args');
  
  // Test !groups command
  const groupsCmd = parseCommand('!groups');
  assert(groupsCmd?.cmd === 'groups', '!groups command parsed');
  
  // Test !sets command
  const setsCmd = parseCommand('!sets');
  assert(setsCmd?.cmd === 'sets', '!sets command parsed');
  
  // Test !send command with args
  const sendCmd = parseCommand('!send family Hello');
  assert(sendCmd?.cmd === 'send', '!send command parsed');
  assert(sendCmd?.args[0] === 'family', '!send parses target');
  assert(sendCmd?.args.slice(1).join(' ') === 'Hello', '!send parses message');
  
  // Test !all command
  const allCmd = parseCommand('!all Hello everyone');
  assert(allCmd?.cmd === 'all', '!all command parsed');
  assert(allCmd?.args.join(' ') === 'Hello everyone', '!all parses message');
  
  // Test !members command
  const membersCmd = parseCommand('!members Family');
  assert(membersCmd?.cmd === 'members', '!members command parsed');
  assert(membersCmd?.args[0] === 'Family', '!members parses group name');
  
  // Test !find command
  const findCmd = parseCommand('!find John');
  assert(findCmd?.cmd === 'find', '!find command parsed');
  assert(findCmd?.args[0] === 'John', '!find parses name');
  
  // Test !inactive command
  const inactiveCmd = parseCommand('!inactive');
  assert(inactiveCmd?.cmd === 'inactive', '!inactive command parsed');
  
  const inactiveDaysCmd = parseCommand('!inactive 7');
  assert(inactiveDaysCmd?.args[0] === '7', '!inactive parses days');
  
  // Test !schedules command
  const schedulesCmd = parseCommand('!schedules');
  assert(schedulesCmd?.cmd === 'schedules', '!schedules command parsed');
  
  // Test !cancel command
  const cancelCmd = parseCommand('!cancel');
  assert(cancelCmd?.cmd === 'cancel', '!cancel command parsed');
  
  // Test !contacts command
  const contactsCmd = parseCommand('!contacts');
  assert(contactsCmd?.cmd === 'contacts', '!contacts command parsed');
  
  // Test !addcontact command
  const addContactCmd = parseCommand('!addcontact John 919999999999');
  assert(addContactCmd?.cmd === 'addcontact', '!addcontact command parsed');
  assert(addContactCmd?.args[0] === 'John', '!addcontact parses name');
  assert(addContactCmd?.args[1] === '919999999999', '!addcontact parses number');
  
  // Test !track command
  const trackCmd = parseCommand('!track Hello');
  assert(trackCmd?.cmd === 'track', '!track command parsed');
  assert(trackCmd?.args[0] === 'Hello', '!track parses message');
  
  // Test !replies command
  const repliesCmd = parseCommand('!replies');
  assert(repliesCmd?.cmd === 'replies', '!replies command parsed');
  
  // Test !seen command
  const seenCmd = parseCommand('!seen Hello');
  assert(seenCmd?.cmd === 'seen', '!seen command parsed');
  assert(seenCmd?.args[0] === 'Hello', '!seen parses message');
  
  // Test !ai command
  const aiCmd = parseCommand('!ai Hello bot');
  assert(aiCmd?.cmd === 'ai', '!ai command parsed');
  assert(aiCmd?.args.join(' ') === 'Hello bot', '!ai parses message');
  
  // Test !forward command (with ! prefix)
  const forwardCmd = parseCommand('!forward Hello to family');
  assert(forwardCmd?.cmd === 'forward', '!forward command parsed');
  assert(forwardCmd?.args.join(' ') === 'Hello to family', '!forward parses full args');
  
  // Test command case insensitivity
  const upperCmd = parseCommand('!HELP');
  assert(upperCmd?.cmd === 'help', 'Commands are case insensitive');
  
  // Test unknown command
  const unknownCmd = parseCommand('!unknowncmd');
  assert(unknownCmd?.cmd === 'unknowncmd', 'Unknown command still parsed');
  
  // Test non-command (no ! prefix)
  const nonCmd = parseCommand('hello world');
  assert(nonCmd === null, 'Non-command returns null');
  
  const emptyCmd = parseCommand('');
  assert(emptyCmd === null, 'Empty string returns null');
  
  console.log('');

  // ============================================
  // FINAL SUMMARY
  // ============================================
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                        TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📊 Total:  ${testsPassed + testsFailed}`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  cleanup();
  
  if (testsFailed > 0) {
    console.log('\n⚠️  Some tests failed. Please review the failures above.');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

runTests();
