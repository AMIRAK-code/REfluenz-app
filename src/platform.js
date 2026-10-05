import { escapeHTML as esc, canRead, validateEntry, validateAtelier, membershipTotal, csvCell, categories, covers } from './store.js';
import { icon } from './icons.js';

// The platform view layer. All data comes from the injected api (Supabase in the
// browser, a fake in tests); the server enforces access with row level security.
export function mount(api, {storage = safeStorage()} = {}) {
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
let user = null, data = null, authReady = false, recovering = false, loadError = '', authMode = 'signin', authNotice = '';
let activeFilter = 'All entries', query = '', category = 'All', contact = '';
let studioTab = 'published', membershipCreator = '', selectedTier = 'essential', circleMembers = null;
let readerId = '', editorId = '', editorDirty = false, busy = false, toastTimer;
const bodies = new Map();
const state = () => data;
const role = () => (storage.getItem('refluenz.role') === 'creator' ? 'creator' : 'member');
const setRole = r => { try { storage.setItem('refluenz.role', r); } catch {} };
const blank = {id:'', name:'REFLUENZ', initials:'R', category:'Culture', descriptor:'', location:'', image:'atelier', bio:''};
const creator = id => state().creators.find(c => c.id === id) || blank;
const mine = () => state().myCreator;
const entry = id => state().entries.find(e => e.id === id);
const tier = id => state().tiers.find(t => t.id === id);
const image = name => `/editorial/${covers.includes(name) ? name : 'atelier'}.png`;
const avatar = c => `<span class="avatar" aria-hidden="true">${esc(c.initials || String(c.name||'').split(' ').map(n => n[0]).slice(0,2).join(''))}</span>`;
const money = n => `€${n}`;
const date = value => new Date(value).toLocaleDateString('en-GB', {day:'numeric',month:'short'});
const action = (name, id = '') => `data-action="${name}" data-id="${esc(id)}"`;
const btn = (label, name, id='', classes='button secondary small') => `<button class="${classes}" ${action(name,id)}>${label}</button>`;
const published = () => state().entries.filter(e => e.status === 'published').sort((a,b) => new Date(b.date)-new Date(a.date));
const route = () => location.hash.slice(1).split('/')[0] || 'atelier';
const pages = {atelier:'The atelier',discover:'Discover',archive:'Private archive',circle:'Your circle',memberships:'Memberships',studio:'Creator studio',settings:'Settings'};
const accessLabel = a => a === 'public' ? 'Open entry' : esc(tier(a)?.name || a);

function toast(message) {
  clearTimeout(toastTimer);
  const el = document.querySelector('#toast');
  el.textContent = message; el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}
async function refresh() { data = await api.load(); if (contact && role() === 'member' && !state().creators.some(c => c.id === contact)) contact = ''; }
// Runs a server write, reloads the member's data and redraws. Returns true on success.
async function run(fn, message, redraw = true) {
  if (busy) return false;
  busy = true; document.body.classList.add('busy');
  try { await fn(); await refresh(); if (redraw) render(); if (message) toast(message); return true; }
  catch (error) { toast(error.message); return false; }
  finally { busy = false; document.body.classList.remove('busy'); }
}
function go(view) { if(!closeModal()) return; if(location.hash === `#${view}`) render(); else location.hash = view; }
function openModal(title, body, className='') {
  modal.className = className;
  modal.innerHTML = `<div class="dialog-head"><h2 id="modal-title">${title}</h2><button class="icon-button" ${action('close')} aria-label="Close dialog">${icon('close')}</button></div>${body}`;
  if(!modal.open) modal.showModal();
  document.body.style.overflow = 'hidden';
}
function closeModal(force=false) {
  if(editorDirty && !force) {
    if(!window.confirm('Discard the unsaved changes to this entry?')) return false;
  }
  editorDirty = false; readerId = ''; editorId = '';
  if(modal.open) modal.close(); document.body.style.overflow = ''; return true;
}
modal.addEventListener('cancel', e => { e.preventDefault(); closeModal(); });
modal.addEventListener('close', () => { document.body.style.overflow = ''; });
modal.addEventListener('click', e => {
  if(e.target !== modal) return;
  const r = modal.getBoundingClientRect();
  if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) closeModal();
});
window.addEventListener('beforeunload', e => { if(editorDirty) { e.preventDefault(); e.returnValue=''; } });

// --- Authentication ------------------------------------------------------
function authView() {
  const forms = {
    signin:`<form class="auth-form" data-form="signin"><div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" required maxlength="254"></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="72"></div><button class="button">Sign in ${icon('arrow',14)}</button><div class="auth-links"><button type="button" class="text-link bare" ${action('auth-mode','signup')}>Create a free account</button><button type="button" class="text-link bare" ${action('auth-mode','forgot')}>Forgot your password?</button></div></form>`,
    signup:`<form class="auth-form" data-form="signup"><div class="field"><label for="auth-name">Display name</label><input id="auth-name" name="name" autocomplete="name" required maxlength="60"></div><div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" required maxlength="254"></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="72"><p class="field-help">At least 8 characters.</p></div><button class="button">Create free account ${icon('arrow',14)}</button><div class="auth-links"><button type="button" class="text-link bare" ${action('auth-mode','signin')}>I already have an account</button></div></form>`,
    forgot:`<form class="auth-form" data-form="forgot"><div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" required maxlength="254"></div><button class="button">Send reset link ${icon('send',14)}</button><div class="auth-links"><button type="button" class="text-link bare" ${action('auth-mode','signin')}>Back to sign in</button></div></form>`,
    recover:`<form class="auth-form" data-form="recover"><div class="field"><label for="auth-password">New password</label><input id="auth-password" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="72"></div><button class="button">Save new password ${icon('check',14)}</button></form>`
  };
  const titles = {signin:['Welcome back','Step inside.','Your atelier, exactly as you left it.'],signup:['Free to join','Find your circle.','Create an account to follow creators, keep an archive and join the conversation.'],forgot:['Account recovery','Reset your password.','We will email you a secure link.'],recover:['Account recovery','Choose a new password.','Then continue to your atelier.']};
  const [kicker,title,text] = titles[authMode];
  return `<main id="main" class="auth-screen" tabindex="-1"><section class="auth-panel"><a class="wordmark" href="/index.html">REFLUENZ</a><div class="eyebrow bronze">${kicker}</div><h1>${title}</h1><p>${text}</p>${authNotice?`<div class="notice" role="status">${esc(authNotice)}</div>`:''}${forms[authMode]}</section><aside class="auth-picture"><img src="/editorial/atelier.png" alt="A monochrome study of an atelier"><span class="eyebrow">The digital atelier / Edition 001</span></aside></main>`;
}

// --- Shell and views -----------------------------------------------------
function navLink(id, label, name, mobile=false) {
  const active = route() === id;
  return `<a href="#${id}" class="${mobile?'':'nav-link '}${active?'active':''}" ${active?'aria-current="page"':''}>${icon(name)}<span>${label}</span>${!mobile&&id==='archive'&&state().saved.length?`<span class="nav-count">${state().saved.length}</span>`:''}</a>`;
}
function shell(content) {
  const s = state(), r = role(), c = r === 'creator' && mine() ? mine() : s.profile;
  return `<aside class="app-sidebar"><a class="wordmark" href="/index.html">REFLUENZ</a><div class="eyebrow sidebar-caption">The digital atelier</div><div class="nav-section">Your private space</div><nav class="side-nav" aria-label="Platform navigation">
  ${navLink('atelier','The atelier','grid')}${navLink('discover','Discover','compass')}${navLink('archive','Private archive','bookmark')}${navLink('circle','Your circle','message')}${navLink('memberships','Memberships','members')}${r==='creator'?navLink('studio','Creator studio','studio'):''}</nav>
  <div class="sidebar-bottom"><div class="sidebar-studio"><span class="eyebrow bronze">${r==='creator'?'The other side':'Made for your work'}</span><p>${r==='creator'?'See your work through the eyes of your circle.':'Your point of view deserves a place of its own.'}</p><button class="text-link bare" ${action('role',r==='creator'?'member':'creator')}>${r==='creator'?'View as a member':mine()?'Open your studio':'Open your atelier'} ${icon('arrow',14)}</button></div><div class="sidebar-footer-links"><a href="/index.html">About REFLUENZ ${icon('arrow',12)}</a><a href="#settings" aria-label="Settings">${icon('settings',16)}</a></div><button class="profile-button" ${action('settings')}>${avatar(c)}<span><strong>${esc(c.name)}</strong><small>${r==='creator'&&mine()?'Your atelier':'Member'}</small></span></button></div></aside>
  <div class="app-layout"><header class="app-topbar"><a class="wordmark mobile-wordmark" href="/index.html">REFLUENZ</a><div class="breadcrumb">Your space <span>/</span> <strong>${pages[route()]||pages.atelier}</strong></div><div class="topbar-right"><form class="search-box" data-form="search">${icon('search',16)}<input name="query" aria-label="Search creators and entries" placeholder="Search the atelier" maxlength="100" value="${esc(query)}"></form><div class="role-switch" aria-label="Perspective"><button ${action('role','member')} class="${r==='member'?'active':''}" aria-pressed="${r==='member'}">Member</button><button ${action('role','creator')} class="${r==='creator'?'active':''}" aria-pressed="${r==='creator'}">Creator</button></div></div></header>
  <div class="demo-strip"><span><strong>EARLY ACCESS</strong> <span>— Joining a circle is free while payments are being set up.</span></span><button ${action('about')}>How it works</button></div>${loadError?`<div class="error-banner" role="alert">${esc(loadError)}</div>`:''}
  <main id="main" class="workspace ${s.preferences.compact?'compact':''}" tabindex="-1">${content}<footer class="view-footer"><span>REFLUENZ · Independent by design</span><span>Early access / 001</span></footer></main></div>
  <nav class="mobile-bar" aria-label="Mobile navigation">${navLink('atelier','Atelier','grid',true)}${navLink('discover','Discover','compass',true)}${navLink('archive','Archive','bookmark',true)}${navLink('circle','Circle','message',true)}${navLink(r==='creator'?'studio':'settings',r==='creator'?'Studio':'You',r==='creator'?'studio':'user',true)}</nav>`;
}
function heading(kicker,title,description,extra='') {
  return `<div class="page-heading"><div><div class="eyebrow bronze">${kicker}</div><h1>${title}</h1><p>${description}</p></div>${extra}</div>`;
}
function saveButton(p) {
  const saved = state().saved.includes(p.id);
  return `<button class="icon-button ${saved?'saved':''}" ${action('save',p.id)} aria-label="${saved?'Remove from':'Save to'} archive: ${esc(p.title)}" aria-pressed="${saved}">${icon('bookmark',17)}</button>`;
}
function card(p) {
  const c = creator(p.creatorId), locked=!canRead(p,state());
  return `<article class="entry-card"><button class="entry-cover" ${action('read',p.id)} aria-label="Read ${esc(p.title)}"><img src="${image(p.image)}" alt="${esc(p.category)} editorial cover" loading="lazy"><span class="access-badge">${locked?icon('lock',10):''}${accessLabel(p.access)}</span></button><div class="entry-details"><div class="eyebrow">${esc(c.name)} / ${esc(p.category)}</div><h3><button class="entry-title" ${action('read',p.id)}>${esc(p.title)}</button></h3><p>${esc(p.subtitle)}</p><div class="entry-card-footer"><span>${esc(p.format)} · ${p.minutes} min</span>${saveButton(p)}</div></div></article>`;
}
function empty(title,text,link='discover',label='Explore the atelier') {
  return `<div class="empty">${icon('bookmark',26)}<h3>${title}</h3><p>${text}</p><a class="button secondary" href="#${link}">${label} ${icon('arrow')}</a></div>`;
}
function feature(p) {
  const c = creator(p.creatorId);
  return `<article class="feature-entry"><button class="feature-picture" ${action('read',p.id)} aria-label="Read ${esc(p.title)}"><img src="${image(p.image)}" alt="A study in ${esc(p.category.toLowerCase())}"><span class="cover-label">The considered edit / 001</span></button><div class="feature-info"><div class="entry-author">${avatar(c)}<span>${esc(c.name)}<small>${esc(c.descriptor)}</small></span></div><h2><button ${action('read',p.id)}>${esc(p.title)}</button></h2><p>${esc(p.subtitle)}</p><button class="text-link" ${action('read',p.id)}>Read the entry ${icon('arrow',15)}</button><div class="feature-meta"><span class="eyebrow">${esc(p.format)} · ${p.minutes} min read</span>${saveButton(p)}</div></div></article>`;
}
function rail() {
  const list = state().creators.filter(c=>state().following.includes(c.id));
  const note = [...state().notes].reverse().find(n => state().following.includes(n.creatorId));
  return `<aside class="right-rail"><div class="rail-section"><h2 class="rail-title">Your circle <span>${String(list.length).padStart(2,'0')}</span></h2>${list.length?list.map(c=>`<div class="rail-person">${avatar(c)}<div class="rail-person-name">${esc(c.name)}<small>${esc(c.descriptor)}</small></div><button class="icon-button" ${action('profile',c.id)} aria-label="View ${esc(c.name)}">${icon('arrow',14)}</button></div>`).join(''):'<p class="field-help">Follow a creator to start your circle.</p>'}<a href="#discover" class="text-link">Discover a new voice ${icon('plus',12)}</a></div>${note?`<div class="rail-note"><span class="eyebrow">A note from the studio</span><blockquote>“${esc(note.text.length>120?note.text.slice(0,117)+'…':note.text)}”</blockquote><p>${esc(creator(note.creatorId).name)} · ${date(note.date)}</p><button class="text-link bare" ${action('open-contact',note.creatorId)}>Open the conversation ${icon('arrow',13)}</button></div>`:''}<div class="rail-footer">No ads. No algorithm.<br>Just the people you choose.<br><a href="/index.html">The REFLUENZ manifesto ↗</a></div></aside>`;
}
function atelierView() {
  let posts=published();
  if(activeFilter==='Following')posts=posts.filter(p=>state().following.includes(p.creatorId));
  else if(activeFilter!=='All entries')posts=posts.filter(p=>p.category===activeFilter);
  const first=posts[0];
  return heading('Selected for a slower scroll','Your daily edit.','Good work, from people with a point of view.','<div class="date-stamp">A considered collection<br>Edition 001</div>')+
  `<div class="content-columns"><div><div class="edition-tabs" role="group" aria-label="Filter entries">${['All entries','Following',...categories].map(f=>`<button ${action('filter',f)} class="${activeFilter===f?'active':''}" aria-pressed="${activeFilter===f}">${f}</button>`).join('')}</div>${first?feature(first):empty('A little room for discovery.','Follow a creator or choose another category to find your next read.')}${posts.length>1?`<div class="subhead"><h2>From the atelier</h2><span>${posts.length-1} entries to explore</span></div><div class="entry-grid">${posts.slice(1).map(card).join('')}</div>`:''}${!state().welcomeDismissed?`<div class="welcome-card"><p>A space that feels like you.<small>Complete your profile, then find your first circle.</small></p><a class="text-link" href="#settings">Make it yours ${icon('arrow',14)}</a><button class="icon-button" ${action('dismiss-welcome')} aria-label="Dismiss welcome">${icon('close',14)}</button></div>`:''}</div>${rail()}</div>`;
}
function discoverView() {
  const q=query.toLowerCase();
  const cs=state().creators.filter(c=>(category==='All'||c.category===category)&&`${c.name} ${c.descriptor} ${c.bio}`.toLowerCase().includes(q));
  const ps=published().filter(p=>(category==='All'||p.category===category)&&`${p.title} ${p.subtitle} ${creator(p.creatorId).name}`.toLowerCase().includes(q));
  return heading('Independent voices','Find your people.','Follow a point of view. Stay for the conversation.')+`<div class="filter-row"><form class="search-box" data-form="search">${icon('search',16)}<input name="query" aria-label="Search discovery" value="${esc(query)}" maxlength="100" placeholder="A name, an idea, a point of view…"></form><select id="category" aria-label="Filter by category">${['All',...categories].map(c=>`<option ${c===category?'selected':''}>${c}</option>`).join('')}</select></div><p class="results-label">${query?`Results for “${esc(query)}” · `:''}${cs.length} creators · ${ps.length} entries</p><div class="creator-grid">${cs.map(c=>`<article class="creator-card"><div class="creator-cover"><img src="${image(c.image)}" alt="${esc(c.descriptor||c.category)}" loading="lazy"><span class="eyebrow">${esc(c.location)}</span></div><div class="creator-details"><div class="creator-name"><h2>${esc(c.name)}</h2><span class="eyebrow bronze">${esc(c.category)}</span></div><p>${esc(c.bio)}</p><div class="creator-actions"><button class="text-link bare" ${action('profile',c.id)}>Visit atelier ${icon('arrow',14)}</button>${c.id===mine()?.id?'':followButton(c.id)}</div></div></article>`).join('')}</div>${ps.length?`<div class="subhead section-space"><h2>Entries to spend time with</h2><span>${ps.length} entries</span></div><div class="entry-grid full-grid">${ps.map(card).join('')}</div>`:''}${!cs.length&&!ps.length?`<div class="empty"><h3>No matches this time.</h3><p>Try a creator’s name, “style”, or a shorter search.</p>${btn('Clear search','clear-search')}</div>`:''}`;
}
function followButton(id) {const on=state().following.includes(id);return `<button class="button secondary small" ${action('follow',id)} aria-pressed="${on}">${icon(on?'check':'plus',13)} ${on?'Following':'Follow'}</button>`;}
function archiveView() {
  const ps=published().filter(p=>state().saved.includes(p.id));
  return heading('Collected, not consumed','Your private archive.','The ideas you want to keep close.',ps.length?btn(`${icon('export',15)} Export list`,'export-archive'):'')+(ps.length?`<div class="entry-grid full-grid">${ps.map(card).join('')}</div>`:empty('Keep something worth returning to.','Use the bookmark on any entry to start your personal collection.','atelier','Find your first entry'));
}
function bubble(m, mineSide, who) {
  return `<div class="chat-message ${mineSide?'mine':''}"><div class="bubble">${esc(m.text)}</div><small>${esc(who)} · ${date(m.date)}</small></div>`;
}
function circleView() {
  const s=state();
  if(role()==='creator'&&mine()) {
    const me=mine(), threads=[...new Map(s.messages.filter(m=>m.creatorId===me.id).map(m=>[m.memberId,m.memberName])).entries()];
    if(!contact||!threads.some(([id])=>id===contact))contact=threads[0]?.[0]||'';
    const thread=s.messages.filter(m=>m.creatorId===me.id&&m.memberId===contact), name=threads.find(([id])=>id===contact)?.[1]||'';
    return heading('A direct line','Your circle.','Conversations members have started with your atelier.')+`<div class="conversation-layout"><aside class="conversation-list"><h2>Conversations</h2>${threads.length?threads.map(([id,n])=>`<button class="conversation-person ${contact===id?'active':''}" ${action('contact',id)} aria-pressed="${contact===id}">${avatar({name:n})}<span><strong>${esc(n)}</strong><small>Member</small></span></button>`).join(''):'<p class="field-help">No conversations yet.</p>'}</aside><section class="conversation-main">${contact?`<header class="conversation-header"><div><h2>${esc(name)}</h2><p>Member of your circle</p></div></header><div class="conversation-history" aria-label="Conversation history">${thread.map(m=>bubble(m,m.from==='creator',m.from==='creator'?'You':name)).join('')}</div><form class="conversation-form" data-form="message"><label class="visually-hidden" for="message-text">Your reply</label><textarea id="message-text" name="text" required maxlength="2000" placeholder="Write a reply…"></textarea><button class="button" type="submit">${icon('send',16)}<span>Reply</span></button></form>`:`<div class="empty"><h3>A quiet inbox.</h3><p>When a member writes to your atelier, the conversation appears here. Share a circle note to start one.</p>${btn(`${icon('message',15)} Write a circle note`,'broadcast','','button secondary')}</div>`}</section></div>`;
  }
  const people=s.creators.filter(c=>c.id!==mine()?.id);
  if(!contact||!people.some(c=>c.id===contact))contact=(people.find(c=>s.following.includes(c.id))||people[0])?.id||'';
  const c=creator(contact);
  const thread=[...s.notes.filter(n=>n.creatorId===c.id).map(n=>({...n,from:'note'})),...s.messages.filter(m=>m.creatorId===c.id&&m.memberId===user.id)].sort((a,b)=>new Date(a.date)-new Date(b.date));
  return heading('A direct line','Your circle.','A quieter place for the conversation to continue.')+`<div class="conversation-layout"><aside class="conversation-list"><h2>Conversations</h2>${people.map(p=>`<button class="conversation-person ${contact===p.id?'active':''}" ${action('contact',p.id)} aria-pressed="${contact===p.id}">${avatar(p)}<span><strong>${esc(p.name)}</strong><small>${esc(p.category)}${s.following.includes(p.id)?' / Following':''}</small></span></button>`).join('')}</aside><section class="conversation-main">${contact?`<header class="conversation-header"><div><h2>${esc(c.name)}</h2><p>${esc(c.descriptor)}</p></div><button class="icon-button" ${action('profile',c.id)} aria-label="View creator">${icon('arrow')}</button></header><div class="conversation-history" aria-label="Conversation history">${thread.length?thread.map(m=>bubble(m,m.from==='member',m.from==='member'?'You':m.from==='note'?`${c.name} · Circle note`:c.name)).join(''):'<div class="empty"><h3>Start a conversation.</h3><p>Ask a question about an entry. Only you and the creator can read this thread.</p></div>'}</div><form class="conversation-form" data-form="message"><label class="visually-hidden" for="message-text">Your message</label><textarea id="message-text" name="text" required maxlength="2000" placeholder="Something on your mind?"></textarea><button class="button" type="submit">${icon('send',16)}<span>Send</span></button></form><div class="conversation-note">Private between you and ${esc(c.name)}.</div>`:'<div class="empty"><h3>No creators yet.</h3></div>'}</section></div>`;
}
function membershipsView() {
  const memberships=Object.entries(state().memberships);
  return heading('Choose your level of connection','Your memberships.','A home for the creators you choose to support.')+`<div class="membership-summary"><div><div class="eyebrow bronze">Monthly total once payments launch</div><p class="field-help">${memberships.length} memberships · free during early access</p></div><strong>${money(membershipTotal(state()))}<small> / month</small></strong></div>${memberships.length?memberships.map(([id,tierId])=>{const c=creator(id),t=tier(tierId);return `<div class="membership-row">${avatar(c)}<div><h3>${esc(c.name)}</h3><p>${esc(t?.name)} · ${money(t?.price)} / month · Free in early access</p></div>${btn('Manage','membership',id)}${btn('Cancel','cancel-membership',id)}</div>`}).join(''):empty('A circle starts with one connection.','Visit a creator’s atelier to explore their memberships.','discover','Discover creators')}`;
}
function settingsView() {
  const s=state();
  return heading('A few personal details','Make yourself at home.','Your profile, shaped around you.')+`<div class="settings-layout"><div><section class="settings-section"><h2>Your profile</h2><p>Your display name is visible to creators you write to or join.</p><form data-form="profile"><div class="field"><label for="profile-name">Display name</label><input id="profile-name" name="name" value="${esc(s.profile.name)}" required maxlength="60"></div><div class="field"><label for="profile-bio">A line about you</label><textarea id="profile-bio" name="bio" maxlength="240">${esc(s.profile.bio)}</textarea></div><label class="check-label"><input name="compact" type="checkbox" ${s.preferences.compact?'checked':''}> Use compact entry cards</label><button class="button">Save profile ${icon('check',16)}</button></form></section></div><div><section class="settings-section"><h2>Your account</h2><p>Signed in as <strong>${esc(user?.email||'')}</strong>.</p>${btn('Sign out','sign-out')}</section><section class="settings-section"><h2>Your memberships</h2><p>${Object.keys(s.memberships).length} active memberships. Change or cancel them at any time.</p><a class="button secondary" href="#memberships">Manage memberships ${icon('arrow',15)}</a></section><section class="settings-section"><h2>Your data belongs with you.</h2><p>Export your profile, follows, saved entries, memberships and conversations as JSON.</p>${btn(`${icon('export',15)} Export my data`,'export-data')}</section><section class="settings-section"><h2>Early access</h2><p>REFLUENZ is free to join. Paid memberships will be enabled once payments launch; until then, joining a circle costs nothing.</p><a class="text-link" href="/index.html">Back to the introduction ${icon('arrow',14)}</a></section></div></div>`;
}
function atelierForm(c) {
  const v=c||{name:state().profile.name,category:'Style',descriptor:'',location:'',bio:'',image:'atelier'};
  return `<form class="dialog-body" data-form="atelier"><div class="field"><label for="atelier-name">Atelier name</label><input id="atelier-name" name="name" required minlength="2" maxlength="60" value="${esc(v.name)}"></div><div class="field"><label for="atelier-descriptor">What you make</label><input id="atelier-descriptor" name="descriptor" maxlength="60" placeholder="e.g. Architecture & spaces" value="${esc(v.descriptor)}"></div><div class="field"><label for="atelier-location">Location</label><input id="atelier-location" name="location" maxlength="60" placeholder="City, Country" value="${esc(v.location)}"></div><div class="field"><label for="atelier-category">Category</label><select id="atelier-category" name="category">${categories.map(x=>`<option ${v.category===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label for="atelier-image">Cover study</label><select id="atelier-image" name="image">${covers.map(i=>`<option value="${i}" ${v.image===i?'selected':''}>${i[0].toUpperCase()+i.slice(1)}</option>`).join('')}</select></div><div class="field"><label for="atelier-bio">Your point of view</label><textarea id="atelier-bio" name="bio" maxlength="400" placeholder="A few lines for the people who find you">${esc(v.bio)}</textarea></div><div id="atelier-error" class="form-error" role="alert"></div><div class="dialog-actions"><button class="button">${c?'Save atelier':'Open my atelier'} ${icon('arrow',14)}</button></div></form>`;
}
function studioView() {
  if(role()!=='creator'||!mine())return heading('The other side of the circle','Your work deserves a home.','Open an atelier to publish entries and build a circle of members.')+`<div class="empty">${icon('studio',30)}<h3>Open your atelier.</h3><p>It takes a minute. You can keep reading as a member at any time.</p>${btn('Open my atelier','open-atelier','','button')}</div>`;
  const me=mine(),own=state().entries.filter(p=>p.creatorId===me.id),visible=own.filter(p=>p.status===studioTab).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const members=circleMembers||[], total=members.reduce((n,m)=>n+(tier(m.tier)?.price||0),0);
  return heading(`${esc(me.name)} / Creator workspace`,'Inside your studio.','Give your next idea a place to become something.',btn(`${icon('plus',16)} New entry`,'new-entry','','button'))+
  `<div class="studio-grid"><div><div class="metric-grid"><div class="metric"><span class="eyebrow">Published entries</span><strong>${own.filter(p=>p.status==='published').length}</strong><small>In your atelier</small></div><div class="metric"><span class="eyebrow">Members</span><strong>${circleMembers?members.length:'—'}</strong><small>Across all tiers</small></div><div class="metric"><span class="eyebrow">Monthly value</span><strong>${circleMembers?money(total):'—'}</strong><small>Once payments launch</small></div></div><div class="edition-tabs" role="group" aria-label="Studio view">${['published','draft','members'].map(t=>`<button class="${studioTab===t?'active':''}" ${action('studio-tab',t)} aria-pressed="${studioTab===t}">${t==='draft'?'Drafts':t==='members'?'Members':'Published'}</button>`).join('')}</div>${studioTab==='members'?`<div class="subhead"><h2>Your circle</h2>${members.length?btn(`${icon('export',14)} Export CSV`,'export-members'):''}</div>${members.length?`<div class="table-wrap"><table class="member-table"><thead><tr><th>Member</th><th>Membership</th><th>Joined</th></tr></thead><tbody>${members.map(m=>`<tr><td>${esc(m.name)}</td><td>${esc(tier(m.tier)?.name)}</td><td>${date(m.joined)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><h3>Your circle is forming.</h3><p>Members who join any of your tiers appear here.</p></div>`}`:visible.length?visible.map(p=>`<article class="studio-entry"><img src="${image(p.image)}" alt="Entry cover"><div><h3>${esc(p.title)}</h3><p>${esc(p.format)} · ${p.minutes} min read · ${date(p.date)}</p><span class="status-label">${p.status==='draft'?'Draft · Only in your studio':p.access==='public'?'Open to everyone':`${esc(tier(p.access)?.name)} members`}</span></div><div class="actions"><button class="icon-button" ${action('read',p.id)} aria-label="Preview ${esc(p.title)}">${icon('play',16)}</button><button class="icon-button" ${action('edit',p.id)} aria-label="Edit ${esc(p.title)}">${icon('studio',16)}</button><button class="icon-button" ${action('delete-entry',p.id)} aria-label="Delete ${esc(p.title)}">${icon('trash',16)}</button></div></article>`).join(''):`<div class="empty"><h3>A clean page.</h3><p>Your next entry starts with an observation.</p>${btn('Write an entry','new-entry','','button')}</div>`}</div><aside class="studio-aside"><span class="eyebrow bronze">A note to your circle</span><h2>Keep the conversation close.</h2><p>A small update, a question, a new direction. Notes appear in every member’s conversation with you.</p>${btn(`${icon('message',15)} Write a note`,'broadcast','','button secondary')}<div class="divider"></div><span class="eyebrow muted">Your atelier</span><p class="field-help">${esc(me.descriptor||me.category)}<br>${esc(me.location)}<br>${esc(me.name)}</p>${btn('Edit atelier','edit-atelier','','text-link bare')}${btn('View as a member','role','member','text-link bare')}</aside></div><div class="studio-mobile-note">${btn(`${icon('message',15)} Write a circle note`,'broadcast')}</div>`;
}
function render() {
  const draft=document.querySelector('#message-text')?.value;
  if(authReady&&(!user||recovering)){app.innerHTML=authView();document.title='Sign in — REFLUENZ';return;}
  if(!data){app.innerHTML=`<main id="main" class="auth-screen loading-screen" tabindex="-1"><div class="auth-panel"><a class="wordmark" href="/index.html">REFLUENZ</a>${loadError?`<div class="error-banner" role="alert">${esc(loadError)}</div>${btn('Try again','retry','','button')}`:'<p class="eyebrow">Opening your atelier…</p>'}</div></main>`;return;}
  const view=route(), views={atelier:atelierView,discover:discoverView,archive:archiveView,circle:circleView,memberships:membershipsView,settings:settingsView,studio:studioView};
  const focused=document.activeElement;
  const focusAction=focused?.dataset?.action, focusId=focused?.dataset?.id;
  app.innerHTML=shell((views[view]||atelierView)());
  if(draft&&document.querySelector('#message-text'))document.querySelector('#message-text').value=draft;
  document.querySelector('.conversation-history')?.scrollTo(0,100000);
  if(focusAction && globalThis.CSS) document.querySelector(`[data-action="${CSS.escape(focusAction)}"][data-id="${CSS.escape(focusId||'')}"]`)?.focus({preventScroll:true});
  document.title=`${pages[view]||'The atelier'} — REFLUENZ`;
  if(view==='studio'&&mine()&&!circleMembers)loadMembers();
}
async function loadMembers(){try{circleMembers=await api.circleMembers(mine().id);if(route()==='studio')render()}catch(e){toast(e.message)}}

// Reader, profile and membership dialogs use escaped text throughout.
async function readEntry(id) {
  const p=entry(id); if(!p)return toast('That entry is no longer available.');
  const c=creator(p.creatorId),own=mine()?.id===p.creatorId;
  if(p.status==='draft'&&!own)return toast('This entry is still in the studio.');
  if(!bodies.has(id)){try{bodies.set(id,await api.body(id))}catch(e){return toast(e.message)}}
  const body=bodies.get(id), allowed=body!=null;
  readerId=id;
  openModal(`<span class="eyebrow">${esc(c.name)} / ${esc(p.format)}${p.status==='draft'?' / Draft preview':''}</span>`,
   `<img class="reader-cover" src="${image(p.image)}" alt="${esc(p.category)} editorial cover"><article class="reader-content"><div class="eyebrow bronze">${esc(p.category)} · ${p.access==='public'?'Open entry':esc(tier(p.access)?.name||p.access)+' circle'}</div><h2>${esc(p.title)}</h2><p class="reader-deck">${esc(p.subtitle)}</p><div class="reader-byline">By ${esc(c.name)} · ${date(p.date)} · ${p.minutes} min read${own?' · Your entry':''}</div><div class="reader-body">${(allowed?body:p.excerpt).split('\n\n').map(t=>`<p>${esc(t)}</p>`).join('')}</div>${!allowed?`<div class="reader-lock">${icon('lock',24)}<h3>There’s more inside the circle.</h3><p>This entry is part of ${esc(c.name)}’s ${esc(tier(p.access)?.name||p.access)} membership. Join the circle to keep reading — free during early access.</p>${btn('Explore memberships','membership',c.id,'button')}</div>`:''}<div class="reader-actions">${p.status==='published'?saveButton(p)+`<button class="icon-button ${state().liked.includes(id)?'liked':''}" ${action('like',id)} aria-label="Appreciate this entry" aria-pressed="${state().liked.includes(id)}">${icon('heart',18)}</button><button class="icon-button" ${action('share',id)} aria-label="Copy entry link">${icon('export',18)}</button>`:''}${btn('Visit atelier','profile',c.id,'button secondary small')}</div></article>`,'reader');
}
function profile(id) {
  const c=creator(id),ps=published().filter(p=>p.creatorId===id),own=mine()?.id===id;
  openModal('The creator’s atelier',`<div class="dialog-body"><div class="creator-profile-head">${avatar(c)}<div><h3>${esc(c.name)}</h3><p>${esc(c.descriptor)}${c.location?' · '+esc(c.location):''}</p></div></div><p>${esc(c.bio)}</p><div class="dialog-actions">${own?btn('Open your studio','role','creator','button'):followButton(c.id)+btn('Explore memberships','membership',c.id,'button')+btn('Conversation','open-contact',c.id)}</div><div class="subhead section-space"><h2>From this atelier</h2><span>${ps.length} entries</span></div>${ps.map(p=>`<div class="profile-entry-row"><button class="entry-title" ${action('read',p.id)}>${esc(p.title)} ${icon('arrow',14)}</button><span class="eyebrow muted">${accessLabel(p.access)} · ${p.minutes} min</span></div>`).join('')}</div>`);
}
function membership(id,chosen) {
  if(mine()?.id===id)return toast('This is your own atelier.');
  membershipCreator=id;selectedTier=chosen||state().memberships[id]||'essential';
  const c=creator(id),current=state().memberships[id];
  openModal(`Join ${esc(c.name.split(' ')[0])}’s circle.`,`<div class="dialog-body"><p>A little closer to the work. Choose the level of connection that suits you.</p><div class="membership-grid">${state().tiers.map(t=>`<button class="tier-option ${selectedTier===t.id?'selected':''}" ${action('select-tier',t.id)} aria-pressed="${selectedTier===t.id}"><strong>${esc(t.name)}</strong><div class="price">${money(t.price)}<small> / mo</small></div><p>${esc(t.description)}</p><ul>${t.features.map(f=>`<li>${icon('check',11)} ${esc(f)}</li>`).join('')}</ul></button>`).join('')}</div><div class="notice section-space">Early access: joining is free. Prices shown will apply once payments launch, and you will be asked before anything is charged.</div><div class="dialog-actions">${btn(current===selectedTier?'Your current plan':current?'Change membership':'Join the circle','activate-membership',id,'button')}${current?btn('Cancel membership','cancel-membership',id):''}</div></div>`,'membership-dialog');
}
function editor(id='') {
  if(role()!=='creator'||!mine())return;
  const p=id?entry(id):{title:'',subtitle:'',category:mine().category,access:'public',image:mine().image,format:'Essay'};
  if(!p||id&&p.creatorId!==mine().id)return;
  const body=id?bodies.get(id)??'':'';
  editorId=id;editorDirty=false;
  openModal(id?'Edit your entry.':'Start with a point of view.',`<form class="editor-form" data-form="entry"><div class="editor-columns"><div><div class="field"><label for="entry-title">Title</label><input id="entry-title" name="title" required minlength="3" maxlength="100" placeholder="Give your idea a name" value="${esc(p.title)}"></div><div class="field"><label for="entry-subtitle">Introduction</label><input id="entry-subtitle" name="subtitle" maxlength="180" placeholder="A line that invites someone in" value="${esc(p.subtitle)}"></div><div class="field"><label for="entry-body">Your entry</label><textarea id="entry-body" name="body" required minlength="30" maxlength="20000" placeholder="What have you been noticing?">${esc(body)}</textarea><p class="field-help">Plain text. Separate paragraphs with a blank line. The first paragraph is the free preview of member entries.</p></div></div><aside><label for="entry-image">Cover study</label><select id="entry-image" name="image">${covers.map(i=>`<option value="${i}" ${p.image===i?'selected':''}>${i[0].toUpperCase()+i.slice(1)}</option>`).join('')}</select><img id="editor-cover" class="editor-cover-preview" src="${image(p.image)}" alt="Selected cover"><div class="field"><label for="entry-category">Category</label><select id="entry-category" name="category">${categories.map(c=>`<option ${p.category===c?'selected':''}>${c}</option>`).join('')}</select></div><div class="field"><label for="entry-format">Format</label><select id="entry-format" name="format">${['Essay','Guide','Studio note','Field note','Collection'].map(f=>`<option ${p.format===f?'selected':''}>${f}</option>`).join('')}</select></div><div class="field"><label for="entry-access">Who can read</label><select id="entry-access" name="access">${['public',...state().tiers.map(t=>t.id)].map(a=>`<option value="${a}" ${p.access===a?'selected':''}>${a==='public'?'Everyone':esc(tier(a).name)+' circle'}</option>`).join('')}</select></div></aside></div><div id="entry-error" class="form-error" role="alert"></div><div class="editor-footer"><span>Drafts are only visible in your studio.</span><div><button type="button" class="button secondary" ${action('preview-entry')}>Preview</button><button class="button secondary" name="intent" value="draft">Save draft</button><button class="button" name="intent" value="published">${id&&p.status==='published'?'Update entry':'Publish'} ${icon('arrow',14)}</button></div></div><div id="editor-preview"></div></form>`,'editor-dialog');
}
function getEditorValues(){return validateEntry(Object.fromEntries(new FormData(modal.querySelector('form'))),state().tiers);}
function download(name, content, type='application/json') {
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const flip=(list,id)=>!list.includes(id);

async function handleAction(name,id,target) {
  switch(name) {
    case 'close':closeModal();break;
    case 'retry':loadError='';render();await start();break;
    case 'auth-mode':authMode=id;authNotice='';render();document.querySelector('#auth-email,#auth-name')?.focus();break;
    case 'settings':go('settings');break;
    case 'about':openModal('A quick way in.',`<div class="dialog-body"><p><strong>01 / Discover.</strong> Read an open entry, save it to your archive, and follow a creator whose work speaks to you.</p><p><strong>02 / Connect.</strong> Join a creator’s circle to read member entries, and write to them privately in Your circle.</p><p><strong>03 / Create.</strong> Switch to Creator, open your own atelier, and publish entries for everyone or for a membership tier.</p><div class="notice">Early access: memberships are free until payments launch.</div><div class="dialog-actions">${btn('Make it yours','settings','','button')}${btn('Start exploring','close')}</div></div>`);break;
    case 'role':if(!closeModal())return;setRole(id);circleMembers=null;contact='';go(id==='creator'?'studio':'atelier');break;
    case 'filter':activeFilter=id;render();break;
    case 'save':{const on=flip(state().saved,id);if(await run(()=>api.setBookmark(id,on),on?'Saved to your private archive.':'Removed from your archive.')&&readerId===id)readEntry(id);break;}
    case 'like':{const on=flip(state().liked,id);if(await run(()=>api.setLike(id,on),'',false))readEntry(id);break;}
    case 'read':readEntry(id);break;
    case 'profile':readerId='';profile(id);break;
    case 'follow':{const on=flip(state().following,id);if(await run(()=>api.setFollow(id,on),on?`You’re following ${creator(id).name}.`:'Removed from your following list.')&&modal.open)profile(id);break;}
    case 'dismiss-welcome':await run(()=>api.dismissWelcome());break;
    case 'clear-search':query='';category='All';render();break;
    case 'contact':contact=id;render();break;
    case 'open-contact':if(role()==='creator'){setRole('member');}contact=id;go('circle');break;
    case 'membership':readerId='';membership(id);break;
    case 'select-tier':membership(membershipCreator,id);break;
    case 'activate-membership':{
      if(state().memberships[id]===selectedTier){toast('This is already your plan.');break;}
      const tierId=selectedTier;
      if(await run(async()=>{await api.joinCircle(id,tierId);if(!state().following.includes(id))await api.setFollow(id,true)},`Welcome to ${creator(id).name}’s circle.`,false)){bodies.clear();closeModal();go('memberships')}
      break;
    }
    case 'cancel-membership':openModal('Leave this circle?',`<div class="dialog-body"><p>Your saved entries will stay in your archive. Member entries will return to preview access.</p><div class="dialog-actions">${btn('Keep membership','membership',id,'button secondary')}${btn('Cancel membership','confirm-cancel',id,'button')}</div></div>`);break;
    case 'confirm-cancel':if(await run(()=>api.leaveCircle(id),'Membership cancelled.')){bodies.clear();closeModal()}break;
    case 'share':{
      const url=new URL('/app.html',location.origin);url.hash=`entry/${encodeURIComponent(id)}`;
      try{await navigator.clipboard.writeText(url.href);toast('Entry link copied.')}catch{openModal('Copy this entry link.',`<div class="dialog-body"><label for="share-url">Entry link</label><input id="share-url" readonly value="${esc(url.href)}"></div>`);modal.querySelector('input').select()}break;
    }
    case 'export-data':{const s=state();download('refluenz-my-data.json',JSON.stringify({account:user?.email,profile:s.profile,preferences:s.preferences,following:s.following.map(id=>creator(id).name),saved:published().filter(p=>s.saved.includes(p.id)).map(p=>p.title),memberships:Object.entries(s.memberships).map(([id,t])=>({creator:creator(id).name,tier:t})),messages:s.messages.filter(m=>m.memberId===user?.id).map(m=>({creator:creator(m.creatorId).name,from:m.from,text:m.text,date:m.date})),atelier:mine()},null,2));toast('Your data is exported.');break;}
    case 'export-archive':download('refluenz-reading-list.json',JSON.stringify(published().filter(p=>state().saved.includes(p.id)).map(p=>({title:p.title,creator:creator(p.creatorId).name,access:p.access,url:`${location.origin}/app.html#entry/${p.id}`})),null,2));break;
    case 'sign-out':if(!closeModal())return;try{await api.signOut()}catch(e){toast(e.message)}break;
    case 'studio-tab':studioTab=id;render();break;
    case 'open-atelier':openModal('Open your atelier.',atelierForm(null));break;
    case 'edit-atelier':openModal('Your atelier.',atelierForm(mine()));break;
    case 'new-entry':editor();break;
    case 'edit':if(!bodies.has(id)){try{bodies.set(id,await api.body(id))}catch(e){return toast(e.message)}}editor(id);break;
    case 'delete-entry':if(entry(id)?.creatorId===mine()?.id)openModal('Remove this entry?',`<div class="dialog-body"><p>“${esc(entry(id).title)}” will be permanently removed from your atelier and from members’ archives.</p><div class="dialog-actions">${btn('Keep entry','close')}${btn('Delete entry','confirm-delete',id,'button')}</div></div>`);break;
    case 'confirm-delete':if(entry(id)?.creatorId===mine()?.id&&await run(()=>api.deleteEntry(id),'Entry removed.')){bodies.delete(id);closeModal()}break;
    case 'preview-entry':try{const p=getEditorValues();modal.querySelector('#entry-error').textContent='';modal.querySelector('#editor-preview').innerHTML=`<section class="editor-preview"><div class="eyebrow bronze">Reader preview / ${esc(p.access)}</div><h3>${esc(p.title)}</h3>${p.body.split('\n\n').map(t=>`<p>${esc(t)}</p>`).join('')}</section>`;modal.querySelector('#editor-preview').scrollIntoView({block:'nearest'});}catch(e){modal.querySelector('#entry-error').textContent=e.message}break;
    case 'broadcast':if(role()==='creator'&&mine())openModal('A note to your circle.',`<form class="dialog-body" data-form="broadcast"><p>Your note appears in the conversation of everyone who visits your atelier’s circle.</p><label for="broadcast-text">Your note</label><textarea id="broadcast-text" name="text" required maxlength="2000" placeholder="A small update, a thought, a question…"></textarea><div class="dialog-actions"><button class="button" type="submit">Publish note ${icon('send',15)}</button></div></form>`);break;
    case 'export-members':download('refluenz-members.csv',[['Name','Tier','Joined'],...(circleMembers||[]).map(m=>[m.name,tier(m.tier)?.name||m.tier,m.joined.slice(0,10)])].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('Member list exported.');break;
  }
}
document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(el){e.preventDefault();handleAction(el.dataset.action,el.dataset.id,el)}});
document.addEventListener('change',e=>{if(e.target.id==='category'){category=e.target.value;render()}if(e.target.id==='entry-image')modal.querySelector('#editor-cover').src=image(e.target.value)});
modal.addEventListener('input',e=>{if(e.target.closest('[data-form="entry"]'))editorDirty=true});
async function authSubmit(fn){
  if(busy)return;busy=true;const button=document.querySelector('.auth-form .button');if(button)button.disabled=true;
  try{await fn()}catch(error){authNotice=error.message;render()}finally{busy=false;if(button?.isConnected)button.disabled=false}
}
document.addEventListener('submit',async e=>{
  const form=e.target.closest('[data-form]');if(!form)return;e.preventDefault();const values=Object.fromEntries(new FormData(form));
  const email=String(values.email||'').trim(), password=String(values.password||'');
  switch(form.dataset.form){
    case 'signin':await authSubmit(()=>api.signIn(email,password));break;
    case 'signup':{const name=String(values.name||'').trim();if(!name){authNotice='Please enter a display name.';return render()}await authSubmit(async()=>{const {confirmed}=await api.signUp(email,password,name);if(!confirmed){authMode='signin';authNotice=`Almost there. We sent a confirmation link to ${email}. Open it, then sign in.`;render()}});break;}
    case 'forgot':await authSubmit(async()=>{await api.resetPassword(email);authMode='signin';authNotice='If an account exists for that email, a reset link is on its way.';render()});break;
    case 'recover':await authSubmit(async()=>{await api.updatePassword(password);recovering=false;authMode='signin';authNotice='';toast('Your password is updated.');await start()});break;
    case 'search':query=String(values.query||'').trim();go('discover');break;
    case 'profile':{const name=String(values.name||'').trim();if(!name)return toast('Please enter a display name.');await run(()=>api.saveProfile({name:name.slice(0,60),bio:String(values.bio||'').trim().slice(0,240),compact:values.compact==='on'}),'Your profile is saved.');break;}
    case 'message':{
      const text=String(values.text||'').trim().slice(0,2000);if(!text)return toast('Write a message first.');
      const asCreator=role()==='creator'&&mine();
      if(await run(()=>asCreator?api.sendMessage(mine().id,contact,'creator',text):api.sendMessage(contact,user.id,'member',text),'',false)){const box=document.querySelector('#message-text');if(box)box.value='';render()}
      break;
    }
    case 'atelier':{
      let v;try{v=validateAtelier(values)}catch(err){modal.querySelector('#atelier-error').textContent=err.message;return}
      const existing=mine();
      if(await run(()=>api.saveAtelier(v,existing?.id),existing?'Your atelier is updated.':'Your atelier is open. Write your first entry.',false)){closeModal(true);setRole('creator');go('studio')}
      else if(modal.querySelector('#atelier-error'))modal.querySelector('#atelier-error').textContent='That did not save. Check the details and try again.';
      break;
    }
    case 'entry':{
      let v;try{v=getEditorValues()}catch(error){modal.querySelector('#entry-error').textContent=error.message;return}
      const status=e.submitter?.value==='draft'?'draft':'published';
      if(await run(async()=>{const id=await api.saveEntry(editorId,v,status);bodies.set(id,v.body)},'',false)){editorDirty=false;closeModal(true);studioTab=status;go('studio');toast(status==='draft'?'Draft saved in your studio.':'Entry published to your atelier.')}
      break;
    }
    case 'broadcast':{const text=String(values.text||'').trim();if(!text)return toast('Write a note first.');if(!mine())return;if(await run(()=>api.postNote(mine().id,text),'Your note is shared with your circle.'))closeModal();break;}
  }
});
window.addEventListener('hashchange',()=>{if(!closeModal())return;render();window.scrollTo(0,0);document.querySelector('#main')?.focus({preventScroll:true});if(route()==='entry')readSharedEntry()});
function readSharedEntry(){if(!data)return;try{readEntry(decodeURIComponent(location.hash.slice(7)))}catch{toast('This entry link is not valid.')}}

async function start() {
  try { await refresh(); loadError=''; }
  catch (error) { data=null; loadError=error.message; }
  render();
  if(data&&route()==='entry')readSharedEntry();
}
let live=false;
// Supabase emits INITIAL_SESSION on subscribe, so this is the single entry point.
api.onAuthChange(async(event,session)=>{
  authReady=true;
  const next=session?.user||null;
  if(event==='PASSWORD_RECOVERY'){user=next;recovering=true;authMode='recover';authNotice='';render();return;}
  if(!next){user=null;data=null;circleMembers=null;bodies.clear();render();return;}
  if(user?.id===next.id&&data)return;
  user=next;data=null;render();await start();
  if(!live){live=true;api.subscribe(async()=>{if(!user||busy)return;try{await refresh();if(!modal.open)render()}catch{}})}
});
const params=new URLSearchParams(location.search);
if(params.get('role')==='creator'){setRole('creator');history.replaceState(null,'',`${location.pathname}#studio`);}
render();
return {handleAction, render};
}

function safeStorage() {
  try { return window.localStorage; } catch { return {getItem:()=>null, setItem(){}}; }
}
