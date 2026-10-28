// A small asynchronous transactional IDB test double; no browser rendering.
const copy = value => value === undefined ? undefined : structuredClone(value);
class Transaction {
 constructor(db,mode) {
  this.db=db;this.mode=mode;this.pending=0;this.operations=[];this.staged=new Map();this.active=false;this.ended=false;
  db.tail=db.tail.then(()=>new Promise(resolve=>{
   this.release=resolve;this.active=true;
   if(mode==='readwrite'&&db.failNextWrite){db.failNextWrite=false;this.abort();return;}
   this.operations.splice(0).forEach(fn=>fn());this.check();
  }));
 }
 objectStore(){return {get:key=>this.request(()=>copy(this.staged.has(key)?this.staged.get(key):this.db.data.get(key))),put:(value,key)=>this.request(()=>{this.staged.set(key,copy(value));return key;})};}
 request(fn){
  const request={};this.pending++;clearTimeout(this.timer);
  const operation=()=>queueMicrotask(()=>{
   if(this.ended)return;
   try{request.result=fn();request.onsuccess?.({target:request});}
   catch(error){request.error=error;request.onerror?.({target:request});this.abort();}
   this.pending--;this.check();
  });
  if(this.active)operation();else this.operations.push(operation);
  return request;
 }
 check(){if(this.active&&!this.ended&&this.pending===0){clearTimeout(this.timer);this.timer=setTimeout(()=>this.finish(false),0);}}
 abort(){if(this.ended)return;clearTimeout(this.timer);this.error=new Error('Transaction aborted');queueMicrotask(()=>this.finish(true));}
 finish(abort){
  if(this.ended)return;this.ended=true;
  if(!abort){for(const [k,v]of this.staged)this.db.data.set(k,v);this.oncomplete?.();}
  else this.onabort?.();
  this.release?.();
 }
}
class Database {
 constructor(){this.data=new Map();this.tail=Promise.resolve();this.failNextWrite=false;}
 createObjectStore(){return {};}
 transaction(name,mode){return new Transaction(this,mode);}
 close(){}
}
export class FakeIDB {
 constructor(){this.databases=new Map();}
 open(name){const request={};queueMicrotask(()=>{const fresh=!this.databases.has(name);if(fresh)this.databases.set(name,new Database());request.result=this.databases.get(name);if(fresh)request.onupgradeneeded?.();request.onsuccess?.();});return request;}
}
