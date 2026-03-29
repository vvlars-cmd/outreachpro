// scrapers/apify-maps.js
// Calls Apify compass/crawler-google-places and maps output to lead schema

async function scrape({ city, searchTerms, maxPerSearch = 15, minStars = 3.5, token }) {
  const fetch = (await import('node-fetch')).default;

  const input = {
    searchStringsArray: searchTerms,
    locationQuery: `${city}, Germany`,
    maxCrawledPlacesPerSearch: maxPerSearch,
    language: 'de',
    maxImages: 0,
    maxReviews: 0,
    minimumStars: minStars,
  };

  // Start the actor run
  const startRes = await fetch('https://api.apify.com/v2/acts/compass~crawler-google-places/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ ...input })
  });
  const startData = await startRes.json();
  if (!startData.data?.id) throw new Error(`Apify run failed: ${JSON.stringify(startData)}`);

  const runId = startData.data.id;

  // Poll until finished
  let status = 'RUNNING';
  let attempts = 0;
  while (status === 'RUNNING' || status === 'READY') {
    await new Promise(r => setTimeout(r, 4000));
    const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const pollData = await pollRes.json();
    status = pollData.data?.status || 'FAILED';
    if (++attempts > 60) throw new Error('Apify run timed out after 4 minutes');
  }

  if (status !== 'SUCCEEDED') throw new Error(`Apify run ${status}`);

  // Fetch dataset items
  const datasetRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?format=json&clean=true`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const items = await datasetRes.json();

  // Map to lead schema
  return (Array.isArray(items) ? items : []).map(item => ({
    name: item.title || item.name || '',
    city: extractCity(item.address) || city,
    email: item.email || extractEmailFromText(item.description || '') || '',
    phone: item.phone || item.phoneNumber || '',
    website: cleanUrl(item.website || ''),
    category: (item.categoryName || item.categories?.[0] || 'Local Business'),
    rating: item.totalScore || item.rating || 0,
    reviewsCount: item.reviewsCount || item.reviewCount || 0,
    address: item.address || item.street || '',
    placeId: item.placeId || '',
    googleMapsUrl: item.url || item.googleMapsUrl || '',
    status: 'Neu',
    src: 'Apify',
    aiOpening: '',
    tags: [],
    notes: '',
  }));
}

function extractCity(address) {
  if (!address) return '';
  const parts = address.split(',');
  // Try to extract city from German address format: "Strasse N, PLZZ Stadt"
  for (const part of parts.reverse()) {
    const m = part.trim().match(/^\d{5}\s+(.+)$/);
    if (m) return m[1].trim();
  }
  return parts[parts.length - 1]?.trim() || '';
}

function cleanUrl(url) {
  if (!url) return '';
  try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function extractEmailFromText(text) {
  const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : '';
}

module.exports = { scrape };
