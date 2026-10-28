import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressDB } from '../docs/storage.js';
import { DutchSpeech } from '../docs/speech.js';
import { FakeIDB } from './fake-indexeddb.mjs';
test('IndexedDB persists snapshots atomically, serializes rapid reviews, and survives reopen',async()=>{
 const idb=new FakeIDB(),a=await new ProgressDB(idb).open();assert.equal(await a.load(),null);
 const state={count:1};const first=a.save(state);state.count=2;const second=a.save(state);state.count=3;
 await Promise.all([first,second]);const b=await new ProgressDB(idb).open();assert.deepEqual(await b.load(),{count:2});assert.equal(a.revision,2);
});
test('another tab cannot silently overwrite newer progress',async()=>{
 const idb=new FakeIDB(),a=await new ProgressDB(idb).open();await a.load();await a.save({count:1});
 const b=await new ProgressDB(idb).open();await b.load();await a.save({count:2});
 await assert.rejects(b.save({count:3}),/another tab/);
 const c=await new ProgressDB(idb).open();assert.deepEqual(await c.load(),{count:2});
});
test('a quota/write failure blocks later saves and keeps the last committed record',async()=>{
 const idb=new FakeIDB(),a=await new ProgressDB(idb).open();await a.load();await a.save({count:1});a.db.failNextWrite=true;
 await assert.rejects(a.save({count:2}),/could not be saved/);await assert.rejects(a.save({count:3}),/could not be saved/);
 const b=await new ProgressDB(idb).open();assert.deepEqual(await b.load(),{count:1});
});
test('native speech chooses local nl-NL, uses direct gesture, and never uses an English voice',()=>{
 const calls=[],status=[];const voices=[{lang:'en-US',name:'English',voiceURI:'en',localService:true},{lang:'nl-BE',name:'Belgian',voiceURI:'be',localService:true},{lang:'nl-NL',name:'Dutch network',voiceURI:'net',localService:false},{lang:'nl-NL',name:'Dutch local',voiceURI:'local',localService:true}];
 const synth={getVoices:()=>voices,addEventListener(){},cancel(){calls.push('cancel');},resume(){calls.push('resume');},speak(u){calls.push(u);}};
 class Utterance{constructor(text){this.text=text;}}
 const speech=new DutchSpeech({synth,Utterance,online:()=>true,status:(...s)=>status.push(s)});
 assert.equal(speech.selectedVoice().voiceURI,'local');assert.ok(speech.speak('Goedemorgen'));
 const u=calls.at(-1);assert.equal(u.lang,'nl-NL');assert.equal(u.voice.voiceURI,'local');assert.equal(u.text,'Goedemorgen');assert.equal(u.rate,0.9);assert.deepEqual(calls.slice(0,2),['cancel','resume']);
 u.onstart();assert.equal(status.at(-1)[1],'speaking');u.onend();assert.equal(speech.utterance,null);
 speech.voiceURI='net';assert.equal(speech.selectedVoice().voiceURI,'net');
});
test('offline speech accepts installed Dutch voices and gives useful missing-voice/error feedback',()=>{
 const statuses=[],spoken=[];let voices=[];let changed;
 const synth={getVoices:()=>voices,addEventListener:(type,cb)=>{changed=cb;},cancel(){},resume(){},speak:u=>spoken.push(u)};
 const speech=new DutchSpeech({synth,Utterance:class{constructor(t){this.text=t;}},online:()=>false,status:(...s)=>statuses.push(s)});
 assert.equal(speech.speak('hallo'),false);assert.match(statuses.at(-1)[0],/installed Dutch voice/);
 voices=[{lang:'nl-NL',voiceURI:'local',name:'Dutch',localService:true}];changed();assert.ok(speech.speak('hallo'));const u=spoken[0];u.onerror({error:'not-allowed'});assert.match(statuses.at(-1)[0],/Tap Listen again/);
 speech.speak('nieuw');u.onend();assert.notEqual(speech.utterance,null,'cancelled utterance must not clear the new utterance');
});
test('speech API absence fails gracefully',()=>{
 let message='';const speech=new DutchSpeech({synth:null,Utterance:null,status:t=>{message=t;}});assert.equal(speech.speak('hallo'),false);assert.match(message,/unavailable/);
});
