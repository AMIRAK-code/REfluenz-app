// Supabase data layer. Every call returns plain objects shaped for the views,
// and every write is authorised by row level security on the server.
const initials = name => String(name || '').split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase();
const toCreator = c => ({id:c.id, slug:c.slug, ownerId:c.owner_id, name:c.name, initials:initials(c.name), category:c.category, descriptor:c.descriptor, location:c.location, image:c.image, bio:c.bio});
const toEntry = e => ({id:e.id, creatorId:e.creator_id, title:e.title, subtitle:e.subtitle, excerpt:e.excerpt, category:e.category, format:e.format, image:e.image, minutes:e.minutes, access:e.access, status:e.status, date:e.published_at || e.created_at});
const friendly = error => {
  const text = error?.message || String(error);
  if (/Invalid login credentials/i.test(text)) return 'That email and password do not match.';
  if (/Email not confirmed/i.test(text)) return 'Confirm your email first. Check your inbox for the link.';
  if (/User already registered/i.test(text)) return 'An account with this email already exists. Sign in instead.';
  if (/duplicate key.*slug/i.test(text)) return 'That atelier address is taken. Try another name.';
  if (/row-level security/i.test(text)) return 'You do not have permission to do that.';
  if (/Failed to fetch|NetworkError/i.test(text)) return 'We could not reach REFLUENZ. Check your connection and try again.';
  return text;
};
const check = ({data, error}) => { if (error) throw Error(friendly(error)); return data; };

export function createApi(client) {
  let userId = null;
  const redirect = () => new URL('/app.html', location.origin).href;
  return {
    // Deferred: calling Supabase from inside the auth callback can deadlock its lock.
    onAuthChange(fn) { client.auth.onAuthStateChange((event, session) => { userId = session?.user.id || null; setTimeout(() => fn(event, session), 0); }); },
    async signIn(email, password) { check(await client.auth.signInWithPassword({email, password})); },
    async signUp(email, password, displayName) {
      const data = check(await client.auth.signUp({email, password, options:{data:{display_name:displayName}, emailRedirectTo:redirect()}}));
      return {confirmed:Boolean(data.session)};
    },
    async resetPassword(email) { check(await client.auth.resetPasswordForEmail(email, {redirectTo:redirect()})); },
    async updatePassword(password) { check(await client.auth.updateUser({password})); },
    async signOut() { check(await client.auth.signOut()); },

    async load() {
      const [profile, tiers, creators, entries, follows, bookmarks, likes, memberships, messages, notes] = await Promise.all([
        client.from('profiles').select('*').eq('id', userId).single(),
        client.from('tiers').select('*').order('level'),
        client.from('creators').select('*').order('created_at'),
        client.from('entries').select('id,creator_id,title,subtitle,excerpt,category,format,image,minutes,access,status,published_at,created_at').order('published_at', {ascending:false, nullsFirst:true}),
        client.from('follows').select('creator_id').eq('user_id', userId),
        client.from('bookmarks').select('entry_id').eq('user_id', userId),
        client.from('likes').select('entry_id').eq('user_id', userId),
        client.from('memberships').select('creator_id,tier').eq('user_id', userId),
        client.from('messages').select('id,creator_id,member_id,sender,body,created_at,member:profiles(display_name)').order('created_at'),
        client.from('circle_notes').select('id,creator_id,body,created_at').order('created_at')
      ].map(p => p.then(check)));
      const allCreators = creators.map(toCreator);
      return {
        profile:{name:profile.display_name, bio:profile.bio},
        preferences:{compact:profile.compact},
        welcomeDismissed:profile.welcome_dismissed,
        tiers,
        creators:allCreators,
        myCreator:allCreators.find(c => c.ownerId === userId) || null,
        entries:entries.map(toEntry),
        following:follows.map(f => f.creator_id),
        saved:bookmarks.map(b => b.entry_id),
        liked:likes.map(l => l.entry_id),
        memberships:Object.fromEntries(memberships.map(m => [m.creator_id, m.tier])),
        messages:messages.map(m => ({id:m.id, creatorId:m.creator_id, memberId:m.member_id, memberName:m.member?.display_name || 'Member', from:m.sender, text:m.body, date:m.created_at})),
        notes:notes.map(n => ({id:n.id, creatorId:n.creator_id, text:n.body, date:n.created_at}))
      };
    },
    // Returns the full text, or null when the reader's membership does not cover it.
    async body(entryId) { const rows = check(await client.from('entry_bodies').select('body').eq('entry_id', entryId)); return rows[0]?.body ?? null; },

    async setFollow(creatorId, on) { check(on ? await client.from('follows').insert({user_id:userId, creator_id:creatorId}) : await client.from('follows').delete().match({user_id:userId, creator_id:creatorId})); },
    async setBookmark(entryId, on) { check(on ? await client.from('bookmarks').insert({user_id:userId, entry_id:entryId}) : await client.from('bookmarks').delete().match({user_id:userId, entry_id:entryId})); },
    async setLike(entryId, on) { check(on ? await client.from('likes').insert({user_id:userId, entry_id:entryId}) : await client.from('likes').delete().match({user_id:userId, entry_id:entryId})); },
    async joinCircle(creatorId, tier) { check(await client.from('memberships').upsert({user_id:userId, creator_id:creatorId, tier, updated_at:new Date().toISOString()})); },
    async leaveCircle(creatorId) { check(await client.from('memberships').delete().match({user_id:userId, creator_id:creatorId})); },
    async sendMessage(creatorId, memberId, from, text) { check(await client.from('messages').insert({creator_id:creatorId, member_id:memberId, sender:from, body:text})); },
    async saveProfile({name, bio, compact}) { check(await client.from('profiles').update({display_name:name, bio, compact}).eq('id', userId)); },
    async dismissWelcome() { check(await client.from('profiles').update({welcome_dismissed:true}).eq('id', userId)); },

    async saveAtelier(values, id) {
      const row = {name:values.name, category:values.category, descriptor:values.descriptor, location:values.location, bio:values.bio, image:values.image};
      if (id) return check(await client.from('creators').update(row).eq('id', id));
      const slug = values.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) + '-' + Math.random().toString(36).slice(2, 6);
      check(await client.from('creators').insert({...row, slug, owner_id:userId}));
    },
    async saveEntry(id, values, status) {
      return check(await client.rpc('save_entry', {p_id:id || null, p_title:values.title, p_subtitle:values.subtitle, p_body:values.body, p_category:values.category, p_format:values.format, p_image:values.image, p_access:values.access, p_status:status}));
    },
    async deleteEntry(id) { check(await client.from('entries').delete().eq('id', id)); },
    async postNote(creatorId, text) { check(await client.from('circle_notes').insert({creator_id:creatorId, body:text})); },
    async circleMembers(creatorId) {
      const rows = check(await client.from('memberships').select('tier,created_at,member:profiles(display_name)').eq('creator_id', creatorId).order('created_at', {ascending:false}));
      return rows.map(r => ({name:r.member?.display_name || 'Member', tier:r.tier, joined:r.created_at}));
    },
    subscribe(fn) {
      return client.channel('atelier-live')
        .on('postgres_changes', {event:'INSERT', schema:'public', table:'messages'}, fn)
        .on('postgres_changes', {event:'INSERT', schema:'public', table:'circle_notes'}, fn)
        .subscribe();
    }
  };
}
