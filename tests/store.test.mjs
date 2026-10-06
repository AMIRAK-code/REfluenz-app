import test from 'node:test';
import assert from 'node:assert/strict';
import { canRead, validateEntry, validateAtelier, escapeHTML, csvCell, membershipTotal, toggle, kinds, formats, defaultFormat } from '../src/store.js';

const tiers=[{id:'essential',price:9,level:1},{id:'premium',price:19,level:2},{id:'signature',price:39,level:3}];
const state=(memberships={},myCreator=null)=>({tiers,memberships,myCreator});
const entry={id:'e',creatorId:'elena',access:'premium'};

test('tier access follows the level ladder per creator',()=>{
 assert.equal(canRead({...entry,access:'public'},state()),true);
 assert.equal(canRead(entry,state()),false);
 assert.equal(canRead(entry,state({elena:'essential'})),false);
 assert.equal(canRead(entry,state({elena:'premium'})),true);
 assert.equal(canRead(entry,state({elena:'signature'})),true);
 assert.equal(canRead(entry,state({sera:'signature'})),false);
 assert.equal(canRead({...entry,access:'unknown'},state({elena:'signature'})),false);
 assert.equal(canRead(entry,state({},{id:'elena'})),true,'creators always read their own entries');
});
test('entries are validated and reading time is derived',()=>{
 const ok={title:'  A study  ',subtitle:'',body:'word '.repeat(450),access:'premium',category:'Style',image:'atelier',format:'Nope'};
 const v=validateEntry(ok,tiers);assert.equal(v.title,'A study');assert.equal(v.kind,'text');assert.equal(v.format,'Essay');assert.equal(v.minutes,3);
 assert.throws(()=>validateEntry({...ok,title:'ab'},tiers),/title/);
 assert.throws(()=>validateEntry({...ok,body:'short'},tiers),/30 and 20,000/);
 assert.throws(()=>validateEntry({...ok,access:'vip'},tiers),/access/);
 assert.throws(()=>validateEntry({...ok,image:'javascript:alert(1)'},tiers),/cover/);
 assert.throws(()=>validateEntry({...ok,category:'Food'},tiers),/category/);
});
test('image and video entries need no body and default to their own format',()=>{
 const base={title:'Two rooms',subtitle:'',body:'',access:'public',category:'Design',image:'atelier'};
 assert.deepEqual(kinds,['text','image','video']);assert.ok(formats.includes('Gallery')&&formats.includes('Film'));assert.deepEqual(defaultFormat,{text:'Essay',image:'Gallery',video:'Film'});
 const image=validateEntry({...base,kind:'image'},tiers);assert.equal(image.kind,'image');assert.equal(image.body,'');assert.equal(image.format,'Gallery');assert.equal(image.minutes,1);
 assert.equal(validateEntry({...base,kind:'video',format:'Nope'},tiers).format,'Film');
 assert.equal(validateEntry({...base,kind:'video',body:'  A caption.  '},tiers).body,'A caption.');
 assert.equal(validateEntry({...base,kind:'video',format:'Essay'},tiers).format,'Essay','any known format may be chosen');
 assert.equal(validateEntry({...base,kind:'image',format:'Film'},tiers).format,'Film');
 assert.equal(validateEntry({...base,body:'word '.repeat(10),format:'Gallery'},tiers).format,'Gallery','formats are not tied to a kind');
 assert.equal(validateEntry({...base,kind:'image',body:'x'.repeat(20000)},tiers).kind,'image');
 assert.throws(()=>validateEntry({...base,kind:'image',body:'x'.repeat(20001)},tiers),/caption/);
 assert.throws(()=>validateEntry({...base,kind:'audio'},tiers),/post type/);
});
test('text entries stay strict and the shared rules apply to every kind',()=>{
 const base={title:'A study',subtitle:'',body:'',access:'public',category:'Design',image:'atelier'};
 assert.throws(()=>validateEntry(base,tiers),/30 and 20,000/,'kind defaults to text');
 assert.throws(()=>validateEntry({...base,kind:'text',body:'short'},tiers),/30 and 20,000/);
 assert.equal(validateEntry({...base,kind:'',body:'word '.repeat(10)},tiers).kind,'text');
 for(const kind of ['text','image','video']){
  const ok={...base,kind,body:'word '.repeat(10)};
  assert.throws(()=>validateEntry({...ok,title:'ab'},tiers),/title/,kind);
  assert.throws(()=>validateEntry({...ok,subtitle:'s'.repeat(181)},tiers),/introduction/,kind);
  assert.throws(()=>validateEntry({...ok,access:'vip'},tiers),/access/,kind);
  assert.throws(()=>validateEntry({...ok,category:'Food'},tiers),/category/,kind);
  assert.throws(()=>validateEntry({...ok,image:'javascript:alert(1)'},tiers),/cover/,kind);
 }
});
test('ateliers are validated and trimmed',()=>{
 const v=validateAtelier({name:' Aria ',category:'Design',image:'ritual',descriptor:'x'.repeat(90)});
 assert.equal(v.name,'Aria');assert.equal(v.descriptor.length,60);assert.equal(v.bio,'');
 assert.throws(()=>validateAtelier({name:'A',category:'Design',image:'ritual'}),/name/);
 assert.throws(()=>validateAtelier({name:'Aria',category:'Design',image:'other'}),/cover/);
});
test('escaping, CSV safety and totals',()=>{
 assert.equal(escapeHTML(`<a href="x">'&`),'&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
 assert.equal(csvCell('=SUM(A1)'),`"'=SUM(A1)"`);assert.equal(csvCell('say "hi"'),'"say ""hi"""');
 assert.equal(membershipTotal(state({a:'essential',b:'signature',c:'gone'})),48);
 const list=['a'];toggle(list,'b');toggle(list,'a');assert.deepEqual(list,['b']);
});
