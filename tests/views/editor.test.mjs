// The post editor (/app/studio/new and /app/studio/edit/:id): the Text / Image / Video switch, files and their order, the cover of a text
// post, the preview, and the save flow of docs/POST_FORMATS.md (uploads two at a time, removals afterwards, retries, cancel, clean-up).
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, uninstallDom, mountApp, tick, confirmWith } from '../helpers/dom.mjs';
import { createFakeApi, IDS } from '../helpers/fake-api.mjs';
import * as realMedia from '../../src/media.js';
import { deps } from '../../src/views/editor/deps.js';
import { CATEGORIES } from '../../src/api/util.js';

const E = IDS.entries;
const HOSTILE = '<img src=x onerror=alert(1)>';
const LONG = 'A complete original reflection, long enough for the thirty character rule.';
const owner = () => createFakeApi({ signedIn: IDS.owner });
const member = () => createFakeApi();
const guest = () => createFakeApi({ signedIn: null });
const callsTo = (fake, ...methods) => fake.calls.filter(call => methods.includes(call.method));
const names = (fake, ...methods) => callsTo(fake, ...methods).map(call => call.method);
const row = (fake, id) => fake.db.entries.find(entry => entry.id === id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let counter = 0;
const uuid = (kind, n) => `${kind}c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// A post of Verne & Co with files. `files` are [name, kind?] pairs; each file gets a row, a poster and a position.
function addPost(fake, { id = uuid(3, ++counter), title = 'A post with files', kind = 'image', status = 'published', access = 'public', body = 'A short caption.', files = [], format } = {}) {
  const at = '2026-09-10T08:00:00+00:00';
  fake.db.entries.push({ ...row(fake, E.firstDraftHabits), id, title, kind, status, access, format: format ?? { text: 'Essay', image: 'Gallery', video: 'Film' }[kind], subtitle: 'An introduction.',
    excerpt: '', published_at: status === 'published' ? at : null, created_at: at, updated_at: at, cover_path: null });
  fake.db.entry_bodies.push({ entry_id: id, body });
  files.forEach(([name, fileKind = kind], position) => {
    const base = `${IDS.verne}/${id}/${name}`;
    fake.db.entry_media.push({ id: uuid(4, ++counter), entry_id: id, kind: fileKind, path: `${base}.${fileKind === 'video' ? 'mp4' : 'webp'}`, poster_path: `${base}-poster.webp`, preview_path: null,
      mime: fileKind === 'video' ? 'video/mp4' : 'image/webp', size_bytes: 1000, width: 1600, height: 1000, duration_seconds: fileKind === 'video' ? 40 : null, alt: `Alt of ${name}`, position,
      created_at: `2026-09-01T10:0${position}:00+00:00` });
  });
  fake.refresh();
  return id;
}
const mediaOf = (fake, id) => fake.db.entry_media.filter(item => item.entry_id === id).sort((a, b) => a.position - b.position);
const stills = (count, prefix = 's') => Array.from({ length: count }, (_, i) => [`${prefix}${i}`]);

const png = (name = 'shot.png', type = 'image/png') => new File(['pixels'], name, { type });
const jpg = name => png(name, 'image/jpeg');
const mp4 = (name = 'clip.mp4') => new File(['film'], name, { type: 'video/mp4' });

// Replaces fake[method] by a handler that gets the real method first. The fake's own call log sees the real call only.
const intercept = (fake, method, handler) => {
  const real = fake[method];
  fake[method] = (...args) => handler(real, ...args);
};
// An upload that does not finish until `release()` (or until the person cancels, when `onAbort` is set).
function gated(fake, method = 'uploadMedia') {
  const state = { flight: 0, peak: 0, started: [], release: null };
  const gate = new Promise(resolve => { state.release = resolve; });
  intercept(fake, method, async (real, ...args) => {
    state.flight++;
    state.peak = Math.max(state.peak, state.flight);
    state.started.push(args[2]?.name);
    try { await gate; return await real(...args); } finally { state.flight--; }
  });
  return state;
}

describe('post editor view', () => {
  before(() => installDom());
  after(() => uninstallDom());

  let app;
  let prepared;
  let original;
  afterEach(async () => {
    confirmWith(true);
    if (original) { deps.media = original; original = null; }
    await app?.destroy();
    app = null;
  });

  // Stand-ins for what needs a real browser (src/media.js decodes and re-encodes pictures). The pure helpers are the real ones.
  const useMedia = (extra = {}) => {
    prepared = [];
    original ??= deps.media;
    deps.media = {
      ...realMedia,
      async prepareImage(file) {
        prepared.push(file.name);
        if (file.name === 'unreadable.jpg') throw Error('This picture could not be read.');
        return { kind: 'image', blob: new Blob(['p'], { type: 'image/webp' }), mime: 'image/webp', ext: 'webp', size: 1, width: 640, height: 480, duration: null, poster: null, preview: new Blob(['p'], { type: 'image/webp' }), name: file.name };
      },
      async prepareVideo(file) {
        prepared.push(file.name);
        return { kind: 'video', blob: new Blob(['v'], { type: 'video/mp4' }), mime: 'video/mp4', ext: 'mp4', size: 1, width: 1280, height: 720, duration: 92, poster: new Blob(['p'], { type: 'image/webp' }), preview: new Blob(['p'], { type: 'image/webp' }), name: file.name };
      },
      ...extra
    };
  };

  const open = async (api, path = '/app/studio/new') => {
    if (!original) useMedia();
    app = await mountApp({ api, path });
    return app;
  };
  const toastText = () => (app.exists('#toast') ? app.text('#toast') : '');
  const fire = (node, type) => node.dispatchEvent(new app.window.Event(type, { bubbles: true, cancelable: true }));
  const type = async (selector, value) => {
    const node = app.find(selector);
    node.value = value;
    fire(node, 'input');
    await app.settle();
  };
  const choose = async (selector, value) => {
    const node = app.find(selector);
    node.value = value;
    fire(node, 'change');
    await app.settle();
  };
  const pick = async (files, selector = '#entry-files') => {
    const input = app.find(selector);
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    fire(input, 'change');
    await app.settle();
  };
  const drop = async (files, target = '#editor-media') => {
    const event = new app.window.Event('drop', { bubbles: true, cancelable: true });
    event.dataTransfer = { types: ['Files'], files };
    app.find(target).dispatchEvent(event);
    await app.settle();
    return event;
  };
  const press = intent => app.click(`button[name="intent"][value="${intent}"]`);
  const act = (action, id) => app.click(`[data-action="${action}"]${id === undefined ? '' : `[data-id="${id}"]`}`);
  const keys = () => [...app.find('#editor-media').querySelectorAll('[data-action="media-remove"]')].map(button => button.dataset.id);
  const fields = () => app.find('#editor-fields');
  const focused = () => app.document.activeElement;
  const fill = async ({ title, subtitle, body } = {}) => {
    if (title !== undefined) await type('#entry-title', title);
    if (subtitle !== undefined) await type('#entry-subtitle', subtitle);
    if (body !== undefined) await type('#entry-body', body);
  };

  // --- Who may open it ------------------------------------------------------------------

  describe('access', () => {
    it('sends a guest to sign in and brings them back to the editor afterwards', async () => {
      await open(guest(), '/app/studio/new?kind=video');
      assert.equal(app.path, '/app/login?next=%2Fapp%2Fstudio%2Fnew%3Fkind%3Dvideo');
    });

    it('sends a member without an atelier to the studio, where the atelier is opened', async () => {
      await open(member(), '/app/studio/edit/anything');
      assert.equal(app.path, '/app/studio');
      assert.equal(app.exists('#editor-form'), false);
    });
  });

  // --- The page --------------------------------------------------------------------------

  describe('the new post page', () => {
    it('draws a labelled form with landmarks, a Post type switch and a hidden, disabled default button', async () => {
      await open(owner());
      assert.match(app.document.title, /^New post — REFLUENZ$/);
      assert.match(app.text('h1'), /Start with a point of view/);
      const form = app.find('#editor-form');
      assert.equal(form.getAttribute('aria-label'), 'Post editor');
      assert.equal(form.querySelector('button[type="submit"]').hasAttribute('data-guard'), true, 'the first submit button is the guard');
      const guard = form.querySelector('[data-guard]');
      assert.equal(guard.disabled, true);
      assert.equal(guard.hidden, true);
      assert.equal(guard.getAttribute('tabindex'), '-1');
      assert.ok(app.exists('aside[aria-label="Post settings"]'));
      assert.ok(app.exists('[role="status"]#editor-status'));
      assert.ok(app.exists('[role="alert"]#entry-error'));
      const group = app.find('#editor-kind');
      assert.equal(group.getAttribute('role'), 'group');
      assert.equal(app.find(`#${group.getAttribute('aria-labelledby')}`).textContent, 'Post type');
      assert.deepEqual([...group.querySelectorAll('button')].map(button => [button.dataset.id, button.getAttribute('aria-pressed')]), [['text', 'true'], ['image', 'false'], ['video', 'false']]);
      assert.deepEqual([...app.find('.ed-actions').querySelectorAll('button')].map(button => button.textContent.trim()), ['Save draft', 'Publish']);
      assert.match(app.text('.ed-footer-note'), /Drafts are only visible in your studio/);
    });

    it('gives every control a label, and the alt text of each picture its own', async () => {
      await open(owner(), '/app/studio/new?kind=image');
      await pick([jpg('a.jpg'), jpg('b.jpg')]);
      const controls = [...app.find('#editor-form').querySelectorAll('input, select, textarea')].filter(control => control.type !== 'file' && control.type !== 'submit');
      assert.ok(controls.length >= 8);
      for (const control of controls) {
        assert.ok(control.id, 'every control has an id');
        const label = app.find('#editor-form').querySelector(`label[for="${control.id}"]`);
        assert.ok(label, `${control.id} has a label`);
        assert.notEqual(label.textContent.trim(), '');
      }
      assert.match(app.text('label[for^="alt-"]'), /Alt text for image 1/);
    });

    it('starts as a text post and as the kind named in the address, falling back to text', async () => {
      await open(owner());
      assert.equal(app.find('#editor-form').dataset.kind, 'text');
      assert.equal(app.find('#entry-format').value, 'Essay');
      assert.equal(app.exists('#editor-media .ed-media'), false);
      await app.navigate('/app/studio/new?kind=video');
      assert.equal(app.find('#editor-form').dataset.kind, 'video');
      assert.equal(app.find('#entry-format').value, 'Film');
      assert.equal(app.find('#entry-files').accept, 'video/*');
      assert.equal(app.find('#entry-files').multiple, false);
      await app.navigate('/app/studio/new?kind=image');
      assert.equal(app.find('#entry-format').value, 'Gallery');
      assert.equal(app.find('#entry-files').accept, 'image/*');
      assert.equal(app.find('#entry-files').multiple, true);
      await app.navigate('/app/studio/new?kind=poem');
      assert.equal(app.find('#editor-form').dataset.kind, 'text');
    });

    it('offers every category, the editorial formats of the kind, and Everyone plus the open tiers by their own names', async () => {
      const fake = owner();
      fake.db.creator_tiers.find(tier => tier.creator_id === IDS.verne && tier.tier_id === 'signature').enabled = false;
      await open(fake);
      assert.deepEqual([...app.find('#entry-category').options].map(option => option.value || option.text), CATEGORIES);
      assert.equal(app.find('#entry-category').value, 'Writing', 'the atelier’s own category is the default');
      assert.deepEqual([...app.find('#entry-format').options].map(option => option.text), ['Essay', 'Guide', 'Studio note', 'Field note', 'Collection']);
      assert.deepEqual([...app.find('#entry-access').options].map(option => [option.value, option.text]), [['public', 'Everyone'], ['essential', 'Reader and above'], ['premium', 'Supporter and above']]);
      assert.deepEqual([...app.find('#entry-image').options].map(option => option.value), ['atelier', 'ritual', 'architecture']);
      await act('kind', 'image');
      assert.deepEqual([...app.find('#entry-format').options].map(option => option.text), ['Essay', 'Guide', 'Studio note', 'Field note', 'Collection', 'Gallery', 'Film']);
    });

    it('keeps the tier of a post selectable even when that tier has been closed since', async () => {
      const fake = owner();
      fake.db.creator_tiers.find(tier => tier.creator_id === IDS.verne && tier.tier_id === 'premium').enabled = false;
      const id = addPost(fake, { kind: 'text', access: 'premium', body: LONG });
      await open(fake, `/app/studio/edit/${id}`);
      assert.equal(app.find('#entry-access').value, 'premium');
      assert.match(app.find('#entry-access').options[2].text, /Supporter and above \(closed to new members\)/);
    });

    it('says what each access level means', async () => {
      await open(owner());
      assert.match(app.text('#entry-access-help'), /Everyone can read this post, signed in or not/);
      await choose('#entry-access', 'premium');
      assert.match(app.text('#entry-access-help'), /Members of your Supporter circle and above can read this post/);
    });

    it('shows an error with Retry when the tiers cannot be loaded, and opens once they can', async () => {
      const fake = owner();
      fake.fail('listTiers', 'We could not reach REFLUENZ. Check your connection and try again.');
      await open(fake);
      assert.equal(app.exists('#editor-form'), false);
      assert.match(app.text('.error-state'), /could not reach REFLUENZ/);
      fake.fail('listTiers', null);
      await app.click('[data-retry]');
      assert.ok(app.exists('#editor-form'));
    });
  });

  // --- Editing ----------------------------------------------------------------------------

  describe('editing a post', () => {
    it('opens a draft with its words, category, format and access', async () => {
      await open(owner(), `/app/studio/edit/${E.unfinishedEssay}`);
      assert.match(app.document.title, /^Edit post — REFLUENZ$/);
      assert.match(app.text('.ed-eyebrow'), /Edit a draft/);
      assert.equal(app.find('#entry-title').value, 'An essay still unfinished');
      assert.equal(app.find('#entry-subtitle').value, 'Kept as a draft until it earns its ending.');
      assert.match(app.find('#entry-body').value, /A longer paragraph that stands in for the opening/);
      assert.equal(app.find('#entry-category').value, 'Writing');
      assert.equal(app.find('#entry-access').value, 'essential');
      assert.deepEqual([...app.find('.ed-actions').querySelectorAll('button')].map(button => button.textContent.trim()), ['Save draft', 'Publish']);
      assert.equal(app.find('.ed-back').getAttribute('href'), '/app/studio?tab=drafts');
    });

    it('opens a live post with the buttons of a live post', async () => {
      await open(owner(), `/app/studio/edit/${E.firstDraftHabits}`);
      assert.match(app.text('.ed-eyebrow'), /Edit a live post/);
      assert.deepEqual([...app.find('.ed-actions').querySelectorAll('button')].map(button => button.textContent.trim()), ['Move to drafts', 'Update post']);
      assert.match(app.text('.ed-footer-note'), /This post is live/);
      assert.equal(app.find('.ed-back').getAttribute('href'), '/app/studio?tab=published');
    });

    it('does not open the post of another atelier, or one that does not exist, and says so', async () => {
      await open(owner(), `/app/studio/edit/${E.linenWardrobe}`);
      assert.match(app.text('h1'), /This post is not here/);
      assert.equal(app.exists('#editor-form'), false);
      assert.equal(app.find('#view a[href="/app/studio"]').textContent.trim(), 'Back to your studio');
      await app.navigate('/app/studio/edit/3f000000-0000-4000-8000-000000000999');
      assert.match(app.text('h1'), /This post is not here/);
      assert.match(app.document.title, /Post not found/);
    });

    it('never puts the typed or stored words into markup: a hostile title, introduction, caption and alt text stay text', async () => {
      const fake = owner();
      const id = addPost(fake, { title: HOSTILE, kind: 'image', body: `${HOSTILE}\n\nSecond`, files: [['one']] });
      row(fake, id).subtitle = `"><script>alert(2)</script>`;
      fake.db.entry_media[fake.db.entry_media.length - 1].alt = HOSTILE;
      await open(fake, `/app/studio/edit/${id}`);
      assert.equal(app.find('#entry-title').value, HOSTILE);
      assert.equal(app.find('#entry-body').value, `${HOSTILE}\n\nSecond`);
      assert.equal(app.find('[data-alt]').value, HOSTILE);
      assert.equal(app.exists('#view img[onerror]'), false);
      assert.equal(app.exists('#view script'), false);
      await act('mode', 'preview');
      assert.equal(app.exists('#editor-preview img[onerror]'), false);
      assert.match(app.text('#editor-preview .ed-article-title'), /<img src=x onerror=alert\(1\)>/);
      assert.match(app.html('#editor-preview'), /&lt;img src=x onerror=alert\(1\)&gt;/);
      assert.equal(app.exists('#editor-preview script'), false);
    });

    it('updates a live post in place and opens it', async () => {
      const fake = owner();
      await open(fake, `/app/studio/edit/${E.firstDraftHabits}`);
      await type('#entry-title', '  First draft habits, revised  ');
      await press('published');
      const [call] = callsTo(fake, 'saveEntry');
      assert.equal(call.args[0], E.firstDraftHabits);
      assert.equal(call.args[2], 'published');
      assert.equal(call.args[1].title, 'First draft habits, revised', 'the title is saved trimmed');
      assert.equal(row(fake, E.firstDraftHabits).title, 'First draft habits, revised');
      assert.equal(app.path, `/app/p/${E.firstDraftHabits}`);
      assert.match(toastText(), /Post updated\./);
    });

    it('moves a live post to drafts and returns to the drafts', async () => {
      const fake = owner();
      await open(fake, `/app/studio/edit/${E.firstDraftHabits}`);
      await press('draft');
      assert.equal(row(fake, E.firstDraftHabits).status, 'draft');
      assert.equal(app.path, '/app/studio?tab=drafts');
      assert.match(toastText(), /Moved to your drafts\./);
    });

    it('publishes a draft', async () => {
      const fake = owner();
      await open(fake, `/app/studio/edit/${E.unfinishedEssay}`);
      await choose('#entry-access', 'public');
      await press('published');
      assert.equal(row(fake, E.unfinishedEssay).status, 'published');
      assert.equal(row(fake, E.unfinishedEssay).access, 'public');
      assert.equal(app.path, `/app/p/${E.unfinishedEssay}`);
      assert.match(toastText(), /Post published\./);
    });
  });

  // --- Text posts -------------------------------------------------------------------------

  describe('a text post', () => {
    it('saves a draft: validated, trimmed, then back to the drafts of the studio', async () => {
      const fake = owner();
      await open(fake);
      await fill({ title: '  A walk before breakfast  ', subtitle: ' Notes from the road ', body: `  ${LONG}  ` });
      await choose('#entry-category', 'Culture');
      await choose('#entry-format', 'Field note');
      await choose('#entry-access', 'essential');
      fake.calls.length = 0;
      await press('draft');
      assert.deepEqual(names(fake, 'saveEntry', 'uploadMedia', 'uploadEntryCover', 'setEntryCover'), ['saveEntry']);
      const [id, values, status] = callsTo(fake, 'saveEntry')[0].args;
      assert.equal(id, null);
      assert.equal(status, 'draft');
      assert.deepEqual(values, { kind: 'text', title: 'A walk before breakfast', subtitle: 'Notes from the road', body: LONG, category: 'Culture', format: 'Field note', image: 'atelier', access: 'essential' });
      assert.equal(app.path, '/app/studio?tab=drafts');
      assert.match(toastText(), /Draft saved in your studio\./);
      const saved = fake.db.entries.find(entry => entry.title === 'A walk before breakfast');
      assert.deepEqual([saved.status, saved.kind, saved.access], ['draft', 'text', 'essential']);
    });

    it('publishes and opens the post', async () => {
      const fake = owner();
      await open(fake);
      await fill({ title: 'A published thought', body: LONG });
      await press('published');
      const saved = fake.db.entries.find(entry => entry.title === 'A published thought');
      assert.equal(saved.status, 'published');
      assert.equal(app.path, `/app/p/${saved.id}`);
      assert.match(toastText(), /Post published\./);
      assert.match(app.text('h1'), /A published thought/);
    });

    it('checks the title, the introduction and the words before anything is sent, and puts the cursor on the first problem', async () => {
      const fake = owner();
      await open(fake);
      await press('published');
      assert.match(app.text('#err-title'), /between 3 and 100 characters/);
      assert.equal(app.find('#entry-title').getAttribute('aria-invalid'), 'true');
      assert.equal(focused(), app.find('#entry-title'));
      await fill({ title: 'Ok title' });
      assert.equal(app.text('#err-title'), '', 'the message goes when the field is edited');
      assert.equal(app.find('#entry-title').hasAttribute('aria-invalid'), false);
      await press('published');
      assert.match(app.text('#err-body'), /Write between 30 and 20,000 characters for your post/);
      assert.equal(focused(), app.find('#entry-body'));
      await fill({ body: 'Too short' });
      await press('draft');
      assert.match(app.text('#err-body'), /30 and 20,000/, 'a draft of a text post needs its words too');
      await fill({ body: 'x'.repeat(20001) });
      await press('draft');
      assert.match(app.text('#err-body'), /30 and 20,000/);
      await fill({ body: LONG, subtitle: 'y'.repeat(181) });
      await press('draft');
      assert.match(app.text('#err-subtitle'), /under 180 characters/);
      assert.equal(focused(), app.find('#entry-subtitle'));
      assert.equal(callsTo(fake, 'saveEntry').length, 0);
      assert.equal(app.find('#entry-body').value, LONG, 'nothing typed is lost');
    });

    it('counts the characters of the title, the introduction and the words', async () => {
      await open(owner());
      assert.equal(app.text('[data-count="entry-title"]'), '0 / 100');
      await type('#entry-title', 'Hello');
      assert.equal(app.text('[data-count="entry-title"]'), '5 / 100');
      await type('#entry-body', 'x'.repeat(1234));
      assert.equal(app.text('[data-count="entry-body"]'), '1,234 / 20,000');
      assert.equal(app.text('[data-count="entry-subtitle"]'), '0 / 180');
    });

    it('says why a save failed, keeps every word typed, unlocks the form and returns the focus to the button', async () => {
      const fake = owner();
      await open(fake);
      await fill({ title: 'A fragile post', body: LONG });
      fake.fail('saveEntry', 'The save was interrupted.');
      await press('published');
      assert.match(app.text('#entry-error'), /^The save was interrupted\. Press Save draft or Publish to try again\.$/);
      assert.match(toastText(), /Your post was not saved\. What you wrote is still here\./);
      assert.equal(app.find('#entry-title').value, 'A fragile post');
      assert.equal(app.find('#entry-body').value, LONG);
      assert.equal(fields().disabled, false);
      assert.equal(app.find('#editor-cancel').hidden, true);
      assert.equal(focused(), app.find('button[name="intent"][value="published"]'));
      assert.equal(app.find('button[name="intent"][value="published"]').hasAttribute('aria-busy'), false);
      assert.equal(app.path, '/app/studio/new');
      fake.fail('saveEntry', null);
      await press('published');
      assert.equal(fake.db.entries.filter(entry => entry.title === 'A fragile post').length, 1);
      assert.match(app.path, /^\/app\/p\//);
    });

    it('does not show a raw programming error to the creator', async () => {
      const fake = owner();
      await open(fake);
      await fill({ title: 'A bad moment', body: LONG });
      fake.fail('saveEntry', new TypeError('x is not a function'));
      await press('draft');
      assert.match(app.text('#entry-error'), /^Something went wrong\. Try again in a moment\./);
      assert.doesNotMatch(app.text('#entry-error'), /not a function/);
    });

    it('locks the form while it saves, offers Cancel, and ignores a second press', async () => {
      const fake = owner();
      await open(fake);
      await fill({ title: 'A slow save', body: LONG });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      intercept(fake, 'saveEntry', async (real, ...args) => { await gate; return real(...args); });
      const saving = press('published');
      await tick(5);
      assert.equal(fields().disabled, true);
      assert.equal(fields().getAttribute('aria-busy'), 'true');
      assert.equal(app.find('#editor-cancel').hidden, false);
      assert.equal(focused(), app.find('#editor-status'), 'focus moves to the status line, not to the button that went dark');
      assert.equal(app.find('button[name="intent"][value="published"]').getAttribute('aria-busy'), 'true');
      assert.match(app.text('#editor-status'), /Publishing…/);
      await press('published');   // a second press while saving does nothing
      release();
      await saving;
      await app.settle();
      assert.equal(fake.db.entries.filter(entry => entry.title === 'A slow save').length, 1);
    });

    it('ignores a submit that did not come from Save draft or Publish, and Enter in a single-line field', async () => {
      const fake = owner();
      await open(fake);
      await fill({ title: 'Never saved by Enter', body: LONG });
      const submit = new app.window.Event('submit', { bubbles: true, cancelable: true });
      app.find('#editor-form').dispatchEvent(submit);
      await app.settle();
      assert.equal(callsTo(fake, 'saveEntry').length, 0);
      assert.equal(submit.defaultPrevented, true, 'the browser does not navigate either');
      for (const selector of ['#entry-title', '#entry-subtitle']) {
        const enter = new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        app.find(selector).dispatchEvent(enter);
        assert.equal(enter.defaultPrevented, true, selector);
      }
      const inTextarea = new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      app.find('#entry-body').dispatchEvent(inTextarea);
      assert.equal(inTextarea.defaultPrevented, false, 'a text can still have line breaks');
    });

    it('also stops Enter in the alt text of a picture', async () => {
      await open(owner(), '/app/studio/new?kind=image');
      await pick([jpg('a.jpg')]);
      const enter = new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      app.find('[data-alt]').dispatchEvent(enter);
      assert.equal(enter.defaultPrevented, true);
    });
  });

  // --- The cover of a text post ---------------------------------------------------------------

  describe('the cover of a text post', () => {
    it('shows the editorial presets and follows the one that is chosen', async () => {
      await open(owner());
      assert.equal(app.find('#editor-cover-field').hidden, false);
      assert.equal(app.find('#editor-cover').getAttribute('src'), '/editorial/v1/atelier.jpg');
      await choose('#entry-image', 'ritual');
      assert.equal(app.find('#editor-cover').getAttribute('src'), '/editorial/v1/ritual.jpg');
      assert.equal(app.find('#editor-cover').getAttribute('alt'), 'Ritual cover study');
      assert.equal(app.find('#cover-remove').hidden, true);
      assert.match(app.text('#cover-pick'), /Upload your own cover/);
    });

    it('uploads a picture of its own: the cover goes up first, the post is saved, then the cover is attached', async () => {
      const fake = owner();
      await open(fake);
      await fill({ title: 'A post with a cover', body: LONG });
      await pick([png('cover.png')], '#entry-cover-file');
      assert.equal(app.find('#editor-cover').getAttribute('src'), 'blob:http://localhost/test');
      assert.equal(app.find('#editor-cover').getAttribute('alt'), 'Your cover picture');
      assert.match(app.text('#cover-pick'), /Replace your cover/);
      assert.equal(app.find('#cover-remove').hidden, false);
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'uploadEntryCover', 'saveEntry', 'setEntryCover'), ['uploadEntryCover', 'saveEntry', 'setEntryCover']);
      assert.deepEqual(prepared, ['cover.png']);
      const saved = fake.db.entries.find(entry => entry.title === 'A post with a cover');
      const [entryId, path] = callsTo(fake, 'setEntryCover')[0].args;
      assert.equal(entryId, saved.id);
      assert.equal(saved.cover_path, path);
      assert.match(path, new RegExp(`^${IDS.verne}/`));
      assert.equal(callsTo(fake, 'uploadEntryCover')[0].args[0], IDS.verne);
      assert.equal(app.path, `/app/p/${saved.id}`);
    });

    it('refuses what cannot be a cover, in words, next to the control', async () => {
      await open(owner());
      await pick([new File(['x'], 'anim.gif', { type: 'image/gif' })], '#entry-cover-file');
      assert.match(app.text('#cover-error'), /Use a JPG, PNG or WebP picture for the cover/);
      await pick([new File(['x'], 'notes.pdf', { type: 'application/pdf' })], '#entry-cover-file');
      assert.match(app.text('#cover-error'), /Use a JPG, PNG or WebP/);
      await pick([new File([], 'empty.png', { type: 'image/png' })], '#entry-cover-file');
      assert.match(app.text('#cover-error'), /That file is empty/);
      const huge = png('huge.png');
      Object.defineProperty(huge, 'size', { value: 30 * 1048576 });
      await pick([huge], '#entry-cover-file');
      assert.match(app.text('#cover-error'), /larger than 25 MB/);
      assert.equal(app.find('#cover-remove').hidden, true, 'no cover was taken');
      await pick([png('fine.png')], '#entry-cover-file');
      assert.equal(app.text('#cover-error'), '', 'a good picture clears the message');
    });

    it('takes a chosen cover back before saving, so nothing is uploaded', async () => {
      const fake = owner();
      await open(fake);
      await fill({ title: 'No cover after all', body: LONG });
      await pick([png('cover.png')], '#entry-cover-file');
      await act('cover-remove');
      assert.equal(app.find('#cover-remove').hidden, true);
      assert.equal(app.find('#editor-cover').getAttribute('src'), '/editorial/v1/atelier.jpg');
      assert.equal(focused(), app.find('#cover-pick'));
      await press('draft');
      assert.deepEqual(names(fake, 'uploadEntryCover', 'setEntryCover'), []);
    });

    it('replaces and removes the cover a post already has', async () => {
      const fake = owner();
      const path = `${IDS.verne}/${uuid(5, 1)}.webp`;
      fake.db.storage.covers.push(path);
      row(fake, E.firstDraftHabits).cover_path = path;
      await open(fake, `/app/studio/edit/${E.firstDraftHabits}`);
      assert.match(app.find('#editor-cover').getAttribute('src'), new RegExp(`/covers/${IDS.verne}/`));
      assert.match(app.text('#cover-pick'), /Replace your cover/);
      await act('cover-remove');
      assert.equal(app.find('#editor-cover').getAttribute('src'), '/editorial/v1/atelier.jpg');
      await press('published');
      assert.deepEqual(callsTo(fake, 'setEntryCover').map(call => call.args), [[E.firstDraftHabits, null]]);
      assert.equal(row(fake, E.firstDraftHabits).cover_path, null);
    });

    it('keeps the uploaded cover when the attaching fails, and a retry sends neither the cover nor the post again', async () => {
      const fake = owner();
      await open(fake);
      await fill({ title: 'A stubborn cover', body: LONG });
      await pick([png('cover.png')], '#entry-cover-file');
      fake.fail('setEntryCover', 'The cover could not be attached.');
      await press('published');
      assert.match(app.text('#entry-error'), /^The cover could not be attached\. Your draft is kept\. Press Save draft or Publish to continue\.$/);
      assert.equal(fake.db.entries.filter(entry => entry.title === 'A stubborn cover').length, 1);
      fake.fail('setEntryCover', null);
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'uploadEntryCover', 'saveEntry', 'setEntryCover'), ['setEntryCover'], 'only what is missing');
      const saved = fake.db.entries.find(entry => entry.title === 'A stubborn cover');
      assert.ok(saved.cover_path);
      assert.equal(app.path, `/app/p/${saved.id}`);
    });

    it('does not save the post when the cover cannot be uploaded, and keeps what was typed', async () => {
      const fake = owner();
      await open(fake);
      await fill({ title: 'No cover yet', body: LONG });
      await pick([png('cover.png')], '#entry-cover-file');
      fake.fail('uploadEntryCover', 'This image is too large (10 MB max).');
      await press('published');
      assert.match(app.text('#entry-error'), /^This image is too large \(10 MB max\)\./);
      assert.equal(callsTo(fake, 'saveEntry').length, 0);
      assert.equal(app.find('#entry-body').value, LONG);
      fake.fail('uploadEntryCover', null);
      await press('published');
      assert.equal(fake.db.entries.filter(entry => entry.title === 'No cover yet').length, 1);
    });

    it('turns a dropped picture on the cover study into the cover, and a picture elsewhere into an Image post', async () => {
      await open(owner());
      await drop([png('cover.png')], '#editor-cover-field');
      assert.equal(app.find('#editor-form').dataset.kind, 'text');
      assert.equal(app.find('#editor-cover').getAttribute('alt'), 'Your cover picture');
      await drop([png('shot.png')], '#entry-title');
      assert.equal(app.find('#editor-form').dataset.kind, 'image');
    });

    it('is hidden for image and video posts, which show their own picture, and a leftover cover is taken off when the post is no longer text', async () => {
      const fake = owner();
      const path = `${IDS.verne}/${uuid(5, 2)}.webp`;
      fake.db.storage.covers.push(path);
      const id = addPost(fake, { kind: 'text', body: LONG, files: [] });
      row(fake, id).cover_path = path;
      await open(fake, `/app/studio/edit/${id}`);
      await act('kind', 'image');
      assert.equal(app.find('#editor-cover-field').hidden, true);
      assert.equal(app.find('#editor-cover-note').hidden, false);
      assert.match(app.text('#editor-cover-note'), /Cards show your first image\. The editorial cover stays as the fallback card image\./);
      await pick([jpg('a.jpg')]);
      await press('published');
      assert.deepEqual(callsTo(fake, 'setEntryCover').map(call => call.args), [[id, null]]);
      assert.equal(row(fake, id).kind, 'image');
      assert.equal(row(fake, id).cover_path, null);
    });
  });

  // --- The post type -------------------------------------------------------------------------

  describe('the post type', () => {
    it('re-labels the page for each kind: caption, picker, formats, cover and notes', async () => {
      await open(owner());
      assert.equal(app.text('#entry-body-label'), 'Your post');
      await act('kind', 'image');
      assert.equal(app.find('#editor-form').dataset.kind, 'image');
      assert.equal(app.text('#entry-body-label'), 'Caption (optional)');
      assert.equal(app.find('#entry-body').placeholder, 'Say a little about this work, or leave it empty.');
      assert.equal(app.find('#entry-files').multiple, true);
      assert.equal(app.find('#entry-format').value, 'Gallery');
      assert.match(app.text('#editor-media'), /Add images/);
      assert.match(app.text('#editor-media'), /location and camera details are removed/);
      assert.equal(app.find('#editor-cover-field').hidden, true);
      assert.equal(app.find('button[data-id="image"]').getAttribute('aria-pressed'), 'true');
      assert.equal(app.find('button[data-id="text"]').getAttribute('aria-pressed'), 'false');
      assert.equal(app.find('button[data-id="image"]').classList.contains('is-active'), true);
      await act('kind', 'video');
      assert.equal(app.find('#entry-files').multiple, false);
      assert.equal(app.find('#entry-files').accept, 'video/*');
      assert.equal(app.find('#entry-format').value, 'Film');
      assert.match(app.text('#editor-media'), /Videos are uploaded as they are: location and device information stored in the file is not removed/);
      assert.match(app.text('#editor-cover-note'), /Cards show your video’s poster frame/);
      await act('kind', 'text');
      assert.equal(app.text('#entry-body-label'), 'Your post');
      assert.equal(app.find('#entry-format').value, 'Essay');
      assert.equal(app.find('#editor-cover-field').hidden, false);
      assert.equal(app.exists('#editor-media .ed-media'), false);
    });

    it('keeps a format that fits the new kind and the words typed so far', async () => {
      await open(owner());
      await choose('#entry-format', 'Guide');
      await type('#entry-body', 'Some words that stay.');
      await act('kind', 'image');
      assert.equal(app.find('#entry-format').value, 'Guide');
      assert.equal(app.find('#entry-body').value, 'Some words that stay.');
    });

    it('explains why the kind cannot change while files are attached, and lets go once they are removed', async () => {
      await open(owner(), '/app/studio/new?kind=image');
      await pick([jpg('a.jpg')]);
      const video = app.find('button[data-id="video"]');
      assert.equal(video.getAttribute('aria-disabled'), 'true');
      assert.equal(video.getAttribute('title'), 'Remove the images to change the post type');
      await act('kind', 'video');
      assert.match(app.text('#media-error'), /This post already has images\. Remove them before switching to Video\./);
      assert.equal(app.find('#editor-form').dataset.kind, 'image');
      assert.equal(app.find('button[data-id="image"]').getAttribute('aria-pressed'), 'true');
      await act('media-remove', keys()[0]);
      assert.equal(video.hasAttribute('aria-disabled'), false);
      assert.equal(app.text('#media-error'), '');
      await act('kind', 'video');
      assert.equal(app.find('#editor-form').dataset.kind, 'video');
    });

    it('turns a dropped picture or film on a text post into a post of that kind, and refuses other files in words', async () => {
      await open(owner());
      await drop([png('shot.png')]);
      assert.equal(app.find('#editor-form').dataset.kind, 'image');
      assert.match(app.text('#editor-media'), /shot\.png/);
      await app.navigate('/app/studio/new');
      await drop([mp4('film.mp4')]);
      assert.equal(app.find('#editor-form').dataset.kind, 'video');
      assert.ok(app.exists('video.ed-video'));
      await app.navigate('/app/studio/new');
      await drop([new File(['x'], 'notes.pdf', { type: 'application/pdf' })]);
      assert.equal(app.find('#editor-form').dataset.kind, 'text');
      assert.match(app.text('#entry-error'), /Choose Image or Video to attach files\./);
    });

    it('claims every file drag, so the browser never opens the file instead', async () => {
      await open(owner(), '/app/studio/new?kind=image');
      const over = new app.window.Event('dragover', { bubbles: true, cancelable: true });
      over.dataTransfer = { types: ['Files'] };
      app.find('.ed-dropzone').dispatchEvent(over);
      assert.equal(over.defaultPrevented, true);
      assert.equal(over.dataTransfer.dropEffect, 'copy');
      assert.equal(app.find('.ed-dropzone').classList.contains('is-over'), true);
      const text = new app.window.Event('dragover', { bubbles: true, cancelable: true });
      text.dataTransfer = { types: ['text/plain'] };
      app.find('.ed-dropzone').dispatchEvent(text);
      assert.equal(text.defaultPrevented, false);
      const leave = new app.window.Event('dragleave', { bubbles: true });
      app.find('.ed-dropzone').dispatchEvent(leave);
      assert.equal(app.find('.ed-dropzone').classList.contains('is-over'), false);
    });
  });

  // --- Images --------------------------------------------------------------------------------

  describe('image posts', () => {
    it('lists the chosen pictures with their position, count, alt text, file name and controls', async () => {
      await open(owner(), '/app/studio/new?kind=image');
      await pick([jpg('first.jpg'), png('second.png')]);
      assert.match(app.text('#media-label'), /Images 2 of 10/);
      const items = [...app.find('#editor-media').querySelectorAll('.ed-item')];
      assert.equal(items.length, 2);
      assert.match(items[0].querySelector('.ed-name').textContent, /first\.jpg/);
      assert.equal(items[0].querySelector('.ed-index').textContent, '1');
      assert.equal(items[0].querySelector('[data-alt]').maxLength, 200);
      assert.equal(items[0].querySelector('[data-action="media-earlier"]').disabled, true);
      assert.equal(items[1].querySelector('[data-action="media-later"]').disabled, true);
      assert.equal(items[0].querySelector('[data-action="media-later"]').getAttribute('aria-label'), 'Move image 1 later');
      assert.equal(items[1].querySelector('[data-action="media-remove"]').getAttribute('aria-label'), 'Remove image 2');
      assert.equal(app.text('#editor-status'), '2 files added. 2 of 10.');
    });

    it('moves pictures earlier and later, and removes them, and says so', async () => {
      await open(owner(), '/app/studio/new?kind=image');
      await pick([jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')]);
      const [a, b, c] = keys();
      await act('media-later', a);
      assert.deepEqual(keys(), [b, a, c]);
      assert.equal(app.text('#editor-status'), 'Moved to position 2 of 3.');
      await act('media-earlier', c);
      assert.deepEqual(keys(), [b, c, a]);
      await act('media-remove', c);
      assert.deepEqual(keys(), [b, a]);
      assert.equal(app.text('#editor-status'), 'Removed c.jpg. 2 files left.');
      assert.match(app.text('#media-label'), /Images 2 of 10/);
    });

    it('keeps what was typed in the alt text while the section is redrawn, and the keyboard focus on the control that was used', async () => {
      await open(owner(), '/app/studio/new?kind=image');
      await pick([jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg'), jpg('d.jpg')]);
      const [a, b] = keys();
      await type(`[data-alt="${a}"]`, 'A bright room');
      app.find(`[data-action="media-later"][data-id="${a}"]`).focus();
      await act('media-later', a);
      assert.equal(app.find(`[data-alt="${a}"]`).value, 'A bright room', 'the alt text travels with its picture');
      assert.equal(focused().dataset.id, a, 'the focus stays on the picture that moved');
      app.find(`[data-action="media-remove"][data-id="${b}"]`).focus();
      await act('media-remove', b);
      assert.equal(focused().dataset.action, 'media-remove', 'the focus moves to a remove button, not to the top of the page');
      assert.notEqual(focused(), app.document.body);
    });

    it('moves the focus to the media heading when the last picture is removed and the drop zone is back', async () => {
      await open(owner(), '/app/studio/new?kind=image');
      await pick([jpg('a.jpg')]);
      app.find('[data-action="media-remove"]').focus();
      await act('media-remove', keys()[0]);
      assert.ok(focused().classList.contains('ed-dropzone') || focused().classList.contains('ed-media-head'));
    });

    it('checks the files as they are chosen, in words, next to the controls', async () => {
      await open(owner(), '/app/studio/new?kind=image');
      await pick([mp4('clip.mp4')]);
      assert.match(app.text('#media-error'), /"clip\.mp4" is a video, but this is an image post/);
      assert.equal(app.exists('.ed-item'), false);
      await pick([new File(['x'], 'doc.txt', { type: 'text/plain' })]);
      assert.match(app.text('#media-error'), /not a supported image/);
      await pick([new File([], 'empty.png', { type: 'image/png' })]);
      assert.match(app.text('#media-error'), /is empty/);
      await pick(Array.from({ length: 11 }, (_, i) => jpg(`p${i}.jpg`)));
      assert.match(app.text('#media-error'), /Too many images: you chose 11, but a post holds up to 10/);
      assert.equal(app.exists('.ed-item'), false);
      await pick([jpg('ok.jpg')]);
      assert.equal(app.text('#media-error'), '');
      assert.equal(app.find('#media-error').getAttribute('role'), 'alert');
    });

    it('takes up to ten pictures, then takes the drop zone away', async () => {
      await open(owner(), '/app/studio/new?kind=image');
      await pick(Array.from({ length: 8 }, (_, i) => jpg(`p${i}.jpg`)));
      assert.ok(app.exists('.ed-dropzone'));
      await pick([jpg('x.jpg'), jpg('y.jpg'), jpg('z.jpg')]);
      assert.match(app.text('#media-error'), /already has 8 images, so you can add 2 more/);
      await pick([jpg('x.jpg'), jpg('y.jpg')]);
      assert.match(app.text('#media-label'), /Images 10 of 10/);
      assert.equal(app.exists('.ed-dropzone'), false, 'at the cap, nothing more can be added');
    });

    it('makes a small copy of each new picture for the grid, one at a time, never decoding the file itself on screen', async () => {
      const made = [];
      useMedia({ async thumbnail(file) { made.push(file.name); return file.name === 'bad.png' ? null : new Blob(['t']); } });
      await open(owner(), '/app/studio/new?kind=image');
      await pick([jpg('a.jpg'), png('bad.png')]);
      assert.equal(app.exists('#editor-media .ed-pic img'), false, 'until the copy exists the grid shows a placeholder');
      await sleep(10);
      const pictures = [...app.find('#editor-media').querySelectorAll('.ed-pic img')];
      assert.equal(pictures.length, 2, 'a picture that cannot be shrunk falls back to the file itself');
      assert.deepEqual(made, ['a.jpg', 'bad.png']);
      await pick([jpg('c.jpg'), jpg('d.jpg')]);
      const dropped = keys().at(-2);
      await act('media-remove', dropped);
      await sleep(10);
      assert.ok(!made.includes('c.jpg'), 'a picture removed before its turn is never decoded');
      assert.ok(made.includes('d.jpg'));
    });

    it('needs an image to publish but not to save a draft', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=image');
      await fill({ title: 'Not yet' });
      await press('published');
      assert.match(app.text('#media-error'), /Add at least one image before publishing\./);
      assert.equal(callsTo(fake, 'saveEntry').length, 0);
      await press('draft');
      assert.deepEqual(callsTo(fake, 'saveEntry').map(call => [call.args[0], call.args[2], call.args[1].kind]), [[null, 'draft', 'image']]);
      assert.equal(app.path, '/app/studio?tab=drafts');
    });

    it('publishes: a draft first, then the pictures in the order of the grid with their alt text, then the final save', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=image');
      await fill({ title: 'Two rooms' });
      await pick([jpg('first.jpg'), png('second.png')]);
      const [first] = keys();
      await type(`[data-alt="${first}"]`, 'A bright room');
      await act('media-later', first);
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'saveEntry', 'uploadMedia', 'updateMedia', 'removeMedia'), ['saveEntry', 'uploadMedia', 'uploadMedia', 'saveEntry']);
      const [draft, one, two, final] = fake.calls.filter(call => ['saveEntry', 'uploadMedia'].includes(call.method));
      assert.deepEqual([draft.args[0], draft.args[2], draft.args[1].kind, draft.args[1].format], [null, 'draft', 'image', 'Gallery']);
      assert.deepEqual([one.args[2].name, one.args[3].position, one.args[3].alt], ['second.png', 0, '']);
      assert.deepEqual([two.args[2].name, two.args[3].position, two.args[3].alt], ['first.jpg', 1, 'A bright room']);
      assert.equal(one.args[1], IDS.verne);
      assert.equal(one.args[0], two.args[0]);
      assert.deepEqual([final.args[0], final.args[2]], [one.args[0], 'published']);
      const saved = row(fake, one.args[0]);
      assert.deepEqual([saved.status, saved.kind, saved.media_count], ['published', 'image', 2]);
      assert.deepEqual(mediaOf(fake, saved.id).map(item => item.alt), ['', 'A bright room']);
      assert.equal(app.path, `/app/p/${saved.id}`);
      assert.match(toastText(), /Post published\./);
    });

    it('uploads two files at a time, each with its own bar, and removes nothing before every upload is stored', async () => {
      const fake = owner();
      const id = addPost(fake, { files: [['old1'], ['old2']] });
      await open(fake, `/app/studio/edit/${id}`);
      for (const key of keys()) await act('media-remove', key);
      await pick(['a', 'b', 'c', 'd', 'e'].map(name => jpg(`${name}.jpg`)));
      const upload = gated(fake);
      fake.calls.length = 0;
      const saving = press('published');
      await tick(10);
      assert.equal(upload.flight, 2, 'the third file waits for a free slot');
      assert.deepEqual(upload.started, ['a.jpg', 'b.jpg']);
      const bars = [...app.find('#editor-media').querySelectorAll('progress')];
      assert.equal(bars.length, 5, 'every queued file already shows its bar');
      assert.match(bars[0].getAttribute('aria-label'), /Upload progress, a\.jpg/);
      upload.release();
      await saving;
      await app.settle();
      assert.equal(upload.peak, 2, 'never more than two at once');
      const sent = callsTo(fake, 'uploadMedia').map(call => [call.args[2].name, call.args[3].position]).sort(([x], [y]) => x.localeCompare(y));
      assert.deepEqual(sent, [['a.jpg', 0], ['b.jpg', 1], ['c.jpg', 2], ['d.jpg', 3], ['e.jpg', 4]], 'each file keeps the position it has in the list');
      const order = names(fake, 'saveEntry', 'uploadMedia', 'updateMedia', 'removeMedia');
      assert.ok(order.lastIndexOf('uploadMedia') < order.indexOf('removeMedia'), 'the old files go only after the last upload');
      assert.equal(callsTo(fake, 'removeMedia').length, 1, 'one request for both');
      assert.equal(order.at(-1), 'saveEntry');
      assert.equal(mediaOf(fake, id).length, 5);
      assert.equal(row(fake, id).status, 'published');
    });

    it('paints the progress of each file as it is reported', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=image');
      await fill({ title: 'Progress' });
      await pick([jpg('a.jpg')]);
      let seen = null;
      let release;
      const wait = new Promise(resolve => { release = resolve; });
      intercept(fake, 'uploadMedia', async (real, entryId, creatorId, preparedFile, options) => {
        options.onProgress(0.4);
        seen = app.find('#editor-media progress').value;
        await wait;
        return real(entryId, creatorId, preparedFile, options);
      });
      const saving = press('published');
      await tick(10);
      assert.equal(seen, 40);
      release();
      await saving;
    });

    it('when a file fails the one still running finishes, nothing new starts, and the next save sends only what is missing', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=image');
      await fill({ title: 'Four with a failure' });
      await pick(['a', 'b', 'c', 'd'].map(name => jpg(`${name}.jpg`)));
      const sent = [];
      let slow = true;
      let release;
      const late = new Promise(resolve => { release = resolve; });
      intercept(fake, 'uploadMedia', async (real, entryId, creatorId, file, options) => {
        sent.push(file.name);
        if (file.name === 'a.jpg' && slow) await late;
        if (file.name === 'b.jpg' && slow) throw Error('The upload was interrupted.');
        return real(entryId, creatorId, file, options);
      });
      const saving = press('published');
      await tick(10);
      assert.deepEqual(sent, ['a.jpg', 'b.jpg'], 'the free slot is not used for the next file once one has failed');
      release();
      await saving;
      await app.settle();
      assert.deepEqual(sent, ['a.jpg', 'b.jpg']);
      const draft = fake.db.entries.find(entry => entry.title === 'Four with a failure');
      assert.equal(draft.status, 'draft');
      assert.equal(mediaOf(fake, draft.id).length, 1, 'the file that was already on its way was not thrown away');
      assert.equal(app.text('#entry-error'), 'b.jpg: The upload was interrupted. Your draft and 1 uploaded file are kept. Press Save draft or Publish to continue.');
      const [a, b, c, d] = [...app.find('#editor-media').querySelectorAll('.ed-item')];
      assert.equal(a.classList.contains('is-failed'), false);
      assert.match(b.textContent, /Not uploaded: The upload was interrupted\. It will be sent again when you save\./);
      assert.equal(b.classList.contains('is-failed'), true);
      assert.doesNotMatch(c.textContent + d.textContent, /Not uploaded/, 'files that never started are not blamed');
      slow = false;
      sent.length = 0;
      await press('published');
      assert.deepEqual(sent, ['b.jpg', 'c.jpg', 'd.jpg']);
      assert.equal(row(fake, draft.id).status, 'published');
      assert.equal(mediaOf(fake, draft.id).length, 4);
      assert.equal(fake.db.entries.filter(entry => entry.title === 'Four with a failure').length, 1, 'still one post');
    });

    it('names each file that fails and counts the others in the summary; a picture that cannot be read is told so', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=image');
      await fill({ title: 'Two with a problem each' });
      await pick([jpg('unreadable.jpg'), jpg('b.jpg'), jpg('c.jpg')]);
      intercept(fake, 'uploadMedia', (real, entryId, creatorId, file, options) => (file.name === 'b.jpg' ? Promise.reject(Error('The upload was interrupted.')) : real(entryId, creatorId, file, options)));
      await press('published');
      assert.equal(app.text('#entry-error'), 'unreadable.jpg: This picture could not be read. 1 other file also failed. Your draft is kept. Press Save draft or Publish to continue.');
      const [first, second, third] = [...app.find('#editor-media').querySelectorAll('.ed-item')];
      assert.match(first.querySelector('.ed-upload-status').textContent, /Not uploaded: This picture could not be read\. It will be sent again when you save\./);
      assert.match(second.querySelector('.ed-upload-status').textContent, /Not uploaded: The upload was interrupted\./);
      assert.equal(third.querySelector('.ed-upload-status'), null);
      assert.deepEqual(prepared, ['unreadable.jpg', 'b.jpg'], 'the third file never started');
      await act('media-remove', keys()[0]);
      fake.fail('uploadMedia', null);
      intercept(fake, 'uploadMedia', (real, ...args) => real(...args));
      await press('published');
      assert.equal(fake.db.entries.find(entry => entry.title === 'Two with a problem each').status, 'published');
    });

    it('keeps the draft when an upload fails, so a retry does not create a second post', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=image');
      await fill({ title: 'One draft only' });
      await pick([jpg('a.jpg')]);
      fake.fail('uploadMedia', 'The upload was interrupted.');
      await press('published');
      assert.match(app.text('#entry-error'), /^a\.jpg: The upload was interrupted\. Your draft is kept\. Press Save draft or Publish to continue\.$/);
      assert.equal(fake.db.entries.filter(entry => entry.title === 'One draft only').length, 1);
      assert.equal(app.path, '/app/studio/new?kind=image');
      fake.fail('uploadMedia', null);
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(callsTo(fake, 'saveEntry').map(call => call.args[0] === null), [false], 'the retry saves the same post');
      assert.equal(fake.db.entries.filter(entry => entry.title === 'One draft only').length, 1);
    });

    it('can be cancelled while a file uploads: the form unlocks, what was stored is kept and Save continues', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=image');
      await fill({ title: 'Cancel me' });
      await pick([jpg('a.jpg'), jpg('b.jpg')]);
      let hold = true;
      intercept(fake, 'uploadMedia', (real, entryId, creatorId, file, options) => (hold && file.name === 'b.jpg'
        ? new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(Error('Upload cancelled.')), { once: true }); })
        : real(entryId, creatorId, file, options)));
      const saving = press('published');
      await tick(10);
      assert.equal(fields().disabled, true);
      assert.equal(app.find('#editor-cancel').hidden, false);
      assert.equal(focused(), app.find('#editor-status'));
      await act('cancel-upload');
      await saving;
      await app.settle();
      const draft = fake.db.entries.find(entry => entry.title === 'Cancel me');
      assert.equal(fields().disabled, false);
      assert.equal(app.find('#editor-cancel').hidden, true);
      assert.equal(app.text('#entry-error'), 'Upload cancelled. Your draft and 1 uploaded file are kept. Press Save draft or Publish to continue.');
      assert.equal(app.exists('#toast .toast--error'), false, 'cancelling is not a failure');
      const failed = app.find('#editor-media').querySelectorAll('.ed-item.is-failed');
      assert.equal(failed.length, 1);
      assert.match(failed[0].textContent, /Not uploaded\. It will be sent again when you save\./);
      assert.deepEqual([draft.status, mediaOf(fake, draft.id).length], ['draft', 1]);
      assert.equal(names(fake, 'saveEntry').length, 1, 'the final save never ran');
      hold = false;
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(callsTo(fake, 'uploadMedia').map(call => call.args[2].name), ['b.jpg']);
      assert.equal(row(fake, draft.id).status, 'published');
      assert.equal(mediaOf(fake, draft.id).length, 2);
    });

    it('makes room for the new pictures when a retry would run into the transient cap, and the originals always wait', async () => {
      const fake = owner();
      const id = addPost(fake, { files: stills(10, 'o') });
      await open(fake, `/app/studio/edit/${id}`);
      for (const key of keys()) await act('media-remove', key);
      await pick(Array.from({ length: 10 }, (_, i) => jpg(`n${i}.jpg`)));
      fake.fail('removeMedia', 'The removal was interrupted.');
      await press('published');
      assert.match(app.text('#entry-error'), /^The removal was interrupted\./);
      assert.equal(mediaOf(fake, id).length, 20, 'ten originals and ten new ones: the most the database allows');
      assert.equal(row(fake, id).status, 'published');
      fake.fail('removeMedia', null);
      // Two of the new ones are dropped and one other is added: twenty are stored, so exactly one leftover goes before the upload.
      await act('media-remove', keys()[0]);
      await act('media-remove', keys()[0]);
      await pick([jpg('p1.jpg')]);
      fake.calls.length = 0;
      await press('published');
      const order = names(fake, 'removeMedia', 'prepare', 'uploadMedia', 'saveEntry');
      assert.deepEqual(order.slice(0, 2), ['removeMedia', 'uploadMedia']);
      const removals = callsTo(fake, 'removeMedia').map(call => call.args[0]);
      assert.equal(removals[0].length, 1, 'only one file goes early');
      assert.equal(removals[0][0].path.includes('/o'), false, 'and it is one this session stored, not an original');
      assert.equal(removals.length, 2);
      assert.equal(removals[1].length, 11, 'the ten originals and the other leftover leave afterwards, in one request');
      assert.equal(removals[1].filter(item => /\/o\d/.test(item.path)).length, 10);
      assert.equal(mediaOf(fake, id).length, 9);
      assert.deepEqual(mediaOf(fake, id).map(item => item.position), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
      assert.equal(row(fake, id).status, 'published');
    });

    it('stores the new pictures before it removes the old ones at the cap of ten, and renumbers them', async () => {
      const fake = owner();
      const id = addPost(fake, { files: stills(10) });
      await open(fake, `/app/studio/edit/${id}`);
      assert.match(app.text('#media-label'), /Images 10 of 10/);
      assert.equal(app.exists('.ed-dropzone'), false);
      for (const key of keys().slice(0, 3)) await act('media-remove', key);
      assert.match(app.text('#media-label'), /Images 7 of 10/);
      await pick([png('n1.png'), png('n2.png'), png('n3.png')]);
      fake.calls.length = 0;
      await press('published');
      const order = names(fake, 'uploadMedia', 'updateMedia', 'removeMedia', 'saveEntry');
      assert.equal(order.filter(name => name === 'uploadMedia').length, 3);
      assert.ok(order.lastIndexOf('uploadMedia') < order.indexOf('removeMedia'));
      assert.equal(order.at(-1), 'saveEntry');
      assert.equal(callsTo(fake, 'removeMedia')[0].args[0].length, 3, 'the three old files leave in a single request');
      assert.equal(mediaOf(fake, id).length, 10);
      assert.deepEqual(mediaOf(fake, id).map(item => item.position), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      assert.equal(row(fake, id).status, 'published');
    });
  });

  // --- Videos ---------------------------------------------------------------------------------

  describe('video posts', () => {
    it('takes one film, shows it in an inline player without autoplay, and takes the drop zone away', async () => {
      await open(owner(), '/app/studio/new?kind=video');
      assert.match(app.text('#media-label'), /^Video$/);
      await pick([mp4('clip.mp4')]);
      const video = app.find('video.ed-video');
      assert.equal(video.hasAttribute('controls'), true);
      assert.equal(video.hasAttribute('playsinline'), true);
      assert.equal(video.hasAttribute('autoplay'), false);
      assert.equal(video.getAttribute('preload'), 'metadata');
      assert.equal(video.getAttribute('src'), 'blob:http://localhost/test');
      assert.equal(video.getAttribute('aria-label'), 'Selected video preview');
      assert.equal(app.exists('.ed-dropzone'), false, 'one video fills the slot');
      assert.match(app.text('.ed-video-field .ed-name'), /clip\.mp4 · \d+ KB/);
      await pick([mp4('second.mp4')]);
      assert.match(app.text('#media-error'), /Choose a single video|already has a video/);
    });

    it('refuses more than one film at once, images, and a film that is too big', async () => {
      await open(owner(), '/app/studio/new?kind=video');
      await pick([mp4('a.mp4'), mp4('b.mp4')]);
      assert.match(app.text('#media-error'), /Choose a single video: a post holds exactly one/);
      await pick([png('shot.png')]);
      assert.match(app.text('#media-error'), /is an image, but this is a video post/);
      const big = mp4('big.mp4');
      Object.defineProperty(big, 'size', { value: 60 * 1048576 });
      await pick([big]);
      assert.match(app.text('#media-error'), /Videos can be up to 50 MB/);
      assert.equal(app.exists('video.ed-video'), false);
    });

    it('removes the film, and brings the drop zone back', async () => {
      await open(owner(), '/app/studio/new?kind=video');
      await pick([mp4()]);
      await act('media-remove', keys()[0]);
      assert.equal(app.exists('video.ed-video'), false);
      assert.ok(app.exists('.ed-dropzone'));
      assert.equal(app.text('#editor-status'), 'Removed clip.mp4. 0 files left.');
    });

    it('publishes the film: a draft, the poster and film uploaded, then the final save with its length', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=video');
      await fill({ title: 'A short film' });
      await pick([mp4('film.mp4')]);
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'saveEntry', 'uploadMedia', 'removeMedia'), ['saveEntry', 'uploadMedia', 'saveEntry']);
      assert.deepEqual(prepared, ['film.mp4']);
      const saved = fake.db.entries.find(entry => entry.title === 'A short film');
      assert.deepEqual([saved.status, saved.kind, saved.format, saved.duration_seconds], ['published', 'video', 'Film', 92]);
      assert.equal(mediaOf(fake, saved.id).length, 1);
    });

    it('marks a film that failed, keeps the draft and says what to press', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=video');
      await fill({ title: 'A clip that fails' });
      await pick([mp4('clip.mp4')]);
      fake.fail('uploadMedia', 'The upload was interrupted.');
      await press('published');
      assert.equal(app.text('#entry-error'), 'clip.mp4: The upload was interrupted. Your draft is kept. Press Save draft or Publish to continue.');
      assert.ok(app.exists('.ed-video-field.is-failed'));
      assert.match(app.text('.ed-video-field'), /Not uploaded: The upload was interrupted\. It will be sent again when you save\./);
      assert.equal(fake.db.entries.filter(entry => entry.title === 'A clip that fails').length, 1);
    });

    it('needs a film to publish', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=video');
      await fill({ title: 'No film yet' });
      await press('published');
      assert.match(app.text('#media-error'), /Add a video before publishing\./);
      assert.equal(callsTo(fake, 'saveEntry').length, 0);
    });

    it('shows the film of an existing post in the player, with its poster, and replaces it by uploading first and removing afterwards', async () => {
      const fake = owner();
      const id = addPost(fake, { kind: 'video', files: [['old']] });
      await open(fake, `/app/studio/edit/${id}`);
      const video = app.find('video.ed-video');
      assert.match(video.getAttribute('src'), /fake\.supabase\.test.*old\.mp4/);
      assert.match(video.getAttribute('poster'), /old-poster\.webp/);
      assert.match(app.text('.ed-video-field .ed-name'), /old\.mp4 · 0:40/);
      await act('media-remove', keys()[0]);
      assert.ok(app.exists('.ed-dropzone'));
      await pick([mp4('new.mp4')]);
      fake.fail('uploadMedia', 'The upload was interrupted.');
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'uploadMedia', 'removeMedia', 'saveEntry'), ['uploadMedia'], 'nothing was removed: the live post still has its film');
      assert.equal(mediaOf(fake, id).length, 1);
      assert.equal(row(fake, id).status, 'published');
      fake.fail('uploadMedia', null);
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'uploadMedia', 'removeMedia', 'saveEntry'), ['uploadMedia', 'removeMedia', 'saveEntry']);
      assert.equal(callsTo(fake, 'removeMedia')[0].args[0].length, 1);
      assert.equal(mediaOf(fake, id).length, 1);
      assert.match(mediaOf(fake, id)[0].path, /\.mp4$/);
      assert.notEqual(mediaOf(fake, id)[0].path, `${IDS.verne}/${id}/old.mp4`);
      assert.equal(row(fake, id).status, 'published', 'the post was never without a film');
    });

    it('keeps a lone file from a failed save, so a live post is not emptied, and uses the headroom for the next one', async () => {
      const fake = owner();
      const id = addPost(fake, { kind: 'video', files: [['one']] });
      await open(fake, `/app/studio/edit/${id}`);
      await act('media-remove', keys()[0]);
      await pick([mp4('two.mp4')]);
      fake.fail('saveEntry', 'The save was interrupted.');
      await press('published');
      assert.match(app.text('#entry-error'), /^The save was interrupted\./);
      assert.deepEqual(mediaOf(fake, id).map(item => item.path.endsWith('.mp4')), [true], 'the old film is gone, the new one is stored');
      assert.equal(row(fake, id).status, 'published');
      await act('media-remove', keys()[0]);
      await pick([mp4('three.mp4')]);
      fake.fail('saveEntry', null);
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'removeMedia', 'uploadMedia', 'saveEntry'), ['uploadMedia', 'removeMedia', 'saveEntry'], 'the second film leaves only once the third is stored');
      assert.equal(mediaOf(fake, id).length, 1);
      assert.equal(row(fake, id).status, 'published');
    });

    it('clears a file this session stored and the creator then discarded before the next upload needs the room', async () => {
      const fake = owner();
      const id = addPost(fake, { kind: 'video', files: [['first']] });
      await open(fake, `/app/studio/edit/${id}`);
      await act('media-remove', keys()[0]);
      await pick([mp4('second.mp4')]);
      fake.fail('removeMedia', 'The removal was interrupted.');
      await press('published');
      assert.equal(mediaOf(fake, id).length, 2, 'the entry now holds both films (the most the database allows)');
      fake.fail('removeMedia', null);
      await act('media-remove', keys()[0]);
      await pick([mp4('third.mp4')]);
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'removeMedia', 'uploadMedia', 'saveEntry'), ['removeMedia', 'uploadMedia', 'removeMedia', 'saveEntry']);
      const [early, late] = callsTo(fake, 'removeMedia').map(call => call.args[0]);
      assert.equal(early.length, 1);
      assert.equal(early[0].path.endsWith('first.mp4'), false, 'the leftover goes first, the original waits');
      assert.equal(late[0].path.endsWith('first.mp4'), true);
      assert.equal(mediaOf(fake, id).length, 1);
      assert.equal(row(fake, id).status, 'published');
    });
  });

  // --- Editing media -------------------------------------------------------------------------

  describe('editing a post with media', () => {
    it('opens the files in order with their alt text and thumbnails, and saves removals and reorders together', async () => {
      const fake = owner();
      const id = addPost(fake, { files: [['a'], ['b'], ['c']] });
      await open(fake, `/app/studio/edit/${id}`);
      assert.match(app.text('#media-label'), /Images 3 of 10/);
      assert.deepEqual([...app.find('#editor-media').querySelectorAll('[data-alt]')].map(input => input.value), ['Alt of a', 'Alt of b', 'Alt of c']);
      assert.match(app.find('.ed-pic img').getAttribute('src'), /fake\.supabase\.test.*a-poster\.webp/, 'the grid shows the small card thumbnail');
      assert.equal(app.find('#entry-format').value, 'Gallery');
      assert.equal(app.find('#editor-form').dataset.kind, 'image');
      assert.equal(app.text('#entry-body-label'), 'Caption (optional)');
      assert.equal(app.find('#entry-body').value, 'A short caption.');
      const [a, b] = keys();
      await act('media-remove', a);
      await act('media-later', b);
      await type(`[data-alt="${b}"]`, 'New alt');
      fake.calls.length = 0;
      await press('published');
      const order = names(fake, 'removeMedia', 'updateMedia', 'saveEntry');
      assert.deepEqual(order, ['removeMedia', 'updateMedia', 'updateMedia', 'saveEntry'], 'the removal goes out first and the updates go out while it runs');
      assert.deepEqual(mediaOf(fake, id).map(item => [item.alt, item.position]), [['Alt of c', 0], ['New alt', 1]]);
      assert.equal(row(fake, id).media_count, 2);
      assert.equal(app.path, `/app/p/${id}`);
    });

    it('keeps the reorders when the removal fails, and the next save only repeats the removal', async () => {
      const fake = owner();
      const id = addPost(fake, { files: [['a'], ['b']] });
      await open(fake, `/app/studio/edit/${id}`);
      const [a, b] = keys();
      await act('media-remove', a);
      await type(`[data-alt="${b}"]`, 'Kept alt');
      fake.fail('removeMedia', 'The removal was interrupted.');
      await press('published');
      assert.match(app.text('#entry-error'), /^The removal was interrupted\./);
      assert.equal(app.path, `/app/studio/edit/${id}`);
      assert.deepEqual(mediaOf(fake, id).map(item => [item.alt, item.position]), [['Alt of a', 0], ['Kept alt', 1]], 'the alt text was saved although the removal failed');
      fake.fail('removeMedia', null);
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'removeMedia', 'updateMedia', 'saveEntry'), ['removeMedia', 'updateMedia', 'saveEntry'].filter(name => name !== 'updateMedia'), 'nothing already saved is sent again');
      assert.equal(mediaOf(fake, id).length, 1);
    });

    it('does not send an update for files that did not change', async () => {
      const fake = owner();
      const id = addPost(fake, { files: [['a'], ['b']] });
      await open(fake, `/app/studio/edit/${id}`);
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'updateMedia', 'removeMedia', 'uploadMedia'), []);
      assert.deepEqual(names(fake, 'saveEntry'), ['saveEntry']);
    });

    it('switches a published post from images to a film: the film is stored before the images go', async () => {
      const fake = owner();
      const id = addPost(fake, { files: [['a']] });
      await open(fake, `/app/studio/edit/${id}`);
      await act('media-remove', keys()[0]);
      await act('kind', 'video');
      await pick([mp4('clip.mp4')]);
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'uploadMedia', 'removeMedia', 'saveEntry'), ['uploadMedia', 'removeMedia', 'saveEntry']);
      assert.deepEqual(callsTo(fake, 'saveEntry').map(call => [call.args[0], call.args[2], call.args[1].kind, call.args[1].format]), [[id, 'published', 'video', 'Film']]);
      assert.deepEqual(mediaOf(fake, id).map(item => item.kind), ['video']);
      assert.equal(row(fake, id).status, 'published', 'never unpublished on the way');
    });

    it('removes the files of another kind that a failed save left behind: on a text post and on a gallery', async () => {
      const fake = owner();
      const text = addPost(fake, { kind: 'text', body: LONG, files: [['left', 'image']] });
      const gallery = addPost(fake, { files: [['a'], ['b'], ['extra', 'video']] });
      await open(fake, `/app/studio/edit/${text}`);
      assert.equal(app.exists('#editor-media .ed-media'), false, 'the editor shows no media on a text post');
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'removeMedia', 'saveEntry'), ['removeMedia', 'saveEntry']);
      assert.deepEqual(mediaOf(fake, text), []);
      assert.equal(row(fake, text).status, 'published');
      await app.navigate(`/app/studio/edit/${gallery}`);
      assert.match(app.text('#media-label'), /Images 2 of 10/);
      assert.equal(app.exists('video'), false);
      fake.calls.length = 0;
      await press('published');
      assert.deepEqual(names(fake, 'removeMedia', 'saveEntry'), ['removeMedia', 'saveEntry']);
      assert.deepEqual(mediaOf(fake, gallery).map(item => item.kind), ['image', 'image']);
    });

    it('opens without thumbnails when the pictures cannot be signed, and still saves', async () => {
      const fake = owner();
      const id = addPost(fake, { files: [['a']] });
      fake.fail('signedUrls', 'We could not reach REFLUENZ. Check your connection and try again.');
      await open(fake, `/app/studio/edit/${id}`);
      assert.equal(app.exists('.ed-item'), true);
      assert.equal(app.exists('.ed-pic img'), false);
      await press('published');
      assert.equal(app.path, `/app/p/${id}`);
    });

    it('stops with an error and Retry when the files of a media post cannot be read, because saving without them could not clean up', async () => {
      const fake = owner();
      const id = addPost(fake, { files: [['a']] });
      fake.fail('media', 'We could not reach REFLUENZ. Check your connection and try again.');
      await open(fake, `/app/studio/edit/${id}`);
      assert.equal(app.exists('#editor-form'), false);
      assert.match(app.text('.error-state'), /could not reach REFLUENZ/);
      fake.fail('media', null);
      await app.click('[data-retry]');
      assert.ok(app.exists('#editor-form'));
    });

    it('opens a text post even when the file list cannot be read', async () => {
      const fake = owner();
      fake.fail('media', 'Offline.');
      await open(fake, `/app/studio/edit/${E.firstDraftHabits}`);
      assert.ok(app.exists('#editor-form'));
    });

    it('stops with an error when the text of a post cannot be read, instead of risking an empty save', async () => {
      const fake = owner();
      fake.fail('getBody', 'Offline.');
      await open(fake, `/app/studio/edit/${E.firstDraftHabits}`);
      assert.equal(app.exists('#editor-form'), false);
      assert.match(app.text('.error-state'), /Offline\./);
    });
  });

  // --- Preview ---------------------------------------------------------------------------------

  describe('the preview', () => {
    it('shows the post the way readers will see it, and goes back to the form with everything still in it', async () => {
      await open(owner());
      await fill({ title: 'A title', subtitle: 'An introduction', body: `First paragraph.\nA second line.\n\nSecond paragraph.` });
      const write = app.find('[data-action="mode"][data-id="write"]');
      const preview = app.find('[data-action="mode"][data-id="preview"]');
      assert.equal(write.getAttribute('aria-pressed'), 'true');
      await act('mode', 'preview');
      assert.equal(preview.getAttribute('aria-pressed'), 'true');
      assert.equal(write.getAttribute('aria-pressed'), 'false');
      assert.equal(app.find('#editor-write').hidden, true);
      assert.equal(app.find('#editor-preview').hidden, false);
      assert.match(app.text('#editor-preview .ed-article-title'), /^A title$/);
      assert.match(app.text('#editor-preview .ed-article-deck'), /An introduction/);
      assert.match(app.text('#editor-preview .ed-article-byline'), /^By Verne & Co · .+ · 1 min read$/);
      assert.match(app.text('#editor-preview .eyebrow.bronze'), /Writing · Everyone/);
      assert.equal(app.find('#editor-preview').querySelectorAll('.ed-article-body p').length, 2);
      assert.equal(app.find('#editor-preview').querySelectorAll('.ed-article-body br').length, 1, 'a single line break stays a line break');
      assert.equal(app.find('.ed-article-cover img').getAttribute('src'), '/editorial/v1/atelier.jpg');
      assert.equal(app.exists('.ed-lock-note'), false);
      assert.match(app.text('#editor-status'), /Preview shown/);
      await act('mode', 'write');
      assert.equal(app.find('#editor-write').hidden, false);
      assert.equal(app.find('#editor-preview').hidden, true);
      assert.equal(app.find('#editor-preview').innerHTML, '', 'a film in the preview stops playing');
      assert.equal(app.find('#entry-title').value, 'A title');
    });

    it('says what members and everyone else will see when the post is for a tier', async () => {
      await open(owner());
      await fill({ title: 'For members', body: LONG });
      await choose('#entry-access', 'premium');
      await act('mode', 'preview');
      assert.match(app.text('#editor-preview .eyebrow.bronze'), /Supporter and above/);
      assert.match(app.text('.ed-lock-note'), /Members of your Supporter circle and above read the rest\. Everyone else sees the opening paragraph, a blurred preview and an invitation to join\./);
    });

    it('shows an empty post as such', async () => {
      await open(owner());
      await act('mode', 'preview');
      assert.match(app.text('.ed-article-title'), /Untitled post/);
      assert.match(app.text('#editor-preview'), /Nothing written yet\./);
    });

    it('shows the pictures with their alt text, and the film in a player', async () => {
      await open(owner(), '/app/studio/new?kind=image');
      await fill({ title: 'Rooms' });
      await pick([jpg('a.jpg'), jpg('b.jpg')]);
      await type('[data-alt]', 'A bright room');
      await act('mode', 'preview');
      const images = [...app.find('#editor-preview').querySelectorAll('.ed-article-media img')];
      assert.deepEqual(images.map(image => image.getAttribute('alt')), ['A bright room', 'Rooms, image 2']);
      assert.match(app.text('.ed-article-byline'), /2 images/);
      await app.navigate('/app/studio/new?kind=video');
      await pick([mp4('film.mp4')]);
      await act('mode', 'preview');
      const video = app.find('#editor-preview video');
      assert.equal(video.hasAttribute('controls'), true);
      assert.equal(video.hasAttribute('playsinline'), true);
      assert.equal(video.hasAttribute('autoplay'), false);
      assert.equal(video.getAttribute('src'), 'blob:http://localhost/test');
    });

    it('says when there is nothing to show yet, and shows an uploaded cover of a text post', async () => {
      await open(owner(), '/app/studio/new?kind=image');
      await act('mode', 'preview');
      assert.match(app.text('#editor-preview'), /No images added yet\./);
      await app.navigate('/app/studio/new');
      await pick([png('cover.png')], '#entry-cover-file');
      await act('mode', 'preview');
      assert.equal(app.find('.ed-article-cover img').getAttribute('src'), 'blob:http://localhost/test');
      assert.equal(app.find('.ed-article-cover img').getAttribute('alt'), 'Your cover picture');
    });

    it('returns to the form to show a problem found while saving from the preview', async () => {
      const fake = owner();
      await open(fake);
      await act('mode', 'preview');
      await press('published');
      assert.equal(app.find('#editor-write').hidden, false);
      assert.match(app.text('#err-title'), /between 3 and 100/);
    });
  });

  // --- Leaving the page ----------------------------------------------------------------------

  describe('leaving the page', () => {
    it('asks first when there are unsaved changes, and stays when the answer is no', async () => {
      await open(owner());
      await fill({ title: 'Unsaved' });
      const asked = confirmWith(false);
      assert.equal(await app.router.navigate('/app/studio'), false);
      assert.deepEqual(asked, ['You have unsaved changes to this post. Leave without saving?']);
      assert.equal(app.path, '/app/studio/new');
      assert.equal(app.find('#entry-title').value, 'Unsaved');
      confirmWith(true);
      assert.equal(await app.router.navigate('/app/studio'), true);
      assert.equal(app.path, '/app/studio');
    });

    it('does not ask when nothing was changed', async () => {
      await open(owner());
      const asked = confirmWith(false);
      await app.navigate('/app/studio');
      assert.deepEqual(asked, []);
      assert.equal(app.path, '/app/studio');
    });

    it('asks for every kind of change: a picture, a cover, a choice', async () => {
      await open(owner());
      assert.equal(app.router.block(), null);
      await choose('#entry-category', 'Culture');
      assert.match(app.router.block(), /unsaved changes/);
      await app.navigate('/app/studio/new?kind=image');
      assert.equal(app.router.block(), null);
      await pick([jpg('a.jpg')]);
      assert.match(app.router.block(), /unsaved changes/);
      await app.navigate('/app/studio/new');
      await pick([png('cover.png')], '#entry-cover-file');
      assert.match(app.router.block(), /unsaved changes/);
    });

    it('the browser’s own leave warning follows the same rule', async () => {
      await open(owner());
      const clean = new app.window.Event('beforeunload', { cancelable: true });
      app.window.dispatchEvent(clean);
      assert.equal(clean.defaultPrevented, false);
      await fill({ title: 'Typed' });
      const dirty = new app.window.Event('beforeunload', { cancelable: true });
      app.window.dispatchEvent(dirty);
      assert.equal(dirty.defaultPrevented, true);
    });

    it('lets go once the post is saved, and while it uploads says that leaving stops the upload', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=image');
      await fill({ title: 'Leaving' });
      await pick([jpg('a.jpg')]);
      const upload = gated(fake);
      const saving = press('published');
      await tick(10);
      assert.match(app.router.block(), /still saving\. Leave this page and stop the upload\?/);
      upload.release();
      await saving;
      await app.settle();
      assert.equal(app.router.block, null, 'the page is gone');
      assert.match(app.path, /^\/app\/p\//);
    });

    it('removes the files this session stored from a live post when the creator leaves after a failed save, so the post is as it was', async () => {
      const fake = owner();
      const id = addPost(fake, { files: [['a'], ['b'], ['c']] });
      await open(fake, `/app/studio/edit/${id}`);
      await pick([png('n1.png'), png('n2.png')]);
      intercept(fake, 'uploadMedia', (real, entryId, creatorId, file, options) => (file.name === 'n2.png' ? Promise.reject(Error('The upload was interrupted.')) : real(entryId, creatorId, file, options)));
      await press('published');
      assert.match(app.text('#entry-error'), /^n2\.png: The upload was interrupted\. Your changes and 1 uploaded file are kept\. Press Save draft or Update post to continue\.$/);
      assert.equal(mediaOf(fake, id).length, 4, 'the first new image is already on the live post');
      const asked = confirmWith(true);
      await app.navigate('/app/studio');
      assert.match(asked[0], /Files uploaded during this edit are removed again/);
      await sleep(20);
      assert.deepEqual(mediaOf(fake, id).map(item => item.path.split('/').pop()), ['a.webp', 'b.webp', 'c.webp']);
      assert.equal(row(fake, id).status, 'published');
      assert.equal(row(fake, id).media_count, 3);
    });

    it('opening the editor again waits for that clean-up, so it never lists a file that is on its way out', async () => {
      const fake = owner();
      const id = addPost(fake, { files: [['a'], ['b']] });
      await open(fake, `/app/studio/edit/${id}`);
      await pick([png('n1.png')]);
      intercept(fake, 'saveEntry', () => Promise.reject(Error('The save was interrupted.')));
      await press('published');
      intercept(fake, 'removeMedia', async (real, ...args) => { await sleep(30); return real(...args); });
      await app.navigate('/app/studio');
      await app.navigate(`/app/studio/edit/${id}`);
      assert.match(app.text('#media-label'), /Images 2 of 10/);
      assert.equal(mediaOf(fake, id).length, 2);
    });

    it('keeps a lone file stored by a failed save when the editor is left: removing it would unpublish the post', async () => {
      const fake = owner();
      const id = addPost(fake, { kind: 'video', files: [['old']] });
      await open(fake, `/app/studio/edit/${id}`);
      await act('media-remove', keys()[0]);
      await pick([mp4('new.mp4')]);
      fake.fail('saveEntry', 'The save was interrupted.');
      await press('published');
      fake.calls.length = 0;
      await app.navigate('/app/studio');
      await sleep(20);
      assert.deepEqual(names(fake, 'removeMedia'), []);
      assert.equal(mediaOf(fake, id).length, 1);
      assert.equal(row(fake, id).status, 'published');
    });

    it('removes the new film again when the old one could not be removed, so the post keeps what it had', async () => {
      const fake = owner();
      const id = addPost(fake, { kind: 'video', files: [['old']] });
      await open(fake, `/app/studio/edit/${id}`);
      await act('media-remove', keys()[0]);
      await pick([mp4('new.mp4')]);
      fake.fail('removeMedia', 'The removal was interrupted.');
      await press('published');
      assert.equal(mediaOf(fake, id).length, 2);
      fake.fail('removeMedia', null);
      await app.navigate('/app/studio');
      await sleep(20);
      assert.deepEqual(mediaOf(fake, id).map(item => item.path.split('/').pop()), ['old.mp4']);
      assert.equal(row(fake, id).status, 'published');
    });

    it('a save that completed does not undo its own files when the page is left', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=image');
      await fill({ title: 'Kept images' });
      await pick([jpg('keep.jpg')]);
      await press('published');
      fake.calls.length = 0;
      await sleep(20);
      assert.deepEqual(names(fake, 'removeMedia'), []);
      assert.equal(fake.db.entries.find(entry => entry.title === 'Kept images').media_count, 1);
    });

    it('stops the upload and leaves nothing behind when the creator signs out while a file uploads, and reports nothing', async () => {
      const fake = owner();
      await open(fake, '/app/studio/new?kind=image');
      await fill({ title: 'Never saved' });
      await pick([jpg('z.jpg')]);
      let aborted = false;
      intercept(fake, 'uploadMedia', (real, entryId, creatorId, file, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => { aborted = true; reject(Error('Upload cancelled.')); }, { once: true });
      }));
      const saving = press('published');
      await tick(10);
      fake.signInAs(null);
      await saving;
      await app.settle();
      await sleep(10);
      assert.equal(aborted, true);
      assert.match(app.path, /^\/app\/login/);
      assert.equal(app.exists('#editor-form'), false);
      assert.deepEqual(callsTo(fake, 'saveEntry').map(call => call.args[2]), ['draft'], 'the final save never ran');
      assert.equal(toastText(), '', 'nothing is reported for the account that left');
    });
  });

  // --- Small things ------------------------------------------------------------------------------

  describe('accessibility and touch', () => {
    it('announces progress and results in polite and assertive regions', async () => {
      await open(owner());
      assert.equal(app.find('#editor-status').getAttribute('aria-live'), 'polite');
      assert.equal(app.find('#entry-error').getAttribute('role'), 'alert');
      assert.equal(app.find('#cover-error').getAttribute('role'), 'alert');
    });

    it('marks the toggles with aria-pressed and the write / preview switch as a group', async () => {
      await open(owner());
      assert.equal(app.find('.ed-view').getAttribute('role'), 'group');
      for (const button of app.find('#view').querySelectorAll('.ed-kind, [data-action="mode"]')) assert.ok(button.hasAttribute('aria-pressed'));
    });

    it('draws no inline handlers or styles, and opens external links safely', async () => {
      await open(owner(), `/app/studio/edit/${E.firstDraftHabits}`);
      const markup = app.html('#view');
      assert.doesNotMatch(markup, /\son[a-z]+=/i);
      assert.doesNotMatch(markup, /\sstyle=/i);
      assert.doesNotMatch(markup, /target="_blank"/);
    });

    it('keeps every control at least 40 px, 44 px on touch screens, dims what is disabled, and never overflows at 375 px', () => {
      const css = readFileSync(new URL('../../src/styles/editor.css', import.meta.url), 'utf8');
      assert.match(css, /@media \(pointer: coarse\)/);
      const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
      for (const selector of ['.ed-kind', '.ed-alt', '.ed-item-actions .icon-button', '.ed-cancel .button', '.ed-dropzone']) assert.ok(coarse.includes(selector), `${selector} grows on touch screens`);
      assert.match(coarse, /min-height: 44px/);
      const sizes = [...css.matchAll(/\.ed-item-actions \.icon-button \{[^}]*?(?:width|height): (\d+)px/g)].map(match => Number(match[1]));
      assert.ok(sizes.length && sizes.every(size => size >= 40));
      assert.match(css, /\.ed-fields:disabled/);
      assert.match(css, /opacity: \.45/);
      assert.match(css, /@media \(max-width: 760px\)/);
      assert.match(css, /prefers-reduced-motion/);
      assert.doesNotMatch(css, /linear-gradient|radial-gradient|border-radius: (?!0)/, 'square geometry, no gradients');
    });
  });
});
