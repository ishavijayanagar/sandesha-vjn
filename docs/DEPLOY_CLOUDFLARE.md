# Cloudflare Tunnel — expose Sandesha API over HTTPS

Use this so the GitHub Pages frontend can reach your Raspberry Pi bot API securely.

Sandesha stays bound to `127.0.0.1:42620` on the Pi. Cloudflare Tunnel forwards public HTTPS traffic to that local port.

---

## Option A — Quick Tunnel (no domain required)

**Best for:** getting started without buying a domain.

**URL looks like:** `https://random-words-here.trycloudflare.com`

| | |
|---|---|
| Cost | Free |
| Domain needed | **No** |
| URL stays same while tunnel runs | Yes |
| URL after Pi reboot / tunnel restart | **Changes** — update `docs/config.js` and push to GitHub |

### A1. Prerequisites

- Sandesha running on the Pi (`listen.js` via systemd or `./start.sh`)
- `SANDESHA_ADMIN_PASSWORD` set in `.env` (see `.env.example`)

### A2. Install cloudflared on the Pi

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
cloudflared --version
```

Use `cloudflared-linux-arm` for 32-bit Pi OS if needed.

**No `cloudflared tunnel login` required** for Quick Tunnel.

**Important:** If you already have `~/.cloudflared/config.yml` for other projects, use Sandesha’s isolated config or Quick Tunnel may return **404**:

```bash
cloudflared tunnel --config ~/apps/sandesha/scripts/sandesha-tunnel.yml --url http://127.0.0.1:42620
```

### A3. Test manually (see your URL)

With Sandesha already running:

```bash
cloudflared tunnel --config ~/apps/sandesha/scripts/sandesha-tunnel.yml --url http://127.0.0.1:42620
```

The terminal prints a line like:

```
https://abc-def-123.trycloudflare.com
```

Copy that URL. In another terminal (or from your laptop):

```bash
curl https://abc-def-123.trycloudflare.com/health
```

Leave this terminal open while testing. `Ctrl+C` stops the tunnel.

### A4. Set admin password (if not done)

```bash
cd ~/apps/sandesha
cp .env.example .env
nano .env
```

```env
SANDESHA_ADMIN_PASSWORD=your-strong-password-here
```

Restart Sandesha:

```bash
sudo systemctl restart sandesha
```

### A5. Run Quick Tunnel on boot (systemd)

Create a service (adjust `User` if needed):

```bash
sudo nano /etc/systemd/system/cloudflared-quick.service
```

```ini
[Unit]
Description=Cloudflare Quick Tunnel for Sandesha
After=network-online.target sandesha.service
Wants=network-online.target

[Service]
Type=simple
User=pi
ExecStart=/usr/bin/cloudflared tunnel --config /home/pi/apps/sandesha/scripts/sandesha-tunnel.yml --url http://127.0.0.1:42620
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudflared-quick
sudo systemctl start cloudflared-quick
```

### A6. Find your tunnel URL

After start or reboot:

```bash
sudo journalctl -u cloudflared-quick -n 80 --no-pager | grep -o 'https://[^ ]*trycloudflare.com'
```

Copy the `https://....trycloudflare.com` URL.

### A7. Point GitHub Pages at the tunnel

On your laptop, edit `docs/config.js`:

```javascript
window.SANDESHA_CONFIG = {
  apiUrl: 'https://abc-def-123.trycloudflare.com',
};
```

Commit and push. Open your GitHub Pages URL and log in.

**After every Pi reboot or tunnel restart:** repeat A6, update `config.js`, push again.

### A8. Verify

```bash
curl https://YOUR-URL.trycloudflare.com/health

curl -X POST https://YOUR-URL.trycloudflare.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"your-strong-password-here"}'
```

---

## Option B — Named tunnel + domain (stable URL)

**Best for:** 24/7 production — URL does not change after reboot.

Requires a domain added to Cloudflare (free plan is fine).

### B1. Prerequisites

- Sandesha running on the Pi
- `SANDESHA_ADMIN_PASSWORD` set in `.env`
- A domain on Cloudflare

### B2. Install cloudflared

Same as A2.

### B3. Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

Follow the browser prompt and select your domain.

### B4. Create a tunnel

```bash
cloudflared tunnel create sandesha
```

Note the tunnel UUID from the output.

### B5. Configure the tunnel

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: /home/pi/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: api.yourdomain.com
    service: http://127.0.0.1:42620
  - service: http_status:404
```

Replace `yourdomain.com`, tunnel UUID, and Pi username in paths.

### B6. DNS route

```bash
cloudflared tunnel route dns sandesha api.yourdomain.com
```

Or add a CNAME in the Cloudflare dashboard: `api` → `<TUNNEL-UUID>.cfargotunnel.com`.

### B7. Run as systemd service

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

### B8. GitHub Pages

```javascript
window.SANDESHA_CONFIG = {
  apiUrl: 'https://api.yourdomain.com',
};
```

---

## Security checklist (both options)

- [ ] `SANDESHA_ADMIN_PASSWORD` is set and strong
- [ ] `.env` is not committed to git
- [ ] `.wwebjs_auth/` is not committed or shared
- [ ] Do not set `SANDESHA_AUTH_DISABLED` when the tunnel is live
- [ ] Quick Tunnel URLs are public — anyone with the URL can try to log in (password protects actions)

## Troubleshooting

| Problem | Fix |
|---------|-----|
| 404 from trycloudflare (local health OK) | Existing `~/.cloudflared/config.yml` conflict — use `scripts/sandesha-tunnel.yml` with `--config` |
| Cannot find trycloudflare URL | `sudo journalctl -u cloudflared-quick -f` and wait for the URL line |
| URL changed after reboot | Normal for Quick Tunnel — grep journal again, update `docs/config.js`, push |
| CORS / network error | `apiUrl` in `config.js` must match tunnel URL exactly (including `https://`) |
| Login fails | Check password in `.env`; `sudo systemctl restart sandesha` |
| Mixed content blocked | GitHub Pages must call `https://` API, not `http://` or a Pi IP |

## Quick Tunnel vs named tunnel

| | Quick Tunnel | Named tunnel + domain |
|---|---|---|
| Domain | Not needed | Required |
| URL | Random `*.trycloudflare.com` | Fixed e.g. `api.yourdomain.com` |
| Changes on reboot | **Yes** | No |
| Good for 24/7 set-and-forget | No | **Yes** |
