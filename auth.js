'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();

function loadEnvFile(envPath) {
  try {
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // ignore missing or unreadable .env
  }
}

loadEnvFile(path.join(__dirname, '.env'));

function isAuthDisabled() {
  return process.env.SANDESHA_AUTH_DISABLED === '1' || process.env.SANDESHA_AUTH_DISABLED === 'true';
}

function getAdminPassword() {
  return process.env.SANDESHA_ADMIN_PASSWORD || '';
}

function isAuthRequired() {
  return !isAuthDisabled() && getAdminPassword().length > 0;
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function login(password) {
  const adminPassword = getAdminPassword();
  if (!adminPassword) {
    return { ok: false, error: 'Admin password not configured on server' };
  }
  if (password !== adminPassword) {
    return { ok: false, error: 'Invalid password' };
  }
  const token = createToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { expiresAt });
  return { ok: true, token, expiresAt: new Date(expiresAt).toISOString() };
}

function getBearerToken(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function validateToken(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function validateAuth(req) {
  if (!isAuthRequired()) return true;
  return validateToken(getBearerToken(req));
}

function logout(token) {
  if (token) sessions.delete(token);
}

function checkStartupAuth(logFn) {
  const log = logFn || (() => {});
  if (isAuthDisabled()) {
    log('[auth] WARNING: SANDESHA_AUTH_DISABLED is set — API routes are unauthenticated');
    return;
  }
  if (!getAdminPassword()) {
    log('[auth] WARNING: SANDESHA_ADMIN_PASSWORD is not set. Set it in .env before exposing via Cloudflare Tunnel.');
  }
}

/** For tests — clear all sessions */
function clearAllSessions() {
  sessions.clear();
}

module.exports = {
  login,
  validateAuth,
  validateToken,
  getBearerToken,
  logout,
  isAuthRequired,
  isAuthDisabled,
  getAdminPassword,
  checkStartupAuth,
  clearAllSessions,
  SESSION_TTL_MS,
};
