'use strict';

const SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_NUMBERS = 100;
const SEND_DELAY_MS = 2500;

const sessions = new Map();

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

function parsePhoneNumbers(text, normalizePhoneDigits) {
  const chunks = String(text).split(/[\n,;]+/);
  const numbers = [];
  const seen = new Set();
  const normalize = normalizePhoneDigits || ((d) => d.replace(/\D/g, ''));

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const digits = normalize(trimmed.replace(/\D/g, ''));
    if (digits.length < 10 || digits.length > 15) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    numbers.push(digits);
  }

  return numbers;
}

function formatNumberPreview(numbers, limit = 5) {
  const preview = numbers.slice(0, limit).join(', ');
  const extra = numbers.length > limit ? ` … +${numbers.length - limit} more` : '';
  return preview + extra;
}

function createBulkSendWizard({ resolveAndSend, botReply, log, delay, normalizePhoneDigits }) {
  const wait = delay || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const parseNumbers = (text) => parsePhoneNumbers(text, normalizePhoneDigits);

  async function startBulk(msg) {
    const chatId = msg.from;
    touchSession(chatId, { step: 'await_numbers', numbers: null });
    await botReply(
      msg,
      `📱 *Bulk send to numbers*\n\n` +
        `Paste phone numbers (one per line, or comma-separated).\n` +
        `Use country code OR 10-digit Indian mobile (91 added automatically).\n` +
        `Example: 919876543210 or 9876543210\n\n` +
        `Max ${MAX_NUMBERS} numbers per batch.\n` +
        `Reply *cancel* to abort.`,
    );
  }

  async function runBulkSend(msg, numbers, message) {
    await botReply(msg, `Sending to ${numbers.length} numbers (≈${Math.ceil((numbers.length * SEND_DELAY_MS) / 1000)}s)…`);

    const ok = [];
    const failed = [];

    for (let i = 0; i < numbers.length; i++) {
      const num = numbers[i];
      try {
        await resolveAndSend(num, message);
        ok.push(num);
        log(`[BULK] ✅ ${i + 1}/${numbers.length} → ${num}`);
      } catch (err) {
        failed.push({ num, error: err.message });
        log(`[BULK] ❌ ${i + 1}/${numbers.length} → ${num}: ${err.message}`);
      }
      if (i < numbers.length - 1) await wait(SEND_DELAY_MS);
    }

    let summary = `✅ Sent to ${ok.length}/${numbers.length} numbers.`;
    if (failed.length > 0) {
      summary += `\n\n❌ Failed (${failed.length}):`;
      for (const f of failed.slice(0, 8)) {
        const err = f.error.includes('No LID') || f.error.includes('not on WhatsApp')
          ? `${f.error.split('\n')[0]} (use 91XXXXXXXXXX)`
          : f.error.split('\n')[0];
        summary += `\n• ${f.num}: ${err}`;
      }
      if (failed.length > 8) summary += `\n… +${failed.length - 8} more`;
    }
    await botReply(msg, summary);
  }

  async function handleSession(msg) {
    const chatId = msg.from;
    const session = getSession(chatId);
    if (!session) return false;

    const text = (msg.body || '').trim();
    if (!text) return true;

    if (isCancel(text)) {
      clearSession(chatId);
      await botReply(msg, 'Bulk send cancelled.');
      return true;
    }

    if (session.step === 'await_numbers') {
      const numbers = parseNumbers(text);
      if (numbers.length === 0) {
        await botReply(msg, 'No valid numbers found. Paste numbers with country code (10–15 digits each), or reply cancel.');
        return true;
      }
      if (numbers.length > MAX_NUMBERS) {
        await botReply(
          msg,
          `Too many numbers (${numbers.length}). Max is ${MAX_NUMBERS}. Split into smaller batches or reply cancel.`,
        );
        return true;
      }
      touchSession(chatId, { step: 'await_message', numbers });
      await botReply(
        msg,
        `Got *${numbers.length}* numbers:\n${formatNumberPreview(numbers)}\n\nNow send the message text to broadcast.`,
      );
      return true;
    }

    if (session.step === 'await_message') {
      const numbers = session.numbers || [];
      clearSession(chatId);
      await runBulkSend(msg, numbers, text);
      return true;
    }

    clearSession(chatId);
    return false;
  }

  return { startBulk, handleSession };
}

module.exports = { createBulkSendWizard, parsePhoneNumbers };
