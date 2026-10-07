// The creator studio (/app/studio): the "Open your atelier" flow for a member without an atelier, and the dashboard of an owner
// (header, new post chooser, numbers, Published / Drafts / Members / Notes).
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom, mountApp, tick } from '../helpers/dom.mjs';
import { createFakeApi, IDS } from '../helpers/fake-api.mjs';
import { csvCell, csvFilename, membersCsv } from '../../src/views/studio/csv.js';
import { CATEGORIES } from '../../src/api/util.js';

const E = IDS.entries;
const HOSTILE = '<img src=x onerror=alert(1)>';
const member = () => createFakeApi();
const owner = () => createFakeApi({ signedIn: IDS.owner });
const guest = () => createFakeApi({ signedIn: null });
const callsTo = (fake, method) => fake.calls.filter(call => call.method === method);
const verne = fake => fake.db.creators.find(row => row.id === IDS.verne);
const entryRow = (fake, id) => fake.db.entries.find(row => row.id === id);

// Extra posts of Verne & Co, newest first, so a page of 12 has a next page.
function addPosts(fake, count, { status = 'published' } = {}) {
  const source = entryRow(fake, status === 'draft' ? E.unfinishedEssay : E.firstDraftHabits);
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.parse('2026-09-15T08:00:00Z') - i * 3_600_000).toISOString();
    fake.db.entries.push({ ...source, id: `3b${status === 'draft' ? '1' : '0'}00000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title: `${status === 'draft' ? 'Draft' : 'Extra post'} ${String(i + 1).padStart(2, '0')}`,
      status, published_at: status === 'draft' ? null : at, created_at: at, updated_at: at });
  }
  fake.refresh();
}

// Readers in the circle of Verne & Co. `names` become their display names.
function addMembers(fake, names, { tier = 'essential' } = {}) {
  names.forEach((name, i) => {
    const id = `1a000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const at = new Date(Date.parse('2026-09-01T08:00:00Z') + i * 3_600_000).toISOString();
    fake.db.users.push({ id, email: `reader${i}@example.test`, password: 'secret12', confirmed: true });
    fake.db.profiles.push({ id, display_name: name, bio: '', website: '', avatar_path: null, created_at: at, updated_at: at });
    fake.db.memberships.push({ user_id: id, creator_id: IDS.verne, tier: typeof tier === 'function' ? tier(i) : tier, created_at: at, updated_at: at });
  });
  fake.refresh();
}

function addNotes(fake, count) {
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.parse('2026-09-01T08:00:00Z') + i * 3_600_000).toISOString();
    fake.db.circle_notes.push({ id: `7b000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, creator_id: IDS.verne, body: `Note number ${String(i + 1).padStart(2, '0')}`, created_at: at });
  }
}

// A small RFC 4180 reader: rows of cells, quotes doubled inside quoted cells.
function parseCsv(text) {
  const out = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; } else if (char === '\r' && text[i + 1] === '\n') { row.push(cell); out.push(row); row = []; cell = ''; i++; } else cell += char;
  }
  return out;
}

describe('creator studio view', () => {
  before(() => installDom());
  after(() => uninstallDom());

  let app;
  let restore = () => {};
  const open = async (api, path = '/app/studio') => { app = await mountApp({ api, path }); return app; };
  afterEach(async () => { restore(); restore = () => {}; await app?.destroy(); app = null; });

  const toastText = () => (app.exists('#toast') ? app.text('#toast') : '');
  const dialogOpen = () => app.exists('#modal') && app.find('#modal').open;
  const type = async (selector, value) => {
    const field = app.find(selector);
    field.value = value;
    field.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await app.settle();
  };
  const choose = async (selector, value) => {
    const field = app.find(selector);
    field.value = value;
    field.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    await app.settle();
  };
  const press = async (selector, key) => {
    app.find(selector).dispatchEvent(new app.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await app.settle();
  };
  const metric = label => {
    const cell = [...app.document.querySelectorAll('#view .studio-metric')].find(node => node.querySelector('dt')?.textContent.trim() === label);
    assert.ok(cell, `a "${label}" number is drawn`);
    return cell.querySelector('strong').textContent.trim();
  };
  const rows = selector => [...app.document.querySelectorAll(`#view ${selector}`)];
  const postTitles = () => rows('.studio-entry-title').map(node => node.textContent.trim());
  const tab = name => app.find(`[role="tab"][data-tab="${name}"]`);
  const panelText = () => app.text('[data-region="panel"]');
  const goTab = async name => { await app.click(tab(name)); await tick(5); await app.settle(); };
  // Blocks the browser's own download and keeps the file.
  const captureDownloads = () => {
    const files = [];
    const names = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = blob => { files.push(blob); return 'blob:http://localhost/circle'; };
    const onClick = event => {
      const link = event.target.closest?.('a[download]');
      if (!link) return;
      event.preventDefault();
      names.push(link.getAttribute('download'));
    };
    app.document.addEventListener('click', onClick);
    restore = () => { URL.createObjectURL = original; app.document.removeEventListener('click', onClick); };
    return { files, names };
  };
  // An api method that answers only when the test says so.
  const hold = (fake, method) => {
    const real = fake[method].bind(fake);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    fake[method] = async (...args) => { await gate; return real(...args); };
    return release;
  };

  // --------------------------------------------------------------------------------------------
  describe('the studio of a guest and of a member without an atelier', () => {
    it('sends a guest to sign in and brings them back', async () => {
      await open(guest());
      assert.equal(app.path, '/app/login?next=%2Fapp%2Fstudio');
    });

    it('explains the offer and shows the form, in plain words about early access', async () => {
      await open(member());
      assert.equal(app.document.title, 'Open your atelier — REFLUENZ');
      assert.equal(app.text('#view h1'), 'Open your atelier');
      assert.equal(app.find('#view section').getAttribute('aria-labelledby'), 'studio-open-title');
      assert.match(app.text('.studio-offer'), /Publish what you make/);
      assert.match(app.text('.studio-offer'), /Build a circle/);
      assert.match(app.text('.studio-offer .notice'), /Payments are not live yet\. Joining is free during early access/);
      assert.ok(app.exists('[data-open-form]'));
      assert.equal(app.exists('.studio-metrics'), false, 'no dashboard without an atelier');
      assert.equal(app.find('.form-actions a.secondary').getAttribute('href'), '/app');
    });

    it('labels every control and offers every category', async () => {
      await open(member());
      const form = app.find('[data-open-form]');
      for (const control of form.querySelectorAll('input, select, textarea')) {
        assert.ok(app.exists(`label[for="${control.id}"]`), `${control.name} has a label`);
        assert.ok(control.getAttribute('aria-describedby'), `${control.name} is described`);
      }
      const options = [...form.querySelectorAll('select[name="category"] option')].filter(option => option.value).map(option => option.value);
      assert.deepEqual(options, CATEGORIES);
      assert.equal(options.length, 12);
      assert.equal(app.find('#studio-slug-status').getAttribute('aria-live'), 'polite');
    });

    it('suggests an address from the name and checks that it is free', async () => {
      const fake = member();
      await open(fake);
      await type('#atelier-name', 'Maison Lumière');
      assert.equal(app.find('#atelier-slug').value, 'maison-lumiere');
      assert.match(app.text('[data-slug-status]'), /Checking availability/);
      await tick(400);
      await app.settle();
      assert.deepEqual(callsTo(fake, 'slugAvailable').map(call => call.args[0]), ['maison-lumiere'], 'one request, once typing stopped');
      assert.match(app.text('[data-slug-status]'), /That address is available\./);
      assert.equal(app.find('[data-slug-status]').dataset.state, 'available');
    });

    it('says when an address is taken, and stops suggesting once the person writes their own', async () => {
      const fake = member();
      await open(fake);
      await type('#atelier-name', 'Verne & Co');
      await tick(400);
      await app.settle();
      assert.equal(app.find('#atelier-slug').value, 'verne-co');
      await type('#atelier-slug', 'Verne-And-Co!');
      assert.equal(app.find('#atelier-slug').value, 'verne-and-co', 'letters, numbers and hyphens only');
      await tick(400);
      await app.settle();
      assert.match(app.text('[data-slug-status]'), /That address is taken\. Try another\./);
      assert.equal(app.find('[data-slug-status]').dataset.state, 'taken');
      await type('#atelier-name', 'Something else');
      assert.equal(app.find('#atelier-slug').value, 'verne-and-co', 'the address the person wrote is kept');
    });

    it('rejects a taken address on submit without asking the server to create anything', async () => {
      const fake = member();
      await open(fake);
      await type('#atelier-name', 'Another Writer');
      await type('#atelier-slug', 'verne-and-co');
      await tick(400);
      await app.settle();
      await choose('#atelier-category', 'Writing');
      await app.submit('[data-open-form]');
      assert.equal(callsTo(fake, 'createAtelier').length, 0);
      assert.match(app.text('[data-error-for="slug"]'), /address is taken/);
      assert.equal(app.find('#atelier-slug').getAttribute('aria-invalid'), 'true');
    });

    it('explains an invalid address before asking the server', async () => {
      const fake = member();
      await open(fake);
      await type('#atelier-slug', 'a');
      assert.match(app.text('[data-slug-status]'), /2 to 40 letters, numbers or hyphens/);
      await tick(400);
      assert.equal(callsTo(fake, 'slugAvailable').length, 0);
    });

    it('still lets the person continue when the availability check fails', async () => {
      const fake = member();
      await open(fake);
      fake.fail('slugAvailable', 'Offline.');
      await type('#atelier-name', 'Quiet Room');
      await tick(400);
      await app.settle();
      assert.match(app.text('[data-slug-status]'), /We could not check this address right now\. You can still continue\./);
      await choose('#atelier-category', 'Design');
      await app.submit('[data-open-form]');
      assert.equal(callsTo(fake, 'createAtelier').length, 1);
      assert.equal(app.text('#view h1'), 'Quiet Room');
    });

    it('validates the form, names each problem and focuses the first one', async () => {
      const fake = member();
      await open(fake);
      await app.submit('[data-open-form]');
      assert.equal(callsTo(fake, 'createAtelier').length, 0);
      assert.match(app.text('[data-error-for="name"]'), /Give your atelier a name\./);
      assert.match(app.text('[data-error-for="category"]'), /Choose a category\./);
      assert.match(app.text('[data-form-error]'), /Check the highlighted fields/);
      assert.equal(app.find('#atelier-name').getAttribute('aria-invalid'), 'true');
      assert.equal(app.document.activeElement?.id, 'atelier-name');
      // typing in a field clears its message
      await type('#atelier-name', 'Ok');
      assert.equal(app.text('[data-error-for="name"]'), '');
      assert.equal(app.find('#atelier-name').getAttribute('aria-invalid'), null);
    });

    it('checks the lengths of the free text fields', async () => {
      const fake = member();
      await open(fake);
      app.find('#atelier-name').value = 'A';
      app.find('#atelier-bio').value = 'x'.repeat(401);
      app.find('#atelier-descriptor').value = 'y'.repeat(61);
      app.find('#atelier-location').value = 'z'.repeat(61);
      await app.submit('[data-open-form]', { category: 'Art' });
      assert.match(app.text('[data-error-for="name"]'), /at least 2 characters/);
      assert.match(app.text('[data-error-for="bio"]'), /at most 400/);
      assert.match(app.text('[data-error-for="descriptor"]'), /at most 60/);
      assert.match(app.text('[data-error-for="location"]'), /at most 60/);
      assert.equal(callsTo(fake, 'createAtelier').length, 0);
    });

    it('counts the characters of the description', async () => {
      await open(member());
      await type('#atelier-bio', 'Hello there');
      assert.equal(app.text('[data-bio-count]'), '11');
    });

    it('opens the atelier, tells the store and lands on the dashboard', async () => {
      const fake = member();
      await open(fake);
      await type('#atelier-name', '  Salt & Linen  ');
      await choose('#atelier-category', 'Style');
      await type('#atelier-descriptor', 'Textiles');
      await type('#atelier-location', 'Genoa');
      await type('#atelier-bio', 'Cloth, patiently.');
      await tick(400);
      await app.settle();
      await app.submit('[data-open-form]');
      const [call] = callsTo(fake, 'createAtelier');
      assert.deepEqual(call.args[0], { name: 'Salt & Linen', category: 'Style', descriptor: 'Textiles', location: 'Genoa', bio: 'Cloth, patiently.', slug: 'salt-linen' });
      assert.equal(app.store.state.myCreator?.slug, 'salt-linen');
      assert.equal(app.path, '/app/studio');
      assert.equal(app.text('#view h1'), 'Salt & Linen');
      assert.equal(app.document.title, 'Studio — REFLUENZ');
      assert.match(toastText(), /Your atelier is open/);
      assert.equal(fake.db.creators.find(row => row.slug === 'salt-linen').owner_id, IDS.member);
      // the sidebar turns into the creator's
      assert.ok(app.exists('#view .studio-new'), 'the new post chooser is there');
    });

    it('lets the address be left to the server', async () => {
      const fake = member();
      await open(fake);
      await app.submit('[data-open-form]', { name: 'No Address', category: 'Art' });
      assert.equal('slug' in callsTo(fake, 'createAtelier')[0].args[0], false);
      assert.equal(app.store.state.myCreator?.slug, 'no-address');
    });

    it('keeps everything that was typed and says why when opening fails', async () => {
      const fake = member();
      await open(fake);
      await type('#atelier-name', 'Hold Fast');
      await choose('#atelier-category', 'Music');
      await type('#atelier-bio', 'Words I typed.');
      fake.fail('createAtelier', 'The atelier could not be opened right now.');
      await app.submit('[data-open-form]');
      assert.match(app.text('[data-form-error]'), /could not be opened right now/);
      assert.match(toastText(), /could not be opened right now/);
      assert.equal(app.find('#atelier-name').value, 'Hold Fast');
      assert.equal(app.find('#atelier-bio').value, 'Words I typed.');
      assert.equal(app.find('#atelier-category').value, 'Music');
      assert.equal(app.find('[data-submit]').disabled, false, 'the button is usable again');
      assert.equal(app.find('[data-submit]').getAttribute('aria-busy'), null);
      assert.equal(app.store.state.myCreator, null);
      fake.fail('createAtelier', null);
      await app.submit('[data-open-form]');
      assert.equal(app.text('#view h1'), 'Hold Fast');
    });

    it('puts a server message about the address on the address field', async () => {
      const fake = member();
      await open(fake);
      fake.fail('createAtelier', 'That atelier address is taken. Try another name.');
      await app.submit('[data-open-form]', { name: 'Race Lost', category: 'Art', slug: 'race-lost' });
      assert.match(app.text('[data-error-for="slug"]'), /address is taken/);
      assert.equal(app.document.activeElement?.id, 'atelier-slug');
    });

    it('carries on to the studio when the atelier turns out to exist already', async () => {
      const fake = member();
      await open(fake);
      const real = fake.createAtelier.bind(fake);
      fake.createAtelier = async values => { await real(values); throw Error('You already have an atelier.'); };
      await app.submit('[data-open-form]', { name: 'Twice Over', category: 'Art' });
      assert.equal(app.path, '/app/studio');
      assert.equal(app.text('#view h1'), 'Twice Over');
    });

    it('does not create two ateliers when the form is submitted twice', async () => {
      const fake = member();
      await open(fake);
      const release = hold(fake, 'createAtelier');
      app.find('#atelier-name').value = 'Once Only';
      app.find('#atelier-category').value = 'Art';
      const form = app.find('[data-open-form]');
      form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
      await tick(5);
      assert.equal(app.find('[data-submit]').disabled, true, 'busy while the request runs');
      release();
      await app.settle();
      assert.equal(callsTo(fake, 'createAtelier').length, 1);
    });

    it('asks before leaving a half filled form, and not for an empty one', async () => {
      await open(member());
      assert.equal(app.router.block(), null);
      await type('#atelier-name', 'Unsaved');
      assert.match(app.router.block(), /Leave without saving\?/);
    });

    it('escapes a hostile name everywhere it is shown', async () => {
      const fake = member();
      await open(fake);
      await app.submit('[data-open-form]', { name: HOSTILE, category: 'Art' });
      assert.equal(app.text('#view h1'), HOSTILE);
      assert.equal(app.exists('#view img[onerror]'), false);
      assert.equal(app.exists('#view [onerror]'), false);
      assert.equal(app.find('.studio-identity h1').children.length, 0);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('the dashboard of an owner', () => {
    it('draws the header with a link to the public page and to the settings', async () => {
      await open(owner());
      assert.equal(app.document.title, 'Studio — REFLUENZ');
      assert.equal(app.text('#view h1'), 'Verne & Co');
      assert.equal(app.find('#view > section').getAttribute('aria-labelledby'), 'studio-title');
      assert.match(app.text('.studio-line'), /Essays on getting started · Writing · Turin, Italy/);
      assert.equal(app.find('.studio-head-actions a[href="/app/c/verne-and-co"]').textContent.trim(), 'View public page');
      assert.equal(app.find('.studio-head-actions a[href="/app/studio/settings"]').textContent.trim(), 'Edit atelier');
      assert.ok(app.exists('.studio-identity .avatar'));
    });

    it('offers a new post of each kind', async () => {
      await open(owner());
      const links = rows('.studio-new-link').map(link => [link.querySelector('strong').textContent, link.getAttribute('href')]);
      assert.deepEqual(links, [['Text', '/app/studio/new?kind=text'], ['Image', '/app/studio/new?kind=image'], ['Video', '/app/studio/new?kind=video']]);
      assert.equal(app.find('.studio-new').getAttribute('aria-labelledby'), 'studio-new-title');
    });

    it('goes to the editor with the chosen kind', async () => {
      await open(owner());
      await app.click('.studio-new-link[href="/app/studio/new?kind=video"]');
      assert.equal(app.path, '/app/studio/new?kind=video');
    });

    it('has headings for each part and labelled landmarks', async () => {
      await open(owner());
      assert.deepEqual(rows('h2').map(node => node.textContent.trim()), ['New post', 'Overview', 'Your posts, circle and notes']);
      for (const section of app.document.querySelectorAll('#view section[aria-labelledby]')) assert.ok(app.exists(`#${section.getAttribute('aria-labelledby')}`));
      assert.equal(app.find('[data-region="stats"]').getAttribute('aria-live'), 'polite');
    });

    it('escapes a hostile atelier name in the heading and the title', async () => {
      const fake = owner();
      verne(fake).name = HOSTILE;
      await open(fake);
      assert.equal(app.text('#view h1'), HOSTILE);
      assert.equal(app.exists('#view img[onerror]'), false);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('the numbers', () => {
    it('shows a skeleton while they load, then the figures of the atelier', async () => {
      const fake = owner();
      const release = hold(fake, 'creatorStats');
      await open(fake);
      assert.ok(app.exists('[data-region="stats"] .studio-metrics[role="status"]'), 'a placeholder while waiting');
      assert.equal(app.find('[data-region="stats"]').getAttribute('aria-busy'), 'true');
      assert.ok(app.exists('.studio-new'), 'the rest of the page does not wait');
      release();
      await app.settle();
      assert.equal(app.exists('[data-region="stats"] [role="status"]'), false);
      assert.equal(app.find('[data-region="stats"]').getAttribute('aria-busy'), 'false');
      assert.equal(metric('Followers'), '1');
      assert.equal(metric('Members'), '0');
      assert.equal(metric('Published'), '1');
      assert.equal(metric('Drafts'), '1');
      assert.equal(metric('Reads'), '0');
      assert.equal(metric('Likes'), '0');
      assert.equal(metric('Comments'), '1');
      assert.equal(metric('Monthly value'), '€0');
    });

    it('says what is new in the last 30 days', async () => {
      const fake = owner();
      fake.db.follows.push({ user_id: IDS.fan2, creator_id: IDS.verne, created_at: '2026-10-01T09:00:00+00:00' });
      addMembers(fake, ['Recent Reader']);
      fake.db.memberships.at(-1).created_at = '2026-10-02T09:00:00+00:00';
      fake.refresh();
      await open(fake);
      const notes = rows('.studio-metric').map(node => node.querySelector('.studio-metric-note')?.textContent.trim());
      assert.ok(notes.includes('+1 followers in 30 days') || notes.includes('+2 followers in 30 days'), notes.join(' | '));
      assert.ok(notes.includes('+1 members in 30 days'));
    });

    it('shows the monthly value in the creator’s currency and says payments are not live', async () => {
      const fake = owner();
      addMembers(fake, ['A One', 'B Two'], { tier: 'premium' });
      await open(fake);
      assert.equal(metric('Members'), '2');
      assert.equal(metric('Monthly value'), '€38');
      assert.match(app.text('.studio-metrics'), /Once payments launch\. Joining is free during early access\./);
      assert.match(app.text('[data-region="stats"]'), /Payments are not live yet: joining is free during early access, so nothing is charged\./);
    });

    it('lists members by tier under the creator’s own tier names, with prices once payments launch', async () => {
      const fake = owner();
      addMembers(fake, ['A One', 'B Two', 'C Three'], { tier: i => (i === 0 ? 'essential' : 'signature') });
      await open(fake);
      const tiers = rows('.studio-tier').map(node => node.querySelector('.studio-tier-line').textContent.replace(/\s+/g, ' ').trim());
      assert.deepEqual(tiers, ['Reader1 member', 'Supporter0 members', 'Inner circle2 members']);
      assert.match(app.text('.studio-tiers'), /€9 a month once payments launch/);
      assert.equal(app.find('.studio-bar[data-share="67"]').style.getPropertyValue('--share'), '67%');
    });

    it('marks a tier that is closed', async () => {
      const fake = owner();
      fake.db.creator_tiers.find(row => row.creator_id === IDS.verne && row.tier_id === 'premium').enabled = false;
      await open(fake);
      assert.match(app.text('.studio-tier.is-closed'), /Supporter \(closed\)/);
    });

    it('lists the top posts with links', async () => {
      const fake = owner();
      entryRow(fake, E.firstDraftHabits).read_count = 40;
      await open(fake);
      const top = rows('.studio-top li a');
      assert.equal(top.length, 1);
      assert.equal(top[0].textContent.trim(), 'First draft habits');
      assert.equal(top[0].getAttribute('href'), `/app/p/${E.firstDraftHabits}`);
      assert.match(app.text('.studio-top'), /Text · 40 reads · 0 likes · 1 comment/);
    });

    it('invites the creator to publish when there are no top posts', async () => {
      const fake = createFakeApi({ signedIn: IDS.fan1 });
      await fake.createAtelier({ name: 'Fresh Start', category: 'Art' });
      await open(fake);
      assert.match(app.text('.studio-columns'), /appear here once you have published/);
      assert.equal(metric('Published'), '0');
      assert.equal(metric('Monthly value'), '€0');
    });

    it('escapes hostile titles and tier names', async () => {
      const fake = owner();
      entryRow(fake, E.firstDraftHabits).title = HOSTILE;
      fake.db.creator_tiers.find(row => row.creator_id === IDS.verne && row.tier_id === 'essential').name = HOSTILE;
      await open(fake);
      assert.equal(app.exists('#view img[onerror]'), false);
      assert.equal(app.find('.studio-top-title').textContent.trim(), HOSTILE);
      assert.ok(app.text('.studio-tiers').includes(HOSTILE));
    });

    it('shows an error with Retry, and the rest of the page keeps working', async () => {
      const fake = owner();
      fake.fail('creatorStats', 'The numbers are resting.');
      await open(fake);
      const box = app.find('[data-region="stats"] .error-state');
      assert.match(box.textContent, /We could not load your numbers/);
      assert.match(box.textContent, /The numbers are resting\./);
      assert.deepEqual(postTitles(), ['First draft habits'], 'the posts load on their own');
      fake.fail('creatorStats', null);
      await app.click('[data-region="stats"] [data-retry]');
      assert.equal(app.exists('[data-region="stats"] .error-state'), false);
      assert.equal(metric('Followers'), '1');
      assert.equal(callsTo(fake, 'creatorStats').length, 2);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('the tabs', () => {
    it('is a tablist whose tabs control one labelled panel', async () => {
      await open(owner());
      assert.equal(app.find('[role="tablist"]').getAttribute('aria-label'), 'Studio sections');
      assert.deepEqual(rows('[role="tab"]').map(node => node.dataset.tab), ['published', 'drafts', 'members', 'notes']);
      assert.deepEqual(rows('[role="tab"]').map(node => node.getAttribute('aria-selected')), ['true', 'false', 'false', 'false']);
      assert.deepEqual(rows('[role="tab"]').map(node => node.tabIndex), [0, -1, -1, -1]);
      const panel = app.find('[role="tabpanel"]');
      assert.equal(panel.getAttribute('aria-labelledby'), 'studio-tab-published');
      assert.ok(app.exists('#studio-tab-published'));
      assert.equal(app.find('[data-tab="members"]').getAttribute('aria-controls'), panel.id);
    });

    it('opens the tab named in the address', async () => {
      const fake = owner();
      await open(fake, '/app/studio?tab=drafts');
      assert.equal(tab('drafts').getAttribute('aria-selected'), 'true');
      assert.deepEqual(postTitles(), ['An essay still unfinished']);
      assert.equal(callsTo(fake, 'creatorEntries').length, 1, 'only the visible tab is fetched');
      assert.equal(callsTo(fake, 'creatorEntries')[0].args[1].status, 'draft');
    });

    it('treats an unknown tab as the first one', async () => {
      await open(owner(), '/app/studio?tab=nonsense');
      assert.equal(tab('published').getAttribute('aria-selected'), 'true');
    });

    it('switches in place, follows with the address, and loads each tab once', async () => {
      const fake = owner();
      await open(fake);
      await goTab('drafts');
      assert.equal(tab('drafts').getAttribute('aria-selected'), 'true');
      assert.equal(app.find('[role="tabpanel"]').getAttribute('aria-labelledby'), 'studio-tab-drafts');
      assert.equal(app.path, '/app/studio?tab=drafts');
      assert.deepEqual(postTitles(), ['An essay still unfinished']);
      await goTab('published');
      assert.equal(app.path, '/app/studio', 'the first tab has the plain address');
      await goTab('drafts');
      assert.equal(callsTo(fake, 'creatorEntries').length, 2, 'published once, drafts once');
    });

    it('is operated with the arrow keys, Home and End', async () => {
      await open(owner());
      await press('[data-tab="published"]', 'ArrowRight');
      assert.equal(tab('drafts').getAttribute('aria-selected'), 'true');
      assert.equal(app.document.activeElement, tab('drafts'));
      await press('[data-tab="drafts"]', 'End');
      assert.equal(tab('notes').getAttribute('aria-selected'), 'true');
      await press('[data-tab="notes"]', 'ArrowRight');
      assert.equal(tab('published').getAttribute('aria-selected'), 'true', 'wraps around');
      await press('[data-tab="published"]', 'ArrowLeft');
      assert.equal(tab('notes').getAttribute('aria-selected'), 'true');
      await press('[data-tab="notes"]', 'Home');
      assert.equal(tab('published').getAttribute('aria-selected'), 'true');
    });

    it('shows counts on the tabs once the numbers are known', async () => {
      const fake = owner();
      addMembers(fake, ['A One', 'B Two']);
      await open(fake);
      const count = name => app.text(`[data-tab-count="${name}"]`);
      assert.equal(count('published'), '1');
      assert.equal(count('drafts'), '1');
      assert.equal(count('members'), '2');
      assert.equal(count('notes'), '');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('published posts and drafts', () => {
    it('lists a published post with its kind, access, figures and actions', async () => {
      const fake = owner();
      const post = entryRow(fake, E.firstDraftHabits);
      post.read_count = 12;
      await open(fake);
      assert.deepEqual(postTitles(), ['First draft habits']);
      const row = app.find('.studio-entry');
      assert.equal(row.dataset.entryRow, E.firstDraftHabits);
      assert.match(row.textContent, /Essay/);
      assert.match(row.querySelector('.studio-entry-flags').textContent, /Text/);
      assert.match(row.querySelector('.studio-entry-meta').textContent, /Published 29 Sept/);
      assert.match(row.querySelector('.studio-entry-meta').textContent, /Open to everyone/);
      assert.match(row.querySelector('.studio-entry-meta').textContent, /12 reads · 0 likes · 1 comment/);
      assert.equal(row.querySelector('.studio-entry-title a').getAttribute('href'), `/app/p/${E.firstDraftHabits}`);
      const edit = row.querySelector(`.studio-entry-actions a[href="/app/studio/edit/${E.firstDraftHabits}"]`);
      assert.equal(edit.textContent.trim(), 'Edit');
      assert.equal(edit.getAttribute('aria-label'), 'Edit First draft habits');
      assert.equal(row.querySelector('.studio-entry-actions a[aria-label="View First draft habits"]').getAttribute('href'), `/app/p/${E.firstDraftHabits}`);
      assert.equal(row.querySelector('.studio-delete').getAttribute('aria-label'), 'Delete First draft habits');
      assert.match(app.text('.studio-list-foot'), /1 post shown\. That is everything\./);
      assert.equal(row.querySelector('img').getAttribute('alt'), '', 'the thumbnail is decoration next to the title');
      assert.ok(row.querySelector('img').getAttribute('src'), 'an editorial preset stands in for a text post');
    });

    it('opens the editor from Edit', async () => {
      await open(owner());
      await app.click('.studio-entry-actions a[aria-label^="Edit"]');
      assert.equal(app.path, `/app/studio/edit/${E.firstDraftHabits}`);
    });

    it('names a draft as a draft, in the creator’s own tier name, with Preview', async () => {
      await open(owner(), '/app/studio?tab=drafts');
      const row = app.find('.studio-entry');
      assert.match(row.querySelector('.studio-entry-flags').textContent, /Draft/);
      assert.match(row.querySelector('.studio-entry-meta').textContent, /Edited/);
      assert.match(row.querySelector('.studio-entry-meta').textContent, /Reader and above/, 'essential is called Reader by this atelier');
      assert.equal(row.querySelector('.studio-entry-meta').textContent.includes('reads'), false, 'a draft has no figures');
      assert.equal(row.querySelector('.studio-entry-actions a[aria-label^="Preview"]').textContent.trim(), 'Preview');
    });

    it('draws image and video posts with their kind', async () => {
      const fake = owner();
      addPosts(fake, 2);
      entryRow(fake, '3b000000-0000-4000-8000-000000000001').kind = 'image';
      entryRow(fake, '3b000000-0000-4000-8000-000000000002').kind = 'video';
      await open(fake);
      const flags = rows('.studio-entry').map(node => node.querySelector('.studio-entry-flags').textContent.trim());
      assert.ok(flags.includes('Image'));
      assert.ok(flags.includes('Video'));
    });

    it('shows an empty state with a next step when nothing is published', async () => {
      const fake = createFakeApi({ signedIn: IDS.fan1 });
      await fake.createAtelier({ name: 'Fresh Start', category: 'Art' });
      await open(fake);
      assert.match(app.text('.empty h3'), /Nothing published yet/);
      assert.equal(app.find('.empty a.button').getAttribute('href'), '/app/studio/new?kind=text');
      await goTab('drafts');
      assert.match(app.text('.empty h3'), /No drafts/);
      assert.match(app.text('.empty p'), /only visible to you/);
      assert.equal(app.find('.empty a.button').getAttribute('href'), '/app/studio/new?kind=text');
    });

    it('shows a skeleton while loading', async () => {
      const fake = owner();
      const release = hold(fake, 'creatorEntries');
      await open(fake);
      assert.ok(app.exists('[data-region="results"] .skeleton'));
      release();
      await app.settle();
      assert.equal(app.exists('[data-region="results"] .skeleton'), false);
      assert.equal(postTitles().length, 1);
    });

    it('shows an error with Retry and recovers', async () => {
      const fake = owner();
      fake.fail('creatorEntries', 'Your posts are resting.');
      await open(fake);
      assert.match(app.text('[data-region="results"] .error-state'), /We could not load your posts/);
      assert.match(app.text('[data-region="results"] .error-state'), /Your posts are resting\./);
      fake.fail('creatorEntries', null);
      await app.click('[data-region="results"] [data-retry]');
      assert.deepEqual(postTitles(), ['First draft habits']);
    });

    it('has its own error for drafts', async () => {
      const fake = owner();
      fake.fail('creatorEntries', 'No drafts today.');
      await open(fake, '/app/studio?tab=drafts');
      assert.match(app.text('[data-region="results"] .error-state'), /We could not load your drafts/);
    });

    it('pages a long list: twelve at a time, newest first, with Load more', async () => {
      const fake = owner();
      addPosts(fake, 30);
      await open(fake);
      assert.equal(postTitles().length, 12);
      assert.equal(postTitles()[0], 'First draft habits');
      assert.match(app.text('.studio-list-foot'), /12 posts shown$/);
      await app.click('[data-more-entries="published"]');
      assert.equal(postTitles().length, 24);
      await app.click('[data-more-entries="published"]');
      assert.equal(postTitles().length, 31);
      assert.equal(new Set(postTitles()).size, 31, 'no post twice');
      assert.equal(app.exists('[data-more-entries]'), false);
      assert.match(app.text('.studio-list-foot'), /31 posts shown\. That is everything\./);
      const cursors = callsTo(fake, 'creatorEntries').map(call => call.args[1].cursor);
      assert.equal(cursors[0], undefined);
      assert.ok(cursors[1] && cursors[2]);
    });

    it('keeps the posts and offers another try when a further page fails', async () => {
      const fake = owner();
      addPosts(fake, 20);
      await open(fake);
      fake.fail('creatorEntries', 'The next page is resting.');
      await app.click('[data-more-entries="published"]');
      assert.equal(postTitles().length, 12, 'what was loaded stays');
      assert.match(app.text('[data-region="results"] .field-error'), /The next page is resting\./);
      assert.equal(app.find('[data-more-entries]').textContent.trim(), 'Try again');
      fake.fail('creatorEntries', null);
      await app.click('[data-more-entries="published"]');
      assert.equal(postTitles().length, 21);
      assert.equal(app.exists('[data-region="results"] .field-error'), false);
    });

    it('pages drafts too', async () => {
      const fake = owner();
      addPosts(fake, 14, { status: 'draft' });
      await open(fake, '/app/studio?tab=drafts');
      assert.equal(postTitles().length, 12);
      await app.click('[data-more-entries="drafts"]');
      assert.equal(postTitles().length, 15);
    });

    it('escapes hostile titles, in the link, the button names and the dialog', async () => {
      const fake = owner();
      entryRow(fake, E.firstDraftHabits).title = HOSTILE;
      await open(fake);
      assert.equal(app.exists('#view img[onerror]'), false);
      assert.equal(app.find('.studio-entry-title').textContent.trim(), HOSTILE);
      assert.equal(app.find('.studio-delete').getAttribute('aria-label'), `Delete ${HOSTILE}`);
      await app.click('.studio-delete');
      assert.equal(app.exists('#modal img[onerror]'), false);
      assert.ok(app.text('#modal').includes(HOSTILE));
      await app.click('#modal [data-confirm="no"]');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('deleting a post', () => {
    it('asks first, and does nothing when the answer is no', async () => {
      const fake = owner();
      await open(fake);
      await app.click('.studio-delete');
      assert.ok(dialogOpen());
      assert.match(app.text('#modal'), /Delete this post\?/);
      assert.match(app.text('#modal'), /“First draft habits” and its media will be removed for good/);
      assert.match(app.text('#modal'), /This cannot be undone\./);
      await app.click('#modal [data-confirm="no"]');
      assert.equal(callsTo(fake, 'deleteEntry').length, 0);
      assert.deepEqual(postTitles(), ['First draft habits']);
    });

    it('removes the post, updates the numbers and the store, and says so', async () => {
      const fake = owner();
      await open(fake);
      assert.equal(app.store.state.myCreator.entryCount, 1);
      await app.click('.studio-delete');
      await app.click('#modal [data-confirm="yes"]');
      await app.settle();
      assert.deepEqual(callsTo(fake, 'deleteEntry').map(call => call.args[0]), [E.firstDraftHabits]);
      assert.equal(entryRow(fake, E.firstDraftHabits), undefined);
      assert.deepEqual(postTitles(), []);
      assert.match(app.text('.empty h3'), /Nothing published yet/);
      assert.match(toastText(), /Post deleted\./);
      assert.equal(metric('Published'), '0');
      assert.equal(app.text('[data-tab-count="published"]'), '0');
      assert.equal(app.store.state.myCreator.entryCount, 0);
      assert.equal(app.document.activeElement?.id, 'studio-panel', 'focus returns to the panel, not to a removed button');
      assert.match(app.text('[data-region="announce"]'), /Post deleted\./);
    });

    it('deletes a draft with its own words and numbers', async () => {
      const fake = owner();
      await open(fake, '/app/studio?tab=drafts');
      await app.click('.studio-delete');
      assert.match(app.text('#modal'), /Delete this draft\?/);
      assert.equal(app.text('#modal').includes('Members will no longer be able to read it'), false);
      assert.equal(app.find('#modal [data-confirm="yes"]').textContent.trim(), 'Delete draft');
      await app.click('#modal [data-confirm="yes"]');
      await app.settle();
      assert.deepEqual(postTitles(), []);
      assert.match(toastText(), /Draft deleted\./);
      assert.equal(metric('Drafts'), '0');
      assert.equal(app.store.state.myCreator.entryCount, 1, 'drafts are not counted in the atelier');
    });

    it('keeps the post and says why when deleting fails', async () => {
      const fake = owner();
      await open(fake);
      fake.fail('deleteEntry', 'The post could not be deleted just now.');
      await app.click('.studio-delete');
      await app.click('#modal [data-confirm="yes"]');
      await app.settle();
      assert.deepEqual(postTitles(), ['First draft habits']);
      assert.match(toastText(), /could not be deleted just now/);
      assert.equal(app.find('.studio-delete').disabled, false, 'the button is usable again');
      assert.equal(app.store.state.myCreator.entryCount, 1);
    });

    it('brings in the next page when the last visible post of a page is deleted', async () => {
      const fake = owner();
      addPosts(fake, 12);
      await open(fake);
      assert.equal(postTitles().length, 12);
      for (let i = 0; i < 12; i++) {
        await app.click('.studio-delete');
        await app.click('#modal [data-confirm="yes"]');
        await app.settle();
      }
      assert.equal(postTitles().length, 1, 'the thirteenth post is shown, not an empty state');
      assert.equal(app.exists('.empty'), false);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('the circle', () => {
    it('shows an empty state for a circle that is forming', async () => {
      await open(owner(), '/app/studio?tab=members');
      assert.match(app.text('.empty h3'), /Your circle is forming/);
      assert.match(app.text('.empty p'), /Joining is free during early access/);
      assert.equal(app.find('.empty a.button').getAttribute('href'), '/app/c/verne-and-co');
      assert.equal(app.find('[data-export-members]').disabled, true, 'nothing to export');
    });

    it('lists each member with a name, tier and join date, newest first', async () => {
      const fake = owner();
      addMembers(fake, ['Ada Lindgren', 'Tomas Reyes', 'Noor Haddad'], { tier: i => ['essential', 'premium', 'signature'][i] });
      await open(fake, '/app/studio?tab=members');
      const members = rows('.studio-member').map(node => [node.querySelector('strong').textContent, node.querySelector('.badge').textContent, node.querySelector('span.muted').textContent]);
      assert.deepEqual(members, [['Noor Haddad', 'Inner circle', 'Joined 1 Sept'], ['Tomas Reyes', 'Supporter', 'Joined 1 Sept'], ['Ada Lindgren', 'Reader', 'Joined 1 Sept']]);
      assert.ok(app.exists('.studio-member .avatar'));
      assert.match(app.text('.studio-list-foot'), /3 members/);
    });

    it('filters by name as the person types, without redrawing the search box', async () => {
      const fake = owner();
      addMembers(fake, ['Ada Lindgren', 'Tomas Reyes', 'Adriana Costa']);
      await open(fake, '/app/studio?tab=members');
      const box = app.find('#studio-member-search');
      box.focus();
      await type('#studio-member-search', 'ad');
      assert.deepEqual(rows('.studio-member strong').map(node => node.textContent).sort(), ['Ada Lindgren', 'Adriana Costa']);
      assert.equal(app.find('#studio-member-search'), box, 'the same field stays on the page');
      assert.match(app.text('.studio-list-foot'), /2 members of 3 in your circle/);
      assert.match(app.text('[data-region="announce"]'), /2 members shown\./);
      await type('#studio-member-search', 'ADA L');
      assert.deepEqual(rows('.studio-member strong').map(node => node.textContent), ['Ada Lindgren']);
    });

    it('says when no one matches and when the search is cleared brings them back', async () => {
      const fake = owner();
      addMembers(fake, ['Ada Lindgren']);
      await open(fake, '/app/studio?tab=members');
      await type('#studio-member-search', 'zzz');
      assert.match(app.text('.empty h3'), /No one matches/);
      assert.match(app.text('[data-region="announce"]'), /No members match\./);
      await type('#studio-member-search', '');
      assert.equal(rows('.studio-member').length, 1);
    });

    it('filters by tier, listing only the tiers that have members', async () => {
      const fake = owner();
      addMembers(fake, ['Ada Lindgren', 'Tomas Reyes', 'Noor Haddad'], { tier: i => (i === 2 ? 'signature' : 'essential') });
      await open(fake, '/app/studio?tab=members');
      const options = [...app.find('#studio-member-tier').querySelectorAll('option')].map(option => [option.value, option.textContent]);
      assert.deepEqual(options, [['', 'All tiers'], ['essential', 'Reader'], ['signature', 'Inner circle']]);
      await choose('#studio-member-tier', 'signature');
      assert.deepEqual(rows('.studio-member strong').map(node => node.textContent), ['Noor Haddad']);
      await type('#studio-member-search', 'ada');
      assert.match(app.text('.empty h3'), /No one matches/, 'both filters apply');
    });

    it('shows twenty-five at a time with Show more, and keeps the filter on the whole circle', async () => {
      const fake = owner();
      addMembers(fake, Array.from({ length: 60 }, (_, i) => `Reader ${String(i + 1).padStart(2, '0')}`));
      await open(fake, '/app/studio?tab=members');
      assert.equal(rows('.studio-member').length, 25);
      assert.match(app.text('.studio-list-foot'), /Showing 25 of 60 members/);
      await app.click('[data-more-members]');
      assert.equal(rows('.studio-member').length, 50);
      await app.click('[data-more-members]');
      assert.equal(rows('.studio-member').length, 60);
      assert.equal(app.exists('[data-more-members]'), false);
      await type('#studio-member-search', 'Reader 5');
      assert.equal(rows('.studio-member').length, 10, 'Reader 50 to 59 are found beyond the first page');
      assert.equal(callsTo(fake, 'circleMembers').length, 1, 'the circle is fetched once');
    });

    it('shows an error with Retry', async () => {
      const fake = owner();
      fake.fail('circleMembers', 'The circle is resting.');
      await open(fake, '/app/studio?tab=members');
      assert.match(app.text('[data-region="results"] .error-state'), /We could not load your circle/);
      assert.match(app.text('[data-region="results"] .error-state'), /The circle is resting\./);
      assert.equal(app.find('[data-export-members]').disabled, true);
      fake.fail('circleMembers', null);
      addMembers(fake, ['Ada Lindgren']);
      await app.click('[data-region="results"] [data-retry]');
      assert.deepEqual(rows('.studio-member strong').map(node => node.textContent), ['Ada Lindgren']);
      assert.equal(app.find('[data-export-members]').disabled, false, 'export is available once the circle is here');
    });

    it('escapes hostile member names', async () => {
      const fake = owner();
      addMembers(fake, [HOSTILE]);
      await open(fake, '/app/studio?tab=members');
      assert.equal(app.exists('#view img[onerror]'), false);
      assert.equal(app.find('.studio-member strong').textContent, HOSTILE);
    });

    it('is loaded only when its tab is opened', async () => {
      const fake = owner();
      await open(fake);
      assert.equal(callsTo(fake, 'circleMembers').length, 0);
      await goTab('members');
      assert.equal(callsTo(fake, 'circleMembers').length, 1);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('exporting the circle', () => {
    it('downloads every member as CSV, whatever the filter, with a dated name', async () => {
      const fake = owner();
      addMembers(fake, ['Ada Lindgren', 'Tomas Reyes'], { tier: i => (i === 0 ? 'essential' : 'premium') });
      await open(fake, '/app/studio?tab=members');
      const { files, names } = captureDownloads();
      await type('#studio-member-search', 'ada');
      await app.click('[data-export-members]');
      assert.equal(files.length, 1);
      assert.match(files[0].type, /^text\/csv/);
      assert.equal(names.length, 1);
      assert.match(names[0], /^refluenz-circle-verne-and-co-\d{4}-\d\d-\d\d\.csv$/);
      const bytes = new Uint8Array(await files[0].arrayBuffer());
      assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'a byte order mark so spreadsheets read accents');
      assert.equal(await files[0].text(), '"Name","Tier","Joined"\r\n"Tomas Reyes","Supporter","2026-09-01"\r\n"Ada Lindgren","Reader","2026-09-01"\r\n');
      assert.match(toastText(), /Exported 2 members\./);
    });

    it('defuses cells that a spreadsheet would run as formulas', async () => {
      const fake = owner();
      addMembers(fake, ['=HYPERLINK("http://evil.test","x")', '+1+1', '-2+3', '@SUM(A1)', '  =padded', 'Ada, "the" Reader']);
      await open(fake, '/app/studio?tab=members');
      const { files } = captureDownloads();
      await app.click('[data-export-members]');
      const lines = parseCsv(await files[0].text()).slice(1).map(row => row[0]);
      assert.deepEqual(lines.sort(), [
        '\'  =padded', '\'+1+1', '\'-2+3', '\'=HYPERLINK("http://evil.test","x")', '\'@SUM(A1)', 'Ada, "the" Reader'
      ].sort());
      for (const line of lines) assert.equal(/^[=+\-@]/.test(line), false, `"${line}" does not start a formula`);
    });

    it('keeps names with line breaks on one row', () => {
      assert.equal(csvCell('Line\nBreak\r\nHere'), '"Line Break Here"');
      assert.equal(csvCell(null), '""');
      assert.equal(csvCell('\t=x'), '"\'\t=x"');
      assert.equal(membersCsv([{ member: { name: 'A\nB' }, tier: { name: 'Reader' }, joinedAt: 'not a date' }]), '"Name","Tier","Joined"\r\n"A B","Reader",""\r\n');
      assert.match(csvFilename('Odd/Slug ../', new Date('2026-10-07T10:00:00Z')), /^refluenz-circle-OddSlug-2026-10-07\.csv$/);
      assert.equal(csvFilename('', new Date('2026-10-07T10:00:00Z')), 'refluenz-circle-atelier-2026-10-07.csv');
    });

    it('says so when the file cannot be created', async () => {
      const fake = owner();
      addMembers(fake, ['Ada Lindgren']);
      await open(fake, '/app/studio?tab=members');
      const original = URL.createObjectURL;
      URL.createObjectURL = () => { throw new Error('no blobs'); };
      restore = () => { URL.createObjectURL = original; };
      await app.click('[data-export-members]');
      assert.match(toastText(), /We could not create the file\. Try again\./);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('notes to the circle', () => {
    const openNotes = (fake = owner()) => open(fake, '/app/studio?tab=notes');
    const note = (text, fake) => type('#studio-note-text', text);

    it('shows the form and the existing notes', async () => {
      await openNotes();
      assert.ok(app.exists('#studio-note-text'));
      assert.ok(app.exists('label[for="studio-note-text"]'));
      assert.equal(app.find('#studio-note-text').getAttribute('maxlength'), '2000');
      assert.equal(app.text('[data-note-count]'), '0 / 2,000');
      assert.deepEqual(rows('.studio-note-text').map(node => node.textContent), ['Welcome to the circle. New essays arrive on Mondays.']);
      assert.match(app.text('.studio-note-form'), /Followers and members are notified when you post one\./);
      assert.equal(app.find('[data-delete-note]').getAttribute('aria-label'), 'Delete note from 10 Aug');
    });

    it('counts characters as the person types', async () => {
      await openNotes();
      await note('Hello circle');
      assert.equal(app.text('[data-note-count]'), '12 / 2,000');
    });

    it('posts a note: trimmed, first in the list, field cleared, with a message', async () => {
      const fake = owner();
      await openNotes(fake);
      await note('  A new rule for Mondays.  ');
      await app.submit('[data-note-form]');
      assert.deepEqual(callsTo(fake, 'postNote').map(call => call.args), [[IDS.verne, 'A new rule for Mondays.']]);
      assert.deepEqual(rows('.studio-note-text').map(node => node.textContent), ['A new rule for Mondays.', 'Welcome to the circle. New essays arrive on Mondays.']);
      assert.equal(app.find('#studio-note-text').value, '');
      assert.equal(app.text('[data-note-count]'), '0 / 2,000');
      assert.match(toastText(), /Note posted\. Your circle has been told\./);
      assert.match(app.text('[data-region="announce"]'), /Note posted\./);
      assert.equal(app.find('[data-note-submit]').disabled, false);
      assert.equal(fake.db.circle_notes.length, 2);
    });

    it('refuses an empty note without asking the server', async () => {
      const fake = owner();
      await openNotes(fake);
      await note('   ');
      await app.submit('[data-note-form]');
      assert.equal(callsTo(fake, 'postNote').length, 0);
      assert.match(app.text('[data-note-error]'), /The note cannot be empty\./);
      assert.equal(app.find('#studio-note-text').getAttribute('aria-invalid'), 'true');
      await note('now something');
      assert.equal(app.text('[data-note-error]'), '', 'typing clears the message');
      assert.equal(app.find('#studio-note-text').getAttribute('aria-invalid'), null);
    });

    it('refuses a note over 2,000 characters and keeps the text', async () => {
      const fake = owner();
      await openNotes(fake);
      const long = 'x'.repeat(2001);
      await note(long);
      await app.submit('[data-note-form]');
      assert.equal(callsTo(fake, 'postNote').length, 0);
      assert.match(app.text('[data-note-error]'), /at most 2,000 characters/);
      assert.equal(app.find('#studio-note-text').value, long);
    });

    it('accepts a note of exactly 2,000 characters', async () => {
      const fake = owner();
      await openNotes(fake);
      await note('y'.repeat(2000));
      await app.submit('[data-note-form]');
      assert.equal(callsTo(fake, 'postNote').length, 1);
      assert.equal(rows('.studio-note').length, 2);
    });

    it('never loses the text when posting fails', async () => {
      const fake = owner();
      await openNotes(fake);
      await note('Words that must survive.');
      fake.fail('postNote', 'The note could not be posted.');
      await app.submit('[data-note-form]');
      assert.equal(app.find('#studio-note-text').value, 'Words that must survive.');
      assert.match(app.text('[data-note-error]'), /The note could not be posted\./);
      assert.match(toastText(), /The note could not be posted\./);
      assert.equal(app.find('[data-note-submit]').disabled, false);
      assert.equal(rows('.studio-note').length, 1);
      fake.fail('postNote', null);
      await app.submit('[data-note-form]');
      assert.equal(rows('.studio-note').length, 2, 'and it can be sent again');
      assert.equal(app.text('[data-note-error]'), '');
    });

    it('does not post twice while the request is running', async () => {
      const fake = owner();
      await openNotes(fake);
      await note('Only once.');
      const release = hold(fake, 'postNote');
      const form = app.find('[data-note-form]');
      form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
      await tick(5);
      assert.equal(app.find('[data-note-submit]').disabled, true);
      assert.equal(app.find('[data-note-submit]').getAttribute('aria-busy'), 'true');
      release();
      await app.settle();
      assert.equal(callsTo(fake, 'postNote').length, 1);
    });

    it('asks before leaving with a note that was not posted', async () => {
      await openNotes();
      assert.equal(app.router.block(), null);
      await note('Half a thought');
      assert.match(app.router.block(), /not posted yet/);
      await app.submit('[data-note-form]');
      assert.equal(app.router.block(), null);
    });

    it('keeps a typed note when switching tabs', async () => {
      await openNotes();
      await note('Still here');
      await goTab('members');
      await goTab('notes');
      assert.equal(app.find('#studio-note-text').value, 'Still here');
      assert.equal(app.text('[data-note-count]'), '10 / 2,000');
    });

    it('deletes a note after asking, and keeps it when the answer is no', async () => {
      const fake = owner();
      await openNotes(fake);
      await app.click('[data-delete-note]');
      assert.match(app.text('#modal'), /Delete this note\?/);
      await app.click('#modal [data-confirm="no"]');
      assert.equal(callsTo(fake, 'deleteNote').length, 0);
      assert.equal(rows('.studio-note').length, 1);
      await app.click('[data-delete-note]');
      await app.click('#modal [data-confirm="yes"]');
      await app.settle();
      assert.deepEqual(callsTo(fake, 'deleteNote').map(call => call.args[0]), [IDS.notes.welcome]);
      assert.equal(rows('.studio-note').length, 0);
      assert.match(app.text('.empty h3'), /No notes yet/);
      assert.match(toastText(), /Note deleted\./);
      assert.equal(app.document.activeElement?.id, 'studio-panel');
    });

    it('keeps the note and says why when deleting fails', async () => {
      const fake = owner();
      await openNotes(fake);
      fake.fail('deleteNote', 'The note is stuck.');
      await app.click('[data-delete-note]');
      await app.click('#modal [data-confirm="yes"]');
      await app.settle();
      assert.equal(rows('.studio-note').length, 1);
      assert.match(toastText(), /The note is stuck\./);
      assert.equal(app.find('[data-delete-note]').disabled, false);
    });

    it('shows an empty state before the first note', async () => {
      const fake = owner();
      fake.db.circle_notes = [];
      await openNotes(fake);
      assert.match(app.text('.empty h3'), /No notes yet/);
      assert.match(app.text('.empty p'), /Write one above/);
      await note('First!');
      await app.submit('[data-note-form]');
      assert.equal(rows('.studio-note').length, 1);
      assert.equal(app.exists('.empty'), false);
    });

    it('pages a long list ten at a time', async () => {
      const fake = owner();
      addNotes(fake, 24);
      await openNotes(fake);
      assert.equal(rows('.studio-note').length, 10);
      assert.equal(app.find('.studio-note-text').textContent, 'Note number 24', 'newest first');
      assert.match(app.text('.studio-list-foot'), /Showing 10 of 25 notes/);
      await app.click('[data-more-notes]');
      assert.equal(rows('.studio-note').length, 20);
      await app.click('[data-more-notes]');
      assert.equal(rows('.studio-note').length, 25);
      assert.equal(app.exists('[data-more-notes]'), false);
    });

    it('shows an error with Retry', async () => {
      const fake = owner();
      fake.fail('listNotes', 'The notes are resting.');
      await openNotes(fake);
      assert.match(app.text('[data-region="results"] .error-state'), /We could not load your notes/);
      assert.ok(app.exists('#studio-note-text'), 'the form is still there');
      fake.fail('listNotes', null);
      await app.click('[data-region="results"] [data-retry]');
      assert.equal(rows('.studio-note').length, 1);
    });

    it('keeps a note posted while the list was still loading', async () => {
      const fake = owner();
      const release = hold(fake, 'listNotes');
      await openNotes(fake);
      assert.ok(app.exists('[data-region="results"] .skeleton'));
      await note('Posted early');
      await app.submit('[data-note-form]');
      release();
      await app.settle();
      assert.equal(rows('.studio-note-text').filter(node => node.textContent === 'Posted early').length, 1);
      assert.equal(rows('.studio-note').length, 2);
    });

    it('escapes hostile notes and keeps their line breaks as text', async () => {
      const fake = owner();
      fake.db.circle_notes[0].body = `${HOSTILE}\nsecond line`;
      await openNotes(fake);
      assert.equal(app.exists('#view img[onerror]'), false);
      assert.equal(app.find('.studio-note-text').textContent, `${HOSTILE}\nsecond line`);
      await note(HOSTILE);
      await app.submit('[data-note-form]');
      assert.equal(app.exists('#view img[onerror]'), false);
      assert.equal(rows('.studio-note-text')[0].textContent, HOSTILE);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('live updates and leaving the page', () => {
    const membership = fake => ({ id: '8b000000-0000-4000-8000-000000000001', user_id: IDS.owner, type: 'membership', actor_id: IDS.fan2, creator_id: IDS.verne, entry_id: null, comment_id: null, read_at: null, created_at: '2026-10-07T09:30:00+00:00' });

    it('refreshes the numbers and the circle when someone joins', async () => {
      const fake = owner();
      await open(fake, '/app/studio?tab=members');
      assert.equal(metric('Members'), '0');
      addMembers(fake, ['Newly Joined']);
      fake.emit(IDS.owner, 'notification', membership(fake));
      await tick(750);
      await app.settle();
      assert.equal(metric('Members'), '1');
      assert.deepEqual(rows('.studio-member strong').map(node => node.textContent), ['Newly Joined']);
      assert.equal(callsTo(fake, 'creatorStats').length, 2);
      assert.equal(callsTo(fake, 'circleMembers').length, 2);
    });

    it('asks once for a burst of events, and ignores those that do not change the studio', async () => {
      const fake = owner();
      await open(fake);
      const before = callsTo(fake, 'creatorStats').length;
      fake.emit(IDS.owner, 'notification', { ...membership(fake), type: 'message' });
      fake.emit(IDS.owner, 'notification', { ...membership(fake), type: 'membership', creator_id: IDS.solene });
      await tick(750);
      assert.equal(callsTo(fake, 'creatorStats').length, before, 'a message or another atelier changes nothing here');
      fake.emit(IDS.owner, 'notification', { ...membership(fake), type: 'like' });
      fake.emit(IDS.owner, 'notification', { ...membership(fake), type: 'follow' });
      fake.emit(IDS.owner, 'notification', { ...membership(fake), type: 'comment' });
      await tick(750);
      assert.equal(callsTo(fake, 'creatorStats').length, before + 1);
    });

    it('keeps the numbers on screen when a refresh fails', async () => {
      const fake = owner();
      await open(fake);
      fake.fail('creatorStats', 'Resting.');
      fake.emit(IDS.owner, 'notification', { ...membership(fake), type: 'like' });
      await tick(750);
      await app.settle();
      assert.equal(app.exists('[data-region="stats"] .error-state'), false);
      assert.equal(metric('Followers'), '1');
    });

    it('stops reacting once the person has left, even when answers arrive late', async () => {
      const fake = owner();
      const release = hold(fake, 'creatorStats');
      await open(fake);
      await app.navigate('/app/library');
      release();
      await app.settle();
      assert.equal(app.exists('.studio'), false);
      const studio = () => fake.calls.filter(call => ['creatorStats', 'circleMembers', 'creatorEntries', 'listNotes'].includes(call.method)).length;
      const before = studio();
      fake.emit(IDS.owner, 'notification', membership(fake));
      await tick(750);
      assert.equal(studio(), before, 'no studio request after leaving');
      assert.equal(app.router.block, null);
    });

    it('does not mix up pages when a tab is left while its list is loading', async () => {
      const fake = owner();
      await open(fake);
      const release = hold(fake, 'circleMembers');
      addMembers(fake, ['Late Arrival']);
      await goTab('members');
      await goTab('notes');
      release();
      await app.settle();
      assert.equal(tab('notes').getAttribute('aria-selected'), 'true');
      assert.equal(rows('.studio-member').length, 0, 'the circle is not painted into the notes tab');
      assert.equal(rows('.studio-note').length, 1);
      await goTab('members');
      assert.deepEqual(rows('.studio-member strong').map(node => node.textContent), ['Late Arrival']);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('a store that had trouble loading the viewer', () => {
    it('reads the viewer again before deciding that there is no atelier', async () => {
      const fake = owner();
      const real = fake.loadViewer.bind(fake);
      let attempts = 0;
      fake.loadViewer = async () => { if (++attempts === 1) throw Error('The viewer is resting.'); return real(); };
      await open(fake);
      assert.equal(app.text('#view h1'), 'Verne & Co');
    });
  });
});
