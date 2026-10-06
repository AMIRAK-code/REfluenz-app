import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
// A minimal host exercises module mounting, view generation and event wiring
// against an in-memory api that mirrors the Supabase access rules.
// This is deliberately NOT a browser, CSS, keyboard or layout test.
const handlers={},windowHandlers={},nodes={},painted={},seenImgs={};   // seenImgs: the <img> object a cover's source was last set on
// Just enough of the DOM: nodes by selector, recorded listeners, and the thumbnails found in rendered markup.
const element=()=>({innerHTML:'',textContent:'',value:'',open:false,disabled:false,className:'',style:{},dataset:{},classList:{add(){},remove(){}},addEventListener(n,fn){(this.listeners??={})[n]=fn},showModal(){this.open=true},close(){this.open=false},focus(){},scrollTo(){},scrollIntoView(){},click(){},select(){},setAttribute(){},contains(){return false},closest(){return null},querySelector(s){return nodes[s]||(nodes[s]=element())},querySelectorAll(s){return s==='img[data-media-thumb]'?[...this.innerHTML.matchAll(/<img[^>]*data-media-thumb="([^"]+)"[^>]*>/g)].map(m=>{const img=Object.assign(element(),{dataset:{mediaThumb:m[1],...(/data-media-ready/.test(m[0])?{mediaReady:'1'}:{})}});let src=/src="([^"]*)"/.exec(m[0])?.[1]||'';return Object.defineProperty(img,'src',{get:()=>src,set:v=>{src=v;painted[m[1]]=v;seenImgs[m[1]]=img}})}):[]}});
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
const row=(id,creatorId,title,extra)=>({id,creatorId,title,subtitle:'',excerpt:'',category:'Design',format:'Essay',image:'architecture',minutes:1,access:'public',status:'published',kind:'text',mediaCount:0,previewUrl:null,duration:null,...extra});
const item=(entryId,id,kind,name,position,extra)=>({id,entryId,kind,path:`c-julian/${entryId}/${name}`,posterPath:null,previewPath:null,mime:kind==='image'?'image/webp':'video/mp4',size:1000,width:null,height:null,duration:null,alt:'',position,...extra});
const db={
  profile:{name:'Aria Bennett',bio:'',compact:false,welcome:false},
  creators:[{id:'c-elena',slug:'elena',ownerId:null,name:'Elena Voss',initials:'EV',category:'Style',descriptor:'Style & culture',location:'Paris',image:'atelier',bio:'A wardrobe as a point of view.'},{id:'c-julian',slug:'julian',ownerId:null,name:'Julian Dax',initials:'JD',category:'Design',descriptor:'Architecture',location:'Lisbon',image:'architecture',bio:'Spaces.'}],
  entries:[{id:'e1',creatorId:'c-elena',title:'The pieces you return to.',subtitle:'On a personal uniform.',excerpt:'Opening paragraph.',category:'Style',format:'Essay',image:'atelier',minutes:2,access:'public',status:'published',date:'2026-09-30T09:00:00Z'},{id:'e2',creatorId:'c-elena',title:'The silhouette study.',subtitle:'Three proportions.',excerpt:'Before colour there is shape.',category:'Style',format:'Guide',image:'atelier',minutes:1,access:'premium',status:'published',date:'2026-09-27T09:00:00Z'},
    row('e3','c-julian','Two rooms in Lisbon',{format:'Gallery',kind:'image',mediaCount:2,previewUrl:'https://preview.test/e3.webp',date:'2026-09-25T09:00:00Z'}),
    row('e4','c-julian','The building site, filmed',{format:'Film',kind:'video',mediaCount:1,duration:92,access:'signature',excerpt:'Opening caption.',previewUrl:'https://preview.test/e4.webp',date:'2026-09-24T09:00:00Z'}),
    row('e5','c-julian','A walk through the studio',{format:'Film',kind:'video',mediaCount:1,duration:65,previewUrl:'https://preview.test/e5.webp',date:'2026-09-23T09:00:00Z'})],
  bodies:{e1:'Opening paragraph.\n\nThe full public text.',e2:'Before colour there is shape.\n\nThe premium remainder.',e3:'A caption for the gallery.',e4:'Opening caption.\n\nThe rest of the caption.',e5:''},
  media:{
    e3:[item('e3','m2','image','b.webp',1,{width:1200,height:800}),item('e3','m1','image','a.webp',0,{width:800,height:600,alt:'First study'})],
    e4:[item('e4','m3','video','site.mp4',0,{posterPath:'c-julian/e4/site-poster.webp',duration:92})],
    e5:[item('e5','m4','video','walk.mp4',0,{posterPath:'c-julian/e5/poster.webp',duration:65})]
  },
  follows:[],bookmarks:[],likes:[],memberships:{},messages:[],notes:[]
};
const mineCreator=()=>db.creators.find(c=>c.ownerId===me)||null;
const canSee=e=>mineCreator()?.id===e.creatorId||(e.status==='published'&&(e.access==='public'||level(db.memberships[e.creatorId])>=level(e.access)));
const calls=[],log=(...a)=>calls.push(a);
let holdMedia=null,failNextUpload=false,failNextRemove=false,failNextSave=false,failSigning=false,mediaSeq=100;
let holdUploadOf='',failUploadOf='',slowRemove=false,failLoads=0;   // a file name to hang on (until cancelled) or to fail (a name or a list), a slow removal, and loads that fail
let lateUploadOf='',lateGate=null;                                   // a file whose upload waits for lateGate (then succeeds)
let holdNextLoad=null,holdNextMembers=null;                          // the next load / member list answers only when this promise resolves (its answer is the data of that moment)
const unsignable=new Set();                                          // object paths that signedUrls leaves out, like a file that is gone
const flight={now:0,peak:0,gate:null};                               // uploads in flight at the same time, and a gate every upload waits for
const authListeners=[];const emitAuth=(event,session)=>authListeners.at(-1)(event,session);
const syncCount=id=>{const e=db.entries.find(x=>x.id===id);if(e)e.mediaCount=(db.media[id]||[]).length};   // what the database trigger does
const api={
  onAuthChange(fn){authListeners.push(fn);setTimeout(()=>fn('INITIAL_SESSION',{user:{id:me,email:'aria@example.com'}}),0)},
  async signOut(){},
  async load(){log('load');const gate=holdNextLoad;holdNextLoad=null;if(failLoads>0){failLoads--;throw Error('We could not reach REFLUENZ. Check your connection and try again.')}const own=mineCreator();const out=structuredClone({profile:{name:db.profile.name,bio:db.profile.bio},preferences:{compact:db.profile.compact},welcomeDismissed:db.profile.welcome,tiers,creators:db.creators,myCreator:own,entries:db.entries.filter(e=>e.status==='published'||e.creatorId===own?.id),following:db.follows,saved:db.bookmarks,liked:db.likes,memberships:db.memberships,messages:db.messages,notes:db.notes});if(gate)await gate;return out},
  async body(id){log('body',id);const e=db.entries.find(x=>x.id===id);return canSee(e)?db.bodies[id]:null},
  async media(ids){log('media',[...ids]);if(holdMedia)await holdMedia;const out={};for(const id of ids){const e=db.entries.find(x=>x.id===id);if(e&&canSee(e))out[id]=structuredClone([...(db.media[id]||[])].sort((a,b)=>a.position-b.position))}return out},
  async signedUrls(paths){log('signedUrls',[...paths]);if(failSigning)throw Error('We could not reach REFLUENZ. Check your connection and try again.');return Object.fromEntries(paths.filter(p=>!unsignable.has(p)).map(p=>[p,`https://signed.test/${p}?token=secret`]))},
  async uploadMedia(entryId,creatorId,prepared,opts={}){
    log('uploadMedia',entryId,prepared.name,opts.position??0,opts.alt??'');
    flight.now++;flight.peak=Math.max(flight.peak,flight.now);
    try{if(flight.gate)await flight.gate;return await storeUpload(entryId,creatorId,prepared,opts)}finally{flight.now--}
  },
  async updateMedia(id,{alt,position}){log('updateMedia',id,alt,position);for(const list of Object.values(db.media)){const m=list.find(x=>x.id===id);if(m)Object.assign(m,{alt,position})}},
  async removeMedia(list){
    // One request for the whole list: the ids, and how many files the entry held at that moment.
    const items=[].concat(list);log('removeMedia',items.map(m=>m.id),(db.media[items[0].entryId]||[]).length);
    if(slowRemove)await new Promise(r=>setTimeout(r,25));
    if(failNextRemove){failNextRemove=false;throw Error('The removal was interrupted.')}
    const entryId=items[0].entryId;
    db.media[entryId]=(db.media[entryId]||[]).filter(x=>!items.some(m=>m.id===x.id));syncCount(entryId);log('removed');
    // The database moves a published image or video entry back to draft when it loses its last file.
    const e=db.entries.find(x=>x.id===entryId);
    if(e&&e.status==='published'&&e.kind!=='text'&&!db.media[entryId].length){e.status='draft';log('autoDraft',e.id)}
  },
  previewUrl(path){return path?`https://preview.test/${path}`:null},
  async setFollow(id,on){db.follows=on?[...db.follows,id]:db.follows.filter(x=>x!==id)},
  async setBookmark(id,on){db.bookmarks=on?[...db.bookmarks,id]:db.bookmarks.filter(x=>x!==id)},
  async setLike(id,on){db.likes=on?[...db.likes,id]:db.likes.filter(x=>x!==id)},
  async joinCircle(id,tier){db.memberships[id]=tier},
  async leaveCircle(id){delete db.memberships[id]},
  async sendMessage(creatorId,memberId,from,text){db.messages.push({id:String(db.messages.length),creatorId,memberId,memberName:db.profile.name,from,text,date:new Date().toISOString()})},
  async saveProfile({name,bio,compact}){Object.assign(db.profile,{name,bio,compact})},
  async dismissWelcome(){db.profile.welcome=true},
  async saveAtelier(v,id){if(id)Object.assign(db.creators.find(c=>c.id===id),v);else db.creators.push({...v,id:'c-mine',slug:'mine',ownerId:me,initials:'AB'})},
  async saveEntry(id,v,status){
    log('saveEntry',id,status,v.kind);
    if(failNextSave){failNextSave=false;throw Error('The save was interrupted.')}
    const own=mineCreator();if(!own)throw Error('Open your atelier before writing an entry.');
    const eid=id||'e'+(db.entries.length+1),at=db.entries.findIndex(e=>e.id===eid),files=db.media[eid]||[];
    // The final shape save_entry enforces when publishing: 1-10 images or exactly one video, never mixed; text has none.
    if(status==='published'){
      const images=files.filter(m=>m.kind==='image').length,videos=files.filter(m=>m.kind==='video').length;
      if(v.kind==='image'&&(images<1||videos>0))throw Error('Add at least one image before publishing.');
      if(v.kind==='image'&&images>10)throw Error('An image entry holds up to 10 images. Remove some before publishing.');
      if(v.kind==='video'&&(videos===0||images>0))throw Error('Add a video before publishing.');
      if(v.kind==='video'&&videos>1)throw Error('Remove the extra video before publishing.');
      if(v.kind==='text'&&files.length)throw Error('Remove the attached media or switch the post type.');
    }
    const next={...v,id:eid,creatorId:own.id,status,excerpt:v.body.split('\n\n')[0],date:new Date().toISOString(),mediaCount:files.length,previewUrl:files.length?`https://preview.test/${eid}.webp`:null,duration:files.find(m=>m.kind==='video')?.duration??null};delete next.body;
    if(at<0)db.entries.unshift(next);else db.entries[at]=next;db.bodies[eid]=v.body;return eid;
  },
  async deleteEntry(id){db.entries=db.entries.filter(e=>e.id!==id);delete db.media[id]},
  async postNote(creatorId,text){db.notes.push({id:'n'+db.notes.length,creatorId,text,date:new Date().toISOString()})},
  async circleMembers(){const gate=holdNextMembers;holdNextMembers=null;if(gate){await gate;return [{name:'Old member',tier:'essential',joined:'2026-01-01T00:00:00Z'}]}return []},
  subscribe(){}
};
async function storeUpload(entryId,creatorId,prepared,{position=0,alt='',onProgress,signal}={}){
  // The upload of this file hangs until the creator cancels it (the real api rejects with the same words when its signal is aborted).
  if(holdUploadOf&&prepared.name===holdUploadOf)await new Promise((resolve,reject)=>{const stop=()=>reject(Error('Upload cancelled.'));if(signal?.aborted)return stop();signal?.addEventListener('abort',stop,{once:true})});
  if(lateUploadOf&&prepared.name===lateUploadOf&&lateGate)await lateGate;
  const doomed=[].concat(failUploadOf||[]);
  if(doomed.includes(prepared.name)){failUploadOf=doomed.filter(n=>n!==prepared.name);throw Error('The upload was interrupted.')}
  if(failNextUpload){failNextUpload=false;throw Error('The upload was interrupted.')}
  // The insert guard of the database: the transient surplus is 20 images or 2 videos, never more.
  const have=db.media[entryId]||[];
  if(prepared.kind==='video'&&have.filter(m=>m.kind==='video').length>=2)throw Error('Remove the previous video before adding another.');
  if(prepared.kind==='image'&&have.filter(m=>m.kind==='image').length>=20)throw Error('Remove some images before adding more.');
  onProgress?.(.5);onProgress?.(1);
  const m={id:`m${++mediaSeq}`,entryId,kind:prepared.kind,path:`${creatorId}/${entryId}/${prepared.name}`,posterPath:prepared.poster?`${creatorId}/${entryId}/poster-${prepared.name}`:null,previewPath:null,mime:prepared.mime,size:prepared.size,width:prepared.width,height:prepared.height,duration:prepared.duration,alt,position};
  (db.media[entryId]??=[]).push(m);syncCount(entryId);return structuredClone(m);
}
// Stands in for src/media.js, which needs a real browser to resize images and read video.
const fakeMedia={
  LIMITS:{maxImages:10,maxImageInputBytes:25*1048576,maxVideoBytes:50*1048576,imageTypes:['image/jpeg','image/png','image/webp','image/gif'],videoTypes:['video/mp4','video/webm','video/quicktime']},
  classify:f=>/^image\//.test(f.type)?'image':/^video\//.test(f.type)?'video':null,
  validateFiles(kind,files,existing=0){
    for(const f of files)if(fakeMedia.classify(f)!==kind)throw Error(`${f.name} is not ${kind==='image'?'an image':'a video'}.`);
    if(kind==='video'&&(files.length>1||existing))throw Error('A post holds exactly one video.');
    if(kind==='image'&&existing+files.length>10)throw Error('A post holds up to 10 images.');
  },
  async prepareImage(f){log('prepareImage',f.name);if(f.name==='unreadable.jpg')throw Error('This picture could not be read.');return{kind:'image',blob:f,mime:'image/webp',ext:'webp',size:f.size,width:640,height:480,duration:null,poster:null,preview:new Blob(['p']),name:f.name.replace(/\.\w+$/,'')+'.webp'}},
  async prepareVideo(f){log('prepareVideo',f.name);return{kind:'video',blob:f,mime:f.type,ext:'mp4',size:f.size,width:1280,height:720,duration:92,poster:new Blob(['p']),preview:new Blob(['p']),name:f.name}},
  formatDuration:s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`
};
const storage={data:{},getItem(k){return this.data[k]??null},setItem(k,v){this.data[k]=v}};
const {mount}=await import('../src/platform.js');
const {handleAction}=mount(api,{storage,media:fakeMedia});
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

// --- Post formats ------------------------------------------------------------
// Each test mounts a fresh view, so caches and editor state never leak between them.
async function boot(role,mediaImpl=fakeMedia){
 storage.setItem('refluenz.role',role);
 const app=mount(api,{storage,media:mediaImpl});
 await new Promise(r=>setTimeout(r,10));
 return app;
}
const file=(name,type,body='x')=>new File([body],name,{type});
const cardOf=title=>html().split('<article class="entry-card">').find(c=>c.includes(title));
const mediaHtml=()=>nodes['#editor-media'].innerHTML;
const keys=markup=>[...markup.matchAll(/data-alt="(m\d+)"/g)].map(m=>m[1]);
const flow=names=>calls.filter(c=>names.includes(c[0]));
const pick=files=>handlers.change({target:{id:'entry-files',files,value:'x'}});

test('image and video entries render with badges and their thumbnails load after render',async()=>{
 let release;holdMedia=new Promise(r=>release=r);calls.length=0;for(const id of Object.keys(painted))delete painted[id];
 const {hydrateMedia,render}=await boot('member');
 location.hash='atelier';
 // Before the signed thumbnails arrive the public blurred preview stands in.
 const gallery=cardOf('Two rooms in Lisbon');
 assert.match(gallery,/class="kind-badge" aria-hidden="true">[\s\S]*?<span>2<\/span>/);
 assert.match(gallery,/Gallery · 2 images/);assert.match(gallery,/entry-cover is-preview/);assert.match(gallery,/preview\.test\/e3\.webp/);assert.match(gallery,/data-media-thumb="e3"/);
 const film=cardOf('A walk through the studio');
 assert.match(film,/class="kind-badge" aria-hidden="true">[\s\S]*?<span>1:05<\/span>/);assert.match(film,/Film · 1:05/);
 assert.doesNotMatch(cardOf('The silhouette study'),/kind-badge/);
 // A locked film shows only the public preview and is never hydrated.
 const locked=cardOf('The building site, filmed');
 assert.match(locked,/entry-cover is-preview/);assert.match(locked,/preview\.test\/e4\.webp/);assert.doesNotMatch(locked,/data-media-thumb/);assert.match(locked,/<span>1:32<\/span>/);
 release();holdMedia=null;await hydrateMedia();
 assert.deepEqual(flow(['media']),[['media',['e3','e5']]],'one batched call, locked entries left out');
 assert.deepEqual(flow(['signedUrls'])[0][1],['c-julian/e3/a.webp','c-julian/e5/poster.webp'],'first image and the video poster, in position order');
 assert.deepEqual(painted,{e3:'https://signed.test/c-julian/e3/a.webp?token=secret',e5:'https://signed.test/c-julian/e5/poster.webp?token=secret'});
 render();// A cached URL is used straight away, with no second lookup.
 assert.match(cardOf('Two rooms in Lisbon'),/src="https:\/\/signed\.test\/c-julian\/e3\/a\.webp\?token=secret"[^>]*data-media-ready="1"/);assert.doesNotMatch(cardOf('Two rooms in Lisbon'),/is-preview/);
 await hydrateMedia();assert.equal(flow(['media']).length,1);
});

test('readers get a gallery or a player, and a locked film never reaches the markup',async()=>{
 const {handleAction}=await boot('member');
 await handleAction('read','e3');
 assert.match(dialog(),/<figure class="reader-figure"><img src="https:\/\/signed\.test\/c-julian\/e3\/a\.webp\?token=secret" alt="First study" loading="lazy" width="800" height="600"><\/figure>/);
 assert.match(dialog(),/alt="Two rooms in Lisbon, image 2"/);assert.match(dialog(),/A caption for the gallery\./);assert.match(dialog(),/By Julian Dax · [^·]+ · 2 images/);
 assert.ok(dialog().indexOf('a.webp')<dialog().indexOf('b.webp'),'sorted by position');
 await handleAction('read','e5');
 assert.match(dialog(),/<video class="reader-video" controls preload="metadata" playsinline aria-label="A walk through the studio, video" src="https:\/\/signed\.test\/c-julian\/e5\/walk\.mp4\?token=secret" poster="https:\/\/signed\.test\/c-julian\/e5\/poster\.webp\?token=secret"><\/video>/);
 assert.doesNotMatch(dialog(),/reader-body/,'an empty caption leaves no empty block');
 calls.length=0;
 await handleAction('read','e4');
 const locked=dialog();
 assert.match(locked,/There’s more inside/);assert.match(locked,/reader-preview is-preview/);assert.match(locked,/preview\.test\/e4\.webp/);assert.match(locked,/Opening caption\./);
 assert.doesNotMatch(locked,/signed\.test|token=|site\.mp4|<video|<figure|rest of the caption/);
 assert.deepEqual(flow(['media','signedUrls']),[],'no media was even requested');
});

test('publishing an image post saves a draft, uploads in order, then publishes',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');await handleAction('kind','image');
 assert.equal(nodes['#entry-body-label'].textContent,'Caption (optional)');assert.equal(nodes['#entry-body'].required,false);assert.equal(nodes['#entry-files'].multiple,true);
 assert.match(nodes['#editor-kind'].innerHTML,/class="active" data-action="kind" data-id="image" aria-pressed="true"/);assert.match(mediaHtml(),/Add images/);
 pick([file('first.jpg','image/jpeg'),file('second.png','image/png','xx')]);
 assert.match(mediaHtml(),/Images <span>2 of 10<\/span>/);
 const [k1,k2]=keys(mediaHtml());
 handlers.input({target:{dataset:{alt:k1},value:'A bright room'}});
 await handleAction('media-later',k1);// first.jpg is now second
 assert.deepEqual(keys(mediaHtml()),[k2,k1]);
 nodes.form={values:{title:'Two rooms',subtitle:'',body:'',category:'Design',access:'public',image:'atelier',format:'Gallery'}};
 calls.length=0;
 await submit('entry',{},'published');
 const steps=flow(['saveEntry','uploadMedia','updateMedia','removeMedia']);
 assert.deepEqual(steps.map(c=>c[0]),['saveEntry','uploadMedia','uploadMedia','saveEntry']);
 const [draft,u1,u2,final]=steps,saved=db.entries.find(e=>e.title==='Two rooms');
 assert.deepEqual([draft[1],draft[2],draft[3]],[null,'draft','image']);assert.deepEqual([final[1],final[2],final[3]],[saved.id,'published','image']);
 assert.deepEqual(u1.slice(1),[saved.id,'second.webp',0,'']);assert.deepEqual(u2.slice(1),[saved.id,'first.webp',1,'A bright room']);
 assert.equal(saved.status,'published');assert.equal(saved.kind,'image');assert.equal(saved.mediaCount,2);assert.equal(saved.format,'Gallery');
 assert.equal(nodes['#modal'].open,false);assert.match(html(),/Two rooms/);assert.match(html(),/Gallery · 2 images/);
});

test('a failed upload keeps the draft, so a retry does not create a second one',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');await handleAction('kind','video');
 assert.match(mediaHtml(),/Add a video/);assert.equal(nodes['#entry-files'].multiple,false);assert.equal(nodes['#entry-files'].accept,'video/*');
 pick([file('clip.mp4','video/mp4')]);
 assert.match(mediaHtml(),/<video class="video-preview" controls preload="metadata" playsinline aria-label="Selected video preview" src="blob:/);assert.doesNotMatch(mediaHtml(),/Add a video/,'one video fills the slot');
 nodes.form={values:{title:'A short film',subtitle:'',body:'',category:'Culture',access:'public',image:'atelier',format:'Film'}};
 const before=db.entries.length;calls.length=0;failNextUpload=true;
 await submit('entry',{},'published');
 assert.match(nodes['#entry-error'].textContent,/interrupted/);assert.equal(nodes['#modal'].open,true,'the dialog stays open');
 assert.equal(db.entries.length,before+1);const draft=db.entries[0];assert.equal(draft.status,'draft');assert.equal(draft.kind,'video');
 await submit('entry',{},'published');
 assert.equal(db.entries.length,before+1,'still one entry');assert.equal(nodes['#entry-error'].textContent,'');
 assert.deepEqual(flow(['saveEntry']).map(c=>[c[1]===null,c[2]]),[[true,'draft'],[false,'published']]);
 const done=db.entries.find(e=>e.id===draft.id);assert.equal(done.status,'published');assert.equal(done.duration,92);assert.equal(db.media[draft.id].length,1);assert.equal(nodes['#modal'].open,false);
});

test('the editor explains why the format cannot change while media is attached, and checks files before publishing',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');await handleAction('kind','image');
 pick([file('clip.mp4','video/mp4')]);
 assert.match(nodes['#media-error'].textContent,/not an image/);assert.doesNotMatch(mediaHtml(),/upload-item/);
 pick([file('a.jpg','image/jpeg')]);
 await handleAction('kind','video');
 assert.match(nodes['#media-error'].textContent,/already has images\. Remove them before switching to Video/);assert.match(nodes['#editor-kind'].innerHTML,/data-id="image" aria-pressed="true"/);
 nodes.form={values:{title:'Not yet',subtitle:'',body:'',category:'Design',access:'public',image:'atelier',format:'Gallery'}};
 await handleAction('media-remove',keys(mediaHtml())[0]);
 calls.length=0;await submit('entry',{},'published');
 assert.match(nodes['#entry-error'].textContent,/Add at least one image before publishing/);assert.deepEqual(flow(['saveEntry']),[]);
 await handleAction('kind','video');assert.equal(nodes['#entry-error'].textContent,'');assert.match(mediaHtml(),/Add a video/);
 await handleAction('kind','text');assert.equal(nodes['#entry-body'].required,true);assert.equal(nodes['#entry-body'].minLength,30);assert.equal(mediaHtml(),'');
 // Dropping a file on a text entry switches to its format.
 nodes['#modal'].listeners.drop({preventDefault(){},dataTransfer:{types:['Files'],files:[file('shot.png','image/png')]}});
 assert.match(nodes['#editor-kind'].innerHTML,/data-id="image" aria-pressed="true"/);assert.match(mediaHtml(),/shot\.png/);
 // Drafts may be saved without images.
 await handleAction('media-remove',keys(mediaHtml())[0]);
 calls.length=0;await submit('entry',{},'draft');assert.deepEqual(flow(['saveEntry']).map(c=>[c[1],c[2],c[3]]),[[null,'draft','image']]);
});

test('editing a media entry loads its media, and removing and reordering are saved',async()=>{
 const {handleAction,hydrateMedia}=await boot('creator');
 const id=db.entries.find(e=>e.title==='Two rooms').id;
 location.hash='studio';await hydrateMedia();calls.length=0;
 await handleAction('edit',id);
 assert.deepEqual(flow(['media']),[['media',[id]]]);
 assert.match(dialog(),/data-kind="image"/);assert.match(dialog(),/Caption \(optional\)/);assert.match(dialog(),/<option selected>Gallery<\/option>/);
 assert.match(dialog(),/src="https:\/\/signed\.test\/c-mine\/[^"]*second\.webp\?token=secret"/);
 const [second,first]=keys(dialog());
 assert.match(dialog(),/value="A bright room"/);
 await handleAction('media-remove',second);
 nodes.form={values:{title:'Two rooms',subtitle:'',body:'',category:'Design',access:'public',image:'atelier',format:'Gallery'}};
 calls.length=0;await submit('entry',{},'published');
 assert.deepEqual(flow(['saveEntry','uploadMedia','updateMedia','removeMedia']).map(c=>c[0]),['removeMedia','updateMedia','saveEntry']);
 assert.equal(db.media[id].length,1);assert.equal(db.media[id][0].position,0);assert.equal(db.entries.find(e=>e.id===id).mediaCount,1);
 // The studio row now reads "1 image" and its thumbnail is looked up again.
 assert.match(html(),/1 image/);
});

// --- Save order: upload first, remove afterwards -----------------------------
// The database lets an entry carry up to 20 images or 2 videos while a save runs, so new media is stored before old media is
// removed. Whatever fails, a published entry keeps its files; the final save (which re-checks the final shape) comes last.
const fixture=(id,title,kind,files,body='',extra)=>{
 db.entries.unshift(row(id,'c-mine',title,{format:{text:'Essay',image:'Gallery',video:'Film'}[kind],kind,mediaCount:files.length,date:'2026-10-01T09:00:00Z',...extra}));
 db.bodies[id]=body;db.media[id]=files;
};
const gone=(...ids)=>{db.entries=db.entries.filter(e=>!ids.includes(e.id));for(const id of ids){delete db.media[id];delete db.bodies[id]}};
const movie=(entryId,id,name)=>item(entryId,id,'video',name,0,{path:`c-mine/${entryId}/${name}`,posterPath:`c-mine/${entryId}/${name}-poster.webp`,duration:40});
const still=(entryId,id,name,position)=>item(entryId,id,'image',name,position,{path:`c-mine/${entryId}/${name}`});
// Right after the editor opens its media is inside the dialog markup; once it is redrawn it lives in #editor-media.
const removeKeys=(markup=mediaHtml())=>[...markup.matchAll(/data-action="media-remove" data-id="(m\d+)"/g)].map(m=>m[1]);
const entryValues=(title,format,body='')=>({title,subtitle:'',body,category:'Design',access:'public',image:'atelier',format});
const steps=()=>flow(['saveEntry','prepareVideo','prepareImage','uploadMedia','updateMedia','removeMedia']).map(c=>c[0]);
const stored=id=>db.entries.find(e=>e.id===id);

test('replacing a video uploads the new one first and removes the old one only afterwards',async()=>{
 fixture('x-film','A film to replace','video',[movie('x-film','mx1','old.mp4')]);
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  await handleAction('edit','x-film');
  assert.match(dialog(),/class="video-preview"/);
  await handleAction('media-remove',removeKeys(dialog())[0]);
  assert.match(mediaHtml(),/Add a video/);
  pick([file('new.mp4','video/mp4')]);
  nodes.form={values:entryValues('A film to replace','Film')};
  // The upload is interrupted: nothing was removed, so the published entry still has its video.
  calls.length=0;failNextUpload=true;
  await submit('entry',{},'published');
  assert.deepEqual(steps(),['prepareVideo','uploadMedia']);
  assert.match(nodes['#entry-error'].textContent,/interrupted/);assert.equal(nodes['#modal'].open,true);
  assert.deepEqual(db.media['x-film'].map(m=>m.id),['mx1']);assert.equal(stored('x-film').status,'published');
  // Retrying uploads, then removes, then saves. When the old video goes, the new one is already stored.
  calls.length=0;
  await submit('entry',{},'published');
  assert.deepEqual(steps(),['prepareVideo','uploadMedia','removeMedia','saveEntry']);
  assert.deepEqual(flow(['removeMedia']),[['removeMedia',['mx1'],2]]);
  assert.deepEqual(flow(['autoDraft']),[],'the entry was never without a video');
  assert.deepEqual(db.media['x-film'].map(m=>m.path),['c-mine/x-film/new.mp4']);
  assert.equal(stored('x-film').status,'published');assert.equal(stored('x-film').kind,'video');assert.equal(stored('x-film').mediaCount,1);
  assert.equal(nodes['#modal'].open,false);
 }finally{gone('x-film')}
});

test('swapping images at the ten-image cap stores the new ones before removing the old ones',async()=>{
 fixture('x-set','Ten stills','image',Array.from({length:10},(_,i)=>still('x-set',`ms${i}`,`s${i}.webp`,i)));
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  await handleAction('edit','x-set');
  assert.match(dialog(),/Images <span>10 of 10<\/span>/);assert.doesNotMatch(dialog(),/Add images/,'at the cap, nothing more can be added');
  for(const key of keys(dialog()).slice(0,3))await handleAction('media-remove',key);
  assert.match(mediaHtml(),/Images <span>7 of 10<\/span>/);
  pick([file('n1.png','image/png'),file('n2.png','image/png'),file('n3.png','image/png')]);
  nodes.form={values:entryValues('Ten stills','Gallery')};
  calls.length=0;await submit('entry',{},'published');
  // Two images at a time: the third is prepared once a slot is free. The three old files then go in a single request, together with the reorders.
  assert.match(steps().join(' '),/^prepareImage prepareImage uploadMedia uploadMedia prepareImage uploadMedia removeMedia (updateMedia ){7}saveEntry$/);
  assert.deepEqual(flow(['removeMedia']).map(c=>[c[1].length,c[2]]),[[3,13]],'the old files leave in one request, with all the new ones already stored');
  assert.deepEqual(flow(['autoDraft']),[]);
  assert.equal(db.media['x-set'].length,10);assert.deepEqual(db.media['x-set'].map(m=>m.position).sort((a,b)=>a-b),[0,1,2,3,4,5,6,7,8,9]);
  assert.equal(stored('x-set').status,'published');assert.equal(stored('x-set').mediaCount,10);
 }finally{gone('x-set')}
});

test('switching a published entry from images to a video uploads the video before the images go',async()=>{
 fixture('x-switch','Stills to film','image',[still('x-switch','mw1','a.webp',0)]);
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  await handleAction('edit','x-switch');
  await handleAction('media-remove',keys(dialog())[0]);
  await handleAction('kind','video');
  pick([file('clip.mp4','video/mp4')]);
  nodes.form={values:entryValues('Stills to film','Film')};
  calls.length=0;await submit('entry',{},'published');
  assert.deepEqual(steps(),['prepareVideo','uploadMedia','removeMedia','saveEntry']);
  assert.deepEqual(flow(['removeMedia']),[['removeMedia',['mw1'],2]]);
  assert.deepEqual(flow(['saveEntry']).map(c=>[c[1],c[2],c[3]]),[['x-switch','published','video']]);
  assert.deepEqual(flow(['autoDraft']),[]);
  assert.equal(stored('x-switch').kind,'video');assert.equal(stored('x-switch').status,'published');assert.deepEqual(db.media['x-switch'].map(m=>m.kind),['video']);
 }finally{gone('x-switch')}
});

test('a file uploaded by a failed save and removed again is cleared first, so the new upload still fits',async()=>{
 fixture('x-take','Another take','video',[movie('x-take','mt1','first.mp4')]);
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  await handleAction('edit','x-take');
  await handleAction('media-remove',removeKeys(dialog())[0]);
  pick([file('second.mp4','video/mp4')]);
  nodes.form={values:entryValues('Another take','Film')};
  // The second video is stored, but removing the first fails: the entry now holds both (the most the database allows).
  failNextRemove=true;await submit('entry',{},'published');
  assert.match(nodes['#entry-error'].textContent,/removal was interrupted/);assert.equal(db.media['x-take'].length,2);assert.equal(stored('x-take').status,'published');
  // The creator changes their mind: the second video goes and a third takes its place.
  await handleAction('media-remove',removeKeys()[0]);
  pick([file('third.mp4','video/mp4')]);
  calls.length=0;await submit('entry',{},'published');
  assert.deepEqual(steps(),['removeMedia','prepareVideo','uploadMedia','removeMedia','saveEntry']);
  assert.deepEqual(flow(['removeMedia']).map(c=>[c[1][0]==='mt1'?'original':'stray',c[2]]),[['stray',2],['original',2]],'only the leftover goes before the upload; the original still waits');
  assert.deepEqual(db.media['x-take'].map(m=>m.path),['c-mine/x-take/third.mp4']);assert.equal(stored('x-take').status,'published');assert.equal(nodes['#modal'].open,false);
 }finally{gone('x-take')}
});

test('a lone file from a failed save is never removed before the next upload, so a published entry is not emptied',async()=>{
 fixture('x-lone','A lone film','video',[movie('x-lone','ml1','one.mp4')]);
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  await handleAction('edit','x-lone');
  await handleAction('media-remove',removeKeys(dialog())[0]);
  pick([file('two.mp4','video/mp4')]);
  nodes.form={values:entryValues('A lone film','Film')};
  // The new video is stored and the old one removed, but the final save fails: the entry now holds only the new video.
  failNextSave=true;calls.length=0;await submit('entry',{},'published');
  assert.deepEqual(steps(),['prepareVideo','uploadMedia','removeMedia','saveEntry']);
  assert.match(nodes['#entry-error'].textContent,/save was interrupted/);
  assert.deepEqual(db.media['x-lone'].map(m=>m.path),['c-mine/x-lone/two.mp4']);assert.equal(stored('x-lone').status,'published');
  // The creator replaces it once more. There is room for a second video, so nothing goes first: the third is stored, then the second.
  await handleAction('media-remove',removeKeys()[0]);
  pick([file('three.mp4','video/mp4')]);
  calls.length=0;await submit('entry',{},'published');
  assert.deepEqual(steps(),['prepareVideo','uploadMedia','removeMedia','saveEntry']);
  assert.deepEqual(flow(['removeMedia']).map(c=>c[2]),[2],'the second video leaves only once the third is stored');
  assert.deepEqual(flow(['autoDraft']),[],'the entry was never without a video');
  assert.deepEqual(db.media['x-lone'].map(m=>m.path),['c-mine/x-lone/three.mp4']);assert.equal(stored('x-lone').status,'published');assert.equal(nodes['#modal'].open,false);
 }finally{gone('x-lone')}
});

test('a retry clears only as many leftovers as the headroom needs, and the originals always wait',async()=>{
 fixture('x-ten','Ten again','image',Array.from({length:10},(_,i)=>still('x-ten',`mo${i}`,`o${i}.webp`,i)));
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  await handleAction('edit','x-ten');
  for(const key of keys(dialog()))await handleAction('media-remove',key);
  pick(Array.from({length:10},(_,i)=>file(`n${i}.png`,'image/png')));
  nodes.form={values:entryValues('Ten again','Gallery')};
  // All ten new images are stored (twenty in all, the most the database allows), then the first removal fails.
  failNextRemove=true;await submit('entry',{},'published');
  assert.match(nodes['#entry-error'].textContent,/removal was interrupted/);assert.equal(db.media['x-ten'].length,20);assert.equal(stored('x-ten').status,'published');
  // Two of the new images are dropped and one other is added. Twenty are stored, so exactly one leftover has to go before the upload.
  await handleAction('media-remove',keys(mediaHtml())[0]);await handleAction('media-remove',keys(mediaHtml())[0]);
  pick([file('p1.png','image/png')]);
  calls.length=0;await submit('entry',{},'published');
  assert.deepEqual(steps().slice(0,3),['removeMedia','prepareImage','uploadMedia']);
  const removed=flow(['removeMedia']);
  assert.deepEqual([removed[0][1].length,removed[0][1][0].startsWith('mo'),removed[0][2]],[1,false,20],'only a file this session stored goes early, and only one');
  assert.equal(removed.length,2,'then everything else in one request');assert.deepEqual([removed[1][1].length,removed[1][1].filter(id=>id.startsWith('mo')).length],[11,10],'the ten originals and the other leftover leave afterwards');
  assert.deepEqual(flow(['autoDraft']),[]);
  assert.equal(db.media['x-ten'].length,9);assert.ok(db.media['x-ten'].every(m=>!m.id.startsWith('mo')));
  assert.deepEqual(db.media['x-ten'].map(m=>m.position).sort((a,b)=>a-b),[0,1,2,3,4,5,6,7,8]);assert.equal(stored('x-ten').status,'published');assert.equal(nodes['#modal'].open,false);
 }finally{gone('x-ten')}
});

test('files of the wrong kind left behind by a failed save are cleared by the next one',async()=>{
 fixture('x-text','A text with leftovers','text',[still('x-text','mz1','left.webp',0)],'A complete original reflection, long enough for the thirty character rule.');
 fixture('x-gal','A gallery with a leftover film','image',[still('x-gal','mg1','a.webp',0),still('x-gal','mg2','b.webp',1),movie('x-gal','mg3','extra.mp4')]);
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  // A text entry cannot be published with media attached, and the editor shows none, so the editor removes it.
  await handleAction('edit','x-text');
  assert.match(dialog(),/<div id="editor-media"><\/div>/);
  nodes.form={values:entryValues('A text with leftovers','Essay','A complete original reflection, long enough for the thirty character rule.')};
  calls.length=0;await submit('entry',{},'published');
  assert.deepEqual(steps(),['removeMedia','saveEntry']);assert.deepEqual(db.media['x-text'],[]);assert.equal(stored('x-text').status,'published');
  // A gallery shows its two images; the film of another kind is removed on save.
  await handleAction('edit','x-gal');
  assert.match(dialog(),/Images <span>2 of 10<\/span>/);assert.doesNotMatch(dialog(),/video-preview/);
  nodes.form={values:entryValues('A gallery with a leftover film','Gallery')};
  calls.length=0;await submit('entry',{},'published');
  assert.deepEqual(steps(),['removeMedia','saveEntry']);assert.deepEqual(db.media['x-gal'].map(m=>m.kind),['image','image']);assert.equal(stored('x-gal').status,'published');
  // Cards use the first file of the entry's own kind, not a leftover that sorts earlier.
  db.media['x-gal']=[movie('x-gal','mg4','early.mp4'),still('x-gal','mg5','shot.webp',1)];
  calls.length=0;const view=await boot('creator');await view.hydrateMedia();
  const asked=flow(['signedUrls']).flatMap(c=>c[1]);
  assert.ok(asked.includes('c-mine/x-gal/shot.webp'));assert.ok(!asked.includes('c-mine/x-gal/early.mp4-poster.webp'));
 }finally{gone('x-text','x-gal')}
});

test('media that cannot be signed never blocks reading, editing or browsing',async()=>{
 fixture('x-own','Own gallery','image',[still('x-own','mo1','a.webp',0)]);
 try{
  const {handleAction,hydrateMedia}=await boot('member');
  failSigning=true;
  location.hash='atelier';await hydrateMedia();
  assert.match(cardOf('Two rooms in Lisbon'),/is-preview/,'cards keep the public preview');
  // The caption is the entry: it is shown with a note instead of the gallery, and the next try signs again.
  await handleAction('read','e3');
  assert.match(dialog(),/A caption for the gallery\./);assert.match(dialog(),/could not be loaded/);assert.doesNotMatch(dialog(),/<figure|<img src="https:\/\/signed/);
  await handleAction('read','e5');
  assert.match(dialog(),/could not be loaded/);assert.doesNotMatch(dialog(),/<video/);
  failSigning=false;
  await handleAction('read','e3');
  assert.match(dialog(),/<figure class="reader-figure"><img src="https:\/\/signed\.test\/c-julian\/e3\/a\.webp/);assert.doesNotMatch(dialog(),/could not be loaded/);
  // The editor opens without thumbnails.
  const creator=await boot('creator');location.hash='studio';failSigning=true;
  await creator.handleAction('edit','x-own');
  assert.match(dialog(),/data-kind="image"/);assert.match(dialog(),/upload-item/);assert.doesNotMatch(dialog(),/signed\.test/);
 }finally{failSigning=false;gone('x-own')}
});

test('discover filters entries and creators by format',async()=>{
 await boot('member');
 location.hash='discover';
 assert.match(html(),/<select id="format-filter" aria-label="Filter by type">/);assert.match(html(),/All types/);
 handlers.change({target:{id:'format-filter',value:'video'}});
 assert.match(html(),/A walk through the studio/);assert.match(html(),/The building site, filmed/);assert.match(html(),/A short film/);assert.doesNotMatch(html(),/The pieces you return to|Two rooms in Lisbon|Elena Voss/);
 handlers.change({target:{id:'format-filter',value:'image'}});
 assert.match(html(),/Two rooms in Lisbon/);assert.doesNotMatch(html(),/A walk through the studio|The pieces you return to/);
 handlers.change({target:{id:'format-filter',value:'text'}});
 assert.match(html(),/The pieces you return to/);assert.doesNotMatch(html(),/Two rooms in Lisbon|A walk through the studio/);
 handlers.change({target:{id:'format-filter',value:'all'}});
 assert.match(html(),/The pieces you return to/);assert.match(html(),/Two rooms in Lisbon/);assert.match(html(),/A walk through the studio/);
});

// --- Review follow-ups: cancelling, clean-up, account changes, focus and covers -------------------------------
const wait=(ms=5)=>new Promise(r=>setTimeout(r,ms));
const until=async(check,ms=1000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timed out waiting');await wait(1)}};
const toastText=()=>nodes['#toast'].textContent;
const uploads=()=>flow(['uploadMedia']).map(c=>c[2]);
const asMe=()=>emitAuth('SIGNED_IN',{user:{id:me,email:'aria@example.com'}});

test('a save can be cancelled while a file uploads: the form unlocks, what was stored is kept and Save continues',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');await handleAction('kind','image');
 pick([file('a.jpg','image/jpeg'),file('b.jpg','image/jpeg')]);
 nodes.form={values:entryValues('Cancel me','Gallery')};
 const focused=[];nodes['#editor-status'].focus=()=>focused.push('status');
 holdUploadOf='b.webp';calls.length=0;
 try{
  const saving=submit('entry',{},'published');
  await until(()=>uploads().includes('b.webp'));
  // While it runs: fields locked, Cancel offered, focus on the status line (not on the disabled button), bars named after their file.
  assert.equal(nodes['#editor-fields'].disabled,true);assert.equal(nodes['#editor-cancel'].hidden,false);assert.deepEqual(focused,['status']);
  assert.match(mediaHtml(),/aria-label="Upload progress, b\.jpg"/);assert.match(mediaHtml(),/aria-label="Upload progress, a\.jpg"/);
  // The dialog cannot be closed from under the upload, and says what to do instead.
  await handleAction('close');assert.equal(toastText(),'Still uploading. Use Cancel upload to stop.');assert.equal(nodes['#modal'].open,true);
  await handleAction('cancel-upload');await saving;
  const draft=db.entries[0];
  assert.equal(nodes['#editor-fields'].disabled,false);assert.equal(nodes['#editor-cancel'].hidden,true);assert.equal(nodes['#modal'].open,true);
  assert.equal(nodes['#entry-error'].textContent,'Upload cancelled. Your draft and 1 uploaded file are kept. Press Save draft or Publish to continue.');
  assert.match(mediaHtml(),/upload-item is-failed[\s\S]*Not uploaded\. It will be sent again when you save\./);
  assert.deepEqual([draft.status,db.media[draft.id].length],['draft',1]);
  // Save again: only the file that did not make it is sent, and the final save never ran before.
  holdUploadOf='';calls.length=0;await submit('entry',{},'published');
  assert.deepEqual(uploads(),['b.webp']);assert.equal(stored(draft.id).status,'published');assert.equal(db.media[draft.id].length,2);assert.equal(nodes['#modal'].open,false);
 }finally{holdUploadOf='';nodes['#editor-status'].focus=()=>{}}
});

test('a failed upload names the file and says what happens next, and the focus goes back to the button that was used',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');await handleAction('kind','image');
 pick([file('first.jpg','image/jpeg'),file('second.png','image/png')]);
 nodes.form={values:entryValues('Two with a problem','Gallery')};
 failUploadOf='second.webp';
 const focused=[],form={dataset:{form:'entry'},values:{}};
 await handlers.submit({target:{closest:()=>form},preventDefault(){},submitter:{value:'published',isConnected:true,focus:o=>focused.push(o)}});
 assert.equal(nodes['#entry-error'].textContent,'second.png: The upload was interrupted. Your draft and 1 uploaded file are kept. Press Save draft or Publish to continue.');
 const [first,second]=mediaHtml().split('<li ').slice(1);
 assert.doesNotMatch(first,/is-failed|Not uploaded/);assert.match(second,/is-failed/);assert.match(second,/<p class="upload-status">Not uploaded: The upload was interrupted\. It will be sent again when you save\.<\/p>/,'the file says why it failed');
 assert.deepEqual(focused,[{preventScroll:true}],'the focus is not left on the page body');
 assert.equal(nodes['#modal'].open,true);
 await submit('entry',{},'published');assert.equal(nodes['#modal'].open,false);
});

test('a failed video upload marks the video and keeps the draft',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');await handleAction('kind','video');
 pick([file('clip.mp4','video/mp4')]);
 nodes.form={values:entryValues('A clip that fails','Film')};
 failNextUpload=true;await submit('entry',{},'published');
 assert.equal(nodes['#entry-error'].textContent,'clip.mp4: The upload was interrupted. Your draft is kept. Press Save draft or Publish to continue.');
 assert.match(mediaHtml(),/class="video-field is-failed"/);assert.match(mediaHtml(),/Not uploaded: The upload was interrupted\. It will be sent again when you save\./);
 await handleAction('close');db.entries=db.entries.filter(e=>e.title!=='A clip that fails');
});

test('closing the editor after a failed save removes the files that session uploaded, so the live entry is as it was',async()=>{
 fixture('x-disc','Three stills','image',[still('x-disc','md1','a.webp',0),still('x-disc','md2','b.webp',1),still('x-disc','md3','c.webp',2)]);
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  await handleAction('edit','x-disc');
  pick([file('n1.png','image/png'),file('n2.png','image/png')]);
  nodes.form={values:entryValues('Three stills','Gallery')};
  failUploadOf='n2.webp';await submit('entry',{},'published');
  assert.match(nodes['#entry-error'].textContent,/^n2\.png: The upload was interrupted\. Your draft and 1 uploaded file are kept\. Press Save draft or Update entry to continue\.$/);
  assert.equal(db.media['x-disc'].length,4,'the first new image is already on the live entry');
  calls.length=0;slowRemove=true;
  await handleAction('close');   // the confirm answers yes
  assert.equal(nodes['#modal'].open,false);
  // Opening the editor again waits for the clean-up, so it never lists a file that is on its way out.
  await handleAction('edit','x-disc');
  assert.deepEqual(flow(['removeMedia']).map(c=>c[1].length),[1]);
  assert.deepEqual(db.media['x-disc'].map(m=>m.id).sort(),['md1','md2','md3']);
  assert.match(dialog(),/Images <span>3 of 10<\/span>/);
  assert.equal(stored('x-disc').status,'published');assert.equal(stored('x-disc').mediaCount,3);
 }finally{slowRemove=false;failUploadOf='';gone('x-disc')}
});

test('a lone file stored by a failed save stays when the editor is closed: removing it would unpublish the entry',async()=>{
 fixture('x-solo','A single film','video',[movie('x-solo','ms1','old.mp4')]);
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  await handleAction('edit','x-solo');
  await handleAction('media-remove',removeKeys(dialog())[0]);pick([file('new.mp4','video/mp4')]);
  nodes.form={values:entryValues('A single film','Film')};
  failNextSave=true;await submit('entry',{},'published');
  assert.match(nodes['#entry-error'].textContent,/save was interrupted/);
  assert.deepEqual(db.media['x-solo'].map(m=>m.path),['c-mine/x-solo/new.mp4'],'the old film is gone, the new one is stored');
  calls.length=0;await handleAction('close');await wait(15);
  assert.deepEqual(flow(['removeMedia']),[]);assert.equal(db.media['x-solo'].length,1);assert.equal(stored('x-solo').status,'published');assert.deepEqual(flow(['autoDraft']),[]);
 }finally{gone('x-solo')}
});

test('when the old file could not be removed, closing the editor removes the new one and the entry keeps what it had',async()=>{
 fixture('x-swap','A swapped film','video',[movie('x-swap','mw0','old.mp4')]);
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  await handleAction('edit','x-swap');
  await handleAction('media-remove',removeKeys(dialog())[0]);pick([file('new.mp4','video/mp4')]);
  nodes.form={values:entryValues('A swapped film','Film')};
  failNextRemove=true;await submit('entry',{},'published');
  assert.match(nodes['#entry-error'].textContent,/removal was interrupted/);assert.equal(db.media['x-swap'].length,2);
  await handleAction('close');await wait(15);
  assert.deepEqual(db.media['x-swap'].map(m=>m.id),['mw0']);assert.equal(stored('x-swap').status,'published');assert.equal(stored('x-swap').mediaCount,1);
 }finally{gone('x-swap')}
});

test('a save that was completed does not undo its own files when the editor closes',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');await handleAction('kind','image');
 pick([file('keep.jpg','image/jpeg')]);nodes.form={values:entryValues('Kept images','Gallery')};
 calls.length=0;await submit('entry',{},'published');await wait(15);
 assert.deepEqual(flow(['removeMedia']),[]);assert.equal(stored(db.entries[0].id).mediaCount,1);
});

test('switching account or signing out closes the open dialog and forgets what the previous user could read',async()=>{
 db.memberships['c-julian']='signature';
 try{
  const {handleAction}=await boot('member');
  await handleAction('read','e4');assert.match(dialog(),/rest of the caption/);
  // Another account takes over without a sign-out in between (a second tab, for example). It has no membership.
  delete db.memberships['c-julian'];
  emitAuth('SIGNED_IN',{user:{id:'user-2',email:'bea@example.com'}});await wait(25);
  assert.equal(nodes['#modal'].open,false);assert.equal(dialog(),'');
  await handleAction('read','e4');
  assert.doesNotMatch(dialog(),/rest of the caption/,'the paid caption of the first account is not served from the cache');assert.match(dialog(),/There’s more inside/);
  // Signing out takes the dialog away and shows the sign-in screen.
  await handleAction('read','e1');assert.equal(nodes['#modal'].open,true);
  emitAuth('SIGNED_OUT',null);await wait(5);
  assert.equal(nodes['#modal'].open,false);assert.equal(dialog(),'');assert.match(html(),/auth-screen/);
 }finally{delete db.memberships['c-julian'];asMe();await wait(25)}
 assert.match(html(),/class="app-sidebar"/,'the usual account is back');
});

test('signing out while a file uploads stops the upload and leaves nothing of the editor behind',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');await handleAction('kind','image');
 pick([file('z.jpg','image/jpeg')]);nodes.form={values:entryValues('Never saved','Gallery')};
 holdUploadOf='z.webp';calls.length=0;
 try{
  const saving=submit('entry',{},'published');await until(()=>uploads().includes('z.webp'));
  nodes['#toast'].textContent='';
  emitAuth('SIGNED_OUT',null);await saving;
  assert.equal(nodes['#modal'].open,false);assert.equal(dialog(),'');
  assert.deepEqual(flow(['saveEntry']).map(c=>c[2]),['draft'],'the final save never ran');
  assert.equal(toastText(),'','nothing is reported for the account that left');
 }finally{holdUploadOf='';db.entries=db.entries.filter(e=>e.title!=='Never saved');asMe();await wait(25)}
});

test('a second Esc cannot close an editor that has unsaved edits, but a deliberate close still works',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');
 const m=nodes['#modal'];
 m.listeners.input({target:{closest:()=>({})}});   // an edit
 m.open=false;m.listeners.close();                  // the browser closed it on the second Esc
 assert.equal(m.open,true,'it is shown again');
 await handleAction('close');assert.equal(m.open,false);
 m.listeners.close();assert.equal(m.open,false,'the close that follows a deliberate close is left alone');
});

test('closing a dialog stops a playing video, and the native close path does too',async()=>{
 const {handleAction}=await boot('member');
 const record=[],video={pause(){record.push('pause')},removeAttribute(n){record.push(`remove ${n}`)},load(){record.push('load')}};
 const m=nodes['#modal'],real=m.querySelectorAll;
 m.querySelectorAll=s=>s==='video'?[video]:real.call(m,s);
 try{
  await handleAction('read','e5');assert.match(dialog(),/<video/);
  record.length=0;   // opening a dialog also stops what the previous one was playing (the fake returns the same film for every dialog)
  await handleAction('close');
  assert.deepEqual(record,['pause','remove src','load']);assert.equal(m.innerHTML,'','the dialog is emptied');
  record.length=0;m.open=false;m.listeners.close();
  assert.deepEqual(record,['pause','remove src','load']);
  // A dialog that takes the reader's place (the creator's atelier, say) stops the film too, instead of leaving it to play unseen.
  await handleAction('read','e5');record.length=0;
  await handleAction('profile','c-julian');
  assert.deepEqual(record,['pause','remove src','load']);assert.match(dialog(),/The creator’s atelier/);
  await handleAction('close');
 }finally{m.querySelectorAll=real}
});

test('Enter in a single-line field of the editor does not submit it',()=>{
 const press=target=>{let stopped=false;handlers.keydown({key:'Enter',target,preventDefault(){stopped=true}});return stopped};
 const input={tagName:'INPUT',closest:s=>s==='[data-form="entry"]'?{}:null,dataset:{}};
 assert.equal(press(input),true,'title and introduction');assert.equal(press({...input,dataset:{alt:'m1'}}),true,'alt text');
 assert.equal(press({tagName:'TEXTAREA',closest:()=>({}),dataset:{}}),false,'a caption can still have line breaks');
 assert.equal(press({tagName:'INPUT',closest:()=>null,dataset:{}}),false,'the search box still submits');
 assert.equal(press({tagName:'BUTTON',closest:()=>({}),dataset:{}}),false);
 assert.equal(handlers.keydown({key:'a',target:input,preventDefault(){throw Error('only Enter')}}),undefined);
});

test('appreciating or saving from the reader patches the buttons and leaves the dialog alone',async()=>{
 const {handleAction}=await boot('member');
 await handleAction('read','e5');
 const before=dialog();assert.match(before,/<video/);calls.length=0;
 await handleAction('like','e5');
 assert.deepEqual(db.likes,['e5']);assert.equal(dialog(),before,'the dialog (and so the film) was not rebuilt');
 assert.match(nodes['.reader-actions'].innerHTML,/class="icon-button liked" data-action="like" data-id="e5" aria-label="Appreciate this entry" aria-pressed="true"/);
 assert.equal(flow(['load']).length,0,'a one-row change needs no reload');
 const bookmarked=db.bookmarks.includes('e5');
 await handleAction('save','e5');
 assert.equal(dialog(),before);assert.equal(db.bookmarks.includes('e5'),!bookmarked);
 assert.match(nodes['.reader-actions'].innerHTML,new RegExp(`class="icon-button ${bookmarked?'':'saved'}" data-action="save" data-id="e5"[^>]*aria-pressed="${!bookmarked}"`));
 await handleAction('like','e5');assert.deepEqual(db.likes,[]);assert.match(nodes['.reader-actions'].innerHTML,/class="icon-button " data-action="like" data-id="e5"[^>]*aria-pressed="false"/);
 await handleAction('save','e5');assert.equal(db.bookmarks.includes('e5'),bookmarked);
});

test('"Clear search" also clears the type filter',async()=>{
 const {handleAction}=await boot('member');location.hash='discover';
 handlers.change({target:{id:'format-filter',value:'video'}});
 await submit('search',{query:'zzz-no-match'});assert.match(html(),/No matches this time/);
 await handleAction('clear-search');
 assert.match(html(),/Elena Voss/);assert.match(html(),/<option value="all" selected>All types<\/option>/);assert.match(html(),/The pieces you return to/);
});

test('a video whose length is unknown shows no 0:00',async()=>{
 fixture('x-zero','A recording of unknown length','video',[movie('x-zero','mz0','rec.webm')],'',{duration:0,date:'2020-01-01T00:00:00Z'});
 try{
  await boot('member');location.hash='atelier';
  const card=cardOf('A recording of unknown length');
  assert.doesNotMatch(card,/0:00/);assert.match(card,/Film · Video/);assert.match(card,/class="kind-badge" aria-hidden="true"><svg[^>]*>[\s\S]*?<\/svg><\/span>/);
 }finally{gone('x-zero')}
});

test('a cover is signed again before the api would stop reusing its link',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1_000_000});   // time only moves when the test says so
 location.hash='settings';const {hydrateMedia,render}=await boot('member');
 calls.length=0;location.hash='atelier';await hydrateMedia();
 assert.equal(flow(['signedUrls']).length,1);
 t.mock.timers.tick(3*60*1000);render();
 assert.match(cardOf('Two rooms in Lisbon'),/data-media-ready="1"/,'still good after three minutes');
 t.mock.timers.tick(90*1000);render();
 assert.doesNotMatch(cardOf('Two rooms in Lisbon'),/data-media-ready/,'dropped at four minutes, well before a link that is almost an hour old can expire');
 calls.length=0;await hydrateMedia();assert.equal(flow(['signedUrls']).length,1,'and signed again');
});

test('covers load lazily through their own <img>, lose the blur once loaded and are signed again once if their link has expired',async()=>{
 location.hash='settings';const {hydrateMedia}=await boot('member');
 for(const id of Object.keys(painted))delete painted[id];
 calls.length=0;location.hash='atelier';await hydrateMedia();
 const img=seenImgs.e3;
 assert.equal(painted.e3,'https://signed.test/c-julian/e3/a.webp?token=secret');
 assert.match(cardOf('Two rooms in Lisbon'),/loading="lazy" decoding="async"/,'the cover is a lazy image, so only covers near the screen are fetched');
 const removed=[];img.closest=sel=>sel==='.is-preview'?{classList:{remove:c=>removed.push(c)}}:null;
 img.listeners.load();assert.deepEqual(removed,['is-preview']);
 // The link has expired by the time the card is scrolled into view: the image fails and is signed again, but only once.
 calls.length=0;delete painted.e3;
 img.listeners.error();await hydrateMedia();
 assert.equal(flow(['signedUrls']).length,1);assert.equal(painted.e3,'https://signed.test/c-julian/e3/a.webp?token=secret');
 calls.length=0;img.listeners.error();await wait(15);
 assert.equal(flow(['signedUrls']).length,0,'a cover that keeps failing does not loop');
});

test('the reader always reads the file list again, so files added or removed since a card was drawn show up',async()=>{
 const {handleAction,hydrateMedia}=await boot('member');
 location.hash='atelier';await hydrateMedia();   // the card cached the two images of e3
 db.media.e3.push(item('e3','m9','image','c.webp',2,{width:900,height:600}));
 try{
  calls.length=0;await handleAction('read','e3');
  assert.deepEqual(flow(['media']),[['media',['e3']]]);assert.match(dialog(),/c\.webp/);
  db.media.e3=db.media.e3.filter(m=>m.id!=='m9');
  await handleAction('read','e3');assert.doesNotMatch(dialog(),/c\.webp/);assert.doesNotMatch(dialog(),/could not be loaded/);
 }finally{db.media.e3=db.media.e3.filter(m=>m.id!=='m9')}
});

test('the caption and the media of an entry are requested together, and a failed media request offers a retry button',async()=>{
 const {handleAction}=await boot('member');
 let release;holdMedia=new Promise(r=>release=r);calls.length=0;
 const opening=handleAction('read','e3');await wait(5);
 assert.deepEqual(flow(['media','body']).map(c=>c[0]),['media','body'],'the caption does not wait for the file list');
 release();holdMedia=null;await opening;assert.match(dialog(),/A caption for the gallery\./);
 failSigning=true;
 try{
  await handleAction('read','e3');
  assert.match(dialog(),/<div class="media-retry" role="status"><p class="field-help">Some media could not be loaded just now\.<\/p><button class="button secondary small" data-action="read" data-id="e3">Try again<\/button><\/div>/);
 }finally{failSigning=false}
 await handleAction('read','e3');assert.doesNotMatch(dialog(),/could not be loaded/);assert.match(dialog(),/<figure/);
});

test('the editor explains what is blocked, names its controls apart and shows only what applies',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');
 assert.match(dialog(),/<div class="kind-switch" id="editor-kind" role="group" aria-label="Post type">/);
 assert.match(dialog(),/<label for="entry-format">Editorial format<\/label>/);
 assert.match(dialog(),/<div id="editor-cover-field"><label for="entry-image">Cover study<\/label>/,'a text post shows its cover study');
 await handleAction('kind','image');
 assert.equal(nodes['#editor-cover-field'].hidden,true,'a media post shows its own picture, so the preset cover goes');
 assert.match(mediaHtml(),/role="group" aria-labelledby="media-label"/);
 assert.match(mediaHtml(),/<span class="drop-only">Drop images here, or browse\. <\/span><span class="pick-only">Choose images from your device\. <\/span>/);
 assert.doesNotMatch(mediaHtml(),/aria-describedby/,'the hint is part of the button, so it is not read twice');
 assert.match(mediaHtml(),/location and camera details are removed/);
 pick([file('a.jpg','image/jpeg')]);
 assert.match(nodes['#editor-kind'].innerHTML,/data-id="video" aria-pressed="false" aria-disabled="true" title="Remove the images to change the post type"/);
 assert.equal(nodes['#editor-status'].textContent,'1 file added. 1 of 10.');
 assert.match(mediaHtml(),/id="media-label">Images <span>1 of 10<\/span>/,'the count is read with a space after the word');
 await handleAction('kind','video');
 assert.match(nodes['#media-error'].textContent,/Remove them before switching to Video/);
 assert.match(mediaHtml(),/<div id="media-error" class="form-error" role="alert">/,'the message sits in the media section, next to the controls it is about');
 await handleAction('media-remove',keys(mediaHtml())[0]);
 assert.doesNotMatch(nodes['#editor-kind'].innerHTML,/aria-disabled/);assert.equal(nodes['#media-error'].textContent,'');
 assert.equal(nodes['#editor-status'].textContent,'Removed a.jpg. 0 files left.');
 await handleAction('kind','video');
 assert.match(mediaHtml(),/Videos are uploaded as they are: location and device information stored in the file is not removed\./);
 await handleAction('kind','text');assert.equal(nodes['#editor-cover-field'].hidden,false);
 // An image dropped on a text entry that is not a picture or a film is reported where the creator is looking.
 pick([file('notes.pdf','application/pdf')]);assert.match(nodes['#entry-error'].textContent,/Choose Image or Video to attach files/);
});

test('new pictures show a small copy in the editor grid, made one at a time, never the full file',async()=>{
 const made=[];
 const withThumbs={...fakeMedia,async thumbnail(f){made.push(f.name);return f.name==='bad.png'?null:new Blob(['t'])}};
 const {handleAction}=await boot('creator',withThumbs);
 location.hash='studio';await handleAction('new-entry');await handleAction('kind','image');
 pick([file('a.jpg','image/jpeg'),file('bad.png','image/png')]);
 assert.doesNotMatch(mediaHtml(),/<img src="blob:/,'until the copy exists the grid shows a placeholder, not the full picture');
 await until(()=>made.length===2);await wait(5);
 const [k1,k2]=keys(mediaHtml());
 assert.match(nodes[`[data-thumb="${k1}"] .upload-pic`].innerHTML,/<img src="blob:[^"]+" alt="" decoding="async">/);
 assert.match(nodes[`[data-thumb="${k2}"] .upload-pic`].innerHTML,/<img src="blob:[^"]+" alt="" decoding="async">/,'a picture that cannot be shrunk falls back to the file itself');
 assert.deepEqual(made,['a.jpg','bad.png']);
 // A picture removed before its turn is never decoded.
 pick([file('c.jpg','image/jpeg'),file('d.jpg','image/jpeg')]);
 const dropped=keys(mediaHtml()).at(-2);handleAction('media-remove',dropped);
 await until(()=>made.includes('d.jpg'));
 assert.ok(!made.includes('c.jpg'));
});

test('after removing an image the keyboard focus moves to the next remove button, not to the top of the list',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');await handleAction('kind','image');
 pick([file('a.jpg','image/jpeg'),file('b.jpg','image/jpeg'),file('c.jpg','image/jpeg'),file('d.jpg','image/jpeg')]);
 const [,k2,,k4]=keys(mediaHtml()),host=nodes['#editor-media'],focus=[],real={contains:host.contains,all:host.querySelectorAll};
 globalThis.CSS={escape:v=>String(v)};
 host.contains=()=>true;host.querySelectorAll=sel=>sel.includes('media-remove')?keys(host.innerHTML).map((k,i)=>({focus:()=>focus.push(i)})):[];
 try{
  document.activeElement={dataset:{action:'media-remove',id:k2}};
  await handleAction('media-remove',k2);   // image 2 of 4
  assert.deepEqual(focus,[1],'the image that took its place');
  focus.length=0;document.activeElement={dataset:{action:'media-remove',id:k4}};
  await handleAction('media-remove',k4);   // the last one
  assert.deepEqual(focus,[1],'the new last image');
 }finally{host.contains=real.contains;host.querySelectorAll=real.all;delete document.activeElement;delete globalThis.CSS}
});

test('a save that worked but whose reload failed is retried once, and only then reported as stale',async()=>{
 const {handleAction}=await boot('creator');
 const values=title=>({title,subtitle:'',body:'A complete original reflection, long enough for the thirty character rule.',category:'Design',access:'public',image:'atelier',format:'Essay'});
 try{
  location.hash='studio';await handleAction('new-entry');
  nodes.form={values:values('Reload trouble')};failLoads=1;await submit('entry',{},'draft');
  assert.equal(toastText(),'Draft saved in your studio.');assert.match(html(),/Reload trouble/,'the second reload brought the list up to date');
  await handleAction('new-entry');
  nodes.form={values:values('Reload trouble again')};failLoads=2;await submit('entry',{},'draft');
  assert.match(toastText(),/Saved, but your studio could not be refreshed/);assert.equal(nodes['#modal'].open,false);
 }finally{failLoads=0;db.entries=db.entries.filter(e=>!e.title.startsWith('Reload trouble'))}
});

test('cards use the small card thumbnail of an image when it has one, and the file itself when it does not',async()=>{
 fixture('x-card','A card with a thumbnail','image',[{...still('x-card','mc1','big.webp',0),posterPath:'c-mine/x-card/big-poster.webp'}],'',{date:'2020-01-01T00:00:00Z'});
 fixture('x-old','An older upload','image',[still('x-old','mc2','plain.webp',0)],'',{date:'2020-01-02T00:00:00Z'});
 try{
  const {hydrateMedia}=await boot('member');location.hash='atelier';calls.length=0;await hydrateMedia();
  const asked=flow(['signedUrls']).flatMap(c=>c[1]);
  assert.ok(asked.includes('c-mine/x-card/big-poster.webp'));assert.ok(!asked.includes('c-mine/x-card/big.webp'),'the original is not downloaded for a card');
  assert.ok(asked.includes('c-mine/x-old/plain.webp'),'an older upload without a thumbnail still gets its file');
  // The reader still shows the original and has no use for the thumbnail.
  const {handleAction}=await boot('member');calls.length=0;await handleAction('read','x-card');
  assert.deepEqual(flow(['signedUrls']).map(c=>c[1]),[['c-mine/x-card/big.webp']]);
  assert.match(dialog(),/src="https:\/\/signed\.test\/c-mine\/x-card\/big\.webp\?token=secret"/);
  // The editor grid shows the thumbnail and previews with the original; body and file list are asked for together.
  const creator=await boot('creator');location.hash='studio';calls.length=0;
  await creator.handleAction('edit','x-card');
  assert.deepEqual(flow(['body','media','signedUrls']).map(c=>c[0]),['body','media','signedUrls']);
  assert.match(dialog(),/<img src="https:\/\/signed\.test\/c-mine\/x-card\/big-poster\.webp\?token=secret" alt="" decoding="async">/);
  assert.deepEqual(flow(['signedUrls'])[0][1],['c-mine/x-card/big.webp','c-mine/x-card/big-poster.webp']);
 }finally{gone('x-card','x-old')}
});

// The fake DOM builds new elements on every query. A real <img> keeps its listeners and data attributes until the next render, so
// this hands back the same element for as long as the markup stays the same.
function keepCovers(){
 const app=nodes['#app'],real=app.querySelectorAll,kept=new Map();let markup=null;
 app.querySelectorAll=function(sel){
  if(sel!=='img[data-media-thumb]')return real.call(this,sel);
  if(markup!==this.innerHTML){kept.clear();markup=this.innerHTML}
  return real.call(this,sel).map(img=>{const id=img.dataset.mediaThumb;if(!kept.has(id))kept.set(id,img);return kept.get(id)});
 };
 return {cover:id=>kept.get(id),restore:()=>{app.querySelectorAll=real}};
}

test('a card thumbnail that cannot be signed or loaded gives way to the image file, so a card is not left blank',async()=>{
 fixture('x-lost','A thumbnail that is gone','image',[{...still('x-lost','ml1','big.webp',0),posterPath:'c-mine/x-lost/big-poster.webp'}],'',{date:'2020-01-01T00:00:00Z'});
 fixture('x-bad','A thumbnail that will not load','image',[{...still('x-bad','ml2','huge.webp',0),posterPath:'c-mine/x-bad/huge-poster.webp'}],'',{date:'2020-01-02T00:00:00Z'});
 fixture('x-none','Nothing can be signed','image',[{...still('x-none','ml3','none.webp',0),posterPath:'c-mine/x-none/none-poster.webp'}],'',{date:'2020-01-03T00:00:00Z'});
 const covers=keepCovers();
 try{
  unsignable.add('c-mine/x-lost/big-poster.webp');unsignable.add('c-mine/x-none/none-poster.webp');unsignable.add('c-mine/x-none/none.webp');
  location.hash='settings';const {hydrateMedia,render}=await boot('member');
  for(const id of Object.keys(painted))delete painted[id];
  location.hash='atelier';calls.length=0;await hydrateMedia();
  // The first call asks for every cover as the card would show it; the thumbnails that did not sign are replaced by their files, in one more call.
  const asked=flow(['signedUrls']).map(c=>c[1]).slice(0,2);   // (the render that followed tries the card with nothing to show once more)
  assert.equal(asked.length,2);assert.ok(asked[0].includes('c-mine/x-lost/big-poster.webp')&&asked[0].includes('c-mine/x-bad/huge-poster.webp'));
  assert.deepEqual([...asked[1]].sort(),['c-mine/x-lost/big.webp','c-mine/x-none/none.webp'],'only the files behind the missing thumbnails');
  assert.equal(painted['x-lost'],'https://signed.test/c-mine/x-lost/big.webp?token=secret','the file stands in for the thumbnail that is gone');
  assert.equal(painted['x-bad'],'https://signed.test/c-mine/x-bad/huge-poster.webp?token=secret','a thumbnail that signs is still what the card shows');
  assert.equal(painted['x-none'],undefined,'with nothing to show the placeholder stays');
  // Nothing signed for x-none, so its file list is read again next time (the creator may have replaced the files) and its thumbnail is not written off.
  unsignable.clear();
  render();calls.length=0;await hydrateMedia();
  assert.deepEqual(flow(['media']),[['media',['x-none']]]);assert.equal(painted['x-none'],'https://signed.test/c-mine/x-none/none-poster.webp?token=secret');
  // A thumbnail that signs but cannot be fetched is signed again once; if that fails too the file takes over, and then it is left alone.
  const bad=covers.cover('x-bad');
  delete painted['x-bad'];calls.length=0;bad.listeners.error();await hydrateMedia();
  assert.deepEqual(flow(['signedUrls']).map(c=>c[1]),[['c-mine/x-bad/huge-poster.webp']],'first failure: the same thumbnail, signed again');
  assert.equal(painted['x-bad'],'https://signed.test/c-mine/x-bad/huge-poster.webp?token=secret');
  delete painted['x-bad'];calls.length=0;bad.listeners.error();await hydrateMedia();
  assert.deepEqual(flow(['signedUrls']).map(c=>c[1]),[['c-mine/x-bad/huge.webp']],'second failure: the image itself');
  assert.equal(painted['x-bad'],'https://signed.test/c-mine/x-bad/huge.webp?token=secret');
  calls.length=0;bad.listeners.error();await wait(15);
  assert.deepEqual(flow(['signedUrls']),[],'a cover that keeps failing does not loop');
  // The choice is remembered: the next render asks for the file the card fell back to, never for the thumbnail again, and then it is settled.
  calls.length=0;render();await hydrateMedia();assert.deepEqual(flow(['signedUrls']).map(c=>c[1]),[['c-mine/x-bad/huge.webp']]);
  calls.length=0;render();await hydrateMedia();assert.deepEqual(flow(['signedUrls']),[]);
  assert.match(cardOf('A thumbnail that will not load'),/src="https:\/\/signed\.test\/c-mine\/x-bad\/huge\.webp\?token=secret"/);
 }finally{covers.restore();unsignable.clear();gone('x-lost','x-bad','x-none')}
});

test('a cover drawn with a cached link is also signed again when it fails to load',async()=>{
 const covers=keepCovers();
 try{
  location.hash='settings';const {hydrateMedia,render}=await boot('member');
  location.hash='atelier';await hydrateMedia();
  assert.equal(covers.cover('e3').dataset.mediaReady,'1');
  render();   // drawn again with the links that are still good: nothing new is signed for them
  calls.length=0;await hydrateMedia();assert.deepEqual(flow(['signedUrls']),[]);
  const drawn=covers.cover('e3');
  assert.match(cardOf('Two rooms in Lisbon'),/data-media-ready="1"/);assert.equal(typeof drawn.listeners?.error,'function','its listeners are in place all the same');
  // The link ran out before the card was scrolled into view: the cover is signed again instead of staying broken.
  delete painted.e3;drawn.listeners.error();await hydrateMedia();
  assert.equal(flow(['signedUrls']).length,1);assert.equal(painted.e3,'https://signed.test/c-julian/e3/a.webp?token=secret');
  // The blurred preview that stands in before the cover arrives is not the cover: its load must not take the blur off early.
  const removed=[],plain=covers.cover('e5');plain.dataset.mediaReady='';plain.closest=sel=>sel==='.is-preview'?{classList:{remove:c=>removed.push(c)}}:null;
  plain.listeners.load();assert.deepEqual(removed,[]);
 }finally{covers.restore()}
});

test('studio rows draw their cover lazily, from the thumbnail',async()=>{
 fixture('x-row','A studio row with a thumbnail','image',[{...still('x-row','mr1','big.webp',0),posterPath:'c-mine/x-row/big-poster.webp'}]);
 try{
  location.hash='settings';const {hydrateMedia}=await boot('creator');
  for(const id of Object.keys(painted))delete painted[id];
  location.hash='studio';calls.length=0;await hydrateMedia();
  const row=html().split('<article class="studio-entry">').find(r=>r.includes('A studio row with a thumbnail'));
  assert.match(row,/^<img [^>]*loading="lazy" decoding="async" data-media-thumb="x-row"/,'a 68 px picture is not fetched before it is near the screen');
  assert.equal(painted['x-row'],'https://signed.test/c-mine/x-row/big-poster.webp?token=secret');
  assert.ok(!flow(['signedUrls']).flatMap(c=>c[1]).includes('c-mine/x-row/big.webp'),'and never the original');
 }finally{gone('x-row')}
});

test('discover sorts the entries once, however many creators there are',async()=>{
 const crowd=Array.from({length:40},(_,i)=>({id:'c-crowd'+i,slug:'crowd'+i,ownerId:null,name:'Creator '+i,initials:'C',category:'Design',descriptor:'',location:'',image:'atelier',bio:''}));
 db.creators.push(...crowd);
 const sort=Array.prototype.sort;let sorts=0;
 try{
  location.hash='settings';await boot('member');
  Array.prototype.sort=function(...args){sorts++;return sort.apply(this,args)};
  try{
   location.hash='discover';const once=sorts;
   assert.match(html(),/Creator 7/,'every creator is listed');
   handlers.change({target:{id:'format-filter',value:'video'}});handlers.change({target:{id:'category',value:'Design'}});
   assert.equal(once,1,'drawing the view sorts the published entries once');assert.equal(sorts,3,'and so does each filter change');
  }finally{Array.prototype.sort=sort}
  assert.match(html(),/A walk through the studio/);assert.doesNotMatch(html(),/Creator 7/,'creators without a film are left out of the film filter');
 }finally{Array.prototype.sort=sort;db.creators=db.creators.filter(c=>!c.id.startsWith('c-crowd'))}
});

test('switching account forgets the previous searches, and a reload still on its way for the old account never replaces the new data',async()=>{
 const follows=[...db.follows],name=db.profile.name;let release;
 try{
  location.hash='settings';const {handleAction}=await boot('member');
  location.hash='discover';await submit('search',{query:'julian'});handlers.change({target:{id:'format-filter',value:'video'}});
  assert.match(html(),/value="julian"/);
  holdNextLoad=new Promise(r=>release=r);   // the old account asks for a reload that is slow to answer...
  const writing=handleAction('follow','c-julian');await wait(5);
  db.profile.name='Bea Stone';
  emitAuth('SIGNED_IN',{user:{id:'user-2',email:'bea@example.com'}});await wait(25);   // ...the next account is in and loaded long before it
  assert.match(html(),/Bea Stone/);assert.doesNotMatch(html(),/value="julian"/,'the previous search is gone');assert.match(html(),/<option value="all" selected>All types<\/option>/);
  release();await writing;await wait(10);
  assert.match(html(),/Bea Stone/);assert.doesNotMatch(html(),/Aria Bennett/,'the late answer was dropped');
 }finally{release?.();holdNextLoad=null;db.follows=follows;db.profile.name=name;asMe();await wait(25)}
});

test('a list of members still on its way for the previous account is not shown to the next one',async()=>{
 let release;
 try{
  location.hash='settings';holdNextMembers=new Promise(r=>release=r);
  await boot('creator');
  location.hash='studio';await wait(5);   // asks for the members and waits
  emitAuth('SIGNED_IN',{user:{id:'user-2',email:'bea@example.com'}});await wait(25);   // the next account asks again and gets its own list
  assert.match(html(),/Members<\/span><strong>0<\/strong>/);
  release();await wait(10);
  assert.match(html(),/Members<\/span><strong>0<\/strong>/,'the late list of the old account was dropped');assert.doesNotMatch(html(),/Old member/);
 }finally{release?.();holdNextMembers=null;asMe();await wait(25)}
});

// --- Uploads in parallel, per-file failures, parallel removals ----------------------------------------------------
test('files upload two at a time, each with its own bar, and nothing is removed before every upload is stored',async()=>{
 fixture('x-par','Parallel stills','image',[still('x-par','mp1','old1.webp',0),still('x-par','mp2','old2.webp',1)]);
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  await handleAction('edit','x-par');
  for(const key of keys(dialog()))await handleAction('media-remove',key);   // both old files go, five new ones come
  pick(['a','b','c','d','e'].map(n=>file(`${n}.jpg`,'image/jpeg')));
  nodes.form={values:entryValues('Parallel stills','Gallery')};
  let release;flight.gate=new Promise(r=>release=r);flight.now=0;flight.peak=0;calls.length=0;
  const saving=submit('entry',{},'published');
  await until(()=>flight.now===2);await wait(10);
  assert.equal(flight.now,2,'the third file waits for a free slot');assert.deepEqual(uploads(),['a.webp','b.webp']);
  assert.equal([...mediaHtml().matchAll(/role="progressbar"/g)].length,5,'every queued file already shows its bar');
  release();flight.gate=null;await saving;
  assert.equal(flight.peak,2,'never more than two at once');
  const sent=flow(['uploadMedia']).map(c=>[c[2],c[3]]).sort(([a],[b])=>a.localeCompare(b));
  assert.deepEqual(sent,[['a.webp',0],['b.webp',1],['c.webp',2],['d.webp',3],['e.webp',4]],'each file keeps the position it has in the list');
  const order=steps();
  assert.ok(order.lastIndexOf('uploadMedia')<order.indexOf('removeMedia'),'the old files go only after the last upload');
  assert.deepEqual(flow(['removeMedia']).map(c=>[c[1],c[2]]),[[['mp1','mp2'],7]],'one request for both, with all five new files already stored');
  assert.deepEqual(flow(['autoDraft']),[]);assert.equal(order.at(-1),'saveEntry');
  assert.equal(db.media['x-par'].length,5);assert.equal(stored('x-par').status,'published');assert.equal(nodes['#modal'].open,false);
 }finally{flight.gate=null;gone('x-par')}
});

test('when a file fails the one still running finishes, nothing new starts, and the next save sends only what is missing',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');await handleAction('kind','image');
 pick(['a','b','c','d'].map(n=>file(`${n}.jpg`,'image/jpeg')));
 nodes.form={values:entryValues('Four with a failure','Gallery')};
 let release;lateGate=new Promise(r=>release=r);lateUploadOf='a.webp';failUploadOf='b.webp';calls.length=0;
 try{
  const saving=submit('entry',{},'published');
  await until(()=>uploads().includes('b.webp'));await wait(10);
  assert.deepEqual(uploads(),['a.webp','b.webp'],'the free slot is not used for the next file once one has failed');
  release();await saving;
  assert.deepEqual(uploads(),['a.webp','b.webp']);
  const draft=db.entries.find(e=>e.title==='Four with a failure');
  assert.deepEqual([draft.status,db.media[draft.id].map(m=>m.path.split('/').pop())],['draft',['a.webp']],'the file that was already on its way was not thrown away');
  assert.equal(nodes['#entry-error'].textContent,'b.jpg: The upload was interrupted. Your draft and 1 uploaded file are kept. Press Save draft or Publish to continue.');
  const [a,b,c,d]=mediaHtml().split('<li ').slice(1);
  assert.doesNotMatch(a,/is-failed|Not uploaded/);assert.match(b,/Not uploaded: The upload was interrupted\./);assert.doesNotMatch(c+d,/is-failed|Not uploaded/,'files that never started are not blamed');
  lateUploadOf='';lateGate=null;calls.length=0;
  await submit('entry',{},'published');
  assert.deepEqual(uploads(),['b.webp','c.webp','d.webp']);assert.equal(stored(draft.id).status,'published');assert.equal(db.media[draft.id].length,4);assert.equal(nodes['#modal'].open,false);
 }finally{lateUploadOf='';lateGate=null;failUploadOf='';db.entries=db.entries.filter(e=>e.title!=='Four with a failure')}
});

test('every file that fails says why next to itself, and the summary counts the others',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');await handleAction('kind','image');
 pick([file('unreadable.jpg','image/jpeg'),file('b.jpg','image/jpeg'),file('c.jpg','image/jpeg')]);
 nodes.form={values:entryValues('Two with a problem each','Gallery')};
 failUploadOf='b.webp';calls.length=0;
 try{
  await submit('entry',{},'published');
  assert.equal(nodes['#entry-error'].textContent,'unreadable.jpg: This picture could not be read. 1 other file also failed. Your draft is kept. Press Save draft or Publish to continue.');
  const [first,second,third]=mediaHtml().split('<li ').slice(1);
  assert.match(first,/<p class="upload-status">Not uploaded: This picture could not be read\. It will be sent again when you save\.<\/p>/);
  assert.match(second,/<p class="upload-status">Not uploaded: The upload was interrupted\. It will be sent again when you save\.<\/p>/);
  assert.doesNotMatch(third,/Not uploaded|is-failed/);assert.deepEqual(uploads(),['b.webp'],'the third file never started');
  // Fixing the first problem (the picture is taken out) and saving again sends the other two.
  await handleAction('media-remove',keys(mediaHtml())[0]);calls.length=0;
  await submit('entry',{},'published');
  assert.deepEqual(uploads(),['b.webp','c.webp']);assert.equal(db.entries.find(e=>e.title==='Two with a problem each').status,'published');
 }finally{failUploadOf='';db.entries=db.entries.filter(e=>e.title!=='Two with a problem each')}
});

test('removals and reorders go out together once the uploads are stored, and a failed removal keeps the reorders',async()=>{
 fixture('x-ro','Reorder and remove','image',[still('x-ro','mr1','a.webp',0),still('x-ro','mr2','b.webp',1),still('x-ro','mr3','c.webp',2)]);
 fixture('x-ro2','Reorder, removal fails','image',[still('x-ro2','mq1','a.webp',0),still('x-ro2','mq2','b.webp',1)]);
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  await handleAction('edit','x-ro');
  const [k1,k2]=keys(dialog());
  await handleAction('media-remove',k1);await handleAction('media-later',k2);
  handlers.input({target:{dataset:{alt:k2},value:'New alt'}});
  nodes.form={values:entryValues('Reorder and remove','Gallery')};
  calls.length=0;slowRemove=true;
  await submit('entry',{},'published');
  // The removal is sent first and is still running while both updates go out.
  assert.deepEqual(flow(['removeMedia','updateMedia','removed','saveEntry']).map(c=>c[0]),['removeMedia','updateMedia','updateMedia','removed','saveEntry']);
  assert.deepEqual(db.media['x-ro'].map(m=>[m.id,m.position,m.alt]).sort(),[['mr2',1,'New alt'],['mr3',0,'']]);
  // The removal fails: the reorders are kept, the error is shown, and the next save only repeats the removal.
  await handleAction('edit','x-ro2');
  const [q1,q2]=keys(dialog());
  await handleAction('media-remove',q1);handlers.input({target:{dataset:{alt:q2},value:'Kept alt'}});
  nodes.form={values:entryValues('Reorder, removal fails','Gallery')};
  slowRemove=false;failNextRemove=true;calls.length=0;
  await submit('entry',{},'published');
  assert.match(nodes['#entry-error'].textContent,/removal was interrupted/);assert.equal(nodes['#modal'].open,true);
  assert.deepEqual(db.media['x-ro2'].map(m=>[m.id,m.alt]),[['mq1',''],['mq2','Kept alt']],'the alt text was saved although the removal failed');
  calls.length=0;await submit('entry',{},'published');
  assert.deepEqual(flow(['removeMedia','updateMedia','saveEntry']).map(c=>c[0]),['removeMedia','saveEntry'],'nothing already saved is sent again');
  assert.deepEqual(db.media['x-ro2'].map(m=>m.id),['mq2']);assert.equal(stored('x-ro2').status,'published');
 }finally{slowRemove=false;failNextRemove=false;gone('x-ro','x-ro2')}
});

// --- Enter, busy controls, presets and touch targets ----------------------------------------------------------------
test('the editor has no default submit button, so Enter or a phone keyboard can never save or publish by accident',async()=>{
 const {handleAction}=await boot('creator');
 location.hash='studio';await handleAction('new-entry');
 const lead=/<form class="editor-form"[^>]*>([\s\S]*?)<fieldset/.exec(dialog())[1];
 assert.equal(lead,'<button type="submit" hidden disabled tabindex="-1" aria-hidden="true" data-guard></button>','the first submit button is the default one: disabled, it blocks implicit submission');
 assert.match(dialog(),/<button type="button" class="button secondary" data-action="preview-entry" data-id="">Preview<\/button><button class="button secondary" name="intent" value="draft">Save draft<\/button><button class="button" name="intent" value="published">/);
 // Only Save draft and Publish save. A submit with no such button behind it neither saves nor publishes.
 nodes.form={values:entryValues('Never saved by Enter','Essay','A complete original reflection, long enough for the thirty character rule.')};
 calls.length=0;const form={dataset:{form:'entry'},values:{}};
 for(const submitter of [null,{},{value:''},{value:'send'}])await handlers.submit({target:{closest:()=>form},preventDefault(){},submitter});
 assert.deepEqual(flow(['saveEntry']),[]);
 await handleAction('close');
});

test('opening a reader marks the tapped control busy, ignores a second tap and drops a read the viewer has moved on from',async()=>{
 const {handleAction}=await boot('member');
 const marks=[],tap={attrs:{},getAttribute(n){return this.attrs[n]??null},setAttribute(n,v){this.attrs[n]=v;marks.push(`${n}=${v}`)},removeAttribute(n){delete this.attrs[n];marks.push(`-${n}`)}};
 let release;holdMedia=new Promise(r=>release=r);calls.length=0;
 try{
  const first=handleAction('read','e3',tap);await wait(5);
  assert.equal(tap.getAttribute('aria-busy'),'true','the tap is acknowledged while the caption and the pictures are fetched');
  await handleAction('read','e3',tap);assert.equal(flow(['body']).length,1,'a second tap does not start a second read');
  release();holdMedia=null;await first;
  assert.deepEqual(marks,['aria-busy=true','-aria-busy']);assert.match(dialog(),/A caption for the gallery\./);
  // The dialog is closed while another read is still waiting: it must not pop open afterwards.
  await handleAction('close');
  holdMedia=new Promise(r=>release=r);
  const late=handleAction('read','e3');await wait(5);
  await handleAction('close');
  release();holdMedia=null;await late;
  assert.equal(dialog(),'');assert.equal(nodes['#modal'].open,false);
 }finally{holdMedia=null}
});

test('opening the editor marks the tapped control busy and does not open it after the creator moved on',async()=>{
 fixture('x-busy','A film being opened','video',[movie('x-busy','mb1','b.mp4')]);
 try{
  const {handleAction,hydrateMedia}=await boot('creator');
  location.hash='studio';await hydrateMedia();
  const tap={attrs:{},getAttribute(n){return this.attrs[n]??null},setAttribute(n,v){this.attrs[n]=v},removeAttribute(n){delete this.attrs[n]}};
  let release;holdMedia=new Promise(r=>release=r);
  const opening=handleAction('edit','x-busy',tap);await wait(5);
  assert.equal(tap.getAttribute('aria-busy'),'true');
  await handleAction('close');   // another dialog was closed, or the creator went elsewhere
  release();holdMedia=null;await opening;
  assert.equal(tap.getAttribute('aria-busy'),null);assert.equal(nodes['#modal'].open,false,'the editor did not open behind their back');assert.equal(dialog(),'');
  await handleAction('edit','x-busy',tap);assert.match(dialog(),/class="video-preview"/,'and opens normally when asked');
  await handleAction('close');
 }finally{holdMedia=null;gone('x-busy')}
});

test('the editorial presets are small JPEGs in a versioned folder that is cached for a year',async()=>{
 const dir=new URL('../public/editorial/v1/',import.meta.url);
 for(const name of ['atelier','ritual','architecture']){const bytes=statSync(new URL(`${name}.jpg`,dir)).size;assert.ok(bytes>20_000&&bytes<=150_000,`${name}.jpg is ${bytes} bytes`)}
 await boot('member');location.hash='atelier';
 assert.match(html(),/src="\/editorial\/v1\/(atelier|ritual|architecture)\.jpg"/);assert.doesNotMatch(html(),/\/editorial\/[a-z]+\.png/,'no 2.5 MB PNG for a card cover');
 try{emitAuth('SIGNED_OUT',null);await wait(5);assert.match(html(),/<img src="\/editorial\/v1\/atelier\.jpg" alt="A monochrome study of an atelier" loading="lazy" decoding="async">/,'nor on the sign-in screen, where it is lazy so a phone never fetches it')}
 finally{asMe();await wait(25)}
 const rules=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8')).headers;
 assert.deepEqual(rules.find(r=>r.source==='/editorial/v1/(.*)')?.headers,[{key:'Cache-Control',value:'public, max-age=31536000, immutable'}]);
});

test('every control in the editor keeps a touch target of at least 40 px, and saving dims what is disabled',()=>{
 const css=readFileSync(new URL('../src/platform.css',import.meta.url),'utf8');
 const sizes=re=>{const found=[...css.matchAll(re)];assert.ok(found.length,String(re));return found.flatMap(m=>m.slice(1).map(Number))};
 for(const [what,re] of [['move and remove buttons',/\.upload-actions \.icon-button\{width:(\d+)px;height:(\d+)px/g],['post type switch',/\.kind-switch button\{[^}]*?min-height:(\d+)px/g],['alt text field',/\.upload-alt\{[^}]*?min-height:(\d+)px/g],['cancel upload',/\.editor-cancel \.button\{[^}]*?min-height:(\d+)px/g]])
  assert.ok(sizes(re).every(n=>n>=40),`${what} is at least 40 px`);
 assert.match(css,/\.editor-fields:disabled :is\([^)]*\.button[^)]*\)\{[^}]*opacity:\.45/,'a disabled button looks disabled although the page is busy');
 assert.match(css,/\[aria-busy="true"\]\{[^}]*cursor:progress/);
});
