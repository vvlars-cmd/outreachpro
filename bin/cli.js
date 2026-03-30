#!/usr/bin/env node
'use strict';

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const cmd = args[0];
const appDir = path.join(__dirname, '..');

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const GRN   = '\x1b[32m';
const YLW   = '\x1b[33m';
const CYN   = '\x1b[36m';
const RED   = '\x1b[31m';

function log(msg)  { console.log(`${CYN}[outreachpro]${RESET} ${msg}`); }
function ok(msg)   { console.log(`${GRN}✓${RESET} ${msg}`); }
function warn(msg) { console.log(`${YLW}⚠${RESET}  ${msg}`); }
function err(msg)  { console.error(`${RED}✗${RESET}  ${msg}`); }

const HELP = `
${BOLD}OutreachPro v2.5${RESET} — AI-powered B2B sales engagement platform

${BOLD}Usage:${RESET}
  npx outreachpro <command>

${BOLD}Commands:${RESET}
  ${GRN}start${RESET}       Start the server (requires .env file)
  ${GRN}init${RESET}        Create a .env file from .env.example
  ${GRN}docker${RESET}      Start with Docker Compose
  ${GRN}docker:down${RESET} Stop Docker containers
  ${GRN}help${RESET}        Show this help message

${BOLD}Quick start:${RESET}
  npx outreachpro init     # create .env
  npx outreachpro start    # start server on :3000

${BOLD}Environment:${RESET}
  ANTHROPIC_API_KEY   Required for AI personalisation
  APIFY_TOKEN         Required for Google Maps lead scraping
  GOOGLE_CLIENT_ID    Required for Gmail integration
  GOOGLE_CLIENT_SECRET

${BOLD}Links:${RESET}
  GitHub: https://github.com/vvlars-cmd/outreachpro
  App:    http://localhost:3000 (after start)
`;

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(HELP);
  process.exit(0);
}

if (cmd === 'init') {
  const envExample = path.join(appDir, '.env.example');
  const envFile = path.join(process.cwd(), '.env');
  if (fs.existsSync(envFile)) {
    warn('.env already exists — not overwriting');
  } else if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envFile);
    ok('.env created from .env.example');
    log('Edit .env and add your API keys, then run: npx outreachpro start');
  } else {
    const template = `# OutreachPro — Environment Variables
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx
APIFY_TOKEN=apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_REDIRECT_URI=http://localhost:3000/api/gmail/callback
PORT=3000
NODE_ENV=production
`;
    fs.writeFileSync(envFile, template);
    ok('.env created');
    log('Edit .env and add your API keys');
  }
  process.exit(0);
}

if (cmd === 'start') {
  const envFile = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envFile)) {
    warn('No .env file found. Run: npx outreachpro init');
  }
  log('Starting OutreachPro on http://localhost:3000 …');
  const child = spawn('node', [path.join(appDir, 'server.js')], {
    stdio: 'inherit',
    cwd: appDir,
    env: { ...process.env }
  });
  child.on('error', e => { err('Failed to start: ' + e.message); process.exit(1); });
  process.exit(0);
}

if (cmd === 'docker') {
  log('Starting OutreachPro with Docker Compose…');
  try {
    execSync('docker compose up --build -d', { cwd: appDir, stdio: 'inherit' });
    ok('Running at http://localhost:3000');
  } catch(e) { err('Docker failed. Is Docker Desktop running?'); process.exit(1); }
  process.exit(0);
}

if (cmd === 'docker:down') {
  log('Stopping Docker containers…');
  try {
    execSync('docker compose down', { cwd: appDir, stdio: 'inherit' });
    ok('Stopped');
  } catch(e) { err('Docker down failed'); process.exit(1); }
  process.exit(0);
}

err('Unknown command: ' + cmd);
console.log('Run: npx outreachpro help');
process.exit(1);
