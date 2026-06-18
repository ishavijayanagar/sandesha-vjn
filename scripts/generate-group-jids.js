#!/usr/bin/env node
/**
 * Resolve WhatsApp group names → JIDs using Sandesha's HTTP API (listen.js must be running).
 *
 * Usage:
 *   node scripts/resolve-group-jids.js "VJN Volunteers 1" "Isha Kengeri"
 *   node scripts/resolve-group-jids.js --file groups-to-resolve.txt
 *   node scripts/resolve-group-jids.js --file groups-to-resolve.txt --json all_vols_grps
 *
 * Options:
 *   --host 127.0.0.1      API host
 *   --port 42620         API port
 *   --file PATH          One group name per line (# and blank lines ignored)
 *   --json SET_NAME      Print a groups.json snippet: { "SET_NAME": [ jid, ... ] }
 *   --pick-largest       For duplicate exact names, pick highest participant count (default)
 *   --pick-first         For duplicates, use first match from /groups order
 */

const fs = require('fs');
const http = require('http');

function parseArgs(argv) {
  const opts = {
    host: '127.0.0.1',
    port: 42620,
    file: null,
    jsonSet: null,
    pick: 'largest',
    names: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') opts.host = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--file') opts.file = argv[++i];
    else if (a === '--json') opts.jsonSet = argv[++i];
    else if (a === '--pick-largest') opts.pick = 'largest';
    else if (a === '--pick-first') opts.pick = 'first';
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      process.exit(1);
    } else opts.names.push(a);
  }
  return opts;
}

function fetchGroups(host, port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: host, port, path: '/groups', method: 'GET', timeout: 15000 },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`/groups HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            const data = JSON.parse(body);
            if (!Array.isArray(data)) {
              reject(new Error(`/groups must return a JSON array, got: ${typeof data}`));
              return;
            }
            resolve(data);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

function norm(s) {
  return String(s || '')
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, '')
    .toLowerCase();
}

function pickFromAmbiguous(matches, strategy) {
  if (matches.length === 1) return matches[0];
  if (strategy === 'first') return matches[0];
  return [...matches].sort(
    (a, b) => (b.participants || 0) - (a.participants || 0),
  )[0];
}

function resolveOne(wanted, allGroups, pickStrategy) {
  const key = norm(wanted);
  const exact = allGroups.filter((g) => norm(g.name) === key);
  if (exact.length === 1) {
    return { wanted, status: 'ok', jid: exact[0].jid, name: exact[0].name, note: null };
  }
  if (exact.length > 1) {
    const chosen = pickFromAmbiguous(exact, pickStrategy);
    return {
      wanted,
      status: 'ambiguous',
      jid: chosen.jid,
      name: chosen.name,
      note: `Duplicate name (${exact.length} chats). Picked ${pickStrategy === 'largest' ? 'largest participant count' : 'first'}: ${chosen.participants ?? '?'} participants`,
      alternates: exact.filter((g) => g.jid !== chosen.jid),
    };
  }
  const partial = allGroups.filter(
    (g) =>
      norm(g.name).includes(key) ||
      key.includes(norm(g.name)),
  );
  if (partial.length === 1) {
    return {
      wanted,
      status: 'partial',
      jid: partial[0].jid,
      name: partial[0].name,
      note: 'Matched by partial name overlap',
    };
  }
  if (partial.length > 1) {
    return {
      wanted,
      status: 'multi_partial',
      jid: null,
      name: null,
      note: 'Multiple partial matches; refine the name',
      alternates: partial,
    };
  }
  return { wanted, status: 'not_found', jid: null, name: null, note: null };
}

function readNamesFromFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\d+\.\s*/, '').trim())
    .filter((l) => l && !l.startsWith('#'));
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(fs.readFileSync(__filename, 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1]);
    process.exit(0);
  }

  let names = [...opts.names];
  if (opts.file) {
    names = names.concat(readNamesFromFile(opts.file));
  }
  names = names.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) {
    console.error('No group names. Pass names as args or use --file path.txt');
    process.exit(1);
  }

  fetchGroups(opts.host, opts.port)
    .then((groups) => {
      const results = names.map((w) => resolveOne(w, groups, opts.pick));
      const failed = results.filter((r) => r.status === 'not_found' || r.status === 'multi_partial');

      if (opts.jsonSet) {
        if (failed.length) {
          console.error('Cannot emit --json: unresolved names:');
          for (const r of failed) {
            console.error(`  - ${r.wanted} (${r.status})`);
            if (r.alternates) {
              for (const a of r.alternates.slice(0, 8)) {
                console.error(`      ${a.jid}  ${a.name}`);
              }
            }
          }
          process.exit(1);
        }
        const jids = results.map((r) => r.jid);
        const obj = { [opts.jsonSet]: jids };
        console.log(JSON.stringify(obj, null, 2));
        return;
      }

      for (const r of results) {
        console.log('---', r.wanted);
        if (r.jid) {
          console.log('  jid: ', r.jid);
          console.log('  name:', r.name);
        } else {
          console.log('  (no single match)');
        }
        console.log('  status:', r.status);
        if (r.note) console.log('  note: ', r.note);
        if (r.alternates && r.alternates.length) {
          console.log('  alternates:');
          for (const a of r.alternates) {
            console.log(`    ${a.jid} | ${a.name} | participants: ${a.participants ?? '?'}`);
          }
        }
      }

      console.log();
      console.log(`API returned ${groups.length} groups. Resolved ${results.filter((r) => r.jid).length}/${results.length}.`);
      if (failed.length) process.exitCode = 1;
    })
    .catch((err) => {
      console.error('Error:', err.message);
      console.error('Is listen.js running? Try: curl http://127.0.0.1:42620/health');
      process.exit(1);
    });
}

main();
