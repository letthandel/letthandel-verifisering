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

// Query geographical catalog availability only when the source actually behaves
// differently at different coordinates. A title like "Nord" is not itself a
// verified store/region match. Never infer coverage from a nearby shop name.
const GEO_PROBES = [
  [58.147,7.996], [58.970,5.733], [59.914,10.752], [60.392,5.323],
  [63.431,10.395], [65.473,12.213], [66.313,14.143], [67.281,14.405],
  [68.799,16.541], [69.649,18.956], [69.969,23.271]
];
const GEO_CONCURRENCY = 5;
const storesSource = JSON.parse(await readFile('data/stores.json', 'utf8'));
const allStores = (storesSource.stores || []).filter(s =>
  s && s.id && s.chain && Number.isFinite(Number(s.latitude)) &&
  Number.isFinite(Number(s.longitude)));
const REGIONAL_TITLE = /(?:^|[\s–—:\-])(nord|sør|syd|øst|vest|midt)(?:$|[\s–—:,\-])/i;
const NATIONAL_TITLE = /(?:^|[\s–—:\-])(riks|landsdekkende)(?:$|[\s–—:,\-])/i;
const geographicCatalogs = (dealerId, latitude, longitude) =>
  CATALOGS(dealerId) + '&r_lat=' + encodeURIComponent(latitude) +
  '&r_lng=' + encodeURIComponent(longitude);
const catalogIdSet = list => new Set((Array.isArray(list) ? list : []).map(c => String(c.id)));
async function limited(items, count, load) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, count) }, async () => {
    while (i < items.length) {
      const j = i++;
      try { results[j] = { ok: true, data: await load(items[j]) }; }
      catch (error) { results[j] = { ok: false, error: String(error) }; }
    }
  }));
  return results;
}
async function sourceGeoCoverage(dealerId, active, chain) {
  if (!active.length) return new Map();
  const stores = allStores.filter(s => s.chain === chain ||
    (chain === 'SPAR' && s.chain === 'EUROSPAR'));
  if (!stores.length) return new Map();
  // The external source may be rate-limited; never run thousands of
  // requests every day just to infer coverage from an undocumented API.
  if (stores.length > 1000) {
    console.warn(chain + ': too many stores for safe per-store verification');
    return new Map();
  }
  if (active.length === 1 && !REGIONAL_TITLE.test(String(active[0].label || '')))
    return new Map();
  const probes = await limited(GEO_PROBES, GEO_CONCURRENCY, ([lat, lng]) =>
    json(geographicCatalogs(dealerId, lat, lng)));
  if (probes.some(x => !x.ok || !Array.isArray(x.data))) {
    console.warn(chain + ': location probes failed; no unverified matches published');
    return new Map();
  }
  const probeSets = probes.map(x => catalogIdSet(x.data));
  const variableIds = active.map(c => String(c.id)).filter(id => {
    const seen = probeSets.filter(set => set.has(id)).length;
    return seen > 0 && seen < probeSets.length;
  });
  if (!variableIds.length) {
    console.log(chain + ': catalog feed did not prove geographic variation');
    return new Map();
  }
  // Use an OSM store ID only after asking the provider at THAT store's exact
  // coordinates; never assign a county using a guessed latitude boundary.
  const checked = await limited(stores, GEO_CONCURRENCY, store =>
    json(geographicCatalogs(dealerId, store.latitude, store.longitude)));
  const failures = checked.filter(x => !x.ok || !Array.isArray(x.data)).length;
  if (failures > Math.max(2, Math.floor(stores.length * 0.02))) {
    console.warn(chain + ': insufficient geographic results (' + failures + ' errors)');
    return new Map();
  }
  const mapped = new Map(variableIds.map(id => [id, []]));
  checked.forEach((result, index) => {
    if (!result.ok || !Array.isArray(result.data)) return;
    const found = catalogIdSet(result.data);
    for (const id of variableIds) if (found.has(id))
      mapped.get(id).push(String(stores[index].id));
  });
  return new Map([...mapped].filter(([, ids]) => ids.length));
}
function attachCoverage(catalog, base, geoStoreIds, previousOffer) {
  const label = String(catalog.label || '');
  const region = REGIONAL_TITLE.exec(label);
  const national = NATIONAL_TITLE.test(label);
  const scope = region ? 'region' : national ? 'national' : 'unknown';
  if (geoStoreIds && geoStoreIds.length) return {
    ...base, scope: region ? 'region' : 'store',
    regionLabel: region ? region[1] : '',
    storeIds: [...new Set(geoStoreIds)], coverageVerified: true,
    coverageMethod: 'provider-coordinate-filter'
  };
  if (previousOffer?.coverageVerified === true &&
    previousOffer.coverageMethod === 'provider-coordinate-filter' &&
    Array.isArray(previousOffer.storeIds) && previousOffer.storeIds.length) return {
    ...base, scope: previousOffer.scope, regionLabel: previousOffer.regionLabel || '',
    storeIds: previousOffer.storeIds, coverageVerified: true,
    coverageMethod: 'provider-coordinate-filter'
  };
  return { ...base, scope, regionLabel: region ? region[1] : '',
    coverageVerified: false, coverageMethod: region || national ? 'title-only' : 'not-provided' };
}
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
    let geoCoverage = new Map();
    try { geoCoverage = await sourceGeoCoverage(dealerId, active, chain); }
    catch (error) { console.warn(chain + ': geo metadata unavailable: ' + error.message); }
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
        const offerId = dealerId + '-' + catalog.id;
        const oldMatch = previousActive.find(o => o.id === offerId);
        updated.push(attachCoverage(catalog, {
          id: offerId, chain,
          title: chain + ' – ' + (catalog.label || 'kundeavis'),
          imageUrl, url: '', pages,
          validFrom: catalog.run_from || null, validTo: catalog.run_till || null,
          publish: catalog.publish || null
        }, geoCoverage.get(String(catalog.id)), oldMatch));
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
