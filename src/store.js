import { initialState, creators, tiers } from './data.js';
export const STORAGE_KEY = 'refluenz.atelier.v1';
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tierIds = tiers.map(t => t.id);
const creatorIds = creators.map(c => c.id);
const images = ['atelier', 'ritual', 'architecture'];
const categories = ['Style', 'Beauty', 'Design', 'Culture'];

export function canRead(entry, state) {
  if (entry.access === 'public') return true;
  const needed = tiers.find(t => t.id === entry.access)?.level ?? 99;
  const actual = tiers.find(t => t.id === state.memberships[entry.creatorId])?.level ?? 0;
  return actual >= needed;
}
export function validateEntry(values) {
  const title = String(values.title ?? '').trim();
  const body = String(values.body ?? '').trim();
  const subtitle = String(values.subtitle ?? '').trim();
  if (title.length < 3 || title.length > 100) throw Error('Use a title between 3 and 100 characters.');
  if (body.length < 30 || body.length > 20000) throw Error('Write between 30 and 20,000 characters for your entry.');
  if (subtitle.length > 180) throw Error('Keep the introduction under 180 characters.');
  if (!['public', ...tierIds].includes(values.access)) throw Error('Choose a valid access level.');
  if (!categories.includes(values.category)) throw Error('Choose a category.');
  if (!images.includes(values.image)) throw Error('Choose a cover.');
  const format = ['Essay','Guide','Studio note','Field note','Collection'].includes(values.format) ? values.format : 'Essay';
  return { title, body, subtitle, access: values.access, category: values.category, image: values.image, format, minutes: Math.max(1, Math.ceil(body.split(/\s+/).length / 200)) };
}
function restore(saved) {
  if (!saved || saved.version !== 1 || !Array.isArray(saved.entries) || !saved.profile || !Array.isArray(saved.messages)) throw Error('Invalid saved data');
  const fresh = initialState();
  fresh.role = saved.role === 'creator' ? 'creator' : 'member';
  fresh.profile = {name: String(saved.profile.name || 'Aria Bennett').slice(0,60), bio: String(saved.profile.bio || '').slice(0,240)};
  fresh.entries = saved.entries.map(e => {
    if (!e || typeof e.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(e.id) || !creatorIds.includes(e.creatorId) || !['draft','published'].includes(e.status) || !Number.isFinite(Date.parse(e.date))) throw Error('Invalid saved entry');
    return {...validateEntry(e), id:e.id, creatorId:e.creatorId, status:e.status, date:e.date};
  });
  const ids = fresh.entries.map(e => e.id);
  if (new Set(ids).size !== ids.length) throw Error('Duplicate entries');
  for (const key of ['saved','liked','read']) fresh[key] = [...new Set((Array.isArray(saved[key]) ? saved[key] : []).filter(id => ids.includes(id)))];
  fresh.following = [...new Set((Array.isArray(saved.following) ? saved.following : []).filter(id => creatorIds.includes(id)))];
  fresh.memberships = Object.fromEntries(Object.entries(saved.memberships || {}).filter(([id,tier]) => creatorIds.includes(id) && tierIds.includes(tier)));
  fresh.messages = saved.messages.filter(m => m && creatorIds.includes(m.creatorId) && ['member','creator'].includes(m.from) && typeof m.text === 'string' && Number.isFinite(Date.parse(m.date))).map(m => ({id:String(m.id).slice(0,80), creatorId:m.creatorId, from:m.from, text:m.text.slice(0,2000), date:m.date, sample:Boolean(m.sample)}));
  fresh.welcomeDismissed = Boolean(saved.welcomeDismissed);
  fresh.preferences = {compact:Boolean(saved.preferences?.compact)};
  return fresh;
}
export function createStore(storage) {
  let state = initialState(), warning = '';
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) state = restore(JSON.parse(raw));
  } catch {
    warning = 'Saved data could not be loaded. A fresh demo is open. Reset the demo to replace unreadable local data.';
  }
  return {
    get state() { return state; },
    get warning() { return warning; },
    update(fn) {
      const next = structuredClone(state);
      fn(next);
      try { storage.setItem(STORAGE_KEY, JSON.stringify(next)); }
      catch { throw Error('Your browser could not save this change. Free some storage or allow site storage and try again.'); }
      state = next;
      return state;
    },
    reset() {
      const next = initialState();
      try { storage.setItem(STORAGE_KEY, JSON.stringify(next)); }
      catch { throw Error('Your browser could not reset the demo. Check site storage permissions.'); }
      state = next; warning = '';
      return state;
    }
  };
}
export function toggle(list, value) { const i=list.indexOf(value); if(i<0)list.push(value); else list.splice(i,1); }
export function membershipTotal(state) { return Object.values(state.memberships).reduce((n,id)=>n+(tiers.find(t=>t.id===id)?.price||0),0); }
export function csvCell(value) { const text=String(value); return '"'+(/^[=+\-@\t\r]/.test(text)?"'":'')+text.replaceAll('"','""')+'"'; }
