import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDOM, until } from './dom-harness.mjs';
import { FakeIDB } from './fake-indexeddb.mjs';
import { defaultState, clone } from '../docs/core.js';
const html=readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
const idb=new FakeIDB(), spoken=[],blobs=[];
const nativeTimeout=globalThis.setTimeout;
function setup(){
 const dom=createDOM(html);Object.assign(globalThis,{document:dom.document,window:dom.window,Element:dom.Element,Option:dom.Option,indexedDB:idb,isSecureContext:false,location:{protocol:'https:',reload(){}}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true,storage:{persist:async()=>true}}});
 globalThis.speechSynthesis={getVoices:()=>[{lang:'nl-NL',name:'Dutch',voiceURI:'Dutch',localService:true}],addEventListener(){},cancel(){},resume(){},speak:u=>{spoken.push(u.text);u.onstart?.();}};
 globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 globalThis.fetch=async path=>new Response(readFileSync(new URL('../docs/'+path.slice(2),import.meta.url)));
 globalThis.setTimeout=(fn,ms,...args)=>{const timer=nativeTimeout(fn,ms,...args);if(ms>=4000)timer.unref();return timer;};
 URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:test-'+blobs.length;};URL.revokeObjectURL=()=>{};
 return dom;
}
const stored=()=>idb.databases.get('dutch-daily')?.data.get('main')?.data;
const file=(name,data)=>({name,size:data.length,text:async()=>data});
test('app controller: resume, reveal/rate, spelling, deck/selection isolation, import/export, reset/undo, reload',async t=>{
 let dom=setup(),$=id=>document.getElementById(id);
 await import('../docs/app.js?first');await until(()=>$('save-status').textContent==='Saved on this device','boot');
 await t.test('public decks start fresh; cannot rate an unrevealed card',async()=>{
  assert.equal($('stat-learned').textContent,'0');assert.equal($('stat-learning').textContent,'20');assert.equal($('stat-remaining').textContent,'480');
  const buttons=document.querySelectorAll('[data-rating]');buttons[3].click();assert.equal($('session-count').textContent,'0');
  $('reveal-answer').click();assert.equal($('meaning').hidden,false);assert.ok($('meaning').textContent);assert.equal($('rating-panel').hidden,false);
  buttons[3].click();assert.equal($('session-count').textContent,'1');assert.equal($('rating-panel').hidden,true);await until(()=>$('save-status').textContent==='Saved on this device');
 });
 await t.test('listening hides answers, speaks on tap, checks spelling, and keeps Flashcards separate',async()=>{
  $('mode-listening').click();assert.equal($('stat-learned').textContent,'0');assert.equal($('stat-learning').textContent,'20');assert.equal($('word').textContent,'');assert.equal($('listening-word').hidden,true);assert.ok(spoken.length);
  const answer=spoken.at(-1);const before=spoken.length;dom.key('l',$('spelling'));dom.key(' ',$('spelling'));assert.equal(spoken.length,before,'typing must not trigger replay');
  $('spelling').value='  '+answer.toUpperCase()+'!! ';$('dictation-form').dispatchEvent({type:'submit'});assert.match($('dictation-result').textContent,/Correct/);assert.equal($('listening-word').textContent,answer);assert.equal($('dictation-form').hidden,true);
  document.querySelectorAll('[data-rating]')[2].click();assert.equal($('session-count').textContent,'1');assert.ok(spoken.length>before);
  $('selection-mix').click();assert.equal($('selection-mix').getAttribute('aria-pressed'),'true');
  $('mode-flashcards').click();assert.equal($('stat-learned').textContent,'0');assert.equal($('selection-normal').getAttribute('aria-pressed'),'true');
  $('mode-listening').click();assert.equal($('selection-mix').getAttribute('aria-pressed'),'true');
  $('spelling').value='wrong';$('dictation-form').dispatchEvent({type:'submit'});assert.match($('dictation-result').textContent,/You wrote: “wrong”/);assert.equal($('dictation-result').classList.contains('incorrect'),true);
  $('mode-flashcards').click();$('deck-select').value='100_common_dutch_phrases.csv';$('deck-select').dispatchEvent({type:'change'});assert.equal($('stat-learned').textContent,'0');assert.equal($('stat-remaining').textContent,'80');
 });
 await t.test('CSV import adds decks after preview, exports real CSV and Python JSON',async()=>{
  $('csv-file').files=[file('my_dutch.csv','Dutch,Meaning\nhoi,hi\ndag,bye\nHOI,duplicate')];$('csv-file').dispatchEvent({type:'change'});await until(()=>$('import-dialog').open);assert.match($('import-summary').textContent,/2 cards/);assert.match($('import-summary').textContent,/1 empty\/duplicate/);
  $('confirm-import').click();await until(()=>$('deck-select').value==='my_dutch.csv');await until(()=>$('save-status').textContent==='Saved on this device');assert.equal($('stat-learning').textContent,'2');
  $('export-csv').click();assert.match(await blobs.at(-1).text(),/Dutch,Meaning/);
  $('export-python').click();const python=JSON.parse(await blobs.at(-1).text());assert.equal(python.version,3);assert.equal(python.deck,'my_dutch.csv');assert.ok(python.tracks.flashcards);assert.ok(python.tracks.listening);
 });
 await t.test('v2 imports preserve Listening, reset is scoped, and undo restores progress',async()=>{
  $('mode-listening').click();$('selection-mix').click();$('show-spelling').click();document.querySelectorAll('[data-rating]')[3].click();
  await until(()=>$('save-status').textContent==='Saved on this device');const listenBefore=clone(stored().decks.find(d=>d.id==='my_dutch.csv').progress.tracks.listening.cards);
  const raw={version:2,deck:'my_dutch.csv',settings:{learning_cards_since_review:4,review_everything:false},cards:{hoi:{...defaultState('review'),score:3,reviews:9,ratings:[0,0,0,9],interval_days:4,due_at:'2027-01-01T00:00:00Z'},dag:defaultState('learning')}};
  $('progress-file').files=[file('old.json',JSON.stringify(raw))];$('progress-file').dispatchEvent({type:'change'});await until(()=>$('import-dialog').open);assert.match($('import-summary').textContent,/Listening progress is kept/);$('confirm-import').click();await until(()=>$('save-status').textContent==='Saved on this device');
  assert.deepEqual(stored().decks.find(d=>d.id==='my_dutch.csv').progress.tracks.listening.cards,listenBefore);
  $('mode-flashcards').click();assert.equal($('stat-learned').textContent,'1');$('reset-mode').click();assert.equal($('confirm-dialog').open,true);$('confirm-action').click();assert.equal($('stat-learned').textContent,'0');await until(()=>$('save-status').textContent==='Saved on this device');
  $('open-settings').click();assert.equal($('undo-import').hidden,false);$('undo-import').click();assert.equal($('stat-learned').textContent,'1');await until(()=>$('save-status').textContent==='Saved on this device');
 });
 await t.test('malformed imports are rejected and full backup restores custom decks',async()=>{
  $('progress-file').files=[file('broken.json','{"cards":{"hoi":{"status":"bad"}}}')];$('progress-file').dispatchEvent({type:'change'});await until(()=>$('toast').textContent.includes('Unknown card status'));assert.equal($('stat-learned').textContent,'1');
  $('export-all').click();const backup=JSON.parse(await blobs.at(-1).text());assert.equal(backup.decks.length,3);assert.equal(backup.format,'dutch-daily-backup');
  $('progress-file').files=[file('backup.json',JSON.stringify(backup))];$('progress-file').dispatchEvent({type:'change'});await until(()=>$('import-dialog').open);assert.match($('import-description').textContent,/Replace all current decks/);$('confirm-import').click();await until(()=>$('save-status').textContent==='Saved on this device');assert.equal($('stat-learned').textContent,'1');
 });
 await t.test('reopening uses persisted custom deck and progress instead of reseeding',async()=>{
  dom=setup();$=id=>document.getElementById(id);await import('../docs/app.js?reload');await until(()=>$('save-status').textContent==='Saved on this device');assert.equal($('deck-select').value,'my_dutch.csv');assert.equal($('stat-learned').textContent,'1');assert.equal(document.querySelectorAll('option').filter(o=>o.value==='my_dutch.csv').length,1);
 });
});
