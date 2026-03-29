const http = require('http');
const path = require('path');
const fs = require('fs');

const GROUPS_FILE = path.join(__dirname, 'groups.json');

const args = process.argv.slice(2);
const flags = { groups: [] };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--list' || args[i] === '-l') flags.list = true;
  else if (args[i] === '--sets') flags.showSets = true;
  else if (args[i] === '--all') flags.all = true;
  else if (args[i] === '--set' || args[i] === '-s') flags.set = args[++i];
  else if (args[i] === '--group' || args[i] === '-g') flags.groups.push(args[++i]);
  else if (args[i] === '--groups') flags.groups = args[++i].split(',').map(s => s.trim());
  else if (args[i] === '--jid' || args[i] === '-j') flags.groups.push(args[++i]);
  else if (args[i] === '--message' || args[i] === '--msg' || args[i] === '-m') flags.message = args[++i];
  else if (args[i] === '--file' || args[i] === '-f') flags.file = args[++i];
  else if (args[i] === '--caption' || args[i] === '-c') flags.caption = args[++i];
  else if (args[i] === '--help' || args[i] === '-h') flags.help = true;
}

if (flags.help || (!flags.list && !flags.showSets && !flags.all && !flags.set && flags.groups.length === 0)) {
  console.log(`
WhatsApp Sender for ZeroClaw

Usage:
  node send.js --list                              List all groups
  node send.js --sets                              List group sets
  node send.js --group "Group1" --msg "Hi"         Send text to one group
  node send.js --groups "Group1,Group2" --msg "Hi" Send text to multiple groups
  node send.js --set family --msg "Hi"             Send text to group set
  node send.js --all --msg "Hi"                    Send text to ALL groups

  node send.js --set family --file "C:\\path\\video.mp4" --caption "Hi"  Send media to set
  node send.js --group "Group1" --file "photo.jpg" --caption "Look!"     Send media to group

Group sets are defined in groups.json.
`);
  process.exit(0);
}

function loadSets() {
  try {
    return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function request(method, path, body) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 42620, path, method,
      headers: { 'Content-Type': 'application/json' }, timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', (err) => {
      console.error('Error:', err.message, '\nIs listen.js running?');
      process.exit(1);
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  if (flags.list) {
    const groups = await request('GET', '/groups');
    if (Array.isArray(groups)) {
      console.log('\nGroups:\n-------');
      for (const g of groups) {
        console.log(`  ${g.name} | ${g.jid} | ${g.participants} participants`);
      }
      console.log(`\nTotal: ${groups.length} groups`);
    } else {
      console.log('Error:', groups);
    }
    return;
  }

  if (flags.showSets) {
    const sets = loadSets();
    const keys = Object.keys(sets);
    if (keys.length === 0) {
      console.log('No sets defined. Edit groups.json to create sets.');
      return;
    }
    console.log('\nGroup Sets:\n-----------');
    for (const [name, groups] of Object.entries(sets)) {
      console.log(`  ${name}: ${groups.join(', ')}`);
    }
    return;
  }

  if (!flags.message && !flags.file) {
    console.error('Error: --message or --file is required');
    process.exit(1);
  }

  // Validate file if provided
  if (flags.file && !fs.existsSync(flags.file)) {
    console.error(`Error: file not found: ${flags.file}`);
    process.exit(1);
  }

  // --set: resolve set name to group list
  if (flags.set) {
    const sets = loadSets();
    const setGroups = sets[flags.set.toLowerCase()];
    if (!setGroups) {
      console.error(`Set "${flags.set}" not found. Available sets: ${Object.keys(sets).join(', ') || 'none'}`);
      process.exit(1);
    }
    flags.groups = setGroups;
    console.log(`Sending to "${flags.set}" set (${flags.groups.length} groups)...`);
  }

  // --all: get all groups
  if (flags.all) {
    const groups = await request('GET', '/groups');
    if (!Array.isArray(groups)) {
      console.error('Error fetching groups:', groups);
      process.exit(1);
    }
    flags.groups = groups.map(g => g.jid);
    console.log(`Sending to all ${flags.groups.length} groups...`);
  }

  if (flags.groups.length === 0) {
    console.error('Error: no groups specified');
    process.exit(1);
  }

  // Send to each group
  const results = [];
  for (const target of flags.groups) {
    let result;
    if (flags.file) {
      result = await request('POST', '/send-media', {
        recipient: target,
        filePath: flags.file,
        caption: flags.caption || flags.message || ''
      });
    } else {
      result = await request('POST', '/send', { recipient: target, message: flags.message });
    }
    results.push({ target, ...result });
    if (result.ok) {
      console.log(`  ✅ ${result.chat}: sent${flags.file ? ' (media)' : ''}`);
    } else {
      console.log(`  ❌ ${target}: ${result.error}`);
    }
  }

  const sent = results.filter(r => r.ok).length;
  console.log(`\nDone: ${sent}/${results.length} sent`);
}

main();
