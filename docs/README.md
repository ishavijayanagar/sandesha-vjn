# Sandesha Web App (Mobile PWA)

Mobile-first web UI for Sandesha: send messages, schedule, manage groups/sets/contacts, bulk send, and more — from your phone or desktop.

## Install as app (PWA)

1. Open the dashboard in **Chrome** (Android) or **Safari** (iOS)
2. **Android:** Menu → *Install app* or *Add to Home screen*
3. **iOS:** Share → *Add to Home Screen*

The app uses a teal theme, bottom navigation, and works best at phone width (375px+).

## Use locally (Pi or laptop)

1. Copy `.env.example` to `.env` and set `SANDESHA_ADMIN_PASSWORD`
2. Start the bot: `./start.sh`
3. Open **http://127.0.0.1:42620/** in your browser
4. Log in with your admin password

For local dev without auth, set `SANDESHA_AUTH_DISABLED=1` in `.env` (not for production).

## GitHub Pages + Raspberry Pi / laptop

The frontend lives on GitHub Pages; the bot API runs on your machine. A **Cloudflare Quick Tunnel** (or named tunnel) gives HTTPS access.

### 1. Set admin password

```bash
cp .env.example .env
nano .env   # SANDESHA_ADMIN_PASSWORD=your-strong-password
```

Restart Sandesha after changing `.env`.

### 2. Cloudflare Tunnel

See [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md).

**Quick Tunnel (no domain):**

```bash
cloudflared tunnel --config scripts/sandesha-tunnel.yml --url http://127.0.0.1:42620
```

Copy the `https://….trycloudflare.com` URL — it changes when you restart cloudflared.

### 3. GitHub Pages

1. Set `docs/config.js` (from `config.example.js`) with your tunnel URL:

```javascript
window.SANDESHA_CONFIG = {
  apiUrl: 'https://your-tunnel.trycloudflare.com',
};
```

2. Repo → **Settings** → **Pages** → branch `main`, folder **`/docs`**
3. Open `https://<user>.github.io/<repo>/` and log in

**Important:** GitHub Pages is HTTPS. The API must also be HTTPS (Cloudflare handles this).

### 4. Security

- Set `SANDESHA_ADMIN_PASSWORD` before exposing the tunnel
- Never commit `.env` or `.wwebjs_auth/`
- The tunnel URL is public; the password protects the API

## App sections

| Tab | Features |
|-----|----------|
| **Home** | Connection status, quick actions, upcoming schedules |
| **Send** | Target picker (sets/groups/contacts), media attach |
| **Schedule** | List, create, cancel scheduled messages |
| **Groups** | Search, activity badges, member list, find member |
| **More** | Sets, Contacts, Bulk send, Add members, AI chat*, Settings, Help |

\* AI chat appears only when ZeroClaw is running on the Pi (`127.0.0.1:42617`).

## WhatsApp-only features

Quoted-message forward, `!track`, `!replies`, and `!seen` require WhatsApp context — use **Me Commands** on WhatsApp for those.

## Settings

- **API URL override** — update when your Quick Tunnel URL changes
- **Logout** — clears session token

## Project layout

```
docs/
  index.html          App shell + bottom nav
  manifest.webmanifest
  sw.js               Caches shell assets (offline shell only)
  config.js           API URL for GitHub Pages
  css/                Design tokens, layout, components
  js/                 api, router, auth, pages/
  icons/              PWA icons (192, 512)
```

## Advanced — local API override

In **More → Settings**, change the API URL (stored in `localStorage`) for SSH tunnels or local testing.
