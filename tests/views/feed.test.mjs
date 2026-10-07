// Home (/app), Discover (/app/discover) and the Library (/app/library): views/feed.js, views/discover.js, views/library.js.
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom, mountApp, tick, IntersectionObserverStub } from '../helpers/dom.mjs';
import { createFakeApi, IDS } from '../helpers/fake-api.mjs';

const E = IDS.entries;
const HOSTILE = '<img src=x onerror=alert(1)>';
const HOSTILE_WORD = '<img/src=x/onerror=alert(1)>';
const guest = () => createFakeApi({ signedIn: null });
const member = () => createFakeApi();
const callsTo = (fake, method) => fake.calls.filter(call => call.method === method);
const creatorRow = (fake, id) => fake.db.creators.find(row => row.id === id);
const entryRow = (fake, id) => fake.db.entries.find(row => row.id === id);

// Extra published posts, newest first (all older than the seed, so the seeded posts keep their place).
let postNumber = 0;
function addPosts(fake, count, { creatorId = IDS.verano, kind = 'text', access = 'public', category } = {}) {
  const source = fake.db.entries.find(row => row.creator_id === creatorId && row.status === 'published');
  const added = [];
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.parse('2026-09-15T08:00:00Z') - (postNumber + i) * 3_600_000).toISOString();
    const id = `3b000000-0000-4000-8000-${String(postNumber + i + 1).padStart(12, '0')}`;
    fake.db.entries.push({ ...source, id, title: `Extra post ${postNumber + i + 1}`, kind, access, category: category ?? source.category, published_at: at, created_at: at, updated_at: at, media_count: 0, preview_path: null, duration_seconds: null });
    added.push(id);
  }
  postNumber += count;
  fake.refresh();
  return added;
}

// More ateliers, each a copy of Casa Verano.
function addCreators(fake, count) {
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.parse('2026-08-01T08:00:00Z') + i * 3_600_000).toISOString();
    fake.db.creators.push({ ...creatorRow(fake, IDS.verano), id: `2b000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, slug: `extra-atelier-${i + 1}`, name: `Extra Atelier ${i + 1}`, created_at: at });
  }
  fake.refresh();
}

// Bookmarks for the seeded member, the first one saved last (the library lists the newest save first).
function saveAll(fake, ids, user = IDS.member) {
  ids.forEach((entry_id, i) => fake.db.bookmarks.push({ user_id: user, entry_id, created_at: new Date(Date.parse('2026-09-30T08:00:00Z') + (ids.length - i) * 60_000).toISOString() }));
}

const note = (creator_id, body, created_at = '2026-10-01T09:00:00+00:00', n = 1) => ({ id: `7b000000-0000-4000-8000-${String(n).padStart(12, '0')}`, creator_id, body, created_at });
const newEntryRow = (user, creator_id = IDS.solene) => ({ id: '8b000000-0000-4000-8000-000000000001', user_id: user, type: 'new_entry', actor_id: null, creator_id, entry_id: E.linenWardrobe, comment_id: null, read_at: null, created_at: '2026-10-07T09:10:00+00:00' });

describe('home, discover and library views', () => {
  before(() => installDom());
  after(() => uninstallDom());

  let app;
  const open = async (api, path = '/app') => { app = await mountApp({ api, path }); return app; };
  afterEach(async () => { await app?.destroy(); app = null; });

  const cards = (scope = '#view') => [...app.document.querySelectorAll(`${scope} [data-entry]`)];
  const titles = (scope) => cards(scope).map(card => card.querySelector('.entry-title').textContent.trim());
  const names = selector => [...app.document.querySelectorAll(selector)].map(node => node.textContent.trim());
  // The Retry button of an error state is wired by one document listener that ui.js attaches once per process; after another test
  // file has installed a DOM of its own it listens to a document that is gone. So the tests check that Retry is offered and then do
  // what the button does (reload the page, load the list again) by hand.
  const retryOffered = scope => assert.ok(app.exists(`${scope} [data-retry]`), 'Retry is offered');
  const reload = async () => { await app.router.reload(); await app.settle(); };
  const toastText = () => (app.exists('#toast') ? app.text('#toast') : '');
  const dialogOpen = () => app.exists('#modal') && app.find('#modal').open;
  const pressed = selector => app.find(selector).getAttribute('aria-pressed');
  const choose = async (selector, value) => {
    const select = app.find(selector);
    select.value = value;
    select.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    await app.settle();
  };
  const type = async (value, wait = 400) => {
    const input = app.find('#discover-q');
    input.value = value;
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await tick(wait);
    await app.settle();
  };
  const scrollTo = async sentinel => {
    const observer = IntersectionObserverStub.instances.find(item => item.targets.has(sentinel));
    assert.ok(observer, 'the list watches its end');
    observer.fire(true);
    await app.settle();
  };

  // --- Home ---------------------------------------------------------------------

  describe('home as a guest', () => {
    it('shows the latest public work from everyone, newest first, with a way in', async () => {
      const fake = guest();
      await open(fake);
      assert.equal(app.text('#view h1'), 'Work worth slowing down for.');
      assert.equal(app.document.title, 'Home — REFLUENZ');
      assert.equal(app.text('[data-feed-heading]'), 'Latest posts');
      assert.equal(titles().length, 10, 'drafts are never listed');
      assert.equal(titles()[0], 'First draft habits');
      assert.ok(!titles().includes('An essay still unfinished'));
      assert.deepEqual(callsTo(fake, 'feed').map(call => call.args[0].scope), ['all']);
      assert.equal(app.exists('[data-feed-tab]'), false, 'no Following tab without an account');
      assert.match(app.text('.join-card'), /Nothing is charged while payments are not live/);
      assert.deepEqual([...app.document.querySelectorAll('.join-card a')].map(link => link.getAttribute('href')), ['/app/signup', '/app/login']);
      assert.equal(app.exists('.welcome-card'), false);
    });

    it('leads with the newest post and marks locked ones', async () => {
      await open(guest());
      assert.equal(app.text('.pager-lead .entry-title'), 'First draft habits');
      assert.equal(app.find('.pager-lead').querySelectorAll('[data-entry]').length, 1);
      assert.equal(app.document.querySelectorAll('#view [data-pager-items] [data-entry]').length, 9);
      assert.equal(app.document.querySelectorAll('#view .is-locked').length, 5, 'essential, premium and signature posts need a circle');
    });

    it('offers suggested creators, and asks a guest to sign in before following', async () => {
      const fake = guest();
      await open(fake);
      assert.equal(app.exists('#rail-circle-title'), false, 'there is no circle to show');
      assert.equal(names('[data-rail-suggested] .rail-person-name').length, 3);
      await app.click('[data-rail-suggested] [data-follow]');
      assert.equal(dialogOpen(), true);
      assert.match(app.text('#modal'), /Sign in to follow creators\./);
      assert.equal(callsTo(fake, 'setFollow').length, 0);
    });

    it('keeps the kind and category filters in the address', async () => {
      const fake = guest();
      await open(fake);
      await app.click('[data-feed-kind="image"]');
      assert.equal(app.path, '/app?kind=image');
      assert.deepEqual(titles(), ['Fitting day', 'Sketchbook, September']);
      await app.click('[data-feed-category="Design"]');
      assert.equal(app.path, '/app?kind=image&category=Design');
      assert.deepEqual(titles(), ['Sketchbook, September']);
      const last = callsTo(fake, 'feed').at(-1).args[0];
      assert.deepEqual([last.scope, last.kind, last.category], ['all', 'image', 'Design']);
      await app.click('[data-feed-kind=""]');
      await app.click('[data-feed-category=""]');
      assert.equal(app.path, '/app');
      assert.equal(titles().length, 10);
    });

    it('draws a calm empty state when nothing has been published', async () => {
      const fake = guest();
      fake.db.entries = [];
      fake.refresh();
      await open(fake);
      assert.match(app.text('.empty h3'), /No posts yet/);
      assert.equal(app.find('.empty a').getAttribute('href'), '/app/discover');
    });
  });

  describe('home as a member', () => {
    it('greets the member, leads with the circle’s newest post and lists only their circle', async () => {
      const fake = member();
      await open(fake);
      assert.equal(app.text('#view h1'), 'Welcome back, Sofia.');
      assert.equal(app.text('[data-feed-heading]'), 'From your circle');
      assert.equal(app.text('.pager-lead .entry-title'), 'Notes on a linen wardrobe');
      assert.deepEqual(titles(), ['Notes on a linen wardrobe', 'Tiles of Alfama', 'Fitting day', 'Sketchbook, September', 'The tailor’s ledger', 'A tour of the workshop', 'Inside the cutting room', 'Notes on joinery', 'The pattern archive']);
      const call = callsTo(fake, 'feed')[0].args[0];
      assert.equal(call.scope, 'following');
      assert.deepEqual([...call.creatorIds].sort(), [IDS.solene, IDS.verano].sort(), 'the store’s follows and memberships are passed along');
      assert.equal(app.document.querySelectorAll('#view .is-locked').length, 4, 'what the member’s tier does not open stays locked');
    });

    it('has landmarks, grouped filters with pressed states and live regions', async () => {
      await open(member());
      assert.equal(app.find('#view h1').id, 'feed-title');
      assert.equal(app.find('.feed-rail').tagName, 'ASIDE');
      assert.equal(app.find('.feed-rail').getAttribute('aria-label'), 'Your circle and suggestions');
      assert.deepEqual([...app.document.querySelectorAll('#view [role="group"]')].map(group => group.getAttribute('aria-label')), ['Feed', 'Post type', 'Category']);
      assert.equal(pressed('[data-feed-tab="following"]'), 'true');
      assert.equal(pressed('[data-feed-tab="all"]'), 'false');
      assert.equal(pressed('[data-feed-kind=""]'), 'true');
      assert.match(app.text('[data-feed-status]'), /Showing 9 posts\./);
      assert.equal(app.find('[data-feed-status]').getAttribute('role'), 'status');
      assert.equal(app.find('.feed-notice-region').getAttribute('role'), 'status');
      for (const section of app.document.querySelectorAll('.rail-section')) {
        assert.ok(app.exists(`#${section.getAttribute('aria-labelledby')}`), 'each rail section is named by its heading');
      }
    });

    it('lists the circle, suggests creators who are not in it, and shows how a circle was joined', async () => {
      await open(member());
      assert.match(app.text('#rail-circle-title'), /Your circle/);
      assert.deepEqual(names('[aria-labelledby="rail-circle-title"] .rail-person-name'), ['Atelier Solene', 'Casa Verano']);
      assert.match(app.text('[aria-labelledby="rail-circle-title"]'), /Friend circle/, 'a membership names its tier');
      assert.deepEqual(names('[data-rail-suggested] .rail-person-name'), ['Verne & Co']);
      assert.equal(app.find('[data-rail-suggested] [data-follow]').getAttribute('aria-pressed'), 'false');
    });

    it('reads the latest circle notes of the creators in the circle', async () => {
      const fake = member();
      fake.db.circle_notes.push(note(IDS.solene, 'The autumn fittings open on Monday.'), note(IDS.verano, 'New joinery film next week.', '2026-10-03T09:00:00+00:00', 2), note(IDS.verne, 'Not in the circle.', '2026-10-05T09:00:00+00:00', 3));
      await open(fake);
      const notes = names('.rail-note-text');
      assert.deepEqual(notes, ['“New joinery film next week.”', '“The autumn fittings open on Monday.”'], 'newest first, and only from followed or joined ateliers');
      assert.match(app.text('.rail-note'), /Casa Verano/);
      assert.deepEqual(callsTo(fake, 'listNotes').map(call => call.args[0]).sort(), [IDS.solene, IDS.verano].sort());
    });

    it('switches between Following and Everything, and keeps the choice in the address', async () => {
      const fake = member();
      await open(fake);
      await app.click('[data-feed-tab="all"]');
      assert.equal(app.path, '/app?tab=all');
      assert.equal(pressed('[data-feed-tab="all"]'), 'true');
      assert.equal(pressed('[data-feed-tab="following"]'), 'false');
      assert.equal(app.text('[data-feed-heading]'), 'Everything, newest first');
      assert.equal(titles().length, 10);
      assert.equal(titles()[0], 'First draft habits');
      assert.equal(callsTo(fake, 'feed').at(-1).args[0].scope, 'all');
      await app.click('[data-feed-tab="following"]');
      assert.equal(app.path, '/app');
      assert.equal(titles().length, 9);
    });

    it('opens on the tab, kind and category of the address, and ignores values it does not know', async () => {
      const fake = member();
      await open(fake, '/app?tab=all&kind=image&category=Style');
      assert.deepEqual(titles(), ['Fitting day']);
      assert.equal(pressed('[data-feed-tab="all"]'), 'true');
      assert.equal(pressed('[data-feed-kind="image"]'), 'true');
      assert.equal(pressed('[data-feed-category="Style"]'), 'true');
      await app.destroy();
      const other = member();
      await open(other, '/app?tab=nonsense&kind=<b>&category=Nope');
      const call = callsTo(other, 'feed')[0].args[0];
      assert.deepEqual([call.scope, call.kind, call.category], ['following', undefined, undefined]);
      assert.equal(titles().length, 9);
    });

    it('filters the circle’s posts by type and topic, and says when nothing matches', async () => {
      await open(member());
      await app.click('[data-feed-kind="video"]');
      assert.deepEqual(titles(), ['A tour of the workshop', 'Inside the cutting room']);
      await app.click('[data-feed-category="Beauty"]');
      assert.match(app.text('#view .empty h3'), /Nothing matches these filters/);
      assert.equal(app.exists('.feed-suggest'), false, 'no suggestions for a filter that is too narrow');
      await app.click('[data-feed-clear]');
      assert.equal(app.path, '/app');
      assert.equal(titles().length, 9);
      assert.equal(pressed('[data-feed-kind=""]'), 'true');
      assert.equal(pressed('[data-feed-category=""]'), 'true');
    });

    it('lets go of the rail’s suggestions only while the empty state shows its own', async () => {
      const fake = createFakeApi({ signedIn: IDS.fan3 });
      await open(fake);
      assert.equal(app.find('[data-rail-suggested]').hidden, true, 'the same creators are not offered twice');
      await app.click('[data-feed-tab="all"]');
      assert.equal(app.find('[data-rail-suggested]').hidden, false);
    });
  });

  describe('the welcome card', () => {
    it('is shown until it is dismissed, and dismissing it is saved', async () => {
      const fake = member();
      await open(fake);
      assert.equal(app.exists('[data-welcome]'), true);
      assert.match(app.text('[data-welcome]'), /Joining is free during early access/);
      assert.equal(app.find('[data-dismiss-welcome]').getAttribute('aria-label'), 'Dismiss the welcome message');
      await app.click('[data-dismiss-welcome]');
      assert.equal(app.exists('[data-welcome]'), false);
      assert.deepEqual(callsTo(fake, 'saveSettings')[0].args, [{ welcomeDismissed: true }]);
      assert.equal(app.store.state.settings.welcomeDismissed, true);
      assert.equal(app.document.activeElement.id, 'feed-title', 'focus does not fall off the page');
      await app.navigate('/app/discover');
      await app.navigate('/app');
      assert.equal(app.exists('[data-welcome]'), false, 'it does not come back');
    });

    it('stays, with a message and a usable button, when saving fails', async () => {
      const fake = member();
      await open(fake);
      fake.fail('saveSettings', 'We could not save that right now.');
      await app.click('[data-dismiss-welcome]');
      assert.equal(app.exists('[data-welcome]'), true);
      assert.equal(app.find('[data-dismiss-welcome]').disabled, false);
      assert.match(toastText(), /We could not save that right now\./);
      assert.equal(app.store.state.settings.welcomeDismissed, false);
      fake.fail('saveSettings', null);
      await app.click('[data-dismiss-welcome]');
      assert.equal(app.exists('[data-welcome]'), false);
    });

    it('is not shown to someone who dismissed it, nor to a guest', async () => {
      const fake = member();
      fake.db.user_settings.find(row => row.user_id === IDS.member).welcome_dismissed = true;
      await open(fake);
      assert.equal(app.exists('[data-welcome]'), false);
    });
  });

  describe('an empty circle', () => {
    it('suggests creators instead of an empty page, and fills in once someone is followed', async () => {
      const fake = createFakeApi({ signedIn: IDS.fan3 });
      await open(fake);
      assert.match(app.text('#view .empty h3'), /Your circle is empty/);
      assert.equal(callsTo(fake, 'feed').length, 0, 'there is nobody to ask for');
      assert.equal(app.document.querySelectorAll('.feed-suggest [data-creator]').length, 3);
      assert.match(app.text('[aria-labelledby="rail-circle-title"]'), /Follow a creator to start your circle\./);
      await app.click(`.feed-suggest [data-creator="${IDS.verne}"] [data-follow]`);
      assert.deepEqual(callsTo(fake, 'setFollow')[0].args, [IDS.verne, true]);
      await tick(700);
      await app.settle();
      assert.deepEqual(titles(), ['First draft habits'], 'the empty feed reloaded by itself');
      assert.deepEqual(callsTo(fake, 'feed').at(-1).args[0].creatorIds, [IDS.verne]);
      assert.deepEqual(names('[aria-labelledby="rail-circle-title"] .rail-person-name'), ['Verne & Co'], 'the rail follows the circle');
    });

    it('says so when the circle has not published anything yet', async () => {
      const fake = member();
      fake.db.entries = fake.db.entries.filter(row => row.creator_id === IDS.verne);
      fake.refresh();
      await open(fake);
      assert.match(app.text('#view .empty h3'), /Nothing new from your circle yet/);
      assert.equal(app.exists('[data-feed-tab="all"].button'), true, 'a next step: browse everything');
      await app.click('.empty [data-feed-tab="all"]');
      assert.equal(app.path, '/app?tab=all');
      assert.deepEqual(titles(), ['First draft habits']);
    });
  });

  describe('home while it changes', () => {
    it('offers a refresh when the circle changes, and one when a new post arrives', async () => {
      const fake = member();
      await open(fake);
      assert.equal(app.find('[data-feed-notice]').hidden, true);
      await app.click('[data-rail-suggested] [data-follow]');
      assert.equal(app.find('[data-feed-notice]').hidden, false);
      assert.match(app.text('[data-feed-notice]'), /Your circle has changed\./);
      const before = callsTo(fake, 'feed').length;
      await app.click('[data-feed-refresh]');
      assert.equal(app.find('[data-feed-notice]').hidden, true);
      assert.equal(callsTo(fake, 'feed').length, before + 1);
      assert.ok(titles().includes('First draft habits'), 'the new circle member’s post is there');

      fake.emit(IDS.member, 'notification', newEntryRow(IDS.member));
      await app.settle();
      assert.match(app.text('[data-feed-notice]'), /There are new posts from your circle\./);
      assert.equal(app.find('[data-feed-notice]').hidden, false);
    });

    it('reads the circle notes again when a note arrives', async () => {
      const fake = member();
      await open(fake);
      assert.equal(app.exists('.rail-note'), false);
      fake.db.circle_notes.push(note(IDS.solene, 'A note that just arrived.'));
      fake.emit(IDS.member, 'notification', { ...newEntryRow(IDS.member), type: 'note', entry_id: null });
      await tick(600);
      await app.settle();
      assert.deepEqual(names('.rail-note-text'), ['“A note that just arrived.”']);
    });

    it('stops listening when the person leaves the page', async () => {
      const fake = member();
      await open(fake);
      await app.navigate('/app/memberships');
      const before = fake.calls.length;
      await app.store.toggleFollow(IDS.verne);
      fake.emit(IDS.member, 'notification', newEntryRow(IDS.member));
      await tick(700);
      const methods = fake.calls.slice(before).map(call => call.method);
      assert.ok(!methods.includes('listNotes') && !methods.includes('getCreator') && !methods.includes('feed'), methods.join());
    });
  });

  describe('home with a long feed', () => {
    it('pages with "Load more" and with scrolling, and ends with a line', async () => {
      const fake = member();
      addPosts(fake, 30);
      await open(fake);
      assert.equal(cards().length, 12);
      assert.equal(app.exists('.pager-end'), false);
      await app.click('[data-pager-more]');
      assert.equal(cards().length, 24);
      assert.match(callsTo(fake, 'feed').at(-1).args[0].cursor, /^\d{4}-\d\d-\d\dT/, 'the cursor of the last post is sent');
      await scrollTo(app.find('[data-pager-sentinel]'));
      assert.equal(cards().length, 36);
      await app.click('[data-pager-more]');
      assert.equal(cards().length, 39);
      assert.equal(new Set(titles()).size, 39, 'no post twice');
      assert.equal(app.exists('[data-pager-more]'), false);
      assert.match(app.text('.pager-end'), /You have reached the end\./);
      assert.match(app.text('[data-feed-status]'), /Showing 39 posts\./);
    });

    it('keeps what is on screen and offers another try when a page fails', async () => {
      const fake = member();
      addPosts(fake, 30);
      await open(fake);
      fake.fail('feed', 'The connection dropped.');
      await app.click('[data-pager-more]');
      assert.equal(cards().length, 12);
      assert.equal(app.find('.pager-error').getAttribute('role'), 'alert');
      assert.match(app.text('.pager-error'), /The connection dropped\./);
      fake.fail('feed', null);
      await app.click('[data-pager-retry]');
      assert.equal(cards().length, 24);
      assert.equal(app.exists('.pager-error'), false);
    });

    it('starts again from the top when a filter changes', async () => {
      const fake = member();
      addPosts(fake, 30, { category: 'Style' });
      await open(fake);
      await app.click('[data-pager-more]');
      assert.equal(cards().length, 24);
      await app.click('[data-feed-category="Design"]');
      assert.deepEqual(titles().length, 4);
      assert.equal(callsTo(fake, 'feed').at(-1).args[0].cursor, undefined);
    });
  });

  describe('home when something fails', () => {
    it('shows an error with Retry when the feed cannot be loaded', async () => {
      const fake = member();
      fake.fail('feed', 'The feed is resting. Try again in a moment.');
      await open(fake);
      assert.match(app.text('#view .error-state'), /The feed is resting\. Try again in a moment\./);
      retryOffered('#view');
      fake.fail('feed', null);
      await reload();
      assert.equal(app.exists('#view .error-state'), false);
      assert.equal(titles().length, 9);
    });

    it('shows an error with Retry for a filter that fails, and recovers', async () => {
      const fake = member();
      await open(fake);
      fake.fail('feed', 'Filtering failed.');
      await app.click('[data-feed-kind="text"]');
      assert.match(app.text('[data-feed-list] .error-state'), /Filtering failed\./);
      assert.equal(app.exists('[data-feed-kind="text"].is-active'), true, 'the controls stay where they were put');
      retryOffered('[data-feed-list]');
      fake.fail('feed', null);
      await app.click('[data-feed-kind="video"]');
      assert.equal(app.exists('[data-feed-list] .error-state'), false);
      assert.deepEqual(titles(), ['A tour of the workshop', 'Inside the cutting room']);
    });

    it('does without suggestions and circle notes when they cannot be read', async () => {
      const fake = member();
      fake.fail('suggestedCreators', 'No suggestions today.');
      fake.fail('listNotes', 'No notes today.');
      await open(fake);
      assert.equal(app.exists('#view .error-state'), false);
      assert.equal(titles().length, 9);
      assert.equal(app.exists('[data-rail-suggested]'), false);
    });

    it('asks again for the viewer’s data when it did not load, instead of showing an empty circle', async () => {
      const fake = member();
      fake.fail('loadViewer', 'Your account could not be read.');
      await open(fake);
      assert.match(app.text('#view .error-state'), /Your account could not be read\./);
      retryOffered('#view');
      fake.fail('loadViewer', null);
      await reload();
      assert.equal(titles().length, 9);
    });
  });

  describe('home with hostile text', () => {
    it('shows names and titles as text', async () => {
      const fake = member();
      creatorRow(fake, IDS.solene).name = HOSTILE;
      creatorRow(fake, IDS.verne).name = HOSTILE;
      entryRow(fake, E.linenWardrobe).title = HOSTILE;
      entryRow(fake, E.linenWardrobe).excerpt = HOSTILE;
      fake.db.profiles.find(row => row.id === IDS.member).display_name = HOSTILE_WORD;
      fake.db.circle_notes.push(note(IDS.solene, HOSTILE));
      await open(fake);
      assert.equal(app.exists('#view img[src="x"]'), false);
      assert.equal(app.exists('#view [onerror]'), false);
      assert.equal(app.text('#view h1'), `Welcome back, ${HOSTILE_WORD}.`);
      assert.ok(titles().includes(HOSTILE));
      assert.ok(app.text('.rail-note-text').includes(HOSTILE));
      assert.ok(app.text('[data-rail-suggested]').includes(HOSTILE));
      assert.ok(app.find('.pager-lead .entry-title').textContent.includes(HOSTILE));
    });
  });

  // --- Discover -------------------------------------------------------------------

  describe('discover without a search', () => {
    it('lists creators and posts, with the filters labelled', async () => {
      const fake = guest();
      await open(fake, '/app/discover');
      assert.equal(app.text('#view h1'), 'Find creators and their work');
      assert.equal(app.document.title, 'Discover — REFLUENZ');
      assert.deepEqual(names('.discover-section .section-head h2'), ['Creators', 'Posts']);
      assert.deepEqual(names('[data-pager-host="creators"] .creator-names h3'), ['Verne & Co', 'Casa Verano', 'Atelier Solene']);
      assert.equal(app.document.querySelectorAll('[data-pager-host="entries"] [data-entry]').length, 10);
      assert.match(app.text('.page-sub'), /free during early access/);
      assert.deepEqual([...app.document.querySelectorAll('.discover-field label')].map(label => label.textContent), ['Category', 'Post type', 'Sort by']);
      for (const select of app.document.querySelectorAll('.discover-field select')) assert.equal(app.find(`label[for="${select.id}"]`).textContent.length > 0, true);
      assert.equal(app.find('[role="search"]').tagName, 'FORM');
      assert.equal(app.find('[data-discover-clear]').hidden, true);
      assert.deepEqual(callsTo(fake, 'listCreators')[0].args[0], { category: undefined, sort: 'new', limit: 12, offset: 0 });
      assert.equal(callsTo(fake, 'feed')[0].args[0].scope, 'all');
      assert.match(app.text('[data-discover-status]'), /3 creators and 10 posts shown\./);
    });

    it('filters by category and keeps it in the address', async () => {
      const fake = guest();
      await open(fake, '/app/discover');
      await choose('#discover-category', 'Design');
      assert.equal(app.path, '/app/discover?category=Design');
      assert.deepEqual(names('[data-pager-host="creators"] .creator-names h3'), ['Casa Verano']);
      assert.equal(app.document.querySelectorAll('[data-pager-host="entries"] [data-entry]').length, 4);
      assert.equal(callsTo(fake, 'listCreators').at(-1).args[0].category, 'Design');
      assert.equal(app.find('[data-discover-clear]').hidden, false);
    });

    it('filters the posts by type without asking for the creators again', async () => {
      const fake = guest();
      await open(fake, '/app/discover');
      await choose('#discover-category', 'Design');
      const creatorCalls = callsTo(fake, 'listCreators').length;
      await choose('#discover-kind', 'video');
      assert.equal(app.path, '/app/discover?category=Design&kind=video');
      assert.deepEqual(titles(), ['A tour of the workshop']);
      assert.equal(callsTo(fake, 'listCreators').length, creatorCalls);
    });

    it('sorts by popularity', async () => {
      const fake = guest();
      await open(fake, '/app/discover');
      await choose('#discover-sort', 'popular');
      assert.equal(app.path, '/app/discover?sort=popular');
      assert.equal(titles()[0], 'Fitting day', 'four likes');
      assert.equal(callsTo(fake, 'feed').at(-1).args[0].sort, 'popular');
      assert.equal(callsTo(fake, 'listCreators').at(-1).args[0].sort, 'popular');
    });

    it('clears every filter at once', async () => {
      await open(guest(), '/app/discover?category=Design&kind=video&sort=popular');
      assert.equal(app.find('#discover-category').value, 'Design');
      assert.equal(app.find('#discover-kind').value, 'video');
      assert.equal(app.find('#discover-sort').value, 'popular');
      await app.click('[data-discover-clear]');
      assert.equal(app.path, '/app/discover');
      assert.equal(app.find('#discover-category').value, '');
      assert.equal(app.find('#discover-sort').value, 'new');
      assert.equal(app.find('[data-discover-clear]').hidden, true);
      assert.equal(app.document.querySelectorAll('[data-pager-host="entries"] [data-entry]').length, 10);
    });

    it('says what is missing and offers a way out when a filter matches nothing', async () => {
      await open(guest(), '/app/discover?category=Beauty');
      assert.match(app.text('[data-pager-host="creators"] .empty h3'), /No Beauty creators yet/);
      assert.match(app.text('[data-pager-host="entries"] .empty h3'), /No posts match these filters/);
      await app.click('[data-pager-host="entries"] [data-discover-clear]');
      assert.equal(app.path, '/app/discover');
      assert.equal(app.exists('.empty'), false);
    });

    it('ignores values in the address that it does not know', async () => {
      const fake = guest();
      await open(fake, '/app/discover?category=Nope&kind=zzz&sort=best');
      assert.equal(app.find('#discover-category').value, '');
      assert.equal(app.find('#discover-kind').value, '');
      assert.equal(app.find('#discover-sort').value, 'new');
      assert.equal(callsTo(fake, 'listCreators')[0].args[0].category, undefined);
      assert.equal(callsTo(fake, 'feed')[0].args[0].kind, undefined);
    });

    it('pages creators and posts independently', async () => {
      const fake = guest();
      addCreators(fake, 14);
      addPosts(fake, 20);
      await open(fake, '/app/discover');
      const count = host => app.document.querySelectorAll(`[data-pager-host="${host}"] .pager-item`).length;
      assert.deepEqual([count('creators'), count('entries')], [12, 12]);
      await app.click('[data-pager-host="creators"] [data-pager-more]');
      assert.deepEqual([count('creators'), count('entries')], [17, 12]);
      assert.equal(callsTo(fake, 'listCreators').at(-1).args[0].offset, 12);
      assert.equal(app.exists('[data-pager-host="creators"] [data-pager-more]'), false);
      await app.click('[data-pager-host="entries"] [data-pager-more]');
      assert.deepEqual([count('creators'), count('entries')], [17, 24]);
      await scrollTo(app.find('[data-pager-host="entries"] [data-pager-sentinel]'));
      assert.equal(count('entries'), 30);
    });

    it('follows a creator for a member, and asks a guest to sign in', async () => {
      await open(member(), '/app/discover');
      assert.equal(pressed(`[data-creator="${IDS.verano}"] [data-follow]`), 'true', 'already followed');
      assert.equal(pressed(`[data-creator="${IDS.verne}"] [data-follow]`), 'false');
      await app.click(`[data-creator="${IDS.verne}"] [data-follow]`);
      assert.equal(pressed(`[data-creator="${IDS.verne}"] [data-follow]`), 'true');
      await app.destroy();
      await open(guest(), '/app/discover');
      await app.click(`[data-creator="${IDS.verne}"] [data-follow]`);
      assert.equal(dialogOpen(), true);
    });

    it('shows an error with Retry when the lists cannot be loaded', async () => {
      const fake = guest();
      fake.fail('listCreators', 'Creators are resting.');
      await open(fake, '/app/discover');
      assert.match(app.text('#view .error-state'), /Creators are resting\./);
      retryOffered('#view');
      fake.fail('listCreators', null);
      await reload();
      assert.equal(app.document.querySelectorAll('[data-pager-host="creators"] [data-creator]').length, 3);
    });
  });

  describe('discover with a search', () => {
    it('shows posts that match, in a section of their own', async () => {
      const fake = guest();
      await open(fake, '/app/discover?q=linen');
      assert.deepEqual(callsTo(fake, 'search').map(call => call.args[0]), ['linen']);
      assert.equal(app.find('#discover-q').value, 'linen');
      assert.deepEqual(names('.discover-section .section-head h2'), ['Posts']);
      assert.deepEqual(titles(), ['Notes on a linen wardrobe']);
      assert.match(app.text('[data-discover-status]'), /0 creators and 1 post for “linen”\./);
      assert.equal(app.find('[data-field="sort"]').hidden, true, 'a search has no sort order');
      assert.equal(callsTo(fake, 'listCreators').length, 0);
    });

    it('shows creators that match', async () => {
      await open(guest(), '/app/discover?q=atelier');
      assert.deepEqual(names('.discover-section .section-head h2'), ['Creators']);
      assert.deepEqual(names('.creator-names h3'), ['Atelier Solene', 'Casa Verano']);
    });

    it('searches while typing, once, and keeps the field’s focus and the address in step', async () => {
      const fake = guest();
      await open(fake, '/app/discover');
      const input = app.find('#discover-q');
      input.focus();
      for (const value of ['l', 'li', 'lin', 'linen']) {
        input.value = value;
        input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
        await tick(20);
      }
      assert.equal(callsTo(fake, 'search').length, 0, 'nothing is asked while the person is still typing');
      await tick(400);
      await app.settle();
      assert.deepEqual(callsTo(fake, 'search').map(call => call.args[0]), ['linen']);
      assert.equal(app.path, '/app/discover?q=linen');
      assert.equal(app.find('#discover-q'), input, 'the field is not redrawn');
      assert.equal(app.document.activeElement, input);
      assert.deepEqual(titles(), ['Notes on a linen wardrobe']);
      assert.equal(app.exists('[data-pager-host]'), false);
    });

    it('searches at once on submit, and goes back to browsing when the search is emptied', async () => {
      const fake = guest();
      await open(fake, '/app/discover');
      await app.submit('[data-discover-form]', { q: '  atelier  ' });
      assert.equal(app.path, '/app/discover?q=atelier');
      assert.deepEqual(callsTo(fake, 'search').map(call => call.args[0]), ['atelier']);
      await type('');
      assert.equal(app.path, '/app/discover');
      assert.deepEqual(names('.discover-section .section-head h2'), ['Creators', 'Posts']);
      assert.equal(app.find('[data-field="sort"]').hidden, false);
    });

    it('filters what was found without searching again', async () => {
      const fake = guest();
      await open(fake, '/app/discover?q=atelier');
      await choose('#discover-category', 'Design');
      assert.equal(app.path, '/app/discover?q=atelier&category=Design');
      assert.deepEqual(names('.creator-names h3'), ['Casa Verano']);
      assert.equal(callsTo(fake, 'search').length, 1);
    });

    it('says when nothing was found and clears the search from there', async () => {
      const fake = guest();
      await open(fake, '/app/discover');
      await type('zzzz');
      assert.match(app.text('.discover-results .empty h3'), /No matches for “zzzz”/);
      await app.click('[data-discover-clear-search]');
      assert.equal(app.path, '/app/discover');
      assert.equal(app.find('#discover-q').value, '');
      assert.equal(app.document.activeElement.id, 'discover-q');
      assert.equal(app.exists('.discover-results .empty'), false);
      assert.equal(app.document.querySelectorAll('[data-pager-host="entries"] [data-entry]').length, 10);
    });

    it('says when the filters leave nothing, and clears them', async () => {
      await open(guest(), '/app/discover?q=linen&kind=video');
      assert.match(app.text('.discover-results .empty'), /Nothing fits this search with the filters you chose/);
      await app.click('.discover-results [data-discover-clear]');
      assert.equal(app.path, '/app/discover?q=linen');
      assert.deepEqual(titles(), ['Notes on a linen wardrobe']);
    });

    it('opens on every part of the address', async () => {
      await open(guest(), '/app/discover?q=notes&category=Design&kind=text&sort=popular');
      assert.equal(app.find('#discover-q').value, 'notes');
      assert.equal(app.find('#discover-category').value, 'Design');
      assert.equal(app.find('#discover-kind').value, 'text');
      assert.equal(app.find('#discover-sort').value, 'popular');
      assert.deepEqual(titles(), ['Notes on joinery']);
    });

    it('is reached from the search box in the top bar', async () => {
      await open(guest(), '/app');
      await app.submit('[data-search]', { q: 'linen' });
      assert.equal(app.path, '/app/discover?q=linen');
      assert.deepEqual(titles(), ['Notes on a linen wardrobe']);
      assert.equal(app.find('#shell-search').value, 'linen');
    });

    it('shows an error with Retry when the search fails, and keeps the typed text', async () => {
      const fake = guest();
      await open(fake, '/app/discover');
      fake.fail('search', 'Search is resting.');
      await type('linen');
      assert.match(app.text('.discover-results .error-state'), /Search is resting\./);
      assert.equal(app.find('#discover-q').value, 'linen');
      assert.match(app.text('[data-discover-status]'), /could not be completed/);
      retryOffered('.discover-results');
      fake.fail('search', null);
      await type('wardrobe');
      assert.equal(app.exists('.discover-results .error-state'), false);
      assert.deepEqual(titles(), ['Notes on a linen wardrobe']);
    });

    it('shows an error when the first search fails', async () => {
      const fake = guest();
      fake.fail('search', 'Search is resting.');
      await open(fake, '/app/discover?q=linen');
      assert.match(app.text('#view .error-state'), /Search is resting\./);
    });

    it('cuts a long search down and ignores one that is only spaces', async () => {
      const fake = guest();
      await open(fake, `/app/discover?q=${'a'.repeat(300)}`);
      assert.equal(callsTo(fake, 'search')[0].args[0].length, 100);
      await app.destroy();
      const other = guest();
      await open(other, '/app/discover?q=%20%20');
      assert.equal(callsTo(other, 'search').length, 0);
      assert.equal(app.exists('[data-pager-host="creators"]'), true);
    });

    it('shows hostile text as text, in the field, the messages and the results', async () => {
      await open(guest(), `/app/discover?q=${encodeURIComponent(HOSTILE)}`);
      assert.equal(app.find('#discover-q').value, HOSTILE);
      assert.ok(app.text('.discover-results .empty h3').includes(HOSTILE));
      assert.equal(app.exists('#view img[src="x"]'), false);
      assert.equal(app.exists('#view [onerror]'), false);
      await app.destroy();
      const fake = guest();
      creatorRow(fake, IDS.verano).name = HOSTILE;
      entryRow(fake, E.linenWardrobe).title = HOSTILE;
      await open(fake, '/app/discover?q=atelier');
      assert.ok(names('.creator-names h3').includes(HOSTILE));
      await app.navigate('/app/discover?q=summer');
      assert.ok(titles().includes(HOSTILE));
      assert.equal(app.exists('#view img[src="x"]'), false);
      assert.equal(app.exists('#view [onerror]'), false);
    });

    it('stops reacting once the person has left', async () => {
      const fake = guest();
      await open(fake, '/app/discover');
      const input = app.find('#discover-q');
      input.value = 'linen';
      input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
      await app.navigate('/app');
      await tick(450);
      assert.equal(callsTo(fake, 'search').length, 0);
      assert.equal(app.path, '/app');
    });
  });

  // --- Library --------------------------------------------------------------------

  describe('library', () => {
    it('is for signed-in people: a guest is sent to sign in and returns here', async () => {
      await open(guest(), '/app/library');
      assert.equal(app.path, '/app/login?next=%2Fapp%2Flibrary');
    });

    it('lists the saved posts with a way to remove each', async () => {
      const fake = member();
      await open(fake, '/app/library');
      assert.equal(app.text('#view h1'), 'Your library');
      assert.equal(app.document.title, 'Library — REFLUENZ');
      assert.deepEqual(titles(), ['Notes on a linen wardrobe']);
      assert.equal(app.text('[data-library-count]'), '1');
      assert.match(app.text('[data-library-status]'), /1 saved post\./);
      const remove = app.find('[data-library-remove]');
      assert.equal(remove.getAttribute('aria-label'), 'Remove “Notes on a linen wardrobe” from your library');
      assert.equal(app.find('[data-library-export]').hidden, false);
      assert.equal(pressed(`[data-save="${E.linenWardrobe}"]`), 'true');
      assert.deepEqual(callsTo(fake, 'savedEntries')[0].args, [{ limit: 12 }]);
    });

    it('shows an empty state with a next step, and nothing to export', async () => {
      await open(createFakeApi({ signedIn: IDS.fan3 }), '/app/library');
      assert.match(app.text('#view .empty h3'), /Nothing saved yet/);
      assert.equal(app.find('#view .empty a').getAttribute('href'), '/app/discover');
      assert.equal(app.find('[data-library-export]').hidden, true);
      assert.equal(app.text('[data-library-count]'), '');
      assert.match(app.text('[data-library-status]'), /Your library is empty\./);
    });

    it('removes a post: at once, with a message, and the empty state when it was the last', async () => {
      const fake = member();
      await open(fake, '/app/library');
      await app.click('[data-library-remove]');
      assert.deepEqual(callsTo(fake, 'setBookmark')[0].args, [E.linenWardrobe, false]);
      assert.equal(app.store.state.saved.has(E.linenWardrobe), false);
      assert.equal(fake.db.bookmarks.length, 0);
      assert.match(toastText(), /Removed from your library\./);
      assert.equal(cards().length, 0);
      assert.match(app.text('#view .empty h3'), /Nothing saved yet/);
      assert.equal(app.find('[data-library-export]').hidden, true);
      assert.equal(app.document.activeElement.id, 'library-title', 'focus moves to the heading when the list is gone');
    });

    it('moves the focus to the next post when one is removed', async () => {
      const fake = member();
      saveAll(fake, addPosts(fake, 2));
      await open(fake, '/app/library');
      assert.equal(cards().length, 3);
      const first = titles()[0];
      await app.click('[data-library-remove]');
      assert.equal(cards().length, 2);
      assert.ok(!titles().includes(first));
      assert.equal(app.document.activeElement.hasAttribute('data-library-remove'), true);
      assert.match(app.text('[data-library-status]'), /Removed\. 2 saved posts left\./);
    });

    it('keeps the post and says why when removing fails', async () => {
      const fake = member();
      await open(fake, '/app/library');
      fake.fail('setBookmark', 'We could not update your library right now.');
      await app.click('[data-library-remove]');
      assert.equal(cards().length, 1);
      assert.match(toastText(), /We could not update your library right now\./);
      assert.equal(app.store.state.saved.has(E.linenWardrobe), true, 'the change was rolled back');
      assert.equal(app.find('[data-library-remove]').disabled, false);
      fake.fail('setBookmark', null);
      await app.click('[data-library-remove]');
      assert.equal(cards().length, 0);
    });

    it('lets a post that was un-bookmarked on its card be removed from the list', async () => {
      const fake = member();
      await open(fake, '/app/library');
      await app.click(`[data-save="${E.linenWardrobe}"]`);
      assert.equal(pressed(`[data-save="${E.linenWardrobe}"]`), 'false');
      const writes = callsTo(fake, 'setBookmark').length;
      await app.click('[data-library-remove]');
      assert.equal(callsTo(fake, 'setBookmark').length, writes, 'nothing is asked of the server twice');
      assert.equal(cards().length, 0);
    });

    it('pages the list, newest save first, and keeps the rest after a removal', async () => {
      const fake = member();
      const ids = addPosts(fake, 30);
      saveAll(fake, ids);
      await open(fake, '/app/library');
      assert.equal(cards().length, 12);
      assert.equal(titles()[0], entryRow(fake, ids[0]).title, 'the most recent save leads');
      assert.equal(app.text('[data-library-count]'), '12+');
      await app.click('[data-library-remove]');
      assert.equal(cards().length, 11);
      await app.click('[data-pager-more]');
      assert.equal(cards().length, 23);
      await scrollTo(app.find('[data-pager-sentinel]'));
      assert.equal(cards().length, 30);
      assert.equal(new Set(titles()).size, 30);
      await app.click('[data-pager-more]').catch(() => {});
      assert.equal(app.text('[data-library-count]').includes('+'), false);
    });

    it('leaves out posts that are no longer published', async () => {
      const fake = member();
      saveAll(fake, [E.firstDraftHabits]);
      entryRow(fake, E.firstDraftHabits).status = 'draft';
      await open(fake, '/app/library');
      assert.deepEqual(titles(), ['Notes on a linen wardrobe']);
    });

    it('keeps posts of circles that were left, locked', async () => {
      const fake = member();
      saveAll(fake, [E.cuttingRoom]);
      await open(fake, '/app/library');
      assert.equal(cards().length, 2);
      assert.equal(app.document.querySelectorAll('#view .is-locked').length, 1);
    });

    it('shows an error with Retry when the library cannot be loaded, and when a page fails', async () => {
      const fake = member();
      fake.fail('savedEntries', 'Your library is resting.');
      await open(fake, '/app/library');
      assert.match(app.text('#view .error-state'), /Your library is resting\./);
      retryOffered('#view');
      fake.fail('savedEntries', null);
      await reload();
      assert.equal(cards().length, 1);
      await app.destroy();

      const long = member();
      saveAll(long, addPosts(long, 20));
      await open(long, '/app/library');
      long.fail('savedEntries', 'The connection dropped.');
      await app.click('[data-pager-more]');
      assert.equal(cards().length, 12);
      assert.match(app.text('.pager-error'), /The connection dropped\./);
    });

    it('escapes post titles, including in the remove button’s name', async () => {
      const fake = member();
      entryRow(fake, E.linenWardrobe).title = HOSTILE;
      creatorRow(fake, IDS.solene).name = HOSTILE;
      await open(fake, '/app/library');
      assert.equal(app.exists('#view img[src="x"]'), false);
      assert.equal(app.exists('#view [onerror]'), false);
      assert.ok(titles().includes(HOSTILE));
      assert.equal(app.find('[data-library-remove]').getAttribute('aria-label'), `Remove “${HOSTILE}” from your library`);
    });

    describe('the reading list', () => {
      // A browser saves a link with a download attribute instead of opening it: say so here, and keep the file.
      let created;
      let downloads;
      let original;
      let stop = () => {};
      const capture = () => {
        created = [];
        downloads = [];
        original = URL.createObjectURL;
        URL.createObjectURL = blob => { created.push(blob); return 'blob:http://localhost/reading-list'; };
        const onClick = event => {
          const link = event.target.closest?.('a[download]');
          if (!link) return;
          event.preventDefault();
          downloads.push(link.getAttribute('download'));
        };
        app.document.addEventListener('click', onClick);
        stop = () => app.document.removeEventListener('click', onClick);
      };
      afterEach(() => { stop(); stop = () => {}; if (original) URL.createObjectURL = original; original = null; });

      it('downloads every saved post as JSON, across pages', async () => {
        const fake = member();
        const ids = addPosts(fake, 60);
        saveAll(fake, ids);
        await open(fake, '/app/library');
        capture();
        await app.click('[data-library-export]');
        assert.equal(created.length, 1);
        assert.equal(created[0].type, 'application/json');
        const list = JSON.parse(await created[0].text());
        assert.equal(list.count, 61);
        assert.equal(list.entries.length, 61);
        assert.deepEqual(Object.keys(list.entries[0]), ['title', 'creator', 'kind', 'category', 'access', 'publishedAt', 'url']);
        assert.equal(list.entries[0].title, entryRow(fake, ids[0]).title);
        assert.equal(list.entries[0].url, `http://localhost/app/p/${ids[0]}`);
        assert.deepEqual(downloads, ['refluenz-reading-list.json']);
        assert.equal(list.entries.at(-1).title, 'Notes on a linen wardrobe');
        assert.equal(list.entries.at(-1).creator, 'Atelier Solene');
        assert.equal(list.entries.at(-1).access, 'Open to everyone');
        assert.match(list.exportedAt, /^\d{4}-\d\d-\d\dT/);
        assert.deepEqual(callsTo(fake, 'savedEntries').slice(1).map(call => call.args[0].limit), [50, 50], 'two requests of fifty');
        assert.match(toastText(), /Your reading list is ready: 61 posts\./);
        assert.equal(app.find('[data-library-export]').disabled, false);
      });

      it('names the tier a locked post needs, and keeps the file free of markup', async () => {
        const fake = member();
        saveAll(fake, [E.patternArchive]);
        entryRow(fake, E.linenWardrobe).title = HOSTILE;
        await open(fake, '/app/library');
        capture();
        await app.click('[data-library-export]');
        const list = JSON.parse(await created[0].text());
        assert.equal(list.entries.find(item => item.title === 'The pattern archive').access, 'Signature and above');
        assert.ok(list.entries.some(item => item.title === HOSTILE), 'the title is data in the file, as it is');
      });

      it('explains a failure and can be tried again', async () => {
        const fake = member();
        await open(fake, '/app/library');
        capture();
        fake.fail('savedEntries', 'We could not read your library right now.');
        await app.click('[data-library-export]');
        assert.equal(created.length, 0);
        assert.match(toastText(), /We could not read your library right now\./);
        assert.equal(app.find('[data-library-export]').disabled, false);
        fake.fail('savedEntries', null);
        await app.click('[data-library-export]');
        assert.equal(created.length, 1);
      });
    });
  });

  // --- The three pages together ------------------------------------------------------

  describe('every page draws a heading and no error, for each kind of visitor', () => {
    const PAGES = ['/app', '/app?tab=all', '/app/discover', '/app/discover?q=linen', '/app/library'];
    for (const [label, make] of Object.entries({ guest, member, owner: () => createFakeApi({ signedIn: IDS.owner }) })) {
      it(`as a ${label}`, async () => {
        await open(make(), '/app');
        for (const path of PAGES) {
          await app.navigate(path);
          if (label === 'guest' && path === '/app/library') continue;
          assert.equal(app.exists('#view .error-state'), false, path);
          assert.equal(app.exists('#view .skeleton'), false, path);
          assert.ok(app.exists('#view h1'), path);
        }
      });
    }
  });
});
