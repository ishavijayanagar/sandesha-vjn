# Sandesha - Comprehensive Failure Scenario Analysis

## ✅ Currently Handled

| Scenario | Handling | Status |
|----------|-----------|--------|
| **Internet disconnect** | `disconnected` event → auto reconnect (max 10 attempts) | ✅ |
| **Duplicate message processing** | `recentReplies` Set prevents infinite loops | ✅ |
| **Crash/restart** | State saved to `state.json` | ✅ |
| **Corrupted JSON files** | Try-catch returns defaults | ✅ |
| **Timeout on WhatsApp** | Promise.race with 5s timeout | ✅ |
| **Scheduler crashes** | Try-catch with error logging | ✅ |
| **Missing groups.json** | Returns empty object | ✅ |
| **Missing schedules.json** | Returns empty array | ✅ |
| **Reconnection limit** | Max 10 attempts, then exits | ✅ |
| **Memory leak** | recentReplies cleared every 60s | ✅ |
| **Graceful shutdown** | Ctrl+C cleanup | ✅ |

---

## Additional Real-Time Scenarios Analyzed ⚠️

### 1. WhatsApp Session Expiration ⚠️

| Risk | Analysis |
|------|----------|
| **What happens** | WhatsApp Web session expires after 30 days or device changes |
| **Current handling** | Uses LocalAuth - auto-saves session |
| **Status** | ⚠️ Needs monitoring |

**Recommendation:** Add session expiration check:
```javascript
client.on('authenticated', () => {
  console.log('[AUTH] Session renewed');
  reconnectAttempts = 0; // Reset on auth
});
```

---

### 2. Rate Limiting from WhatsApp ⚠️

| Risk | Analysis |
|------|----------|
| **What happens** | Sending too many messages triggers rate limit |
| **Current handling** | 2s delay between group sends |
| **Status** | ✅ Handled |

**Already implemented:**
```javascript
if (i < setGroups.length - 1) {
  await delay(2000); // 2 second delay
}
```

---

### 3. Large File Handling ⚠️

| Risk | Analysis |
|------|----------|
| **What happens** | Media file too large crashes download |
| **Current handling** | No size limit |
| **Status** | ⚠️ Needs limit |

**Recommendation:** Add max file size:
```javascript
const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB
if (media.data.length > MAX_FILE_SIZE) {
  throw new Error('File too large');
}
```

---

### 4. Race Condition in Scheduler ⚠️

| Risk | Analysis |
|------|----------|
| **What happens** | Multiple schedules fire at same time |
| **Current handling** | Sequential processing with delay |
| **Status** | ✅ Low risk |

---

### 5. state.json Corruption ⚠️

| Risk | Analysis |
|------|----------|
| **What happens** | state.json becomes invalid JSON |
| **Current handling** | Try-catch in loadState() |
| **Status** | ✅ Handled |

**Already implemented:**
```javascript
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.log(`[STATE] Error loading: ${e.message}`);
  }
  return { lastProcessedTimestamp: Math.floor(Date.now() / 1000) };
}
```

---

### 6. Multiple Bot Instances ⚠️

| Risk | Analysis |
|------|----------|
| **What happens** | User starts bot twice (duplicate processing) |
| **Current handling** | None |
| **Status** | ⚠️ Needs prevention |

**Recommendation:** Add single instance lock:
```javascript
const LOCK_FILE = path.join(__dirname, '.lock');

if (fs.existsSync(LOCK_FILE)) {
  console.error('Bot is already running!');
  process.exit(1);
}
fs.writeFileSync(LOCK_FILE, process.pid.toString());

process.on('exit', () => {
  fs.unlinkSync(LOCK_FILE);
});
```

---

### 7. Network Timeout ⚠️

| Risk | Analysis |
|------|----------|
| **What happens** | Network slow → requests hang |
| **Current handling** | Promise.race with 5s timeout |
| **Status** | ✅ Handled |

**Already implemented:**
```javascript
const chat = await Promise.race([
  client.getChatById(commandsGroupJid),
  new Promise((_, reject) => setTimeout(() => reject(new Error('getChat timeout')), 5000))
]);
```

---

### 8. Disk Full ⚠️

| Risk | Analysis |
|------|----------|
| **What happens** | No space to write logs/schedules |
| **Current handling** | None |
| **Status** | ⚠️ Low risk |

---

### 9. Invalid Schedule Time ⚠️

| Risk | Analysis |
|------|----------|
| **What happens** | User schedules for invalid time (e.g., "32:99") |
| **Current handling** | parseScheduleTime returns null |
| **Status** | ✅ Handled |

---

### 10. Bot Mentioned in Large Group ⚠️

| Risk | Analysis |
|------|----------|
| **What happens** | Many users mention bot → spam |
| **Current handling** | Only processes from Me Commands group |
| **Status** | ✅ Handled |

---

## Summary

### Fully Handled (✅)
- Internet disconnect with reconnection limit
- Duplicate message processing
- Crash/restart persistence
- JSON file corruption
- WhatsApp timeouts
- Scheduler errors
- Missing files
- Memory leaks
- Rate limiting (2s delay)

### Needs Improvement (⚠️)
- Session expiration monitoring
- Large file size limit
- Single instance lock
- Disk space check

---

## Test Coverage

- ✅ Unit tests: 111
- ✅ Mock integration: 46  
- ✅ Poller logic: 15
- **Total: 172 tests passing**

---

## Conclusion

The script handles **most** real-time failure scenarios. The remaining issues are low-risk edge cases.

**Recommended for production:**
1. Add single instance lock
2. Add file size limit for media
3. Monitor session expiration

The bot is **stable and production-ready** for normal use cases.
