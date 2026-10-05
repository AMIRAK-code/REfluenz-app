import test from 'node:test';
import assert from 'node:assert/strict';
// A minimal host exercises module mounting, view generation and event wiring
// against an in-memory api that mirrors the Supabase access rules.
// This is deliberately NOT a browser, CSS, keyboard or layout test.
const handlers={},windowHandlers={},nodes={};
const element=()=>({innerHTML:'',textContent:'',value:'',open:false,className:'',style:{},dataset:{},classList:{add(){},remove(){}},addEventListener(){},showModal(){this.open=true},close(){this.open=false},focus(){},scrollTo(){},scrollIntoView(){},click(){},select(){},querySelector(s){return nodes[s]||(nodes[s]=element())}});
for(const id of ['#app','#modal','#toast','#main'])nodes[id]=element();
nodes['#message-text']=null;
globalThis.document={querySelector:s=>s==='#message-text'?null:nodes[s]||(nodes[s]=element()),addEventListener:(n,fn)=>handlers[n]=fn,body:{style:{},classList:{add(){},remove(){}}},createElement:element};
let hash='';globalThis.location={origin:'http://refluenz.test',pathname:'/app.html',search:'',get hash(){return hash},set hash(v){hash=v.startsWith('#')?v:'#'+v;windowHandlers.hashchange?.()}};
globalThis.window={addEventListener:(n,fn)=>windowHandlers[n]=fn,scrollTo(){},confirm:()=>true};
globalThis.history={replaceState(){}};
globalThis.FormData=class{constructor(form){this.values=form.values||{}}*[Symbol.iterator](){yield*Object.entries(this.values)}};

const tiers=[{id:'essential',name:'Essential',price:9,level:1,description:'',features:[]},{id:'premium',name:'Premium',price:19,level:2,description:'',features:[]},{id:'signature',name:'Signature',price:39,level:3,description:'',features:[]}];
const level=id=>tiers.find(t=>t.id===id)?.level??0;
const me='user-1';
const db={
  profile:{name:'Aria Bennett',bio:'',compact:false,welcome:false},
  creators:[{id:'c-elena',slug:'elena',ownerId:null,name:'Elena Voss',initials:'EV',category:'Style',descriptor:'Style & culture',location:'Paris',image:'atelier',bio:'A wardrobe as a point of view.'},{id:'c-julian',slug:'julian',ownerId:null,name:'Julian Dax',initials:'JD',category:'Design',descriptor:'Architecture',location:'Lisbon',image:'architecture',bio:'Spaces.'}],
  entries:[{id:'e1',creatorId:'c-elena',title:'The pieces you return to.',subtitle:'On a personal uniform.',excerpt:'Opening paragraph.',category:'Style',format:'Essay',image:'atelier',minutes:2,access:'public',status:'published',date:'2026-09-30T09:00:00Z'},{id:'e2',creatorId:'c-elena',title:'The silhouette study.',subtitle:'Three proportions.',excerpt:'Before colour there is shape.',category:'Style',format:'Guide',image:'atelier',minutes:1,access:'premium',status:'published',date:'2026-09-27T09:00:00Z'}],
  bodies:{e1:'Opening paragraph.\n\nThe full public text.',e2:'Before colour there is shape.\n\nThe premium remainder.'},
  follows:[],bookmarks:[],likes:[],memberships:{},messages:[],notes:[]
};
const mineCreator=()=>db.creators.find(c=>c.ownerId===me)||null;
const api={
  onAuthChange(fn){setTimeout(()=>fn('INITIAL_SESSION',{user:{id:me,email:'aria@example.com'}}),0)},
  async signOut(){},
  async load(){const own=mineCreator();return structuredClone({profile:{name:db.profile.name,bio:db.profile.bio},preferences:{compact:db.profile.compact},welcomeDismissed:db.profile.welcome,tiers,creators:db.creators,myCreator:own,entries:db.entries.filter(e=>e.status==='published'||e.creatorId===own?.id),following:db.follows,saved:db.bookmarks,liked:db.likes,memberships:db.memberships,messages:db.messages,notes:db.notes})},
  async body(id){const e=db.entries.find(x=>x.id===id),own=mineCreator()?.id===e.creatorId;return own||(e.status==='published'&&(e.access==='public'||level(db.memberships[e.creatorId])>=level(e.access)))?db.bodies[id]:null},
  async setFollow(id,on){db.follows=on?[...db.follows,id]:db.follows.filter(x=>x!==id)},
  async setBookmark(id,on){db.bookmarks=on?[...db.bookmarks,id]:db.bookmarks.filter(x=>x!==id)},
  async setLike(id,on){db.likes=on?[...db.likes,id]:db.likes.filter(x=>x!==id)},
  async joinCircle(id,tier){db.memberships[id]=tier},
  async leaveCircle(id){delete db.memberships[id]},
  async sendMessage(creatorId,memberId,from,text){db.messages.push({id:String(db.messages.length),creatorId,memberId,memberName:db.profile.name,from,text,date:new Date().toISOString()})},
  async saveProfile({name,bio,compact}){Object.assign(db.profile,{name,bio,compact})},
  async dismissWelcome(){db.profile.welcome=true},
  async saveAtelier(v,id){if(id)Object.assign(db.creators.find(c=>c.id===id),v);else db.creators.push({...v,id:'c-mine',slug:'mine',ownerId:me,initials:'AB'})},
  async saveEntry(id,v,status){const own=mineCreator();if(!own)throw Error('Open your atelier before writing an entry.');const eid=id||'e'+(db.entries.length+1);const at=db.entries.findIndex(e=>e.id===eid);const row={...v,id:eid,creatorId:own.id,status,excerpt:v.body.split('\n\n')[0],date:new Date().toISOString()};delete row.body;if(at<0)db.entries.unshift(row);else db.entries[at]=row;db.bodies[eid]=v.body;return eid},
  async deleteEntry(id){db.entries=db.entries.filter(e=>e.id!==id)},
  async postNote(creatorId,text){db.notes.push({id:'n'+db.notes.length,creatorId,text,date:new Date().toISOString()})},
  async circleMembers(){return []},
  subscribe(){}
};
const storage={data:{},getItem(k){return this.data[k]??null},setItem(k,v){this.data[k]=v}};
const {mount}=await import('../src/platform.js');
const {handleAction}=mount(api,{storage});
await new Promise(r=>setTimeout(r,10));
const html=()=>nodes['#app'].innerHTML;
const dialog=()=>nodes['#modal'].innerHTML;
function submit(name,values,intent){const form={dataset:{form:name},values};return handlers.submit({target:{closest:()=>form},preventDefault(){},submitter:{value:intent}})}

test('member views render from the api and member actions persist through it',async()=>{
 assert.match(html(),/Your daily edit/);
 for(const route of ['discover','archive','circle','memberships','settings','studio','atelier']){location.hash=route;assert.match(html(),/<main/);assert.ok(html().length>3000,route)}
 await handleAction('save','e1');assert.deepEqual(db.bookmarks,['e1']);location.hash='archive';assert.match(html(),/The pieces you return to/);
 await handleAction('follow','c-julian');assert.ok(db.follows.includes('c-julian'));
 await submit('search',{query:'nonexistent-creator'});assert.match(html(),/No matches this time/);
 await handleAction('clear-search');assert.match(html(),/Elena Voss/);
 await handleAction('read','e2');assert.match(dialog(),/There’s more inside/);assert.doesNotMatch(dialog(),/premium remainder/);
 await handleAction('membership','c-elena');await handleAction('select-tier','premium');await handleAction('activate-membership','c-elena');
 assert.equal(db.memberships['c-elena'],'premium');assert.ok(db.follows.includes('c-elena'));
 await handleAction('read','e2');assert.doesNotMatch(dialog(),/There’s more inside/);assert.match(dialog(),/premium remainder/);
 await handleAction('close');location.hash='circle';await handleAction('contact','c-elena');await submit('message',{text:'A test question for Elena.'});
 assert.equal(db.messages.at(-1).from,'member');assert.match(html(),/A test question for Elena/);
 location.hash='settings';await submit('profile',{name:'<script>alert(1)</script>',bio:'A point of view.'});assert.doesNotMatch(html(),/<script>alert/);assert.match(html(),/&lt;script&gt;/);
});
test('a member opens an atelier, drafts, publishes, notes and deletes',async()=>{
 await handleAction('role','creator');assert.match(html(),/Open your atelier/);
 await submit('atelier',{name:'Aria Studio',category:'Design',image:'ritual',descriptor:'Objects',location:'Rome',bio:'Notes.'});
 assert.ok(mineCreator());assert.match(html(),/Inside your studio/);
 await handleAction('new-entry');
 nodes.form={values:{title:'An integration study',subtitle:'From studio to circle.',body:'A complete original reflection written to test the creator publishing workflow end to end.',category:'Design',access:'essential',image:'atelier',format:'Essay'}};
 await submit('entry',{},'draft');const e=db.entries.find(p=>p.title==='An integration study');assert.equal(e.status,'draft');assert.match(html(),/An integration study/);
 await handleAction('edit',e.id);await submit('entry',{},'published');assert.equal(db.entries.find(p=>p.id===e.id).status,'published');
 await handleAction('broadcast');await submit('broadcast',{text:'A new entry is in the atelier.'});assert.equal(db.notes.at(-1).creatorId,'c-mine');
 await handleAction('role','member');assert.match(html(),/An integration study/);
 await handleAction('role','creator');await handleAction('delete-entry',e.id);await handleAction('confirm-delete',e.id);assert.equal(db.entries.some(p=>p.id===e.id),false);
});
