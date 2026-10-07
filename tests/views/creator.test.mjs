// The atelier page (/app/c/:slug), its join and report dialogs, and the memberships page (/app/memberships).
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom, mountApp, tick, IntersectionObserverStub } from '../helpers/dom.mjs';
import { createFakeApi, IDS } from '../helpers/fake-api.mjs';

const E = IDS.entries;
const HOSTILE = '<img src=x onerror=alert(1)>';
const guest = () => createFakeApi({ signedIn: null });
const member = () => createFakeApi();
const owner = () => createFakeApi({ signedIn: IDS.owner });
const callsTo = (fake, method) => fake.calls.filter(call => call.method === method);
const creatorRow = (fake, id) => fake.db.creators.find(row => row.id === id);
const tierRow = (fake, creatorId, tierId) => fake.db.creator_tiers.find(row => row.creator_id === creatorId && row.tier_id === tierId);

// Extra published posts for an atelier, newest first, so a page of 12 has a next page.
function addPosts(fake, creatorId, count, { kind = 'text', access = 'public' } = {}) {
  const source = fake.db.entries.find(row => row.creator_id === creatorId && row.status === 'published');
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.parse('2026-09-15T08:00:00Z') - i * 3_600_000).toISOString();
    fake.db.entries.push({ ...source, id: `3a000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title: `Extra post ${i + 1}`, kind, access, published_at: at, created_at: at, updated_at: at, media_count: 0, preview_path: null, duration_seconds: null });
  }
  fake.refresh();
}

// More circles for the seeded member, each at its own atelier (the api returns the whole list).
function addMemberships(fake, count) {
  for (let i = 0; i < count; i++) {
    const id = `2a000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const at = new Date(Date.parse('2026-07-01T08:00:00Z') + i * 3_600_000).toISOString();
    const base = creatorRow(fake, IDS.verano);
    fake.db.creators.push({ ...base, id, slug: `extra-atelier-${i + 1}`, name: `Extra Atelier ${i + 1}`, created_at: at });
    for (const tier of fake.db.creator_tiers.filter(row => row.creator_id === IDS.verano)) fake.db.creator_tiers.push({ ...tier, creator_id: id });
    fake.db.memberships.push({ user_id: IDS.member, creator_id: id, tier: 'essential', created_at: at, updated_at: at });
  }
  fake.refresh();
}

describe('creator and memberships views', () => {
  before(() => installDom());
  after(() => uninstallDom());

  let app;
  const open = async (api, path) => { app = await mountApp({ api, path }); return app; };
  afterEach(async () => { await app?.destroy(); app = null; });

  const cards = () => [...app.document.querySelectorAll('#view [data-entry]')];
  const titles = () => cards().map(card => card.querySelector('.entry-title').textContent.trim());
  const dialog = () => app.find('#modal');
  const dialogOpen = () => app.exists('#modal') && app.find('#modal').open;
  const toastText = () => app.exists('#toast') ? app.text('#toast') : '';
  const stat = key => app.find(`[data-stat="${key}"]`).textContent.trim();
  // Picks a tier in the join dialog the way the browser reports it: the radio is checked and a change event bubbles.
  const choose = async value => {
    for (const other of app.document.querySelectorAll('#join-form input[name="tier"]')) other.checked = other.value === value;
    const radio = app.find(`#join-form input[value="${value}"]`);
    radio.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    await app.settle();
  };
  const press = async (selector, key) => {
    app.find(selector).dispatchEvent(new app.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await app.settle();
  };

  describe('the atelier page as a guest', () => {
    it('draws the header, the counts and the posts of a showcase atelier', async () => {
      await open(guest(), '/app/c/atelier-solene');
      assert.equal(app.text('#view h1'), 'Atelier Solene');
      assert.equal(app.document.title, 'Atelier Solene — REFLUENZ');
      assert.match(app.text('.atelier-eyebrow'), /Style · Lyon, France/);
      assert.match(app.text('.atelier-eyebrow'), /Showcase/);
      assert.match(app.text('.atelier-descriptor'), /Tailoring & wardrobe/);
      assert.match(app.text('.atelier-bio'), /Considered clothes/);
      assert.equal(stat('followers'), '1');
      assert.equal(stat('members'), '2');
      assert.equal(stat('posts'), '5');
      assert.ok(app.exists('.atelier-banner.is-preset img[src="/editorial/v1/atelier.jpg"]'), 'an editorial preset stands in for the banner');
      assert.equal(app.find('.atelier-actions [data-follow]').getAttribute('aria-pressed'), 'false');
      assert.match(app.text('.atelier-state'), /Joining is free during early access/);
      assert.equal(cards().length, 5);
      assert.equal(app.find('#view').querySelectorAll('.is-locked').length, 3, 'essential, premium and signature posts are locked for a guest');
      assert.match(app.text('.atelier-lock-note'), /3 posts here are for circle members\. Joining is free during early access\./);
    });

    it('has landmarks, labelled tabs and no message button on a showcase atelier', async () => {
      await open(guest(), '/app/c/atelier-solene');
      assert.equal(app.find('#view section').getAttribute('aria-labelledby'), 'atelier-name');
      assert.equal(app.find('#atelier-name').tagName, 'H1');
      assert.equal(app.find('[role="tablist"]').getAttribute('aria-label'), 'Atelier sections');
      assert.deepEqual([...app.document.querySelectorAll('[role="tab"]')].map(tab => tab.getAttribute('aria-selected')), ['true', 'false', 'false']);
      assert.equal(app.find('#atelier-panel-membership').hidden, true);
      assert.ok(!app.exists('[data-action="message"]'));
      assert.ok(app.exists('.atelier-filters [aria-pressed="true"][data-kind=""]'));
    });

    it('asks a guest to sign in before joining, following, messaging or reporting', async () => {
      await open(guest(), '/app/c/verne-and-co');
      await app.click('[data-action="join"]');
      assert.ok(dialogOpen());
      assert.match(dialog().textContent, /Sign in to join Verne & Co’s circle\. It is free during early access\./);
      assert.ok(app.exists('#modal a[href^="/app/login?next="]'));
      assert.equal(callsTo(app.api, 'join').length, 0);
      await app.click('#modal [data-modal-close]');

      await app.click('[data-action="message"]');
      assert.match(dialog().textContent, /Sign in to message Verne & Co\./);
      await app.click('#modal [data-modal-close]');

      await app.click('[data-action="report"]');
      assert.match(dialog().textContent, /Sign in to report an atelier\./);
      await app.click('#modal [data-modal-close]');

      await app.click('.atelier-actions [data-follow]');
      assert.match(dialog().textContent, /Sign in to follow creators\./);
      assert.equal(callsTo(app.api, 'setFollow').length, 0);
    });

    it('opens the sign-in prompt for ?join=1 and keeps the join request in the way back', async () => {
      await open(guest(), '/app/c/verne-and-co?join=1');
      assert.ok(dialogOpen());
      assert.match(dialog().textContent, /Sign in to join/);
      assert.match(decodeURIComponent(app.find('#modal a.button').getAttribute('href')), /\/app\/c\/verne-and-co\?join=1/);
      assert.equal(app.path, '/app/c/verne-and-co', 'the address no longer asks for the dialog once it was shown');
    });

    it('shows the tiers with their prices and the early-access note, and asks to sign in to choose one', async () => {
      await open(guest(), '/app/c/verne-and-co?tab=membership');
      assert.equal(app.find('#atelier-panel-membership').hidden, false);
      assert.deepEqual([...app.document.querySelectorAll('.tier-card h3')].map(h => h.textContent), ['Reader', 'Supporter', 'Inner circle']);
      assert.match(app.text('.tier-card[data-tier="premium"]'), /€19/);
      assert.match(app.text('.atelier-early'), /Free during early access\. Prices apply once payments launch\./);
      await app.click('.tier-card[data-tier="premium"] [data-action="join"]');
      assert.ok(dialogOpen());
      assert.match(dialog().textContent, /Sign in to join/);
    });

    it('lists the posts of a kind only, and says what is missing when there are none', async () => {
      await open(guest(), '/app/c/atelier-solene');
      await app.click('[data-kind="image"]');
      assert.deepEqual(titles(), ['Fitting day']);
      assert.equal(app.find('[data-kind="image"]').getAttribute('aria-pressed'), 'true');
      assert.equal(app.find('[data-kind=""]').getAttribute('aria-pressed'), 'false');
      assert.equal(callsTo(app.api, 'creatorEntries').at(-1).args[1].kind, 'image');

      await app.click('[data-kind="video"]');
      assert.deepEqual(titles(), ['Inside the cutting room']);

      await open(guest(), '/app/c/verne-and-co');
      await app.click('[data-kind="video"]');
      assert.match(app.text('#view .empty'), /No video posts yet/);
      await app.click('#view .empty [data-kind=""]');
      assert.deepEqual(titles(), ['First draft habits']);
    });
  });

  describe('not found and failures', () => {
    it('shows a friendly page for an address that has no atelier', async () => {
      await open(guest(), '/app/c/nobody-here');
      assert.match(app.text('#view h1'), /We could not find that atelier/);
      assert.equal(app.document.title, 'Atelier not found — REFLUENZ');
      assert.equal(app.find('#view .empty a').getAttribute('href'), '/app/discover');
      assert.equal(callsTo(app.api, 'creatorEntries').length, 0);
    });

    it('shows an error with Retry when the atelier cannot be loaded, and recovers', async () => {
      const api = guest();
      api.fail('getCreatorBySlug', 'We could not reach the atelier. Check your connection.');
      await open(api, '/app/c/verne-and-co');
      assert.match(app.text('#view .error-state'), /We could not reach the atelier/);
      assert.ok(app.exists('#view [data-retry]'), 'the error offers Retry');
      api.fail('getCreatorBySlug', null);
      await app.router.reload();
      await app.settle();
      assert.equal(app.text('#view h1'), 'Verne & Co');
    });

    it('shows the posts error inside the posts tab with Retry, and keeps the rest of the page', async () => {
      const api = guest();
      await open(api, '/app/c/verne-and-co');
      api.fail('creatorEntries', 'The posts are not available right now.');
      await app.click('[data-kind="text"]');
      assert.match(app.text('[data-region="posts-body"]'), /The posts are not available right now\./);
      assert.equal(app.text('#view h1'), 'Verne & Co');
      api.fail('creatorEntries', null);
      await app.click('[data-region="posts-body"] [data-action="retry-posts"]');
      assert.deepEqual(titles(), ['First draft habits']);
    });
  });

  describe('a member', () => {
    it('sees which posts their tier opens, their tier, and a way to manage it', async () => {
      await open(member(), '/app/c/atelier-solene');
      assert.equal(stat('members'), '2');
      assert.equal(app.find('#view').querySelectorAll('.is-locked').length, 2, 'premium and signature are locked for an essential member');
      assert.match(app.text('.atelier-state'), /Member at Friend/);
      assert.ok(app.exists('[data-action="manage"]'));
      assert.ok(!app.exists('.atelier-actions [data-action="join"]'));
      assert.match(app.text('.atelier-lock-note'), /2 posts here are for members at a higher tier/);
    });

    it('marks the current tier and offers to switch or leave', async () => {
      await open(member(), '/app/c/atelier-solene');
      await app.click('[data-action="manage"]');
      assert.equal(app.find('#atelier-panel-membership').hidden, false);
      assert.equal(app.path, '/app/c/atelier-solene?tab=membership');
      const current = app.find('.tier-card.is-current');
      assert.equal(current.dataset.tier, 'essential');
      assert.match(current.textContent, /Your tier/);
      assert.ok(current.querySelector('[data-action="leave"]'));
      assert.match(app.text('.atelier-lead'), /You are in Atelier Solene’s circle at Friend/);
      assert.match(app.text('.tier-card[data-tier="premium"]'), /Switch to Patron/);
    });

    it('joins a circle from the dialog, updates the page and thanks them', async () => {
      const api = member();
      await open(api, '/app/c/verne-and-co');
      assert.equal(stat('members'), '0');
      await app.click('.atelier-actions [data-action="join"]');
      assert.ok(dialogOpen());
      assert.match(dialog().textContent, /Join Verne & Co/);
      assert.match(dialog().textContent, /Free during early access\. Prices apply once payments launch\. Nothing is charged today\./);
      assert.deepEqual([...dialog().querySelectorAll('.join-option strong')].map(el => el.textContent), ['Reader', 'Supporter', 'Inner circle']);
      assert.equal(dialog().querySelector('input[name="tier"]:checked').value, 'essential');
      await app.submit('#join-form', { tier: 'premium' });
      assert.ok(!dialogOpen());
      assert.deepEqual(callsTo(api, 'join').at(-1).args, [IDS.verne, 'premium']);
      assert.equal(api.db.memberships.some(row => row.user_id === IDS.member && row.creator_id === IDS.verne && row.tier === 'premium'), true);
      assert.match(toastText(), /Welcome to Verne & Co’s circle\./);
      assert.equal(stat('members'), '1');
      assert.match(app.text('.atelier-state'), /Member at Supporter/);
      assert.ok(app.exists('[data-action="manage"]'));
      assert.equal(app.find('.tier-card.is-current').dataset.tier, 'premium');
    });

    it('preselects the tier that was chosen on its card', async () => {
      await open(member(), '/app/c/verne-and-co?tab=membership');
      await app.click('.tier-card[data-tier="signature"] [data-action="join"]');
      assert.equal(dialog().querySelector('input[name="tier"]:checked').value, 'signature');
    });

    it('keeps the dialog open with the reason when joining fails, and works on a second try', async () => {
      const api = member();
      await open(api, '/app/c/verne-and-co?join=1');
      assert.ok(dialogOpen());
      api.fail('join', 'That membership tier is not open right now.');
      await app.submit('#join-form', { tier: 'signature' });
      assert.ok(dialogOpen());
      assert.match(app.text('[data-join-error]'), /That membership tier is not open right now\./);
      assert.equal(dialog().querySelector('[data-join-submit]').disabled, false, 'the button is usable again');
      assert.equal(dialog().querySelector('input[name="tier"]:checked').value, 'signature', 'the choice is kept');
      assert.equal(stat('members'), '0');
      api.fail('join', null);
      await app.submit('#join-form', { tier: 'signature' });
      assert.ok(!dialogOpen());
      assert.equal(stat('members'), '1');
    });

    it('switches tier, and cannot "switch" to the tier they already hold', async () => {
      const api = member();
      await open(api, '/app/c/atelier-solene?tab=membership');
      await app.click('.tier-card[data-tier="premium"] [data-action="join"]');
      assert.match(dialog().textContent, /Your membership at Atelier Solene/);
      assert.match(dialog().textContent, /Your tier/);
      await choose('essential');
      assert.equal(dialog().querySelector('[data-join-submit]').disabled, true);
      await choose('premium');
      assert.equal(dialog().querySelector('[data-join-submit]').disabled, false);
      await app.submit('#join-form', { tier: 'premium' });
      assert.ok(!dialogOpen());
      assert.match(toastText(), /You are now at Patron\./);
      assert.equal(api.db.memberships.find(row => row.user_id === IDS.member && row.creator_id === IDS.solene).tier, 'premium');
      assert.equal(stat('members'), '2', 'switching does not change the number of members');
      await app.click('#atelier-tab-posts');
      assert.equal(app.find('#view').querySelectorAll('.is-locked').length, 1, 'the premium post opens up');
    });

    it('leaves after a confirmation, and keeps the circle when they cancel or the request fails', async () => {
      const api = member();
      await open(api, '/app/c/atelier-solene?tab=membership');
      await app.click('[data-action="leave"]');
      assert.match(dialog().textContent, /Leave Atelier Solene’s circle\?/);
      await app.click('#modal [data-confirm="no"]');
      assert.equal(callsTo(api, 'leave').length, 0);
      assert.equal(app.store.state.memberships.has(IDS.solene), true);

      await app.click('[data-action="leave"]');
      api.fail('leave', 'We could not update your membership. Try again.');
      await app.click('#modal [data-confirm="yes"]');
      assert.match(toastText(), /We could not update your membership/);
      assert.equal(app.store.state.memberships.has(IDS.solene), true);
      assert.equal(app.find('[data-action="leave"]').disabled, false, 'the button is usable again');

      api.fail('leave', null);
      await app.click('[data-action="leave"]');
      await app.click('#modal [data-confirm="yes"]');
      assert.equal(app.store.state.memberships.has(IDS.solene), false);
      assert.equal(api.db.memberships.some(row => row.user_id === IDS.member && row.creator_id === IDS.solene), false);
      assert.match(toastText(), /You have left Atelier Solene’s circle\./);
      assert.equal(stat('members'), '1');
      assert.ok(app.exists('.atelier-actions [data-action="join"]'));
      await app.click('#atelier-tab-posts');
      assert.equal(app.find('#view').querySelectorAll('.is-locked').length, 3);
    });

    it('opens the join dialog from ?join=1 and drops the parameter from the address', async () => {
      await open(member(), '/app/c/atelier-solene?join=1');
      assert.ok(dialogOpen());
      assert.equal(app.path, '/app/c/atelier-solene');
      assert.match(dialog().textContent, /Your membership at Atelier Solene/);
    });

    it('follows from the header and the follower count follows', async () => {
      const api = member();
      await open(api, '/app/c/verne-and-co');
      assert.equal(stat('followers'), '1');
      await app.click('.atelier-actions [data-follow]');
      assert.equal(stat('followers'), '2');
      assert.equal(app.find('.atelier-actions [data-follow]').getAttribute('aria-pressed'), 'true');
      await app.click('.atelier-actions [data-follow]');
      assert.equal(stat('followers'), '1');
    });

    it('rolls the follower count back when the follow fails', async () => {
      const api = member();
      await open(api, '/app/c/verne-and-co');
      api.fail('setFollow', 'We could not update your follows. Try again.');
      await app.click('.atelier-actions [data-follow]');
      assert.equal(stat('followers'), '1');
      assert.equal(app.find('.atelier-actions [data-follow]').getAttribute('aria-pressed'), 'false');
    });

    it('links the message button to their own thread with the atelier', async () => {
      await open(member(), '/app/c/verne-and-co');
      const link = app.find('[data-action="message"]');
      assert.equal(link.tagName, 'A');
      assert.equal(link.getAttribute('href'), `/app/messages/${IDS.verne}/${IDS.member}`);
      await app.click(link);
      assert.equal(app.path, `/app/messages/${IDS.verne}/${IDS.member}`);
    });

    it('says memberships are closed when every tier is closed, and still shows a tier they hold', async () => {
      const api = member();
      for (const id of ['essential', 'premium', 'signature']) tierRow(api, IDS.verne, id).enabled = false;
      await open(api, '/app/c/verne-and-co?tab=membership');
      assert.equal(app.find('.atelier-actions .button[disabled]').textContent.trim(), 'Memberships closed');
      assert.match(app.text('[data-region="tiers"]'), /Memberships are closed/);
      assert.match(app.text('.atelier-state'), /Memberships are not open right now/);
      assert.ok(!app.exists('.tier-card'));

      const held = member();
      tierRow(held, IDS.solene, 'essential').enabled = false;
      await open(held, '/app/c/atelier-solene?tab=membership');
      assert.equal(app.find('.tier-card[data-tier="essential"]').classList.contains('is-current'), true);
      await app.click('.tier-card[data-tier="premium"] [data-action="join"]');
      assert.deepEqual([...dialog().querySelectorAll('input[name="tier"]')].map(input => input.value), ['premium', 'signature'], 'only open tiers can be chosen');
    });
  });

  describe('paging the posts', () => {
    it('loads the next page on request and stops at the end', async () => {
      const api = member();
      addPosts(api, IDS.verano, 14);
      await open(api, '/app/c/casa-verano');
      assert.equal(cards().length, 12);
      const more = app.find('[data-region="posts-footer"] [data-action="more"]');
      assert.equal(more.textContent.trim(), 'Load more');
      await app.click(more);
      assert.equal(cards().length, 18);
      assert.ok(!app.exists('[data-region="posts-footer"] [data-action="more"]'));
      assert.equal(new Set(titles()).size, 18, 'no post is listed twice');
      assert.match(app.text('[data-region="posts-status"]'), /Showing 18 posts/);
    });

    it('loads the next page when the end of the list scrolls into view', async () => {
      const api = member();
      addPosts(api, IDS.verano, 14);
      await open(api, '/app/c/casa-verano');
      const sentinel = app.find('[data-region="posts-sentinel"]');
      assert.equal(sentinel.hidden, false);
      const observer = IntersectionObserverStub.instances.findLast(instance => instance.targets.has(sentinel));
      assert.ok(observer, 'the sentinel is observed');
      observer.fire(true);
      await app.settle();
      assert.equal(cards().length, 18);
      assert.equal(sentinel.hidden, true);
    });

    it('shows a retry under the list when a later page fails, keeping the posts already read', async () => {
      const api = member();
      addPosts(api, IDS.verano, 14);
      await open(api, '/app/c/casa-verano');
      api.fail('creatorEntries', 'The next posts did not arrive.');
      await app.click('[data-region="posts-footer"] [data-action="more"]');
      assert.match(app.text('[data-region="posts-footer"]'), /The next posts did not arrive\./);
      assert.equal(cards().length, 12);
      api.fail('creatorEntries', null);
      await app.click('[data-region="posts-footer"] [data-action="more"]');
      assert.equal(cards().length, 18);
      assert.equal(app.text('[data-region="posts-footer"]'), '');
    });
  });

  describe('the owner', () => {
    it('gets New post and Edit atelier instead of follow, join, message and report', async () => {
      await open(owner(), '/app/c/verne-and-co');
      assert.equal(app.find('.atelier-primary a[href="/app/studio/new"]').textContent.trim(), 'New post');
      assert.equal(app.find('.atelier-primary a[href="/app/studio/settings"]').textContent.trim(), 'Edit atelier');
      assert.match(app.text('.atelier-state'), /This is your atelier/);
      for (const selector of ['[data-follow]', '[data-action="join"]', '[data-action="manage"]', '[data-action="message"]', '[data-action="report"]']) assert.ok(!app.exists(selector), selector);
      assert.ok(app.exists('[data-action="copy"]'));
      assert.deepEqual(titles(), ['First draft habits']);
      assert.equal(cards().length, 1, 'the draft is not listed');
      assert.equal(app.find('#view').querySelectorAll('.is-locked').length, 0);
    });

    it('sees the tiers as members do, with a way to edit them, and cannot join the own circle', async () => {
      await open(owner(), '/app/c/verne-and-co?tab=membership');
      assert.equal(app.find('.atelier-lead a').getAttribute('href'), '/app/studio/settings?tab=tiers');
      assert.equal(app.document.querySelectorAll('.tier-card').length, 3);
      assert.ok(!app.exists('.tier-card button'));
    });

    it('does not open the join dialog for ?join=1', async () => {
      await open(owner(), '/app/c/verne-and-co?join=1');
      assert.ok(!dialogOpen());
    });

    it('offers the first post when nothing is published yet', async () => {
      const api = owner();
      api.db.entries = api.db.entries.filter(row => row.creator_id !== IDS.verne);
      api.refresh();
      await open(api, '/app/c/verne-and-co');
      assert.match(app.text('#view .empty'), /Nothing published yet/);
      assert.equal(app.find('#view .empty a').getAttribute('href'), '/app/studio/new');
    });

    it('lets another visitor follow an atelier that has no posts yet', async () => {
      const api = member();
      api.db.entries = api.db.entries.filter(row => row.creator_id !== IDS.verne);
      api.refresh();
      await open(api, '/app/c/verne-and-co');
      assert.match(app.text('#view .empty'), /has not shared a post yet/);
      assert.ok(app.exists('#view .empty [data-follow]'));
    });
  });

  describe('tabs, about and links', () => {
    it('moves between tabs with the mouse and the arrow keys, and records the tab in the address', async () => {
      await open(guest(), '/app/c/verne-and-co');
      await app.click('#atelier-tab-about');
      assert.equal(app.path, '/app/c/verne-and-co?tab=about');
      assert.equal(app.find('#atelier-panel-about').hidden, false);
      assert.equal(app.find('#atelier-panel-posts').hidden, true);
      assert.equal(app.find('#atelier-tab-about').getAttribute('tabindex'), '0');
      assert.equal(app.find('#atelier-tab-posts').getAttribute('tabindex'), '-1');
      await press('#atelier-tab-about', 'ArrowRight');
      assert.equal(app.find('#atelier-tab-posts').getAttribute('aria-selected'), 'true');
      assert.equal(app.path, '/app/c/verne-and-co');
      await press('#atelier-tab-posts', 'ArrowLeft');
      assert.equal(app.find('#atelier-tab-about').getAttribute('aria-selected'), 'true');
      await press('#atelier-tab-about', 'Home');
      assert.equal(app.find('#atelier-tab-posts').getAttribute('aria-selected'), 'true');
      await press('#atelier-tab-posts', 'End');
      assert.equal(app.find('#atelier-tab-about').getAttribute('aria-selected'), 'true');
    });

    it('does not read the posts until the Posts tab is shown', async () => {
      const api = guest();
      await open(api, '/app/c/verne-and-co?tab=about');
      assert.equal(callsTo(api, 'creatorEntries').length, 0);
      await app.click('#atelier-tab-posts');
      assert.equal(callsTo(api, 'creatorEntries').length, 1);
    });

    it('tells the facts in About, including what membership costs once payments launch', async () => {
      await open(guest(), '/app/c/verne-and-co?tab=about');
      const about = app.text('#atelier-panel-about');
      assert.match(about, /Turin, Italy/);
      assert.match(about, /Writing/);
      assert.match(about, /1 post/);
      assert.match(about, /From €9 \/ month\. Free during early access\. Prices apply once payments launch\./);
      assert.ok(!/showcase atelier/.test(about));
      await open(guest(), '/app/c/casa-verano?tab=about');
      assert.match(app.text('#atelier-panel-about'), /showcase atelier, curated by REFLUENZ/);
    });

    it('renders safe external links only, opening web links in a new tab without leaking the opener', async () => {
      const api = guest();
      creatorRow(api, IDS.verne).links = [
        { label: 'Newsletter', url: 'https://example.test/verne' },
        { label: 'Write to us', url: 'mailto:hello@example.test' },
        { label: '', url: 'https://www.example.test/shop' },
        { label: 'Evil', url: 'javascript:alert(1)' },
        { label: 'Data', url: 'data:text/html,<script>alert(1)</script>' }
      ];
      await open(api, '/app/c/verne-and-co');
      const links = [...app.document.querySelectorAll('.atelier-link')];
      assert.deepEqual(links.map(link => link.getAttribute('href')), ['https://example.test/verne', 'mailto:hello@example.test', 'https://www.example.test/shop']);
      assert.equal(links[0].getAttribute('target'), '_blank');
      assert.match(links[0].getAttribute('rel'), /noopener/);
      assert.match(links[0].getAttribute('rel'), /noreferrer/);
      assert.match(links[0].getAttribute('rel'), /ugc/);
      assert.equal(links[1].getAttribute('target'), null);
      assert.match(links[2].textContent, /example\.test/);
      assert.match(links[0].textContent, /opens in a new tab/);
      assert.ok(!app.html('#view').includes('javascript:'));
    });
  });

  describe('sharing and reporting', () => {
    const navigatorStub = (name, value) => Object.defineProperty(globalThis.navigator, name, { value, configurable: true, writable: true });

    it('copies the link', async () => {
      const written = [];
      navigatorStub('clipboard', { writeText: async text => { written.push(text); } });
      await open(guest(), '/app/c/verne-and-co');
      await app.click('[data-action="copy"]');
      assert.deepEqual(written, ['http://localhost/app/c/verne-and-co']);
      assert.match(toastText(), /Link copied\./);
    });

    it('shows the link in a dialog when the clipboard is not available', async () => {
      navigatorStub('clipboard', { writeText: async () => { throw new Error('denied'); } });
      await open(guest(), '/app/c/verne-and-co');
      await app.click('[data-action="copy"]');
      assert.ok(dialogOpen());
      assert.equal(dialog().querySelector('#share-url').value, 'http://localhost/app/c/verne-and-co');
      assert.equal(dialog().querySelector('label[for="share-url"]').textContent, 'Link to Verne & Co');
    });

    it('offers the system share sheet only where it exists', async () => {
      navigatorStub('share', undefined);
      await open(guest(), '/app/c/verne-and-co');
      assert.ok(!app.exists('[data-action="share"]'));

      const shared = [];
      navigatorStub('share', async data => { shared.push(data); });
      await open(guest(), '/app/c/verne-and-co');
      await app.click('[data-action="share"]');
      assert.equal(shared.length, 1);
      assert.equal(shared[0].url, 'http://localhost/app/c/verne-and-co');
      assert.equal(shared[0].title, 'Verne & Co');

      navigatorStub('share', async () => { throw Object.assign(new Error('closed'), { name: 'AbortError' }); });
      await open(guest(), '/app/c/verne-and-co');
      await app.click('[data-action="share"]');
      assert.ok(!dialogOpen(), 'dismissing the share sheet is not an error');
      navigatorStub('share', undefined);
    });

    it('sends a report with the reason and the details', async () => {
      const api = member();
      await open(api, '/app/c/verne-and-co');
      await app.click('[data-action="report"]');
      assert.match(dialog().textContent, /Report Verne & Co/);
      assert.equal(dialog().querySelectorAll('input[name="reason"]').length, 6);
      await app.submit('#report-form', {});
      assert.match(app.text('[data-report-error]'), /Choose a reason for the report\./);
      assert.equal(api.db.reports.length, 0);
      await app.submit('#report-form', { reason: 'spam', details: 'Posts the same offer every day.' });
      assert.ok(!dialogOpen());
      assert.match(toastText(), /Thank you\. We will review this atelier\./);
      assert.equal(api.db.reports.length, 1);
      assert.equal(api.db.reports[0].target_type, 'creator');
      assert.equal(api.db.reports[0].target_id, IDS.verne);
      assert.equal(api.db.reports[0].reason, 'spam');
      assert.equal(api.db.reports[0].details, 'Posts the same offer every day.');
    });

    it('keeps the report, with what was typed, when sending fails', async () => {
      const api = member();
      await open(api, '/app/c/verne-and-co');
      await app.click('[data-action="report"]');
      api.fail('report', 'You are sending reports too quickly. Please wait a moment.');
      await app.submit('#report-form', { reason: 'other', details: 'A note I do not want to lose.' });
      assert.ok(dialogOpen());
      assert.match(app.text('[data-report-error]'), /too quickly/);
      assert.equal(dialog().querySelector('#report-details').value, 'A note I do not want to lose.');
      assert.equal(dialog().querySelector('[data-report-submit]').disabled, false);
      api.fail('report', null);
      await app.submit('#report-form', {});
      assert.ok(!dialogOpen());
      assert.equal(api.db.reports.length, 1);
    });
  });

  describe('hostile text', () => {
    it('shows names, descriptions, tiers and posts as text, never as markup', async () => {
      const api = member();
      const row = creatorRow(api, IDS.verne);
      Object.assign(row, { name: HOSTILE, descriptor: `<script>alert(1)</script>${HOSTILE}`, location: HOSTILE, bio: `${HOSTILE}\n<b>bold</b>`, links: [{ label: HOSTILE, url: 'https://example.test/x' }] });
      Object.assign(tierRow(api, IDS.verne, 'premium'), { name: HOSTILE, description: HOSTILE, perks: [HOSTILE] });
      api.db.entries.find(entry => entry.creator_id === IDS.verne && entry.status === 'published').title = HOSTILE;
      await open(api, '/app/c/verne-and-co?tab=membership');
      const view = app.find('#view');
      assert.equal(view.querySelector('img[onerror]'), null);
      assert.equal(view.querySelector('script'), null);
      assert.equal(view.querySelector('b'), null);
      assert.equal(app.text('#view h1'), HOSTILE);
      assert.ok(app.text('.atelier-bio').includes(HOSTILE));
      assert.ok(app.text('.tier-card[data-tier="premium"]').includes(HOSTILE));
      assert.equal(app.document.title, `${HOSTILE} — REFLUENZ`);

      await app.click('#atelier-tab-posts');
      assert.equal(app.find('.entry-title').textContent.trim(), HOSTILE);

      await app.click('.tier-card[data-tier="premium"] [data-action="join"]');
      assert.equal(dialog().querySelector('img[onerror]'), null);
      assert.match(dialog().textContent, /Join <img src=x onerror=alert\(1\)>/);
      await app.click('#modal [data-modal-close]');

      await app.click('[data-action="report"]');
      assert.equal(dialog().querySelector('img'), null);
      assert.equal(dialog().querySelector('#modal-title').textContent, `Report ${HOSTILE}`);
    });

    it('shows the toast text of a hostile atelier name as text', async () => {
      const api = member();
      creatorRow(api, IDS.verne).name = HOSTILE;
      await open(api, '/app/c/verne-and-co?join=1');
      await app.submit('#join-form', { tier: 'essential' });
      assert.equal(app.document.querySelector('#toast img'), null);
      assert.ok(toastText().includes(HOSTILE));
    });
  });

  describe('leaving the page', () => {
    it('stops listening to the store when the person goes elsewhere', async () => {
      const api = member();
      await open(api, '/app/c/verne-and-co');
      const errors = [];
      const original = console.error;
      console.error = (...args) => errors.push(args);
      try {
        await app.navigate('/app/discover');
        app.store.update({ memberships: new Map() });
        await tick(5);
      } finally {
        console.error = original;
      }
      assert.deepEqual(errors, []);
      assert.ok(!app.exists('.atelier'));
    });
  });

  describe('memberships page', () => {
    let app;
    const open = async (api, path = '/app/memberships') => { app = await mountApp({ api, path }); return app; };
    afterEach(async () => { await app?.destroy(); app = null; });

    const rows = () => [...app.document.querySelectorAll('.membership-row')];
    const dialog = () => app.find('#modal');
    const toastText = () => app.exists('#toast') ? app.text('#toast') : '';

    it('sends a guest to sign in and brings them back', async () => {
      await open(guest(), '/app/memberships');
      assert.equal(app.path, `/app/login?next=${encodeURIComponent('/app/memberships')}`);
    });

    it('lists each circle with its tier, price, start date and the ways to manage it', async () => {
      await open(member());
      assert.equal(app.text('#view h1'), 'Memberships');
      assert.equal(app.document.title, 'Memberships — REFLUENZ');
      assert.equal(rows().length, 1);
      const row = rows()[0];
      assert.equal(row.querySelector('h2 a').textContent, 'Atelier Solene');
      assert.equal(row.querySelector('h2 a').getAttribute('href'), '/app/c/atelier-solene');
      assert.match(row.querySelector('.membership-tier').textContent, /Friend/);
      assert.match(row.querySelector('.membership-tier').textContent, /€9 \/ month once payments launch/);
      assert.match(row.querySelector('.membership-since').textContent, /Member since 5 Aug 2026\. Free during early access\./);
      assert.equal(row.querySelector('a.button').getAttribute('href'), '/app/c/atelier-solene?tab=membership');
      assert.equal(row.querySelector('a.button').getAttribute('aria-label'), 'Manage your membership at Atelier Solene');
      assert.equal(row.querySelector('[data-leave]').getAttribute('aria-label'), 'Leave Atelier Solene’s circle');
      assert.match(app.text('[data-summary="count"]'), /1 circle/);
      assert.match(app.text('[data-summary="total"]'), /€9/);
      assert.match(app.text('.membership-free'), /Nothing is charged during early access\./);
      assert.match(app.text('.page-sub'), /free during early access/);
      assert.equal(app.find('#view section').getAttribute('aria-labelledby'), 'memberships-heading');
    });

    it('adds up what the circles will cost per month, per currency', async () => {
      const api = member();
      api.db.memberships.push({ user_id: IDS.member, creator_id: IDS.verano, tier: 'premium', created_at: '2026-09-01T09:00:00+00:00', updated_at: '2026-09-01T09:00:00+00:00' });
      api.refresh();
      await open(api);
      assert.equal(rows().length, 2);
      assert.match(app.text('[data-summary="count"]'), /2 circles/);
      assert.match(app.text('[data-summary="total"]'), /€28 \/ month/);
      assert.deepEqual(rows().map(row => row.querySelector('h2 a').textContent), ['Casa Verano', 'Atelier Solene'], 'newest first');

      tierRow(api, IDS.verano, 'premium').currency = 'USD';
      await open(api);
      assert.match(app.text('[data-summary="total"]'), /US\$19 \+ €9 \/ month/);
    });

    it('shows what to do next when there are no circles yet', async () => {
      await open(createFakeApi({ signedIn: IDS.fan2 }));
      assert.match(app.text('#view .empty'), /A circle starts with one connection/);
      assert.equal(app.find('#view .empty a').getAttribute('href'), '/app/discover');
      assert.ok(!app.exists('.membership-summary'));
    });

    it('leaves a circle after a confirmation and shows the empty state when it was the last one', async () => {
      const api = member();
      await open(api);
      await app.click('[data-leave]');
      assert.match(dialog().textContent, /Leave Atelier Solene’s circle\?/);
      await app.click('#modal [data-confirm="no"]');
      assert.equal(rows().length, 1);
      assert.equal(callsTo(api, 'leave').length, 0);

      await app.click('[data-leave]');
      await app.click('#modal [data-confirm="yes"]');
      assert.deepEqual(callsTo(api, 'leave').at(-1).args, [IDS.solene]);
      assert.equal(api.db.memberships.some(row => row.user_id === IDS.member), false);
      assert.equal(app.store.state.memberships.size, 0);
      assert.match(toastText(), /You have left Atelier Solene’s circle\./);
      assert.match(app.text('#view .empty'), /A circle starts with one connection/);
      assert.equal(app.document.activeElement.id, 'memberships-heading', 'focus moves to the heading');
    });

    it('removes only the circle that was left and updates the total', async () => {
      const api = member();
      api.db.memberships.push({ user_id: IDS.member, creator_id: IDS.verano, tier: 'premium', created_at: '2026-09-01T09:00:00+00:00', updated_at: '2026-09-01T09:00:00+00:00' });
      api.refresh();
      await open(api);
      await app.click('[data-leave="' + IDS.verano + '"]');
      await app.click('#modal [data-confirm="yes"]');
      assert.deepEqual(rows().map(row => row.dataset.membership), [IDS.solene]);
      assert.match(app.text('[data-summary="total"]'), /€9 \/ month/);
    });

    it('keeps the circle and re-enables the button when leaving fails', async () => {
      const api = member();
      await open(api);
      await app.click('[data-leave]');
      api.fail('leave', 'We could not update your membership. Try again.');
      await app.click('#modal [data-confirm="yes"]');
      assert.match(toastText(), /We could not update your membership/);
      assert.equal(rows().length, 1);
      assert.equal(app.find('[data-leave]').disabled, false);
      assert.equal(app.store.state.memberships.has(IDS.solene), true);
    });

    it('shows the first twenty circles and the rest on request', async () => {
      const api = member();
      addMemberships(api, 25);
      await open(api);
      assert.equal(rows().length, 20);
      assert.match(app.text('[data-summary="count"]'), /26 circles/);
      const more = app.find('#memberships-more');
      assert.equal(more.textContent.trim(), 'Show more (6)');
      await app.click(more);
      assert.equal(rows().length, 26);
      assert.ok(!app.exists('#memberships-more'));
      assert.equal(app.document.activeElement.closest('.membership-row'), rows()[20], 'focus lands on the first new row');
    });

    it('shows an error with Retry when the list cannot be loaded', async () => {
      const api = member();
      api.fail('myMemberships', 'We could not load your memberships.');
      await open(api);
      assert.match(app.text('#view .error-state'), /We could not load your memberships\./);
      assert.ok(app.exists('#view [data-retry]'), 'the error offers Retry');
      api.fail('myMemberships', null);
      await app.router.reload();
      await app.settle();
      assert.equal(rows().length, 1);
    });

    it('shows names as text and falls back gracefully for a circle without a picture', async () => {
      const api = member();
      creatorRow(api, IDS.solene).name = HOSTILE;
      creatorRow(api, IDS.solene).descriptor = HOSTILE;
      await open(api);
      const view = app.find('#view');
      assert.equal(view.querySelector('img[onerror]'), null);
      assert.equal(view.querySelector('script'), null);
      assert.ok(app.text('.membership-row h2').includes(HOSTILE));
      assert.ok(app.exists('.membership-avatar .avatar--initials'));
      await app.click('[data-leave]');
      assert.equal(dialog().querySelector('img'), null);
      assert.equal(dialog().querySelector('#modal-title').textContent, `Leave ${HOSTILE}’s circle?`);
    });

    it('is reached from the atelier page after joining', async () => {
      const api = member();
      await open(api, '/app/c/verne-and-co?join=1');
      await app.submit('#join-form', { tier: 'essential' });
      await app.navigate('/app/memberships');
      assert.deepEqual(rows().map(row => row.querySelector('h2 a').textContent), ['Verne & Co', 'Atelier Solene']);
      assert.match(app.text('[data-summary="total"]'), /€18/);
    });
  });
});
