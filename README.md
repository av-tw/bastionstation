# Bastion Station website

Landing page for the [Bastion Station](https://github.com/Bastion-Station-13/Bastion-Station) Space Station 13 server, with a live status panel (players, map, round, alert level, shuttle) and a one-click `byond://` connect link.

Two small pieces, no dependencies beyond Node:

- `site/` is a static page. `app.js` polls `serverinfo.json` every 10 seconds and renders the status panel.
- `server.mjs` serves `site/` and builds `/serverinfo.json` by sending the BYOND `?status` topic to the game server. The result is cached for 10 seconds and shared by every visitor, so website traffic never reaches the game server directly. The JSON has the same shape as tgstation's `serverinfo.json`.

## Run it locally

Requires Node 20 or newer. There is no install step.

```sh
node server.mjs
```

Open http://127.0.0.1:8790. Add `?demo` to the URL to render `site/serverinfo.sample.json` instead of querying the game server.

## Configuration

Everything is an environment variable.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8790` | HTTP port to listen on. |
| `HOST` | `127.0.0.1` | Bind address. Loopback by default so only the reverse proxy can reach it. Use `0.0.0.0` in a container. |
| `BYOND_HOST` | `www.bastionstation.com` | Game server host to query. |
| `BYOND_PORT` | `1336` | Game server port. |
| `PUBLIC_ADDRESS` | `BYOND_HOST:BYOND_PORT` | Address shown on the page and used in the connect link. |

If the game server moves, also update the fallback address in `site/app.js` (`CONFIG.address`) and in `site/index.html`. The page uses those when the status feed is unavailable, so the connect button keeps working even if this server is down.

## Deploy

The server listens on loopback and speaks plain HTTP. Run it under a process supervisor and put a reverse proxy with TLS in front of it. The steps below are for a Linux host with systemd, which is what the files in `deploy/` assume. Any supervisor that can keep `node server.mjs` alive works too (Windows Task Scheduler or NSSM, pm2, a container platform).

### 1. Install Node

Node 20 or newer. On Debian or Ubuntu, the [NodeSource](https://github.com/nodesource/distributions) packages give you a current version; the stock `apt install nodejs` may be too old.

### 2. Put the code in place

```sh
sudo git clone https://github.com/av-tw/bastionstation /opt/bastionstation
```

### 3. Install the service

```sh
sudo cp /opt/bastionstation/deploy/bastionstation.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bastionstation
curl http://127.0.0.1:8790/serverinfo.json
```

The unit starts on boot, restarts on failure, and runs as a throwaway system user with a read-only view of the filesystem. To change settings, create `/etc/bastionstation.env` with one `KEY=value` per line and run `sudo systemctl restart bastionstation`. The unit reads that file if it exists.

If `node` is not at `/usr/bin/node` on your host (check with `which node`), edit `ExecStart` in the unit.

### 4. Put a reverse proxy in front

`deploy/Caddyfile` is a complete [Caddy](https://caddyserver.com) config that serves the site on your domain with automatic HTTPS. Install Caddy, copy the file to `/etc/caddy/Caddyfile`, change the domain, and run `sudo systemctl reload caddy`. Any other proxy (nginx, Apache, Cloudflare Tunnel) works too: forward everything to `127.0.0.1:8790`.

Your domain must point at the host, and ports 80 and 443 must be reachable from the internet.

### Docker instead

```sh
docker build -t bastionstation .
docker run -d --name bastionstation --restart unless-stopped -p 127.0.0.1:8790:8790 bastionstation
```

Pass `-e BYOND_HOST=...` and so on to override settings. You still need a TLS reverse proxy in front.

## Maintain

- **Update:** `cd /opt/bastionstation && sudo git pull && sudo systemctl restart bastionstation`. Files under `site/` are read from disk on every request, so content edits take effect without a restart. Only `server.mjs` changes need one.
- **Logs:** `journalctl -u bastionstation -f`. The server logs one line at startup and one line each time a status query fails.
- **Health:** `curl http://127.0.0.1:8790/serverinfo.json`. A healthy reply has `players` and `version` fields. A reply containing `ERROR` means the game server did not answer. Check that it is up and that `BYOND_HOST:BYOND_PORT` is reachable from this host (`nc -vz host port`). The page shows "Offline" in that case, but the connect link keeps working.
- **Content:** edit `site/index.html`. Before launch, replace the `#` placeholder links in the nav, the notice, and the intro buttons (Wiki, Rules, Discord, Appeals, Donate, How to join), and the example items in the news section.

## Layout

| Path | What it is |
| --- | --- |
| `server.mjs` | The whole server, about 100 lines. |
| `site/` | The static site: `index.html`, `style.css`, `app.js`, sprites in `icons/`, and `serverinfo.sample.json` for demo mode. |
| `deploy/` | systemd unit and Caddyfile. |
| `design/` | The brainstorm grid and the chosen prototype the site was built from. Not served. |

## Credits and license

Code is MIT, see `LICENSE`. The sprites in `site/icons/` are cropped from the Bastion Station codebase and its upstreams ([MonkeStation 2.0](https://github.com/Monkestation/Monkestation2.0), [/tg/station](https://github.com/tgstation/tgstation)) and are [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The layout follows [tgstation13.org](https://tgstation13.org) ([website-v2](https://github.com/tgstation-operations/website-v2), MIT), based on work by mozi_h.
