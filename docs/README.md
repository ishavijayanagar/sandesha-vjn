# Sandesha Web Dashboard

Web UI for Sandesha: login, bot status, browse groups, manage sets, and send messages.

## Use locally (on the Pi or dev machine)

1. Copy `.env.example` to `.env` and set `SANDESHA_ADMIN_PASSWORD`.
2. Start the bot: `./start.sh`
3. Open **http://127.0.0.1:42620/** in your browser
4. Log in with your admin password

For local dev without auth, set `SANDESHA_AUTH_DISABLED=1` in `.env` (not for production).

## GitHub Pages + Raspberry Pi (recommended for remote access)

The frontend lives on GitHub Pages; the bot API runs on your Pi. A **Cloudflare Tunnel** gives the Pi a public HTTPS URL so the browser can call the API.

### 1. Pi — set admin password

```bash
cp .env.example .env
nano .env   # set SANDESHA_ADMIN_PASSWORD to a strong password
```

Restart Sandesha after changing `.env`.

### 2. Pi — Cloudflare Tunnel

See [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md) or the Cloudflare section in [RASPBERRY_PI_SETUP.md](../RASPBERRY_PI_SETUP.md).

You will get a URL like `https://sandesha.yourdomain.com` pointing at `http://127.0.0.1:42620`.

### 3. GitHub Pages — enable the UI

1. Copy `config.example.js` → `config.js`
2. Set `apiUrl` to your Cloudflare Tunnel URL:

```javascript
window.SANDESHA_CONFIG = {
  apiUrl: 'https://sandesha.yourdomain.com',
};
```

3. GitHub repo → **Settings** → **Pages** → source: branch `main`, folder **`/docs`**
4. Open `https://<user>.github.io/<repo>/` and log in

**Important:** GitHub Pages is HTTPS. The Pi API must also be HTTPS (Cloudflare Tunnel handles this). Do not use a raw `http://` Pi IP from GitHub Pages — browsers will block it.

### 4. Security

- Set `SANDESHA_ADMIN_PASSWORD` before enabling the tunnel
- Never commit `.env` or `.wwebjs_auth/`
- The tunnel URL is public; the password is the gate
- Use a strong, unique admin password

## Features (web UI)

| Tab | Description |
|-----|-------------|
| Status | Bot health, commands group, linked WhatsApp number |
| Groups | Browse all WhatsApp groups (read-only) |
| Sets | Create, edit, delete group sets |
| Send | Send a message to a set, group name, or JID |

## WhatsApp alternative

In **Me Commands**, send:

```
!settings
```

Follow the numbered menu to add, edit, or delete sets.

## Advanced — API URL override

On the dashboard, expand **Advanced — API URL override** to point at a different server (e.g. SSH tunnel to the Pi).
