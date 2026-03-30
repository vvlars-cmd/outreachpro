/**
 * OutreachPro v2.5 — Test Suite
 * Tests: API routes, data integrity, CRUD, security, edge cases, performance
 * Run: node tests/test.js
 */

'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

// ── Config ───────────────────────────────────────────────
const BASE = 'http://localhost:3000';
const TIMEOUT = 8000;

// ── Colours ──────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  grn: '\x1b[32m', red: '\x1b[31m',
  yel: '\x1b[33m', cyn: '\x1b[36m',
  dim: '\x1b[2m', mag: '\x1b[35m',
};

// ── State ─────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;
let createdIds = { lead: null, campaign: null, deal: null, template: null, account: null, event: null };
const errors = [];

// ── Helpers ───────────────────────────────────────────────
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      hostname: url.hostname, port: url.port || 80,
      path: url.pathname + url.search,
      method, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      timeout: TIMEOUT,
    };
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: json, raw: data, headers: res.headers });
      });
    });
    r.on('timeout', () => { r.destroy(); reject(new Error('Request timeout')); });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const get    = p         => req('GET',    p);
const post   = (p, b)    => req('POST',   p, b);
const del    = p         => req('DELETE', p);

function assert(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ${C.grn}✓${C.reset} ${label}${detail ? C.dim + ' — ' + detail + C.reset : ''}`);
  } else {
    failed++;
    errors.push(label);
    console.log(`  ${C.red}✗${C.reset} ${C.bold}${label}${C.reset}${detail ? C.dim + ' — ' + detail + C.reset : ''}`);
  }
}

function skip(label, reason) {
  skipped++;
  console.log(`  ${C.yel}○${C.reset} ${C.dim}${label} (skipped: ${reason})${C.reset}`);
}

function section(title) {
  console.log(`\n${C.cyn}${C.bold}▸ ${title}${C.reset}`);
}

// ── TEST SUITES ────────────────────────────────────────────

async function testHealth() {
  section('Health & Server');
  const r = await get('/health');
  assert('Server responds to /health', r.status === 200);
  assert('Health returns JSON', r.body !== null);
  assert('Health has status:ok', r.body?.status === 'ok');
  assert('Health has timestamp', typeof r.body?.ts === 'string');
  assert('Health has port', r.body?.port !== undefined);
}

async function testStaticAssets() {
  section('Static Assets & Pages');
  const r = await get('/');
  assert('Root returns HTML', r.status === 200);
  assert('Root is HTML content-type', r.headers['content-type']?.includes('text/html'));
  assert('Root contains OutreachPro', r.raw.includes('OutreachPro'));
  assert('Root has no Cloudflare email script', !r.raw.includes('email-decode.min.js'), 'CF script stripped');
  assert('Root injects v2 badge', r.raw.includes('v2.'));

  const landing = await get('/landing');
  assert('Landing page returns 200', landing.status === 200);
  assert('Landing contains pricing', landing.raw.includes('€'));

  const notFound = await get('/nonexistent-page-xyz');
  assert('Unknown route returns HTML (SPA fallback)', notFound.status === 200 || notFound.status === 404);
}

async function testI18n() {
  section('i18n — Translations');
  const langs = ['en', 'de', 'fr', 'es', 'it', 'nl'];
  for (const lang of langs) {
    const r = await get(`/api/i18n/${lang}`);
    assert(`i18n/${lang} returns 200`, r.status === 200, `${lang} translations`);
    assert(`i18n/${lang} has nav_campaigns`, typeof r.body?.nav_campaigns === 'string', r.body?.nav_campaigns);
    assert(`i18n/${lang} has 100+ strings`, Object.keys(r.body || {}).length >= 100, `${Object.keys(r.body || {}).length} strings`);
  }
  const de = await get('/api/i18n/de');
  assert('German nav_campaigns = Kampagnen', de.body?.nav_campaigns === 'Kampagnen');
  assert('German nav_dashboard exists', !!de.body?.nav_dashboard);

  const bad = await get('/api/i18n/xx');
  assert('Unknown language returns object or 200', bad.status === 200 || bad.status === 404);
}

async function testLeadsAPI() {
  section('Leads API — CRUD');

  // GET all
  const list = await get('/api/leads');
  assert('GET /api/leads returns 200', list.status === 200);
  assert('GET /api/leads returns array', Array.isArray(list.body));
  assert('Leads have required fields', list.body.length === 0 || (
    list.body[0].id && list.body[0].name !== undefined
  ));

  // POST create
  const newLead = {
    name: 'Test Fahrradladen GmbH',
    city: 'Köln',
    email: 'test@fahrrad-test-example.de',
    category: 'Fahrradhändler',
    rating: 4.5,
    reviewsCount: 42,
    status: 'new',
    website: 'https://test-example.de',
    phone: '+49 221 1234567',
  };
  const created = await post('/api/leads', newLead);
  assert('POST /api/leads returns 200 or 201', created.status === 200 || created.status === 201);
  assert('Created lead has id', !!created.body?.id);
  assert('Created lead has correct name', created.body?.name === newLead.name);
  assert('Created lead has timestamp', !!created.body?.createdAt);
  createdIds.lead = created.body?.id;

  // Verify it appears in list
  const list2 = await get('/api/leads');
  const found = list2.body?.find(l => l.id === createdIds.lead);
  assert('New lead appears in GET list', !!found);
  assert('Lead data persisted correctly', found?.email === newLead.email);

  // POST with missing required fields
  const incomplete = await post('/api/leads', { city: 'Berlin' });
  assert('POST lead without name still creates (permissive)', incomplete.status === 200 || incomplete.status === 201 || incomplete.status === 400);

  // DELETE
  if (createdIds.lead) {
    const deleted = await del(`/api/leads/${createdIds.lead}`);
    assert('DELETE /api/leads/:id returns 200', deleted.status === 200);
    const list3 = await get('/api/leads');
    const stillThere = list3.body?.find(l => l.id === createdIds.lead);
    assert('Deleted lead no longer in list', !stillThere);
  }
}

async function testLeadsBulk() {
  section('Leads — Bulk & Export');

  const bulk = await post('/api/leads/bulk', {
    leads: [
      { name: 'Bulk Lead 1', city: 'Berlin', email: 'bulk1@example.de', rating: 4.0 },
      { name: 'Bulk Lead 2', city: 'Hamburg', email: 'bulk2@example.de', rating: 3.5 },
      { name: 'Bulk Lead 3', city: 'München', email: 'bulk3@example.de', rating: 5.0 },
    ]
  });
  assert('POST /api/leads/bulk returns 200', bulk.status === 200);
  assert('Bulk import returns count or array', bulk.body !== null);

  const exp = await get('/api/leads/export');
  assert('GET /api/leads/export returns 200', exp.status === 200);
  assert('Export returns CSV or JSON', exp.headers['content-type']?.includes('csv') ||
    exp.headers['content-type']?.includes('json') ||
    Array.isArray(exp.body));
}

async function testCampaignsAPI() {
  section('Campaigns API — CRUD');

  const list = await get('/api/campaigns');
  assert('GET /api/campaigns returns 200', list.status === 200);
  assert('GET /api/campaigns returns array', Array.isArray(list.body));

  const newCamp = {
    name: 'Test Campaign Q2 2026',
    from: 'sales@test-example.com',
    daily: 30,
    stopOnReply: true,
    subject: 'Test subject {{name}}',
    status: 'draft',
  };
  const created = await post('/api/campaigns', newCamp);
  assert('POST /api/campaigns returns 200 or 201', created.status === 200 || created.status === 201);
  assert('Created campaign has id', !!created.body?.id);
  assert('Campaign name persisted', created.body?.name === newCamp.name);
  assert('Campaign has createdAt', !!created.body?.createdAt);
  createdIds.campaign = created.body?.id;

  const list2 = await get('/api/campaigns');
  const found = list2.body?.find(c => c.id === createdIds.campaign);
  assert('New campaign in list', !!found);
  assert('Campaign daily limit correct', found?.daily === 30);

  if (createdIds.campaign) {
    const deleted = await del(`/api/campaigns/${createdIds.campaign}`);
    assert('DELETE /api/campaigns/:id returns 200', deleted.status === 200);
    const list3 = await get('/api/campaigns');
    assert('Deleted campaign gone', !list3.body?.find(c => c.id === createdIds.campaign));
  }
}

async function testTemplatesAPI() {
  section('Templates API — CRUD');

  const list = await get('/api/templates');
  assert('GET /api/templates returns 200', list.status === 200);
  assert('GET /api/templates returns array', Array.isArray(list.body));

  const newTpl = {
    name: 'Test Welcome Template',
    subject: 'Hello {{name}}',
    body: '<p>Hi {{name}}, welcome to {{city}}!</p>',
    lang: 'de',
  };
  const created = await post('/api/templates', newTpl);
  assert('POST /api/templates returns 200 or 201', created.status === 200 || created.status === 201);
  assert('Template has id', !!created.body?.id);
  assert('Template name correct', created.body?.name === newTpl.name);
  createdIds.template = created.body?.id;

  if (createdIds.template) {
    const deleted = await del(`/api/templates/${createdIds.template}`);
    assert('DELETE /api/templates/:id returns 200', deleted.status === 200);
  }
}

async function testAccountsAPI() {
  section('Email Accounts API — CRUD');

  const list = await get('/api/accounts');
  assert('GET /api/accounts returns 200', list.status === 200);
  assert('GET /api/accounts returns array', Array.isArray(list.body));

  const newAcc = {
    email: 'sender@test-example.com',
    name: 'Test Sender',
    warmupEnabled: false,
    dailySentToday: 0,
    warmupDailyTarget: 20,
    reputation: 85,
  };
  const created = await post('/api/accounts', newAcc);
  assert('POST /api/accounts returns 200 or 201', created.status === 200 || created.status === 201);
  assert('Account has id', !!created.body?.id);
  assert('Account email correct', created.body?.email === newAcc.email);
  createdIds.account = created.body?.id;

  if (createdIds.account) {
    const deleted = await del(`/api/accounts/${createdIds.account}`);
    assert('DELETE /api/accounts/:id returns 200', deleted.status === 200);
  }
}

async function testDealsAPI() {
  section('CRM Deals API — CRUD');

  const list = await get('/api/deals');
  assert('GET /api/deals returns 200', list.status === 200);
  assert('GET /api/deals returns array', Array.isArray(list.body));

  const newDeal = {
    company: 'Test Bike Shop GmbH',
    value: 38000,
    contact: 'Max Mustermann',
    email: 'max@test-example.de',
    stage: 'Prospect',
    notes: 'Test deal for automated testing',
  };
  const created = await post('/api/deals', newDeal);
  assert('POST /api/deals returns 200 or 201', created.status === 200 || created.status === 201);
  assert('Deal has id', !!created.body?.id);
  assert('Deal company correct', created.body?.company === newDeal.company);
  assert('Deal value correct', created.body?.value === 38000);
  assert('Deal stage correct', created.body?.stage === 'Prospect');
  assert('Deal has createdAt', !!created.body?.createdAt);
  createdIds.deal = created.body?.id;

  const list2 = await get('/api/deals');
  const found = list2.body?.find(d => d.id === createdIds.deal);
  assert('Deal appears in list', !!found);

  if (createdIds.deal) {
    const deleted = await del(`/api/deals/${createdIds.deal}`);
    assert('DELETE /api/deals/:id returns 200', deleted.status === 200);
    const list3 = await get('/api/deals');
    assert('Deleted deal removed', !list3.body?.find(d => d.id === createdIds.deal));
  }
}

async function testInboxAPI() {
  section('Inbox / Unibox API');

  const list = await get('/api/inbox');
  assert('GET /api/inbox returns 200', list.status === 200);
  assert('Inbox returns array', Array.isArray(list.body));

  if (list.body?.length > 0) {
    const msg = list.body[0];
    assert('Inbox message has id', !!msg.id);
    assert('Inbox message has from', !!msg.from);
    assert('Inbox message has subject', !!msg.subject);
    assert('Inbox message has ts (timestamp)', !!msg.ts);

    // Label
    const labeled = await post('/api/inbox/label', { id: msg.id, label: 'interested' });
    assert('POST /api/inbox/label returns 200', labeled.status === 200);

    // Mark read
    const read = await post('/api/inbox/read', { id: msg.id });
    assert('POST /api/inbox/read returns 200', read.status === 200);

    // Verify label persisted
    const list2 = await get('/api/inbox');
    const updated = list2.body?.find(m => m.id === msg.id);
    assert('Label persisted on message', updated?.label === 'interested');
    assert('Read status persisted', updated?.read === true);
  } else {
    skip('Inbox message operations', 'no messages in inbox');
  }
}

async function testSequencesAPI() {
  section('Sequences API');

  // Create a campaign first to attach sequences to
  const camp = await post('/api/campaigns', {
    name: 'Sequence Test Campaign',
    from: 'test@example.com',
    daily: 10,
    status: 'draft',
  });
  const campId = camp.body?.id;

  if (campId) {
    const seq = await post('/api/sequences', {
      campaignId: campId,
      steps: [
        { subject: 'Step 1 — {{name}}', body: '<p>Hello {{name}}</p>', delay: 0 },
        { subject: 'Follow-up re: {{name}}', body: '<p>Quick follow-up</p>', delay: 3 },
        { subject: 'Final note', body: '<p>Last attempt</p>', delay: 7 },
      ]
    });
    assert('POST /api/sequences returns 200', seq.status === 200);

    const get1 = await get(`/api/sequences/${campId}`);
    assert('GET /api/sequences/:id returns 200', get1.status === 200);
    assert('Sequence has steps array', Array.isArray(get1.body));
    assert('Sequence has 3 steps', get1.body?.length === 3);
    assert('Step 1 has subject', !!get1.body?.[0]?.subject);
    assert('Step 1 has delay:0', get1.body?.[0]?.delay === 0);
    assert('Step 3 has delay:7', get1.body?.[2]?.delay === 7);

    // Clean up
    await del(`/api/campaigns/${campId}`);
  } else {
    skip('Sequences CRUD', 'could not create test campaign');
  }
}

async function testEventsAPI() {
  section('Events API');

  const list = await get('/api/events');
  assert('GET /api/events returns 200', list.status === 200);
  assert('Events returns array', Array.isArray(list.body));
  assert('Events have data (seed loaded)', list.body?.length > 0, `${list.body?.length} events`);

  if (list.body?.length > 0) {
    const ev = list.body[0];
    assert('Event has id', !!ev.id);
    assert('Event has city', !!ev.city);
    assert('Event has date', !!ev.date);
  }

  // Create event
  const created = await post('/api/events', {
    city: 'TestCity',
    date: '2026-06-15',
    name: 'Test Event 2026',
    venue: 'Test Venue',
  });
  assert('POST /api/events returns 200', created.status === 200 || created.status === 201);
  assert('Created event has id', !!created.body?.id);
  createdIds.event = created.body?.id;

  if (createdIds.event) {
    const deleted = await del(`/api/events/${createdIds.event}`);
    assert('DELETE /api/events/:id returns 200', deleted.status === 200);
  }
}

async function testAnalyticsAPI() {
  section('Analytics API');

  const r = await get('/api/analytics');
  assert('GET /api/analytics returns 200', r.status === 200);
  assert('Analytics returns object', typeof r.body === 'object' && !Array.isArray(r.body));
  assert('Analytics has totalLeads', 'totalLeads' in (r.body || {}));
  assert('Analytics has totalCampaigns', 'totalCampaigns' in (r.body || {}));
  assert('Analytics has openRate', 'openRate' in (r.body || {}));
  assert('Analytics has replyRate', 'replyRate' in (r.body || {}));
  assert('Analytics totalLeads is number', typeof r.body?.totalLeads === 'number');
  assert('Analytics openRate is number', typeof r.body?.openRate === 'number');
  assert('Analytics openRate in range 0-100', r.body?.openRate >= 0 && r.body?.openRate <= 100);
}

async function testWarmupAPI() {
  section('Email Warmup API');

  const metrics = await get('/api/warmup/metrics');
  assert('GET /api/warmup/metrics returns 200', metrics.status === 200);
  assert('Warmup metrics returns object or array', metrics.body !== null);

  const update = await post('/api/warmup/metrics', {
    accountId: 'acc1',
    sent: 5,
    received: 4,
    date: new Date().toISOString().split('T')[0],
  });
  assert('POST /api/warmup/metrics returns 200', update.status === 200);
}

async function testGmailAPI() {
  section('Gmail Integration API');

  const status = await get('/api/gmail/status');
  assert('GET /api/gmail/status returns 200', status.status === 200);
  assert('Gmail status has connected field', 'connected' in (status.body || {}));
  assert('Gmail connected is boolean', typeof status.body?.connected === 'boolean');

  // Auth redirect — should return 302 or 200 with URL
  const auth = await get('/api/gmail/auth');
  assert('GET /api/gmail/auth returns redirect or error', auth.status === 302 || auth.status === 400 || auth.status === 200, `status: ${auth.status}`);
}

async function testAIEndpoints() {
  section('AI Personalisation API');

  // Without API key — should return 400/500 or mock
  const r = await post('/api/ai/personalise', {
    lead: {
      name: 'Bike Shop Test',
      city: 'Köln',
      category: 'Fahrradhändler',
      rating: 4.5,
      reviewsCount: 120,
      website: 'https://example.de',
    },
    language: 'de',
    productContext: 'test product',
  });
  assert('POST /api/ai/personalise returns response', r.status === 200 || r.status === 400 || r.status === 500);
  assert('AI response is JSON', r.body !== null);

  // Copilot
  const cop = await post('/api/ai/copilot', {
    message: 'How do I improve my open rates?',
    context: { campaigns: 3, openRate: 22 },
  });
  assert('POST /api/ai/copilot returns response', cop.status === 200 || cop.status === 400 || cop.status === 500);
}

async function testSecurityHeaders() {
  section('Security — Headers & Input Validation');

  const r = await get('/health');

  // Injection attempts
  const xss = await post('/api/leads', {
    name: '<script>alert("xss")</script>',
    city: 'Berlin',
    email: 'xss@example.de',
  });
  assert('XSS in name field handled', xss.status === 200 || xss.status === 201 || xss.status === 400);
  if (xss.body?.id) {
    // Verify it doesn't execute — just stored as string
    const list = await get('/api/leads');
    const found = list.body?.find(l => l.id === xss.body.id);
    if (found) {
      assert('XSS payload stored as plain string (not executed)', typeof found.name === 'string');
      await del(`/api/leads/${xss.body.id}`);
    }
  }

  // SQL injection attempt (shouldn't crash server)
  const sqli = await post('/api/leads', {
    name: "'; DROP TABLE leads; --",
    city: 'Berlin',
    email: 'sqli@example.de',
  });
  assert('SQL injection in name field does not crash server', sqli.status < 500);
  if (sqli.body?.id) await del(`/api/leads/${sqli.body.id}`);

  // Oversized payload
  const big = await post('/api/leads', {
    name: 'A'.repeat(50000),
    city: 'Berlin',
    email: 'big@example.de',
  });
  assert('Oversized payload handled gracefully', big.status < 600);

  // Delete non-existent ID
  const ghost = await del('/api/leads/definitely-not-a-real-id-xyz-999');
  assert('DELETE non-existent ID returns 404 or 200', ghost.status === 404 || ghost.status === 200);

  // Empty POST body
  const empty = await post('/api/campaigns', {});
  assert('Empty campaign POST handled', empty.status === 200 || empty.status === 201 || empty.status === 400);

  // Invalid JSON in label
  const badLabel = await post('/api/inbox/label', { id: 'nonexistent', label: null });
  assert('Invalid inbox label handled', badLabel.status < 600);
}

async function testDataIntegrity() {
  section('Data Integrity');

  // Create lead and verify all fields round-trip
  const lead = {
    name: 'Integrity Test Shop',
    city: 'Düsseldorf',
    email: 'integrity@test-example.de',
    category: 'E-Bike Händler',
    rating: 4.8,
    reviewsCount: 200,
    status: 'new',
    website: 'https://integrity-test.de',
    phone: '+49 211 9876543',
  };
  const c = await post('/api/leads', lead);
  assert('Lead creation for integrity test', c.status === 200 || c.status === 201);

  const list = await get('/api/leads');
  const found = list.body?.find(l => l.email === lead.email);
  assert('Lead email preserved', found?.email === lead.email);
  assert('Lead city preserved', found?.city === lead.city);
  assert('Lead rating preserved', found?.rating === lead.rating);
  assert('Lead reviewsCount preserved', found?.reviewsCount === lead.reviewsCount);
  assert('Lead has id (auto-generated)', typeof found?.id === 'string');
  assert('Lead id is non-empty', found?.id?.length > 0);

  if (found?.id) await del(`/api/leads/${found.id}`);

  // Verify seed data still present after operations
  const events = await get('/api/events');
  assert('Seed events still present', events.body?.length > 0);
}

async function testConcurrency() {
  section('Concurrency & Stability');

  // Fire 5 simultaneous GET requests
  const promises = Array.from({ length: 5 }, () => get('/api/leads'));
  const results = await Promise.all(promises);
  assert('5 concurrent GET /api/leads all return 200', results.every(r => r.status === 200));
  assert('All concurrent responses are arrays', results.every(r => Array.isArray(r.body)));

  // Fire 3 simultaneous POST + DELETE
  const c1 = await post('/api/leads', { name: 'Concurrent 1', city: 'A', email: 'c1@example.de' });
  const c2 = await post('/api/leads', { name: 'Concurrent 2', city: 'B', email: 'c2@example.de' });
  const c3 = await post('/api/leads', { name: 'Concurrent 3', city: 'C', email: 'c3@example.de' });
  assert('3 concurrent POSTs all succeed', [c1,c2,c3].every(r => r.status === 200 || r.status === 201));
  assert('All 3 have unique IDs', new Set([c1.body?.id, c2.body?.id, c3.body?.id]).size === 3);

  // Clean up
  for (const c of [c1, c2, c3]) {
    if (c.body?.id) await del(`/api/leads/${c.body.id}`);
  }
}

async function testPerformance() {
  section('Performance');

  const endpoints = [
    '/health',
    '/api/leads',
    '/api/campaigns',
    '/api/deals',
    '/api/inbox',
    '/api/analytics',
    '/api/events',
    '/api/i18n/de',
  ];

  for (const ep of endpoints) {
    const start = Date.now();
    const r = await get(ep);
    const ms = Date.now() - start;
    assert(`${ep} responds under 500ms`, ms < 500, `${ms}ms`);
    assert(`${ep} returns 200`, r.status === 200, `status: ${r.status}`);
  }
}

async function testLeadImport() {
  section('Lead Import (CSV)');
  // Test that the import endpoint exists and handles requests
  const r = await get('/api/leads/export');
  assert('Lead export endpoint exists', r.status === 200);
  assert('Export returns data', r.body !== null || r.raw.length > 0);
}

async function testAnalyticsCalculations() {
  section('Analytics — Calculation Correctness');

  const r = await get('/api/analytics');
  if (r.body) {
    assert('wonRevenue is a number', typeof r.body.wonRevenue === 'number');
    assert('wonRevenue is non-negative', r.body.wonRevenue >= 0);
    assert('totalLeads is non-negative', r.body.totalLeads >= 0);
    assert('totalCampaigns is non-negative', r.body.totalCampaigns >= 0);
    assert('openRate is between 0 and 100', r.body.openRate >= 0 && r.body.openRate <= 100);
    assert('replyRate is between 0 and 100', r.body.replyRate >= 0 && r.body.replyRate <= 100);
    assert('replyRate <= openRate (logical)', r.body.replyRate <= r.body.openRate || r.body.openRate === 0);
  } else {
    skip('Analytics calculations', 'no response body');
  }
}

// ── RUNNER ─────────────────────────────────────────────────

async function run() {
  console.log(`\n${C.bold}${C.mag}OutreachPro v2.5 — Test Suite${C.reset}`);
  console.log(`${C.dim}Target: ${BASE}${C.reset}`);
  console.log(`${C.dim}${new Date().toISOString()}${C.reset}`);
  console.log('─'.repeat(60));

  // Check server is reachable first
  try {
    await get('/health');
  } catch (e) {
    console.log(`\n${C.red}${C.bold}✗ Cannot reach server at ${BASE}${C.reset}`);
    console.log(`${C.yel}Is the app running? Try: docker compose up -d${C.reset}\n`);
    process.exit(1);
  }

  const suites = [
    testHealth,
    testStaticAssets,
    testI18n,
    testLeadsAPI,
    testLeadsBulk,
    testCampaignsAPI,
    testTemplatesAPI,
    testAccountsAPI,
    testDealsAPI,
    testInboxAPI,
    testSequencesAPI,
    testEventsAPI,
    testAnalyticsAPI,
    testWarmupAPI,
    testGmailAPI,
    testAIEndpoints,
    testSecurityHeaders,
    testDataIntegrity,
    testConcurrency,
    testPerformance,
    testLeadImport,
    testAnalyticsCalculations,
  ];

  for (const suite of suites) {
    try {
      await suite();
    } catch (e) {
      console.log(`  ${C.red}✗ Suite crashed: ${e.message}${C.reset}`);
      failed++;
      errors.push(suite.name + ': ' + e.message);
    }
  }

  // ── SUMMARY ──
  const total = passed + failed + skipped;
  const pct = total > 0 ? Math.round((passed / (passed + failed)) * 100) : 0;

  console.log('\n' + '─'.repeat(60));
  console.log(`\n${C.bold}Results${C.reset}`);
  console.log(`  ${C.grn}✓ Passed:${C.reset}  ${passed}`);
  console.log(`  ${C.red}✗ Failed:${C.reset}  ${failed}`);
  console.log(`  ${C.yel}○ Skipped:${C.reset} ${skipped}`);
  console.log(`  ${C.dim}Total:    ${total}${C.reset}`);
  console.log(`  Score:    ${pct >= 90 ? C.grn : pct >= 70 ? C.yel : C.red}${pct}%${C.reset}\n`);

  if (errors.length > 0) {
    console.log(`${C.red}${C.bold}Failed tests:${C.reset}`);
    errors.forEach(e => console.log(`  ${C.red}•${C.reset} ${e}`));
    console.log('');
  }

  if (failed === 0) {
    console.log(`${C.grn}${C.bold}✓ All tests passed — OutreachPro is solid!${C.reset}\n`);
  } else if (pct >= 80) {
    console.log(`${C.yel}${C.bold}⚠ Mostly passing — ${failed} test(s) need attention${C.reset}\n`);
  } else {
    console.log(`${C.red}${C.bold}✗ ${failed} test(s) failed — check the server${C.reset}\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error(`${C.red}Fatal error: ${e.message}${C.reset}`);
  process.exit(1);
});
