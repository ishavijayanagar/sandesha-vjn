# Changelog

All notable changes to the Sandesha WhatsApp bot.  
This document covers work from the development session (June 2026), git status at time of writing, and conversation history.

**Current package version:** `1.3.0` (in `package.json`)  
**Last committed on `main`:** `e26a6f0` — Add dashboard UI prototype  
**Uncommitted work:** See [Git status summary](#git-status-summary) below.

---

## [1.3.0] — 2026-06-08 (development / uncommitted)

### Summary

Major expansion of Sandesha from a group-messaging bot into a full command-center with:
- WhatsApp wizards (`!settings`, `!bulk`, `!addmembers`)
- Web dashboard (local + GitHub Pages)
- Quoted-message forwarding
- Announcement/community group handling
- Background bulk member adds with rate-limit protection
- Personal contact scheduling and improved startup reliability

---

## New features

### Setup & operations

| Item | Description |
|------|-------------|
| **`SETUP_GUIDE.md`** | Full install, configure, run, troubleshoot guide |
| **`start.sh`** | One-command start; stops stale processes, clears Chrome lock, optional `--reset` for QR re-scan |
| **`RASPBERRY_PI_SETUP.md`** | Pi deployment, systemd, Cloudflare tunnel notes |
| **`.env.example`** | Template for `SANDESHA_ADMIN_PASSWORD`, auth flags, Puppeteer paths |
| **`scripts/generate-group-jids.js`** | Resolve group names → JIDs via HTTP API (`/groups`) |

### Bot greeting & UX

| Item | Description |
|------|-------------|
| **Namaskaram 🙏 prefix** | All bot replies prefixed with `> Namaskaram 🙏,` on the next line |
| **Bot reply detection** | Poller skips bot's own replies (prevents feedback loops) |

### Quoted message forwarding

| Item | Description |
|------|-------------|
| **Reply-to-send** | Quote any message, then reply `Send to Maa`, `send to all_vols_grps`, `forward to family`, etc. |
| **Media + text** | Forwards text, images, documents; attempts caption preservation on media |
| **Disambiguation suffixes** | `Send to Isha Vijayanagar-1 community` / `announcement` when duplicate names exist |

### Scheduling

| Item | Description |
|------|-------------|
| **Personal contact targets** | `!schedule to Maa at 12:55pm` resolves personal chats by name, not just groups |
| **Schedule validation** | Validates target exists when creating a schedule |
| **Failed schedule retry** | Failed sends are **not** marked as sent; scheduler retries |

### Group sets management

| Item | Description |
|------|-------------|
| **`!settings` wizard** | Menu-driven set management: show, add, edit, delete sets without editing JIDs manually |
| **Group search in wizard** | Search by keyword, pick by number, name the set |
| **`!sets` shows names** | Lists group **names** instead of raw JIDs |

### Web dashboard

| Item | Description |
|------|-------------|
| **`docs/` static UI** | Simple dashboard: login, bot status, browse groups, manage sets, send messages |
| **Local hosting** | Served from bot at `http://127.0.0.1:42620/` |
| **GitHub Pages** | Frontend in `/docs`; API on Pi via Cloudflare Tunnel |
| **`docs/DEPLOY_CLOUDFLARE.md`** | Tunnel setup instructions |
| **`auth.js`** | Password login, bearer tokens, optional `SANDESHA_AUTH_DISABLED=1` for local dev |
| **HTTP API auth** | `POST /auth/login`, protected `/sets`, `/send`, `/groups`, etc. |
| **CORS** | Cross-origin support for GitHub Pages → Pi API |

### Announcement & community groups

| Item | Description |
|------|-------------|
| **Duplicate name handling** | Two chats named e.g. "Isha Vijayanagar-1": announcement (861 members) vs community shell (6 members) |
| **Smart group picking** | Prefers postable groups; detects announcement-only groups |
| **Clear error messages** | "Only admins can post in announcement group" / "You are not an admin" |
| **Group type in API** | `/groups` returns `announcement`, `type`, participant count |

### Bulk send to phone numbers (`!bulk`)

| Item | Description |
|------|-------------|
| **Wizard flow** | `!bulk` → paste numbers → send message |
| **Phone normalization** | 10-digit Indian mobiles auto-prefixed with `91` |
| **LID / cold contact handling** | `getNumberId`, chat warm-up before send |
| **Rate pacing** | ~2.5 s delay between sends; max 100 numbers |
| **Aliases** | `!sendnumbers`, `!sendlist` |

### Bulk add members (`!addmembers`)

| Item | Description |
|------|-------------|
| **Wizard flow** | `!addmembers` → group name → paste numbers |
| **Admin check** | Requires user to be group admin |
| **Community shell block** | Blocks non-postable community shell groups |
| **`add-participants.js`** | Patched `addParticipantsFixed()` — replaces broken `Chat.find` with `findOrCreateLatestChat` |
| **Background processing** | Non-blocking job; poller stays responsive |
| **Adaptive rate limiting** | 1.5–2.5 min between adds; 5 min pause every 3 RPC adds |
| **Rate-limit retry** | 3 min backoff + delay multiplier on 400/429; up to 2 retries per number |
| **Progress updates** | Status every 3 numbers; batch pause notifications |
| **Cancel support** | Reply `cancel` during background job |
| **Failed numbers list** | Comma-separated copy-paste list at end of summary |
| **Env tuning** | `ADD_MEMBERS_DELAY_MIN_MS`, `ADD_MEMBERS_BATCH_SIZE`, etc. |
| **Aliases** | `!addtogroup` |

### HTTP API enhancements

| Endpoint | Notes |
|----------|-------|
| `GET /health` | Bot status; auth-aware info |
| `GET /groups` | Group list with type, announcement flag, participant count |
| `GET/POST /sets` | Read/write `groups.json` |
| `POST /send`, `/send-media` | Authenticated send |
| Static `/` | Serves dashboard from `docs/` |

### Tests

| Item | Description |
|------|-------------|
| **`tests/auth.test.js`** | Auth module tests |
| **`tests/test-http.js`** | Extended HTTP API tests |

---

## Bug fixes

| Issue | Root cause | Fix |
|-------|------------|-----|
| **App won't start — Chrome lock** | Stale Puppeteer profile lock / zombie Chrome | `start.sh` kills old processes and lock files |
| **Port 42620 in use** | Previous instance still running | `start.sh` stops existing `node listen.js` |
| **Scheduled msg to "Maa" not sent** | Scheduler only resolved groups, not personal chats | `resolveContact()` + personal chat lookup in `resolveAndSend` |
| **Failed schedules marked sent** | Scheduler marked sent even on error | Only mark sent on successful delivery |
| **`!sets` triggered stray send** | Bot reply "Group Sets:" parsed as natural language → matched "IEK May Org Group" | Skip bot replies; block generic words (`group`, `sets`) in partial match |
| **`!sets` showed JIDs** | Reply listed raw JIDs | Map JIDs to group names from chat list |
| **Quoted send not working** | Empty message when parsing "Send to Maa"; quoted msg not loaded from poller | Fixed target parsing; improved `getQuotedMessage()` handling |
| **Announcement group wrong target** | Bot picked announcement group (admin-only) instead of postable group | `pickAmongSameNameChats()`, prefer postable groups |
| **Community vs announcement confusion** | Same display name, different JIDs | Qualifier suffixes + explicit admin-only errors |
| **Startup stuck after QR** | `setupCommandsGroup()` hung on `getChatById` | 15 s timeout; startup continues to "Setup complete!" |
| **`!addmembers` — `findImpl is not a function`** | whatsapp-web.js broken `Chat.find` in `addParticipants` | Custom `add-participants.js` using `findOrCreateLatestChat` |
| **Add members "unknown error" (code 400)** | WhatsApp rate limit after ~4 adds; unmapped error codes | Mapped 400/429; background adds with long delays + batch pauses |
| **Bulk send silent skip** | Missing `text` field in quoted content bundle | Fixed `sendQuotedContent` payload |
| **Poller blocked during bulk ops** | Long `await` in message handler | Background jobs for `!addmembers`; `!bulk` still blocks (shorter) |

---

## Known issues (unresolved)

| Issue | Status | Workaround |
|-------|--------|------------|
| **Quoted video + caption** | Partially unresolved | Only short text or video alone may forward; full caption on video not reliable via download+resend |
| **WhatsApp add rate limits** | Platform limit | Use background `!addmembers`; retry failed numbers later; share invite link manually |
| **`!bulk` blocks poller** | By design for now | Keep batches ≤20; or run during quiet period |
| **Cold contacts "No LID"** | WhatsApp Web limitation | Number must exist on WA; may need prior chat for some numbers |
| **Uncommitted changes** | Not on `origin/main` | Commit and deploy when ready |

---

## Configuration reference

### Environment variables (`.env`)

```bash
SANDESHA_ADMIN_PASSWORD=your-strong-password
# SANDESHA_AUTH_DISABLED=1          # local dev only
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# DEFAULT_COUNTRY_CODE=91

# Bulk add members tuning
# ADD_MEMBERS_DELAY_MIN_MS=90000
# ADD_MEMBERS_DELAY_MAX_MS=150000
# ADD_MEMBERS_BATCH_SIZE=3
# ADD_MEMBERS_BATCH_COOLDOWN_MS=300000
# ADD_MEMBERS_RATE_LIMIT_BACKOFF_MS=180000
```

### New / updated commands

| Command | Action |
|---------|--------|
| `!settings` | Menu wizard for group sets |
| `!bulk` | Send message to pasted phone list |
| `!addmembers` | Add pasted numbers to a group (background) |
| Quote + `Send to X` | Forward quoted message to target |
| `Send to X announcement` | Disambiguate duplicate group names |
| `Send to X community` | Target community shell vs announcement |

---

## Git status summary

*Snapshot at documentation time — branch `main`, up to date with `origin/main`.*

### Modified (not staged)

| File | Nature of changes |
|------|-------------------|
| `listen.js` | Major: wizards, quoted send, auth, HTTP API, announcement groups, scheduling fixes, bot greeting |
| `README.md` | Updated usage and setup pointers |
| `package.json` / `package-lock.json` | Version 1.3.0, dependency updates |
| `tests/test-http.js` | HTTP/auth test coverage |
| `.gitignore` | Ignore `.env`, session artifacts |
| `MyGroups.txt`, `state.json`, `.lock` | Runtime/local state (do not commit secrets) |

### New (untracked)

| File / folder | Purpose |
|---------------|---------|
| `SETUP_GUIDE.md` | Setup documentation |
| `RASPBERRY_PI_SETUP.md` | Pi deployment guide |
| `start.sh` | Start script |
| `.env.example` | Env template |
| `auth.js` | Dashboard API authentication |
| `settings.js` | `!settings` wizard |
| `bulk-send.js` | `!bulk` wizard |
| `bulk-add-members.js` | `!addmembers` wizard + background job |
| `add-participants.js` | Fixed WhatsApp add-participants RPC |
| `docs/` | Web dashboard (GitHub Pages) |
| `scripts/` | Group JID resolution helper |
| `tests/auth.test.js` | Auth unit tests |

### Already committed on `main` (prior to this session's uncommitted work)

- Dashboard UI prototype (`e26a6f0`)
- `!grouplist`, `!groupstatus`, `!members` fix (`e32c81c`)
- Forward command with media (`0079e92`, `e4e0c91`)
- Single instance lock, file size limits (`e908409`)
- Comprehensive test suite (`3317c55`, `1e41a5e`)

---

## Upgrade notes

1. Copy `.env.example` → `.env` and set `SANDESHA_ADMIN_PASSWORD` before exposing API publicly.
2. Use `./start.sh` instead of `node listen.js` directly.
3. Group sets can be managed via `!settings` or the web dashboard — manual `groups.json` editing is optional.
4. For bulk member adds, expect **~45–60 min for 16 numbers** with current rate-limit settings.
5. Restart bot after pulling changes: `./start.sh`

---

## [1.0.0] — 2026-03-29

### Added
- Initial stable release
- Basic message sending to groups
- Natural language message parsing
- Group sets management
- Schedule messages with time
- Media sending support
- List group members (`!members`)
- Find members in groups (`!find`)
- Track inactive groups (`!inactive`)
- Contact management (`!addcontact`, `!contacts`)
- Reply tracking (`!track`, `!replies`)
- Message read tracking (`!seen`, `!readstatus`)
- AI chat integration
- HTTP API endpoints
- Polling-based message processing
- Comprehensive help menu with emojis

### Features
- Send messages to individual groups or sets
- Broadcast to all groups
- Schedule messages for future delivery
- Track who replied to your messages
- Track who read your messages (via reactions)
- List all members of any group
- Search for members across groups
- Check group activity status
- Manage saved contacts
- Natural language command parsing

## [0.1.0] — Development

- Basic WhatsApp web client setup
- Message receiving and sending
- Command processing
