require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// ── Ensure data dir exists ────────────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
// Serve index.html with Cloudflare script stripped + cache disabled
app.get('/', (req, res) => {
  const p = path.join(__dirname, 'public', 'index.html');
  fs.readFile(p, 'utf8', (err, html) => {
    if (err) { res.status(500).send('Error'); return; }
    // Strip CF email-decode script (it wraps page JS in closure, breaking onclick handlers)
    html = html.replace(/<script[^>]*email-decode[^>]*><\/script>/gi, '');
    // Decode CF-obfuscated emails back to plain text
    html = html.replace(/<a[^>]*__cf_email__[^>]*data-cfemail="([0-9a-f]+)"[^>]*>[^<]*<\/a>/g, (m, hex) => {
      try { const b=Buffer.from(hex,'hex'),k=b[0]; return [...b.slice(1)].map(c=>String.fromCharCode(c^k)).join(''); }
      catch { return 'info@cyclewash.de'; }
    });
    res.setHeader('Content-Type','text/html;charset=utf-8');
    res.setHeader('Cache-Control','no-store,no-cache,must-revalidate');
    res.send(html);
  });
});
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ───────────────────────────────────────────────────────────────────
function readJSON(file, fallback = []) {
  try {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return fallback; }
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

function sseSend(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function loadGmailToken() {
  const p = path.join(DATA_DIR, '.gmail-token.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function saveGmailToken(token) {
  writeJSON('.gmail-token.json', token);
}

// ── Seed data (first run) ─────────────────────────────────────────────────────
function seedIfEmpty(file, data) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// Seed leads — read from file if it exists, else use inline defaults
const leadsFile = path.join(__dirname, 'data', 'leads.seed.json');
const leadsSeed = fs.existsSync(leadsFile)
  ? JSON.parse(fs.readFileSync(leadsFile, 'utf8')).slice(0, 25).map((l, i) => ({ id: `l${i+1}`, ...l }))
  : [
    { id:'l1', name:'Fahrrad Jungmann', city:'Wilhelmshaven', email:'info@fahrrad-jungmann.de', category:'Fahrradhändler', rating:4.5, reviewsCount:38, status:'Neu', src:'CRM', website:'fahrrad-jungmann.de' },
    { id:'l2', name:'Rad Sport Weber', city:'Brühl', email:'info@radsport-weber.de', category:'Fahrradhändler', rating:4.2, reviewsCount:55, status:'Neu', src:'CRM', website:'radsport-weber.de' },
    { id:'l3', name:'Bike World Münster', city:'Münster', email:'info@bikeworld-ms.de', category:'Fahrradhändler', rating:4.7, reviewsCount:112, status:'Kontaktiert', src:'CRM', website:'bikeworld-ms.de' },
    { id:'l4', name:'E-Bike Center Köln', city:'Köln', email:'info@ebike-center.de', category:'E-Bike Händler', rating:4.4, reviewsCount:89, status:'Neu', src:'CRM', website:'ebike-center.de' },
    { id:'l5', name:'Zweirad Hoffmann', city:'Aachen', email:'info@zweirad-hoffmann.de', category:'Fahrradhändler', rating:4.6, reviewsCount:74, status:'Qualifiziert', src:'CRM', website:'zweirad-hoffmann.de' },
  ];
seedIfEmpty('leads.json', leadsSeed);
seedIfEmpty('campaigns.json', [
  { id:'c1', name:'CycleWASH Spring 2026 — NRW', status:'active', from:'info@cyclewash.de', daily:40, stopOnReply:true, leads:25, sent:18, opens:11, replies:3, bounced:0, openRate:61, replyRate:17, createdAt:'2026-03-15T09:00:00Z', subject:'CycleWASH Pro Platinum — Vorstellung für {{name}}' },
  { id:'c2', name:'Events Follow-up — Jever & Brühl', status:'paused', from:'info@cyclewash.de', daily:25, stopOnReply:true, leads:8, sent:8, opens:5, replies:2, bounced:0, openRate:63, replyRate:25, createdAt:'2026-03-10T10:30:00Z', subject:'Nachfassung: CycleWASH Demo in {{city}}' },
]);
seedIfEmpty('templates.json', []);
seedIfEmpty('email-accounts.json', [{
  id: 'acc1', email: 'info@cyclewash.de', name: 'CW Cleaning Solutions GmbH',
  connected: false, warmupEnabled: false, warmupDailyTarget: 30,
  dailySentToday: 0, reputation: 85
}]);

// Seed events — read from file if it exists, else use inline defaults
const eventsFile = path.join(__dirname, 'data', 'events.seed.json');
const eventsSeed = fs.existsSync(eventsFile)
  ? JSON.parse(fs.readFileSync(eventsFile, 'utf8'))
  : [
    { id:'e1', name:'Bike Festival Jever', city:'Jever', date:'2026-04-12', leads:0 },
    { id:'e2', name:'Fahrradmesse Brühl', city:'Brühl', date:'2026-05-03', leads:4 },
    { id:'e3', name:'E-Bike Expo Düsseldorf', city:'Düsseldorf', date:'2026-05-17', leads:6 },
    { id:'e4', name:'Radmarkt Aachen', city:'Aachen', date:'2026-06-07', leads:3 },
    { id:'e5', name:'Bike Days Münster', city:'Münster', date:'2026-06-21', leads:5 },
  ];
seedIfEmpty('events.json', eventsSeed);

// Seed deals, inbox, sequences
seedIfEmpty('deals.json', {
  Prospect:[{id:'deal1',company:'Rad & Tat Köln',value:38000,contact:'Michael Brandt',email:'m.brandt@raduntat.de'}],
  Contacted:[{id:'deal2',company:'Bike Garage Düsseldorf',value:27500,contact:'Anna Fleischer',email:'info@bikegarage.de'}],
  Meeting:[], Proposal:[{id:'deal3',company:'Velo Center Bonn',value:76000,contact:'Petra Schmidt',email:'p.schmidt@velocenter.de'}],
  Won:[{id:'deal4',company:'Bike World Münster',value:27500,contact:'Hans Weber',email:'h.weber@bikeworld.de'}], Lost:[]
});
seedIfEmpty('inbox.json', [
  {id:'msg1',from:'Karl Jungmann & Sohn',email:'info@fahrrad-jungmann.de',subject:'Re: CycleWASH Pro Platinum',preview:'Das klingt sehr interessant für uns...',body:'<p>Guten Tag,</p><p>vielen Dank! Das klingt sehr interessant. Können Sie mir mehr Details schicken?</p><p>MfG, Karl Jungmann</p>',ts:'2026-03-26T14:23:00Z',label:'interested',read:false},
  {id:'msg2',from:'Zweirad Hoffmann',email:'info@zweirad-hoffmann.de',subject:'Re: Termin vereinbaren',preview:'Gerne Dienstag 7. April...',body:'<p>Sehr geehrte Damen und Herren,</p><p>gerne Dienstag, 7. April um 14:00 Uhr?</p><p>MfG, Stefan Hoffmann</p>',ts:'2026-03-24T16:45:00Z',label:'meeting',read:false},
  {id:'msg3',from:'Rad Sport Weber',email:'info@radsport-weber.de',subject:'Re: CycleWASH',preview:'Derzeit kein Budget...',body:'<p>Hallo, derzeit kein Budget. Bitte melden Sie sich in Q4.</p><p>VG, M. Weber</p>',ts:'2026-03-25T10:11:00Z',label:'not_now',read:true},
]);
seedIfEmpty('sequences.json', {
  c1:[
    {id:'s1',subject:'CycleWASH Pro Platinum — Vorstellung für {{name}}',body:'<p>Guten Tag,</p><p>ich möchte Ihnen die CycleWASH Pro Platinum vorstellen — eine vollautomatische Fahrradwaschanlage für Fachhändler.</p><p>{{aiOpening}}</p><p>Hätten Sie 15 Minuten?</p><p>Mit freundlichen Grüßen,<br/>Sebastian Müller<br/>CW Cleaning Solutions GmbH</p>',delay:0,variant:'A'},
    {id:'s2',subject:'Re: CycleWASH — kurze Nachfassung',body:'<p>Guten Tag,</p><p>kurze Nachfassung zu meiner E-Mail von letzter Woche. Darf ich Ihnen weitere Infos schicken?</p><p>Beste Grüße,<br/>Sebastian</p>',delay:3,variant:'A'},
    {id:'s3',subject:'CycleWASH — Fallstudie: +22% Kundenzufriedenheit',body:'<p>Guten Tag,</p><p>als letzten Kontaktversuch teile ich eine Fallstudie: ein Händler steigerte die Kundenzufriedenheit um 22%.</p><p>Beste Grüße,<br/>Sebastian</p>',delay:7,variant:'A'},
  ]
});

// ════════════════════════════════════════════════════════════════════════════════
// HEALTH
// ════════════════════════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), port: PORT });
});

// ════════════════════════════════════════════════════════════════════════════════
// i18n
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/i18n/:lang', (req, res) => {
  const lang = ['en','de','fr','es','it','nl'].includes(req.params.lang) ? req.params.lang : 'en';
  const p = path.join(__dirname, 'i18n', `${lang}.json`);
  if (fs.existsSync(p)) res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
  else res.json({});
});

// ════════════════════════════════════════════════════════════════════════════════
// LEADS
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/leads', (req, res) => res.json(readJSON('leads.json', [])));

app.post('/api/leads', (req, res) => {
  const leads = readJSON('leads.json', []);
  const lead = req.body;
  if (!lead.id) lead.id = `l${Date.now()}`;
  lead.createdAt = lead.createdAt || new Date().toISOString();
  const idx = leads.findIndex(l => l.id === lead.id);
  if (idx >= 0) leads[idx] = lead; else leads.push(lead);
  writeJSON('leads.json', leads);
  res.json(lead);
});

app.post('/api/leads/bulk', (req, res) => {
  const leads = readJSON('leads.json', []);
  const incoming = req.body.leads || [];
  const existing = new Set(leads.map(l => l.email).filter(Boolean));
  let added = 0;
  for (const l of incoming) {
    if (!l.email || !existing.has(l.email)) {
      if (!l.id) l.id = `l${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      l.createdAt = new Date().toISOString();
      leads.push(l);
      if (l.email) existing.add(l.email);
      added++;
    }
  }
  writeJSON('leads.json', leads);
  res.json({ added, total: leads.length });
});

app.delete('/api/leads/:id', (req, res) => {
  let leads = readJSON('leads.json', []);
  leads = leads.filter(l => l.id !== req.params.id);
  writeJSON('leads.json', leads);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/campaigns', (req, res) => res.json(readJSON('campaigns.json', [])));

app.post('/api/campaigns', (req, res) => {
  const campaigns = readJSON('campaigns.json', []);
  const c = req.body;
  if (!c.id) c.id = `c${Date.now()}`;
  c.createdAt = c.createdAt || new Date().toISOString();
  const idx = campaigns.findIndex(x => x.id === c.id);
  if (idx >= 0) campaigns[idx] = c; else campaigns.push(c);
  writeJSON('campaigns.json', campaigns);
  res.json(c);
});

app.delete('/api/campaigns/:id', (req, res) => {
  let campaigns = readJSON('campaigns.json', []);
  campaigns = campaigns.filter(c => c.id !== req.params.id);
  writeJSON('campaigns.json', campaigns);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEMPLATES
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/templates', (req, res) => res.json(readJSON('templates.json', [])));

app.post('/api/templates', (req, res) => {
  const templates = readJSON('templates.json', []);
  const t = req.body;
  if (!t.id) t.id = `tpl${Date.now()}`;
  t.createdAt = t.createdAt || new Date().toISOString();
  const idx = templates.findIndex(x => x.id === t.id);
  if (idx >= 0) templates[idx] = t; else templates.push(t);
  writeJSON('templates.json', templates);
  res.json(t);
});

app.delete('/api/templates/:id', (req, res) => {
  let templates = readJSON('templates.json', []);
  templates = templates.filter(t => t.id !== req.params.id);
  writeJSON('templates.json', templates);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════════
// EMAIL ACCOUNTS
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/accounts', (req, res) => res.json(readJSON('email-accounts.json', [])));

app.post('/api/accounts', (req, res) => {
  const accounts = readJSON('email-accounts.json', []);
  const a = req.body;
  if (!a.id) a.id = `acc${Date.now()}`;
  const idx = accounts.findIndex(x => x.id === a.id);
  if (idx >= 0) accounts[idx] = a; else accounts.push(a);
  writeJSON('email-accounts.json', accounts);
  res.json(a);
});

// ════════════════════════════════════════════════════════════════════════════════
// EVENTS (CycleWASH)
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/events', (req, res) => res.json(readJSON('events.json', [])));

// ════════════════════════════════════════════════════════════════════════════════
// APIFY SCRAPER — SSE
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/apify/scrape', async (req, res) => {
  sseSetup(res);
  const { cities = [], searchTerms = ['Fahrradgeschäft','E-Bike Händler'], maxPerSearch = 15, minStars = 3.5 } = req.body;
  const token = process.env.APIFY_TOKEN;
  if (!token) { sseSend(res, { type: 'error', msg: 'APIFY_TOKEN not set' }); return res.end(); }

  const apifyScraper = require('./scrapers/apify-maps');
  let totalNew = 0;

  for (const city of cities) {
    sseSend(res, { type: 'progress', msg: `Scraping ${city}...`, city });
    try {
      const leads = await apifyScraper.scrape({ city, searchTerms, maxPerSearch, minStars, token });
      const existing = readJSON('leads.json', []);
      const existingKeys = new Set(existing.map(l => (l.name + l.city).toLowerCase()));
      const fresh = leads.filter(l => !existingKeys.has((l.name + l.city).toLowerCase()));
      fresh.forEach((l, i) => {
        l.id = `ap_${Date.now()}_${i}`;
        l.src = 'Apify';
        l.status = 'Neu';
        l.createdAt = new Date().toISOString();
      });
      existing.push(...fresh);
      writeJSON('leads.json', existing);
      totalNew += fresh.length;
      sseSend(res, { type: 'city_done', city, found: leads.length, added: fresh.length });
    } catch (err) {
      sseSend(res, { type: 'city_error', city, msg: String(err).slice(0, 120) });
    }
    await new Promise(r => setTimeout(r, 600));
  }

  sseSend(res, { type: 'done', totalNew });
  res.end();
});

// ════════════════════════════════════════════════════════════════════════════════
// AI PERSONALISE
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/ai/personalise', async (req, res) => {
  const { lead, language = 'de', productContext = '' } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const langPrompts = {
    de: `Schreibe einen personalisierten Einstiegssatz auf Deutsch für eine Kaltakquise-E-Mail an dieses Unternehmen. Nutze die Daten:`,
    en: `Write a personalised opening sentence in English for a cold outreach email to this business. Use the data:`,
    fr: `Écris une phrase d'accroche personnalisée en français pour un e-mail de prospection à cette entreprise. Utilise les données:`,
    es: `Escribe una frase de apertura personalizada en español para un correo de prospección a esta empresa. Usa los datos:`,
    it: `Scrivi una frase di apertura personalizzata in italiano per un'email di contatto a questa azienda. Usa i dati:`,
    nl: `Schrijf een gepersonaliseerde openingszin in het Nederlands voor een koude e-mail aan dit bedrijf. Gebruik de gegevens:`,
  };

  const prompt = `${langPrompts[language] || langPrompts.de}
- Bedrijfsnaam/Name: ${lead.name}
- Stad/City: ${lead.city}
- Categorie/Category: ${lead.category || ''}
- Website: ${lead.website || ''}
- Bewertung/Rating: ${lead.rating || ''} (${lead.reviewsCount || 0} reviews)
- Adresse/Address: ${lead.address || ''}
${productContext ? `- Productcontext: ${productContext}` : ''}

Schrijf ALLEEN de openingszin, maximaal 2 zinnen. Geen begroeting, geen afsluiting.`;

  try {
    const fetch = (await import('node-fetch')).default;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content?.[0]?.text?.trim() || '';
    res.json({ text, leadId: lead.id });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// AI COPILOT
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/ai/copilot', async (req, res) => {
  const { messages, systemContext = '' } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const system = `You are the OutreachPro AI Copilot — an expert B2B sales engagement assistant. You help users find leads, write email sequences, analyse campaign performance, and optimise outreach. ${systemContext}`.trim();

  try {
    const fetch = (await import('node-fetch')).default;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system, messages })
    });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    res.json({ reply: data.content?.[0]?.text || '' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GMAIL AUTH (OAuth2)
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/gmail/status', (req, res) => {
  const token = loadGmailToken();
  res.json({ connected: !!token, email: token?.email || null });
});

app.get('/api/gmail/auth', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/gmail/callback`;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not set' });
  const scopes = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
  ].join(' ');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`;
  res.redirect(url);
});

app.get('/api/gmail/callback', async (req, res) => {
  const { code } = req.query;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/gmail/callback`;
  if (!code) return res.status(400).send('No code');
  try {
    const fetch = (await import('node-fetch')).default;
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
    });
    const token = await r.json();
    if (token.error) return res.status(400).send(token.error_description);
    // Get email address
    const info = await (await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${token.access_token}`)).json();
    token.email = info.email;
    token.savedAt = new Date().toISOString();
    saveGmailToken(token);
    res.send(`<html><body><script>window.opener?.postMessage({type:'gmail_connected',email:'${info.email}'},'*');window.close();</script><p>Gmail connected! You can close this window.</p></body></html>`);
  } catch (err) {
    res.status(500).send(String(err));
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GMAIL DRAFT
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/gmail/draft', async (req, res) => {
  const { to, subject, bodyHtml, from } = req.body;
  const token = loadGmailToken();
  if (!token) return res.status(401).json({ error: 'Gmail not connected. Visit /api/gmail/auth' });

  try {
    const fetch = (await import('node-fetch')).default;
    const accessToken = await refreshTokenIfNeeded(token, fetch);
    const mime = [`From: ${from || token.email}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', bodyHtml].join('\r\n');
    const encoded = Buffer.from(mime).toString('base64url');
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: encoded } })
    });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    res.json({ draftId: data.id, ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GMAIL SEND (SSE — rate-limited queue)
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/gmail/send', async (req, res) => {
  sseSetup(res);
  const { emails = [], delayMs = 2000 } = req.body;
  const token = loadGmailToken();
  if (!token) { sseSend(res, { type: 'error', msg: 'Gmail not connected' }); return res.end(); }

  let ok = 0; let fail = 0;
  const fetch = (await import('node-fetch')).default;

  for (let i = 0; i < emails.length; i++) {
    const { to, subject, bodyHtml, from } = emails[i];
    sseSend(res, { type: 'sending', i: i+1, total: emails.length, to });
    try {
      const accessToken = await refreshTokenIfNeeded(token, fetch);
      const mime = [`From: ${from || token.email}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', bodyHtml].join('\r\n');
      const encoded = Buffer.from(mime).toString('base64url');
      const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encoded })
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error.message);
      ok++;
      sseSend(res, { type: 'sent', to, ok, fail });
    } catch (err) {
      fail++;
      sseSend(res, { type: 'send_error', to, msg: String(err), ok, fail });
    }
    if (i < emails.length - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  sseSend(res, { type: 'done', ok, fail });
  res.end();
});

// ════════════════════════════════════════════════════════════════════════════════
// GMAIL SCRAPER (inbox → leads)  SSE
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/gmail/scrape', async (req, res) => {
  sseSetup(res);
  const { query = '', maxResults = 100 } = req.body;
  const token = loadGmailToken();
  if (!token) { sseSend(res, { type: 'error', msg: 'Gmail not connected' }); return res.end(); }

  try {
    const gmailScraper = require('./scrapers/gmail-scraper');
    const fetch = (await import('node-fetch')).default;
    const accessToken = await refreshTokenIfNeeded(token, fetch);
    const leads = await gmailScraper.scrape({ accessToken, query, maxResults,
      onProgress: (msg) => sseSend(res, { type: 'progress', msg }) });
    const existing = readJSON('leads.json', []);
    const existingEmails = new Set(existing.map(l => l.email).filter(Boolean));
    const fresh = leads.filter(l => l.email && !existingEmails.has(l.email));
    sseSend(res, { type: 'done', found: leads.length, new: fresh.length, leads: fresh });
  } catch (err) {
    sseSend(res, { type: 'error', msg: String(err) });
  }
  res.end();
});

// ════════════════════════════════════════════════════════════════════════════════
// HELP ARTICLES
// ════════════════════════════════════════════════════════════════════════════════
app.get('/help/:lang/:module', (req, res) => {
  const lang = ['en','de','fr','es','it','nl'].includes(req.params.lang) ? req.params.lang : 'en';
  const mod = req.params.module.replace(/[^a-z0-9-]/g, '');
  const p = path.join(__dirname, 'help', lang, `${mod}.html`);
  if (fs.existsSync(p)) res.send(fs.readFileSync(p, 'utf8'));
  else {
    const fallback = path.join(__dirname, 'help', 'en', `${mod}.html`);
    if (fs.existsSync(fallback)) res.send(fs.readFileSync(fallback, 'utf8'));
    else res.status(404).send('<p>Help article not found.</p>');
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// TOKEN REFRESH HELPER
// ════════════════════════════════════════════════════════════════════════════════
async function refreshTokenIfNeeded(token, fetch) {
  const now = Date.now();
  const expiresAt = token.savedAt ? new Date(token.savedAt).getTime() + (token.expires_in || 3599) * 1000 : 0;
  if (expiresAt && now < expiresAt - 60000) return token.access_token;
  // Refresh
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const fresh = await r.json();
  if (fresh.access_token) {
    token.access_token = fresh.access_token;
    token.savedAt = new Date().toISOString();
    token.expires_in = fresh.expires_in || 3599;
    saveGmailToken(token);
    return fresh.access_token;
  }
  return token.access_token;
}

// ════════════════════════════════════════════════════════════════════════════════
// SEQUENCES (stored per campaign)
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/sequences', (req, res) => {
  const { campaignId, steps } = req.body;
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
  const seqs = readJSON('sequences.json', {});
  seqs[campaignId] = steps || [];
  writeJSON('sequences.json', seqs);
  res.json({ ok: true, campaignId, steps: seqs[campaignId] });
});

app.get('/api/sequences/:campaignId', (req, res) => {
  const seqs = readJSON('sequences.json', {});
  res.json(seqs[req.params.campaignId] || []);
});

// ════════════════════════════════════════════════════════════════════════════════
// INBOX (Unibox messages)
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/inbox', (req, res) => {
  res.json(readJSON('inbox.json', []));
});

app.post('/api/inbox/label', (req, res) => {
  const { id, label } = req.body;
  const inbox = readJSON('inbox.json', []);
  const msg = inbox.find(m => m.id === id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  msg.label = label;
  msg.read = true;
  writeJSON('inbox.json', inbox);
  res.json({ ok: true, msg });
});

app.post('/api/inbox/read', (req, res) => {
  const { id } = req.body;
  const inbox = readJSON('inbox.json', []);
  const msg = inbox.find(m => m.id === id);
  if (msg) { msg.read = true; writeJSON('inbox.json', inbox); }
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════════
// DEALS (CRM)
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/deals', (req, res) => {
  res.json(readJSON('deals.json', {
    Prospect: [], Contacted: [], Meeting: [], Proposal: [],
    Won: [{ id: 'd1', company: 'e-motion e-Bike Welt Hamm', value: 38000, city: 'Hamm', createdAt: new Date().toISOString() }],
    Lost: []
  }));
});

app.post('/api/deals', (req, res) => {
  const { stage, deal } = req.body;
  if (!stage || !deal) return res.status(400).json({ error: 'stage and deal required' });
  const deals = readJSON('deals.json', { Prospect: [], Contacted: [], Meeting: [], Proposal: [], Won: [], Lost: [] });
  if (!deals[stage]) deals[stage] = [];
  if (!deal.id) deal.id = `d${Date.now()}`;
  deal.createdAt = deal.createdAt || new Date().toISOString();
  // Remove from any existing stage first (move operation)
  Object.keys(deals).forEach(s => { deals[s] = deals[s].filter(d => d.id !== deal.id); });
  deals[stage].push(deal);
  writeJSON('deals.json', deals);
  res.json({ ok: true, deal, stage });
});

app.delete('/api/deals/:id', (req, res) => {
  const deals = readJSON('deals.json', {});
  Object.keys(deals).forEach(s => { deals[s] = deals[s].filter(d => d.id !== req.params.id); });
  writeJSON('deals.json', deals);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════════
// WARMUP METRICS
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/warmup/metrics', (req, res) => {
  const accounts = readJSON('email-accounts.json', []);
  const metrics = readJSON('warmup-metrics.json', {
    overallScore: 85,
    inboxPlacementRate: 89,
    networkPeers: 2847,
    rampDay: 14,
    history: Array.from({ length: 14 }, (_, i) => ({
      day: i + 1,
      sent: Math.min(5 + i * 2, 30),
      delivered: Math.floor((5 + i * 2) * 0.97),
      inbox: Math.floor((5 + i * 2) * 0.89)
    }))
  });
  res.json({ ...metrics, accounts });
});

app.post('/api/warmup/metrics', (req, res) => {
  writeJSON('warmup-metrics.json', req.body);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════════
// LEAD IMPORT (CSV upload — multipart)
// ════════════════════════════════════════════════════════════════════════════════
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/leads/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const text = req.file.buffer.toString('utf8');
    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const leads = lines.slice(1).map((line, i) => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      headers.forEach((h, j) => { obj[h] = vals[j] || ''; });
      return {
        id: `imp_${Date.now()}_${i}`,
        name: obj.name || obj.company || obj.firmenname || '',
        email: obj.email || obj['e-mail'] || '',
        city: obj.city || obj.stadt || obj.ort || '',
        phone: obj.phone || obj.telefon || obj.tel || '',
        website: obj.website || obj.url || '',
        category: obj.category || obj.kategorie || '',
        status: obj.status || 'Neu',
        src: 'Excel',
        createdAt: new Date().toISOString()
      };
    }).filter(l => l.name || l.email);
    const existing = readJSON('leads.json', []);
    const existingEmails = new Set(existing.map(l => l.email).filter(Boolean));
    const fresh = leads.filter(l => !l.email || !existingEmails.has(l.email));
    existing.push(...fresh);
    writeJSON('leads.json', existing);
    res.json({ imported: fresh.length, skipped: leads.length - fresh.length, total: existing.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// AI BATCH PERSONALISE — SSE stream for all leads
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/ai/personalise/batch', async (req, res) => {
  sseSetup(res);
  const { leadIds, language = 'de', productContext = 'cycleWASH bike washing machine' } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { sseSend(res, { type: 'error', msg: 'ANTHROPIC_API_KEY not set' }); return res.end(); }

  const allLeads = readJSON('leads.json', []);
  const targets = leadIds ? allLeads.filter(l => leadIds.includes(l.id)) : allLeads.filter(l => l.email);
  let done = 0;

  const langPrompts = {
    de: 'Schreibe einen personalisierten Einstiegssatz auf Deutsch für eine B2B Kaltakquise-E-Mail. Nur den Satz, keine Begrüßung.',
    en: 'Write a personalised opening sentence in English for a B2B cold outreach email. Only the sentence, no greeting.',
    fr: 'Écris une phrase d\'accroche personnalisée en français. Seulement la phrase.',
    es: 'Escribe una frase de apertura personalizada en español. Solo la frase.',
    it: 'Scrivi una frase di apertura personalizzata in italiano. Solo la frase.',
    nl: 'Schrijf een gepersonaliseerde openingszin in het Nederlands. Alleen de zin.',
  };

  for (const lead of targets) {
    sseSend(res, { type: 'progress', current: done + 1, total: targets.length, lead: lead.name });
    try {
      const fetch = (await import('node-fetch')).default;
      const prompt = `${langPrompts[language] || langPrompts.de}

Unternehmen: ${lead.name}
Stadt: ${lead.city}
Kategorie: ${lead.category || ''}
Bewertung: ${lead.rating || ''} (${lead.reviewsCount || 0} Bewertungen)
Website: ${lead.website || ''}
Produktkontext: ${productContext}`;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 150, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await r.json();
      const text = data.content?.[0]?.text?.trim() || '';
      if (text) {
        lead.aiOpening = text;
        lead.aiOpeningLang = language;
        // Update in leads.json
        const leads = readJSON('leads.json', []);
        const idx = leads.findIndex(l => l.id === lead.id);
        if (idx >= 0) { leads[idx].aiOpening = text; leads[idx].aiOpeningLang = language; writeJSON('leads.json', leads); }
      }
      sseSend(res, { type: 'done_lead', leadId: lead.id, text, name: lead.name });
    } catch (err) {
      sseSend(res, { type: 'error_lead', leadId: lead.id, msg: String(err).slice(0, 100) });
    }
    done++;
    await new Promise(r => setTimeout(r, 400));
  }
  sseSend(res, { type: 'batch_done', processed: done });
  res.end();
});

// ════════════════════════════════════════════════════════════════════════════════
// EVENTS CRUD (full)
// ════════════════════════════════════════════════════════════════════════════════
app.post('/api/events', (req, res) => {
  const events = readJSON('events.json', []);
  const ev = req.body;
  if (!ev.id) ev.id = `e${Date.now()}`;
  const idx = events.findIndex(e => e.id === ev.id);
  if (idx >= 0) events[idx] = ev; else events.push(ev);
  writeJSON('events.json', events);
  res.json(ev);
});

app.delete('/api/events/:id', (req, res) => {
  let events = readJSON('events.json', []);
  events = events.filter(e => e.id !== req.params.id);
  writeJSON('events.json', events);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════════
// ANALYTICS SNAPSHOT
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/analytics', (req, res) => {
  const leads = readJSON('leads.json', []);
  const campaigns = readJSON('campaigns.json', []);
  const deals = readJSON('deals.json', { Won: [] });

  const total = leads.length;
  const withEmail = leads.filter(l => l.email).length;
  const contacted = leads.filter(l => ['Kontaktiert', 'Contacted'].includes(l.status)).length;
  const qualified = leads.filter(l => ['Qualifiziert', 'Qualified'].includes(l.status)).length;
  const won = (deals.Won || []).length;
  const pipelineValue = qualified * 38000;
  const wonValue = (deals.Won || []).reduce((sum, d) => sum + (d.value || 0), 0);

  res.json({
    leads: { total, withEmail, contacted, qualified },
    campaigns: { total: campaigns.length, active: campaigns.filter(c => c.status === 'active').length },
    deals: { won, wonValue, pipelineValue },
    rates: {
      emailCoverage: total ? Math.round(withEmail / total * 100) : 0,
      contactedRate: total ? Math.round(contacted / total * 100) : 0,
      qualifiedRate: contacted ? Math.round(qualified / contacted * 100) : 0,
    },
    generatedAt: new Date().toISOString()
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// LEAD EXPORT (CSV)
// ════════════════════════════════════════════════════════════════════════════════
app.get('/api/leads/export', (req, res) => {
  const leads = readJSON('leads.json', []);
  const headers = ['id', 'name', 'email', 'phone', 'city', 'category', 'rating', 'reviewsCount', 'website', 'address', 'status', 'src', 'event_id', 'createdAt', 'aiOpening'];
  const csv = [
    headers.join(','),
    ...leads.map(l => headers.map(h => {
      const val = String(l[h] || '').replace(/"/g, '""');
      return `"${val}"`;
    }).join(','))
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send('\uFEFF' + csv); // BOM for Excel
});

// ════════════════════════════════════════════════════════════════════════════════
// SPA FALLBACK (must be LAST — after all API routes)
// ════════════════════════════════════════════════════════════════════════════════
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n OutreachPro running at http://localhost:${PORT}`);
  console.log(` Anthropic API: ${process.env.ANTHROPIC_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(` Apify Token:   ${process.env.APIFY_TOKEN ? 'SET' : 'NOT SET'}`);
  console.log(` Google OAuth:  ${process.env.GOOGLE_CLIENT_ID ? 'SET' : 'NOT SET'}\n`);
});
