// scrapers/gmail-scraper.js
// Queries Gmail inbox and extracts leads from email headers

async function scrape({ accessToken, query = '', maxResults = 100, onProgress }) {
  const fetch = (await import('node-fetch')).default;

  const headers = { Authorization: `Bearer ${accessToken}` };
  onProgress?.(`Searching Gmail: "${query || 'all mail'}"...`);

  // 1. List matching message IDs
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`;
  const listRes = await fetch(listUrl, { headers });
  const listData = await listRes.json();
  if (listData.error) throw new Error(listData.error.message);

  const messages = listData.messages || [];
  onProgress?.(`Found ${messages.length} messages. Extracting leads...`);

  const leads = [];
  const seen = new Set();

  // 2. Fetch each message headers (batch of 20 at a time)
  const batchSize = 20;
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(m => fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=CC&metadataHeaders=Subject`,
        { headers }
      ).then(r => r.json()))
    );

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const msg = result.value;
      const hdrs = msg.payload?.headers || [];
      const getHdr = name => hdrs.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      const from = getHdr('From');
      const replyTo = getHdr('Reply-To');
      const cc = getHdr('CC');

      for (const raw of [from, replyTo, ...cc.split(',')]) {
        const parsed = parseEmailAddress(raw.trim());
        if (!parsed || !parsed.email) continue;
        if (seen.has(parsed.email.toLowerCase())) continue;
        seen.add(parsed.email.toLowerCase());

        const company = inferCompany(parsed.email, parsed.name);
        leads.push({
          name: parsed.name || company || parsed.email.split('@')[0],
          email: parsed.email,
          company,
          website: parsed.email.split('@')[1] || '',
          category: 'Inbox Lead',
          city: '',
          phone: '',
          rating: 0,
          reviewsCount: 0,
          address: '',
          status: 'Neu',
          src: 'Gmail',
          aiOpening: '',
          tags: ['inbox-scraped'],
          notes: `From Gmail search: "${query}"`,
        });
      }
    }

    onProgress?.(`Processed ${Math.min(i + batchSize, messages.length)} / ${messages.length} messages — ${leads.length} leads found`);
    await new Promise(r => setTimeout(r, 200)); // be gentle with rate limits
  }

  return leads;
}

function parseEmailAddress(raw) {
  if (!raw) return null;
  // "Display Name <email@domain.com>" or just "email@domain.com"
  const angleMatch = raw.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  if (angleMatch) {
    return { name: angleMatch[1].trim().replace(/^"|"$/g, ''), email: angleMatch[2].trim().toLowerCase() };
  }
  const emailMatch = raw.match(/^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
  if (emailMatch) return { name: '', email: emailMatch[1].toLowerCase() };
  return null;
}

function inferCompany(email, displayName) {
  if (!email) return '';
  const domain = email.split('@')[1] || '';
  // Skip personal/free email providers
  const free = ['gmail.com','googlemail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','web.de','gmx.de','gmx.net','freenet.de','t-online.de'];
  if (free.includes(domain)) {
    // Try to derive from display name
    return cleanName(displayName);
  }
  // Extract company name from domain (remove TLD + www)
  return domain.replace(/^www\./, '').split('.')[0]
    .split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function cleanName(name) {
  if (!name) return '';
  return name.replace(/[^a-zA-Z0-9äöüÄÖÜß\s&.-]/g, '').trim();
}

module.exports = { scrape };
