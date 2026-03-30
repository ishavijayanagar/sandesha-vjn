const {
  loadSets,
  loadSchedules,
  loadContacts,
  removeEmojis,
  cleanMessage,
  parseScheduleTime,
  formatTimeAgo,
  formatTimeUntil,
  delay,
  resolveContact
} = require('./test-utils');

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

async function runTests() {
  console.log('='.repeat(60));
  console.log('SANDESHA BOT - FUNCTIONAL TESTS');
  console.log('='.repeat(60));
  console.log('');

  console.log('--- Test Suite 1: File Operations ---');

  const sets = loadSets();
  assert(typeof sets === 'object', 'loadSets returns an object');
  assert(Array.isArray(sets.all), 'groups.json has "all" array');
  assert(sets.all.length > 0, 'groups.json "all" is not empty');
  assert(sets.all.includes('Hebbal Sector Anand Ale SPOCs and Volunteers'), 'groups.json contains Hebbal group');

  const schedules = loadSchedules();
  assert(Array.isArray(schedules), 'loadSchedules returns an array');

  const contacts = loadContacts();
  assert(typeof contacts === 'object', 'loadContacts returns an object');

  console.log('');
  console.log('--- Test Suite 2: Helper Functions ---');

  assertEqual(removeEmojis('Hello 👋'), 'Hello', 'removeEmojis removes emoji');
  assertEqual(removeEmojis('🌊Waves Of Hebbal'), 'Waves Of Hebbal', 'removeEmojis handles leading emoji');
  assertEqual(removeEmojis('No emoji'), 'No emoji', 'removeEmojis handles no emoji');

  assertEqual(cleanMessage('send hello', ['send', 'say']), 'hello', 'cleanMessage removes verb');
  assertEqual(cleanMessage('say hello world', ['send', 'say']), 'hello world', 'cleanMessage handles multi-word');
  assertEqual(cleanMessage('please send hello', ['send', 'say']), 'hello', 'cleanMessage handles please prefix');
  assertEqual(cleanMessage('hello', ['send', 'say']), 'hello', 'cleanMessage returns original if no match');
  assertEqual(cleanMessage('send', ['send', 'say']), '', 'cleanMessage returns empty for exact verb match');

  console.log('');
  console.log('--- Test Suite 3: Schedule Time Parsing ---');

  const time1 = parseScheduleTime('9am');
  assert(time1 !== null, 'parseScheduleTime parses 9am');
  if (time1) {
    assert(time1.getHours() === 9, '9am parsed to hour 9');
  }

  const time2 = parseScheduleTime('9:30am');
  assert(time2 !== null, 'parseScheduleTime parses 9:30am');
  if (time2) {
    assert(time2.getHours() === 9, '9:30am parsed to hour 9');
    assert(time2.getMinutes() === 30, '9:30am parsed to minutes 30');
  }

  const time3 = parseScheduleTime('2pm');
  assert(time3 !== null, 'parseScheduleTime parses 2pm');
  if (time3) {
    assert(time3.getHours() === 14, '2pm parsed to hour 14');
  }

  const time4 = parseScheduleTime('14:30');
  assert(time4 !== null, 'parseScheduleTime parses 14:30');
  if (time4) {
    assert(time4.getHours() === 14, '14:30 parsed to hour 14');
    assert(time4.getMinutes() === 30, '14:30 parsed to minutes 30');
  }

  const time5 = parseScheduleTime('9am tomorrow');
  assert(time5 !== null, 'parseScheduleTime parses 9am tomorrow');
  if (time5) {
    const futureTime = new Date();
    futureTime.setDate(futureTime.getDate() + 1);
    assert(time5 > new Date(), '9am tomorrow is in the future');
  }

  const time6 = parseScheduleTime('9am monday');
  assert(time6 !== null, 'parseScheduleTime parses 9am monday');
  if (time6) {
    assert(time6.getDay() >= 0 && time6.getDay() <= 6, '9am monday returns a valid day');
  }

  const time7 = parseScheduleTime('march 30');
  assert(time7 !== null, 'parseScheduleTime parses march 30');
  if (time7) {
    assert(time7.getMonth() === 2, 'march 30 is March (month 2)');
    assert(time7.getDate() === 30, 'march 30 is day 30');
  }

  const time8 = parseScheduleTime('daily at 9am');
  assert(time8 !== null, 'parseScheduleTime parses daily at 9am');

  const time9 = parseScheduleTime('invalid time');
  assert(time9 === null, 'parseScheduleTime returns null for invalid time');

  const time10 = parseScheduleTime('4.47am');
  assert(time10 !== null, 'parseScheduleTime parses 4.47am (4:47)');
  if (time10) {
    assert(time10.getHours() === 4, '4.47am parsed to hour 4');
    assert(time10.getMinutes() === 47, '4.47am parsed to minutes 47');
  }

  console.log('');
  console.log('--- Test Suite 4: Time Formatting ---');

  const now = Math.floor(Date.now() / 1000);
  assertEqual(formatTimeAgo(now), 'Just now', 'formatTimeAgo shows Just now for current time');
  assertEqual(formatTimeAgo(now - 30), 'Just now', 'formatTimeAgo shows Just now for <60s ago');
  assertEqual(formatTimeAgo(now - 300), '5 min ago', 'formatTimeAgo shows minutes');
  assertEqual(formatTimeAgo(now - 3600), '1 hours ago', 'formatTimeAgo shows hours');
  assertEqual(formatTimeAgo(now - 86400), '1 days ago', 'formatTimeAgo shows days');

  const futureDate = new Date(Date.now() + 3600000);
  assertEqual(formatTimeUntil(futureDate), 'in 1h 0m', 'formatTimeUntil shows hours');

  const futureDate2 = new Date(Date.now() + 7200000);
  assertEqual(formatTimeUntil(futureDate2), 'in 2h 0m', 'formatTimeUntil shows hours > 1');

  const futureDate3 = new Date(Date.now() + 90000000);
  assertEqual(formatTimeUntil(futureDate3), 'in 1 day', 'formatTimeUntil shows days');

  console.log('');
  console.log('--- Test Suite 5: Contact Resolution ---');

  const contact = resolveContact('test');
  assert(contact === null || typeof contact === 'string', 'resolveContact returns string or null');

  console.log('');
  console.log('--- Test Suite 6: Delay Function ---');

  const start = Date.now();
  await delay(100);
  const elapsed = Date.now() - start;
  assert(elapsed >= 90 && elapsed < 200, 'delay(100) waits approximately 100ms');

  console.log('');
  console.log('='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`Total: ${testsPassed + testsFailed}`);
  console.log('='.repeat(60));

  if (testsFailed > 0) {
    console.log('\n⚠️  Some tests failed. Please review the failures above.');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

runTests();
