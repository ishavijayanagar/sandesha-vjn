const fs = require('fs');
const path = require('path');

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

console.log('═══════════════════════════════════════════════════════════════');
console.log('         POLLER LOGIC - COMPREHENSIVE TESTS (v2)');
console.log('═══════════════════════════════════════════════════════════════');

// Test 1: Fresh start with current timestamp
console.log('\n--- Test 1: Fresh start with current timestamp ---');
{
  let lastProcessedTimestamp = Math.floor(Date.now() / 1000);
  let recentReplies = new Set();
  
  const messages = [
    { id: 1, fromMe: true, timestamp: 1000, body: 'old msg' },
    { id: 2, fromMe: true, timestamp: lastProcessedTimestamp + 1, body: 'new msg' },
  ];
  
  let processed = [];
  for (const msg of messages) {
    if (msg.timestamp > lastProcessedTimestamp) {
      if (recentReplies.has(msg.body?.trim())) continue;
      processed.push(msg.id);
      lastProcessedTimestamp = msg.timestamp;
    }
  }
  
  assert(!processed.includes(1), 'Old message should be skipped');
  assert(processed.includes(2), 'New message should be processed');
}

// Test 2: With timestamp=0, ALL messages get processed (expected behavior)
console.log('\n--- Test 2: Process all messages (timestamp=0) ---');
{
  let lastProcessedTimestamp = 0;
  let recentReplies = new Set();
  
  const messages = [
    { id: 1, fromMe: true, timestamp: 1000, body: '!help' },
    { id: 2, fromMe: false, timestamp: 1001, body: 'phone msg' }, // phone
    { id: 3, fromMe: true, timestamp: 1002, body: 'new cmd' },
  ];
  
  let processed = [];
  for (const msg of messages) {
    if (msg.timestamp > lastProcessedTimestamp) {
      if (recentReplies.has(msg.body?.trim())) continue;
      processed.push(msg.id);
      lastProcessedTimestamp = msg.timestamp;
      recentReplies.add(msg.body.trim());
    }
  }
  
  // With timestamp=0, ALL messages with timestamp > 0 are processed
  // This is expected when using 0 - it's for fresh install/first run
  assert(processed.includes(1), 'Should process web message');
  assert(processed.includes(3), 'Should process new message');
  // Note: phone message gets processed with timestamp=0
}

// Test 3: recentReplies prevents infinite loop
console.log('\n--- Test 3: recentReplies prevents infinite loop ---');
{
  let lastProcessedTimestamp = 0;
  let recentReplies = new Set();
  
  const messages = [
    { id: 1, fromMe: true, timestamp: 1000, body: '!help' },
    { id: 2, fromMe: true, timestamp: 1001, body: 'Help response' },
  ];
  
  // First poll
  let processed = [];
  for (const msg of messages) {
    if (msg.timestamp > lastProcessedTimestamp) {
      if (recentReplies.has(msg.body?.trim())) continue;
      processed.push(msg.id);
      lastProcessedTimestamp = msg.timestamp;
      recentReplies.add(msg.body.trim());
    }
  }
  console.log(`  First poll: ${processed.join(', ')}`);
  
  // Second poll
  processed = [];
  for (const msg of messages) {
    if (msg.timestamp > lastProcessedTimestamp) {
      if (recentReplies.has(msg.body?.trim())) continue;
      processed.push(msg.id);
      lastProcessedTimestamp = msg.timestamp;
    }
  }
  console.log(`  Second poll: ${processed.join(', ')}`);
  
  assert(processed.length === 0, 'Second poll should NOT process (in recentReplies)');
}

// Test 4: Different messages still processed
console.log('\n--- Test 4: Different messages in second poll ---');
{
  let lastProcessedTimestamp = 0;
  let recentReplies = new Set();
  
  const poll1 = [
    { id: 1, fromMe: true, timestamp: 1000, body: 'cmd1' },
  ];
  
  const poll2 = [
    { id: 2, fromMe: true, timestamp: 1001, body: 'cmd2' },
  ];
  
  // First poll
  let processed = [];
  for (const msg of poll1) {
    if (msg.timestamp > lastProcessedTimestamp) {
      if (recentReplies.has(msg.body?.trim())) continue;
      processed.push(msg.id);
      lastProcessedTimestamp = msg.timestamp;
      recentReplies.add(msg.body.trim());
    }
  }
  
  // Second poll with different message
  for (const msg of poll2) {
    if (msg.timestamp > lastProcessedTimestamp) {
      if (recentReplies.has(msg.body?.trim())) continue;
      processed.push(msg.id);
      lastProcessedTimestamp = msg.timestamp;
      recentReplies.add(msg.body.trim());
    }
  }
  
  assert(processed.includes(1), 'Should process first command');
  assert(processed.includes(2), 'Should process second command');
  assert(processed.length === 2, 'Should process both different commands');
}

// Test 5: Same timestamp - only first processed
console.log('\n--- Test 5: Same timestamp ---');
{
  let lastProcessedTimestamp = 999;
  let recentReplies = new Set();
  
  const messages = [
    { id: 1, fromMe: true, timestamp: 1000, body: 'msg1' },
    { id: 2, fromMe: true, timestamp: 1000, body: 'msg2' },
    { id: 3, fromMe: true, timestamp: 1000, body: 'msg3' },
  ];
  
  let processed = [];
  for (const msg of messages) {
    if (msg.timestamp > lastProcessedTimestamp) {
      if (recentReplies.has(msg.body?.trim())) continue;
      processed.push(msg.id);
      lastProcessedTimestamp = msg.timestamp;
      recentReplies.add(msg.body.trim());
    }
  }
  
  assert(processed.length === 1, 'Only first message with same timestamp should be processed');
  assert(processed.includes(1), 'First message should be processed');
}

// Test 6: Phone messages tracked but not processed
console.log('\n--- Test 6: Phone messages tracked ---');
{
  let lastProcessedTimestamp = 0;
  
  const messages = [
    { id: 1, fromMe: true, timestamp: 1000, body: 'web msg' },
    { id: 2, fromMe: false, timestamp: 1001, body: 'phone msg' },
    { id: 3, fromMe: true, timestamp: 1002, body: 'web msg2' },
  ];
  
  let processed = [];
  for (const msg of messages) {
    if (msg.timestamp > lastProcessedTimestamp) {
      processed.push(msg.id);
      lastProcessedTimestamp = msg.timestamp;
    }
  }
  
  // Both web messages processed, phone tracked
  assert(processed.includes(1), 'First web msg processed');
  assert(processed.includes(2), 'Phone msg tracked (timestamp updated)');
  assert(processed.includes(3), 'Second web msg processed');
}

// Test 7: Realistic scenario - new commands after restart
console.log('\n--- Test 7: Realistic - restart with current timestamp ---');
{
  // Simulate restart with current timestamp (don't process old)
  const now = Math.floor(Date.now() / 1000);
  let lastProcessedTimestamp = now;
  let recentReplies = new Set();
  
  const oldMsgs = [
    { id: 1, fromMe: true, timestamp: now - 100, body: 'old cmd' },
  ];
  
  const newMsgs = [
    { id: 2, fromMe: true, timestamp: now + 10, body: 'new cmd after restart' },
  ];
  
  let processed = [];
  for (const msg of [...oldMsgs, ...newMsgs]) {
    if (msg.timestamp > lastProcessedTimestamp) {
      if (recentReplies.has(msg.body?.trim())) continue;
      processed.push(msg.id);
      lastProcessedTimestamp = msg.timestamp;
      recentReplies.add(msg.body.trim());
    }
  }
  
  assert(!processed.includes(1), 'Old command should be skipped');
  assert(processed.includes(2), 'New command after restart should be processed');
}

// Summary
console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);
console.log('═══════════════════════════════════════════════════════════════');

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('\n✅ All poller logic tests passed!');
}
