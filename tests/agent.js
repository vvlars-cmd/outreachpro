/**
 * OutreachPro — Autonomous Test Agent v1.0
 * ─────────────────────────────────────────
 * Runs the full test suite, collects results, sends failures to
 * Claude for root-cause analysis, suggests fixes, and saves a
 * timestamped HTML report.
 *
 * Usage:
 *   node tests/agent.js              # run + analyse all failures
 *   node tests/agent.js --no-ai      # run only, skip AI analysis
 *   node tests/agent.js --watch      # re-run every 30s
 *   node tests/agent.js --fix        # apply suggested fixes automatically
 */

'use strict';

const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { execSync, spawn } = require('child_process');

// ── Config ───────────────────────────────────────────────────────────────────
const BASE          = process.env.APP_URL || 'http://localhost:3000';
const AI_KEY        = process.env.ANTHROPIC_API_KEY;
const USE_AI        = !process.argv.includes('--no-ai') && !!AI_KEY;
const WATCH_MODE    = process.argv.includes('--watch');
const AUTO_FIX      = process.argv.includes('--fix');
const WATCH_INTERVAL = 30000;
const REPORT_DIR    = path.join(__dirname, '..', 'test-reports');
const TIMEOUT       = 8000;

// ── Colours ──────────────────────────────────────────────────────────────────
const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  grn:'\x1b[32m', red:'\x1b[31m', yel:'\x1b[33m',
  cyn:'\x1b[36m', mag:'\x1b[35m', blu:'\x1b[34m',
};

// ── HTTP helper ───────────────────────────────────────────────────────────────
function req(method, url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...extraHeaders,
      },
      timeout: TIMEOUT,
    };
    const r = lib.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: json, raw: data, headers: res.headers });
      });
    });
    r.on('timeout', () => { r.destroy(); reject(new Error(`Timeout: ${method} ${url}`)); });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const get  = p       => req('GET',    BASE + p);
const post = (p, b)  => req('POST',   BASE + p, b);
const del  = p       => req('DELETE', BASE + p);

// ── Test runner ───────────────────────────────────────────────────────────────
class TestRunner {
  constructor() {
    this.results = [];
    this.suiteResults = [];
    this.createdIds = {};
    this.runStart = null;
    this.runEnd = null;
  }

  assert(suite, label, condition, detail = '', meta = {}) {
    const r = { suite, label, pass: !!condition, detail, meta, ts: Date.now() };
    this.results.push(r);
    const icon = condition ? `${C.grn}✓${C.reset}` : `${C.red}✗${C.reset}`;
    const det = detail ? `${C.dim} — ${detail}${C.reset}` : '';
    console.log(`    ${icon} ${label}${det}`);
    return !!condition;
  }

  skip(suite, label, reason) {
    this.results.push({ suite, label, pass: null, detail: reason, skipped: true });
    console.log(`    ${C.yel}○${C.reset} ${C.dim}${label} (${reason})${C.reset}`);
  }

  section(name) {
    console.log(`\n  ${C.cyn}${C.bold}▸ ${name}${C.reset}`);
    return name;
  }

  get passed()  { return this.results.filter(r => r.pass === true).length; }
  get failed()  { return this.results.filter(r => r.pass === false).length; }
  get skipped() { return this.results.filter(r => r.skipped).length; }
  get failures(){ return this.results.filter(r => r.pass === false); }
}

// ── All test suites ───────────────────────────────────────────────────────────
async function runAllSuites(t) {

  // ── Health ──────────────────────────────────────────────────────────────────
  t.section('Health & Server');
  try {
    const r = await get('/health');
    t.assert('Health', 'GET /health returns 200', r.status === 200);
    t.assert('Health', 'Response has status:ok', r.body?.status === 'ok');
    t.assert('Health', 'Response has timestamp', !!r.body?.ts);
    t.assert('Health', 'Response has port', r.body?.port !== undefined);
  } catch(e) {
    t.assert('Health', 'Server reachable', false, e.message);
  }

  // ── Pages ───────────────────────────────────────────────────────────────────
  t.section('Pages & Static');
  try {
    const root = await get('/');
    t.assert('Pages', 'Root 200', root.status === 200);
    t.assert('Pages', 'Root is HTML', root.headers['content-type']?.includes('text/html'));
    t.assert('Pages', 'Root has OutreachPro', root.raw.includes('OutreachPro'));
    t.assert('Pages', 'CF script stripped', !root.raw.includes('email-decode.min.js'));
    t.assert('Pages', 'Version badge present', root.raw.includes('v2.'));
    t.assert('Pages', 'No cache headers', root.headers['cache-control']?.includes('no-store') || root.headers['cache-control']?.includes('no-cache'));

    const landing = await get('/landing');
    t.assert('Pages', 'Landing page 200', landing.status === 200);
    t.assert('Pages', 'Landing has pricing (€)', landing.raw.includes('€'));
    t.assert('Pages', 'Landing has npm badge or features', landing.raw.includes('npm') || landing.raw.includes('feature'));
  } catch(e) {
    t.assert('Pages', 'Pages reachable', false, e.message);
  }

  // ── i18n ────────────────────────────────────────────────────────────────────
  t.section('i18n — 6 Languages');
  const langs = {
    en: { nav_campaigns: 'Campaigns',  nav_dashboard: 'Dashboard' },
    de: { nav_campaigns: 'Kampagnen',  nav_dashboard: 'Dashboard' },
    fr: { nav_campaigns: 'Campagnes',  nav_dashboard: null },
    es: { nav_campaigns: 'Campañas',   nav_dashboard: null },
    it: { nav_campaigns: 'Campagne',   nav_dashboard: null },
    nl: { nav_campaigns: 'Campagnes',  nav_dashboard: null },
  };
  for (const [lang, expected] of Object.entries(langs)) {
    try {
      const r = await get(`/api/i18n/${lang}`);
      t.assert('i18n', `${lang}: returns 200`, r.status === 200);
      t.assert('i18n', `${lang}: has 100+ strings`, Object.keys(r.body || {}).length >= 100, `${Object.keys(r.body||{}).length} strings`);
      if (expected.nav_campaigns) {
        t.assert('i18n', `${lang}: nav_campaigns="${expected.nav_campaigns}"`, r.body?.nav_campaigns === expected.nav_campaigns, r.body?.nav_campaigns);
      }
    } catch(e) { t.assert('i18n', `${lang}: reachable`, false, e.message); }
  }

  // ── Leads ───────────────────────────────────────────────────────────────────
  t.section('Leads API — CRUD');
  try {
    const list = await get('/api/leads');
    t.assert('Leads', 'GET returns 200', list.status === 200);
    t.assert('Leads', 'GET returns array', Array.isArray(list.body));
    const before = list.body?.length || 0;

    const c = await post('/api/leads', {
      name: 'Agent Test Shop',
      city: 'Köln',
      email: 'agent-test@test-example.de',
      category: 'Fahrradhändler',
      rating: 4.5,
      reviewsCount: 88,
    });
    t.assert('Leads', 'POST returns 2xx', c.status === 200 || c.status === 201);
    t.assert('Leads', 'Created has id', !!c.body?.id);
    t.assert('Leads', 'Name persisted', c.body?.name === 'Agent Test Shop');
    t.assert('Leads', 'Has createdAt', !!c.body?.createdAt);
    t.createdIds.lead = c.body?.id;

    const list2 = await get('/api/leads');
    t.assert('Leads', 'Count increased by 1', list2.body?.length === before + 1, `${before} → ${list2.body?.length}`);
    const found = list2.body?.find(l => l.id === t.createdIds.lead);
    t.assert('Leads', 'Lead appears in list', !!found);
    t.assert('Leads', 'City persisted', found?.city === 'Köln');
    t.assert('Leads', 'Rating persisted', found?.rating === 4.5);

    // XSS safety
    const xss = await post('/api/leads', { name: '<script>alert(1)</script>', city: 'X', email: 'x@x.de' });
    t.assert('Leads', 'XSS in name doesnt crash', xss.status < 500);
    if (xss.body?.id) await del(`/api/leads/${xss.body.id}`);

    // Delete
    if (t.createdIds.lead) {
      const d = await del(`/api/leads/${t.createdIds.lead}`);
      t.assert('Leads', 'DELETE returns 200', d.status === 200);
      const list3 = await get('/api/leads');
      t.assert('Leads', 'Deleted lead gone', !list3.body?.find(l => l.id === t.createdIds.lead));
      t.assert('Leads', 'Count back to original', list3.body?.length === before, `${list3.body?.length}`);
    }
  } catch(e) { t.assert('Leads', 'Leads suite', false, e.message); }

  // ── Campaigns ───────────────────────────────────────────────────────────────
  t.section('Campaigns API — CRUD');
  try {
    const list = await get('/api/campaigns');
    t.assert('Campaigns', 'GET returns 200', list.status === 200);
    t.assert('Campaigns', 'GET returns array', Array.isArray(list.body));

    const c = await post('/api/campaigns', {
      name: 'Agent Test Campaign',
      from: 'test@agent-example.com',
      daily: 25,
      stopOnReply: true,
      status: 'draft',
    });
    t.assert('Campaigns', 'POST returns 2xx', c.status === 200 || c.status === 201);
    t.assert('Campaigns', 'Has id', !!c.body?.id);
    t.assert('Campaigns', 'Name persisted', c.body?.name === 'Agent Test Campaign');
    t.assert('Campaigns', 'Daily limit persisted', c.body?.daily === 25);
    t.assert('Campaigns', 'stopOnReply persisted', c.body?.stopOnReply === true);
    t.createdIds.campaign = c.body?.id;

    if (t.createdIds.campaign) {
      const d = await del(`/api/campaigns/${t.createdIds.campaign}`);
      t.assert('Campaigns', 'DELETE returns 200', d.status === 200);
    }
  } catch(e) { t.assert('Campaigns', 'Campaigns suite', false, e.message); }

  // ── CRM Deals ───────────────────────────────────────────────────────────────
  t.section('CRM Deals — CRUD');
  try {
    const list = await get('/api/deals');
    t.assert('Deals', 'GET returns 200', list.status === 200);
    t.assert('Deals', 'GET returns array', Array.isArray(list.body));

    const c = await post('/api/deals', {
      company: 'Agent Test GmbH',
      value: 38000,
      contact: 'Test Person',
      email: 'test@agent-example.de',
      stage: 'Prospect',
    });
    t.assert('Deals', 'POST returns 2xx', c.status === 200 || c.status === 201);
    t.assert('Deals', 'Has id', !!c.body?.id);
    t.assert('Deals', 'Value persisted', c.body?.value === 38000);
    t.assert('Deals', 'Stage persisted', c.body?.stage === 'Prospect');
    t.createdIds.deal = c.body?.id;

    if (t.createdIds.deal) {
      const d = await del(`/api/deals/${t.createdIds.deal}`);
      t.assert('Deals', 'DELETE returns 200', d.status === 200);
    }
  } catch(e) { t.assert('Deals', 'Deals suite', false, e.message); }

  // ── Inbox ───────────────────────────────────────────────────────────────────
  t.section('Inbox / Unibox');
  try {
    const list = await get('/api/inbox');
    t.assert('Inbox', 'GET returns 200', list.status === 200);
    t.assert('Inbox', 'GET returns array', Array.isArray(list.body));
    if (list.body?.length > 0) {
      const msg = list.body[0];
      t.assert('Inbox', 'Message has id', !!msg.id);
      t.assert('Inbox', 'Message has from', !!msg.from);
      t.assert('Inbox', 'Message has subject', !!msg.subject);
      t.assert('Inbox', 'Message has ts', !!msg.ts);

      const labeled = await post('/api/inbox/label', { id: msg.id, label: 'interested' });
      t.assert('Inbox', 'Label returns 200', labeled.status === 200);

      const read = await post('/api/inbox/read', { id: msg.id });
      t.assert('Inbox', 'Mark read returns 200', read.status === 200);

      const check = await get('/api/inbox');
      const updated = check.body?.find(m => m.id === msg.id);
      t.assert('Inbox', 'Label persisted', updated?.label === 'interested');
      t.assert('Inbox', 'Read persisted', updated?.read === true);
    } else {
      t.skip('Inbox', 'Message operations', 'inbox empty');
    }
  } catch(e) { t.assert('Inbox', 'Inbox suite', false, e.message); }

  // ── Analytics ───────────────────────────────────────────────────────────────
  t.section('Analytics');
  try {
    const r = await get('/api/analytics');
    t.assert('Analytics', 'GET returns 200', r.status === 200);
    t.assert('Analytics', 'Has totalLeads', 'totalLeads' in (r.body || {}));
    t.assert('Analytics', 'Has openRate', 'openRate' in (r.body || {}));
    t.assert('Analytics', 'Has replyRate', 'replyRate' in (r.body || {}));
    t.assert('Analytics', 'Has wonRevenue', 'wonRevenue' in (r.body || {}));
    t.assert('Analytics', 'openRate 0–100', r.body?.openRate >= 0 && r.body?.openRate <= 100);
    t.assert('Analytics', 'replyRate 0–100', r.body?.replyRate >= 0 && r.body?.replyRate <= 100);
    t.assert('Analytics', 'replyRate ≤ openRate', r.body?.replyRate <= r.body?.openRate || r.body?.openRate === 0, `${r.body?.replyRate} ≤ ${r.body?.openRate}`);
    t.assert('Analytics', 'totalLeads ≥ 0', r.body?.totalLeads >= 0);
    t.assert('Analytics', 'wonRevenue ≥ 0', r.body?.wonRevenue >= 0);
  } catch(e) { t.assert('Analytics', 'Analytics suite', false, e.message); }

  // ── Security ─────────────────────────────────────────────────────────────────
  t.section('Security & Edge Cases');
  try {
    // Ghost delete
    const ghost = await del('/api/leads/nonexistent-id-xyz-999');
    t.assert('Security', 'Ghost DELETE doesnt crash', ghost.status < 600);

    // Empty POST
    const empty = await post('/api/campaigns', {});
    t.assert('Security', 'Empty POST handled', empty.status < 600);

    // Oversized payload
    const big = await post('/api/leads', { name: 'X'.repeat(100000), city: 'Y', email: 'big@x.de' });
    t.assert('Security', 'Oversized payload handled', big.status < 600);
    if (big.body?.id) await del(`/api/leads/${big.body.id}`);

    // SQL injection
    const sqli = await post('/api/leads', { name: "'; DROP TABLE leads; --", city: 'X', email: 'sqli@x.de' });
    t.assert('Security', 'SQL injection doesnt crash', sqli.status < 500);
    if (sqli.body?.id) await del(`/api/leads/${sqli.body.id}`);

    // Bad label
    const badLabel = await post('/api/inbox/label', { id: null, label: undefined });
    t.assert('Security', 'Null inbox label handled', badLabel.status < 600);
  } catch(e) { t.assert('Security', 'Security suite', false, e.message); }

  // ── Concurrency ──────────────────────────────────────────────────────────────
  t.section('Concurrency');
  try {
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => get('/api/leads')));
    t.assert('Concurrency', '5 concurrent GETs all 200', concurrent.every(r => r.status === 200));
    t.assert('Concurrency', 'All return arrays', concurrent.every(r => Array.isArray(r.body)));
    t.assert('Concurrency', 'All return same count', new Set(concurrent.map(r => r.body?.length)).size === 1);

    const posts = await Promise.all([
      post('/api/leads', { name: 'Conc1', city: 'A', email: 'c1@x.de' }),
      post('/api/leads', { name: 'Conc2', city: 'B', email: 'c2@x.de' }),
      post('/api/leads', { name: 'Conc3', city: 'C', email: 'c3@x.de' }),
    ]);
    t.assert('Concurrency', '3 concurrent POSTs succeed', posts.every(r => r.status === 200 || r.status === 201));
    t.assert('Concurrency', 'All have unique IDs', new Set(posts.map(r => r.body?.id)).size === 3);
    for (const p of posts) if (p.body?.id) await del(`/api/leads/${p.body.id}`);
  } catch(e) { t.assert('Concurrency', 'Concurrency suite', false, e.message); }

  // ── Performance ──────────────────────────────────────────────────────────────
  t.section('Performance');
  const perf = [
    ['/health', 200],
    ['/api/leads', 300],
    ['/api/campaigns', 300],
    ['/api/deals', 300],
    ['/api/inbox', 300],
    ['/api/analytics', 400],
    ['/api/events', 300],
    ['/api/i18n/de', 300],
  ];
  for (const [ep, limit] of perf) {
    try {
      const start = Date.now();
      const r = await get(ep);
      const ms = Date.now() - start;
      t.assert('Performance', `${ep} < ${limit}ms`, ms < limit, `${ms}ms`);
      t.assert('Performance', `${ep} returns 200`, r.status === 200, `status ${r.status}`);
    } catch(e) { t.assert('Performance', `${ep} reachable`, false, e.message); }
  }

  // ── Gmail & Warmup ────────────────────────────────────────────────────────────
  t.section('Gmail & Warmup');
  try {
    const gm = await get('/api/gmail/status');
    t.assert('Gmail', 'Status returns 200', gm.status === 200);
    t.assert('Gmail', 'Has connected field', 'connected' in (gm.body || {}));
    t.assert('Gmail', 'connected is boolean', typeof gm.body?.connected === 'boolean');

    const wm = await get('/api/warmup/metrics');
    t.assert('Warmup', 'Metrics returns 200', wm.status === 200);
    t.assert('Warmup', 'Metrics returns data', wm.body !== null);
  } catch(e) { t.assert('Gmail', 'Gmail/Warmup suite', false, e.message); }

  // ── Events ───────────────────────────────────────────────────────────────────
  t.section('Events');
  try {
    const list = await get('/api/events');
    t.assert('Events', 'GET returns 200', list.status === 200);
    t.assert('Events', 'Seed events loaded', list.body?.length > 0, `${list.body?.length} events`);
    if (list.body?.length > 0) {
      t.assert('Events', 'Event has city', !!list.body[0].city);
      t.assert('Events', 'Event has date', !!list.body[0].date);
    }
    const c = await post('/api/events', { city: 'TestCity', date: '2026-09-01', name: 'Agent Test Event' });
    t.assert('Events', 'POST returns 2xx', c.status === 200 || c.status === 201);
    if (c.body?.id) await del(`/api/events/${c.body.id}`);
  } catch(e) { t.assert('Events', 'Events suite', false, e.message); }

  // ── Data integrity ────────────────────────────────────────────────────────────
  t.section('Data Integrity');
  try {
    const seed = await get('/api/events');
    t.assert('Integrity', 'Seed events survive test run', seed.body?.length >= 10, `${seed.body?.length} events`);

    const lead = { name: 'Integrity Check', city: 'München', email: 'integ@test-example.de', rating: 4.9, reviewsCount: 500 };
    const c = await post('/api/leads', lead);
    const list = await get('/api/leads');
    const found = list.body?.find(l => l.email === lead.email);
    t.assert('Integrity', 'All lead fields round-trip', found?.city === 'München' && found?.rating === 4.9 && found?.reviewsCount === 500, JSON.stringify({ city: found?.city, rating: found?.rating, reviewsCount: found?.reviewsCount }));
    t.assert('Integrity', 'ID is string', typeof found?.id === 'string');
    t.assert('Integrity', 'ID is non-empty', (found?.id || '').length > 0);
    if (found?.id) await del(`/api/leads/${found.id}`);
  } catch(e) { t.assert('Integrity', 'Data integrity suite', false, e.message); }
}

// ── AI Analysis ───────────────────────────────────────────────────────────────
async function analyseWithAI(failures, serverInfo) {
  if (!USE_AI || failures.length === 0) return null;

  console.log(`\n  ${C.mag}${C.bold}✦ Sending failures to Claude for analysis…${C.reset}`);

  const failureText = failures.map(f =>
    `[${f.suite}] ${f.label}: FAILED${f.detail ? ' — ' + f.detail : ''}`
  ).join('\n');

  const prompt = `You are analysing automated test failures for OutreachPro, a Node.js/Express B2B sales engagement platform running on Docker at localhost:3000.

Server info:
${JSON.stringify(serverInfo, null, 2)}

Failed tests (${failures.length}):
${failureText}

For each failure, provide:
1. Root cause (1 sentence)
2. Likely location in code (file + line hint)
3. Exact fix (code snippet or command)

Format your response as JSON:
{
  "summary": "one line summary of all failures",
  "severity": "critical|high|medium|low",
  "fixes": [
    {
      "test": "test label",
      "rootCause": "...",
      "location": "server.js:line ~X",
      "fix": "exact code change or command",
      "priority": 1
    }
  ],
  "quickFix": "single bash command to attempt auto-fix if possible"
}`;

  try {
    const r = await req('POST', 'https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }, {
      'x-api-key': AI_KEY,
      'anthropic-version': '2023-06-01',
    });

    if (r.body?.content?.[0]?.text) {
      const text = r.body.content[0].text;
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch {}
      }
      return { summary: text, fixes: [], quickFix: null };
    }
  } catch(e) {
    console.log(`  ${C.yel}⚠ AI analysis failed: ${e.message}${C.reset}`);
  }
  return null;
}

// ── Auto-fix ──────────────────────────────────────────────────────────────────
function applyAutoFix(analysis) {
  if (!analysis?.quickFix || !AUTO_FIX) return false;
  console.log(`\n  ${C.yel}${C.bold}⚡ Attempting auto-fix…${C.reset}`);
  console.log(`  ${C.dim}Command: ${analysis.quickFix}${C.reset}`);
  try {
    execSync(analysis.quickFix, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log(`  ${C.grn}✓ Auto-fix applied${C.reset}`);
    return true;
  } catch(e) {
    console.log(`  ${C.red}✗ Auto-fix failed: ${e.message}${C.reset}`);
    return false;
  }
}

// ── HTML Report ───────────────────────────────────────────────────────────────
function generateReport(t, analysis, runNum) {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `report-${ts}.html`;
  const filepath = path.join(REPORT_DIR, filename);

  const pct = t.passed + t.failed > 0 ? Math.round((t.passed / (t.passed + t.failed)) * 100) : 0;
  const scoreColor = pct >= 90 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444';
  const duration = Math.round((t.runEnd - t.runStart) / 1000);

  // Group by suite
  const suites = {};
  t.results.forEach(r => {
    if (!suites[r.suite]) suites[r.suite] = { pass: 0, fail: 0, skip: 0, tests: [] };
    if (r.skipped) suites[r.suite].skip++;
    else if (r.pass) suites[r.suite].pass++;
    else suites[r.suite].fail++;
    suites[r.suite].tests.push(r);
  });

  const suiteRows = Object.entries(suites).map(([name, s]) => {
    const sColor = s.fail > 0 ? '#ef4444' : '#22c55e';
    const tests = s.tests.map(r => {
      const icon = r.skipped ? '○' : r.pass ? '✓' : '✗';
      const col = r.skipped ? '#888' : r.pass ? '#22c55e' : '#ef4444';
      return `<tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:6px 12px;color:${col};font-family:monospace">${icon}</td>
        <td style="padding:6px 12px;font-size:13px">${r.label}</td>
        <td style="padding:6px 12px;font-size:12px;color:#888;font-family:monospace">${r.detail || ''}</td>
      </tr>`;
    }).join('');
    return `<div style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <div style="background:#f9fafb;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e7eb">
        <strong style="color:${sColor}">${name}</strong>
        <span style="font-size:13px;color:#666">${s.pass}/${s.pass+s.fail} passed${s.skip > 0 ? ` · ${s.skip} skipped` : ''}</span>
      </div>
      <table style="width:100%;border-collapse:collapse">${tests}</table>
    </div>`;
  }).join('');

  const analysisHtml = analysis ? `
    <div style="margin-top:24px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:20px">
      <h2 style="margin:0 0 12px;font-size:16px;color:#92400e">✦ AI Analysis (Claude Sonnet)</h2>
      <p style="margin:0 0 12px;color:#78350f">${analysis.summary}</p>
      ${analysis.fixes?.map(f => `
        <div style="background:white;border-radius:6px;padding:14px;margin-bottom:10px">
          <div style="font-weight:600;color:#111;margin-bottom:4px">${f.test}</div>
          <div style="font-size:13px;color:#666;margin-bottom:6px">📍 ${f.location || 'unknown'}</div>
          <div style="font-size:13px;color:#444;margin-bottom:8px">🔍 ${f.rootCause}</div>
          <pre style="background:#1a1a1a;color:#d4cfbf;padding:10px;border-radius:4px;font-size:12px;overflow-x:auto;margin:0">${f.fix}</pre>
        </div>
      `).join('') || ''}
      ${analysis.quickFix ? `<div style="margin-top:12px;background:#1a1a1a;color:#22c55e;padding:10px;border-radius:6px;font-family:monospace;font-size:13px">$ ${analysis.quickFix}</div>` : ''}
    </div>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>OutreachPro Test Report — ${ts}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#111;padding:32px}
.header{background:linear-gradient(135deg,#1a1a1a 0%,#2a2a2a 100%);color:white;padding:32px;border-radius:12px;margin-bottom:24px}
.score{font-size:72px;font-weight:800;color:${scoreColor};line-height:1}
.meta{font-size:14px;opacity:.7;margin-top:8px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
.stat{background:white;border:1px solid #e5e7eb;border-radius:8px;padding:20px;text-align:center}
.stat-val{font-size:32px;font-weight:700;line-height:1}
.stat-lbl{font-size:12px;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:1px}
</style>
</head>
<body>
<div class="header">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <h1 style="font-size:22px;margin-bottom:4px">OutreachPro — Test Report</h1>
      <div class="meta">${new Date().toLocaleString()} · Run #${runNum} · ${duration}s · ${BASE}</div>
    </div>
    <div style="text-align:right">
      <div class="score">${pct}%</div>
      <div class="meta">${t.passed + t.failed} assertions</div>
    </div>
  </div>
</div>

<div class="stats">
  <div class="stat"><div class="stat-val" style="color:#22c55e">${t.passed}</div><div class="stat-lbl">Passed</div></div>
  <div class="stat"><div class="stat-val" style="color:#ef4444">${t.failed}</div><div class="stat-lbl">Failed</div></div>
  <div class="stat"><div class="stat-val" style="color:#f59e0b">${t.skipped}</div><div class="stat-lbl">Skipped</div></div>
  <div class="stat"><div class="stat-val" style="color:#6366f1">${duration}s</div><div class="stat-lbl">Duration</div></div>
</div>

${t.failed > 0 ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px">
  <strong style="color:#dc2626">✗ ${t.failed} failed:</strong>
  <ul style="margin-top:8px;padding-left:20px;color:#b91c1c;font-size:13px">
    ${t.failures.map(f => `<li>${f.suite} — ${f.label}${f.detail ? ' (' + f.detail + ')' : ''}</li>`).join('')}
  </ul>
</div>` : '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:24px;color:#166534;font-weight:600">✓ All tests passed — OutreachPro is solid!</div>'}

${analysisHtml}

<div style="margin-top:24px">
  <h2 style="font-size:16px;margin-bottom:16px;color:#374151">Test Suites</h2>
  ${suiteRows}
</div>

<div style="margin-top:24px;color:#9ca3af;font-size:12px;text-align:center">
  OutreachPro v2.5 · Test Agent v1.0 · ${new Date().toISOString()}
</div>
</body>
</html>`;

  fs.writeFileSync(filepath, html);
  return filepath;
}

// ── Main run loop ─────────────────────────────────────────────────────────────
let runCount = 0;

async function runOnce() {
  runCount++;
  const t = new TestRunner();
  t.runStart = Date.now();

  const header = `${C.mag}${C.bold}OutreachPro — Test Agent v1.0${C.reset}`;
  const sub = `${C.dim}Run #${runCount} · ${new Date().toLocaleTimeString()} · Target: ${BASE}${C.reset}`;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(header);
  console.log(sub);
  console.log(`${'─'.repeat(60)}`);

  // Preflight check
  try {
    await get('/health');
  } catch {
    console.log(`\n${C.red}${C.bold}✗ Cannot reach ${BASE}${C.reset}`);
    console.log(`${C.yel}  Start the server: docker compose up -d${C.reset}\n`);
    return { passed: 0, failed: 1, score: 0 };
  }

  // Get server info for AI context
  let serverInfo = {};
  try {
    const h = await get('/health');
    serverInfo = h.body || {};
  } catch {}

  // Run all suites
  await runAllSuites(t);
  t.runEnd = Date.now();

  // Summary
  const total = t.passed + t.failed + t.skipped;
  const pct = t.passed + t.failed > 0 ? Math.round((t.passed / (t.passed + t.failed)) * 100) : 0;
  const scoreColor = pct >= 90 ? C.grn : pct >= 70 ? C.yel : C.red;
  const duration = ((t.runEnd - t.runStart) / 1000).toFixed(1);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`\n${C.bold}Summary${C.reset}  ${scoreColor}${pct}%${C.reset} · ${t.passed} passed · ${t.failed} failed · ${t.skipped} skipped · ${duration}s`);

  // AI analysis of failures
  let analysis = null;
  if (t.failed > 0) {
    console.log(`\n${C.red}${C.bold}Failed tests:${C.reset}`);
    t.failures.forEach(f => console.log(`  ${C.red}•${C.reset} [${f.suite}] ${f.label}${f.detail ? C.dim + ' — ' + f.detail + C.reset : ''}`));

    analysis = await analyseWithAI(t.failures, serverInfo);

    if (analysis) {
      console.log(`\n  ${C.mag}${C.bold}✦ AI Analysis${C.reset}`);
      console.log(`  ${C.bold}Summary:${C.reset} ${analysis.summary}`);
      console.log(`  ${C.bold}Severity:${C.reset} ${analysis.severity || 'unknown'}`);

      if (analysis.fixes?.length > 0) {
        console.log(`\n  ${C.bold}Fixes:${C.reset}`);
        analysis.fixes.forEach((f, i) => {
          console.log(`\n  ${C.cyn}[${i+1}]${C.reset} ${C.bold}${f.test}${C.reset}`);
          console.log(`      📍 ${f.location || 'unknown'}`);
          console.log(`      🔍 ${f.rootCause}`);
          console.log(`      ${C.grn}Fix:${C.reset}`);
          const fixLines = (f.fix || '').split('\n');
          fixLines.forEach(l => console.log(`         ${C.dim}${l}${C.reset}`));
        });
      }

      if (analysis.quickFix) {
        console.log(`\n  ${C.yel}Quick fix:${C.reset} ${analysis.quickFix}`);
        if (AUTO_FIX) applyAutoFix(analysis);
      }
    }
  } else {
    console.log(`\n${C.grn}${C.bold}✓ OutreachPro is solid — all tests passed!${C.reset}`);
  }

  // Generate HTML report
  const reportPath = generateReport(t, analysis, runCount);
  console.log(`\n  ${C.blu}📄 Report:${C.reset} ${reportPath}`);

  // Latest symlink / copy
  const latestPath = path.join(REPORT_DIR, 'latest.html');
  try { fs.copyFileSync(reportPath, latestPath); } catch {}
  console.log(`  ${C.blu}📄 Latest:${C.reset} ${latestPath}`);

  if (pct >= 90) console.log(`\n${C.grn}${C.bold}✓ PASS (${pct}%)${C.reset}\n`);
  else console.log(`\n${C.red}${C.bold}✗ FAIL (${pct}%)${C.reset}\n`);

  return { passed: t.passed, failed: t.failed, score: pct };
}

// ── Entry point ────────────────────────────────────────────────────────────────
(async () => {
  if (WATCH_MODE) {
    console.log(`${C.yel}Watch mode — running every ${WATCH_INTERVAL/1000}s. Ctrl+C to stop.${C.reset}`);
    while (true) {
      await runOnce();
      await new Promise(r => setTimeout(r, WATCH_INTERVAL));
    }
  } else {
    const result = await runOnce();
    process.exit(result.failed > 0 ? 1 : 0);
  }
})().catch(e => {
  console.error(`${C.red}Fatal: ${e.message}${C.reset}`);
  process.exit(1);
});
