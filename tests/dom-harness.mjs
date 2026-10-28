// Controller-test DOM only. This does not simulate layout or Safari/WebKit.
let activeDocument;
class Target {
 constructor(){this.listeners=new Map();}
 addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);}
 dispatchEvent(event){event.target??=this;event.preventDefault??=()=>{event.defaultPrevented=true;};for(const fn of this.listeners.get(event.type)??[])fn(event);return !event.defaultPrevented;}
}
export class Element extends Target {
 constructor(tag='div',attrs={}){super();this.tagName=tag.toUpperCase();this.attrs={...attrs};this.children=[];this.parentElement=null;this._text='';this.style={};this._value=undefined;this.files=[];this.checked=false;this.isContentEditable=false;this.classList={toggle:(name,force)=>{const s=new Set((this.attrs.class??'').split(/\s+/).filter(Boolean));const yes=force??!s.has(name);if(yes)s.add(name);else s.delete(name);this.attrs.class=[...s].join(' ');return yes;},contains:name=>(this.attrs.class??'').split(/\s+/).includes(name)};}
 get hidden(){return Object.hasOwn(this.attrs,'hidden');}set hidden(value){if(value)this.attrs.hidden='';else delete this.attrs.hidden;}
 get disabled(){return Object.hasOwn(this.attrs,'disabled');}set disabled(value){if(value)this.attrs.disabled='';else delete this.attrs.disabled;}
 get open(){return Object.hasOwn(this.attrs,'open');}
 get id(){return this.attrs.id??'';}
 get value(){if(this._value!==undefined)return this._value;if(this.tagName==='SELECT')return this.children.find(x=>x.tagName==='OPTION')?.value??'';return this.attrs.value??(this.tagName==='OPTION'?this.textContent:'');}
 set value(value){this._value=String(value);}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}set textContent(text){this.children=[];this._text=String(text);}
 get dataset(){return Object.fromEntries(Object.entries(this.attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5),v]));}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
 append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
 replaceChildren(...children){this._text='';this.children=[];this._value=undefined;this.append(...children);}
 matches(selector){return selector.split(',').some(part=>{const s=part.trim();if(s.startsWith('.'))return this.classList.contains(s.slice(1));if(s.startsWith('#'))return this.id===s.slice(1);const m=s.match(/^([\w-]+)?(?:\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\])?$/);return !!m&&(!m[1]||this.tagName===m[1].toUpperCase())&&(!m[2]||(Object.hasOwn(this.attrs,m[2])&&(m[3]===undefined||this.attrs[m[2]]===m[3])));});}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 closest(selector){let node=this;while(node){if(node.matches(selector))return node;node=node.parentElement;}return null;}
 showModal(){this.attrs.open='';}close(){delete this.attrs.open;}
 focus(){activeDocument.activeElement=this;}blur(){activeDocument.activeElement=activeDocument.body;}
 click(){if(!this.disabled)this.dispatchEvent({type:'click'});}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
}
export function createDOM(html){
 const doc=new Element('document'),stack=[doc],voids=new Set(['meta','link','input','br','hr','img','source','wbr']);
 const tokens=html.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g)??[];
 for(const token of tokens){if(token.startsWith('<!'))continue;
 if(token.startsWith('</')){const tag=token.slice(2,-1).trim().toUpperCase();let i=stack.length-1;while(i>0&&stack[i].tagName!==tag)i--;if(i>0)stack.length=i;}
 else if(token.startsWith('<')){const tag=token.match(/^<([^\s/>]+)/)?.[1];if(!tag)continue;const attrs={};const tail=token.slice(tag.length+1,token.endsWith('/>')?-2:-1);const regex=/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g;let m;while((m=regex.exec(tail)))attrs[m[1]]=m[2]??m[3]??m[4]??'';const el=new Element(tag,attrs);stack.at(-1).append(el);if(!voids.has(tag)&&!token.endsWith('/>'))stack.push(el);}
 else stack.at(-1)._text+=token;
 }
 doc.body=doc.querySelector('body');doc.visibilityState='visible';doc.activeElement=doc.body;
 doc.getElementById=id=>doc.querySelector('#'+id);doc.createElement=tag=>new Element(tag);
 activeDocument=doc;
 const win=new Target();
 return {document:doc,window:win,Element,Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},key:(key,target=doc.body)=>doc.dispatchEvent({type:'keydown',key,target,repeat:false})};
}
export async function until(check,label='condition'){
 for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}
 throw new Error('Timed out waiting for '+label);
}
