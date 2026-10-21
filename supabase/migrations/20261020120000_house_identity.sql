-- The House identity (docs/HOUSE_IDENTITY.md): the three levels become Member, Private and Black Label, rows that
-- still hold the first defaults take the House defaults, and the showcase grows beyond fashion with six Studios in
-- other fields. Safe to run more than once: every statement only touches rows that are not migrated yet.
-- Apply by pasting into the Supabase SQL editor of the live project (gughgswzovomkxjlqvsr).

-- ---------------------------------------------------------------------------
-- 1. The shared ladder: names, lines and default perks for new Studios
-- ---------------------------------------------------------------------------
update public.tiers set name = 'Member', description = 'A closer look at the work.',
  features = array['Every House post', 'The complete archive', 'The members’ conversation']
  where id = 'essential' and name = 'Essential';
update public.tiers set name = 'Private', description = 'Closer to the work, closer to the creator.',
  features = array['Everything in Member', 'In-depth Studio notes', 'First in the conversation']
  where id = 'premium' and name = 'Premium';
update public.tiers set name = 'Black Label', description = 'Inside the creative process.',
  features = array['Everything in Private', 'Black Label collections', 'Private sessions and notes']
  where id = 'signature' and name = 'Signature';

-- ---------------------------------------------------------------------------
-- 2. Each Studio's own levels: only the fields a creator never changed
--    (the same exact comparison as houseTier() in src/api/util.js)
-- ---------------------------------------------------------------------------
update public.creator_tiers set name = 'Member' where tier_id = 'essential' and name = 'Essential';
update public.creator_tiers set name = 'Private' where tier_id = 'premium' and name = 'Premium';
update public.creator_tiers set name = 'Black Label' where tier_id = 'signature' and name = 'Signature';

update public.creator_tiers set description = 'Closer to the work, closer to the creator.'
  where tier_id = 'premium' and description = 'More context. More connection.';

update public.creator_tiers set perks = array['Every House post', 'The complete archive', 'The members’ conversation']
  where tier_id = 'essential' and perks = array['All circle entries', 'The complete entry archive', 'Members’ conversation'];
update public.creator_tiers set perks = array['Everything in Member', 'In-depth Studio notes', 'First in the conversation']
  where tier_id = 'premium' and perks = array['Everything in Essential', 'In-depth studio notes', 'Priority conversation prompts'];
update public.creator_tiers set perks = array['Everything in Private', 'Black Label collections', 'Private sessions and notes']
  where tier_id = 'signature' and perks = array['Everything in Premium', 'Signature reference collections', 'Private workshop notes'];

-- ---------------------------------------------------------------------------
-- 3. The showcase: Ivy's photography gets its own category, and six Studios join from other fields.
--    New creators get their three levels from the default_tiers trigger, already with the House defaults.
-- ---------------------------------------------------------------------------
update public.creators set category = 'Photography' where slug = 'ivy' and is_showcase and category = 'Culture';

insert into public.creators (slug, name, category, descriptor, location, image, bio, is_showcase) values
('noor', 'Noor Haddad', 'Writing', 'Essays & letters', 'Edinburgh, Scotland', 'architecture',
 'Essays on attention, memory and the small decisions that shape a life. A new letter most Sundays.', true),
('theo', 'Theo Marsh', 'Music', 'Composition & sound', 'Berlin, Germany', 'architecture',
 'A composer’s notebook: how a piece begins, what the studio teaches, and the sounds worth keeping.', true),
('ana', 'Ana Ruiz', 'Food', 'Cooking & seasons', 'Valencia, Spain', 'ritual',
 'Cooking with the market, not against it. Simple dishes, the reasons behind them, and a seasonal table.', true),
('kenji', 'Kenji Mori', 'Technology', 'Software & craft', 'Tokyo, Japan', 'architecture',
 'Building software slowly and well. Notes on design, tools and the craft of making things that last.', true),
('maya', 'Maya Okafor', 'Education', 'Mathematics, explained', 'Lagos, Nigeria', 'architecture',
 'Mathematics as a way of seeing. Clear explanations, good problems, and the joy of a first proof.', true),
('leo', 'Leo Brandt', 'Art', 'Film & moving image', 'Montréal, Canada', 'architecture',
 'Short films, the frames behind them, and what a single shot can hold when you let it breathe.', true)
on conflict (slug) do nothing;

-- One open post per new Studio, written only while the Studio has none.
with s as (select id from public.creators c where slug = 'noor' and is_showcase and not exists (select 1 from public.entries e where e.creator_id = c.id)),
n as (insert into public.entries (creator_id, title, subtitle, excerpt, category, format, image, minutes, access, status, published_at, created_at)
  select id, 'The unanswered letter.', 'On keeping a question open for longer than is comfortable.',
  'Some letters are not meant to be answered quickly. They are meant to be carried for a while.',
  'Writing', 'Essay', 'architecture', 2, 'public', 'published', '2026-10-18T08:00:00Z', '2026-10-18T08:00:00Z' from s returning id)
insert into public.entry_bodies (entry_id, body) select id, 'Some letters are not meant to be answered quickly. They are meant to be carried for a while.

A friend once wrote to ask whether I still believed what I had written ten years ago. I started a reply that evening and stopped after one line. The honest answer was longer than a letter, and slower than a week.

We are trained to close questions. A notification asks to be cleared, a message asks to be read, a thread asks for the last word. But the questions that change us tend to arrive without a deadline, and they keep their value only as long as we refuse to hurry them.

This week, keep one question open on purpose. Write it at the top of a page and leave the rest blank. Return to it on Sunday. You may find you have been answering it all along.' from n;

with s as (select id from public.creators c where slug = 'theo' and is_showcase and not exists (select 1 from public.entries e where e.creator_id = c.id)),
n as (insert into public.entries (creator_id, title, subtitle, excerpt, category, format, image, minutes, access, status, published_at, created_at)
  select id, 'Four bars of silence.', 'Why the rest is the hardest note to write.',
  'The most difficult thing I wrote this year was four bars in which nothing happens.',
  'Music', 'Studio note', 'architecture', 2, 'public', 'published', '2026-10-17T09:00:00Z', '2026-10-17T09:00:00Z' from s returning id)
insert into public.entry_bodies (entry_id, body) select id, 'The most difficult thing I wrote this year was four bars in which nothing happens.

The piece had been building for two minutes. Every instinct told me to keep going, to reward the listener with a bigger chord and a louder drum. Instead I took everything away. Four bars of room tone, the faint hiss of the tape, and then a single piano note.

Silence is not the absence of music. It is the moment the listener leans in. It turns what came before into a memory and what comes next into an event.

When you next listen to something you love, notice where it stops. The rests are where a composer trusts you most.' from n;

with s as (select id from public.creators c where slug = 'ana' and is_showcase and not exists (select 1 from public.entries e where e.creator_id = c.id)),
n as (insert into public.entries (creator_id, title, subtitle, excerpt, category, format, image, minutes, access, status, published_at, created_at)
  select id, 'Cook what the market gives you.', 'A Saturday method instead of a recipe.',
  'I stopped writing shopping lists two years ago. Now I write them after the market, not before.',
  'Food', 'Guide', 'ritual', 2, 'public', 'published', '2026-10-16T07:30:00Z', '2026-10-16T07:30:00Z' from s returning id)
insert into public.entry_bodies (entry_id, body) select id, 'I stopped writing shopping lists two years ago. Now I write them after the market, not before.

Walk the stalls once without buying anything. Look for what is abundant, because abundance means it is in season, cheap and at its best. This morning it was tomatoes so ripe they split, and the last green beans of the year.

Buy three things that look alive. Then build the meal around the one that needs the least help: a tomato that good wants salt, olive oil and bread, nothing else. The beans can take a little more work, a quick blanch and some garlic.

A recipe tells you what to buy. A market tells you what to cook. Learn to listen to the second one.' from n;

with s as (select id from public.creators c where slug = 'kenji' and is_showcase and not exists (select 1 from public.entries e where e.creator_id = c.id)),
n as (insert into public.entries (creator_id, title, subtitle, excerpt, category, format, image, minutes, access, status, published_at, created_at)
  select id, 'Delete before you add.', 'A small rule for software that lasts.',
  'Before I add a feature, I look for one thing to remove. It has made everything I build a little better.',
  'Technology', 'Field note', 'architecture', 2, 'public', 'published', '2026-10-15T10:00:00Z', '2026-10-15T10:00:00Z' from s returning id)
insert into public.entry_bodies (entry_id, body) select id, 'Before I add a feature, I look for one thing to remove. It has made everything I build a little better.

Software grows by accretion. Each addition is reasonable on its own, and together they become a maze that nobody, including the author, fully understands. The cost is not the code you write today. It is every decision that code makes harder tomorrow.

So the rule is simple. Open the project, find a setting nobody changes, a screen nobody visits, a function nobody calls. Remove it, run the tests, ship it. Then start the new work in a slightly lighter house.

Craft is mostly restraint. The best tools feel obvious because someone took the time to make them small.' from n;

with s as (select id from public.creators c where slug = 'maya' and is_showcase and not exists (select 1 from public.entries e where e.creator_id = c.id)),
n as (insert into public.entries (creator_id, title, subtitle, excerpt, category, format, image, minutes, access, status, published_at, created_at)
  select id, 'Why the diagonal never ends.', 'A first proof, in five minutes, with a pencil.',
  'Draw a square with sides of one. Its diagonal has a length no fraction can ever write down.',
  'Education', 'Guide', 'architecture', 2, 'public', 'published', '2026-10-14T08:00:00Z', '2026-10-14T08:00:00Z' from s returning id)
insert into public.entry_bodies (entry_id, body) select id, 'Draw a square with sides of one. Its diagonal has a length no fraction can ever write down.

Suppose it could. Then the diagonal would be a fraction p over q, written in lowest terms, and its square would be two. So p squared is twice q squared, which makes p squared even, and therefore p itself even.

Write p as two times k. Then four k squared equals two q squared, so q squared is even too, and q is even. But we said the fraction was in lowest terms, and now both numbers are even. The assumption breaks.

That is the whole proof. No machinery, only patience. The square root of two is not a fraction, and you have just shown it with the same reasoning mathematicians used more than two thousand years ago.' from n;

with s as (select id from public.creators c where slug = 'leo' and is_showcase and not exists (select 1 from public.entries e where e.creator_id = c.id)),
n as (insert into public.entries (creator_id, title, subtitle, excerpt, category, format, image, minutes, access, status, published_at, created_at)
  select id, 'Hold the shot.', 'What happens when a camera refuses to cut.',
  'The shot I am proudest of lasts ninety seconds and shows a kitchen window. Nothing in it is staged.',
  'Art', 'Studio note', 'architecture', 2, 'public', 'published', '2026-10-13T09:00:00Z', '2026-10-13T09:00:00Z' from s returning id)
insert into public.entry_bodies (entry_id, body) select id, 'The shot I am proudest of lasts ninety seconds and shows a kitchen window. Nothing in it is staged.

At first the frame is only light on a wall. Then a cloud passes, a neighbour crosses the courtyard, a kettle starts to sing somewhere out of view. By the end you know the room, the hour and something about the person who lives there, and no one has said a word.

Editing teaches us to cut at the moment of information. Holding the shot asks for something else: to stay past the point where you think you have understood, until the image starts to speak for itself.

Try it with your phone tonight. Point it at one window, press record, and do not touch it for a minute and a half.' from n;
