import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../docs/sw.js',import.meta.url),'utf8');
function harness({scope='https://example.test/study/dutch/',fail=false,staleHTTP=false}={}){
 const handlers={},stores=new Map(),fetched=[];let claimed=false,skipped=false;
 const keyOf=(r,ignore=false)=>{const u=new URL(typeof r==='string'?r:r.url);if(ignore)u.search='';return u.href;};
 const caches={
  async open(name){if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {
   async addAll(requests){if(fail)throw new Error('Network failed');for(const request of requests){const url=typeof request==='string'?request:request.url;const path=new URL(url).pathname.slice(new URL(scope).pathname.length);const bytes=staleHTTP&&request.cache!=='reload'?'Previous application asset':readFileSync(new URL('../docs/'+path,import.meta.url));store.set(url,new Response(bytes));}},
   async match(req,options={}){const key=keyOf(req,options.ignoreSearch);const item=[...store.entries()].find(([k])=>keyOf(k,options.ignoreSearch)===key);return item?.[1].clone();}
  };},async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}
 };
 const self={registration:{scope},location:{origin:new URL(scope).origin},clients:{async claim(){claimed=true;}},skipWaiting(){skipped=true;},addEventListener:(name,fn)=>{handlers[name]=fn;}};
 vm.runInNewContext(source,{self,caches,URL,Request,fetch:async r=>{fetched.push(r);throw new Error('Offline');}});
 async function event(name,props={}){let wait=Promise.resolve(),response;handlers[name]({...props,waitUntil:p=>{wait=p;},respondWith:p=>{response=p;}});await wait;return response?await response:null;}
 return {event,stores,fetched,get claimed(){return claimed;},get skipped(){return skipped;},scope};
}
test('precache is complete; app, both CSV decks, and progress are available offline under a subdirectory',async()=>{
 const h=harness();await h.event('install');assert.equal(h.stores.size,1);const cache=[...h.stores.values()][0];assert.equal(cache.size,17);
 for(const path of ['index.html','app.js','core.js','storage.js','profiles.js','speech.js','styles.css','manifest.webmanifest','decks/500_common_dutch_flashcards.csv','decks/100_common_dutch_phrases.csv','progress/500_common_dutch_flashcards.json'])assert.ok(cache.has(h.scope+path),path);
 const request={method:'GET',url:h.scope+'?launch=home',mode:'navigate'};const response=await h.event('fetch',{request});assert.match(await response.text(),/Dutch, daily/);assert.equal(h.fetched.length,0);
 for(const path of ['app.js','decks/100_common_dutch_phrases.csv','icons/icon-192.png']){const r=await h.event('fetch',{request:{method:'GET',url:h.scope+path+'?cache=1',mode:'cors'}});assert.ok(r.ok);}
});
test('cache status verifies every required asset, and activation removes only old app caches',async()=>{
 const h=harness();await h.event('install');h.stores.set('dutch-daily-old',new Map());h.stores.set('unrelated-app',new Map());await h.event('activate');assert.ok(h.claimed);assert.ok(!h.stores.has('dutch-daily-old'));assert.ok(h.stores.has('unrelated-app'));
 let status;await h.event('message',{data:{type:'CACHE_STATUS'},source:{postMessage:s=>{status=s;}}});assert.equal(status.ready,true);
 [...h.stores.values()][0].delete(h.scope+'core.js');await h.event('message',{data:{type:'CACHE_STATUS'},source:{postMessage:s=>{status=s;}}});assert.equal(status.ready,false);
 await h.event('message',{data:{type:'SKIP_WAITING'}});assert.ok(h.skipped);
});
test('failed precache never leaves a partial version ready for installation',async()=>{
 const h=harness({fail:true});await assert.rejects(h.event('install'),/Network failed/);assert.equal(h.stores.size,0);
});
test('updates install the current profile interface even when HTTP cache contains old assets',async()=>{
 const h=harness({staleHTTP:true});await h.event('install');
 const shell=await h.event('fetch',{request:{method:'GET',url:h.scope,mode:'navigate'}});assert.match(await shell.text(),/id="profile-select"/);
 const script=await h.event('fetch',{request:{method:'GET',url:h.scope+'profiles.js',mode:'cors'}});assert.match(await script.text(),/profileWorkspace/);
});
test('worker leaves external requests, writes, and non-app assets alone',async()=>{
 const h=harness();for(const request of [{method:'POST',url:h.scope+'app.js',mode:'cors'},{method:'GET',url:'https://other.test/app.js',mode:'cors'},{method:'GET',url:h.scope+'not-ours.png',mode:'cors'}])assert.equal(await h.event('fetch',{request}),null);assert.equal(h.fetched.length,0);
});
