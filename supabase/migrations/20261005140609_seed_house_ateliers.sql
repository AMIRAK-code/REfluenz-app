insert into public.tiers (id,name,price,level,description,features) values
('essential','Essential',9,1,'A closer look at the work.',array['All circle entries','The complete entry archive','Members’ conversation']),
('premium','Premium',19,2,'More context. More connection.',array['Everything in Essential','In-depth studio notes','Priority conversation prompts']),
('signature','Signature',39,3,'Inside the creative process.',array['Everything in Premium','Signature reference collections','Private workshop notes']);
insert into public.creators (slug,name,category,descriptor,location,image,bio) values
('elena','Elena Voss','Style','Style & culture','Paris, France','atelier','A wardrobe as a point of view. Notes on personal style, considered objects, and the art of choosing well.'),
('sera','Sera Lin','Beauty','Beauty & daily rituals','Copenhagen, Denmark','ritual','Less on the shelf, more intention in the day. Thoughtful routines and the objects that make them feel personal.'),
('julian','Julian Dax','Design','Architecture & spaces','Lisbon, Portugal','architecture','Looking closer at the spaces we inhabit. Architecture, proportion, and the beauty of leaving room.'),
('ivy','Ivy Rena','Culture','Photography & observation','Milan, Italy','architecture','A notebook of light, shadow, and overlooked details. Finding a photograph in an ordinary afternoon.');
with n as (insert into public.entries (creator_id,title,subtitle,excerpt,category,format,image,minutes,access,status,published_at,created_at) select id,'The pieces you return to.','On finding a personal uniform, and the freedom of choosing well.','The most useful question in a wardrobe is not “What is missing?” It is “What keeps coming back?”','Style','Essay','atelier',2,'public','published','2026-09-30T09:00:00Z','2026-09-30T09:00:00Z' from public.creators where slug='elena' returning id) insert into public.entry_bodies (entry_id, body) select id, 'The most useful question in a wardrobe is not “What is missing?” It is “What keeps coming back?”

For a week, I photographed what I actually wore. Not the version of myself I imagined, but the one who walked to the bakery, took the train, and stayed late at the studio. A shape emerged: a generous coat, a narrow trouser, a shoe I could forget about.

A personal uniform does not have to look the same every day. It needs a consistent logic. Mine begins with proportion: one generous volume, one clean line, one detail with a little tension. A borrowed shirt against a carefully cut jacket. A worn leather belt with something precise.

Start with five pieces you already reach for. Lay them together and look for the conversation between them. Is it a colour? A texture? The way the fabric moves? That is the beginning of a point of view.

Then make a small rule for the next thing you buy: it must make three of those pieces feel more like you. Not more current. More yours.

This week’s exercise: wear one favourite piece three ways. Notice which version lets you stop thinking about your clothes. That is usually the one worth keeping.' from n;
with n as (insert into public.entries (creator_id,title,subtitle,excerpt,category,format,image,minutes,access,status,published_at,created_at) select id,'A slower start.','A small ritual, before the rest of the day arrives.','For a long time, my morning routine was a list of things to finish. Now I think of it as a small space to enter.','Beauty','Guide','ritual',1,'public','published','2026-09-29T09:00:00Z','2026-09-29T09:00:00Z' from public.creators where slug='sera' returning id) insert into public.entry_bodies (entry_id, body) select id, 'For a long time, my morning routine was a list of things to finish. Now I think of it as a small space to enter.

I put my phone in another room, open the curtains, and give the first cup of tea my full attention. Nothing particularly impressive happens. That is the point.

The objects on my shelf are few. A bowl I bought from a local ceramicist. A clean towel. The products I already know and enjoy. A routine is easier to keep when there is less to negotiate.

Try choosing one ordinary moment tomorrow and leaving it uninterrupted. No recording, no optimisation. Just notice the weight of a cup, the temperature of the water, the light on the wall.

A useful ritual is not one that looks good from the outside. It is one you are glad to return to.' from n;
with n as (insert into public.entries (creator_id,title,subtitle,excerpt,category,format,image,minutes,access,status,published_at,created_at) select id,'Room to think.','What an empty corner can teach us about a considered space.','An empty space is not necessarily unfinished. Sometimes it is the most deliberate part of a room.','Design','Studio note','architecture',1,'essential','published','2026-09-28T09:00:00Z','2026-09-28T09:00:00Z' from public.creators where slug='julian' returning id) insert into public.entry_bodies (entry_id, body) select id, 'An empty space is not necessarily unfinished. Sometimes it is the most deliberate part of a room.

When I begin a project, I draw the movement before the furniture. Where does someone pause? Where does light fall in the late afternoon? Which view deserves to remain open?

In this stairwell, the wall does more than carry the structure. It edits what you see. The curve slows the eye and makes the small opening at the top feel larger than it is.

You can apply the same principle without rebuilding anything. Remove one object from a crowded surface. Move a chair out of a natural path. Leave a wall without a picture for a week.

Notice whether the room becomes less complete, or simply more legible. The difference is subtle. A considered space lets the things you keep have enough room to matter.' from n;
with n as (insert into public.entries (creator_id,title,subtitle,excerpt,category,format,image,minutes,access,status,published_at,created_at) select id,'The silhouette study.','Three proportions. One coat. A different way of seeing.','Before colour and detail, there is a shape. This studio note begins with that shape and works inward.','Style','Guide','atelier',1,'premium','published','2026-09-27T09:00:00Z','2026-09-27T09:00:00Z' from public.creators where slug='elena' returning id) insert into public.entry_bodies (entry_id, body) select id, 'Before colour and detail, there is a shape. This studio note begins with that shape and works inward.

First, photograph the outline. Stand against a plain wall, use natural light, and remove distractions from the frame. Squint at the image. What survives is the silhouette.

Study one: balance volume with a straight line. A substantial coat gains clarity above a narrow trouser. Let the hem and the shoe meet without an extra visual interruption.

Study two: repeat the volume. A wide trouser under a generous coat can work beautifully when the shoulders and waist remain intentional. The silhouette should feel like a decision, not a collection of accidents.

Study three: introduce contrast through texture rather than colour. Matte wool against polished leather. A soft scarf inside a precise collar. The eye finds the difference without having to work for it.

Make three photographs, then put them away until tomorrow. Return without asking which is most flattering. Ask which feels most familiar to the person you want to be.' from n;
with n as (insert into public.entries (creator_id,title,subtitle,excerpt,category,format,image,minutes,access,status,published_at,created_at) select id,'Learning to notice.','A field note on shadows, repetition, and the everyday.','I took the same walk every afternoon for a month. The route was unremarkable: a courtyard, a narrow street, the back of a library.','Culture','Field note','architecture',1,'public','published','2026-09-26T09:00:00Z','2026-09-26T09:00:00Z' from public.creators where slug='ivy' returning id) insert into public.entry_bodies (entry_id, body) select id, 'I took the same walk every afternoon for a month. The route was unremarkable: a courtyard, a narrow street, the back of a library.

What changed was the light. A plain wall became a composition for twenty minutes, then returned to being a wall. A handrail drew a second staircase in shadow.

Try this with a place you know well. Leave your camera in your bag for the first ten minutes. Look for repetition: the same shape in different materials, a line that continues across a doorway, a shadow that almost touches another.

When you do make a photograph, take one step closer before pressing the shutter. Then one step back. The subject may stay the same, but the relationship changes.

Observation is a practice of returning. You do not need a more interesting place. You need another look.' from n;
with n as (insert into public.entries (creator_id,title,subtitle,excerpt,category,format,image,minutes,access,status,published_at,created_at) select id,'Objects with a purpose.','A shelf edited down to what earns its place.','This collection is an exercise in subtraction. Each object has a job, and each job has one object.','Beauty','Collection','ritual',1,'signature','published','2026-09-25T09:00:00Z','2026-09-25T09:00:00Z' from public.creators where slug='sera' returning id) insert into public.entry_bodies (entry_id, body) select id, 'This collection is an exercise in subtraction. Each object has a job, and each job has one object.

The ceramic bowl holds small things at the end of the day. The linen towel becomes softer with use. The glass bottle is something I can refill, rather than replace.

I began by emptying the shelf completely. Anything that had not been touched in a month stayed in a box for another week. I did not miss most of it.

What remained was not particularly coordinated. It was simply useful, pleasant to hold, and familiar. A collection can be coherent because of how it is used, not only how it looks.

Your reference exercise: choose a single shelf. Take everything away, wipe it clean, and return only what you used this week. Live with that version before adding anything else.' from n;
insert into public.circle_notes (creator_id, body, created_at) select id, 'Welcome to the circle. This is a space for the details that never fit in a caption. What would you like to explore next?', '2026-09-30T10:00:00Z' from public.creators where slug='elena';
insert into public.circle_notes (creator_id, body, created_at) select id, 'A small note for the week: leave room for a slower start. I’ve shared a new entry on the rituals I return to.', '2026-09-29T10:00:00Z' from public.creators where slug='sera';
