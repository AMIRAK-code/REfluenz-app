// Pure helpers shared by the views. Access checks here only decide what the UI
// offers; the server enforces the same rules through row level security.
export const categories = ['Style', 'Beauty', 'Design', 'Culture'];
export const covers = ['atelier', 'ritual', 'architecture'];
export const kinds = ['text', 'image', 'video'];
export const textFormats = ['Essay', 'Guide', 'Studio note', 'Field note', 'Collection'];
export const formats = [...textFormats, 'Gallery', 'Film'];
export const defaultFormat = { text: 'Essay', image: 'Gallery', video: 'Film' };
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function canRead(entry, state) {
  if (state.myCreator && entry.creatorId === state.myCreator.id) return true;
  if (entry.access === 'public') return true;
  const needed = state.tiers.find(t => t.id === entry.access)?.level ?? 99;
  const actual = state.tiers.find(t => t.id === state.memberships[entry.creatorId])?.level ?? 0;
  return actual >= needed;
}
// Text entries need a real body; image and video entries carry media and an optional caption.
export function validateEntry(values, tiers) {
  const kind = values.kind || 'text';
  const title = String(values.title ?? '').trim();
  const body = String(values.body ?? '').trim();
  const subtitle = String(values.subtitle ?? '').trim();
  if (!kinds.includes(kind)) throw Error('Choose a post type.');
  if (title.length < 3 || title.length > 100) throw Error('Use a title between 3 and 100 characters.');
  if (kind === 'text' && (body.length < 30 || body.length > 20000)) throw Error('Write between 30 and 20,000 characters for your entry.');
  if (body.length > 20000) throw Error('Keep the caption under 20,000 characters.');
  if (subtitle.length > 180) throw Error('Keep the introduction under 180 characters.');
  if (!['public', ...tiers.map(t => t.id)].includes(values.access)) throw Error('Choose a valid access level.');
  if (!categories.includes(values.category)) throw Error('Choose a category.');
  if (!covers.includes(values.image)) throw Error('Choose a cover.');
  const format = formats.includes(values.format) ? values.format : defaultFormat[kind];
  return { kind, title, body, subtitle, access: values.access, category: values.category, image: values.image, format, minutes: Math.max(1, Math.ceil(body.split(/\s+/).length / 200)) };
}
export function validateAtelier(values) {
  const name = String(values.name ?? '').trim();
  if (name.length < 2 || name.length > 60) throw Error('Use an atelier name between 2 and 60 characters.');
  if (!categories.includes(values.category)) throw Error('Choose a category.');
  if (!covers.includes(values.image)) throw Error('Choose a cover.');
  return { name, category: values.category, image: values.image, descriptor: String(values.descriptor ?? '').trim().slice(0, 60), location: String(values.location ?? '').trim().slice(0, 60), bio: String(values.bio ?? '').trim().slice(0, 400) };
}
export function toggle(list, value) { const i=list.indexOf(value); if(i<0)list.push(value); else list.splice(i,1); }
export function membershipTotal(state) { return Object.values(state.memberships).reduce((n,id)=>n+(state.tiers.find(t=>t.id===id)?.price||0),0); }
export function csvCell(value) { const text=String(value); return '"'+(/^[=+\-@\t\r]/.test(text)?"'":'')+text.replaceAll('"','""')+'"'; }
