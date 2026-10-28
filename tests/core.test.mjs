import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Scheduler, freshDocument, defaultState, normalizeProgress, normalizedDictation, parseTime, parseCSV, toCSV, reconcileProgress, clone } from '../docs/core.js';
import { makeBackup, parseBackup, loadBundled } from '../docs/storage.js';
const now = () => new Date('2026-10-15T10:30:00.000Z');
const cards = n => Array.from({length:n},(_,i)=>({word:`word${i}`,meaning:`meaning ${i}`}));
function fixture(n = 30) { const deck = cards(n), doc = freshDocument('test.csv', now()); return {deck,doc,s:new Scheduler(deck,doc,'flashcards',{now,random:()=>0})}; }
function rng(seed = 1729) { return () => ((seed = (Math.imul(seed,1664525)+1013904223) >>> 0) / 2**32); }

test('starts with 20 uniformly sampled learning cards, remaining unseen', () => {
 const {s} = fixture(100); assert.deepEqual(s.stats(),{learning:20,review:0,unseen:80,due:0});
 assert.equal(fixture(3).s.stats().learning,3);
 const selected = new Set();
 for(let seed=1;seed<=200;seed++) { const d=freshDocument('x');const x=new Scheduler(cards(100),d,'flashcards',{now,random:rng(seed)});x.words('learning').forEach(w=>selected.add(w)); }
 assert.equal(selected.size,100);
});
test('normal is 4 learning + 1 learned, including not-yet-due reviews',()=>{
 const {s}=fixture(25);s.state.word24={...defaultState('review'),due_at:'2099-01-01T00:00:00Z'};
 assert.deepEqual(Array.from({length:10},()=>s.state[s.nextWord()].status),['learning','learning','learning','learning','review','learning','learning','learning','learning','review']);
});
test('normal prioritizes due learned cards and avoids immediate repeats',()=>{
 const {s}=fixture(25);s.state.word23={...defaultState('review'),due_at:'2020-01-01T00:00:00Z'};s.state.word24={...defaultState('review'),due_at:'2099-01-01T00:00:00Z'};
 s.counter=4;assert.equal(s.nextWord(),'word23');
 const a=s.nextWord(),b=s.nextWord();assert.notEqual(a,b);
});
test('uniform selection covers all 20 learning words; mix excludes unseen',()=>{
 const {s}=fixture(100);s.random=rng(9);const counts=Object.fromEntries(s.words('learning').map(w=>[w,0]));
 for(let i=0;i<40000;i++)counts[s.nextWord()]++;
 for(const n of Object.values(counts))assert.ok(n>1750&&n<2250,`biased frequency: ${n}`);
 s.state.word99=defaultState('review');s.setReviewEverything(true);
 const seen=new Set(Array.from({length:3000},()=>s.nextWord())); assert.equal(seen.size,21);assert.ok(seen.has('word99'));assert.ok(!seen.has('word98'));
});
test('four Easy reviews graduate; replenishes without changing other mode',()=>{
 const {s,doc}=fixture(30);s.currentWord='word0';
 for(let i=0;i<3;i++)s.answer(3);assert.equal(s.state.word0.status,'learning');
 s.answer(3);assert.equal(s.state.word0.status,'review');assert.equal(s.state.word0.score,3);assert.equal(s.state.word0.interval_days,4);assert.equal(s.state.word0.due_at,'2026-10-19T10:30:00.000Z');
 assert.deepEqual(s.state.word0.ratings,[0,0,0,4]);assert.equal(s.words('learning').length,20);assert.deepEqual(doc.tracks.listening.cards,{});
});
test('EMA, failure reentry, early reviews, due expansion match original',()=>{
 const {s}=fixture(30);s.currentWord='word29';s.state.word29={...defaultState('review'),score:3,reviews:8,interval_days:10,due_at:'2099-01-01T00:00:00Z'};
 s.answer(2);assert.equal(s.state.word29.score,2.7);assert.equal(s.state.word29.interval_days,10);assert.equal(s.state.word29.due_at,'2099-01-01T00:00:00Z');
 s.state.word29.due_at='2020-01-01T00:00:00Z';s.answer(3);assert.equal(s.state.word29.interval_days,28);
 s.answer(0);assert.equal(s.state.word29.status,'learning');assert.equal(s.state.word29.due_at,null);assert.equal(s.words('learning').length,21);
});
test('all-learned and single-card decks never get stuck',()=>{
 const {s}=fixture(1);s.currentWord='word0';for(let i=0;i<4;i++)s.answer(3);
 for(let i=0;i<20;i++)assert.equal(s.nextWord(),'word0');s.reset();assert.equal(s.state.word0.reviews,0);assert.equal(s.stats().learning,1);
});
test('v2 migration preserves flashcards, v3 preserves both tracks and settings',()=>{
 const raw={version:2,settings:{learning_cards_since_review:4,review_everything:true},cards:{hoi:{...defaultState('review'),score:2.9,reviews:4,ratings:[0,0,1,3],due_at:'2026-10-16T10:13:23.325731+00:00'}}};
 const migrated=normalizeProgress(raw,'test.csv');assert.deepEqual(migrated.tracks.flashcards.cards,raw.cards);assert.equal(migrated.tracks.flashcards.settings.review_everything,true);assert.deepEqual(migrated.tracks.listening.cards,{});
 assert.deepEqual(normalizeProgress(migrated,'test.csv').tracks,migrated.tracks);
});
test('public decks contain no personal study history and keep independent fresh tracks',()=>{
 for(const stem of ['500_common_dutch_flashcards','100_common_dutch_phrases']){
 const raw=JSON.parse(readFileSync(new URL(`../docs/progress/${stem}.json`,import.meta.url)));const normalized=normalizeProgress(raw,raw.deck);assert.deepEqual(normalized.tracks,raw.tracks);
 for(const track of ['flashcards','listening'])assert.deepEqual(raw.tracks[track].cards,{});
 const deck=parseCSV(readFileSync(new URL(`../docs/decks/${stem}.csv`,import.meta.url),'utf8')).cards;
 const scheduler=new Scheduler(deck,normalized,'flashcards',{now,random:rng()});assert.deepEqual(scheduler.stats(),{learning:20,review:0,unseen:deck.length-20,due:0});assert.deepEqual(normalized.tracks.listening.cards,{});
 }
});
test('strict spelling keeps accents and ignores case, repeated spaces, final punctuation',()=>{
 assert.equal(normalizedDictation('  GOEDEN  morgen!!?… '),'goeden morgen');assert.equal(normalizedDictation('e\u0301e\u0301n.'),'één');assert.notEqual(normalizedDictation('een'),normalizedDictation('één'));assert.notEqual(normalizedDictation('hallo,'),normalizedDictation('hallo'));
 assert.equal(parseTime('2026-10-15T10:13:23.325731+00:00'),Date.parse('2026-10-15T10:13:23.325Z'));assert.equal(parseTime('2026-10-15 10:30:00'),now().getTime());assert.equal(parseTime('invalid'),null);
});
test('CSV handles BOM, escaped quotes, multiline, first two columns, duplicates, semicolon, tab',()=>{
 const x=parseCSV('\uFEFFDutch,Meaning,Extra\r\nhoi,"hi, hello",x\r\nHOI,duplicate,x\r\n"een \"\"ding\"\"","a\nthing",x\r\n,empty,x');
 assert.deepEqual(x.cards,[{word:'hoi',meaning:'hi, hello'},{word:'een "ding"',meaning:'a\nthing'}]);assert.equal(x.skipped,2);assert.deepEqual(parseCSV(toCSV(x.cards)).cards,x.cards);
 assert.equal(parseCSV('Dutch;Meaning\neen;one').cards[0].word,'een');assert.equal(parseCSV('Dutch\tMeaning\nhoi\thi').cards[0].meaning,'hi');
 for(const bad of ['Dutch\nhoi','Dutch,Meaning\nhoi,','Dutch,Meaning\n"hoi,hi','Dutch,Meaning\n"hoi"x,hi'])assert.throws(()=>parseCSV(bad));
});
test('malformed imports fail before replacing data, unusual word keys are safe',()=>{
 for(const raw of [{},[],{tracks:{flashcards:{cards:{hoi:{status:'broken'}}}}},{cards:{hoi:{score:100}}},{cards:{hoi:{ratings:[0]}}},{cards:{hoi:{due_at:'bad'}}}])assert.throws(()=>normalizeProgress(raw,'test.csv'));
 const raw=JSON.parse('{"cards":{"__proto__":{"status":"review"}}}');const d=normalizeProgress(raw,'test.csv');const s=new Scheduler([{word:'__proto__',meaning:'example'}],d,'flashcards',{now});assert.equal(s.nextWord(),'__proto__');assert.equal({}.status,undefined);
});
test('full backups roundtrip all decks; unmatched states survive corrected CSVs',async()=>{
 const state=await loadBundled(async path=>new Response(readFileSync(new URL('../docs/'+path.slice(2),import.meta.url))));
 const imported=parseBackup(makeBackup(state));assert.deepEqual(imported.decks,state.decks);assert.deepEqual(imported.ui,state.ui);
 const doc=normalizeProgress({cards:{Hoi:defaultState('review'),verloren:defaultState('learning')}},'test.csv');reconcileProgress(doc,[{word:'hoi',meaning:'hi'}]);assert.equal(doc.tracks.flashcards.cards.hoi.status,'review');assert.equal(doc.tracks.flashcards.cards.verloren.status,'learning');
 const bad=makeBackup(state);bad.decks[0].cards=[];assert.throws(()=>parseBackup(bad));
});
test('Python oracle: 800 rating/state transitions agree across scores, statuses, dates, and intervals',()=>{
 const random=rng(123), cases=[];
 for(let i=0;i<800;i++){
 const status=['learning','review'][i%2], score=Math.round(random()*30000)/10000,reviews=Math.floor(random()*20);
 const st={...defaultState(status),score,reviews,interval_days:Math.round(random()*18000)/100,due_at:i%3===0?'2026-10-14T00:00:00Z':i%3===1?'2026-10-20T00:00:00Z':null,ratings:[0,0,0,0]};
 cases.push({state:st,rating:i%4});
 }
 const run=spawnSync('python3',[new URL('./oracle.py',import.meta.url).pathname],{input:JSON.stringify(cases),encoding:'utf8'});assert.equal(run.status,0,run.stderr);const expected=JSON.parse(run.stdout);
 cases.forEach((item,i)=>{
 const doc=freshDocument('test.csv',now());doc.tracks.flashcards.cards={word0:clone(item.state)};const s=new Scheduler(cards(1),doc,'flashcards',{now,random:()=>0});s.currentWord='word0';s.answer(item.rating);
 const actual=clone(s.state.word0), gold=expected[i];for(const k of ['due_at','last_seen_at']){if(actual[k])actual[k]=new Date(actual[k]).toISOString();if(gold[k])gold[k]=new Date(gold[k]).toISOString();}
 assert.deepEqual(actual,gold,`case ${i}`);
 });
});
