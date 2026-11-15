import { readFile, writeFile } from 'node:fs/promises';

const config = JSON.parse(await readFile('sources.json', 'utf8'));
const previous = JSON.parse(await readFile('data/offers.json', 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const validUrl = (s) => { try { return new URL(s).protocol === 'https:'; } catch { return false; } };
const offers = [];
let succeeded = 0;
for (const source of config.sources || []) {
  if (!validUrl(source.url)) { console.warn('Invalid source URL:', source.id); continue; }
  try {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : payload.offers;
    if (!Array.isArray(items)) throw new Error('Expected offers array');
    for (const item of items) {
      if (!item.id || !item.chain || !item.title || !validUrl(item.imageUrl) || !validUrl(item.url)) continue;
      if (item.validTo && item.validTo < today) continue;
      offers.push({ id: String(item.id), chain: String(item.chain), title: String(item.title), imageUrl: item.imageUrl, url: item.url, validFrom: item.validFrom || null, validTo: item.validTo || null });
    }
    succeeded++;
  } catch (error) { console.error('Source failed:', source.id, error.message); }
}
if (!(config.sources || []).length) {
  console.log('No approved feeds configured. Preserving existing offers.');
  process.exit(0);
}
if (!succeeded) {
  console.log('All feeds failed. Preserving previous data.');
  process.exit(0);
}
const oldOffers = Array.isArray(previous.offers) ? previous.offers : [];
const failedSourceIds = new Set((config.sources || []).filter(s => !offers.some(o => o.chain === s.chain)).map(s => s.chain));
for (const offer of oldOffers) if (failedSourceIds.has(offer.chain) && (!offer.validTo || offer.validTo >= today)) offers.push(offer);
const unique = [...new Map(offers.map(offer => [offer.id, offer])).values()];
await writeFile('data/offers.json', JSON.stringify({ updatedAt: new Date().toISOString(), offers: unique }, null, 2) + '\n');
console.log('Offers:', unique.length);
