import { readFile, writeFile } from 'node:fs/promises';
const sources = JSON.parse(await readFile('sources.json', 'utf8')).sources || [];
const previous = JSON.parse(await readFile('data/offers.json', 'utf8'));
const today = new Date().toISOString().slice(0,10);
const offers = [];
const safe = s => { try { const u = new URL(s); return u.protocol === 'https:' && !['localhost','127.0.0.1'].includes(u.hostname); } catch { return false; } };
const decode = s => s.replaceAll('&amp;', '&').replaceAll('&#x2F;', '/').replaceAll('&quot;', '"');
const meta = (html, key) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attr = name => {
      const pattern = new RegExp(name + '\\s*=\\s*(["\\x27])([^"\\x27]*)\\1', 'i');
      return (tag.match(pattern) || [,'',''])[2];
    };
    if (attr('property') === key || attr('name') === key) return decode(attr('content'));
  }
  return '';
};
let successful = 0;
for (const source of sources) {
  if (!safe(source.url)) continue;
  try {
    const response = await fetch(source.url, {signal: AbortSignal.timeout(18000), headers: {'User-Agent':'LettHandel-offer-discovery/1.0',Accept:'text/html,application/json'}});
    if (!response.ok) throw Error('HTTP '+response.status);
    const type = response.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      const payload = await response.json();
      const items = Array.isArray(payload) ? payload : payload.offers;
      if (!Array.isArray(items)) throw Error('JSON source has no offers');
      for (const item of items) if (item.id && item.chain && item.imageUrl && item.url && safe(item.imageUrl) && safe(item.url) && (!item.validTo || item.validTo >= today))
        offers.push({id:String(item.id),chain:String(item.chain),title:String(item.title || 'Kundeavis'),imageUrl:item.imageUrl,url:item.url,pages:Array.isArray(item.pages)?item.pages.filter(safe):[],pdfUrl:safe(item.pdfUrl)?item.pdfUrl:null,validFrom:item.validFrom || null,validTo:item.validTo || null});
      successful++;
      continue;
    }
    const html = await response.text();
    const image = meta(html,'og:image') || meta(html,'twitter:image');
    const title = meta(html,'og:title') || (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [,''])[1];
    // Never present a generic campaign or logo as a weekly flyer.
    const evidence = [image,title].join(' ').toLowerCase();
    // Page titles alone are not proof that an Open Graph image is a flyer cover.
    const imageEvidence = image.toLowerCase();
    if (!image || !safe(new URL(image,source.url).href) || !/(kundeavis|tilbudsavis|weekly.flyde|avisforside)/i.test(imageEvidence)) {
      console.log(source.chain+': no verified flyer cover in page metadata');
      continue;
    }
    const absolute = new URL(image,source.url).href;
    const imageResponse = await fetch(absolute,{method:'HEAD',signal:AbortSignal.timeout(12000)});
    if (!imageResponse.ok || !/^image\//.test(imageResponse.headers.get('content-type') || '')) throw Error('Metadata image not accessible');
    offers.push({id:source.id+'-'+absolute,chain:source.chain,title:'Kundeavis fra '+source.chain,imageUrl:absolute,url:source.url,validFrom:null,validTo:null});
    successful++;
  } catch(e) { console.warn(source.chain+': '+e.message); }
}
if (!successful) { console.log('No confirmed images; retaining existing data'); process.exit(0); }
const unique=[...new Map(offers.map(o=>[o.id,o])).values()];
const next={updatedAt:new Date().toISOString(),offers:unique};
await writeFile('data/offers.json',JSON.stringify(next,null,2)+'\n');
console.log('Published '+unique.length+' offers');
