// LettHandel: daglig oppdatering av norske dagligvarebutikker fra OpenStreetMap.
import fs from 'node:fs/promises';
const URLS = ['https://overpass.kumi.systems/api/interpreter','https://overpass-api.de/api/interpreter'];
const query = `[out:json][timeout:180];area["ISO3166-1"="NO"]["admin_level"="2"]->.norway;(nwr["shop"~"^(supermarket|convenience|grocery)$"](area.norway););out center;`;
function chain(tags) {
 const text = `${tags.brand||''} ${tags.name||''} ${tags.operator||''}`.toLowerCase();
 for (const [pattern,name] of [
  [/rema\s*1000|rema1000/,'Rema 1000'],[/\bkiwi\b/,'Kiwi'],[/\bextra\b/,'Extra'],[/\bcoop\s*prix\b|\bprix\b/,'Coop Prix'],[/\bcoop\s*mega\b|\bmega\b/,'Coop Mega'],[/\bobs\b/,'Obs'],[/\bmeny\b/,'MENY'],[/\bbunnpris\b/,'Bunnpris'],[/\bspar\b/,'SPAR'],[/\bjoker\b/,'Joker'],[/\bnærbutikken\b|\bnaerbutikken\b/,'Nærbutikken'],[/\bmatkroken\b/,'Matkroken'],[/\bcoop\b/,'Coop']]) if(pattern.test(text)) return name;
 return null;
}
async function download() {
 let last;
 for (const url of URLS) {
  try {
   const ctrl = new AbortController(); const timer=setTimeout(()=>ctrl.abort(),195000);
   let response;
   try {response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data:query}),signal:ctrl.signal});} finally {clearTimeout(timer);}
   if(!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
   const json=await response.json(); if(!Array.isArray(json.elements)) throw new Error('Ugyldig svar');
   return json.elements;
  } catch(err) {last=err; console.warn(url,err.message);}
 }
 throw last || new Error('Ingen Overpass-server svarte');
}
const elements=await download();
const stores=elements.map(el=>{
 const tags=el.tags||{}; const chainName=chain(tags);
 const latitude=el.lat??el.center?.lat; const longitude=el.lon??el.center?.lon;
 if(!chainName||!Number.isFinite(latitude)||!Number.isFinite(longitude)) return null;
 return {id:`${el.type}-${el.id}`,name:tags.name||chainName,chain:chainName,latitude,longitude};
}).filter(Boolean).sort((a,b)=>a.id.localeCompare(b.id));
if(stores.length<300) throw new Error(`Kun ${stores.length} butikker funnet; eksisterende data beholdes`);
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/stores.json',JSON.stringify({updatedAt:new Date().toISOString(),source:'OpenStreetMap contributors',stores})+'\n');
console.log(`Lagret ${stores.length} butikker`);
