import test from 'node:test';
import assert from 'node:assert/strict';
// A minimal host exercises module mounting, view generation and event/state wiring.
// This is deliberately NOT a browser, CSS, keyboard or layout test.
const handlers={},windowHandlers={},nodes={};
const element=()=>({innerHTML:'',textContent:'',open:false,className:'',style:{},classList:{add(){},remove(){}},addEventListener(){},showModal(){this.open=true},close(){this.open=false},focus(){},scrollTo(){},scrollIntoView(){},click(){},querySelector(s){return nodes[s]||(nodes[s]=element())}});
for(const id of ['#app','#modal','#toast','#main'])nodes[id]=element();
const disk={data:{},getItem(k){return this.data[k]||null},setItem(k,v){this.data[k]=v}};
globalThis.document={querySelector:s=>nodes[s]||(nodes[s]=element()),addEventListener:(n,fn)=>handlers[n]=fn,body:{style:{}},createElement:element};
let hash='';globalThis.location={origin:'http://refluenz.test',pathname:'/app.html',search:'',get hash(){return hash},set hash(v){hash=v.startsWith('#')?v:'#'+v;windowHandlers.hashchange?.()}};
globalThis.window={localStorage:disk,addEventListener:(n,fn)=>windowHandlers[n]=fn,scrollTo(){},confirm:()=>true};
globalThis.history={replaceState(){}};
const OriginalFormData=globalThis.FormData;
globalThis.FormData=class{constructor(form){this.values=form.values||{}}*[Symbol.iterator](){yield*Object.entries(this.values)}};
const {handleAction}=await import('../src/platform.js');
const state=()=>JSON.parse(disk.data['refluenz.atelier.v1']);
const html=()=>nodes['#app'].innerHTML;
function submit(name,values,intent){const form={dataset:{form:name},values};handlers.submit({target:{closest:()=>form},preventDefault(){},submitter:{value:intent}})}
test('all seven views render and member events update the rendered state',async()=>{
 assert.match(html(),/Your daily edit/);
 for(const route of ['discover','archive','circle','memberships','settings','studio','atelier']){location.hash=route;assert.match(html(),/<main/);assert.ok(html().length>4000)}
 await handleAction('save','p1');assert.ok(state().saved.includes('p1'));location.hash='archive';assert.match(html(),/The pieces you return to/);
 await handleAction('follow','julian');assert.ok(state().following.includes('julian'));
 submit('search',{query:'nonexistent-creator'});assert.match(html(),/No matches this time/);
 await handleAction('clear-search');assert.match(html(),/Elena Voss/);
 await handleAction('read','p4');assert.match(nodes['#modal'].innerHTML,/There’s more inside/);
 await handleAction('membership','elena');await handleAction('select-tier','premium');await handleAction('activate-membership','elena');
 await handleAction('read','p4');assert.doesNotMatch(nodes['#modal'].innerHTML,/There’s more inside/);
 await handleAction('close');location.hash='circle';submit('message',{text:'A test question for Elena.'});assert.match(html(),/A test question for Elena/);
 location.hash='settings';submit('profile',{name:'<script>alert(1)</script>',bio:'A point of view.'});assert.doesNotMatch(html(),/<script>alert/);assert.match(html(),/&lt;script&gt;/);
});
test('creator form saves drafts, publishes to the member feed and broadcasts locally',async()=>{
 await handleAction('role','creator');assert.match(html(),/Inside your studio/);
 await handleAction('new-entry');
 nodes.form={values:{title:'An integration study',subtitle:'From studio to circle.',body:'A complete original reflection written to test the creator publishing workflow end to end.',category:'Style',access:'public',image:'atelier',format:'Essay'}};
 submit('entry',{},'draft');const id=state().entries.find(p=>p.title==='An integration study').id;assert.equal(state().entries.find(p=>p.id===id).status,'draft');assert.match(html(),/An integration study/);
 await handleAction('edit',id);submit('entry',{},'published');assert.equal(state().entries.find(p=>p.id===id).status,'published');
 await handleAction('broadcast');submit('broadcast',{text:'A new entry is in the atelier.'});assert.equal(state().messages.at(-1).from,'creator');
 await handleAction('role','member');assert.match(html(),/An integration study/);
 await handleAction('role','creator');await handleAction('delete-entry',id);await handleAction('confirm-delete',id);assert.equal(state().entries.some(p=>p.id===id),false);
 globalThis.FormData=OriginalFormData;
});
