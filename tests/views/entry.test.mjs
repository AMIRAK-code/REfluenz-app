// The post page (/app/p/:id): header, words, gallery, film, the lock, actions, the conversation and more from the atelier.
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom, mountApp, confirmWith } from '../helpers/dom.mjs';
import { createFakeApi, IDS, PUBLIC_BASE } from '../helpers/fake-api.mjs';

const E = IDS.entries;
const HOSTILE = '<img src=x onerror=alert(1)>';
const guest = () => createFakeApi({ signedIn: null });
const member = () => createFakeApi();
const owner = () => createFakeApi({ signedIn: IDS.owner });
const callsTo = (fake, method) => fake.calls.filter(call => call.method === method);
const entryRow = (fake, id) => fake.db.entries.find(row => row.id === id);
const post = id => `/app/p/${id}`;

// Extra published posts for an atelier, newest first, so the "more from this atelier" list has a next page.
function addPosts(fake, creatorId, count) {
  const source = fake.db.entries.find(row => row.creator_id === creatorId && row.status === 'published' && row.kind === 'text');
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.parse('2026-09-15T08:00:00Z') - i * 3_600_000).toISOString();
    fake.db.entries.push({ ...source, id: `3a000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title: `Extra post ${i + 1}`, access: 'public', published_at: at, created_at: at, updated_at: at });
  }
  fake.refresh();
}

// Top-level comments from fan1, oldest first.
function addComments(fake, entryId, count) {
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.parse('2026-09-30T08:00:00Z') + i * 60_000).toISOString();
    fake.db.comments.push({ id: `5a000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, entry_id: entryId, author_id: IDS.fan1, parent_id: null, body: `Extra comment ${i + 1}`, created_at: at, edited_at: null });
  }
  fake.refresh();
}

describe('the post page', () => {
  before(() => installDom());
  after(() => uninstallDom());

  let app;
  const open = async (api, path) => { app = await mountApp({ api, path }); return app; };
  afterEach(async () => { await app?.destroy(); app = null; });

  const dialog = () => app.find('#modal');
  const dialogOpen = () => app.exists('#modal') && app.find('#modal').open;
  const toastText = () => (app.exists('#toast') ? app.text('#toast') : '');
  const text = selector => app.text(`#view ${selector}`);
  const exists = selector => app.exists(`#view ${selector}`);
  const comment = id => app.find(`[data-comment="${id}"]`);
  const commentIds = () => [...app.document.querySelectorAll('#view [data-comment]')].map(node => node.dataset.comment);
  const type = (selector, value) => {
    const field = app.find(selector);
    field.value = value;
    field.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    return field;
  };
  const press = async (selector, init) => {
    app.find(selector).dispatchEvent(new app.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    await app.settle();
  };
  const setNavigator = (name, value) => Object.defineProperty(globalThis.navigator, name, { value, configurable: true, writable: true });

  describe('a public text post as a guest', () => {
    it('draws the header, the byline, the badges and the words', async () => {
      await open(guest(), post(E.linenWardrobe));
      assert.equal(app.document.title, 'Notes on a linen wardrobe — REFLUENZ');
      assert.equal(app.document.querySelectorAll('#view h1').length, 1);
      assert.equal(text('h1'), 'Notes on a linen wardrobe');
      assert.equal(text('.post-subtitle'), 'What lasts a summer, and what lasts ten.');
      assert.match(text('.post-head .eyebrow'), /Style · Essay/);
      const byline = app.find('#view .post-author-link');
      assert.equal(byline.getAttribute('href'), '/app/c/atelier-solene');
      assert.match(byline.textContent, /Atelier Solene/);
      assert.match(text('.post-author'), /Showcase/);
      assert.equal(app.find('#view .post-author [data-follow]').getAttribute('aria-pressed'), 'false');
      assert.match(text('.post-meta'), /2026/);
      assert.match(text('.post-meta'), /2 min read/);
      assert.match(text('.post-badges'), /Text/);
      assert.match(text('.post-badges'), /Open to everyone/);
      assert.equal(app.document.querySelectorAll('#view .post-body p').length, 2);
      assert.match(text('.post-body'), /A second paragraph with a little more detail/);
      assert.ok(!exists('.post-lock'), 'readable posts have no lock');
    });

    it('is an article with a labelled heading, a toolbar group and pressed toggles', async () => {
      await open(guest(), post(E.linenWardrobe));
      const article = app.find('#view article');
      assert.equal(article.getAttribute('aria-labelledby'), 'post-title');
      assert.equal(app.find('#post-title').localName, 'h1');
      const toolbar = app.find('#view .post-toolbar');
      assert.equal(toolbar.getAttribute('role'), 'group');
      assert.ok(toolbar.getAttribute('aria-label'));
      assert.equal(app.find('#view [data-like]').getAttribute('aria-pressed'), 'false');
      assert.equal(app.find('#view [data-save]').getAttribute('aria-pressed'), 'false');
      for (const control of app.document.querySelectorAll('#view .post-toolbar button')) {
        assert.ok(control.getAttribute('aria-label') || control.textContent.trim(), 'every control has a name');
      }
    });

    it('asks a guest to sign in before following, liking or saving, and counts nothing', async () => {
      const api = guest();
      await open(api, post(E.linenWardrobe));
      for (const selector of ['[data-follow]', '[data-like]', '[data-save]']) {
        await app.click(`#view ${selector}`);
        assert.ok(dialogOpen(), `${selector} opens the sign-in dialog`);
        assert.match(dialog().textContent, /Sign in/);
        dialog().close();
        await app.settle();
      }
      assert.equal(callsTo(api, 'setLike').length + callsTo(api, 'setBookmark').length + callsTo(api, 'setFollow').length, 0);
      assert.equal(callsTo(api, 'recordRead').length, 0, 'a guest’s visit is not recorded');
    });

    it('shows the conversation, threaded, with an invitation to sign in', async () => {
      await open(guest(), post(E.linenWardrobe));
      assert.equal(text('#comments-title'), 'Comments');
      assert.equal(text('[data-comments-count]'), '2 comments');
      assert.deepEqual(commentIds(), [IDS.comments.first, IDS.comments.reply]);
      assert.ok(app.find(`[data-comment="${IDS.comments.first}"] .post-comment-replies`).contains(comment(IDS.comments.reply)), 'the reply sits under its parent');
      assert.match(text('.post-comment-body'), /washing linen twice/);
      assert.ok(!exists('[data-comment-form]'), 'guests have no composer');
      assert.match(text('.post-comment-guest'), /Sign in to join the conversation/);
      assert.equal(app.find('#view .post-comment-guest a').getAttribute('href'), `/app/login?next=${encodeURIComponent(post(E.linenWardrobe))}`);
      assert.match(app.find('#view .post-comment-guest a:last-child').getAttribute('href'), /^\/app\/signup\?next=/);
    });

    it('asks a guest to sign in before replying or reporting, and writes nothing', async () => {
      const api = guest();
      await open(api, post(E.linenWardrobe));
      await app.click(`[data-comment="${IDS.comments.first}"] [data-comment-action="reply"]`);
      assert.ok(dialogOpen());
      assert.match(dialog().textContent, /Sign in to reply/);
      dialog().close();
      await app.settle();
      await app.click('#view [data-post-action="report"]');
      assert.match(dialog().textContent, /Sign in to report this post/);
      assert.equal(callsTo(api, 'report').length, 0);
      assert.equal(callsTo(api, 'addComment').length, 0);
    });

    it('lists more from the same atelier without the post itself', async () => {
      await open(guest(), post(E.linenWardrobe));
      const section = app.find('#view [data-more]');
      assert.equal(section.hidden, false);
      assert.equal(text('#more-title'), 'More from this atelier');
      assert.equal(section.getAttribute('aria-labelledby'), 'more-title');
      const cards = [...section.querySelectorAll('[data-entry]')].map(card => card.dataset.entry);
      assert.equal(cards.length, 4);
      assert.ok(!cards.includes(E.linenWardrobe));
      assert.ok(cards.includes(E.cuttingRoom), 'locked posts are listed too');
      assert.equal(app.find('#view [data-more] .section-head a').getAttribute('href'), '/app/c/atelier-solene');
      assert.ok(section.querySelector(`[data-entry="${E.cuttingRoom}"].is-locked`));
    });

    it('hides the list when the atelier has nothing else', async () => {
      await open(guest(), post(E.firstDraftHabits));
      assert.equal(app.find('#view [data-more]').hidden, true);
    });
  });

  describe('missing, hidden and failing posts', () => {
    it('says so calmly when the post does not exist', async () => {
      await open(guest(), post('3f000000-0000-4000-8000-000000000999'));
      assert.equal(text('h1'), 'This post is not available');
      assert.equal(app.document.title, 'Post not found — REFLUENZ');
      assert.equal(app.find('#view .post-missing a').getAttribute('href'), '/app');
      assert.ok(!exists('#comments'));
    });

    it('treats an address that is not an id like a missing post', async () => {
      await open(guest(), post('not-an-id'));
      assert.equal(text('h1'), 'This post is not available');
    });

    it('does not reveal a draft to a guest or to another member', async () => {
      await open(guest(), post(E.unfinishedEssay));
      assert.equal(text('h1'), 'This post is not available');
      assert.ok(!app.html('#view').includes('An essay still unfinished'));
      await app.destroy();
      await open(member(), post(E.unfinishedEssay));
      assert.equal(text('h1'), 'This post is not available');
    });

    it('shows a failed load with a retry that works', async () => {
      const api = guest();
      api.fail('getEntry', 'We could not reach the library. Try again in a moment.');
      await open(api, post(E.linenWardrobe));
      assert.match(app.text('#view .error-state'), /We could not reach the library/);
      assert.equal(app.document.title, 'Post unavailable — REFLUENZ');
      api.fail('getEntry', null);
      await app.click('#view [data-post-reload]');
      assert.equal(text('h1'), 'Notes on a linen wardrobe');
    });

    it('still draws the post when the creator or the tiers cannot be read', async () => {
      const api = guest();
      api.fail('listTiers', 'tiers are down');
      await open(api, post(E.tailorsLedger));
      assert.equal(text('h1'), 'The tailor’s ledger');
      assert.match(text('.post-lock'), /Essential/, 'falls back to the standard tier name');
    });
  });

  describe('as a member', () => {
    it('counts the visit once, and only for a post that can be read', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      assert.deepEqual(callsTo(api, 'recordRead').map(call => call.args[0]), [E.linenWardrobe]);
      await app.click('#view [data-like]');
      assert.equal(callsTo(api, 'recordRead').length, 1);
      assert.equal(api.db.entry_reads.length, 1);
      await app.destroy();

      const locked = member();
      await open(locked, post(E.cuttingRoom));
      assert.equal(callsTo(locked, 'recordRead').length, 0);
    });

    it('likes and unlikes with an optimistic count, and rolls back with a message when it fails', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      const like = () => app.find('#view [data-like]');
      assert.equal(like().getAttribute('aria-pressed'), 'false');
      assert.equal(like().querySelector('[data-count]').textContent, '1');
      await app.click(like());
      assert.equal(like().getAttribute('aria-pressed'), 'true');
      assert.equal(like().querySelector('[data-count]').textContent, '2');
      assert.deepEqual(callsTo(api, 'setLike').map(call => call.args), [[E.linenWardrobe, true]]);
      await app.click(like());
      assert.equal(like().getAttribute('aria-pressed'), 'false');

      api.fail('setLike', 'The like could not be saved.');
      await app.click(like());
      assert.equal(like().getAttribute('aria-pressed'), 'false', 'rolled back');
      assert.equal(like().querySelector('[data-count]').textContent, '1');
      assert.match(toastText(), /The like could not be saved/);
    });

    it('saves to the library and shows an existing save as pressed', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      assert.equal(app.find('#view [data-save]').getAttribute('aria-pressed'), 'true', 'already in the library');
      await app.click('#view [data-save]');
      assert.equal(app.find('#view [data-save]').getAttribute('aria-pressed'), 'false');
      assert.deepEqual(callsTo(api, 'setBookmark').map(call => call.args), [[E.linenWardrobe, false]]);
    });

    it('follows the atelier from the byline', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      await app.click('#view [data-follow]');
      assert.equal(app.find('#view [data-follow]').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(callsTo(api, 'setFollow').map(call => call.args), [[IDS.solene, true]]);
    });

    it('names the tier of a post that is open to a lower circle only', async () => {
      await open(member(), post(E.tailorsLedger));
      assert.match(text('.post-badges'), /Friend and above/);
      assert.ok(exists('.post-body'), 'the member’s tier reads it');
    });

    it('lets the member leave the page after the first visit without losing the position of the toolbar', async () => {
      await open(member(), post(E.linenWardrobe));
      await app.navigate(post(E.tailorsLedger));
      assert.equal(app.document.title, 'The tailor’s ledger — REFLUENZ');
      assert.equal(text('h1'), 'The tailor’s ledger');
      assert.equal(app.document.querySelectorAll('#view article.post-page').length, 1);
    });
  });

  describe('a post for a circle the viewer is not in', () => {
    it('shows the excerpt and a lock card that names the tier and joins at the atelier, and asks for no media', async () => {
      const api = member();
      await open(api, post(E.cuttingRoom));
      assert.equal(text('h1'), 'Inside the cutting room');
      assert.match(text('.post-badges'), /Patron and above/);
      assert.equal(text('.post-lock h2'), 'There is more inside the circle');
      assert.match(text('.post-lock .eyebrow'), /Patron and above/);
      assert.match(text('.post-lock'), /Your Friend membership does not include it yet/);
      assert.match(text('.post-lock'), /€19|19[.,]00/);
      assert.match(text('.post-lock'), /Joining is free during early access/);
      const join = app.find('#view .post-lock-actions a.button');
      assert.equal(join.getAttribute('href'), '/app/c/atelier-solene?join=1');
      assert.match(join.textContent, /Join to read/);
      assert.ok(!exists('video'));
      assert.ok(!exists('#comments'), 'no conversation behind the lock');
      assert.ok(!exists('[data-like]'), 'nothing to like yet');
      const touchedMedia = [...callsTo(api, 'media'), ...callsTo(api, 'signedUrls')];
      for (const call of touchedMedia) {
        assert.ok(!JSON.stringify(call.args).includes(E.cuttingRoom), 'the locked post’s files are never asked for');
      }
      assert.equal(callsTo(api, 'listComments').length, 0);
    });

    it('shows the excerpt of a locked text post and offers sign-in to a guest', async () => {
      const api = guest();
      await open(api, post(E.patternArchive));
      assert.match(text('.post-excerpt'), /A longer paragraph that stands in for the opening/);
      assert.ok(!exists('.post-body'), 'the words are not drawn');
      assert.ok(!app.html('#view').includes('A second paragraph'));
      assert.match(text('.post-lock .eyebrow'), /Atelier and above/);
      assert.equal(app.find('#view .post-lock .text-link').getAttribute('href'), `/app/login?next=${encodeURIComponent(post(E.patternArchive))}`);
      assert.equal(callsTo(api, 'recordRead').length, 0);
      assert.equal(callsTo(api, 'listComments').length, 0);
    });

    it('draws the blurred public preview of a locked image post and no gallery', async () => {
      const api = member();
      await open(api, post(E.sketchbook));
      const preview = app.find('#view .post-preview');
      assert.ok(preview.classList.contains('is-preview'));
      assert.ok(preview.querySelector('img').getAttribute('src').startsWith(`${PUBLIC_BASE}/previews/`));
      assert.equal(preview.querySelector('img').getAttribute('alt'), '');
      assert.ok(!exists('.post-gallery'));
      assert.equal(callsTo(api, 'signedUrls').filter(call => call.args[0].some(path => path.includes(E.sketchbook))).length, 0);
    });

    it('falls back to an editorial preset when a locked text post has no cover', async () => {
      await open(guest(), post(E.patternArchive));
      const preview = app.find('#view .post-preview');
      assert.ok(preview.classList.contains('is-preset'));
      assert.match(preview.querySelector('img').getAttribute('src'), /^\/editorial\/v1\/.+\.jpg$/);
    });

    it('says when the tier is closed to new members', async () => {
      const api = member();
      api.db.creator_tiers.find(row => row.creator_id === IDS.solene && row.tier_id === 'premium').enabled = false;
      await open(api, post(E.cuttingRoom));
      assert.match(text('.post-lock'), /not open to new members right now/);
      assert.match(text('.post-lock-actions a.button'), /See the memberships/);
      assert.ok(!exists('.post-lock-price'), 'a closed tier shows no price');
    });

    it('opens as soon as the member joins a tier that reaches it', async () => {
      const api = member();
      await open(api, post(E.cuttingRoom));
      assert.ok(exists('.post-lock'));
      await api.join(IDS.solene, 'premium');
      await app.store.reloadViewer();
      await app.navigate(post(E.cuttingRoom));
      assert.ok(!exists('.post-lock'));
      assert.ok(exists('video'));
    });
  });

  describe('image posts', () => {
    it('draws the originals as a gallery with their alt text, asking once for the files', async () => {
      const api = guest();
      await open(api, post(E.fittingDay));
      assert.match(text('.post-badges'), /Images/);
      assert.match(text('.post-meta'), /2 images/);
      const images = [...app.document.querySelectorAll('#view .post-gallery img')];
      assert.equal(images.length, 2);
      assert.deepEqual(images.map(img => img.getAttribute('alt')), ['Photograph 1', 'Photograph 2']);
      for (const img of images) {
        assert.match(img.getAttribute('src'), /^https:\/\/fake\.supabase\.test\/storage\/v1\/object\/sign\/entry-media\//);
        assert.equal(img.getAttribute('loading'), 'lazy');
        assert.equal(img.getAttribute('width'), '1600');
      }
      assert.equal(callsTo(api, 'media').filter(call => call.args[0].includes(E.fittingDay)).length, 1);
      assert.equal(callsTo(api, 'signedUrls').filter(call => call.args[0].some(path => path.includes(E.fittingDay))).length, 1);
    });

    it('writes a fallback description when an image has no alt text', async () => {
      const api = guest();
      for (const row of api.db.entry_media.filter(media => media.entry_id === E.fittingDay)) row.alt = '';
      await open(api, post(E.fittingDay));
      assert.equal(app.find('#view .post-gallery img').getAttribute('alt'), 'Fitting day, image 1');
    });

    it('opens a keyboard-friendly lightbox that steps through the images', async () => {
      await open(guest(), post(E.fittingDay));
      const opener = app.find('#view [data-lightbox="0"]');
      assert.match(opener.getAttribute('aria-label'), /View image 1 of 2/);
      await app.click(opener);
      assert.ok(dialogOpen());
      const stage = () => dialog().querySelector('[data-lightbox-image]');
      assert.equal(stage().getAttribute('alt'), 'Photograph 1');
      assert.equal(dialog().querySelector('[data-lightbox-count]').textContent, 'Image 1 of 2');
      await app.click(dialog().querySelector('[data-lightbox-step="1"]'));
      assert.equal(stage().getAttribute('alt'), 'Photograph 2');
      assert.equal(dialog().querySelector('[data-lightbox-count]').textContent, 'Image 2 of 2');
      await press('#modal', { key: 'ArrowRight' });
      assert.equal(stage().getAttribute('alt'), 'Photograph 1', 'wraps around');
      await press('#modal', { key: 'ArrowLeft' });
      assert.equal(stage().getAttribute('alt'), 'Photograph 2');
      await app.click('#modal [data-modal-close]');
      assert.ok(!dialogOpen());
    });

    it('keeps the post and offers a retry when the files cannot be signed', async () => {
      const api = guest();
      api.fail('signedUrls', 'storage is down');
      await open(api, post(E.fittingDay));
      assert.equal(text('h1'), 'Fitting day');
      assert.ok(!exists('.post-gallery'));
      assert.match(text('.post-media .post-note'), /The images could not be loaded/);
      api.fail('signedUrls', null);
      await app.click('#view [data-media-retry]');
      assert.equal(app.document.querySelectorAll('#view .post-gallery img').length, 2);
      assert.ok(!exists('[data-media-retry]'));
    });

    it('keeps the post and offers a retry when the file list cannot be read', async () => {
      const api = guest();
      api.fail('media', 'database is down');
      await open(api, post(E.fittingDay));
      assert.match(text('.post-media .post-note'), /could not be loaded/);
      api.fail('media', null);
      await app.click('#view [data-media-retry]');
      assert.equal(app.document.querySelectorAll('#view .post-gallery img').length, 2);
    });

    it('shows the images that could be signed and says how many could not', async () => {
      const api = guest();
      const sign = api.signedUrls;
      api.signedUrls = async paths => {
        const urls = await sign(paths);
        const [first] = Object.keys(urls);
        if (callsTo(api, 'signedUrls').length === 1 && first) delete urls[Object.keys(urls).at(-1)];
        return urls;
      };
      await open(api, post(E.fittingDay));
      assert.equal(app.document.querySelectorAll('#view .post-gallery img').length, 1);
      assert.match(text('.post-media .post-note'), /1 file could not be loaded/);
    });

    it('says so when a post has no images yet', async () => {
      const api = guest();
      api.db.entry_media = api.db.entry_media.filter(row => row.entry_id !== E.fittingDay);
      api.refresh();
      await open(api, post(E.fittingDay));
      assert.match(text('.post-media .post-note'), /No images have been added to this post yet/);
    });

    it('signs an image again once when its link has expired', async () => {
      const api = guest();
      await open(api, post(E.fittingDay));
      const image = app.find('#view .post-gallery img');
      const before = image.getAttribute('src');
      const signings = () => callsTo(api, 'signedUrls').length;
      const start = signings();
      image.dispatchEvent(new app.window.Event('error'));
      await app.settle();
      assert.equal(signings(), start + 1);
      assert.notEqual(image.getAttribute('src'), before, 'a fresh link replaces the old one');
      image.dispatchEvent(new app.window.Event('error'));
      await app.settle();
      assert.equal(signings(), start + 1, 'only once');
    });

    it('lets an image post show the caption under the images', async () => {
      await open(guest(), post(E.fittingDay));
      assert.match(text('.post-body'), /A short caption for this post/);
    });
  });

  describe('video posts', () => {
    it('plays in a native player with controls, no autoplay, a poster and the length in the header', async () => {
      await open(guest(), post(E.workshopTour));
      assert.match(text('.post-badges'), /Video/);
      assert.match(text('.post-meta'), /3:35/);
      const video = app.find('#view video');
      assert.ok(video.hasAttribute('controls'));
      assert.ok(video.hasAttribute('playsinline'));
      assert.equal(video.getAttribute('preload'), 'metadata');
      assert.ok(!video.hasAttribute('autoplay'));
      assert.match(video.getAttribute('src'), /entry-media\/.+\.mp4/);
      assert.match(video.getAttribute('poster'), /entry-media\/.+-poster\.jpg/);
      assert.ok(video.getAttribute('aria-label'));
    });

    it('pauses and unloads the film when the page is left', async () => {
      await open(guest(), post(E.workshopTour));
      const video = app.find('#view video');
      let paused = 0;
      video.pause = () => { paused += 1; };
      await app.navigate('/app/discover');
      assert.equal(paused, 1);
      assert.equal(video.getAttribute('src'), null);
    });

    it('keeps the caption and says so when the film cannot be signed', async () => {
      const api = guest();
      api.fail('signedUrls', 'storage is down');
      await open(api, post(E.workshopTour));
      assert.ok(!exists('video'));
      assert.match(text('.post-media .post-note'), /The video could not be loaded/);
      assert.match(text('.post-body'), /A short caption/);
      api.fail('signedUrls', null);
      await app.click('#view [data-media-retry]');
      assert.ok(exists('video'));
    });

    it('shows the film of the member’s circle', async () => {
      const api = member();
      api.db.memberships.find(row => row.user_id === IDS.member).tier = 'premium';
      await open(api, post(E.cuttingRoom));
      assert.ok(exists('video'));
      assert.ok(!exists('.post-lock'));
      assert.match(text('.post-meta'), /1:34/);
    });
  });

  describe('text posts with a cover', () => {
    it('shows the uploaded cover above the words', async () => {
      const api = guest();
      entryRow(api, E.linenWardrobe).cover_path = `${IDS.solene}/cover.jpg`;
      await open(api, post(E.linenWardrobe));
      const cover = app.find('#view .post-cover img');
      assert.ok(cover.getAttribute('src').startsWith(`${PUBLIC_BASE}/covers/`));
      assert.equal(cover.getAttribute('alt'), '');
      assert.ok(exists('.post-body'));
    });

    it('draws no cover when there is none', async () => {
      await open(guest(), post(E.linenWardrobe));
      assert.ok(!exists('.post-cover'));
    });
  });

  describe('share and report', () => {
    it('copies the link on a desktop', async () => {
      const written = [];
      setNavigator('clipboard', { writeText: async value => { written.push(value); } });
      await open(guest(), post(E.linenWardrobe));
      await app.click('#view [data-post-action="share"]');
      assert.deepEqual(written, [`http://localhost${post(E.linenWardrobe)}`]);
      assert.match(toastText(), /Link copied/);
    });

    it('shows the link in a dialog when the clipboard is not available', async () => {
      setNavigator('clipboard', { writeText: async () => { throw new Error('denied'); } });
      await open(guest(), post(E.linenWardrobe));
      await app.click('#view [data-post-action="share"]');
      assert.ok(dialogOpen());
      assert.equal(dialog().querySelector('#share-url').value, `http://localhost${post(E.linenWardrobe)}`);
      assert.ok(dialog().querySelector('label[for="share-url"]'));
    });

    it('uses the system share sheet on touch devices, and treats dismissing it as fine', async () => {
      const shared = [];
      const original = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
      Object.defineProperty(globalThis, 'matchMedia', { value: () => ({ matches: true }), configurable: true, writable: true });
      try {
        setNavigator('share', async data => { shared.push(data); });
        await open(guest(), post(E.linenWardrobe));
        await app.click('#view [data-post-action="share"]');
        assert.equal(shared.length, 1);
        assert.equal(shared[0].title, 'Notes on a linen wardrobe');
        assert.equal(shared[0].url, `http://localhost${post(E.linenWardrobe)}`);

        setNavigator('share', async () => { throw Object.assign(new Error('closed'), { name: 'AbortError' }); });
        await app.click('#view [data-post-action="share"]');
        assert.ok(!dialogOpen(), 'no dialog and no message');
      } finally {
        setNavigator('share', undefined);
        Object.defineProperty(globalThis, 'matchMedia', original);
      }
    });

    it('requires a reason, sends the report and thanks the person', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      await app.click('#view [data-post-action="report"]');
      assert.match(dialog().textContent, /Report this post/);
      assert.equal(dialog().querySelectorAll('#report-reason option').length, 7);
      assert.ok(dialog().querySelector('label[for="report-reason"]'));
      await app.submit('[data-report-form]', {});
      assert.match(app.text('#modal [data-form-error]'), /Choose a reason for the report/);
      assert.equal(api.db.reports.length, 0);
      await app.submit('[data-report-form]', { reason: 'spam', details: 'Sells the same thing every week.' });
      assert.equal(api.db.reports.length, 1);
      assert.equal(api.db.reports[0].target_type, 'entry');
      assert.equal(api.db.reports[0].target_id, E.linenWardrobe);
      assert.equal(api.db.reports[0].reason, 'spam');
      assert.equal(api.db.reports[0].details, 'Sells the same thing every week.');
      assert.ok(!dialogOpen());
      assert.match(toastText(), /Your report has been sent/);
    });

    it('keeps the dialog and the typed details when sending fails', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      await app.click('#view [data-post-action="report"]');
      api.fail('report', 'Reports are paused for a moment. Try again shortly.');
      await app.submit('[data-report-form]', { reason: 'other', details: 'Details that matter.' });
      assert.ok(dialogOpen());
      assert.match(app.text('#modal [data-form-error]'), /Reports are paused/);
      assert.equal(dialog().querySelector('[name="details"]').value, 'Details that matter.');
      const submit = dialog().querySelector('[type="submit"]');
      assert.equal(submit.disabled, false, 'the button is usable again');
      api.fail('report', null);
      await app.submit('[data-report-form]', {});
      assert.equal(api.db.reports.length, 1);
    });

    it('does not offer a person to report their own post, and does not offer share on a draft', async () => {
      await open(owner(), post(E.firstDraftHabits));
      assert.ok(!exists('[data-post-action="report"]'));
      assert.ok(exists('[data-post-action="share"]'));
      await app.destroy();
      await open(owner(), post(E.unfinishedEssay));
      assert.ok(!exists('[data-post-action="share"]'));
    });
  });

  describe('the owner', () => {
    it('gets an edit link and no follow button on their own atelier', async () => {
      await open(owner(), post(E.firstDraftHabits));
      const edit = app.find('#view .post-toolbar a.button');
      assert.equal(edit.getAttribute('href'), `/app/studio/edit/${E.firstDraftHabits}`);
      assert.match(edit.textContent, /Edit post/);
      assert.ok(!exists('[data-follow]'));
    });

    it('opens a draft with a plain note, the words, and no conversation or like', async () => {
      const api = owner();
      await open(api, post(E.unfinishedEssay));
      assert.equal(text('h1'), 'An essay still unfinished');
      assert.match(text('.post-badges'), /Draft/);
      assert.match(text('.post-draft-note'), /only you can see it/);
      assert.equal(app.find('#view .post-draft-note a').getAttribute('href'), `/app/studio/edit/${E.unfinishedEssay}`);
      assert.ok(exists('.post-body'));
      assert.ok(!exists('#comments'));
      assert.ok(!exists('[data-like]'));
      assert.ok(!exists('[data-save]'));
      assert.equal(callsTo(api, 'recordRead').length, 0, 'a draft is not a reading');
    });

    it('can delete any comment on their post but edits only their own', async () => {
      const api = owner();
      await open(api, post(E.firstDraftHabits));
      const sofia = comment(IDS.comments.onVerne);
      assert.ok(sofia.querySelector('[data-comment-action="delete"]'));
      assert.ok(!sofia.querySelector('[data-comment-action="edit"]'));
      assert.ok(sofia.querySelector('[data-comment-action="report"]'));
      await app.click(sofia.querySelector('[data-comment-action="delete"]'));
      assert.ok(dialogOpen());
      assert.match(dialog().textContent, /Delete this comment/);
      await app.click('#modal [data-confirm="yes"]');
      assert.equal(api.db.comments.filter(row => row.entry_id === E.firstDraftHabits).length, 0);
      assert.ok(!exists(`[data-comment="${IDS.comments.onVerne}"]`));
      assert.match(toastText(), /comment is deleted/);
      assert.match(text('.post-comments-empty'), /No comments yet/);
    });

    it('marks the author’s own comments', async () => {
      const api = owner();
      await api.addComment(E.firstDraftHabits, 'Thank you for reading.');
      await open(api, post(E.firstDraftHabits));
      assert.equal(app.document.querySelectorAll('#view .post-comment .badge').length, 1);
      assert.match(text('.post-comment .badge'), /Author/);
    });
  });

  describe('the conversation', () => {
    const composer = () => app.find('#view form[data-mode="new"]');

    it('gives a member a labelled composer with a counter and a hint', async () => {
      await open(member(), post(E.linenWardrobe));
      assert.ok(app.exists('#view label[for="comment-body"]'));
      assert.equal(app.find('#comment-body').getAttribute('maxlength'), '2000');
      assert.equal(text('[data-counter]'), '0 / 2000');
      type('#comment-body', 'Hello');
      assert.equal(app.find('#view form[data-mode="new"] [data-counter]').textContent, '5 / 2000');
      assert.match(text('.post-comment-hint'), /Ctrl or Cmd \+ Enter/);
    });

    it('posts a comment, clears the field and shows it at the end of the list', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      await app.submit('#view form[data-mode="new"]', { body: 'I wore mine to the market on Saturday.' });
      assert.deepEqual(callsTo(api, 'addComment').map(call => call.args), [[E.linenWardrobe, 'I wore mine to the market on Saturday.', null]]);
      assert.equal(app.find('#comment-body').value, '');
      assert.equal(text('[data-counter]'), '0 / 2000');
      assert.equal(commentIds().length, 3);
      assert.match(text('[data-comments-count]'), /3 comments/);
      assert.match(app.text(`[data-comment="${commentIds()[2]}"]`), /I wore mine to the market on Saturday\./);
      assert.match(toastText(), /Your comment is posted/);
      assert.equal(app.router.block(), null, 'nothing is waiting to be saved');
    });

    it('posts with Ctrl+Enter and with Cmd+Enter', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      type('#comment-body', 'First by keyboard');
      await press('#comment-body', { key: 'Enter', ctrlKey: true });
      assert.equal(callsTo(api, 'addComment').length, 1);
      type('#comment-body', 'Second by keyboard');
      await press('#comment-body', { key: 'Enter', metaKey: true });
      assert.equal(callsTo(api, 'addComment').length, 2);
      type('#comment-body', 'Plain enter adds a line');
      await press('#comment-body', { key: 'Enter' });
      assert.equal(callsTo(api, 'addComment').length, 2);
    });

    it('says what is wrong with an empty or too long comment, and sends nothing', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      await app.submit('#view form[data-mode="new"]', { body: '   ' });
      assert.ok(composer().querySelector('[data-form-error]').textContent.length > 0);
      assert.equal(callsTo(api, 'addComment').length, 0);
      await app.submit('#view form[data-mode="new"]', { body: 'x'.repeat(2001) });
      assert.match(composer().querySelector('[data-form-error]').textContent, /2,?000/);
      assert.equal(callsTo(api, 'addComment').length, 0);
      type('#comment-body', 'Now it is fine');
      assert.equal(composer().querySelector('[data-form-error]').textContent, '', 'typing clears the message');
    });

    it('keeps the typed text and shows the message when posting fails, then posts on the next try', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      api.fail('addComment', 'You are commenting too quickly. Wait a moment.');
      await app.submit('#view form[data-mode="new"]', { body: 'My careful thought.' });
      assert.equal(app.find('#comment-body').value, 'My careful thought.');
      assert.match(composer().querySelector('[data-form-error]').textContent, /too quickly/);
      assert.match(toastText(), /too quickly/);
      assert.equal(composer().querySelector('[type="submit"]').disabled, false);
      assert.equal(commentIds().length, 2);
      api.fail('addComment', null);
      await app.submit('#view form[data-mode="new"]', {});
      assert.equal(commentIds().length, 3);
      assert.equal(app.find('#comment-body').value, '');
    });

    it('asks before leaving the page with an unposted comment', async () => {
      await open(member(), post(E.linenWardrobe));
      assert.equal(app.router.block(), null);
      type('#comment-body', 'Half a thought');
      assert.match(app.router.block(), /not been posted/);
      const asked = confirmWith(false);
      await app.navigate('/app/discover');
      assert.equal(asked.length, 1);
      assert.equal(app.path, post(E.linenWardrobe), 'staying on the page keeps the text');
      assert.equal(app.find('#comment-body').value, 'Half a thought');
      confirmWith(true);
      await app.navigate('/app/discover');
      assert.equal(app.path, '/app/discover');
      assert.equal(app.router.block, null);
    });

    it('replies under a comment, keeps the draft when the form is closed, and attaches to the top comment', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      const first = IDS.comments.first;
      await app.click(`[data-comment="${first}"] [data-comment-action="reply"]`);
      const form = app.find(`#view form[data-mode="reply"][data-target="${first}"]`);
      assert.ok(form, 'an inline reply form opens');
      assert.equal(app.document.activeElement.id, `comment-reply-${first}`, 'focus moves to the field');
      type(`#comment-reply-${first}`, 'Half written');
      await app.click(`[data-comment="${first}"] [data-comment-action="reply"]`);
      assert.ok(!app.exists('#view form[data-mode="reply"]'), 'a second press closes it');
      await app.click(`[data-comment="${first}"] [data-comment-action="reply"]`);
      assert.equal(app.find(`#comment-reply-${first}`).value, 'Half written', 'what was typed is still there');
      await app.submit(`#view form[data-mode="reply"]`, { body: 'Thank you, that is kind.' });
      assert.deepEqual(callsTo(api, 'addComment').at(-1).args, [E.linenWardrobe, 'Thank you, that is kind.', first]);
      assert.ok(!app.exists('#view form[data-mode="reply"]'));
      const replies = [...app.document.querySelectorAll(`[data-comment="${first}"] .post-comment-replies > .post-comment`)];
      assert.equal(replies.length, 2);
      assert.match(replies[1].textContent, /Thank you, that is kind\./);
      assert.match(toastText(), /Your reply is posted/);

      // A reply to a reply goes under the same top comment (threads stay one level deep).
      await app.click(`[data-comment="${IDS.comments.reply}"] [data-comment-action="reply"]`);
      await app.submit('#view form[data-mode="reply"]', { body: 'And a third.' });
      assert.equal(app.document.querySelectorAll(`[data-comment="${first}"] .post-comment-replies > .post-comment`).length, 3);
    });

    it('cancels a reply with the button or with Escape', async () => {
      await open(member(), post(E.linenWardrobe));
      const first = IDS.comments.first;
      await app.click(`[data-comment="${first}"] [data-comment-action="reply"]`);
      await app.click('#view form[data-mode="reply"] [data-comment-action="cancel"]');
      assert.ok(!app.exists('#view form[data-mode="reply"]'));
      await app.click(`[data-comment="${first}"] [data-comment-action="reply"]`);
      await press(`#comment-reply-${first}`, { key: 'Escape' });
      assert.ok(!app.exists('#view form[data-mode="reply"]'));
      assert.equal(app.document.activeElement.id, `comment-${first}`, 'focus returns to the comment');
    });

    it('edits only the viewer’s own comment, in place, and marks it edited', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      assert.ok(!app.exists(`[data-comment="${IDS.comments.first}"] > .post-comment-actions [data-comment-action="edit"]`), 'not another person’s');
      const mine = IDS.comments.reply;
      await app.click(`[data-comment="${mine}"] [data-comment-action="edit"]`);
      assert.equal(app.find(`#comment-edit-${mine}`).value, 'Same here. The second wash is the one that matters.');
      await app.submit('#view form[data-mode="edit"]', { body: 'Same here. The second wash is the one that counts.' });
      assert.deepEqual(callsTo(api, 'editComment').map(call => call.args), [[mine, 'Same here. The second wash is the one that counts.']]);
      assert.match(app.text(`[data-comment="${mine}"] .post-comment-body`), /that counts/);
      assert.match(app.text(`[data-comment="${mine}"] .post-comment-meta`), /edited/);
      assert.ok(!app.exists('#view form[data-mode="edit"]'));
      assert.match(toastText(), /Your comment is updated/);
    });

    it('keeps the edit open with the text and the message when saving fails', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      const mine = IDS.comments.reply;
      await app.click(`[data-comment="${mine}"] [data-comment-action="edit"]`);
      api.fail('editComment', 'That comment could not be saved.');
      await app.submit('#view form[data-mode="edit"]', { body: 'A better version.' });
      assert.match(app.text('#view form[data-mode="edit"] [data-form-error]'), /could not be saved/);
      assert.equal(app.find(`#comment-edit-${mine}`).value, 'A better version.');
      assert.equal(api.db.comments.find(row => row.id === mine).body, 'Same here. The second wash is the one that matters.');
    });

    it('closes an edit that changed nothing without calling the api', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      const mine = IDS.comments.reply;
      await app.click(`[data-comment="${mine}"] [data-comment-action="edit"]`);
      await app.submit('#view form[data-mode="edit"]', {});
      assert.equal(callsTo(api, 'editComment').length, 0);
      assert.ok(!app.exists('#view form[data-mode="edit"]'));
    });

    it('deletes the viewer’s own comment after a confirmation, and not when the confirmation is declined', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      const mine = IDS.comments.reply;
      await app.click(`[data-comment="${mine}"] [data-comment-action="delete"]`);
      await app.click('#modal [data-confirm="no"]');
      assert.equal(callsTo(api, 'deleteComment').length, 0);
      assert.ok(app.exists(`[data-comment="${mine}"]`));
      await app.click(`[data-comment="${mine}"] [data-comment-action="delete"]`);
      await app.click('#modal [data-confirm="yes"]');
      assert.deepEqual(callsTo(api, 'deleteComment').map(call => call.args), [[mine]]);
      assert.ok(!app.exists(`[data-comment="${mine}"]`));
      assert.match(text('[data-comments-count]'), /^1 comment$/);
    });

    it('removes the replies together with a deleted comment and says so in the question', async () => {
      const api = owner();
      // Marco owns Verne & Co, so he may delete any comment on that post.
      const parent = api.db.comments.find(row => row.id === IDS.comments.onVerne);
      api.db.comments.push({ id: '5b000000-0000-4000-8000-000000000001', entry_id: E.firstDraftHabits, author_id: IDS.fan1, parent_id: parent.id, body: 'Agreed.', created_at: '2026-09-29T12:00:00+00:00', edited_at: null });
      api.refresh();
      await open(api, post(E.firstDraftHabits));
      assert.equal(commentIds().length, 2);
      await app.click(`[data-comment="${parent.id}"] > .post-comment-actions [data-comment-action="delete"]`);
      assert.match(dialog().textContent, /replies are removed with it/);
      await app.click('#modal [data-confirm="yes"]');
      assert.equal(commentIds().length, 0);
    });

    it('reports another person’s comment', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      assert.ok(!comment(IDS.comments.reply).querySelector('[data-comment-action="report"]'), 'not one’s own');
      await app.click(`[data-comment="${IDS.comments.first}"] [data-comment-action="report"]`);
      assert.match(dialog().textContent, /Report this comment/);
      await app.submit('[data-report-form]', { reason: 'harassment' });
      assert.equal(api.db.reports.length, 1);
      assert.equal(api.db.reports[0].target_type, 'comment');
      assert.equal(api.db.reports[0].target_id, IDS.comments.first);
    });

    it('says so when there is nothing yet, with a prompt matched to who is reading', async () => {
      const api = member();
      api.db.comments = api.db.comments.filter(row => row.entry_id !== E.linenWardrobe);
      api.refresh();
      await open(api, post(E.linenWardrobe));
      assert.match(text('.post-comments-empty'), /No comments yet/);
      assert.match(text('.post-comments-empty'), /Be the first/);
      await app.destroy();
      const visitor = guest();
      visitor.db.comments = visitor.db.comments.filter(row => row.entry_id !== E.linenWardrobe);
      visitor.refresh();
      await open(visitor, post(E.linenWardrobe));
      assert.match(text('.post-comments-empty'), /Sign in to start the conversation/);
    });

    it('shows a failed list with a retry and leaves the post alone', async () => {
      const api = member();
      api.fail('listComments', 'The comments are taking too long.');
      await open(api, post(E.linenWardrobe));
      assert.match(app.text('#view .post-comments .error-state'), /The comments are taking too long/);
      assert.ok(exists('.post-body'));
      api.fail('listComments', null);
      await app.click('#view [data-comments-retry]');
      assert.equal(commentIds().length, 2);
    });

    it('shows a skeleton with a loading status while the list is read', async () => {
      const api = member();
      let release;
      const real = api.listComments;
      api.listComments = id => new Promise(resolve => { release = () => resolve(real(id)); });
      await open(api, post(E.linenWardrobe));
      assert.ok(exists('.post-comments .skeleton[role="status"]'));
      release();
      await app.settle();
      assert.ok(!exists('.post-comments .skeleton'));
    });

    it('shows twenty conversations and more on request', async () => {
      const api = member();
      addComments(api, E.linenWardrobe, 25);
      await open(api, post(E.linenWardrobe));
      assert.equal(app.document.querySelectorAll('#view .post-comment-list > .post-comment').length, 20);
      const more = app.find('#view [data-comment-action="more"]');
      assert.match(more.textContent, /Show more comments \(6 more\)/);
      await app.click(more);
      assert.equal(app.document.querySelectorAll('#view .post-comment-list > .post-comment').length, 26);
      assert.ok(!app.exists('#view [data-comment-action="more"]'));
    });

    it('reads the list again when someone comments while the page is open', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      assert.equal(commentIds().length, 2);
      const row = { id: '5c000000-0000-4000-8000-000000000001', entry_id: E.linenWardrobe, author_id: IDS.fan2, parent_id: null, body: 'Late to this, and glad I came.', created_at: '2026-10-07T08:00:00+00:00', edited_at: null };
      api.db.comments.push(row);
      api.refresh();
      api.emit(IDS.member, 'notification', { id: '8c000000-0000-4000-8000-000000000001', user_id: IDS.member, type: 'comment', actor_id: IDS.fan2, creator_id: IDS.solene, entry_id: E.linenWardrobe, comment_id: row.id, read_at: null, created_at: row.created_at });
      await app.settle();
      assert.equal(commentIds().length, 3);
      assert.match(text('.post-comments'), /Late to this/);
    });

    it('does not redraw the list under a person who is writing', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      const field = type('#comment-body', 'Still thinking');
      field.focus();
      const row = { id: '5c000000-0000-4000-8000-000000000002', entry_id: E.linenWardrobe, author_id: IDS.fan2, parent_id: null, body: 'Arrived meanwhile.', created_at: '2026-10-07T08:00:00+00:00', edited_at: null };
      api.db.comments.push(row);
      api.refresh();
      api.emit(IDS.member, 'notification', { id: '8c000000-0000-4000-8000-000000000002', user_id: IDS.member, type: 'comment', actor_id: IDS.fan2, creator_id: IDS.solene, entry_id: E.linenWardrobe, comment_id: row.id, read_at: null, created_at: row.created_at });
      await app.settle();
      assert.equal(app.find('#comment-body').value, 'Still thinking');
      assert.equal(app.find('#comment-body'), field, 'the composer is the same element');
    });
  });

  describe('more from this atelier', () => {
    it('pages through the rest with a Load more button', async () => {
      const api = guest();
      addPosts(api, IDS.solene, 10);
      await open(api, post(E.linenWardrobe));
      const shown = () => app.document.querySelectorAll('#view [data-more] [data-entry]').length;
      assert.equal(shown(), 6);
      assert.equal(callsTo(api, 'creatorEntries')[0].args[1].limit, 7);
      await app.click('#view [data-more-load]');
      assert.equal(shown(), 12);
      await app.click('#view [data-more-load]');
      assert.equal(shown(), 14);
      assert.ok(!app.exists('#view [data-more-load]'), 'nothing left to load');
      const ids = [...app.document.querySelectorAll('#view [data-more] [data-entry]')].map(card => card.dataset.entry);
      assert.equal(new Set(ids).size, ids.length, 'no post twice');
      assert.ok(!ids.includes(E.linenWardrobe));
    });

    it('keeps what is shown and says so when the next page fails', async () => {
      const api = guest();
      addPosts(api, IDS.solene, 10);
      await open(api, post(E.linenWardrobe));
      api.fail('creatorEntries', 'The list could not be extended.');
      await app.click('#view [data-more-load]');
      assert.equal(app.document.querySelectorAll('#view [data-more] [data-entry]').length, 6);
      assert.match(toastText(), /could not be extended/);
      const button = app.find('#view [data-more-load]');
      assert.equal(button.disabled, false, 'the button can be pressed again');
      api.fail('creatorEntries', null);
      await app.click(button);
      assert.equal(app.document.querySelectorAll('#view [data-more] [data-entry]').length, 12);
    });

    it('shows an error with a retry when the list cannot be read at all', async () => {
      const api = guest();
      api.fail('creatorEntries', 'The atelier could not be reached.');
      await open(api, post(E.linenWardrobe));
      const section = app.find('#view [data-more]');
      assert.equal(section.hidden, false);
      assert.match(section.textContent, /We could not load more from this atelier/);
      api.fail('creatorEntries', null);
      await app.click('#view [data-more-retry]');
      assert.equal(app.document.querySelectorAll('#view [data-more] [data-entry]').length, 4);
    });

    it('does not mix in drafts', async () => {
      const api = owner();
      await open(api, post(E.firstDraftHabits));
      assert.equal(app.find('#view [data-more]').hidden, true, 'the draft is not listed as published work');
    });
  });

  describe('hostile text', () => {
    it('is shown as text everywhere on the page', async () => {
      const api = member();
      api.db.creators.find(row => row.id === IDS.solene).name = HOSTILE;
      Object.assign(entryRow(api, E.linenWardrobe), { title: HOSTILE, subtitle: HOSTILE, category: HOSTILE, format: HOSTILE });
      api.db.entry_bodies.find(row => row.entry_id === E.linenWardrobe).body = `${HOSTILE}\n\n<script>alert(2)</script>`;
      api.db.profiles.find(row => row.id === IDS.fan1).display_name = HOSTILE;
      api.db.comments.find(row => row.id === IDS.comments.first).body = HOSTILE;
      entryRow(api, E.tailorsLedger).title = HOSTILE;
      await open(api, post(E.linenWardrobe));
      const view = app.find('#view');
      assert.equal(view.querySelectorAll('img[src="x"]').length, 0);
      assert.equal(view.querySelectorAll('[onerror]').length, 0);
      assert.equal(view.querySelectorAll('script').length, 0);
      assert.equal(text('h1'), HOSTILE);
      assert.equal(text('.post-subtitle'), HOSTILE);
      assert.match(text('.post-author-link'), /<img src=x onerror=alert\(1\)>/);
      assert.match(text('.post-body'), /<script>alert\(2\)<\/script>/);
      assert.match(app.text(`[data-comment="${IDS.comments.first}"]`), /<img src=x onerror=alert\(1\)>/);
      assert.ok(app.document.title.includes(HOSTILE));
      assert.match(app.text('#view [data-more]'), /<img src=x onerror=alert\(1\)>/);
    });

    it('is shown as text in a locked post and on the missing-post page', async () => {
      const api = guest();
      Object.assign(entryRow(api, E.patternArchive), { title: HOSTILE, excerpt: HOSTILE });
      api.db.creators.find(row => row.id === IDS.solene).name = HOSTILE;
      await open(api, post(E.patternArchive));
      assert.equal(app.find('#view').querySelectorAll('img[src="x"], [onerror]').length, 0);
      assert.equal(text('.post-excerpt'), HOSTILE);
      assert.match(text('.post-lock'), /<img src=x onerror=alert\(1\)>/);
    });

    it('keeps a hostile address from reaching the page', async () => {
      await open(guest(), '/app/p/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
      assert.equal(text('h1'), 'This post is not available');
      assert.equal(app.find('#view').querySelectorAll('img[src="x"], [onerror]').length, 0);
    });

    it('keeps links safe: no javascript addresses, no inline handlers or styles of its own', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      const markup = app.html('#view');
      assert.ok(!/javascript:/i.test(markup));
      assert.ok(!/\son[a-z]+=/i.test(markup));
      for (const node of app.document.querySelectorAll('#view [style]')) {
        assert.ok(node.classList.contains('avatar'), 'only the avatar of the core sets a style (its size)');
      }
    });
  });

  describe('moving between pages', () => {
    it('draws the next post cleanly and drops the conversation of the last one', async () => {
      await open(member(), post(E.linenWardrobe));
      assert.ok(exists('#comments'));
      await app.navigate(post(E.cuttingRoom));
      assert.ok(!exists('#comments'));
      assert.ok(exists('.post-lock'));
      await app.navigate(post(E.linenWardrobe));
      assert.equal(commentIds().length, 2);
    });

    it('leaves nothing listening after the page is left', async () => {
      const api = member();
      await open(api, post(E.linenWardrobe));
      await app.navigate('/app/discover');
      const before = callsTo(api, 'listComments').length;
      api.emit(IDS.member, 'notification', { id: '8c000000-0000-4000-8000-000000000003', user_id: IDS.member, type: 'comment', actor_id: IDS.fan2, creator_id: IDS.solene, entry_id: E.linenWardrobe, comment_id: IDS.comments.first, read_at: null, created_at: '2026-10-07T08:00:00+00:00' });
      await app.settle();
      assert.equal(callsTo(api, 'listComments').length, before);
    });
  });
});
