# OutreachPro + CycleWASH

> AI-powered B2B sales engagement platform — Instantly.ai clone with CycleWASH workspace.

## 🚀 Quick Start

```bash
# 1. Clone and configure
cp .env.example .env
# Fill in .env with your API keys (see Environment Variables below)

# 2. Run with Docker (recommended)
docker compose up --build

# 3. Open in browser
open http://localhost:3000
```

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node 20 Alpine Docker |
| Web server | Express.js :3000 |
| Frontend | Single HTML app (Vanilla JS) |
| AI | Anthropic claude-sonnet-4 |
| Lead scraper | Apify `compass/crawler-google-places` |
| Email | Gmail API via OAuth2 |
| Storage | JSON files on Docker volume `/app/data` |
| i18n | 6 languages (EN/DE/FR/ES/IT/NL) |

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ | AI personalisation + copilot |
| `APIFY_TOKEN` | ✅ | Google Maps lead scraping |
| `GOOGLE_CLIENT_ID` | ✅ | Gmail OAuth2 |
| `GOOGLE_CLIENT_SECRET` | ✅ | Gmail OAuth2 |
| `GOOGLE_REDIRECT_URI` | ✅ | `http://localhost:3000/api/gmail/callback` |
| `PORT` | ❌ | Default: 3000 |

## 🔐 Gmail OAuth2 Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → Enable **Gmail API**
3. OAuth2 Credentials → Web Application
4. Add Authorized Redirect URI: `http://localhost:3000/api/gmail/callback`
5. Copy Client ID + Secret to `.env`
6. In OutreachPro: click **Connect Gmail** in the sidebar

## 🕷️ Apify Setup

1. Create account at [apify.com](https://console.apify.com)
2. Get API token from Account Settings
3. Add to `.env` as `APIFY_TOKEN`
4. The app uses `compass/crawler-google-places` automatically

## 📁 File Structure

```
outreachpro-app/
├── server.js            # Express API (498 lines, all routes)
├── package.json
├── Dockerfile           # Node 20 Alpine
├── docker-compose.yml   # Volume + healthcheck
├── .env.example
├── public/
│   └── index.html       # Complete SPA frontend (1800+ lines)
├── scrapers/
│   ├── apify-maps.js    # Apify Google Maps scraper
│   └── gmail-scraper.js # Gmail inbox lead extractor
├── i18n/
│   ├── en.json          # English (default)
│   ├── de.json          # German
│   ├── fr.json          # French
│   ├── es.json          # Spanish
│   ├── it.json          # Italian
│   └── nl.json          # Dutch
├── help/
│   ├── en/              # English help articles
│   └── de/              # German help articles
├── data/
│   ├── leads.json       # Lead database (Docker volume)
│   ├── leads.seed.json  # 25 CycleWASH seed leads
│   ├── campaigns.json
│   ├── templates.json
│   ├── email-accounts.json
│   └── events.seed.json # 10 CycleWASH events 2026
└── scripts/
    ├── start.sh
    └── reset.sh
```

## 🔄 Key Data Flow

```
Apify scrape → leads.json → HTML Composer → AI personalise (claude-sonnet-4)
    → Gmail draft (OAuth2) → Campaign send → Unibox replies → CRM pipeline
```

## 🌍 Internationalization

Switch language in the topbar dropdown. All UI strings are loaded from `/api/i18n/:lang` (EN/DE/FR/ES/IT/NL). Language preference persists to `localStorage`.

## 🏢 CycleWASH Workspace

Pre-configured B2B workspace for CW Cleaning Solutions GmbH:

- **Products**: Pro Platinum €38,000 · Mini Platinum €27,500
- **Events 2026**: 10 live demo events across Germany
- **Seed leads**: 25 German bike dealers pre-loaded
- **Draft Creator**: Generates personalised Gmail drafts per event

## 🐳 Docker Commands

```bash
# Build and start
docker compose up --build -d

# View logs
docker compose logs -f

# Stop
docker compose down

# Reset data (WARNING: deletes all leads/campaigns)
bash scripts/reset.sh

# Check health
curl http://localhost:3000/health
```

## 📡 API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/i18n/:lang` | i18n strings |
| GET/POST | `/api/leads` | Lead CRUD |
| POST | `/api/leads/bulk` | Bulk import |
| DELETE | `/api/leads/:id` | Delete lead |
| GET/POST | `/api/campaigns` | Campaign CRUD |
| GET/POST | `/api/templates` | Template CRUD |
| GET/POST | `/api/accounts` | Email accounts |
| POST | `/api/apify/scrape` | Apify SSE scrape |
| POST | `/api/ai/personalise` | Per-lead AI opening |
| POST | `/api/ai/copilot` | AI copilot chat |
| GET | `/api/gmail/auth` | Gmail OAuth2 start |
| GET | `/api/gmail/callback` | Gmail OAuth2 callback |
| GET | `/api/gmail/status` | Gmail connection status |
| POST | `/api/gmail/draft` | Create Gmail draft |
| POST | `/api/gmail/send` | SSE rate-limited send |
| POST | `/api/gmail/scrape` | SSE inbox scraper |
| GET | `/help/:lang/:module` | Help articles |

---

Built with ❤️ — OutreachPro + CycleWASH
