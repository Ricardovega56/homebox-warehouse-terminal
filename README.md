# Homebox Warehouse Terminal

Warehouse-grade PWA terminal for [Homebox](https://github.com/sysadminsmedia/homebox) inventory management. Pairs with a hardware 2D barcode scanner (Tera 0013) and automated label printing (Brother QL-800) for two-scan inbound receiving and directed put-away.

## Architecture

```
Mobile Device                          Docker Host (Dockhand)
┌──────────────────────┐              ┌──────────────────────────────────┐
│ Tera 0013 Scanner    │              │                                  │
│  (BT HID Wedge)      │              │  nginx (:3100)                   │
│         │             │              │    ├── /         → PWA static    │
│         ▼             │              │    ├── /api/*    → homebox:7745  │
│  PWA Terminal         │─────────────▶│    └── /relay/*  → relay:5000   │
│  (Svelte 5 + Vite)   │              │                                  │
└──────────────────────┘              │  homebox (:7745 internal)        │
                                      │  relay (:5000 internal)          │
                                      │    └── lp → CUPS → Brother QL   │
                                      └──────────────────────────────────┘
```

All services communicate via Docker internal DNS. Only port **3100** is exposed.

## Quick Start

```bash
# 1. Clone and configure
git clone <this-repo>
cd homebox-warehouse-terminal
cp .env.example .env
# Edit .env — set HBOX_AUTH_API_KEY_PEPPER and HOMEBOX_API_TOKEN

# 2. Deploy (or use Dockhand GitOps)
docker compose up -d --build
```

- **PWA**: `http://<host>:3100` — install on Android via "Add to Home Screen"
- **Homebox UI**: Proxied at `http://<host>:3100/api/` (or access Homebox directly)

## First-Time Setup

1. Open the PWA → **Setup** tab
2. Enter your Homebox API token (create one in Homebox: Settings → API Keys)
3. Click **Test Connection** → green dot confirms connectivity
4. Click **Bootstrap** → auto-creates `_RECEIVING` and `_STAGING` locations
5. Switch to **Ingest** or **Put-Away** tab — start scanning

## Workflows

### 📥 Ingest (Receiving)

Scan an item → auto-moves to `_STAGING` → prints a label on the Brother QL-800.

### 🔀 Directed Put-Away

1. **Scan Item QR** → resolves item, shows info card
2. **Scan Bin QR** → resolves destination location
3. Auto-commits `PATCH /api/v1/entities/{id}` with new `parentId`
4. Green flash + audio confirmation → resets for next item

## Scanner Input

The Tera 0013 operates as a Bluetooth HID keyboard wedge. The PWA uses a global `keydown` burst buffer (30ms threshold) to capture rapid character sequences ending with `Enter`, distinguishing scanner input from human typing. No focused input fields needed.

## QR Code Format

Homebox native labels encode `/a/<asset-id>` (e.g. `/a/000-004`). The scan resolver supports:
1. `/a/<asset-id>` → `GET /api/v1/assets/{id}`
2. `HBX:ITEM:<uuid>` / `HBX:LOC:<uuid>` (homebox-scanner convention)
3. Full Homebox URLs
4. Raw UUIDs

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HBOX_AUTH_API_KEY_PEPPER` | Secret pepper for hashing API keys | (required) |
| `HOMEBOX_API_TOKEN` | API key (`hb_...`) for the print relay | (required) |
| `PRINTER_NAME` | CUPS printer name | `Brother_QL_800` |

## Development

```bash
# Frontend dev server (hot reload)
cd frontend && npm install && npm run dev

# Relay
cd relay && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && uvicorn relay:app --reload --port 5000

# Relay tests
pip install pytest pytest-asyncio && python -m pytest test_relay.py -v
```

## Stack

- **Frontend**: Svelte 5 + Vite 6 + Tailwind CSS v4 + vite-plugin-pwa
- **Relay**: Python 3.12 + FastAPI + httpx → CUPS
- **Backend**: Homebox (sysadminsmedia, Entity Merge API)
- **Proxy**: nginx 1.27 (reverse proxy + SPA serving)
