import { readFile, writeFile } from 'node:fs/promises';

// REMA 1000's publicly observed Tjek catalog endpoints.
// Only use this integration where you have permission to republish the page images.
const DEALERS = [
  ['Rema 1000', 'faa0Ym'], ['Kiwi', '257bxm'], ['Extra', '80742m'],
  ['MENY', '4333pm'], ['SPAR', 'c062vm'], ['Joker', 'b3e8Fm'],
  ['Bunnpris', '5b11sm'], ['Coop Prix', 'f5d5lm'],
  ['Coop Mega', 'de79dm'], ['Obs', '51dawm'], ['Europris', 'e857Mm'],
  ['Matkroken', '2686gD'], ['Nærbutikken', '5861Qq']
];
const CATALOGS = dealerId => 'https://api.etilbudsavis.dk/v2/catalogs?dealer_ids=' + encodeURIComponent(dealerId) + '&order_by=publication_date&r_locale=en_US';
const PAGES = id => `https://api.etilbudsavis.dk/v2/catalogs/${encodeURIComponent(id)}/pages?r_locale=en_US`;
const OUTPUT = 'data/offers.json';
const today = Date.now();
const isHttps = s => { try { return new URL(s).protocol === 'https:'; } catch { return false; } };
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', 'User-Agent': 'LettHandel/1.0 (catalog metadata)' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}
const previous = JSON.parse(await readFile(OUTPUT, 'utf8'));
const dateMs = value => {
  if (!value) return null;
  const date = Date.parse(String(value).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(date) ? date : null;
};
const stillValid = o => !o.validTo || (dateMs(o.validTo) != null && dateMs(o.validTo) >= today);
const previousActive = (previous.offers || []).filter(o =>
  isHttps(o.imageUrl) && Array.isArray(o.pages) && o.pages.length > 0 && stillValid(o)
);
const updated = [];
let successfulDealers = 0, failedDealers = 0;
for (const [chain, dealerId] of DEALERS) {
  try {
    const catalogs = await json(CATALOGS(dealerId));
    if (!Array.isArray(catalogs)) throw new Error('Unexpected catalog format');
    const active = catalogs.filter(c =>
      c && c.id && c.dealer_id === dealerId && Number(c.page_count) > 0 &&
      (c.types?.includes('paged') || c.page_count > 0) &&
      dateMs(c.publish) != null && dateMs(c.publish) <= today &&
      dateMs(c.run_till) != null && dateMs(c.run_till) >= today
    ).sort((a, b) => (dateMs(b.publish) || 0) - (dateMs(a.publish) || 0)).slice(0, 4);
    let count = 0;
    for (const catalog of active) {
      try {
        const rawPages = await json(PAGES(catalog.id));
        if (!Array.isArray(rawPages)) throw new Error('Unexpected pages format');
        const pages = rawPages.map(p => p?.view).filter(isHttps);
        if (!pages.length || pages.length !== Number(catalog.page_count)) {
          throw new Error('Incomplete catalog pages');
        }
        const imageUrl = isHttps(catalog.images?.view) ? catalog.images.view : pages[0];
        updated.push({
          id: dealerId + '-' + catalog.id, chain,
          title: chain + ' – ' + (catalog.label || 'kundeavis'),
          imageUrl, url: '', pages,
          validFrom: catalog.run_from || null, validTo: catalog.run_till || null,
          publish: catalog.publish || null
        });
        count++;
      } catch (error) {
        console.warn(chain + ' catalog ' + catalog.id + ': ' + error.message);
      }
    }
    if (active.length && count === 0) throw new Error('No complete published catalog pages');
    console.log(chain + ': ' + count + ' complete flyers');
    successfulDealers++;
  } catch (error) {
    failedDealers++;
    const backup = previousActive.filter(o => o.chain === chain);
    updated.push(...backup);
    console.warn(chain + ': ' + error.message + ', retaining ' + backup.length + ' valid cached flyers');
  }
}
if (!successfulDealers) {
  throw new Error('All dealer feeds failed: keeping existing offers');
}
const names = new Set(DEALERS.map(([name]) => name));
updated.push(...previousActive.filter(o => !names.has(o.chain)));
const unique = [...new Map(updated.map(o => [o.id, o])).values()]
  .sort((a, b) => a.chain.localeCompare(b.chain, 'nb') || a.id.localeCompare(b.id));
if (!unique.length) throw new Error('No complete current flyer images; keeping existing offers');
if (JSON.stringify(unique) !== JSON.stringify(previous.offers || [])) {
  await writeFile(OUTPUT, JSON.stringify({ updatedAt: new Date().toISOString(), offers: unique }, null, 2) + '\n');
  console.log('Published ' + unique.length + ' complete flyers; ' + failedDealers + ' dealer feeds failed');
} else {
  console.log('No changes in ' + unique.length + ' flyers; ' + failedDealers + ' dealer feeds failed');
}
