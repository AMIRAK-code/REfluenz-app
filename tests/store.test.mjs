import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, seedEntries } from '../src/data.js';
import { createStore, STORAGE_KEY, canRead, validateEntry, escapeHTML, membershipTotal, csvCell, toggle } from '../src/store.js';
const memory = (seed = {}) => ({data:{...seed}, getItem(k){return this.data[k] ?? null}, setItem(k,v){this.data[k]=v}});
test('creator membership gates are hierarchical and scoped to the correct creator',()=>{
 const s=initialState(),note=seedEntries.find(e=>e.id==='p4');
 assert.equal(canRead(note,s),false);s.memberships.sera='signature';assert.equal(canRead(note,s),false);
 s.memberships.elena='essential';assert.equal(canRead(note,s),false);s.memberships.elena='premium';assert.equal(canRead(note,s),true);
 s.memberships.elena='signature';assert.equal(canRead(note,s),true);delete s.memberships.elena;assert.equal(canRead(note,s),false);
 assert.equal(canRead(seedEntries[0],s),true);assert.equal(canRead({...note,access:'invalid'},s),false);
});
test('member changes persist across a new store session',()=>{
 const disk=memory(),s=createStore(disk);s.update(v=>{toggle(v.saved,'p1');v.memberships.elena='premium';v.profile.name='Parsa';v.preferences.compact=true;v.messages.push({id:'m2',creatorId:'elena',from:'member',text:'A thoughtful question.',date:new Date().toISOString()})});
 const restored=createStore(disk);assert.equal(restored.warning,'');assert.deepEqual(restored.state.saved,['p1']);assert.equal(restored.state.profile.name,'Parsa');assert.equal(restored.state.preferences.compact,true);assert.equal(membershipTotal(restored.state),19);assert.equal(restored.state.messages.at(-1).text,'A thoughtful question.');
});
test('storage failure is atomic and never reports a saved mutation',()=>{
 const s=createStore({getItem(){return null},setItem(){throw Error('QuotaExceededError')}});
 assert.throws(()=>s.update(v=>v.saved.push('p1')),/could not save/);assert.deepEqual(s.state.saved,[]);assert.throws(()=>s.reset(),/could not reset/);
});
test('corrupt or invalid saved content recovers to a safe fresh demo',()=>{
 const disk=memory({[STORAGE_KEY]:'{broken'}),s=createStore(disk);assert.match(s.warning,/could not be loaded/);assert.equal(s.state.entries.length,6);s.reset();assert.equal(s.warning,'');
 const bad=initialState();bad.entries[0].image='javascript:alert(1)';assert.match(createStore(memory({[STORAGE_KEY]:JSON.stringify(bad)})).warning,/could not be loaded/);
});
test('invalid membership and preference data cannot break a restored view',()=>{
 const s=initialState();s.memberships={elena:'unknown',attacker:'premium',sera:'essential'};s.preferences=null;s.following=['elena','elena','unknown'];
 const restored=createStore(memory({[STORAGE_KEY]:JSON.stringify(s)})).state;
 assert.deepEqual(restored.memberships,{sera:'essential'});assert.equal(restored.preferences.compact,false);assert.deepEqual(restored.following,['elena']);
});
test('draft, publish, edit and delete survive reload without resurrecting deleted work',()=>{
 const disk=memory(),s=createStore(disk);const p={...validateEntry({title:'A new perspective',body:'An original reflection with enough words for an entry in the atelier.',subtitle:'A short introduction',category:'Style',access:'public',image:'atelier'}),id:'custom-1',creatorId:'elena',status:'draft',date:new Date().toISOString()};
 s.update(v=>v.entries.push(p));assert.equal(createStore(disk).state.entries.at(-1).status,'draft');
 s.update(v=>{const p=v.entries.at(-1);p.status='published';p.title='A revised perspective'});assert.equal(createStore(disk).state.entries.at(-1).title,'A revised perspective');
 s.update(v=>v.entries=v.entries.filter(p=>p.id!=='custom-1'));assert.equal(createStore(disk).state.entries.some(p=>p.id==='custom-1'),false);
});
test('entry validation bounds content and strips unknown fields',()=>{
 const good={title:'My essay',body:'A sufficiently long entry about a considered wardrobe.',subtitle:'Short',access:'public',category:'Style',image:'atelier',injected:'bad'};
 assert.equal(validateEntry(good).injected,undefined);assert.throws(()=>validateEntry({...good,title:'  '}),/title/);assert.throws(()=>validateEntry({...good,body:'short'}),/30/);assert.throws(()=>validateEntry({...good,access:'admin'}),/access/);
});
test('user HTML is escaped and exported CSV neutralizes formulas',()=>{
 assert.equal(escapeHTML('<img src=x onerror="alert(1)">'),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');assert.equal(csvCell('=SUM(1,2)'),`"'=SUM(1,2)"`);assert.equal(csvCell('a"b'),'"a""b"');
});
