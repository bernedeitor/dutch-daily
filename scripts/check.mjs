import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'docs');
const html=readFileSync(resolve(dist,'index.html'),'utf8'),app=readFileSync(resolve(dist,'app.js'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'Duplicate HTML IDs');
for(const [,id]of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(id),`Missing element: ${id}`);
for(const [,href]of html.matchAll(/(?:src|href)="([^"#][^"]+)"/g))if(href.startsWith('./'))assert.ok(existsSync(resolve(dist,href)),`Missing HTML asset ${href}`);
assert.ok(html.includes('viewport-fit=cover'));assert.ok(html.includes('apple-mobile-web-app-capable'));
assert.ok(!/https?:\/\//.test(app),'App should not require an external service');
const css=readFileSync(resolve(dist,'styles.css'),'utf8');assert.ok(css.includes('@media(max-width:360px)'));assert.ok(css.includes('safe-area-inset-bottom'));assert.ok(css.includes('prefers-reduced-motion'));
const manifest=JSON.parse(readFileSync(resolve(dist,'manifest.webmanifest'),'utf8'));assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'./');
for(const icon of manifest.icons){const file=readFileSync(resolve(dist,icon.src)),[w,h]=icon.sizes.split('x').map(Number);assert.equal(file.readUInt32BE(16),w);assert.equal(file.readUInt32BE(20),h);}
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)]);}
const files=walk(dist).filter(p=>!['sw.js','_headers','.nojekyll'].includes(relative(dist,p))).sort();const hash=createHash('sha256');
for(const p of files){hash.update(relative(dist,p));hash.update(readFileSync(p));}
const expected=hash.digest('hex').slice(0,16),sw=readFileSync(resolve(dist,'sw.js'),'utf8');assert.ok(sw.includes(`dutch-daily-${expected}`),'Offline cache is stale: run npm run prepare:pwa');
for(const file of walk(dist).concat(walk(resolve(root,'scripts'))).filter(p=>/\.(m?js)$/.test(p))){const check=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);}
console.log(`Static checks passed: ${ids.length} unique elements; responsive styles; install manifest; PNG icons; ${files.length} current offline assets; JavaScript syntax.`);
