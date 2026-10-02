import { creators, tiers, sampleMembers } from './data.js';
import { createStore, escapeHTML as esc, canRead, validateEntry, toggle, membershipTotal, csvCell } from './store.js';
import { icon } from './icons.js';

// Deliberately local demo: no authentication, payments or messages leave this browser.
let storage;
try { storage = window.localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw Error('Storage unavailable'); } }; }
const store = createStore(storage);
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
let activeFilter = 'All entries', query = '', category = 'All', contact = 'elena';
let studioTab = 'published', membershipCreator = '', selectedTier = 'essential';
let readerId = '', editorId = '', editorDirty = false, toastTimer;
const state = () => store.state;
const creator = id => creators.find(c => c.id === id) || creators[0];
const entry = id => state().entries.find(e => e.id === id);
const image = name => `/editorial/${['atelier','ritual','architecture'].includes(name) ? name : 'atelier'}.png`;
const avatar = c => `<span class="avatar" aria-hidden="true">${esc(c.initials || c.name.split(' ').map(n => n[0]).slice(0,2).join(''))}</span>`;
const money = n => `€${n}`;
const date = value => new Date(value).toLocaleDateString('en-GB', {day:'numeric',month:'short'});
const action = (name, id = '') => `data-action="${name}" data-id="${esc(id)}"`;
const btn = (label, name, id='', classes='button secondary small') => `<button class="${classes}" ${action(name,id)}>${label}</button>`;
const published = () => state().entries.filter(e => e.status === 'published').sort((a,b) => new Date(b.date)-new Date(a.date));
const route = () => location.hash.slice(1).split('/')[0] || 'atelier';
const pages = {atelier:'The atelier',discover:'Discover',archive:'Private archive',circle:'Your circle',memberships:'Memberships',studio:'Creator studio',settings:'Settings'};

function toast(message) {
  clearTimeout(toastTimer);
  const el = document.querySelector('#toast');
  el.textContent = message; el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}
function update(fn, message, redraw=true) {
  try { store.update(fn); if(redraw) render(); if(message) toast(message); return true; }
  catch(error) { toast(error.message); return false; }
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
  modal.close(); document.body.style.overflow = ''; return true;
}
modal.addEventListener('cancel', e => { e.preventDefault(); closeModal(); });
modal.addEventListener('close', () => { document.body.style.overflow = ''; });
modal.addEventListener('click', e => {
  if(e.target !== modal) return;
  const r = modal.getBoundingClientRect();
  if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) closeModal();
});
window.addEventListener('beforeunload', e => { if(editorDirty) { e.preventDefault(); e.returnValue=''; } });

function navLink(id, label, name, mobile=false) {
  const active = route() === id;
  return `<a href="#${id}" class="${mobile?'':'nav-link '}${active?'active':''}" ${active?'aria-current="page"':''}>${icon(name)}<span>${label}</span>${!mobile&&id==='archive'&&state().saved.length?`<span class="nav-count">${state().saved.length}</span>`:''}</a>`;
}
function shell(content) {
  const s = state(), c = s.role === 'creator' ? creators[0] : s.profile;
  return `<aside class="app-sidebar"><a class="wordmark" href="/index.html">REFLUENZ</a><div class="eyebrow sidebar-caption">The digital atelier</div><div class="nav-section">Your private space</div><nav class="side-nav" aria-label="Platform navigation">
  ${navLink('atelier','The atelier','grid')}${navLink('discover','Discover','compass')}${navLink('archive','Private archive','bookmark')}${navLink('circle','Your circle','message')}${navLink('memberships','Memberships','members')}${s.role==='creator'?navLink('studio','Creator studio','studio'):''}</nav>
  <div class="sidebar-bottom"><div class="sidebar-studio"><span class="eyebrow bronze">${s.role==='creator'?'The other side':'Made for your work'}</span><p>${s.role==='creator'?'See your work through the eyes of your circle.':'Your point of view deserves a place of its own.'}</p><button class="text-link bare" ${action('role',s.role==='creator'?'member':'creator')}>${s.role==='creator'?'View as a member':'Open creator studio'} ${icon('arrow',14)}</button></div><div class="sidebar-footer-links"><a href="/index.html">About REFLUENZ ${icon('arrow',12)}</a><a href="#settings" aria-label="Settings">${icon('settings',16)}</a></div><button class="profile-button" ${action('settings')}>${avatar(c)}<span><strong>${esc(c.name)}</strong><small>${s.role==='creator'?'Creator preview':'Your demo profile'}</small></span></button></div></aside>
  <div class="app-layout"><header class="app-topbar"><a class="wordmark mobile-wordmark" href="/index.html">REFLUENZ</a><div class="breadcrumb">Your space <span>/</span> <strong>${pages[route()]||pages.atelier}</strong></div><div class="topbar-right"><form class="search-box" data-form="search">${icon('search',16)}<input name="query" aria-label="Search creators and entries" placeholder="Search the atelier" maxlength="100" value="${esc(query)}"></form><div class="role-switch" aria-label="Demo perspective"><button ${action('role','member')} class="${s.role==='member'?'active':''}" aria-pressed="${s.role==='member'}">Member</button><button ${action('role','creator')} class="${s.role==='creator'?'active':''}" aria-pressed="${s.role==='creator'}">Creator</button></div></div></header>
  <div class="demo-strip"><span><strong>INTERACTIVE DEMO</strong> <span>— Your changes stay in this browser. No real payments.</span></span><button ${action('about')}>How to explore</button></div>${store.warning?`<div class="error-banner" role="alert">${esc(store.warning)}</div>`:''}
  <main id="main" class="workspace ${s.preferences.compact?'compact':''}" tabindex="-1">${content}<footer class="view-footer"><span>REFLUENZ · Independent by design</span><span>Demo edition / 001</span></footer></main></div>
  <nav class="mobile-bar" aria-label="Mobile navigation">${navLink('atelier','Atelier','grid',true)}${navLink('discover','Discover','compass',true)}${navLink('archive','Archive','bookmark',true)}${navLink('circle','Circle','message',true)}${navLink(s.role==='creator'?'studio':'settings',s.role==='creator'?'Studio':'You',s.role==='creator'?'studio':'user',true)}</nav>`;
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
  return `<article class="entry-card"><button class="entry-cover" ${action('read',p.id)} aria-label="Read ${esc(p.title)}"><img src="${image(p.image)}" alt="${esc(p.category)} editorial cover" loading="lazy"><span class="access-badge">${locked?icon('lock',10):''}${p.access==='public'?'Open entry':esc(p.access)}</span></button><div class="entry-details"><div class="eyebrow">${esc(c.name)} / ${esc(p.category)}</div><h3><button class="entry-title" ${action('read',p.id)}>${esc(p.title)}</button></h3><p>${esc(p.subtitle)}</p><div class="entry-card-footer"><span>${esc(p.format)} · ${p.minutes} min</span>${saveButton(p)}</div></div></article>`;
}
function empty(title,text,link='discover',label='Explore the atelier') {
  return `<div class="empty">${icon('bookmark',26)}<h3>${title}</h3><p>${text}</p><a class="button secondary" href="#${link}">${label} ${icon('arrow')}</a></div>`;
}
function feature(p) {
  const c = creator(p.creatorId);
  return `<article class="feature-entry"><button class="feature-picture" ${action('read',p.id)} aria-label="Read ${esc(p.title)}"><img src="${image(p.image)}" alt="A study in ${esc(p.category.toLowerCase())}"><span class="cover-label">The considered edit / 001</span></button><div class="feature-info"><div class="entry-author">${avatar(c)}<span>${esc(c.name)}<small>${esc(c.descriptor)}</small></span></div><h2><button ${action('read',p.id)}>${esc(p.title)}</button></h2><p>${esc(p.subtitle)}</p><button class="text-link" ${action('read',p.id)}>Read the entry ${icon('arrow',15)}</button><div class="feature-meta"><span class="eyebrow">${esc(p.format)} · ${p.minutes} min read</span>${saveButton(p)}</div></div></article>`;
}
function rail() {
  const list = creators.filter(c=>state().following.includes(c.id));
  return `<aside class="right-rail"><div class="rail-section"><h2 class="rail-title">Your circle <span>${String(list.length).padStart(2,'0')}</span></h2>${list.length?list.map(c=>`<div class="rail-person">${avatar(c)}<div class="rail-person-name">${esc(c.name)}<small>${esc(c.descriptor)}</small></div><button class="icon-button" ${action('profile',c.id)} aria-label="View ${esc(c.name)}">${icon('arrow',14)}</button></div>`).join(''):'<p class="field-help">Follow a creator to start your circle.</p>'}<a href="#discover" class="text-link">Discover a new voice ${icon('plus',12)}</a></div><div class="rail-note"><span class="eyebrow">A note from the studio</span><blockquote>“Not more current.<br>More yours.”</blockquote><p>On building a wardrobe around a point of view, rather than a moment.</p><button class="text-link bare" ${action('read','p1')}>From Elena’s journal ${icon('arrow',13)}</button></div><div class="rail-footer">No ads. No algorithm.<br>Just the people you choose.<br><a href="/index.html">The REFLUENZ manifesto ↗</a></div></aside>`;
}
function atelierView() {
  let posts=published();
  if(activeFilter==='Following')posts=posts.filter(p=>state().following.includes(p.creatorId));
  else if(activeFilter!=='All entries')posts=posts.filter(p=>p.category===activeFilter);
  const first=posts[0];
  return heading('Selected for a slower scroll','Your daily edit.','Good work, from people with a point of view.','<div class="date-stamp">A considered collection<br>Edition 001</div>')+
  `<div class="content-columns"><div><div class="edition-tabs" role="group" aria-label="Filter entries">${['All entries','Following','Style','Beauty','Design','Culture'].map(f=>`<button ${action('filter',f)} class="${activeFilter===f?'active':''}" aria-pressed="${activeFilter===f}">${f}</button>`).join('')}</div>${first?feature(first):empty('A little room for discovery.','Follow a creator or choose another category to find your next read.')}${posts.length>1?`<div class="subhead"><h2>From the atelier</h2><span>${posts.length-1} entries to explore</span></div><div class="entry-grid">${posts.slice(1).map(card).join('')}</div>`:''}${!state().welcomeDismissed?`<div class="welcome-card"><p>A space that feels like you.<small>Make a demo profile, then find your first circle.</small></p><a class="text-link" href="#settings">Make it yours ${icon('arrow',14)}</a><button class="icon-button" ${action('dismiss-welcome')} aria-label="Dismiss welcome">${icon('close',14)}</button></div>`:''}</div>${rail()}</div>`;
}
function discoverView() {
  const q=query.toLowerCase();
  const cs=creators.filter(c=>(category==='All'||c.category===category)&&`${c.name} ${c.descriptor} ${c.bio}`.toLowerCase().includes(q));
  const ps=published().filter(p=>(category==='All'||p.category===category)&&`${p.title} ${p.subtitle} ${creator(p.creatorId).name}`.toLowerCase().includes(q));
  return heading('Independent voices','Find your people.','Follow a point of view. Stay for the conversation.')+`<div class="filter-row"><form class="search-box" data-form="search">${icon('search',16)}<input name="query" aria-label="Search discovery" value="${esc(query)}" maxlength="100" placeholder="A name, an idea, a point of view…"></form><select id="category" aria-label="Filter by category">${['All','Style','Beauty','Design','Culture'].map(c=>`<option ${c===category?'selected':''}>${c}</option>`).join('')}</select></div><p class="results-label">${query?`Results for “${esc(query)}” · `:''}${cs.length} creators · ${ps.length} entries</p><div class="creator-grid">${cs.map(c=>`<article class="creator-card"><div class="creator-cover"><img src="${image(c.image)}" alt="${esc(c.descriptor)}" loading="lazy"><span class="eyebrow">${esc(c.location)}</span></div><div class="creator-details"><div class="creator-name"><h2>${esc(c.name)}</h2><span class="eyebrow bronze">${esc(c.category)}</span></div><p>${esc(c.bio)}</p><div class="creator-actions"><button class="text-link bare" ${action('profile',c.id)}>Visit atelier ${icon('arrow',14)}</button>${followButton(c.id)}</div></div></article>`).join('')}</div>${ps.length?`<div class="subhead section-space"><h2>Entries to spend time with</h2><span>${ps.length} entries</span></div><div class="entry-grid full-grid">${ps.map(card).join('')}</div>`:''}${!cs.length&&!ps.length?`<div class="empty"><h3>No matches this time.</h3><p>Try a creator’s name, “style”, or a shorter search.</p>${btn('Clear search','clear-search')}</div>`:''}`;
}
function followButton(id) {const on=state().following.includes(id);return `<button class="button secondary small" ${action('follow',id)} aria-pressed="${on}">${icon(on?'check':'plus',13)} ${on?'Following':'Follow'}</button>`;}
function archiveView() {
  const ps=published().filter(p=>state().saved.includes(p.id));
  return heading('Collected, not consumed','Your private archive.','The ideas you want to keep close.',ps.length?btn(`${icon('export',15)} Export list`,'export-archive'):'')+(ps.length?`<div class="entry-grid full-grid">${ps.map(card).join('')}</div>`:empty('Keep something worth returning to.','Use the bookmark on any entry to start your personal collection.','atelier','Find your first entry'));
}
function circleView() {
  const c=creator(contact),messages=state().messages.filter(m=>m.creatorId===c.id);
  return heading('A direct line','Your circle.','A quieter place for the conversation to continue.')+`<div class="conversation-layout"><aside class="conversation-list"><h2>Conversations</h2>${creators.map(c=>`<button class="conversation-person ${contact===c.id?'active':''}" ${action('contact',c.id)} aria-pressed="${contact===c.id}">${avatar(c)}<span><strong>${c.name}</strong><small>${c.category} / Demo</small></span></button>`).join('')}</aside><section class="conversation-main"><header class="conversation-header"><div><h2>${c.name}</h2><p>${c.descriptor}</p></div><button class="icon-button" ${action('profile',c.id)} aria-label="View creator">${icon('arrow')}</button></header><div class="conversation-history" aria-label="Conversation history">${messages.length?messages.map(m=>`<div class="chat-message ${m.from==='member'?'mine':''}"><div class="bubble">${esc(m.text)}</div><small>${m.from==='member'?'You':esc(c.name)} · ${date(m.date)} · ${m.sample?'Sample message':'Saved in this demo'}</small></div>`).join(''):'<div class="empty"><h3>Start a conversation.</h3><p>Try a question about an entry. Your message stays in this demo.</p></div>'}</div><form class="conversation-form" data-form="message"><label class="visually-hidden" for="message-text">Your message</label><textarea id="message-text" name="text" required maxlength="2000" placeholder="Something on your mind?"></textarea><button class="button" type="submit">${icon('send',16)}<span>Send in demo</span></button></form><div class="conversation-note">Local conversation preview. No message is delivered to a real person.</div></section></div>`;
}
function membershipsView() {
  const memberships=Object.entries(state().memberships);
  return heading('Choose your level of connection','Your memberships.','A home for the creators you choose to support.')+`<div class="membership-summary"><div><div class="eyebrow bronze">Illustrative monthly total</div><p class="field-help">${memberships.length} demo memberships · nothing is charged</p></div><strong>${money(membershipTotal(state()))}<small> / month</small></strong></div>${memberships.length?memberships.map(([id,tierId])=>{const c=creator(id),t=tiers.find(t=>t.id===tierId);return `<div class="membership-row">${avatar(c)}<div><h3>${c.name}</h3><p>${t.name} · ${money(t.price)} / month · Demo access</p></div>${btn('Manage','membership',id)}${btn('Cancel','cancel-membership',id)}</div>`}).join(''):empty('A circle starts with one connection.','Visit a creator’s atelier to explore their sample memberships.','discover','Discover creators')}`;
}
function settingsView() {
  const s=state();
  return heading('A few personal details','Make yourself at home.','Your demo, shaped around you.')+`<div class="settings-layout"><div><section class="settings-section"><h2>Your profile</h2><p>Visible only in this browser. No sign-up or email address needed.</p><form data-form="profile"><div class="field"><label for="profile-name">Display name</label><input id="profile-name" name="name" value="${esc(s.profile.name)}" required maxlength="60"></div><div class="field"><label for="profile-bio">A line about you</label><textarea id="profile-bio" name="bio" maxlength="240">${esc(s.profile.bio)}</textarea></div><label class="check-label"><input name="compact" type="checkbox" ${s.preferences.compact?'checked':''}> Use compact entry cards</label><button class="button">Save profile ${icon('check',16)}</button></form></section></div><div><section class="settings-section"><h2>Your memberships</h2><p>${Object.keys(s.memberships).length} active demo memberships. Explore, change, or cancel your sample plans at any time.</p><a class="button secondary" href="#memberships">Manage memberships ${icon('arrow',15)}</a></section><section class="settings-section"><h2>Your data belongs with you.</h2><p>Export your demo profile, saved list, messages and creator drafts as JSON. Reset removes this demo’s changes from this browser.</p>${btn(`${icon('export',15)} Export demo data`,'export-data')}${btn('Reset this demo','reset')}</section><section class="settings-section"><h2>About this preview</h2><p>This is an interactive product demonstration. All creators and prices are illustrative. Memberships, publishing and conversations are local simulations. There are no live payments, authentication, analytics, or email deliveries.</p><a class="text-link" href="/index.html">Back to the introduction ${icon('arrow',14)}</a></section></div></div>`;
}
function studioView() {
  if(state().role!=='creator')return heading('The other side of the circle','Your work deserves a home.','Try the creator perspective to see how an atelier comes together.')+`<div class="empty">${icon('studio',30)}<h3>Step into Elena’s studio.</h3><p>Draft an entry, preview it, and publish to the demo. Then switch to the member view to see the result.</p>${btn('Enter creator preview','role','creator','button')}</div>`;
  const own=state().entries.filter(p=>p.creatorId==='elena'),visible=own.filter(p=>p.status===studioTab).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const total=sampleMembers.reduce((n,m)=>n+tiers.find(t=>t.id===m.tier).price,0);
  return heading('Elena Voss / Creator workspace','Inside your studio.','Give your next idea a place to become something.',btn(`${icon('plus',16)} New entry`,'new-entry','','button'))+
  `<div class="studio-grid"><div><div class="metric-grid"><div class="metric"><span class="eyebrow">Published entries</span><strong>${own.filter(p=>p.status==='published').length}</strong><small>In this demo atelier</small></div><div class="metric"><span class="eyebrow">Sample members</span><strong>${sampleMembers.length}</strong><small>Illustrative audience</small></div><div class="metric"><span class="eyebrow">Sample monthly income</span><strong>${money(total)}</strong><small>Before fees · Not revenue</small></div></div><div class="edition-tabs" role="group" aria-label="Studio view">${['published','draft','members'].map(t=>`<button class="${studioTab===t?'active':''}" ${action('studio-tab',t)} aria-pressed="${studioTab===t}">${t==='draft'?'Drafts':t==='members'?'Members':'Published'}</button>`).join('')}</div>${studioTab==='members'?`<div class="subhead"><h2>Your sample circle</h2>${btn(`${icon('export',14)} Export CSV`,'export-members')}</div><div class="table-wrap"><table class="member-table"><thead><tr><th>Member</th><th>Membership</th><th>Joined</th></tr></thead><tbody>${sampleMembers.map(m=>`<tr><td>${esc(m.name)}</td><td>${tiers.find(t=>t.id===m.tier).name}</td><td>${date(m.joined)}</td></tr>`).join('')}</tbody></table></div><p class="field-help">Five fictional records for demonstration. No real customer data.</p>`:visible.length?visible.map(p=>`<article class="studio-entry"><img src="${image(p.image)}" alt="Entry cover"><div><h3>${esc(p.title)}</h3><p>${p.format} · ${p.minutes} min read · ${date(p.date)}</p><span class="status-label">${p.status==='draft'?'Draft · Only in your studio':`${p.access==='public'?'Open to everyone':p.access+' members'}`}</span></div><div class="actions"><button class="icon-button" ${action('read',p.id)} aria-label="Preview ${esc(p.title)}">${icon('play',16)}</button><button class="icon-button" ${action('edit',p.id)} aria-label="Edit ${esc(p.title)}">${icon('studio',16)}</button><button class="icon-button" ${action('delete-entry',p.id)} aria-label="Delete ${esc(p.title)}">${icon('trash',16)}</button></div></article>`).join(''):`<div class="empty"><h3>A clean page.</h3><p>Your next entry starts with an observation.</p>${btn('Write an entry','new-entry','','button')}</div>`}</div><aside class="studio-aside"><span class="eyebrow bronze">A note to your circle</span><h2>Keep the conversation close.</h2><p>A small update, a question, a new direction. Share a note with your demo circle.</p>${btn(`${icon('message',15)} Write a note`,'broadcast','','button secondary')}<div class="divider"></div><span class="eyebrow muted">Your atelier</span><p class="field-help">Style & culture<br>Paris, France<br>Elena Voss</p>${btn('View as a member','role','member','text-link bare')}</aside></div><div class="studio-mobile-note">${btn(`${icon('message',15)} Write a circle note`,'broadcast')}</div>`;
}
function render() {
  const view=route(), views={atelier:atelierView,discover:discoverView,archive:archiveView,circle:circleView,memberships:membershipsView,settings:settingsView,studio:studioView};
  const focused=document.activeElement;
  const focusAction=focused?.dataset?.action, focusId=focused?.dataset?.id;
  app.innerHTML=shell((views[view]||atelierView)());
  if(focusAction && globalThis.CSS) document.querySelector(`[data-action="${CSS.escape(focusAction)}"][data-id="${CSS.escape(focusId||'')}"]`)?.focus({preventScroll:true});
  document.title=`${pages[view]||'The atelier'} — REFLUENZ`;
}

// Reader, profile and membership dialogs use escaped text throughout.
function readEntry(id) {
  const p=entry(id); if(!p)return toast('That entry is no longer available.');
  if(p.status==='draft'&&state().role!=='creator')return toast('This entry is still in the studio.');
  const c=creator(p.creatorId),ownPreview=state().role==='creator'&&p.creatorId==='elena';
  const allowed=canRead(p,state())||ownPreview;
  readerId=id;
  if(allowed&&!state().read.includes(id))update(s=>s.read.push(id),'',false);
  openModal(`<span class="eyebrow">${esc(c.name)} / ${esc(p.format)}${p.status==='draft'?' / Draft preview':''}</span>`,
   `<img class="reader-cover" src="${image(p.image)}" alt="${esc(p.category)} editorial cover"><article class="reader-content"><div class="eyebrow bronze">${esc(p.category)} · ${p.access==='public'?'Open entry':esc(p.access)+' circle'}</div><h2>${esc(p.title)}</h2><p class="reader-deck">${esc(p.subtitle)}</p><div class="reader-byline">By ${esc(c.name)} · ${date(p.date)} · ${p.minutes} min read${ownPreview?' · Creator preview':''}</div><div class="reader-body">${(allowed?p.body:p.body.split('\n\n')[0]).split('\n\n').map(t=>`<p>${esc(t)}</p>`).join('')}</div>${!allowed?`<div class="reader-lock">${icon('lock',24)}<h3>There’s more inside the circle.</h3><p>This entry is part of ${esc(c.name)}’s ${esc(p.access)} membership. Try a demo membership to keep reading. No payment is collected.</p>${btn('Explore demo memberships','membership',c.id,'button')}</div>`:''}<div class="reader-actions">${saveButton(p)}<button class="icon-button ${state().liked.includes(id)?'liked':''}" ${action('like',id)} aria-label="Appreciate this entry" aria-pressed="${state().liked.includes(id)}">${icon('heart',18)}</button><button class="icon-button" ${action('share',id)} aria-label="Copy entry link">${icon('export',18)}</button>${btn('Visit atelier','profile',c.id,'button secondary small')}</div></article>`,'reader');
}
function profile(id) {
  const c=creator(id),ps=published().filter(p=>p.creatorId===id);
  openModal('The creator’s atelier',`<div class="dialog-body"><div class="creator-profile-head">${avatar(c)}<div><h3>${c.name}</h3><p>${c.descriptor} · ${c.location}</p></div></div><p>${c.bio}</p><div class="dialog-actions">${followButton(c.id)}${btn('Explore memberships','membership',c.id,'button')}${btn('Conversation','open-contact',c.id)}</div><div class="subhead section-space"><h2>From this atelier</h2><span>${ps.length} entries</span></div>${ps.map(p=>`<div class="profile-entry-row"><button class="entry-title" ${action('read',p.id)}>${esc(p.title)} ${icon('arrow',14)}</button><span class="eyebrow muted">${esc(p.access)} · ${p.minutes} min</span></div>`).join('')}</div>`);
}
function membership(id,chosen) {
  membershipCreator=id;selectedTier=chosen||state().memberships[id]||'essential';
  const c=creator(id),current=state().memberships[id];
  openModal(`Join ${c.name.split(' ')[0]}’s circle.`,`<div class="dialog-body"><p>A little closer to the work. Choose a sample plan to explore the full experience.</p><div class="membership-grid">${tiers.map(t=>`<button class="tier-option ${selectedTier===t.id?'selected':''}" ${action('select-tier',t.id)} aria-pressed="${selectedTier===t.id}"><strong>${t.name}</strong><div class="price">${money(t.price)}<small> / mo</small></div><p>${t.description}</p><ul>${t.features.map(f=>`<li>${icon('check',11)} ${f}</li>`).join('')}</ul></button>`).join('')}</div><div class="notice section-space">Demo membership only. No charge, card details, or real subscription. Access is saved in this browser.</div><div class="dialog-actions">${btn(current===selectedTier?'Current demo plan':current?'Change demo membership':'Activate demo membership','activate-membership',id,'button')}${current?btn('Cancel membership','cancel-membership',id):''}</div></div>`,'membership-dialog');
}
function editor(id='') {
  if(state().role!=='creator')return;
  const p=id?entry(id):{title:'',subtitle:'',body:'',category:'Style',access:'public',image:'atelier',format:'Essay'};
  if(!p||id&&p.creatorId!=='elena')return;
  editorId=id;editorDirty=false;
  openModal(id?'Edit your entry.':'Start with a point of view.',`<form class="editor-form" data-form="entry"><div class="editor-columns"><div><div class="field"><label for="entry-title">Title</label><input id="entry-title" name="title" required minlength="3" maxlength="100" placeholder="Give your idea a name" value="${esc(p.title)}"></div><div class="field"><label for="entry-subtitle">Introduction</label><input id="entry-subtitle" name="subtitle" maxlength="180" placeholder="A line that invites someone in" value="${esc(p.subtitle)}"></div><div class="field"><label for="entry-body">Your entry</label><textarea id="entry-body" name="body" required minlength="30" maxlength="20000" placeholder="What have you been noticing?">${esc(p.body)}</textarea><p class="field-help">Plain text. Separate paragraphs with a blank line.</p></div></div><aside><label for="entry-image">Cover study</label><select id="entry-image" name="image">${['atelier','ritual','architecture'].map(i=>`<option value="${i}" ${p.image===i?'selected':''}>${i[0].toUpperCase()+i.slice(1)}</option>`).join('')}</select><img id="editor-cover" class="editor-cover-preview" src="${image(p.image)}" alt="Selected cover"><div class="field"><label for="entry-category">Category</label><select id="entry-category" name="category">${['Style','Beauty','Design','Culture'].map(c=>`<option ${p.category===c?'selected':''}>${c}</option>`).join('')}</select></div><div class="field"><label for="entry-access">Who can read</label><select id="entry-access" name="access">${['public',...tiers.map(t=>t.id)].map(a=>`<option value="${a}" ${p.access===a?'selected':''}>${a==='public'?'Everyone':a[0].toUpperCase()+a.slice(1)+' circle'}</option>`).join('')}</select></div><input type="hidden" name="format" value="${esc(p.format||'Essay')}"></aside></div><div id="entry-error" class="form-error" role="alert"></div><div class="editor-footer"><span>Saved locally when you save or publish.</span><div><button type="button" class="button secondary" ${action('preview-entry')}>Preview</button><button class="button secondary" name="intent" value="draft">Save draft</button><button class="button" name="intent" value="published">${id&&p.status==='published'?'Update entry':'Publish in demo'} ${icon('arrow',14)}</button></div></div><div id="editor-preview"></div></form>`,'editor-dialog');
}
function getEditorValues(){return validateEntry(Object.fromEntries(new FormData(modal.querySelector('form'))));}
function download(name, data, type='application/json') {
  const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function handleAction(name,id,target) {
  switch(name) {
    case 'close':closeModal();break;
    case 'settings':go('settings');break;
    case 'about':openModal('A quick way in.',`<div class="dialog-body"><p><strong>01 / Discover.</strong> Read an open entry, save it to your archive, and follow a creator whose work speaks to you.</p><p><strong>02 / Connect.</strong> Activate a sample membership to explore a circle entry. Try a conversation in the local inbox.</p><p><strong>03 / Create.</strong> Switch to Creator, draft a new entry, and publish it. Switch back to Member to see it in the atelier.</p><div class="notice">All actions stay in this browser. No real account, payment, or message delivery is involved.</div><div class="dialog-actions">${btn('Make it yours','settings','','button')}${btn('Start exploring','close')}</div></div>`);break;
    case 'role':if(!closeModal())return;if(update(s=>s.role=id,'',false))go(id==='creator'?'studio':'atelier');break;
    case 'filter':activeFilter=id;render();break;
    case 'save':if(update(s=>toggle(s.saved,id),'',false)){render();if(readerId)readEntry(readerId);toast(state().saved.includes(id)?'Saved to your private archive.':'Removed from your archive.')}break;
    case 'like':if(update(s=>toggle(s.liked,id),'',false))readEntry(id);break;
    case 'read':readEntry(id);break;
    case 'profile':readerId='';profile(id);break;
    case 'follow':if(update(s=>toggle(s.following,id),'',false)){render();if(modal.open)profile(id);toast(state().following.includes(id)?`You’re following ${creator(id).name}.`:'Removed from your following list.')}break;
    case 'dismiss-welcome':update(s=>s.welcomeDismissed=true);break;
    case 'clear-search':query='';category='All';render();break;
    case 'contact':contact=id;render();break;
    case 'open-contact':contact=id;go('circle');break;
    case 'membership':readerId='';membership(id);break;
    case 'select-tier':membership(membershipCreator,id);break;
    case 'activate-membership':if(update(s=>{s.memberships[id]=selectedTier;if(!s.following.includes(id))s.following.push(id)},'Demo membership active. No payment was taken.')){closeModal();go('memberships')}break;
    case 'cancel-membership':openModal('Leave this demo circle?',`<div class="dialog-body"><p>Your saved entries will stay in your archive. Member-only entries will return to preview access.</p><div class="dialog-actions">${btn('Keep membership','membership',id,'button secondary')}${btn('Cancel demo membership','confirm-cancel',id,'button')}</div></div>`);break;
    case 'confirm-cancel':if(update(s=>{delete s.memberships[id]},'Demo membership cancelled.'))closeModal();break;
    case 'share':{
      const url=new URL('/app.html',location.origin);url.hash=`entry/${encodeURIComponent(id)}`;
      try{await navigator.clipboard.writeText(url.href);toast('Entry link copied. Custom entries exist only in this browser.')}catch{openModal('Copy this entry link.',`<div class="dialog-body"><label for="share-url">Entry link</label><input id="share-url" readonly value="${esc(url.href)}"><p class="field-help">Select and copy this link. Custom demo entries are only available in this browser.</p></div>`);modal.querySelector('input').select()}break;
    }
    case 'export-data':download('refluenz-demo-data.json',JSON.stringify(state(),null,2));toast('Demo data exported.');break;
    case 'export-archive':download('refluenz-reading-list.json',JSON.stringify(published().filter(p=>state().saved.includes(p.id)).map(p=>({title:p.title,creator:creator(p.creatorId).name,access:p.access,url:`${location.origin}/app.html#entry/${p.id}`})),null,2));break;
    case 'reset':openModal('Start with a clean page?',`<div class="dialog-body"><p>This removes your demo profile changes, bookmarks, memberships, conversations and creator entries from this browser. Export your data first if you want a copy.</p><div class="dialog-actions">${btn('Keep my demo','close')}${btn('Reset demo','confirm-reset','','button')}</div></div>`);break;
    case 'confirm-reset':try{store.reset();closeModal(true);query='';category='All';activeFilter='All entries';go('atelier');toast('Your demo has been reset.')}catch(e){toast(e.message)}break;
    case 'studio-tab':studioTab=id;render();break;
    case 'new-entry':editor();break;
    case 'edit':editor(id);break;
    case 'delete-entry':if(entry(id)?.creatorId==='elena'&&state().role==='creator')openModal('Remove this entry?',`<div class="dialog-body"><p>“${esc(entry(id).title)}” will be removed from the demo atelier and any local reading lists.</p><div class="dialog-actions">${btn('Keep entry','close')}${btn('Delete entry','confirm-delete',id,'button')}</div></div>`);break;
    case 'confirm-delete':if(state().role==='creator'&&entry(id)?.creatorId==='elena'&&update(s=>{s.entries=s.entries.filter(p=>p.id!==id);s.saved=s.saved.filter(p=>p!==id);s.liked=s.liked.filter(p=>p!==id)},'Entry removed.'))closeModal();break;
    case 'preview-entry':try{const p=getEditorValues();modal.querySelector('#entry-error').textContent='';modal.querySelector('#editor-preview').innerHTML=`<section class="editor-preview"><div class="eyebrow bronze">Reader preview / ${esc(p.access)}</div><h3>${esc(p.title)}</h3><p>${esc(p.body)}</p></section>`;modal.querySelector('#editor-preview').scrollIntoView({block:'nearest'});}catch(e){modal.querySelector('#entry-error').textContent=e.message}break;
    case 'broadcast':if(state().role==='creator')openModal('A note to your circle.',`<form class="dialog-body" data-form="broadcast"><p>Publish a local note from Elena’s studio. It will appear in the member’s circle conversation.</p><label for="broadcast-text">Your note</label><textarea id="broadcast-text" name="text" required maxlength="2000" placeholder="A small update, a thought, a question…"></textarea><div class="dialog-actions"><button class="button" type="submit">Publish demo note ${icon('send',15)}</button></div></form>`);break;
    case 'export-members':download('refluenz-sample-members.csv',[['Name','Email','Tier','Joined'],...sampleMembers.map(m=>[m.name,m.email,m.tier,m.joined])].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('Sample member list exported.');break;
  }
}
document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(el){e.preventDefault();handleAction(el.dataset.action,el.dataset.id,el)}});
document.addEventListener('change',e=>{if(e.target.id==='category'){category=e.target.value;render()}if(e.target.id==='entry-image')modal.querySelector('#editor-cover').src=image(e.target.value)});
modal.addEventListener('input',e=>{if(e.target.closest('[data-form="entry"]'))editorDirty=true});
document.addEventListener('submit',e=>{
  const form=e.target.closest('[data-form]');if(!form)return;e.preventDefault();const data=Object.fromEntries(new FormData(form));
  switch(form.dataset.form){
    case 'search':query=String(data.query||'').trim();go('discover');break;
    case 'profile':{const name=String(data.name||'').trim();if(!name)return toast('Please enter a display name.');update(s=>{s.profile={name:name.slice(0,60),bio:String(data.bio||'').trim().slice(0,240)};s.preferences.compact=data.compact==='on'},'Your profile is saved.');break;}
    case 'message':{const text=String(data.text||'').trim();if(!text)return toast('Write a message first.');update(s=>s.messages.push({id:crypto.randomUUID(),creatorId:contact,from:'member',text:text.slice(0,2000),date:new Date().toISOString()}),'Message saved in this demo.');document.querySelector('.conversation-history')?.scrollTo(0,100000);break;}
    case 'entry':try{const values=getEditorValues(),status=e.submitter?.value==='draft'?'draft':'published',id=editorId||crypto.randomUUID();if(state().role!=='creator')return;const existing=entry(id);if(update(s=>{const p={...values,id,creatorId:'elena',status,date:existing?.date||new Date().toISOString()};const at=s.entries.findIndex(e=>e.id===id);if(at<0)s.entries.unshift(p);else s.entries[at]=p},'',false)){editorDirty=false;closeModal(true);studioTab=status;go('studio');toast(status==='draft'?'Draft saved in your studio.':'Entry published to the demo atelier.')}}catch(error){modal.querySelector('#entry-error').textContent=error.message}break;
    case 'broadcast':{const text=String(data.text||'').trim();if(!text)return toast('Write a note first.');if(state().role!=='creator')return;if(update(s=>s.messages.push({id:crypto.randomUUID(),creatorId:'elena',from:'creator',text:text.slice(0,2000),date:new Date().toISOString()}),'Your note is published in the demo circle.'))closeModal();break;}
  }
});
window.addEventListener('hashchange',()=>{closeModal();render();window.scrollTo(0,0);document.querySelector('#main')?.focus({preventScroll:true});if(route()==='entry'){readSharedEntry()}});
const params=new URLSearchParams(location.search);
if(params.get('role')==='creator') {update(s=>s.role='creator','',false);history.replaceState(null,'',`${location.pathname}#studio`);}
render();
if(route()==='entry')readSharedEntry();
function readSharedEntry(){try{readEntry(decodeURIComponent(location.hash.slice(7)))}catch{toast('This entry link is not valid.')}}

// Exported for lightweight integration tests; the browser still mounts automatically above.
export { handleAction, render };
