'use strict';

const SESSION_TTL_MS = 15 * 60 * 1000;
const PAGE_SIZE = 10;

const sessions = new Map();

function normalizeSetName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

function getSession(chatId) {
  const s = sessions.get(chatId);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(chatId);
    return null;
  }
  return s;
}

function touchSession(chatId, patch) {
  const existing = getSession(chatId) || { chatId };
  const next = {
    ...existing,
    ...patch,
    chatId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(chatId, next);
  return next;
}

function clearSession(chatId) {
  sessions.delete(chatId);
}

function settingsMenuText() {
  return `⚙️ *Settings*

1. Show sets
2. Add set
3. Edit set
4. Delete set
5. Cancel

Reply with a number (e.g. 2)`;
}

async function getAllGroups(client) {
  const chats = await client.getChats();
  return chats
    .filter((c) => c.isGroup)
    .map((c) => ({ name: c.name, jid: c.id._serialized }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function searchGroups(groups, query) {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups.filter((g) => g.name.toLowerCase().includes(q));
}

function formatGroupPage(results, page, selectedJids) {
  const start = page * PAGE_SIZE;
  const slice = results.slice(start, start + PAGE_SIZE);
  if (slice.length === 0) return 'No groups on this page. Type a search keyword or *list*.';

  const selected = new Set(selectedJids || []);
  let text = `Groups (page ${page + 1}/${Math.max(1, Math.ceil(results.length / PAGE_SIZE))}):\n`;
  slice.forEach((g, i) => {
    const n = start + i + 1;
    const mark = selected.has(g.jid) ? '✅' : '⬜';
    text += `${mark} ${n}. ${g.name}\n`;
  });
  text += `\nReply:\n• numbers: *1 3 5* (toggle)\n• *next* / *prev* — pages\n• *search vjn* — new search\n• *done* — save set\n• *cancel* — abort`;
  if (selected.size > 0) text += `\n\nSelected: ${selected.size} group(s)`;
  return text;
}

async function formatSetsList(loadSets, client) {
  const sets = loadSets();
  const keys = Object.keys(sets);
  if (keys.length === 0) return 'No sets defined yet.\nUse *2* (Add set) to create one.';

  const chats = await client.getChats();
  const jidToName = new Map(chats.filter((c) => c.isGroup).map((c) => [c.id._serialized, c.name]));

  let text = `📋 *Group Sets* (${keys.length})\n\n`;
  keys.forEach((name, i) => {
    const jids = sets[name] || [];
    text += `${i + 1}. *${name}* (${jids.length})\n`;
    jids.slice(0, 5).forEach((jid) => {
      text += `   • ${jidToName.get(jid) || jid}\n`;
    });
    if (jids.length > 5) text += `   … +${jids.length - 5} more\n`;
    text += '\n';
  });
  return text.trim();
}

function parseNumberList(input, max) {
  return [...new Set(
    input
      .split(/[\s,]+/)
      .map((x) => parseInt(x, 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= max)
  )];
}

function createSettingsWizard({ client, loadSets, saveSets, botReply, log }) {
  async function startSettings(msg) {
    const chatId = msg.from;
    touchSession(chatId, { step: 'menu' });
    await botReply(msg, settingsMenuText());
  }

  async function handleSession(msg) {
    const chatId = msg.from;
    const session = getSession(chatId);
    if (!session) return false;

    const body = (msg.body || '').trim();
    const lower = body.toLowerCase();

    if (lower === 'cancel' || lower === '5' && session.step === 'menu') {
      clearSession(chatId);
      await botReply(msg, 'Settings cancelled.');
      return true;
    }

    try {
      switch (session.step) {
        case 'menu':
          return await handleMenu(msg, body, session);
        case 'add_name':
          return await handleAddName(msg, body, session);
        case 'add_search':
          return await handleAddSearch(msg, body, session);
        case 'add_pick':
          return await handleAddPick(msg, body, session);
        case 'edit_pick_set':
          return await handleEditPickSet(msg, body, session);
        case 'edit_action':
          return await handleEditAction(msg, body, session);
        case 'edit_search':
          return await handleEditSearch(msg, body, session);
        case 'edit_pick':
          return await handleEditPick(msg, body, session);
        case 'edit_remove':
          return await handleEditRemove(msg, body, session);
        case 'delete_pick':
          return await handleDeletePick(msg, body, session);
        case 'delete_confirm':
          return await handleDeleteConfirm(msg, body, session);
        default:
          clearSession(chatId);
          return false;
      }
    } catch (err) {
      log(`[SETTINGS] Error: ${err.message}`);
      clearSession(chatId);
      await botReply(msg, `Settings error: ${err.message}`);
      return true;
    }
  }

  async function handleMenu(msg, body, session) {
    const chatId = msg.from;
    const choice = body.trim();

    if (choice === '1') {
      clearSession(chatId);
      await botReply(msg, await formatSetsList(loadSets, client));
      return true;
    }
    if (choice === '2') {
      touchSession(chatId, { step: 'add_name', setName: '', selectedJids: [] });
      await botReply(msg, 'Type a name for the new set (e.g. *family*, *all_vols_grps*):');
      return true;
    }
    if (choice === '3') {
      const sets = loadSets();
      const keys = Object.keys(sets);
      if (keys.length === 0) {
        clearSession(chatId);
        await botReply(msg, 'No sets to edit.');
        return true;
      }
      let text = 'Which set to edit?\n';
      keys.forEach((k, i) => text += `${i + 1}. ${k} (${(sets[k] || []).length} groups)\n`);
      text += '\nReply with number, or *cancel*';
      touchSession(chatId, { step: 'edit_pick_set', setKeys: keys });
      await botReply(msg, text);
      return true;
    }
    if (choice === '4') {
      const sets = loadSets();
      const keys = Object.keys(sets);
      if (keys.length === 0) {
        clearSession(chatId);
        await botReply(msg, 'No sets to delete.');
        return true;
      }
      let text = 'Which set to delete?\n';
      keys.forEach((k, i) => text += `${i + 1}. ${k}\n`);
      text += '\nReply with number, or *cancel*';
      touchSession(chatId, { step: 'delete_pick', setKeys: keys });
      await botReply(msg, text);
      return true;
    }
    if (choice === '5' || choice.toLowerCase() === 'cancel') {
      clearSession(chatId);
      await botReply(msg, 'Settings cancelled.');
      return true;
    }

    await botReply(msg, 'Reply 1–5, or *cancel*.');
    return true;
  }

  async function handleAddName(msg, body, session) {
    const chatId = msg.from;
    const name = normalizeSetName(body);
    if (!name || !/^[a-z0-9_]+$/.test(name)) {
      await botReply(msg, 'Invalid name. Use letters, numbers, underscores only.');
      return true;
    }
    const sets = loadSets();
    if (sets[name]) {
      await botReply(msg, `Set "${name}" already exists. Pick another name or use *3* Edit set.`);
      return true;
    }
    touchSession(chatId, {
      step: 'add_search',
      setName: name,
      selectedJids: [],
      searchResults: [],
      page: 0,
    });
    await botReply(msg, `Set name: *${name}*\n\nSearch groups — type a keyword (e.g. *vjn*) or *list* for first groups:`);
    return true;
  }

  async function handleAddSearch(msg, body, session) {
    const chatId = msg.from;
    const all = await getAllGroups(client);
    const query = body.toLowerCase() === 'list' ? '' : body;
    const results = searchGroups(all, query).slice(0, 100);
    if (results.length === 0) {
      await botReply(msg, 'No groups found. Try another keyword or *list*.');
      return true;
    }
    touchSession(chatId, {
      step: 'add_pick',
      searchResults: results,
      searchQuery: query,
      page: 0,
      selectedJids: session.selectedJids || [],
    });
    await botReply(msg, formatGroupPage(results, 0, session.selectedJids));
    return true;
  }

  async function handleAddPick(msg, body, session) {
    const chatId = msg.from;
    const lower = body.toLowerCase();

    if (lower === 'done') {
      const selected = session.selectedJids || [];
      if (selected.length === 0) {
        await botReply(msg, 'No groups selected. Pick at least one, or *cancel*.');
        return true;
      }
      const sets = loadSets();
      sets[session.setName] = [...selected];
      saveSets(sets);
      clearSession(chatId);
      await botReply(msg, `✅ Saved set *${session.setName}* with ${selected.length} group(s).`);
      return true;
    }

    if (lower.startsWith('search ')) {
      touchSession(chatId, { step: 'add_search' });
      return await handleAddSearch(msg, body.slice(7).trim(), session);
    }

    if (lower === 'next') {
      const maxPage = Math.ceil((session.searchResults || []).length / PAGE_SIZE) - 1;
      const page = Math.min((session.page || 0) + 1, maxPage);
      touchSession(chatId, { page });
      await botReply(msg, formatGroupPage(session.searchResults, page, session.selectedJids));
      return true;
    }

    if (lower === 'prev') {
      const page = Math.max((session.page || 0) - 1, 0);
      touchSession(chatId, { page });
      await botReply(msg, formatGroupPage(session.searchResults, page, session.selectedJids));
      return true;
    }

    const page = session.page || 0;
    const start = page * PAGE_SIZE;
    const slice = (session.searchResults || []).slice(start, start + PAGE_SIZE);
    const nums = parseNumberList(body, start + slice.length);
    if (nums.length === 0) {
      await botReply(msg, 'Reply with numbers (e.g. *1 3*), *next*, *search vjn*, or *done*.');
      return true;
    }

    const selected = new Set(session.selectedJids || []);
    nums.forEach((n) => {
      const g = session.searchResults[n - 1];
      if (!g) return;
      if (selected.has(g.jid)) selected.delete(g.jid);
      else selected.add(g.jid);
    });
    touchSession(chatId, { selectedJids: [...selected] });
    await botReply(msg, formatGroupPage(session.searchResults, page, [...selected]));
    return true;
  }

  async function handleEditPickSet(msg, body, session) {
    const chatId = msg.from;
    const idx = parseInt(body, 10) - 1;
    const keys = session.setKeys || [];
    if (!Number.isFinite(idx) || idx < 0 || idx >= keys.length) {
      await botReply(msg, 'Reply with a valid number, or *cancel*.');
      return true;
    }
    const setName = keys[idx];
    const sets = loadSets();
    const jids = sets[setName] || [];
    const chats = await client.getChats();
    const jidToName = new Map(chats.filter((c) => c.isGroup).map((c) => [c.id._serialized, c.name]));

    let text = `Editing *${setName}* (${jids.length} groups)\n\n`;
    jids.forEach((jid, i) => {
      text += `${i + 1}. ${jidToName.get(jid) || jid}\n`;
    });
    text += '\n*a* — add groups\n*r* — remove groups\n*done* — finish';
    touchSession(chatId, { step: 'edit_action', setName, setJids: [...jids] });
    await botReply(msg, text);
    return true;
  }

  async function handleEditAction(msg, body, session) {
    const chatId = msg.from;
    const lower = body.toLowerCase();
    if (lower === 'done') {
      clearSession(chatId);
      await botReply(msg, `✅ Set *${session.setName}* is up to date (${(session.setJids || []).length} groups).`);
      return true;
    }
    if (lower === 'a') {
      touchSession(chatId, { step: 'edit_search', selectedJids: [], searchResults: [], page: 0 });
      await botReply(msg, 'Search groups to add — type keyword or *list*:');
      return true;
    }
    if (lower === 'r') {
      const jids = session.setJids || [];
      if (jids.length === 0) {
        await botReply(msg, 'Set is empty. Use *a* to add groups.');
        return true;
      }
      const chats = await client.getChats();
      const jidToName = new Map(chats.filter((c) => c.isGroup).map((c) => [c.id._serialized, c.name]));
      let text = 'Remove which groups?\n';
      jids.forEach((jid, i) => {
        text += `${i + 1}. ${jidToName.get(jid) || jid}\n`;
      });
      text += '\nReply numbers (e.g. *1 2*), or *cancel*';
      touchSession(chatId, { step: 'edit_remove' });
      await botReply(msg, text);
      return true;
    }
    await botReply(msg, 'Reply *a*, *r*, or *done*.');
    return true;
  }

  async function handleEditSearch(msg, body, session) {
    const chatId = msg.from;
    const all = await getAllGroups(client);
    const query = body.toLowerCase() === 'list' ? '' : body;
    const existing = new Set(session.setJids || []);
    const results = searchGroups(all, query).filter((g) => !existing.has(g.jid)).slice(0, 100);
    if (results.length === 0) {
      await botReply(msg, 'No new groups found. Try another keyword.');
      return true;
    }
    touchSession(chatId, { step: 'edit_pick', searchResults: results, page: 0, selectedJids: [] });
    await botReply(msg, formatGroupPage(results, 0, []));
    return true;
  }

  async function handleEditPick(msg, body, session) {
    const chatId = msg.from;
    const lower = body.toLowerCase();

    if (lower === 'done') {
      const add = session.selectedJids || [];
      const merged = [...new Set([...(session.setJids || []), ...add])];
      const sets = loadSets();
      sets[session.setName] = merged;
      saveSets(sets);
      touchSession(chatId, { step: 'edit_action', setJids: merged, selectedJids: [] });
      await botReply(msg, `Added ${add.length} group(s). Total: ${merged.length}. Reply *done* to finish or *a*/*r* for more changes.`);
      return true;
    }

    if (lower.startsWith('search ')) {
      touchSession(chatId, { step: 'edit_search' });
      return await handleEditSearch(msg, body.slice(7).trim(), session);
    }

    if (lower === 'next' || lower === 'prev') {
      const maxPage = Math.ceil((session.searchResults || []).length / PAGE_SIZE) - 1;
      const page = lower === 'next'
        ? Math.min((session.page || 0) + 1, maxPage)
        : Math.max((session.page || 0) - 1, 0);
      touchSession(chatId, { page });
      await botReply(msg, formatGroupPage(session.searchResults, page, session.selectedJids));
      return true;
    }

    const page = session.page || 0;
    const start = page * PAGE_SIZE;
    const slice = (session.searchResults || []).slice(start, start + PAGE_SIZE);
    const nums = parseNumberList(body, start + slice.length);
    if (nums.length === 0) {
      await botReply(msg, 'Reply numbers, *next*, *search vjn*, or *done*.');
      return true;
    }

    const selected = new Set(session.selectedJids || []);
    nums.forEach((n) => {
      const g = session.searchResults[n - 1];
      if (!g) return;
      if (selected.has(g.jid)) selected.delete(g.jid);
      else selected.add(g.jid);
    });
    touchSession(chatId, { selectedJids: [...selected] });
    await botReply(msg, formatGroupPage(session.searchResults, page, [...selected]));
    return true;
  }

  async function handleEditRemove(msg, body, session) {
    const chatId = msg.from;
    const jids = session.setJids || [];
    const nums = parseNumberList(body, jids.length);
    if (nums.length === 0) {
      await botReply(msg, 'Reply with numbers to remove, or *cancel*.');
      return true;
    }
    const remove = new Set(nums.map((n) => jids[n - 1]).filter(Boolean));
    const remaining = jids.filter((j) => !remove.has(j));
    const sets = loadSets();
    sets[session.setName] = remaining;
    saveSets(sets);
    touchSession(chatId, { step: 'edit_action', setJids: remaining });
    await botReply(msg, `Removed ${remove.size} group(s). ${remaining.length} left. Reply *a*, *r*, or *done*.`);
    return true;
  }

  async function handleDeletePick(msg, body, session) {
    const chatId = msg.from;
    const idx = parseInt(body, 10) - 1;
    const keys = session.setKeys || [];
    if (!Number.isFinite(idx) || idx < 0 || idx >= keys.length) {
      await botReply(msg, 'Reply with a valid number, or *cancel*.');
      return true;
    }
    touchSession(chatId, { step: 'delete_confirm', deleteName: keys[idx] });
    await botReply(msg, `Delete set *${keys[idx]}*? Reply *yes* to confirm.`);
    return true;
  }

  async function handleDeleteConfirm(msg, body, session) {
    const chatId = msg.from;
    if (body.toLowerCase() !== 'yes') {
      clearSession(chatId);
      await botReply(msg, 'Delete cancelled.');
      return true;
    }
    const sets = loadSets();
    delete sets[session.deleteName];
    saveSets(sets);
    clearSession(chatId);
    await botReply(msg, `✅ Deleted set *${session.deleteName}*.`);
    return true;
  }

  return { startSettings, handleSession, formatSetsList, getAllGroups, normalizeSetName };
}

module.exports = { createSettingsWizard };
