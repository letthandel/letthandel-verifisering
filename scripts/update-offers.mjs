import { readFile, writeFile } from 'node:fs/promises';

// REMA 1000's publicly observed Tjek catalog endpoints.
// Only use this integration where you have permission to republish the page images.
const CATALOGS = 'https://api.etilbudsavis.dk/v2/catalogs?dealer_ids=faa0Ym&order_by=publication_date&r_locale=en_US';
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
try {
  const catalogs = await json(CATALOGS);
  if (!Array.isArray(catalogs)) throw new Error('Unexpected catalog format');
  // Publish catalogs already released to the public, including upcoming valid-from dates; exclude expired catalogs.
  const active = catalogs.filter(c =>
    c && c.id && c.dealer_id === 'faa0Ym' &&
    c.types?.includes('paged') && c.page_count > 0 &&
    Date.parse(c.publish) <= today && Date.parse(c.run_till) >= today
  );
  const offers = [];
  for (const catalog of active) {
    try {
      const rawPages = await json(PAGES(catalog.id));
      if (!Array.isArray(rawPages)) throw new Error('Unexpected pages format');
      const pages = rawPages.map(p => p?.view).filter(isHttps);
      if (pages.length !== catalog.page_count) throw new Error(`Expected ${catalog.page_count} pages, got ${pages.length}`);
      const imageUrl = catalog.images?.view && isHttps(catalog.images.view) ? catalog.images.view : pages[0];
      offers.push({
        id: `rema-${catalog.id}`, chain: 'Rema 1000',
        title: `REMA 1000 – ${catalog.label || 'kundeavis'}`,
        imageUrl, url: 'https://www.rema.no/kampanjer/',
        pages, validFrom: catalog.run_from, validTo: catalog.run_till
      });
    } catch (error) { console.warn(`REMA catalog ${catalog.id}: ${error.message}`); }
  }
  if (active.length && !offers.length) throw new Error('No complete catalogs could be fetched');
  // Keep other chains from previous data; this integration only owns REMA entries.
  const otherChains = (previous.offers || []).filter(o => o.chain !== 'Rema 1000');
  const nextOffers = [...offers, ...otherChains];
  const previousComparable = JSON.stringify(previous.offers || []);
  if (JSON.stringify(nextOffers) !== previousComparable) {
    await writeFile(OUTPUT, JSON.stringify({updatedAt:new Date().toISOString(),offers:nextOffers},null,2)+'\n');
    console.log(`Published ${offers.length} active REMA catalogs (${offers.reduce((n,o)=>n+o.pages.length,0)} pages)`);
  } else {
    console.log('No offer changes');
  }
} catch (error) {
  console.error('REMA sync failed; preserving last published offers:', error.message);
  process.exitCode = 1;
}
