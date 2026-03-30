# outreachpro

> AI-powered B2B sales engagement platform. Self-hosted [Instantly.ai](https://instantly.ai) clone with Claude AI, Apify lead scraping, Gmail, CRM, and 6-language i18n.

[![npm](https://img.shields.io/npm/v/outreachpro.svg)](https://www.npmjs.com/package/outreachpro)
[![MIT License](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](Dockerfile)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](package.json)

```bash
npx outreachpro start
```

Open **http://localhost:3000** — your full B2B outreach platform is running.

---

## What it does

OutreachPro is a complete cold email automation platform you run on your own server. No SaaS fees, no data leaving your machine.

```
Google Maps → Leads → AI Personalise → Campaign → Reply → CRM → Won
```

---

## Quick start

```bash
# 1. Create your .env file
npx outreachpro init

# 2. Add API keys to .env (Anthropic, Apify, Google)
nano .env

# 3. Start the server
npx outreachpro start
```

Or with Docker:

```bash
npx outreachpro docker
```

Open **http://localhost:3000**

---

## Features

| | |
|---|---|
| 🗺 | **Google Maps scraper** — find local businesses via Apify, auto-import leads |
| ✦ | **Claude AI personalisation** — unique opening line per lead using business data |
| 📧 | **Campaign sequences** — multi-step emails with delays, stop-on-reply, daily limits |
| 📬 | **Unibox** — unified reply inbox with AI auto-labelling (Interested / Not now / Meeting) |
| 🏆 | **CRM pipeline** — Kanban from Prospect → Won, drag-and-drop, pipeline value |
| 🔥 | **Email warmup** — slow-ramp sending to build sender reputation |
| 📊 | **Analytics** — open rates, reply rates, bounce tracking, revenue dashboard |
| 🌍 | **6-language i18n** — EN / DE / FR / ES / IT / NL |
| 🐳 | **Docker-first** — one command to run, your data stays on your server |

---

## Environment variables

```bash
# Required for AI personalisation
ANTHROPIC_API_KEY=sk-ant-api03-...

# Required for Google Maps lead scraping
APIFY_TOKEN=apify_api_...

# Required for Gmail integration (send + drafts)
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/gmail/callback

PORT=3000
```

---

## CLI commands

```bash
npx outreachpro init        # create .env from template
npx outreachpro start       # start server on :3000
npx outreachpro docker      # start with Docker Compose
npx outreachpro docker:down # stop Docker
npx outreachpro help        # show all commands
```

---

## Manual install

```bash
git clone https://github.com/vvlars-cmd/outreachpro
cd outreachpro
cp .env.example .env
# fill in .env
docker compose up --build
```

---

## Tech stack

- **Runtime:** Node.js 20 + Express.js on port 3000
- **AI:** Anthropic Claude Sonnet (per-lead personalisation, reply labelling)
- **Scraping:** Apify — compass/crawler-google-places
- **Email:** Gmail OAuth (drafts + sending)
- **Frontend:** Single-page HTML app, 16 views, zero frameworks
- **i18n:** 6 languages, 177 strings each
- **Data:** JSON files on Docker volume

---

## Views included

Dashboard · Campaigns · Sequences · Unibox · Lead Finder · Email Composer · Apify Scraper · Gmail Scraper · Email Warmup · Analytics · Inbox Tester · CRM Pipeline · Email Accounts · Workspace · Settings · Help

---

## License

MIT — Copyright (c) 2026 vvlars-cmd  
Validity: 2026-03-27 to 2026-09-27

---

**GitHub:** [github.com/vvlars-cmd/outreachpro](https://github.com/vvlars-cmd/outreachpro)
