'use strict';

const { parsePhoneNumbers } = require('./bulk-send');
const { addParticipantsFixed } = require('./add-participants');

const SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_NUMBERS = 50;

function envMs(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function envInt(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Base wait between add RPCs (multiplied adaptively on rate limits). */
const ADD_DELAY_MS = [
  envMs('ADD_MEMBERS_DELAY_MIN_MS', 90_000),
  envMs('ADD_MEMBERS_DELAY_MAX_MS', 150_000),
];
/** Extra pause after every N WhatsApp add RPCs (WhatsApp allows ~3–4 per window). */
const BATCH_SIZE = envInt('ADD_MEMBERS_BATCH_SIZE', 3);
const BATCH_COOLDOWN_MS = envMs('ADD_MEMBERS_BATCH_COOLDOWN_MS', 5 * 60_000);
const RATE_LIMIT_BACKOFF_MS = envMs('ADD_MEMBERS_RATE_LIMIT_BACKOFF_MS', 3 * 60_000);
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_DELAY_MULTIPLIER = 4;
const PROGRESS_EVERY = 3;

const sessions = new Map();
const activeJobs = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
  const next = { ...existing, ...patch, chatId, expiresAt: Date.now() + SESSION_TTL_MS };
  sessions.set(chatId, next);
  return next;
}

function clearSession(chatId) {
  sessions.delete(chatId);
}

function isCancel(text) {
  const t = (text || '').trim().toLowerCase();
  return t === 'cancel' || t === 'abort' || t === 'stop';
}

function classifyDetail(detail, digits) {
  if (!detail) return { kind: 'failed', num: digits, error: 'No result returned' };
  if (detail.code === 200) return { kind: 'ok', num: digits };
  if (detail.code === 409) return { kind: 'alreadyMember', num: digits };
  if (detail.code === 403 && detail.isInviteV4Sent) return { kind: 'inviteSent', num: digits };
  return {
    kind: 'failed',
    num: digits,
    error: detail.message || `Error code ${detail.code}`,
    code: detail.code,
    rpcName: detail.rpcName,
  };
}

function isRateLimitCode(code) {
  return code === 400 || code === 429;
}

/** Only outcomes that actually hit WhatsApp's add-participant RPC count toward batch limits. */
function countsTowardAddQuota(classified) {
  if (classified.kind === 'alreadyMember') return false;
  if (classified.kind === 'failed' && classified.code === 404) return false;
  return true;
}

function getInterAddDelayMs(job) {
  return Math.round(randomBetween(ADD_DELAY_MS[0], ADD_DELAY_MS[1]) * job.delayMultiplier);
}

function estimateJobMinutes(count) {
  const avgDelay = (ADD_DELAY_MS[0] + ADD_DELAY_MS[1]) / 2;
  const rpcAdds = count;
  const batchPauses = Math.max(0, Math.floor((rpcAdds - 1) / BATCH_SIZE));
  return Math.ceil((rpcAdds * avgDelay + batchPauses * BATCH_COOLDOWN_MS) / 60_000);
}

function buildSummary(groupName, results) {
  const { ok, failed, inviteSent, alreadyMember } = results;
  let summary = `✅ Added to "${groupName}": ${ok.length}`;
  if (alreadyMember.length > 0) {
    summary += `\nℹ️ Already in group: ${alreadyMember.length}`;
  }
  if (inviteSent.length > 0) {
    summary += `\n📩 Private invite sent: ${inviteSent.length} (they must accept)`;
  }
  if (failed.length > 0) {
    summary += `\n\n❌ Failed (${failed.length}):`;
    for (const f of failed.slice(0, 8)) {
      summary += `\n• ${f.num}: ${f.error.split('\n')[0]}`;
    }
    if (failed.length > 8) summary += `\n… +${failed.length - 8} more`;
    summary += `\n\n📋 Failed numbers (copy to retry):\n${failed.map((f) => f.num).join(', ')}`;
  }
  return summary;
}

function createBulkAddMembersWizard({
  client,
  botReply,
  log,
  normalizePhoneDigits,
  resolveGroupByName,
  resolveParticipantWids,
}) {
  async function addOneParticipant(groupId, entry, job) {
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      const result = await addParticipantsFixed(client, groupId, [entry.wid], {
        sleep: 0,
        autoSendInviteV4: true,
      });

      if (typeof result === 'string') {
        return { fatal: result };
      }

      const detail = result[entry.wid];
      const classified = classifyDetail(detail, entry.digits);

      if (classified.kind === 'failed' && isRateLimitCode(classified.code) && attempt < MAX_RATE_LIMIT_RETRIES) {
        job.delayMultiplier = Math.min(MAX_DELAY_MULTIPLIER, job.delayMultiplier * 1.5);
        log(
          `[ADD-MEMBERS] rate limit ${entry.digits} code=${classified.code}, backoff ${RATE_LIMIT_BACKOFF_MS / 1000}s, delay x${job.delayMultiplier} (${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`,
        );
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }

      return { classified, detail };
    }

    return {
      classified: {
        kind: 'failed',
        num: entry.digits,
        error: 'Rate limit — still blocked after retries',
        code: 429,
      },
    };
  }

  async function processAddMembersJob(chatId, job) {
    const { msg, groupChat, entries, resolveFailed } = job;
    const groupId = groupChat.id._serialized;
    const results = {
      ok: [],
      failed: [...resolveFailed],
      inviteSent: [],
      alreadyMember: [],
    };

    job.delayMultiplier = 1;
    job.rpcSinceBatch = 0;

    const estMin = estimateJobMinutes(entries.length);
    await botReply(
      msg,
      `🔄 *Background add started*\n` +
        `Group: *${groupChat.name}*\n` +
        `Numbers: ${entries.length} (~${estMin} min est.)\n` +
        `Pace: ~1.5 min between adds, ${Math.round(BATCH_COOLDOWN_MS / 60_000)} min pause every ${BATCH_SIZE} adds\n\n` +
        `The bot stays responsive. Reply *cancel* to stop after the current number.`,
    );

    for (let i = 0; i < entries.length; i++) {
      if (job.cancelled) {
        await botReply(
          msg,
          `⏹️ Stopped after ${i}/${entries.length} numbers.\n` + buildSummary(groupChat.name, results),
        );
        activeJobs.delete(chatId);
        return;
      }

      const entry = entries[i];
      log(`[ADD-MEMBERS] ${i + 1}/${entries.length} adding ${entry.digits}`);

      try {
        const outcome = await addOneParticipant(groupId, entry, job);

        if (outcome.fatal) {
          await botReply(msg, `❌ Stopped: ${outcome.fatal}`);
          activeJobs.delete(chatId);
          return;
        }

        const { classified, detail } = outcome;
        if (classified.kind === 'ok') results.ok.push(classified.num);
        else if (classified.kind === 'alreadyMember') results.alreadyMember.push(classified.num);
        else if (classified.kind === 'inviteSent') results.inviteSent.push(classified.num);
        else {
          results.failed.push({ num: classified.num, error: classified.error });
          log(
            `[ADD-MEMBERS] fail ${classified.num} code=${classified.code ?? detail?.code ?? '?'} rpc=${classified.rpcName ?? detail?.rpcName ?? '-'}`,
          );
        }

        if (countsTowardAddQuota(classified)) {
          job.rpcSinceBatch += 1;
          if (job.rpcSinceBatch >= BATCH_SIZE && i < entries.length - 1 && !job.cancelled) {
            log(`[ADD-MEMBERS] batch pause ${BATCH_COOLDOWN_MS / 1000}s after ${BATCH_SIZE} add RPCs`);
            await botReply(
              msg,
              `⏸️ Batch pause (${Math.round(BATCH_COOLDOWN_MS / 60_000)} min) after ${BATCH_SIZE} adds — avoiding WhatsApp rate limit…`,
            );
            await sleep(BATCH_COOLDOWN_MS);
            job.rpcSinceBatch = 0;
            job.delayMultiplier = 1;
          }
        }

        const done = i + 1;
        if (done % PROGRESS_EVERY === 0 && done < entries.length && !job.cancelled) {
          await botReply(
            msg,
            `📊 Progress ${done}/${entries.length}: ${results.ok.length} added, ${results.inviteSent.length} invited, ${results.failed.length} failed`,
          );
        }
      } catch (err) {
        log(`[ADD-MEMBERS] error ${entry.digits}: ${err.message}`);
        results.failed.push({ num: entry.digits, error: err.message.split('\n')[0] });
      }

      if (i < entries.length - 1 && !job.cancelled) {
        const waitMs = getInterAddDelayMs(job);
        log(`[ADD-MEMBERS] waiting ${Math.round(waitMs / 1000)}s before next (x${job.delayMultiplier})`);
        await sleep(waitMs);
      }
    }

    if (!job.cancelled) {
      await botReply(msg, buildSummary(groupChat.name, results));
    }

    log(
      `[ADD-MEMBERS] Done group=${groupChat.name} added=${results.ok.length} already=${results.alreadyMember.length} invite=${results.inviteSent.length} failed=${results.failed.length}`,
    );
    activeJobs.delete(chatId);
  }

  function startBackgroundAddMembers(msg, groupChat, numbers) {
    const chatId = msg.from;

    if (activeJobs.has(chatId)) {
      return botReply(msg, 'An add-members job is already running. Reply *cancel* to stop it first.');
    }

    return (async () => {
      await botReply(msg, `Resolving ${numbers.length} numbers…`);

      const { wids, failed: resolveFailed, entries } = await resolveParticipantWids(numbers);
      if (wids.length === 0) {
        let text = '❌ Could not resolve any numbers.';
        for (const f of resolveFailed.slice(0, 5)) text += `\n• ${f.num}: ${f.error}`;
        if (resolveFailed.length > 0) {
          text += `\n\n📋 Failed numbers:\n${resolveFailed.map((f) => f.num).join(', ')}`;
        }
        await botReply(msg, text);
        return;
      }

      if (resolveFailed.length > 0) {
        log(`[ADD-MEMBERS] ${resolveFailed.length} numbers failed to resolve`);
      }

      const job = {
        cancelled: false,
        msg,
        groupChat,
        entries,
        resolveFailed,
      };
      activeJobs.set(chatId, job);

      processAddMembersJob(chatId, job).catch(async (err) => {
        log(`[ADD-MEMBERS] job crashed: ${err.message}`);
        activeJobs.delete(chatId);
        try {
          await botReply(msg, `❌ Background add crashed: ${err.message.split('\n')[0]}`);
        } catch (replyErr) {
          log(`[ADD-MEMBERS] could not send crash reply: ${replyErr.message}`);
        }
      });
    })();
  }

  async function startAddMembers(msg) {
    if (activeJobs.has(msg.from)) {
      await botReply(msg, 'An add-members job is already running. Reply *cancel* to stop it first.');
      return;
    }
    touchSession(msg.from, { step: 'await_group' });
    await botReply(
      msg,
      `👥 *Add members to a group*\n\n` +
        `Step 1: Send the *group name* (partial match OK).\n` +
        `You must be a *group admin*.\n\n` +
        `Adds run in the *background* (~1.5 min each, pauses every ${BATCH_SIZE}).\n` +
        `Reply *cancel* to abort.`,
    );
  }

  async function handleSession(msg) {
    const chatId = msg.from;
    const text = (msg.body || '').trim();

    if (text && isCancel(text)) {
      if (activeJobs.has(chatId)) {
        activeJobs.get(chatId).cancelled = true;
        await botReply(msg, 'Stopping background add after the current number…');
        return true;
      }
      const session = getSession(chatId);
      if (session) {
        clearSession(chatId);
        await botReply(msg, 'Add members cancelled.');
        return true;
      }
    }

    const session = getSession(chatId);
    if (!session) return false;

    if (!text) return true;

    if (session.step === 'await_group') {
      const resolved = await resolveGroupByName(text);
      if (resolved.error) {
        await botReply(msg, resolved.error);
        return true;
      }
      touchSession(chatId, {
        step: 'await_numbers',
        groupJid: resolved.chat.id._serialized,
        groupName: resolved.chat.name,
      });
      await botReply(
        msg,
        `Group: *${resolved.chat.name}*\n\n` +
          `Step 2: Paste phone numbers (one per line or comma-separated).\n` +
          `10-digit Indian mobile OK — 91 added automatically.\n` +
          `Max ${MAX_NUMBERS} numbers.\n\n` +
          `Processing runs in the background (slow pace to avoid rate limits).`,
      );
      return true;
    }

    if (session.step === 'await_numbers') {
      const numbers = parsePhoneNumbers(text, normalizePhoneDigits);
      if (numbers.length === 0) {
        await botReply(msg, 'No valid numbers found. Paste numbers or reply cancel.');
        return true;
      }
      if (numbers.length > MAX_NUMBERS) {
        await botReply(msg, `Too many numbers (${numbers.length}). Max is ${MAX_NUMBERS}.`);
        return true;
      }

      clearSession(chatId);
      let groupChat;
      try {
        groupChat = await client.getChatById(session.groupJid);
      } catch (err) {
        await botReply(msg, `Could not open group: ${err.message}`);
        return true;
      }
      if (!groupChat?.isGroup) {
        await botReply(msg, 'Target is not a group.');
        return true;
      }

      startBackgroundAddMembers(msg, groupChat, numbers);
      return true;
    }

    clearSession(chatId);
    return false;
  }

  return { startAddMembers, handleSession };
}

module.exports = { createBulkAddMembersWizard };
