import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { installDom, uninstallDom, mountApp, tick } from './helpers/dom.mjs';
import { html, followButton, saveButton, likeButton } from '../src/core/ui.js';
import { createFakeApi, IDS } from './helpers/fake-api.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const E = IDS.entries;
// The three kinds of visitor, all served by the in-memory api: a guest, the seeded member (Sofia Marchetti) and the owner of Verne & Co.
const PERSONAS = {
  guest: () => createFakeApi({ signedIn: null }),
  member: () => createFakeApi(),
  creator: () => createFakeApi({ signedIn: IDS.owner })
};
const callsTo = (fake, method) => fake.calls.filter(call => call.method === method);
const writesOf = fake => fake.calls.filter(call => /^set(Follow|Like|Bookmark)$/.test(call.method)).map(({ method, args }) => [method, ...args]);

// Leaves `user` with exactly this many unread notifications and unread messages (the rows the badges are counted from).
let rowNumber = 0;
const rowId = () => `00000000-0000-4000-8000-${String(++rowNumber).padStart(12, '9')}`;
function setUnread(fake, user, { notifications = 0, messages = 0 }) {
  const at = '2026-10-07T08:00:00+00:00';
  fake.db.notifications = fake.db.notifications.filter(row => row.user_id !== user);
  fake.db.messages = fake.db.messages.filter(row => row.member_id !== user);
  for (let i = 0; i < notifications; i++) fake.db.notifications.push({ id: rowId(), user_id: user, type: 'like', actor_id: IDS.fan1, creator_id: IDS.solene, entry_id: E.fittingDay, comment_id: null, read_at: null, created_at: at });
  for (let i = 0; i < messages; i++) fake.db.messages.push({ id: rowId(), creator_id: IDS.verne, member_id: user, sender: 'creator', body: 'Hello', created_at: at, read_at: null });
}
// A realtime row of the messages table.
const messageRow = (over = {}) => ({ id: rowId(), creator_id: IDS.verne, member_id: IDS.member, sender: 'creator', body: 'Thank you for joining the circle.', created_at: '2026-10-07T09:30:00+00:00', read_at: null, ...over });

// Every route of docs/ARCHITECTURE.md section 3, with concrete ids.
const PATHS = [
  '/app', '/app/discover', '/app/discover?q=linen&category=Design&kind=image&sort=popular', '/app/c/atelier-solene', '/app/c/atelier-solene?join=1', `/app/p/${E.linenWardrobe}`,
  '/app/library', '/app/memberships', '/app/messages', `/app/messages/${IDS.verne}/${IDS.member}`, '/app/notifications',
  '/app/studio', '/app/studio?tab=members', '/app/studio/new', '/app/studio/new?kind=video', `/app/studio/edit/${E.firstDraftHabits}`, '/app/studio/settings', '/app/studio/settings?tab=tiers',
  '/app/settings', '/app/settings?tab=data', '/app/login', '/app/signup', '/app/forgot', '/app/reset', '/app/welcome', '/app/does-not-exist', '/app/c/a/b/c'
];

describe('boot', () => {
  before(() => installDom());
  after(() => uninstallDom());

  let app;
  const open = async options => { app = await mountApp(options); return app; };
  const close = async () => { await app?.destroy(); app = null; };
  const links = selector => [...app.document.querySelectorAll(`${selector} a`)].map(a => a.getAttribute('href'));
  // The visible name of each match: its first <span> (the badge comes after it), or its own text.
  const labels = selector => [...app.document.querySelectorAll(selector)].map(el => (el.querySelector('span') ?? el).textContent.replace(/\s+/g, ' ').trim());

  describe('the document', () => {
    it('is a strict, accessible shell: landmarks, live regions, a dialog, no inline code', () => {
      const page = read('app.html');
      assert.match(page, /<html lang="en">/);
      assert.match(page, /name="viewport"[^>]*viewport-fit=cover/);
      assert.match(page, /name="theme-color"/);
      assert.match(page, /name="description"/);
      assert.match(page, /rel="manifest" href="\/manifest\.webmanifest"/);
      assert.match(page, /<div id="app"><div class="boot" role="status">.*<\/div><\/div>/);
      assert.match(page, /<dialog id="modal" aria-labelledby="modal-title"><\/dialog>/);
      assert.match(page, /<div id="toast" role="status" aria-live="polite"><\/div>/);
      assert.match(page, /class="skip-link" href="#main"/);
      assert.match(page, /<script type="module" src="\/src\/main\.js"><\/script>/);
      assert.deepEqual([...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)], [], 'no inline script');
      assert.doesNotMatch(page, /<style|\sstyle=|\son[a-z]+=/i);
      assert.doesNotMatch(page, /demo/i);
    });

    it('links the base styles and one stylesheet per feature area, and they exist', () => {
      const page = read('app.html');
      const sheets = [...page.matchAll(/rel="stylesheet" href="([^"]+)"/g)].map(match => match[1]);
      assert.deepEqual(sheets, ['/src/design.css', '/src/styles/base.css', '/src/styles/shell.css', ...['auth', 'feed', 'creator', 'entry', 'inbox', 'studio', 'editor', 'settings'].map(name => `/src/styles/${name}.css`)]);
      for (const sheet of sheets) assert.ok(existsSync(new URL(`..${sheet}`, import.meta.url)), sheet);
    });

    it('has a web manifest that points at the app and the favicon', () => {
      const manifest = JSON.parse(read('public/manifest.webmanifest'));
      assert.equal(manifest.name, 'REFLUENZ');
      assert.equal(manifest.start_url, '/app');
      assert.ok(existsSync(new URL(`../public${manifest.icons[0].src}`, import.meta.url)));
    });

    it('has the Vercel rewrites, security headers and cache rules', () => {
      const config = JSON.parse(read('vercel.json'));
      assert.deepEqual(config.rewrites, [{ source: '/app', destination: '/app.html' }, { source: '/app/:path*', destination: '/app.html' }]);
      const site = Object.fromEntries(config.headers.find(rule => rule.source === '/(.*)').headers.map(h => [h.key, h.value]));
      assert.equal(site['X-Content-Type-Options'], 'nosniff');
      assert.equal(site['Referrer-Policy'], 'strict-origin-when-cross-origin');
      assert.equal(site['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');
      assert.match(site['Strict-Transport-Security'], /^max-age=\d{7,}/);
      const policy = Object.fromEntries(site['Content-Security-Policy'].split(';').map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
      const SUPABASE = 'https://bwezbxwdmnmfbibpusaf.supabase.co';
      assert.deepEqual(policy['default-src'], ["'self'"]);
      assert.ok(policy['script-src'].includes('https://cdn.jsdelivr.net'));
      assert.ok(policy['script-src'].some(value => value.startsWith("'sha256-")), 'the landing page’s inline script is allowed by hash');
      assert.ok(!policy['script-src'].includes("'unsafe-inline'") && !policy['script-src'].includes("'unsafe-eval'"));
      assert.deepEqual(policy['style-src'], ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']);
      assert.deepEqual(policy['font-src'], ["'self'", 'https://fonts.gstatic.com', 'data:']);
      assert.deepEqual(policy['img-src'], ["'self'", 'data:', 'blob:', SUPABASE]);
      assert.deepEqual(policy['media-src'], ["'self'", 'blob:', SUPABASE]);
      assert.deepEqual(policy['connect-src'], ["'self'", SUPABASE, 'wss://bwezbxwdmnmfbibpusaf.supabase.co', 'https://cdn.jsdelivr.net']);
      assert.deepEqual(policy['frame-ancestors'], ["'none'"]);
      assert.deepEqual(policy['base-uri'], ["'self'"]);
      assert.deepEqual(policy['form-action'], ["'self'"]);
      assert.deepEqual(policy['object-src'], ["'none'"]);
      const cache = source => config.headers.find(rule => rule.source === source)?.headers.find(h => h.key === 'Cache-Control')?.value;
      for (const source of ['/', '/app.html', '/index.html', '/app', '/app/(.*)', '/src/(.*)']) assert.equal(cache(source), 'no-cache', source);
      for (const source of ['/editorial/v1/(.*)', '/film/(.*)']) assert.equal(cache(source), 'public, max-age=31536000, immutable', source);
    });
  });

  describe('every route draws a page, for a guest, a member and a creator', () => {
    for (const [name, api] of Object.entries(PERSONAS)) {
      it(`as a ${name}`, async () => {
        await open({ api: api(), path: '/app' });
        for (const path of PATHS) {
          await app.navigate(path);
          assert.ok(app.path.startsWith('/app'), `${path} → ${app.path}`);
          assert.equal(app.exists('#view .skeleton'), false, `${path}: still loading`);
          assert.equal(app.exists('#view .error-state'), false, `${path}: error state`);
          assert.ok(app.exists('#view h1'), `${path}: a page heading`);
          assert.ok(app.document.title.endsWith(' — REFLUENZ'), `${path}: ${app.document.title}`);
          assert.equal(app.find('#view').getAttribute('aria-busy'), null, path);
        }
        await close();
      });
    }

    it('visits every route of the table, and the catch-all', async () => {
      const { compileRoutes, matchRoute } = await import('../src/core/router.js');
      const { routes } = await import('../src/core/routes.js');
      const compiled = compileRoutes(routes);
      const reached = new Set(PATHS.map(path => matchRoute(compiled, path.split('?')[0]).route.path));
      assert.deepEqual(routes.map(route => route.path).filter(path => !reached.has(path)), [], 'routes that no path above reaches');
    });

    it('lands where the guards say', async () => {
      const where = { guest: {}, member: {}, creator: {} };
      for (const [name, api] of Object.entries(PERSONAS)) {
        await open({ api: api(), path: '/app' });
        for (const path of ['/app/library', '/app/studio/new', '/app/login?next=%2Fapp%2Fsettings', '/app/reset']) {
          await app.navigate(path);
          where[name][path] = app.path;
        }
        await close();
      }
      assert.deepEqual(where.guest, { '/app/library': '/app/login?next=%2Fapp%2Flibrary', '/app/studio/new': '/app/login?next=%2Fapp%2Fstudio%2Fnew', '/app/login?next=%2Fapp%2Fsettings': '/app/login?next=%2Fapp%2Fsettings', '/app/reset': '/app/forgot' });
      assert.deepEqual(where.member, { '/app/library': '/app/library', '/app/studio/new': '/app/studio', '/app/login?next=%2Fapp%2Fsettings': '/app/settings', '/app/reset': '/app/reset' });
      assert.deepEqual(where.creator, { '/app/library': '/app/library', '/app/studio/new': '/app/studio/new', '/app/login?next=%2Fapp%2Fsettings': '/app/settings', '/app/reset': '/app/reset' });
    });
  });

  describe('starting up', () => {
    it('starts as a guest when the session cannot be read', async () => {
      const fake = createFakeApi();
      fake.fail('getSession', 'offline');
      await open({ api: fake });
      assert.ok(app.exists('#view h1'));
      assert.equal(app.store.state.user, null);
      await close();
    });

    it('waits for the session before choosing a page', async () => {
      const api = createFakeApi();
      await open({ api, path: '/app/library' });
      assert.equal(app.path, '/app/library', 'a signed-in person is not bounced through the sign-in page');
      assert.equal(callsTo(api, 'loadViewer').length, 1);
      await close();
    });

    it('opens the page even when the viewer’s data cannot be loaded', async () => {
      const api = createFakeApi();
      api.fail('loadViewer', 'down');
      await open({ api, path: '/app/library' });
      assert.equal(app.path, '/app/library');
      assert.ok(app.store.state.viewerError);
      await close();
    });

    it('stops everything it started', async () => {
      const api = createFakeApi();
      await open({ api });
      let seen = 0;
      const stopWatching = app.store.subscribe(() => { seen++; });
      await close();
      api.emit(IDS.member, 'message', messageRow());
      api.signOut();
      await tick(5);
      assert.equal(seen, 0, 'the store no longer listens to the api');
      stopWatching();
      assert.equal(globalThis.document.querySelector('#view'), null);
    });
  });

  describe('the shell for a guest', () => {
    it('offers Home and Discover, join and sign-in calls with a way back, and no account menu', async () => {
      await open({ api: PERSONAS.guest(), path: '/app/c/anna?tab=posts' });
      assert.deepEqual(labels('.sidebar .nav-link'), ['Home', 'Discover']);
      const topbar = links('.topbar-actions');
      assert.deepEqual(topbar, ['/app/login?next=%2Fapp%2Fc%2Fanna%3Ftab%3Dposts', '/app/signup?next=%2Fapp%2Fc%2Fanna%3Ftab%3Dposts']);
      assert.deepEqual(labels('.topbar-actions a'), ['Sign in', 'Join free']);
      assert.equal(app.exists('.account-menu'), false);
      assert.equal(app.exists('.new-post'), false);
      assert.deepEqual(labels('.mobile-bar .mobile-link'), ['Home', 'Discover', 'Sign in', 'Join free']);
      assert.match(app.text('.sidebar-join'), /Join free/);
      await app.navigate('/app/discover');
      assert.deepEqual(links('.topbar-actions'), ['/app/login?next=%2Fapp%2Fdiscover', '/app/signup?next=%2Fapp%2Fdiscover'], 'the way back follows the page');
      await close();
    });

    it('marks the page you are on', async () => {
      await open({ api: PERSONAS.guest(), path: '/app' });
      const current = () => [...app.document.querySelectorAll('.sidebar [aria-current="page"]')].map(el => el.textContent.trim());
      assert.deepEqual(current(), ['Home']);
      await app.navigate('/app/discover?q=x');
      assert.deepEqual(current(), ['Discover']);
      await app.navigate('/app/c/anna');
      assert.deepEqual(current(), [], 'Home is current only on Home');
      await close();
    });
  });

  describe('the shell for a member', () => {
    it('offers every section, an account menu and no New post', async () => {
      await open({ api: PERSONAS.member(), path: '/app' });
      assert.deepEqual(labels('.sidebar .nav-link'), ['Home', 'Discover', 'Library', 'Messages', 'Notifications', 'Memberships', 'Open your atelier', 'Settings']);
      assert.deepEqual(links('.sidebar .side-nav'), ['/app', '/app/discover', '/app/library', '/app/messages', '/app/notifications', '/app/memberships', '/app/studio', '/app/settings']);
      assert.equal(app.exists('.new-post'), false);
      assert.deepEqual(labels('.mobile-bar .mobile-link'), ['Home', 'Discover', 'Library', 'Messages', 'You']);
      assert.match(app.text('.profile-link'), /Sofia Marchetti/);
      assert.match(app.text('.profile-link'), /member@example\.test/);
      assert.equal(app.exists('.topbar-actions a[href^="/app/login"]'), false);
      await close();
    });

    it('shows the profile picture when there is one, and escapes the name', async () => {
      const fake = createFakeApi();
      Object.assign(fake.db.profiles.find(row => row.id === IDS.member), { display_name: '"><img src=x onerror=alert(1)>', avatar_path: `${IDS.member}/a.webp` });
      await open({ api: fake });
      assert.ok(app.exists('.account-menu .avatar img'));
      assert.equal(app.exists('img[onerror]'), false);
      assert.match(app.text('.menu-heading'), /<img src=x/);
      await close();
    });

    it('marks Studio as current inside the studio', async () => {
      await open({ api: PERSONAS.creator(), path: '/app/studio/settings?tab=tiers' });
      const current = [...app.document.querySelectorAll('.sidebar [aria-current="page"]')].map(el => el.textContent.trim());
      assert.deepEqual(current, ['Studio']);
      await close();
    });
  });

  describe('the shell for a creator', () => {
    it('adds New post with a Text, Image and Video chooser', async () => {
      await open({ api: PERSONAS.creator() });
      assert.deepEqual(labels('.sidebar .nav-link'), ['Home', 'Discover', 'Library', 'Messages', 'Notifications', 'Memberships', 'Studio', 'Settings']);
      const trigger = app.find('.sidebar .new-post [data-menu-trigger]');
      assert.equal(trigger.getAttribute('aria-expanded'), 'false');
      assert.equal(app.find('.sidebar .new-post .menu-panel').hidden, true);
      await app.click(trigger);
      assert.equal(trigger.getAttribute('aria-expanded'), 'true');
      assert.deepEqual(links('.sidebar .new-post'), ['/app/studio/new?kind=text', '/app/studio/new?kind=image', '/app/studio/new?kind=video']);
      assert.deepEqual(labels('.sidebar .new-post .menu-item'), ['Text post', 'Image post', 'Video post']);
      assert.equal(app.document.activeElement.getAttribute('href'), '/app/studio/new?kind=text', 'the first choice has focus');
      await close();
    });

    it('choosing a kind opens the editor and closes the menu', async () => {
      await open({ api: PERSONAS.creator() });
      await app.click('.sidebar .new-post [data-menu-trigger]');
      await app.click('.sidebar .new-post a[href$="kind=video"]');
      assert.equal(app.path, '/app/studio/new?kind=video');
      assert.equal(app.find('.sidebar .new-post .menu-panel').hidden, true);
      await close();
    });

    it('puts New post in the middle of the mobile bar, in place of Library', async () => {
      await open({ api: PERSONAS.creator() });
      assert.deepEqual(labels('.mobile-bar .mobile-link'), ['Home', 'Discover', 'New post', 'Messages', 'You']);
      await app.click('.mobile-bar [data-menu-trigger]');
      assert.deepEqual(links('.mobile-bar .menu'), ['/app/studio/new?kind=text', '/app/studio/new?kind=image', '/app/studio/new?kind=video']);
      await close();
    });

    it('lists My atelier and Studio in the account menu', async () => {
      await open({ api: PERSONAS.creator() });
      assert.deepEqual(links('.account-menu .menu-panel'), ['/app/settings', '/app/c/verne-and-co', '/app/studio', '/app/memberships']);
      await close();
    });
  });

  describe('menus', () => {
    it('the account menu opens, moves with the arrow keys, closes with Escape and gives focus back', async () => {
      await open({ api: PERSONAS.member() });
      const trigger = app.find('.account-menu [data-menu-trigger]');
      const panel = app.find('.account-menu .menu-panel');
      assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
      assert.equal(trigger.getAttribute('aria-controls'), panel.id);
      assert.equal(trigger.getAttribute('aria-label'), 'Account menu');
      await app.click(trigger);
      assert.equal(panel.hidden, false);
      const items = [...panel.querySelectorAll('[role="menuitem"]')];
      assert.deepEqual(items.map(item => item.textContent.trim()), ['Settings', 'Open your atelier', 'Memberships', 'Sign out']);
      assert.equal(app.document.activeElement, items[0]);
      const key = (key, target = app.document.activeElement) => target.dispatchEvent(new app.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      key('ArrowDown'); assert.equal(app.document.activeElement, items[1]);
      key('End'); assert.equal(app.document.activeElement, items[3]);
      key('ArrowDown'); assert.equal(app.document.activeElement, items[0], 'wraps around');
      key('ArrowUp'); assert.equal(app.document.activeElement, items[3]);
      key('Home'); assert.equal(app.document.activeElement, items[0]);
      key('Escape');
      assert.equal(panel.hidden, true);
      assert.equal(trigger.getAttribute('aria-expanded'), 'false');
      assert.equal(app.document.activeElement, trigger);
      key('ArrowDown', trigger);
      assert.equal(panel.hidden, false, 'the arrow keys open it from the button');
      await close();
    });

    it('closes when you click elsewhere, when focus leaves, and when another menu opens', async () => {
      await open({ api: PERSONAS.creator() });
      const account = app.find('.account-menu [data-menu-trigger]');
      const chooser = app.find('.sidebar .new-post [data-menu-trigger]');
      await app.click(account);
      await app.click('#view');
      assert.equal(app.find('.account-menu .menu-panel').hidden, true);
      await app.click(account);
      await app.click(chooser);
      assert.equal(app.find('.account-menu .menu-panel').hidden, true, 'one menu at a time');
      assert.equal(app.find('.sidebar .new-post .menu-panel').hidden, false);
      app.find('.sidebar .new-post .menu-item').dispatchEvent(new app.window.FocusEvent('focusout', { bubbles: true, relatedTarget: app.find('#main') }));
      assert.equal(app.find('.sidebar .new-post .menu-panel').hidden, true);
      await app.click(chooser);
      await app.click(chooser);
      assert.equal(app.find('.sidebar .new-post .menu-panel').hidden, true, 'the button toggles');
      await close();
    });

    it('stays open while badges change and while the page changes under it is closed', async () => {
      const api = PERSONAS.member();
      await open({ api });
      await app.click('.account-menu [data-menu-trigger]');
      setUnread(api, IDS.member, { notifications: 2, messages: 5 });
      await app.store.refreshUnread();
      assert.equal(app.find('.account-menu .menu-panel').hidden, false, 'a realtime update does not close the menu');
      await app.navigate('/app/discover');
      assert.equal(app.find('.account-menu .menu-panel').hidden, true);
      await close();
    });

    it('signs out from the menu', async () => {
      const api = PERSONAS.member();
      await open({ api, path: '/app/library' });
      await app.click('.account-menu [data-menu-trigger]');
      await app.click('.account-menu [data-action="sign-out"]');
      assert.equal(callsTo(api, 'signOut').length, 1);
      assert.equal(app.store.state.user, null);
      assert.equal(app.path, '/app');
      assert.deepEqual(labels('.sidebar .nav-link'), ['Home', 'Discover']);
      assert.equal(app.exists('.account-menu'), false);
      await close();
    });

    it('tells the person when signing out fails, and stays signed in', async () => {
      const api = PERSONAS.member();
      api.fail('signOut', 'Could not reach the server.');
      await open({ api });
      await app.click('.account-menu [data-menu-trigger]');
      await app.click('.account-menu [data-action="sign-out"]');
      assert.match(app.text('#toast'), /Could not reach the server\./);
      assert.ok(app.store.state.user);
      await close();
    });
  });

  describe('badges', () => {
    it('show the unread counts from the store and follow them live', async () => {
      const api = PERSONAS.member();
      setUnread(api, IDS.member, { notifications: 3, messages: 120 });
      await open({ api });
      const badge = kind => [...app.document.querySelectorAll(`[data-badge="${kind}"]`)].map(el => ({ text: el.textContent, hidden: el.hidden }));
      assert.deepEqual(badge('messages'), [{ text: '99+', hidden: false }, { text: '99+', hidden: false }], 'sidebar and mobile bar');
      assert.deepEqual(badge('notifications'), [{ text: '3', hidden: false }, { text: '3', hidden: false }], 'sidebar and bell');
      assert.equal(app.find('.bell-link').getAttribute('aria-label'), 'Notifications, 3 unread');
      setUnread(api, IDS.member, {});
      await app.store.refreshUnread();
      assert.ok(badge('messages').every(b => b.hidden));
      assert.ok(badge('notifications').every(b => b.hidden));
      assert.equal(app.find('.bell-link').getAttribute('aria-label'), 'Notifications');
      await close();
    });

    it('are refreshed by realtime events', async () => {
      const api = PERSONAS.member();
      await open({ api });
      setUnread(api, IDS.member, { notifications: 1 });
      api.emit(IDS.member, 'notification', api.db.notifications.find(row => row.user_id === IDS.member));
      await tick(5);
      assert.deepEqual([...app.document.querySelectorAll('.sidebar [data-badge="notifications"]')].map(el => el.textContent), ['1']);
      await close();
    });
  });

  describe('search', () => {
    it('goes to Discover with the query, and the box shows it there and nowhere else', async () => {
      await open({ api: PERSONAS.guest() });
      const box = () => app.find('#shell-search');
      assert.equal(app.find('.search').getAttribute('role'), 'search');
      assert.equal(app.find('.search').getAttribute('action'), '/app/discover');
      await app.submit('.search', { q: '  linen & light ' });
      assert.equal(app.path, '/app/discover?q=linen+%26+light');
      assert.equal(box().value, 'linen & light');
      await app.submit('.search', { q: '' });
      assert.equal(app.path, '/app/discover');
      await app.submit('.search', { q: 'x' });
      await app.navigate('/app/c/anna');
      assert.equal(box().value, '');
      await close();
    });

    it('keeps what is being typed when nothing changed', async () => {
      await open({ api: PERSONAS.member() });
      app.find('#shell-search').value = 'half a wo';
      app.store.update({ unread: { notifications: 1, messages: 0 } });
      assert.equal(app.find('#shell-search').value, 'half a wo');
      await close();
    });
  });

  describe('the whole page', () => {
    const route = (path, render) => ({ path, view: async () => ({ default: { title: 'Buttons', auth: 'optional', render } }) });
    const notFound = { path: '*', view: async () => ({ default: { title: 'Missing', auth: 'optional', render: () => html`<h1>Missing</h1>` } }) };
    // A new entry for every test: liking changes its count in place. Atelier Solene and the post are ones the seeded member has not touched.
    const buttonsPage = () => {
      const entry = { id: E.tilesOfAlfama, creatorId: IDS.verano, likeCount: 4 };
      return route('/app/buttons', () => html`<h1>Buttons</h1>${followButton(IDS.solene)}${saveButton(entry)}${likeButton(entry)}`);
    };

    it('follow, save and like buttons work anywhere, and update at once', async () => {
      const api = PERSONAS.member();
      await open({ api, path: '/app/buttons', routes: [buttonsPage(), notFound] });
      const pressed = selector => app.find(selector).getAttribute('aria-pressed');
      assert.equal(pressed('[data-follow]'), 'false');
      await app.click('[data-follow]');
      assert.equal(pressed('[data-follow]'), 'true');
      assert.match(app.text('[data-follow]'), /Following/);
      await app.click('[data-save]');
      assert.equal(pressed('[data-save]'), 'true');
      await app.click('[data-like]');
      assert.equal(pressed('[data-like]'), 'true');
      assert.equal(app.text('[data-like] .count'), '5');
      assert.deepEqual(writesOf(api), [['setFollow', IDS.solene, true], ['setBookmark', E.tilesOfAlfama, true], ['setLike', E.tilesOfAlfama, true]]);
      assert.ok(api.db.follows.some(row => row.user_id === IDS.member && row.creator_id === IDS.solene), 'the follow reached the data');
      await app.click('[data-follow]');
      assert.equal(pressed('[data-follow]'), 'false');
      assert.match(app.text('[data-follow]'), /^\s*Follow\s*$/);
      await close();
    });

    it('rolls a failed change back on the page and says so', async () => {
      const api = PERSONAS.member();
      api.fail('setLike', 'Could not save your like.');
      await open({ api, path: '/app/buttons', routes: [buttonsPage(), notFound] });
      await app.click('[data-like]');
      assert.equal(app.find('[data-like]').getAttribute('aria-pressed'), 'false');
      assert.equal(app.text('[data-like] .count'), '4');
      assert.match(app.text('#toast'), /Could not save your like\./);
      await close();
    });

    it('asks a guest to sign in, with a way back, and changes nothing', async () => {
      const api = PERSONAS.guest();
      await open({ api, path: '/app/buttons', routes: [buttonsPage(), notFound] });
      await app.click('[data-follow]');
      const dialog = app.find('#modal');
      assert.equal(dialog.open, true);
      assert.deepEqual([...dialog.querySelectorAll('a')].map(a => a.getAttribute('href')), ['/app/login?next=%2Fapp%2Fbuttons', '/app/signup?next=%2Fapp%2Fbuttons']);
      assert.equal(app.find('[data-follow]').getAttribute('aria-pressed'), 'false');
      assert.deepEqual(writesOf(api), []);
      await app.click(dialog.querySelector('a'));
      assert.equal(app.path, '/app/login?next=%2Fapp%2Fbuttons');
      assert.equal(dialog.open, false, 'the dialog closes when the page changes');
      await close();
    });

    it('keeps every follow button of the page in step, and puts them right after sign-out', async () => {
      const two = route('/app/buttons', () => html`<h1>Two</h1>${followButton(IDS.solene)}${followButton(IDS.solene)}`);
      await open({ api: PERSONAS.member(), path: '/app/buttons', routes: [two, notFound] });
      await app.click('[data-follow]');
      assert.deepEqual([...app.document.querySelectorAll('[data-follow]')].map(el => el.getAttribute('aria-pressed')), ['true', 'true']);
      await close();
    });

    it('the skip link moves focus to the main region without changing the address', async () => {
      await open({ api: PERSONAS.guest(), path: '/app/discover' });
      await app.click('.skip-link');
      assert.equal(app.document.activeElement.id, 'main');
      assert.equal(app.path, '/app/discover');
      await close();
    });

    it('has the landmarks a screen reader navigates by', async () => {
      await open({ api: PERSONAS.member() });
      assert.equal(app.document.querySelectorAll('main').length, 1);
      assert.equal(app.find('main').id, 'main');
      assert.equal(app.find('main').getAttribute('tabindex'), '-1');
      assert.ok(app.find('main #view'));
      assert.deepEqual([...app.document.querySelectorAll('nav')].map(nav => nav.getAttribute('aria-label')), ['Main', 'Mobile']);
      assert.equal(app.find('header.topbar').tagName, 'HEADER');
      assert.equal(app.find('#route-announcer').getAttribute('aria-live'), 'polite');
      assert.equal(app.find('#toast').getAttribute('aria-live'), 'polite');
      await close();
    });
  });

  describe('realtime messages', () => {
    it('toasts a new message and refreshes the badge', async () => {
      const api = PERSONAS.member();
      await open({ api, path: '/app/discover' });
      setUnread(api, IDS.member, { messages: 1 });
      api.emit(IDS.member, 'message', messageRow());
      await tick(5);
      assert.match(app.text('#toast'), /New message: Thank you for joining the circle\./);
      assert.deepEqual([...app.document.querySelectorAll('.sidebar [data-badge="messages"]')].map(el => el.textContent), ['1']);
      await close();
    });

    it('shortens a long message and copes with an empty one', async () => {
      const api = PERSONAS.member();
      await open({ api });
      api.emit(IDS.member, 'message', messageRow({ body: 'x'.repeat(200) }));
      assert.match(app.text('#toast'), /New message: x{67}…$/);
      api.emit(IDS.member, 'message', messageRow({ body: '  ' }));
      assert.match(app.text('#toast'), /You have a new message\.$/);
      await close();
    });

    it('stays quiet while that thread is open, and for your own messages', async () => {
      const api = PERSONAS.member();
      await open({ api, path: `/app/messages/${IDS.verne}/${IDS.member}` });
      api.emit(IDS.member, 'message', messageRow());
      assert.equal(app.text('#toast'), '');
      await app.navigate('/app/discover');
      api.emit(IDS.member, 'message', messageRow({ sender: 'member' }));
      assert.equal(app.text('#toast'), '', 'a message you sent yourself');
      await close();

      const maker = PERSONAS.creator();
      await open({ api: maker, path: '/app' });
      maker.emit(IDS.owner, 'message', messageRow({ member_id: IDS.fan1, sender: 'creator', body: 'my own reply' }));
      assert.equal(app.text('#toast'), '');
      maker.emit(IDS.owner, 'message', messageRow({ member_id: IDS.fan1, sender: 'member', body: 'a question' }));
      assert.match(app.text('#toast'), /New message: a question/);
      await close();
    });
  });

  describe('the account follows the api', () => {
    it('signs in and out with the fake, and lands where the guards say', async () => {
      const fake = createFakeApi({ signedIn: null });
      await open({ api: fake, path: '/app/library' });
      assert.equal(app.path, '/app/login?next=%2Fapp%2Flibrary');
      fake.signInAs(IDS.member);
      await tick(20);
      await app.settle();
      assert.equal(app.path, '/app/library');
      assert.match(app.text('.profile-link'), /Sofia Marchetti/);
      assert.ok(app.store.state.following.has(IDS.verano), 'the seeded follows were loaded');
      await app.click('.account-menu [data-menu-trigger]');
      await app.click('[data-action="sign-out"]');
      assert.equal(app.store.state.user, null);
      assert.equal(app.path, '/app');
      await close();
    });

    it('shows the studio to the owner of an atelier only', async () => {
      await open({ api: PERSONAS.creator(), path: '/app/studio/new' });
      assert.equal(app.path, '/app/studio/new');
      assert.ok(app.exists('.new-post'));
      assert.equal(app.store.state.myCreator.slug, 'verne-and-co');
      await close();
    });
  });

  describe('accounts changing under an open page', () => {
    it('redraws the chrome when a guest signs in and again after sign-out', async () => {
      const api = PERSONAS.guest();
      await open({ api });
      assert.equal(app.exists('.account-menu'), false);
      api.signInAs(IDS.owner);
      await tick(10);
      assert.ok(app.exists('.account-menu'));
      assert.ok(app.exists('.new-post'));
      assert.match(app.text('.profile-link'), /owner@example\.test/);
      api.signOut();
      await tick(10);
      assert.equal(app.exists('.account-menu'), false);
      assert.equal(app.exists('.new-post'), false);
      await close();
    });

    it('updates the name and picture when the profile changes', async () => {
      await open({ api: PERSONAS.member() });
      app.store.update({ profile: { id: IDS.member, name: 'Sofia M.', avatarUrl: null } });
      assert.match(app.text('.profile-link'), /Sofia M\./);
      await close();
    });
  });
});
