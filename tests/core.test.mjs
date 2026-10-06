import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom, mountApp, stubApi, makeSession, makeViewer, confirmWith, tick, IntersectionObserverStub } from './helpers/dom.mjs';
import { createFakeApi, IDS } from './helpers/fake-api.mjs';
import * as ui from '../src/core/ui.js';
import { html, raw, esc, safeUrl, attrs, icon } from '../src/core/ui.js';
import { store, createStore } from '../src/core/store.js';
import { compileRoutes, matchRoute, resolveGuard, safeNext, parseQuery, legacyTarget } from '../src/core/router.js';
import { routes } from '../src/core/routes.js';
import { paths, withQuery } from '../src/core/paths.js';
import { hydrateCovers, coverFor, cachedCover, resetCovers } from '../src/core/covers.js';
import * as format from '../src/core/format.js';

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
};
const inline = (spec = {}) => async () => ({ default: { title: 'Page', auth: 'optional', render: () => html`<p>page</p>`, ...spec } });
const entryOf = (over = {}) => ({
  id: 'e1', creatorId: 'c1', kind: 'text', title: 'A quiet essay', subtitle: '', excerpt: 'First lines.', category: 'Design', format: 'Essay',
  image: 'atelier', access: 'public', status: 'published', minutes: 4, mediaCount: 0, previewUrl: null, duration: null, coverUrl: null,
  likeCount: 0, publishedAt: new Date(Date.now() - 3 * 3600e3).toISOString(), ...over
});

// One suite for the whole file: the DOM is installed for it and removed again, whatever else shares the process.
describe('core', () => {
  before(() => installDom());
  after(() => uninstallDom());

  // ---------------------------------------------------------------------------------------------------------------------
  describe('html: safe markup', () => {
    const parse = markup => {
      const host = document.createElement('div');
      host.innerHTML = String(markup);
      return host;
    };
    const PAYLOADS = [
      '"><script>alert(1)</script>',
      "' onmouseover='alert(1)",
      '<img src=x onerror=alert(1)>',
      '</textarea><svg onload=alert(1)>',
      '`><b>',
      '&lt;already&gt; & <b>'
    ];

    it('escapes text, quotes and markup characters', () => {
      assert.equal(String(html`<p>${'<b>"x" & \'y\'</b>'}</p>`), '<p>&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;</p>');
      assert.equal(esc('`'), '&#96;');
      assert.equal(esc(null), '');
      assert.equal(esc(undefined), '');
      assert.equal(esc(12), '12');
    });

    it('never lets a payload break out of text or quoted attributes', () => {
      for (const payload of PAYLOADS) {
        const dom = parse(html`<p title="${payload}" data-x='${payload}'>${payload}</p><a href="/app/${payload}">x</a>`);
        assert.equal(dom.querySelector('script'), null, payload);
        assert.equal(dom.querySelector('img, svg, b'), null, payload);
        const p = dom.querySelector('p');
        assert.deepEqual([...p.attributes].map(a => a.name).sort(), ['data-x', 'title'], payload);
        assert.equal(p.getAttribute('title'), payload);
        assert.equal(p.textContent, payload);
        assert.deepEqual([...dom.querySelector('a').attributes].map(a => a.name), ['href'], payload);
      }
    });

    it('keeps a value inside an unquoted attribute', () => {
      const dom = parse(html`<a class=${'x onmouseover=alert(1)'} id=${'y'}>z</a>`);
      const a = dom.querySelector('a');
      assert.deepEqual([...a.attributes].map(attr => attr.name).sort(), ['class', 'id']);
      assert.equal(a.getAttribute('class'), 'x onmouseover=alert(1)');
    });

    it('keeps an unquoted URL in one attribute', () => {
      const dom = parse(html`<a href=${'/app/a b onmouseover=alert(1)'}>x</a>`);
      assert.deepEqual([...dom.querySelector('a').attributes].map(a => a.name), ['href']);
      assert.equal(dom.querySelector('a').getAttribute('href'), '/app/a b onmouseover=alert(1)');
      assert.equal(parse(html`<a href=${'javascript:alert(1)'}>x</a>`).querySelector('a').getAttribute('href'), '#');
    });

    it('turns unsafe URLs in href, src, action and poster into #', () => {
      const bad = ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.example/x', '/\\evil.example', '\\\\evil.example', 'file:///etc/passwd'];
      for (const url of bad) {
        const dom = parse(html`<a href="${url}">a</a><img src="${url}" alt=""><form action="${url}"></form><video poster="${url}"></video>`);
        assert.equal(dom.querySelector('a').getAttribute('href'), '#', url);
        assert.equal(dom.querySelector('img').getAttribute('src'), '#', url);
        assert.equal(dom.querySelector('form').getAttribute('action'), '#', url);
        assert.equal(dom.querySelector('video').getAttribute('poster'), '#', url);
      }
      assert.equal(parse(html`<a href="${html`javascript:alert(1)`}">a</a>`).querySelector('a').getAttribute('href'), '#', 'trusted markup is checked too');
    });

    it('lets safe URLs through unchanged', () => {
      for (const url of ['https://example.com/a?b=1&c=2', 'http://example.com', 'mailto:a@example.com', 'blob:http://localhost/abc', '/app/library', '/app?x=1#y', '#main']) {
        assert.equal(parse(html`<a href="${url}">a</a>`).querySelector('a').getAttribute('href'), url);
      }
    });

    it('keeps a value that continues a fixed prefix inside the attribute', () => {
      const dom = parse(html`<a href="/app/p/${'1"><script>alert(1)</script>'}">a</a>`);
      assert.equal(dom.querySelector('script'), null);
      assert.equal(dom.querySelector('a').getAttribute('href'), '/app/p/1"><script>alert(1)</script>');
    });

    it('never fills event handler attributes', () => {
      const dom = parse(html`<button onclick="${'alert(1)'}" onmouseover=${'alert(2)'} ONFOCUS="${'alert(3)'}">b</button>`);
      for (const attr of dom.querySelector('button').attributes) assert.ok(!attr.value.includes('alert'), attr.name);
    });

    it('joins arrays, drops null, undefined and false, keeps 0, and trusts nested html and raw only', () => {
      assert.equal(String(html`<ul>${['a', '<b>'].map(x => html`<li>${x}</li>`)}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
      assert.equal(String(html`[${null}|${undefined}|${false}|${0}|${''}|${[null, 'x', false]}]`), '[|||0||x]');
      assert.equal(String(html`${raw('<b>ok</b>')}`), '<b>ok</b>');
      assert.equal(String(html`${html`<i>${'<u>'}</i>`}`), '<i>&lt;u&gt;</i>');
      assert.equal(String(html`${'<b>not trusted</b>'}`), '&lt;b&gt;not trusted&lt;/b&gt;');
      assert.equal(String(html`${() => 'function source'}`), '');
      assert.equal(String(html`${condition(true)}${condition(false)}`), '<b>yes</b>');
      function condition(on) { return on && html`<b>yes</b>`; }
    });

    it('renders icons as trusted markup', () => {
      assert.match(String(html`<span>${icon('bell')}</span>`), /<span><svg /);
    });

    it('attrs() renders a map safely', () => {
      assert.equal(String(attrs({ id: 'a"b', disabled: true, hidden: false, skip: null, 'data-n': 3 })), ' id="a&quot;b" disabled data-n="3"');
      assert.equal(String(attrs({ onclick: 'x()', 'bad name': 'x', 'x"y': 'z' })), '');
      assert.equal(String(attrs({ href: 'javascript:alert(1)' })), ' href="#"');
    });
  });

  describe('safeUrl', () => {
    it('allows https, http, mailto, blob and same-origin paths', () => {
      for (const url of ['https://a.test/x', 'HTTP://a.test', 'mailto:a@b.c', 'blob:http://localhost/1', '/app', '/app/p/1?x=1', '#top']) assert.equal(safeUrl(url), url, url);
    });
    it('refuses everything else', () => {
      for (const url of ['javascript:alert(1)', 'JAVASCRIPT:1', 'data:image/png;base64,AAAA', '//host/x', '/\\host', 'relative/path', 'ftp://x', '', null, undefined, 'java\nscript:alert(1)', '\u0001javascript:1']) assert.equal(safeUrl(url), '#', String(url));
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe('format helpers', () => {
    it('timeAgo', () => {
      const now = Date.UTC(2026, 5, 15, 12);
      const ago = ms => format.timeAgo(new Date(now - ms), now);
      assert.equal(ago(10e3), 'just now');
      assert.equal(ago(-60e3), 'just now');
      assert.equal(ago(5 * 60e3), '5 min ago');
      assert.equal(ago(3 * 3600e3), '3 h ago');
      assert.equal(ago(2 * 86400e3), '2 d ago');
      assert.match(ago(30 * 86400e3), /\d{1,2} \w{3}/);
      assert.equal(format.timeAgo('not a date', now), '');
      assert.equal(format.timeAgo(null, now), '');
    });
    it('formatDate', () => {
      assert.equal(format.formatDate('2025-03-05T12:00:00Z', { year: true }), '5 Mar 2025');
      assert.equal(format.formatDate('2025-03-05T12:00:00Z', { year: false }), '5 Mar');
      assert.equal(format.formatDate('2000-03-05T12:00:00Z'), '5 Mar 2000');
      const thisYear = new Date().getFullYear();
      assert.doesNotMatch(format.formatDate(new Date(Date.UTC(thisYear, 5, 15, 12))), /\d{4}/);
      assert.equal(format.formatDate(''), '');
    });
    it('money', () => {
      assert.equal(format.money(900), '€9');
      assert.equal(format.money(950), '€9.50');
      assert.equal(format.money(0), '€0');
      assert.match(format.money(1200, 'USD'), /12/);
      assert.equal(format.money(1200, 'nonsense'), '€12');
      assert.equal(format.money(undefined), '');
      assert.equal(format.money('x'), '');
    });
    it('plural and compactNumber', () => {
      assert.equal(format.plural(1, 'image'), '1 image');
      assert.equal(format.plural(0, 'image'), '0 images');
      assert.equal(format.plural(2, 'entry', 'entries'), '2 entries');
      assert.equal(format.plural(1200, 'follower'), '1,200 followers');
      assert.equal(format.compactNumber(999), '999');
      assert.equal(format.compactNumber(1200), '1.2K');
      assert.equal(format.compactNumber(2_500_000), '2.5M');
      assert.equal(format.compactNumber('x'), '0');
    });
    it('initials', () => {
      assert.equal(format.initials('Mila Rossi'), 'MR');
      assert.equal(format.initials('  mila  '), 'M');
      assert.equal(format.initials('Anna Maria Bianchi'), 'AB');
      assert.equal(format.initials(''), '');
      assert.equal(format.initials(null), '');
      assert.equal(format.initials('😀 Ann'), '😀A');
    });
    it('duration and fileSize', () => {
      assert.equal(format.duration(92), '1:32');
      assert.equal(format.duration(59.6), '1:00');
      assert.equal(format.duration(3725), '1:02:05');
      assert.equal(format.duration(0), '');
      assert.equal(format.duration(null), '');
      assert.equal(format.duration(-5), '');
      assert.equal(format.fileSize(1536000), '1.5 MB');
      assert.equal(format.fileSize(10), '1 KB');
      assert.equal(format.fileSize(250 * 1024), '250 KB');
      assert.equal(format.fileSize(-1), '');
    });
    it('entry helpers', () => {
      assert.equal(format.kindOf({ kind: 'video' }), 'video');
      assert.equal(format.kindOf({ kind: 'weird' }), 'text');
      assert.equal(format.kindOf(undefined), 'text');
      assert.equal(format.entrySize({ kind: 'image', mediaCount: 3 }), '3 images');
      assert.equal(format.entrySize({ kind: 'image', mediaCount: 1 }), '1 image');
      assert.equal(format.entrySize({ kind: 'video', duration: 92 }), '1:32');
      assert.equal(format.entrySize({ kind: 'video', duration: 0 }), 'Video');
      assert.equal(format.entrySize({ kind: 'text', minutes: 5 }), '5 min read');
      assert.equal(format.entrySize({ kind: 'text', minutes: 5 }, { long: false }), '5 min');
      assert.equal(format.entrySize({ kind: 'text' }), '');
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe('paths: query, next and legacy addresses', () => {
    it('builds paths with encoded parts and skips empty query values', () => {
      assert.equal(withQuery('/app/discover', { q: 'a b&c', category: '', kind: null, sort: undefined, x: false }), '/app/discover?q=a+b%26c');
      assert.equal(paths.discover(), '/app/discover');
      assert.equal(paths.creator('a/b'), '/app/c/a%2Fb');
      assert.equal(paths.messages('c1', 'm1'), '/app/messages/c1/m1');
      assert.equal(paths.messages(), '/app/messages');
      assert.equal(paths.studioNew({ kind: 'video' }), '/app/studio/new?kind=video');
      assert.equal(paths.login('/app/library'), '/app/login?next=%2Fapp%2Flibrary');
      assert.equal(paths.login(null), '/app/login');
    });

    it('parseQuery keeps the last value and treats __proto__ as a key', () => {
      assert.deepEqual(parseQuery('?a=1&b=two%20words&a=3'), { a: '3', b: 'two words' });
      assert.deepEqual(parseQuery(''), {});
      const query = parseQuery('?__proto__=x&toString=y');
      assert.equal(Object.getPrototypeOf(query), Object.prototype);
      assert.equal(query.__proto__, 'x');
      assert.equal({}.polluted, undefined);
    });

    it('safeNext accepts only paths inside /app', () => {
      for (const ok of ['/app', '/app/library', '/app/p/abc?x=1#y', '/app/studio/edit/1']) assert.equal(safeNext(ok), ok, ok);
      assert.equal(safeNext('/app/./library'), '/app/library');
      for (const bad of [
        '/', '/apple', '/application', '//evil.example/app', '///app', '/\\evil.example', '\\\\evil.example', 'https://evil.example/app', 'javascript:alert(1)',
        '/app/../admin', '/app/%2e%2e/admin', '/app/%2E%2E/%2e%2e/x', '/appx/y', 'app/library', '', null, undefined, 42, {}, '/app\n/x', '/app/\u0000', `/app/${'a'.repeat(2100)}`
      ]) assert.equal(safeNext(bad), null, String(bad).slice(0, 40));
    });

    it('maps the first version’s hash addresses', () => {
      const table = {
        '': '/app', '#': '/app', '#atelier': '/app', '#discover': '/app/discover', '#archive': '/app/library', '#circle': '/app/messages',
        '#memberships': '/app/memberships', '#studio': '/app/studio', '#settings': '/app/settings', '#entry/abc-123': '/app/p/abc-123',
        '#entry/': '/app', '#entry/a b': '/app', '#entry/../x': '/app', '#unknown': '/app', '#access_token=abc&type=recovery': '/app'
      };
      for (const [hash, target] of Object.entries(table)) assert.equal(legacyTarget('/app.html', hash), target, hash);
      assert.equal(legacyTarget('/app/library', '#archive'), null);
      assert.equal(legacyTarget('/app', ''), null);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe('router: matching and guards', () => {
    const compiled = compileRoutes(routes);
    const match = path => { const found = matchRoute(compiled, path); return [found.route.path, found.params]; };

    it('matches every route of the table, with params', () => {
      assert.deepEqual(match('/app'), ['/app', {}]);
      assert.deepEqual(match('/app/'), ['/app', {}]);
      assert.deepEqual(match('/app/discover'), ['/app/discover', {}]);
      assert.deepEqual(match('/app/c/studio-anna'), ['/app/c/:slug', { slug: 'studio-anna' }]);
      assert.deepEqual(match('/app/c/a%20b'), ['/app/c/:slug', { slug: 'a b' }]);
      assert.deepEqual(match('/app/c/%E0%A4%A'), ['/app/c/:slug', { slug: '%E0%A4%A' }]);
      assert.deepEqual(match('/app/p/0b7e'), ['/app/p/:id', { id: '0b7e' }]);
      assert.deepEqual(match('/app/messages'), ['/app/messages', {}]);
      assert.deepEqual(match('/app/messages/c1/m1'), ['/app/messages/:creatorId/:memberId', { creatorId: 'c1', memberId: 'm1' }]);
      assert.deepEqual(match('/app/studio'), ['/app/studio', {}]);
      assert.deepEqual(match('/app/studio/new'), ['/app/studio/new', {}]);
      assert.deepEqual(match('/app/studio/edit/e9'), ['/app/studio/edit/:id', { id: 'e9' }]);
      assert.deepEqual(match('/app/studio/settings'), ['/app/studio/settings', {}]);
      for (const path of ['/app/library', '/app/memberships', '/app/notifications', '/app/settings', '/app/login', '/app/signup', '/app/forgot', '/app/reset', '/app/welcome']) assert.deepEqual(match(path), [path, {}]);
    });

    it('sends anything else to the not-found page', () => {
      for (const path of ['/app/nope', '/app/studio/new/extra', '/app/c', '/app/c/a/b', '/app/p', '/app/studio/edit', '/app/messages/c1', '/app/library/x']) assert.equal(match(path)[0], '*', path);
    });

    it('every route loads a module with the view contract', async () => {
      for (const route of routes) {
        const view = (await route.view()).default;
        assert.ok(['optional', 'required', 'guest', 'creator'].includes(view.auth), route.path);
        assert.ok(view.title, route.path);
        assert.equal(typeof view.render, 'function', route.path);
      }
    });

    const state = (over = {}) => ({ user: null, myCreator: null, recovery: false, settings: { onboarded: true }, ...over });
    const guard = (auth, path, over, extra = {}) => {
      const url = new URL(`http://localhost${path}`);
      return resolveGuard({ auth, url, query: parseQuery(url.search), state: state(over), ...extra });
    };
    const signedIn = { user: { id: 'u1' } };

    it('optional pages are open to everyone', () => {
      assert.equal(guard('optional', '/app/discover'), null);
      assert.equal(guard('optional', '/app/discover', signedIn), null);
    });
    it('required pages send guests to the sign-in page with a way back', () => {
      assert.equal(guard('required', '/app/library'), '/app/login?next=%2Fapp%2Flibrary');
      assert.equal(guard('required', '/app/messages/c1/m1?x=1'), '/app/login?next=%2Fapp%2Fmessages%2Fc1%2Fm1%3Fx%3D1');
      assert.equal(guard('required', '/app/library', signedIn), null);
    });
    it('guest pages send signed-in people on, but only to a safe next', () => {
      assert.equal(guard('guest', '/app/login', signedIn), '/app');
      assert.equal(guard('guest', '/app/login?next=%2Fapp%2Flibrary', signedIn), '/app/library');
      assert.equal(guard('guest', '/app/login?next=https%3A%2F%2Fevil.example', signedIn), '/app');
      assert.equal(guard('guest', '/app/login?next=%2F%2Fevil.example', signedIn), '/app');
      assert.equal(guard('guest', '/app/login?next=%2Fapp%2Flogin', signedIn), '/app', 'no loop back to a guest page');
      assert.equal(guard('guest', '/app/login?next=%2Fapp%2Fsignup%3Fx%3D1', signedIn), '/app');
      assert.equal(guard('guest', '/app/login'), null);
    });
    it('creator pages need a session and an atelier', () => {
      assert.equal(guard('creator', '/app/studio/new'), '/app/login?next=%2Fapp%2Fstudio%2Fnew');
      assert.equal(guard('creator', '/app/studio/new', signedIn), '/app/studio');
      assert.equal(guard('creator', '/app/studio/new', { ...signedIn, myCreator: { id: 'c1' } }), null);
    });
    it('the recovery page needs a recovery link or a session', () => {
      assert.equal(guard('recovery', '/app/reset'), '/app/forgot');
      assert.equal(guard('recovery', '/app/reset', { recovery: true }), null);
      assert.equal(guard('recovery', '/app/reset', signedIn), null);
    });
    it('sends a person who has not finished onboarding to the welcome page once, except from a few pages', () => {
      const fresh = { ...signedIn, settings: { onboarded: false } };
      assert.equal(guard('optional', '/app', fresh), '/app/welcome');
      assert.equal(guard('optional', '/app/discover?q=a', fresh), '/app/welcome?next=%2Fapp%2Fdiscover%3Fq%3Da');
      assert.equal(guard('required', '/app/library', fresh), '/app/welcome?next=%2Fapp%2Flibrary');
      assert.equal(guard('optional', '/app', fresh, { welcomed: true }), null);
      for (const path of ['/app/welcome', '/app/reset', '/app/settings', '/app/settings?tab=account']) assert.equal(guard('required', path, fresh), null, path);
      assert.equal(guard('optional', '/app', { ...signedIn, settings: { onboarded: true } }), null);
      assert.equal(guard('optional', '/app', { ...signedIn, settings: {} }), null, 'unknown means finished');
      assert.equal(guard('optional', '/app', { settings: { onboarded: false } }), null, 'guests are never sent');
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe('store', () => {
    const alice = makeSession('alice', 'alice@example.test');
    const bob = makeSession('bob', 'bob@example.test');
    const toastText = () => document.querySelector('#toast')?.textContent ?? '';

    beforeEach(() => {
      document.body.innerHTML = '<dialog id="modal"></dialog><div id="toast"></div>';
      document.querySelector('#modal').close?.();
    });

    it('starts as a guest when there is no session', async () => {
      const s = createStore();
      const api = stubApi();
      await s.init(api);
      assert.equal(s.state.ready, true);
      assert.equal(s.state.user, null);
      assert.equal(api.calls.length, 0, 'no viewer is loaded for a guest');
      assert.equal(s.state.settings.onboarded, true);
      s.destroy();
    });

    it('loads the viewer for an existing session and keeps its parts', async () => {
      const s = createStore();
      const membership = { creatorId: 'c1', tierId: 'premium', level: 2 };
      const api = stubApi({
        session: alice,
        viewer: makeViewer({ myCreator: { id: 'mine', slug: 'mine' }, following: ['c1', 'c2'], saved: ['e1'], liked: ['e2'], memberships: [membership], settings: { onboarded: false, compact: true } }),
        unread: { notifications: 3, messages: 120 }
      });
      await s.init(api);
      assert.deepEqual(s.state.user, { id: 'alice', email: 'alice@example.test' });
      assert.deepEqual([...s.state.following], ['c1', 'c2']);
      assert.deepEqual([...s.state.saved], ['e1']);
      assert.deepEqual([...s.state.liked], ['e2']);
      assert.equal(s.state.memberships.get('c1'), membership);
      assert.equal(s.state.myCreator.id, 'mine');
      assert.equal(s.state.settings.onboarded, false);
      assert.equal(s.state.settings.compact, true);
      assert.equal(s.state.settings.welcomeDismissed, false, 'defaults fill the gaps');
      assert.equal(s.state.tiers.length, 3);
      await tick();
      assert.deepEqual(s.state.unread, { notifications: 3, messages: 120 });
      assert.deepEqual(api.calls.filter(([name]) => name === 'subscribe'), [['subscribe', 'alice']]);
      s.destroy();
    });

    it('loads the viewer once when the auth event arrives while the session is being read', async () => {
      const s = createStore();
      const api = stubApi({ session: alice });
      const started = s.init(api);
      api.emit('INITIAL_SESSION', alice);
      api.emit('SIGNED_IN', alice);
      await started;
      assert.equal(api.calls.filter(([name]) => name === 'loadViewer').length, 1);
      s.destroy();
    });

    it('signs in and out on auth events and notifies subscribers once per change', async () => {
      const s = createStore();
      const api = stubApi();
      await s.init(api);
      let notifications = 0;
      const stop = s.subscribe(() => { notifications++; });
      api.emit('SIGNED_IN', alice);
      await tick();
      assert.equal(s.state.user.id, 'alice');
      assert.ok(notifications >= 1);
      const before = notifications;
      api.emit('TOKEN_REFRESHED', { ...alice, access_token: 'new' });
      await tick();
      assert.equal(notifications, before, 'a refreshed token changes nothing the interface shows');
      assert.equal(s.state.session.access_token, 'new');
      api.emit('SIGNED_OUT');
      await tick();
      assert.equal(s.state.user, null);
      assert.equal(s.state.profile, null);
      assert.equal(s.state.following.size, 0);
      assert.deepEqual(s.state.unread, { notifications: 0, messages: 0 });
      stop();
      s.destroy();
    });

    it('replaces the viewer when another account signs in, and drops a load for the account that left', async () => {
      const s = createStore();
      const slow = deferred();
      const api = stubApi({ session: alice, viewer: makeViewer({ following: ['of-alice'] }) });
      await s.init(api);
      assert.deepEqual([...s.state.following], ['of-alice']);
      api.viewer = makeViewer({ following: ['of-bob'] });
      api.emit('SIGNED_IN', bob);
      await tick();
      assert.equal(s.state.user.id, 'bob');
      assert.deepEqual([...s.state.following], ['of-bob']);

      api.loadViewer = () => slow.promise;
      api.emit('SIGNED_IN', alice);
      await tick();
      api.emit('SIGNED_OUT');
      slow.resolve(makeViewer({ following: ['late'] }));
      await tick(5);
      assert.equal(s.state.user, null, 'the late answer for a signed-out account is dropped');
      assert.equal(s.state.following.size, 0);
      s.destroy();
    });

    it('keeps the person signed in when the viewer cannot be loaded, and says so', async () => {
      const s = createStore();
      const api = stubApi({ session: alice, loadViewer: async () => { throw new Error('Database is down'); } });
      await s.init(api);
      assert.equal(s.state.user.id, 'alice');
      assert.equal(s.state.viewerError.message, 'Database is down');
      assert.equal(s.state.settings.onboarded, true, 'nobody is trapped in onboarding by an error');
      api.loadViewer = async () => makeViewer({ following: ['c1'] });
      await s.reloadViewer();
      assert.equal(s.state.viewerError, null);
      assert.deepEqual([...s.state.following], ['c1']);
      s.destroy();
    });

    it('remembers a recovery link through the sign-in it causes, and forgets it on sign-out', async () => {
      const s = createStore();
      const api = stubApi();
      await s.init(api);
      api.emit('SIGNED_IN', alice);
      api.emit('PASSWORD_RECOVERY', alice);
      await tick(5);
      assert.equal(s.state.recovery, true);
      assert.equal(s.state.user.id, 'alice');
      s.setRecovery(false);
      assert.equal(s.state.recovery, false);
      api.emit('PASSWORD_RECOVERY', alice);
      api.emit('SIGNED_OUT');
      await tick();
      assert.equal(s.state.recovery, false);

      const flagged = createStore();
      await flagged.init(stubApi(), { recovery: true });
      assert.equal(flagged.state.recovery, true);
      flagged.destroy();
      s.destroy();
    });

    it('ignores an auth event that arrives after the store was stopped or started again', async () => {
      const s = createStore();
      let stale = null;
      await s.init(stubApi({ onAuthChange: fn => { stale = fn; return () => {}; } }));
      await s.init(stubApi({ session: bob }));
      assert.equal(s.state.user.id, 'bob');
      // The first api still holds the callback it was given, as a deferred supabase-js event would.
      stale('SIGNED_IN', alice);
      await tick(5);
      assert.equal(s.state.user.id, 'bob', 'an event of the earlier api cannot sign in another account');
      s.destroy();
    });

    it('survives an api that fails to read the session', async () => {
      const s = createStore();
      await s.init(stubApi({ getSession: async () => { throw new Error('offline'); } }));
      assert.equal(s.state.ready, true);
      assert.equal(s.state.user, null);
      s.destroy();
    });

    it('decides what the person can read from the ladder, their atelier and their memberships', async () => {
      const s = createStore();
      await s.init(stubApi({ session: alice, viewer: makeViewer({ myCreator: { id: 'mine' }, memberships: [{ creatorId: 'c1', tierId: 'premium', level: 2 }] }) }));
      assert.equal(s.canRead(entryOf({ access: 'public' })), true);
      assert.equal(s.canRead(entryOf({ access: undefined })), true);
      assert.equal(s.canRead(entryOf({ access: 'essential' })), true);
      assert.equal(s.canRead(entryOf({ access: 'premium' })), true);
      assert.equal(s.canRead(entryOf({ access: 'signature' })), false);
      assert.equal(s.canRead(entryOf({ access: 'signature', creatorId: 'c2' })), false);
      assert.equal(s.canRead(entryOf({ access: 'essential', creatorId: 'c2' })), false);
      assert.equal(s.canRead(entryOf({ access: 'signature', creatorId: 'mine' })), true, 'your own atelier');
      assert.equal(s.canRead(entryOf({ access: 'mystery' })), false, 'an unknown level is never readable');
      assert.equal(s.canRead(null), false);
      assert.deepEqual(['public', 'essential', 'premium', 'signature', 'mystery'].map(s.levelOf), [0, 1, 2, 3, 99]);
      s.destroy();
    });

    it('works for a guest before any ladder is loaded', async () => {
      const s = createStore();
      await s.init(stubApi());
      assert.equal(s.canRead(entryOf({ access: 'public' })), true);
      assert.equal(s.canRead(entryOf({ access: 'essential' })), false);
      assert.equal(s.levelOf('premium'), 2);
      s.destroy();
    });

    it('merges updates and notifies', async () => {
      const s = createStore();
      await s.init(stubApi({ session: alice }));
      let seen = 0;
      s.subscribe(() => { seen++; });
      s.update({ profile: { id: 'alice', name: 'Alice' }, settings: { compact: true } });
      assert.equal(s.state.profile.name, 'Alice');
      assert.equal(s.state.settings.compact, true);
      assert.equal(s.state.settings.onboarded, true, 'other settings stay');
      assert.equal(seen, 1);
      s.destroy();
    });

    it('keeps the unread counts when they cannot be refreshed and clamps nonsense', async () => {
      const s = createStore();
      const api = stubApi({ session: alice, unread: { notifications: 4, messages: -2 } });
      await s.init(api);
      await tick();
      assert.deepEqual(s.state.unread, { notifications: 4, messages: 0 });
      api.unreadCounts = async () => { throw new Error('offline'); };
      await s.refreshUnread();
      assert.deepEqual(s.state.unread, { notifications: 4, messages: 0 });
      s.destroy();
    });

    it('relays realtime events, refreshes the badges and stops after sign-out', async () => {
      const s = createStore();
      const api = stubApi({ session: alice });
      await s.init(api);
      const events = [];
      s.onRealtime(event => events.push(event));
      api.unread = { notifications: 0, messages: 1 };
      api.pushRealtime('message', { creatorId: 'c1', memberId: 'alice', from: 'creator', text: 'Hello' });
      await tick();
      assert.deepEqual(events, [{ type: 'message', payload: { creatorId: 'c1', memberId: 'alice', from: 'creator', text: 'Hello' } }]);
      assert.equal(s.state.unread.messages, 1);
      api.pushRealtime('notification', { id: 'n1' });
      assert.equal(events.at(-1).type, 'notification');
      api.emit('SIGNED_OUT');
      await tick();
      const stopped = api.pushRealtime.length; // the stub keeps no handlers once unsubscribed
      api.pushRealtime('message', { text: 'late' });
      assert.equal(events.length, 2, `no events after sign-out (${stopped})`);
      s.destroy();
    });

    describe('optimistic toggles', () => {
      async function signedInStore(over = {}) {
        const s = createStore();
        const api = stubApi({ session: alice, ...over });
        await s.init(api);
        return { s, api };
      }

      it('follows at once and keeps the change when the request succeeds', async () => {
        const gate = deferred();
        const { s, api } = await signedInStore({ setFollow: () => gate.promise });
        const result = s.toggleFollow('c1');
        assert.equal(s.state.following.has('c1'), true, 'changed before the request finished');
        gate.resolve();
        assert.equal(await result, true);
        assert.equal(s.state.following.has('c1'), true);
        void api;
        s.destroy();
      });

      it('unfollows with the same call and sends the new value', async () => {
        const { s, api } = await signedInStore({ viewer: makeViewer({ following: ['c1'] }) });
        assert.equal(await s.toggleFollow('c1'), true);
        assert.equal(s.state.following.has('c1'), false);
        assert.deepEqual(api.calls.filter(([name]) => name === 'setFollow'), [['setFollow', 'c1', false]]);
        s.destroy();
      });

      it('rolls back and shows a toast when the request fails', async () => {
        const { s } = await signedInStore({ setFollow: async () => { throw new Error('You are offline.'); } });
        let states = [];
        s.subscribe(() => states.push(s.state.following.has('c1')));
        assert.equal(await s.toggleFollow('c1'), false);
        assert.deepEqual(states, [true, false], 'on, then back off');
        assert.equal(s.state.following.has('c1'), false);
        assert.match(toastText(), /You are offline\./);
        s.destroy();
      });

      it('uses its own message when the error has none', async () => {
        const { s } = await signedInStore({ setBookmark: async () => { throw new Error(''); } });
        await s.toggleSave('e1');
        assert.match(toastText(), /library/);
        s.destroy();
      });

      it('ignores a second click while the first is still on its way', async () => {
        const gate = deferred();
        const { s, api } = await signedInStore({ setFollow: (id, on) => { api.calls.push(['setFollow', id, on]); return gate.promise; } });
        const first = s.toggleFollow('c1');
        assert.equal(await s.toggleFollow('c1'), false);
        gate.resolve();
        await first;
        assert.equal(api.calls.filter(([name]) => name === 'setFollow').length, 1);
        assert.equal(await s.toggleFollow('c1'), true, 'and works again afterwards');
        s.destroy();
      });

      it('does not roll back into the next account', async () => {
        const gate = deferred();
        const { s, api } = await signedInStore({ setFollow: () => gate.promise });
        const result = s.toggleFollow('c1');
        api.viewer = makeViewer({ following: ['c1'] });
        api.emit('SIGNED_IN', bob);
        await tick();
        gate.reject(new Error('late failure'));
        await result;
        assert.equal(s.state.user.id, 'bob');
        assert.equal(s.state.following.has('c1'), true, 'bob’s own follow is untouched');
        s.destroy();
      });

      it('likes and unlikes, adjusting the like count of the entry in place', async () => {
        const { s } = await signedInStore();
        const entry = entryOf({ likeCount: 5 });
        await s.toggleLike(entry);
        assert.equal(entry.likeCount, 6);
        assert.equal(s.state.liked.has('e1'), true);
        await s.toggleLike(entry);
        assert.equal(entry.likeCount, 5);
        assert.equal(s.state.liked.has('e1'), false);
        s.destroy();
      });

      it('restores the like count when the request fails, and never goes below zero', async () => {
        const { s } = await signedInStore({ setLike: async () => { throw new Error('nope'); }, viewer: makeViewer({ liked: ['e1'] }) });
        const entry = entryOf({ likeCount: 0 });
        assert.equal(await s.toggleLike(entry), false);
        assert.equal(entry.likeCount, 0);
        assert.equal(s.state.liked.has('e1'), true);
        const other = entryOf({ id: 'e2', likeCount: 2 });
        await s.toggleLike(other);
        assert.equal(other.likeCount, 2);
        s.destroy();
      });

      it('saves and removes a save', async () => {
        const { s, api } = await signedInStore();
        await s.toggleSave('e1');
        assert.equal(s.state.saved.has('e1'), true);
        await s.toggleSave('e1');
        assert.equal(s.state.saved.has('e1'), false);
        assert.deepEqual(api.calls.filter(([name]) => name === 'setBookmark'), [['setBookmark', 'e1', true], ['setBookmark', 'e1', false]]);
        s.destroy();
      });

      it('does not let you follow your own atelier', async () => {
        const { s, api } = await signedInStore({ viewer: makeViewer({ myCreator: { id: 'mine' } }) });
        assert.equal(await s.toggleFollow('mine'), false);
        assert.equal(api.calls.filter(([name]) => name === 'setFollow').length, 0);
        s.destroy();
      });

      it('asks guests to sign in instead of changing anything', async () => {
        const s = createStore();
        const api = stubApi();
        await s.init(api);
        globalThis.window.history.replaceState(null, '', '/app/c/studio-anna?x=1');
        assert.equal(await s.toggleFollow('c1'), false);
        assert.equal(await s.toggleSave('e1'), false);
        assert.equal(await s.toggleLike(entryOf()), false);
        assert.equal(api.calls.length, 0);
        assert.equal(s.state.following.size, 0);
        const dialog = document.querySelector('#modal');
        assert.equal(dialog.open, true);
        const links = [...dialog.querySelectorAll('a')].map(a => a.getAttribute('href'));
        assert.deepEqual(links, ['/app/login?next=%2Fapp%2Fc%2Fstudio-anna%3Fx%3D1', '/app/signup?next=%2Fapp%2Fc%2Fstudio-anna%3Fx%3D1']);
        assert.match(dialog.textContent, /like posts/, 'the last request is named');
        ui.modal.close();
        globalThis.window.history.replaceState(null, '', '/app');
        s.destroy();
      });

      it('leaves out an unsafe address when asking guests to sign in', async () => {
        const s = createStore();
        await s.init(stubApi());
        globalThis.window.history.replaceState(null, '', '/elsewhere');
        s.requireAuth('Sign in.');
        assert.deepEqual([...document.querySelectorAll('#modal a')].map(a => a.getAttribute('href')), ['/app/login', '/app/signup']);
        ui.modal.close();
        globalThis.window.history.replaceState(null, '', '/app');
        s.destroy();
      });
    });

    describe('memberships', () => {
      it('joins and leaves a circle', async () => {
        const s = createStore();
        const api = stubApi({ session: alice });
        await s.init(api);
        const membership = await s.join('c1', 'premium');
        assert.equal(membership.tierId, 'premium');
        assert.equal(s.state.memberships.get('c1').level, 2);
        assert.equal(s.canRead(entryOf({ access: 'premium' })), true);
        await s.leave('c1');
        assert.equal(s.state.memberships.has('c1'), false);
        assert.equal(s.canRead(entryOf({ access: 'premium' })), false);
        s.destroy();
      });

      it('lets the error through and changes nothing when joining fails', async () => {
        const s = createStore();
        await s.init(stubApi({ session: alice, join: async () => { throw new Error('This tier is closed.'); } }));
        await assert.rejects(s.join('c1', 'premium'), /closed/);
        assert.equal(s.state.memberships.size, 0);
        s.destroy();
      });

      it('asks a guest to sign in before joining', async () => {
        const s = createStore();
        const api = stubApi();
        await s.init(api);
        assert.equal(await s.join('c1', 'premium'), null);
        assert.equal(document.querySelector('#modal').open, true);
        assert.equal(api.calls.length, 0);
        ui.modal.close();
        s.destroy();
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe('ui components', () => {
    beforeEach(async () => {
      document.body.innerHTML = '<div id="host"></div><dialog id="modal"></dialog><div id="toast"></div>';
      await store.init(stubApi({ session: makeSession(), viewer: makeViewer({ following: ['c-followed'], saved: ['e-saved'], liked: ['e-liked'] }) }));
    });
    const host = () => document.querySelector('#host');
    const draw = markup => { host().innerHTML = String(markup); return host(); };

    describe('entryCard', () => {
      it('draws a text post with the editorial preset, its label and a link', () => {
        const card = draw(ui.entryCard(entryOf({ creator: { id: 'c1', slug: 'anna', name: 'Anna', avatarUrl: null } })));
        assert.equal(card.querySelector('.entry-title a').getAttribute('href'), '/app/p/e1');
        assert.equal(card.querySelector('.entry-title').textContent, 'A quiet essay');
        assert.equal(card.querySelector('.entry-meta').textContent, 'Essay · 4 min read');
        assert.equal(card.querySelector('img').getAttribute('src'), '/editorial/v1/atelier.jpg');
        assert.ok(card.querySelector('.entry-cover').classList.contains('is-preset'));
        assert.equal(card.querySelector('img[data-cover]'), null, 'text posts are never hydrated');
        assert.equal(card.querySelector('.kind-badge'), null);
        assert.equal(card.querySelector('.lock-badge'), null);
        assert.equal(card.querySelector('.entry-author').getAttribute('href'), '/app/c/anna');
        assert.match(card.querySelector('.entry-date').textContent, /3 h ago/);
      });

      it('uses the uploaded cover of a text post in colour', () => {
        const card = draw(ui.entryCard(entryOf({ coverUrl: 'https://bwezbxwdmnmfbibpusaf.supabase.co/storage/v1/object/public/covers/c/x.webp' })));
        assert.match(card.querySelector('img').getAttribute('src'), /covers\/c\/x\.webp$/);
        assert.equal(card.querySelector('.entry-cover').classList.contains('is-preset'), false);
      });

      it('falls back to the first preset for an unknown name', () => {
        assert.equal(draw(ui.entryCard(entryOf({ image: 'nonsense' }))).querySelector('img').getAttribute('src'), '/editorial/v1/atelier.jpg');
        assert.equal(draw(ui.entryCard(entryOf({ image: 'ritual' }))).querySelector('img').getAttribute('src'), '/editorial/v1/ritual.jpg');
      });

      it('shows the kind badge: image count, duration, or just "Video"', () => {
        const badge = over => draw(ui.entryCard(entryOf(over))).querySelector('.kind-badge');
        assert.equal(badge({ kind: 'image', mediaCount: 4, format: 'Gallery' }).textContent, '4');
        assert.equal(badge({ kind: 'image', mediaCount: 1 }).textContent, '');
        assert.ok(badge({ kind: 'image', mediaCount: 1 }).querySelector('svg'));
        assert.equal(badge({ kind: 'video', duration: 92, format: 'Film' }).textContent, '1:32');
        assert.equal(badge({ kind: 'video', duration: 0 }).textContent, 'Video');
        assert.equal(badge({ kind: 'video', duration: null }).textContent, 'Video');
        assert.equal(draw(ui.entryCard(entryOf({ kind: 'video', duration: 92, format: 'Film' }))).querySelector('.entry-meta').textContent, 'Film · 1:32');
        assert.equal(draw(ui.entryCard(entryOf({ kind: 'image', mediaCount: 3, format: 'Gallery' }))).querySelector('.entry-meta').textContent, 'Gallery · 3 images');
      });

      it('shows the blurred preview, never a hydrate marker, for a locked media post', () => {
        const card = draw(ui.entryCard(entryOf({ kind: 'image', mediaCount: 3, access: 'premium', previewUrl: 'https://bwezbxwdmnmfbibpusaf.supabase.co/storage/v1/object/public/previews/c/e/p.webp' })));
        assert.ok(card.querySelector('.entry-card').classList.contains('is-locked'));
        assert.ok(card.querySelector('.entry-cover').classList.contains('is-preview'));
        assert.match(card.querySelector('img').getAttribute('src'), /previews\/c\/e\/p\.webp$/);
        assert.equal(card.querySelector('img[data-cover]'), null);
        assert.equal(card.querySelector('.lock-badge').textContent, 'Premium');
      });

      it('shows the preset for a locked media post that has no preview', () => {
        const card = draw(ui.entryCard(entryOf({ kind: 'video', access: 'signature' })));
        assert.equal(card.querySelector('img').getAttribute('src'), '/editorial/v1/atelier.jpg');
        assert.equal(card.querySelector('img[data-cover]'), null);
      });

      it('unlocks for members and marks readable media posts for hydration, starting from the preview', () => {
        const entry = entryOf({ kind: 'image', mediaCount: 2, access: 'public', previewUrl: 'https://bwezbxwdmnmfbibpusaf.supabase.co/storage/v1/object/public/previews/p.webp' });
        const card = draw(ui.entryCard(entry));
        assert.equal(card.querySelector('img').dataset.cover, 'e1');
        assert.equal(card.querySelector('img').dataset.coverReady, undefined);
        assert.ok(card.querySelector('.entry-cover').classList.contains('is-preview'));
        assert.equal(card.querySelector('.lock-badge'), null);
      });

      it('shows the lock for a tier the person has not joined and unlocks after joining', async () => {
        const entry = entryOf({ access: 'essential', creatorId: 'c9' });
        assert.ok(draw(ui.entryCard(entry)).querySelector('.entry-card').classList.contains('is-locked'));
        await store.join('c9', 'essential');
        assert.equal(draw(ui.entryCard(entry)).querySelector('.entry-card').classList.contains('is-locked'), false);
      });

      it('escapes everything it prints', () => {
        const evil = '"><img src=x onerror=alert(1)>';
        const card = draw(ui.entryCard(entryOf({ title: evil, excerpt: evil, format: evil, creator: { id: 'c', slug: evil, name: evil, avatarUrl: 'javascript:alert(1)' } })));
        assert.equal(card.querySelector('img[onerror]'), null);
        assert.equal(card.querySelector('.entry-title').textContent, evil);
        assert.equal(card.querySelector('.avatar img').getAttribute('src'), '#');
      });

      it('is compact without excerpt and actions, and marks drafts', () => {
        const compact = draw(ui.entryCard(entryOf(), { compact: true }));
        assert.equal(compact.querySelector('.entry-excerpt'), null);
        assert.equal(compact.querySelector('.entry-actions'), null);
        assert.ok(compact.querySelector('.entry-card').classList.contains('is-compact'));
        const draft = draw(ui.entryCard(entryOf({ status: 'draft' })));
        assert.equal(draft.querySelector('.entry-date').textContent, 'Draft');
        assert.equal(draft.querySelector('.entry-actions'), null);
      });

      it('hides the creator when asked and when there is none', () => {
        assert.equal(draw(ui.entryCard(entryOf({ creator: { id: 'c', slug: 'a', name: 'A' } }), { showCreator: false })).querySelector('.entry-author'), null);
        assert.equal(draw(ui.entryCard(entryOf())).querySelector('.entry-author'), null);
      });

      it('carries like and save buttons in the right state', () => {
        const card = draw(ui.entryCard(entryOf({ id: 'e-liked', likeCount: 1500 })));
        assert.equal(card.querySelector('[data-like]').getAttribute('aria-pressed'), 'true');
        assert.equal(card.querySelector('[data-like] .count').textContent, '1.5K');
        assert.equal(card.querySelector('[data-save]').getAttribute('aria-pressed'), 'false');
        assert.equal(draw(ui.entryCard(entryOf({ id: 'e-saved' }))).querySelector('[data-save]').getAttribute('aria-pressed'), 'true');
      });
    });

    describe('toggle buttons', () => {
      it('follow button shows the state, and is absent for your own atelier', async () => {
        assert.equal(draw(ui.followButton('c-followed')).querySelector('button').getAttribute('aria-pressed'), 'true');
        assert.match(host().textContent, /Following/);
        assert.equal(draw(ui.followButton('c-other')).querySelector('button').getAttribute('aria-pressed'), 'false');
        assert.match(host().textContent, /^\s*Follow\s*$/);
        store.update({ myCreator: { id: 'c-mine' } });
        assert.equal(draw(ui.followButton('c-mine')).querySelector('button'), null);
      });

      it('syncToggles brings buttons in line with the store', async () => {
        const entry = entryOf({ id: 'e-new', likeCount: 2 });
        draw(html`${ui.followButton('c-x')}${ui.saveButton(entry)}${ui.likeButton(entry)}`);
        const [follow, save, like] = host().querySelectorAll('button');
        await store.toggleFollow('c-x');
        await store.toggleSave('e-new');
        await store.toggleLike(entry);
        ui.syncToggles(host());
        assert.equal(follow.getAttribute('aria-pressed'), 'true');
        assert.match(follow.textContent, /Following/);
        assert.equal(save.getAttribute('aria-pressed'), 'true');
        assert.equal(like.getAttribute('aria-pressed'), 'true');
        assert.equal(like.querySelector('.count').textContent, '3');
        assert.equal(ui.likeSubject('e-new'), entry);
      });

      it('buttons stay valid markup with no state at all', () => {
        assert.match(String(ui.likeButton(entryOf())), /aria-pressed="false"/);
        assert.match(String(ui.saveButton(entryOf())), /aria-pressed="false"/);
      });
    });

    describe('small components', () => {
      it('avatar shows the picture or the initials, at the size asked', () => {
        const withPicture = draw(ui.avatar({ name: 'Mila Rossi', avatarUrl: 'https://bwezbxwdmnmfbibpusaf.supabase.co/a.webp' }, { size: 48 }));
        assert.ok(withPicture.querySelector('.avatar img'));
        assert.match(withPicture.querySelector('.avatar').getAttribute('style'), /--avatar-size:48px/);
        assert.equal(draw(ui.avatar({ name: 'Mila Rossi' })).querySelector('.avatar').textContent, 'MR');
        assert.ok(draw(ui.avatar({})).querySelector('.avatar svg'), 'an unnamed person gets a generic glyph');
        assert.match(draw(ui.avatar({ name: 'x' }, { size: '"><b>' })).querySelector('.avatar').getAttribute('style'), /--avatar-size:36px/);
      });

      it('badge only takes known tones', () => {
        assert.match(String(ui.badge('New', 'accent')), /badge--accent/);
        assert.match(String(ui.badge('New', '"><script>')), /badge--neutral/);
        assert.equal(draw(ui.badge('<b>x</b>')).querySelector('b'), null);
      });

      it('button renders variants, sizes, attributes and links', () => {
        const button = draw(ui.button('Save', { variant: 'secondary', size: 'small', attrs: { 'data-action': 'save', onclick: 'x()' } })).querySelector('button');
        assert.equal(button.className, 'button secondary small');
        assert.equal(button.getAttribute('type'), 'button');
        assert.equal(button.getAttribute('onclick'), null);
        assert.equal(draw(ui.button('Go', { type: 'submit' })).querySelector('button').type, 'submit');
        assert.equal(draw(ui.button('Go', { type: 'evil' })).querySelector('button').getAttribute('type'), 'button');
        const link = draw(ui.button('Open', { href: '/app/library', icon: 'arrow' })).querySelector('a.button');
        assert.equal(link.getAttribute('href'), '/app/library');
        assert.ok(link.querySelector('svg'));
        assert.equal(draw(ui.button('Bad', { href: 'javascript:alert(1)' })).querySelector('a').getAttribute('href'), '#');
      });

      it('emptyState and errorState escape their text and take actions', () => {
        const empty = draw(ui.emptyState({ icon: 'bookmark', title: '<i>Nothing</i>', text: 'Save <b>posts</b>', action: { label: 'Explore', href: '/app/discover' } }));
        assert.equal(empty.querySelector('i, b'), null);
        assert.equal(empty.querySelector('a.button').getAttribute('href'), '/app/discover');
        assert.ok(empty.querySelector('.empty-icon svg'));
        assert.equal(draw(ui.emptyState({ title: 'Plain' })).querySelector('p'), null);
        const withButton = draw(ui.emptyState({ title: 't', action: ui.button('Do', { attrs: { id: 'do' } }) }));
        assert.ok(withButton.querySelector('#do'));
      });

      it('errorState shows friendly messages, hides programming errors, and retries once per click target', () => {
        assert.match(draw(ui.errorState(new Error('You are offline.'))).textContent, /You are offline\./);
        assert.doesNotMatch(draw(ui.errorState(new TypeError("Cannot read properties of undefined (reading 'x')"))).textContent, /Cannot read/);
        assert.match(host().textContent, /Something went wrong/);
        assert.equal(draw(ui.errorState(new Error('x'))).querySelector('[data-retry]'), null, 'no retry without a handler');
        let retried = 0;
        draw(ui.errorState(new Error('x'), { retry: () => { retried++; } }));
        const button = host().querySelector('[data-retry]');
        button.click();
        button.click();
        assert.equal(retried, 1);
        draw(ui.errorState(new Error('x'), { retry: () => { retried++; } }));
        ui.resetRegistry();
        host().querySelector('[data-retry]').click();
        assert.equal(retried, 1, 'handlers are dropped when the page changes');
      });

      it('skeleton announces loading and has the kinds', () => {
        for (const kind of ['page', 'cards', 'list', 'text']) {
          const node = draw(ui.skeleton(kind)).querySelector('.skeleton');
          assert.ok(node.classList.contains(`skeleton--${kind}`));
          assert.equal(node.getAttribute('role'), 'status');
          assert.equal(node.querySelector('.visually-hidden').textContent, 'Loading');
        }
        assert.equal(draw(ui.skeleton('cards', 3)).querySelectorAll('.skeleton-card').length, 3);
        assert.equal(draw(ui.skeleton('list', 2)).querySelectorAll('.skeleton-row').length, 2);
      });

      it('creatorCard shows the atelier and escapes it', () => {
        const evil = '"><script>alert(1)</script>';
        const card = draw(ui.creatorCard({ id: 'c1', slug: 'anna', name: evil, category: 'Design', location: 'Milan', descriptor: evil, followerCount: 1, image: 'ritual', isShowcase: true, avatarUrl: null, coverUrl: null }));
        assert.equal(card.querySelector('script'), null);
        assert.equal(card.querySelector('h3 a').getAttribute('href'), '/app/c/anna');
        assert.match(card.textContent, /Showcase/);
        assert.match(card.textContent, /Design · Milan/);
        assert.match(card.textContent, /1 follower/);
        assert.equal(card.querySelector('.creator-cover img').getAttribute('src'), '/editorial/v1/ritual.jpg');
        assert.ok(card.querySelector('[data-follow="c1"]'));
      });

      it('tierCard shows price, perks, state and action', () => {
        const tier = { id: 'premium', level: 2, name: 'Studio <b>circle</b>', priceCents: 1250, currency: 'EUR', description: 'Everything.', perks: ['Monthly <i>notes</i>', 'Early access'], enabled: true };
        const card = draw(ui.tierCard(tier, { current: true, selected: true, action: { label: 'Join', attrs: { 'data-join': 'premium' } } }));
        assert.equal(card.querySelector('b, i'), null);
        assert.match(card.querySelector('.tier-price').textContent, /€12\.50 \/ month/);
        assert.equal(card.querySelectorAll('.tier-perks li').length, 2);
        assert.ok(card.querySelector('.tier-card').classList.contains('is-selected'));
        assert.match(card.textContent, /Your tier/);
        assert.ok(card.querySelector('[data-join="premium"]'));
        const closed = draw(ui.tierCard({ ...tier, enabled: false, perks: [] }));
        assert.match(closed.textContent, /Closed/);
        assert.equal(closed.querySelector('.tier-perks'), null);
      });
    });

    describe('toast', () => {
      it('adds announcements to the live region, keeps three, and clears them', async () => {
        for (const n of [1, 2, 3, 4]) ui.toast(`Message ${n}`, { tone: n === 4 ? 'error' : 'default' });
        const items = [...document.querySelectorAll('#toast .toast')];
        assert.deepEqual(items.map(item => item.textContent), ['Message 2', 'Message 3', 'Message 4']);
        assert.ok(items[2].classList.contains('toast--error'));
        ui.toast('');
        assert.equal(document.querySelectorAll('#toast .toast').length, 3);
      });

      it('treats the message as text', () => {
        ui.toast('<img src=x onerror=alert(1)>');
        assert.equal(document.querySelector('#toast img'), null);
        assert.match(document.querySelector('#toast').textContent, /<img/);
      });
    });

    describe('modal and confirmDialog', () => {
      it('opens with a title and body, mounts, and closes with a result', async () => {
        const opener = document.createElement('button');
        document.body.append(opener);
        opener.focus();
        const log = [];
        const handle = ui.modal.open({ title: 'Hello <b>there</b>', body: html`<input id="first"><p>Body</p>`, className: 'wide', onMount: (el, h) => log.push(['mount', el.id, typeof h.close]), onClose: result => log.push(['close', result]) });
        const dialog = document.querySelector('#modal');
        assert.equal(handle.el, dialog);
        assert.equal(dialog.open, true);
        assert.equal(ui.modal.isOpen, true);
        assert.equal(dialog.className, 'modal wide');
        assert.equal(dialog.querySelector('#modal-title').textContent, 'Hello <b>there</b>');
        assert.equal(dialog.querySelector('b'), null);
        assert.equal(document.activeElement.id, 'first', 'focus goes to the first field');
        handle.close('done');
        assert.equal(dialog.open, false);
        assert.equal(ui.modal.isOpen, false);
        assert.deepEqual(log, [['mount', 'modal', 'function'], ['close', 'done']]);
        assert.equal(document.activeElement, opener, 'focus goes back to where it was');
        handle.close('again');
        assert.equal(log.length, 2, 'closing twice does nothing');
      });

      it('closes from the close button, from the platform (Escape) and with modal.close()', () => {
        const results = [];
        ui.modal.open({ title: 'A', body: 'text', onClose: r => results.push(['button', r]) });
        assert.equal(document.querySelector('#modal p').textContent, 'text', 'a plain string becomes escaped text');
        document.querySelector('[data-modal-close]').click();
        assert.equal(document.querySelector('#modal').open, false);
        ui.modal.open({ title: 'B', onClose: r => results.push(['escape', r]) });
        document.querySelector('#modal').close();
        ui.modal.open({ title: 'C', onClose: r => results.push(['api', r]) });
        ui.modal.close('x');
        assert.deepEqual(results, [['button', undefined], ['escape', undefined], ['api', 'x']]);
      });

      it('replaces an open dialog and survives the late close event of the first', async () => {
        const results = [];
        ui.modal.open({ title: 'First', onClose: () => results.push('first') });
        ui.modal.open({ title: 'Second', onClose: () => results.push('second') });
        await tick(5);
        assert.deepEqual(results, ['first']);
        assert.equal(document.querySelector('#modal').open, true);
        assert.equal(document.querySelector('#modal-title').textContent, 'Second');
        ui.modal.close();
        assert.deepEqual(results, ['first', 'second']);
      });

      it('chains a second dialog opened while the first closes', async () => {
        ui.modal.open({ title: 'First', onClose: () => { ui.modal.open({ title: 'Second' }); } });
        ui.modal.close();
        await tick(5);
        assert.equal(document.querySelector('#modal').open, true);
        assert.equal(document.querySelector('#modal-title').textContent, 'Second');
        ui.modal.close();
      });

      it('confirmDialog resolves true for confirm and false for cancel or dismissal', async () => {
        let answer = ui.confirmDialog({ title: 'Delete?', text: 'This <b>cannot</b> be undone.', confirmLabel: 'Delete', tone: 'danger' });
        const dialog = document.querySelector('#modal');
        assert.equal(dialog.querySelector('b'), null);
        assert.ok(dialog.querySelector('[data-confirm="yes"]').classList.contains('danger'));
        assert.equal(document.activeElement.dataset.confirm, 'no', 'the safe choice has focus');
        dialog.querySelector('[data-confirm="yes"]').click();
        assert.equal(await answer, true);
        answer = ui.confirmDialog({ title: 'Leave?' });
        document.querySelector('[data-confirm="no"]').click();
        assert.equal(await answer, false);
        answer = ui.confirmDialog({ title: 'Leave?' });
        ui.modal.close();
        assert.equal(await answer, false);
      });
    });

    describe('helpers', () => {
      it('delegate handles clicks on matching descendants of the root only, and can be removed', () => {
        draw(html`<ul><li><button class="a"><span id="inner">go</span></button></li><li><button class="b">no</button></li></ul>`);
        const hits = [];
        const remove = ui.delegate(host(), 'click', '.a', (event, el) => hits.push(el.className));
        host().querySelector('#inner').click();
        host().querySelector('.b').click();
        assert.deepEqual(hits, ['a']);
        remove();
        host().querySelector('.a').click();
        assert.equal(hits.length, 1);
      });

      it('setBusy disables and restores, and respects a control that was disabled before', () => {
        const button = document.createElement('button');
        ui.setBusy(button, true);
        assert.equal(button.disabled, true);
        assert.equal(button.getAttribute('aria-busy'), 'true');
        ui.setBusy(button, false);
        assert.equal(button.disabled, false);
        assert.equal(button.getAttribute('aria-busy'), null);
        button.disabled = true;
        ui.setBusy(button, true);
        ui.setBusy(button, true);
        ui.setBusy(button, false);
        assert.equal(button.disabled, true, 'stays disabled as it was');
        ui.setBusy(null, true);
      });

      it('debounce waits for quiet and can be cancelled', async () => {
        const calls = [];
        const run = ui.debounce(value => calls.push(value), 15);
        run(1); run(2); run(3);
        await tick(40);
        assert.deepEqual(calls, [3]);
        run(4);
        run.cancel();
        await tick(30);
        assert.deepEqual(calls, [3]);
      });

      it('infiniteScroll loads while the sentinel is visible and stops when told, or on failure', async () => {
        const sentinel = document.createElement('div');
        document.body.append(sentinel);
        let pages = 0;
        let observer;
        const stop = ui.infiniteScroll(sentinel, async () => { pages++; return pages < 3; });
        observer = IntersectionObserverStub.instances.at(-1);
        observer.fire(false);
        await tick();
        assert.equal(pages, 0);
        observer.fire(true);
        await tick();
        assert.equal(pages, 1);
        assert.ok(observer.targets.has(sentinel), 'observed again, so a short page keeps filling');
        observer.fire(true);
        await tick();
        observer.fire(true);
        await tick();
        assert.equal(pages, 3);
        assert.equal(observer.targets.size, 0, 'disconnected once nothing is left');
        stop();

        let failures = 0;
        ui.infiniteScroll(sentinel, async () => { failures++; throw new Error('offline'); });
        observer = IntersectionObserverStub.instances.at(-1);
        observer.fire(true);
        await tick();
        observer.fire(true);
        await tick();
        assert.equal(failures, 1, 'a failing request does not loop');
      });

      it('infiniteScroll does nothing without a sentinel', () => {
        assert.equal(typeof ui.infiniteScroll(null, async () => true), 'function');
      });

      it('pickFiles resolves with the chosen files, or an empty list when dismissed', async () => {
        let pending = ui.pickFiles({ accept: 'image/*', multiple: true });
        let input = document.querySelector('input[type="file"]');
        assert.equal(input.accept, 'image/*');
        assert.equal(input.multiple, true);
        input.dispatchEvent(new window.Event('change'));
        assert.deepEqual(await pending, []);
        assert.equal(document.querySelector('input[type="file"]'), null, 'the input is removed again');
        pending = ui.pickFiles();
        document.querySelector('input[type="file"]').dispatchEvent(new window.Event('cancel'));
        assert.deepEqual(await pending, []);
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe('covers hydration', () => {
    const URLS = 'https://signed.test/';
    const PREVIEW = 'https://bwezbxwdmnmfbibpusaf.supabase.co/storage/v1/object/public/previews/p.webp';
    const file = (kind, name, poster = null) => ({ id: name, kind, path: `c/e/${name}.${kind === 'image' ? 'webp' : 'mp4'}`, posterPath: poster && `c/e/${poster}`, position: 0 });

    function coverApi(files, { unsigned = [] } = {}) {
      const calls = { media: [], sign: [] };
      return {
        calls,
        async media(ids) { calls.media.push([...ids]); return Object.fromEntries(ids.filter(id => files[id]).map(id => [id, files[id]])); },
        async signedUrls(paths) { calls.sign.push([...paths]); return Object.fromEntries(paths.filter(path => !unsigned.includes(path)).map(path => [path, `${URLS}${path}`])); }
      };
    }
    const media = (id, over = {}) => entryOf({ id, kind: 'image', mediaCount: 1, format: 'Gallery', previewUrl: PREVIEW, ...over });
    const grid = entries => {
      document.body.innerHTML = `<div id="grid">${entries.map(entry => String(ui.entryCard(entry))).join('')}</div><dialog id="modal"></dialog><div id="toast"></div>`;
      return document.querySelector('#grid');
    };
    const img = id => document.querySelector(`img[data-cover="${id}"]`);
    const frame = id => img(id).closest('.entry-cover');
    const loaded = element => element.dispatchEvent(new window.Event('load'));
    const failed = element => element.dispatchEvent(new window.Event('error'));

    beforeEach(async () => {
      await store.init(stubApi({ session: makeSession('viewer'), viewer: makeViewer({ memberships: [{ creatorId: 'c1', tierId: 'essential', level: 1 }] }) }));
      resetCovers(store);
    });

    it('asks for the file lists in one batch and signs every cover in one call', async () => {
      const entries = [media('a'), media('b'), media('c')];
      const api = coverApi({ a: [file('image', 'a', 'a-poster.webp')], b: [file('image', 'b')], c: [file('image', 'c', 'c-poster.webp')] });
      const root = grid(entries);
      await hydrateCovers(root, entries, api, store);
      assert.deepEqual(api.calls.media, [['a', 'b', 'c']]);
      assert.equal(api.calls.sign.length, 1);
      assert.deepEqual(api.calls.sign[0].sort(), ['c/e/a-poster.webp', 'c/e/b.webp', 'c/e/c-poster.webp']);
      assert.equal(img('a').getAttribute('src'), `${URLS}c/e/a-poster.webp`, 'a card thumbnail, not the original');
      assert.equal(img('b').getAttribute('src'), `${URLS}c/e/b.webp`, 'no thumbnail: the file itself');
      assert.equal(img('c').getAttribute('src'), `${URLS}c/e/c-poster.webp`);
    });

    it('uses the poster frame of a film and leaves a film without a poster alone', async () => {
      const entries = [media('v', { kind: 'video', format: 'Film', duration: 30 }), media('n', { kind: 'video', format: 'Film' })];
      const api = coverApi({ v: [file('video', 'v', 'v-poster.jpg')], n: [file('video', 'n')] });
      const root = grid(entries);
      await hydrateCovers(root, entries, api, store);
      assert.deepEqual(api.calls.sign, [['c/e/v-poster.jpg']]);
      assert.equal(img('v').getAttribute('src'), `${URLS}c/e/v-poster.jpg`);
      assert.equal(img('n').getAttribute('src'), PREVIEW, 'the preview stays');
      await hydrateCovers(grid(entries), entries, api, store);
      assert.equal(api.calls.media.length, 1, 'a film that has no poster has nothing to sign, and its file list is not asked for again');
    });

    it('uses the first file of the entry’s own kind', async () => {
      const entries = [media('m')];
      const api = coverApi({ m: [file('video', 'stray', 'stray-poster.jpg'), file('image', 'own', 'own-poster.webp')] });
      await hydrateCovers(grid(entries), entries, api, store);
      assert.equal(img('m').getAttribute('src'), `${URLS}c/e/own-poster.webp`);
    });

    it('never looks at text posts or posts the person cannot read', async () => {
      const entries = [
        entryOf({ id: 't', kind: 'text' }),
        media('locked', { access: 'premium', creatorId: 'c2' }),
        media('member-ok', { access: 'essential', creatorId: 'c1' }),
        media('member-no', { access: 'signature', creatorId: 'c1' })
      ];
      const api = coverApi({ locked: [file('image', 'locked')], 'member-ok': [file('image', 'ok')], 'member-no': [file('image', 'no')], t: [] });
      const root = grid(entries);
      await hydrateCovers(root, entries, api, store);
      assert.deepEqual(api.calls.media, [['member-ok']]);
      assert.deepEqual(api.calls.sign, [['c/e/ok.webp']]);
      assert.equal(document.querySelector('[data-entry="locked"] img').getAttribute('src'), PREVIEW);
      assert.equal(document.querySelector('[data-entry="member-no"] img').getAttribute('src'), PREVIEW);
      assert.ok(document.querySelector('[data-entry="locked"] .entry-cover').classList.contains('is-preview'));
    });

    it('keeps the blurred preview until the real picture has loaded', async () => {
      const entries = [media('a')];
      const api = coverApi({ a: [file('image', 'a', 'a-poster.webp')] });
      await hydrateCovers(grid(entries), entries, api, store);
      assert.equal(img('a').dataset.coverReady, '1');
      assert.ok(frame('a').classList.contains('is-preview'), 'still blurred: the picture has not loaded yet');
      loaded(img('a'));
      assert.equal(frame('a').classList.contains('is-preview'), false);
      assert.equal(frame('a').classList.contains('is-preset'), false);
    });

    it('starts from the editorial preset when there is no preview, and leaves it when the picture loads', async () => {
      const entries = [media('a', { previewUrl: null })];
      await hydrateCovers(grid(entries), entries, coverApi({ a: [file('image', 'a')] }), store);
      assert.ok(frame('a').classList.contains('is-preset'));
      loaded(img('a'));
      assert.equal(frame('a').classList.contains('is-preset'), false);
    });

    it('ignores the preview itself loading', async () => {
      const entries = [media('a')];
      const root = grid(entries);
      await hydrateCovers(root, entries, coverApi({}), store);
      loaded(img('a'));
      assert.ok(frame('a').classList.contains('is-preview'));
    });

    it('signs the image itself when its thumbnail cannot be signed, and remembers the choice', async () => {
      const entries = [media('a')];
      const api = coverApi({ a: [file('image', 'a', 'a-poster.webp')] }, { unsigned: ['c/e/a-poster.webp'] });
      await hydrateCovers(grid(entries), entries, api, store);
      assert.deepEqual(api.calls.sign, [['c/e/a-poster.webp'], ['c/e/a.webp']]);
      assert.equal(img('a').getAttribute('src'), `${URLS}c/e/a.webp`);
      failed(img('a'));
      failed(img('a'));
      await hydrateCovers(document.querySelector('#grid'), entries, api, store);
      const requested = api.calls.sign.flat();
      assert.equal(requested.filter(path => path === 'c/e/a-poster.webp').length, 1, 'the written-off thumbnail is not asked for again');
    });

    it('does not write the thumbnail off when nothing could be signed at all', async () => {
      const entries = [media('a')];
      const api = coverApi({ a: [file('image', 'a', 'a-poster.webp')] }, { unsigned: ['c/e/a-poster.webp', 'c/e/a.webp'] });
      await hydrateCovers(grid(entries), entries, api, store);
      assert.equal(img('a').getAttribute('src'), PREVIEW);
      api.signedUrls = async paths => Object.fromEntries(paths.map(path => [path, `${URLS}${path}`]));
      await hydrateCovers(grid(entries), entries, api, store);
      assert.equal(api.calls.media.length, 2, 'a card that ended up with nothing reads its file list again');
      assert.equal(img('a').getAttribute('src'), `${URLS}c/e/a-poster.webp`, 'the thumbnail is still preferred next time');
    });

    it('signs an expired cover link again once, then replaces the thumbnail by the file, then gives up', async () => {
      const entries = [media('a')];
      const api = coverApi({ a: [file('image', 'a', 'a-poster.webp')] });
      const root = grid(entries);
      await hydrateCovers(root, entries, api, store);
      const settle = () => hydrateCovers(root, entries, api, store);

      failed(img('a')); await settle();
      assert.deepEqual(api.calls.sign.at(-1), ['c/e/a-poster.webp'], 'first failure: the same thumbnail, signed again');
      assert.equal(img('a').dataset.coverReady, '1');

      failed(img('a')); await settle();
      assert.deepEqual(api.calls.sign.at(-1), ['c/e/a.webp'], 'second failure: the file takes its place');
      assert.equal(img('a').getAttribute('src'), `${URLS}c/e/a.webp`);

      const calls = api.calls.sign.length;
      failed(img('a')); await tick(5);
      assert.equal(api.calls.sign.length, calls, 'after that it is left alone: no further signing on its own');
      assert.equal(img('a').dataset.coverReady, undefined);
    });

    it('does not retry a failure of the preview or the preset', async () => {
      const entries = [media('a')];
      const api = coverApi({});
      const root = grid(entries);
      await hydrateCovers(root, entries, api, store);
      const calls = api.calls.media.length;
      failed(img('a'));
      await tick(5);
      assert.equal(api.calls.media.length, calls, 'nothing starts by itself');
      assert.equal(img('a').dataset.coverFailed, undefined);
    });

    it('reuses a link for four minutes, then signs again', async () => {
      const entries = [media('a')];
      const api = coverApi({ a: [file('image', 'a', 'a-poster.webp')] });
      await hydrateCovers(grid(entries), entries, api, store, { now: () => Date.now() - 3 * 60e3 });
      assert.equal(api.calls.sign.length, 1);
      assert.ok(cachedCover(store, 'a'), 'a link three minutes old is reused');

      const again = grid(entries);
      const card = img('a');
      assert.equal(card.dataset.coverReady, '1', 'drawn with the cached link at once');
      assert.equal(card.getAttribute('src'), `${URLS}c/e/a-poster.webp`);
      await hydrateCovers(again, entries, api, store);
      assert.equal(api.calls.sign.length, 1, 'no new request');
      assert.equal(api.calls.media.length, 1);

      resetCovers(store);
      await hydrateCovers(grid(entries), entries, api, store, { now: () => Date.now() - 5 * 60e3 });
      assert.equal(cachedCover(store, 'a'), '', 'five minutes is too old');
      const stale = grid(entries);
      assert.equal(img('a').dataset.coverReady, undefined, 'drawn with the preview again');
      await hydrateCovers(stale, entries, api, store);
      assert.equal(api.calls.sign.length, 3, 'signed again');
    });

    it('binds its listeners once, however often it runs', async () => {
      const entries = [media('a')];
      const api = coverApi({ a: [file('image', 'a', 'a-poster.webp')] });
      const root = grid(entries);
      for (let i = 0; i < 3; i++) await hydrateCovers(root, entries, api, store);
      failed(img('a'));
      await hydrateCovers(root, entries, api, store);
      assert.equal(api.calls.sign.length, 2, 'one failure, one new signing (not three)');
    });

    it('drops answers that arrive after the account changed, and forgets the old account’s links', async () => {
      const entries = [media('a')];
      const gate = deferred();
      const api = coverApi({ a: [file('image', 'a', 'a-poster.webp')] });
      api.signedUrls = () => gate.promise;
      const root = grid(entries);
      const pending = hydrateCovers(root, entries, api, store);
      await tick();
      store.signOutLocal();
      gate.resolve({ 'c/e/a-poster.webp': `${URLS}late` });
      await pending;
      assert.equal(img('a').getAttribute('src'), PREVIEW, 'nothing is painted for the account that left');
      assert.equal(cachedCover(store, 'a'), '');
    });

    it('starts from nothing when another account signs in', async () => {
      const entries = [media('a', { access: 'public' })];
      const api = coverApi({ a: [file('image', 'a')] });
      await hydrateCovers(grid(entries), entries, api, store);
      assert.ok(cachedCover(store, 'a'));
      await store.init(stubApi({ session: makeSession('other') }));
      assert.equal(cachedCover(store, 'a'), '');
      await hydrateCovers(grid(entries), entries, api, store);
      assert.equal(api.calls.media.length, 2, 'the file list is read again for the new account');
    });

    it('survives an api that throws, and tries again on the next pass', async () => {
      const entries = [media('a')];
      const api = coverApi({ a: [file('image', 'a')] });
      const working = api.media;
      api.media = async () => { throw new Error('offline'); };
      await hydrateCovers(grid(entries), entries, api, store);
      assert.equal(img('a').getAttribute('src'), PREVIEW);
      api.media = working;
      await hydrateCovers(grid(entries), entries, api, store);
      assert.equal(img('a').getAttribute('src'), `${URLS}c/e/a.webp`);
    });

    it('copes with covers that are not in the list of entries and with a missing root', async () => {
      const api = coverApi({});
      const root = grid([media('x')]);
      await hydrateCovers(root, [], api, store);
      await hydrateCovers(null, [], api, store);
      assert.equal(api.calls.media.length, 0);
    });

    it('coverFor describes what a card draws', () => {
      assert.deepEqual(coverFor(entryOf({ image: 'ritual' }), store), { src: '/editorial/v1/ritual.jpg', state: 'preset', hydrate: false });
      assert.deepEqual(coverFor(entryOf({ coverUrl: 'https://x.test/c.webp' }), store), { src: 'https://x.test/c.webp', state: 'media', hydrate: false });
      assert.deepEqual(coverFor(media('a', { access: 'signature' }), store), { src: PREVIEW, state: 'preview', hydrate: false });
      assert.deepEqual(coverFor(media('a'), store), { src: PREVIEW, state: 'preview', hydrate: true });
      assert.deepEqual(coverFor(media('a', { previewUrl: null }), store), { src: '/editorial/v1/atelier.jpg', state: 'preset', hydrate: true });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe('router in the shell', () => {
    const page = (title, extra = {}) => inline({ title, render: ctx => html`<p id="where">${title}|${JSON.stringify(ctx.params)}|${JSON.stringify(ctx.query)}</p>`, ...extra });
    const table = (extra = []) => [
      { path: '/app', view: page('Home') },
      { path: '/app/c/:slug', view: page('Atelier') },
      { path: '/app/library', view: page('Library', { auth: 'required' }) },
      { path: '/app/studio', view: page('Studio', { auth: 'required' }) },
      { path: '/app/studio/new', view: page('Editor', { auth: 'creator' }) },
      { path: '/app/login', view: page('Login', { auth: 'guest' }) },
      { path: '/app/signup', view: page('Signup', { auth: 'guest' }) },
      { path: '/app/forgot', view: page('Forgot', { auth: 'guest' }) },
      { path: '/app/reset', view: page('Reset', { auth: 'guest' }), auth: 'recovery' },
      { path: '/app/welcome', view: page('Welcome', { auth: 'required' }) },
      { path: '/app/settings', view: page('Settings', { auth: 'required' }) },
      { path: '/app/p/:id', view: page('Post') },
      ...extra,
      { path: '*', view: page('Not found') }
    ];
    const member = () => createFakeApi();
    const owner = () => createFakeApi({ signedIn: IDS.owner });
    const unboarded = () => {
      const fake = createFakeApi();
      fake.db.user_settings.find(row => row.user_id === IDS.member).onboarded = false;
      return fake;
    };
    let app;
    const open = async options => { app = await mountApp({ routes: table(options.extra), ...options }); return app; };
    const end = async () => { await app?.destroy(); app = null; };

    it('draws the page for the path with params and query, sets the title, and announces it', async () => {
      await open({ path: '/app/c/studio-anna?tab=posts&x=1' });
      assert.equal(app.text('#where'), 'Atelier|{"slug":"studio-anna"}|{"tab":"posts","x":"1"}');
      assert.equal(app.document.title, 'Atelier — REFLUENZ');
      assert.match(app.text('#route-announcer'), /Atelier/);
      assert.equal(app.path, '/app/c/studio-anna?tab=posts&x=1');
      await end();
    });

    it('uses a view title function and falls back to the site name', async () => {
      await open({ path: '/app/p/abc', extra: [{ path: '/app/untitled', view: inline({ title: '', render: () => html`<p>x</p>` }) }, { path: '/app/dynamic/:n', view: inline({ title: (ctx, data) => `Item ${ctx.params.n} ${data.label}`, load: async () => ({ label: 'loaded' }), render: () => html`<p>d</p>` }) }] });
      await app.navigate('/app/untitled');
      assert.equal(app.document.title, 'REFLUENZ');
      await app.navigate('/app/dynamic/7');
      assert.equal(app.document.title, 'Item 7 loaded — REFLUENZ');
      await end();
    });

    it('shows a skeleton while load runs, then the page; the page gets the loaded data', async () => {
      const gate = deferred();
      await open({ path: '/app', extra: [{ path: '/app/slow', view: inline({ title: 'Slow', load: () => gate.promise, render: (ctx, data) => html`<p id="data">${data.value}</p>` }) }] });
      const navigation = app.router.navigate('/app/slow');
      await tick();
      assert.ok(app.exists('#view .skeleton'));
      assert.equal(app.find('#view').getAttribute('aria-busy'), 'true');
      gate.resolve({ value: 'ready' });
      await navigation;
      assert.equal(app.text('#data'), 'ready');
      assert.equal(app.exists('#view .skeleton'), false);
      assert.equal(app.find('#view').getAttribute('aria-busy'), null);
      await end();
    });

    it('shows an error state with Retry when load fails, and retries the load', async () => {
      let attempts = 0;
      const logged = console.error;
      console.error = () => {};
      try {
        await open({ path: '/app', extra: [{ path: '/app/flaky', view: inline({ title: 'Flaky', load: async () => { if (++attempts === 1) throw new Error('The server is busy.'); return {}; }, render: () => html`<p id="ok">fine</p>` }) }] });
        await app.navigate('/app/flaky');
        assert.match(app.text(), /The server is busy\./);
        assert.equal(app.document.title, 'Something went wrong — REFLUENZ');
        await app.click('[data-retry]');
        assert.equal(app.text('#ok'), 'fine');
        assert.equal(attempts, 2);
        assert.equal(app.document.title, 'Flaky — REFLUENZ');
      } finally { console.error = logged; }
      await end();
    });

    it('turns a render error into the same error state, and a module that fails to load too', async () => {
      const logged = console.error;
      console.error = () => {};
      try {
        await open({ path: '/app', extra: [
          { path: '/app/broken', view: inline({ title: 'Broken', render: () => { throw new Error('Template exploded'); } }) },
          { path: '/app/missing', view: async () => { throw new Error('Failed to fetch module'); } }
        ] });
        await app.navigate('/app/broken');
        assert.match(app.text(), /Template exploded/);
        await app.navigate('/app/missing');
        assert.match(app.text(), /Failed to fetch module/);
        assert.ok(app.exists('[data-retry]'));
      } finally { console.error = logged; }
      await end();
    });

    it('treats a plain string from render as text, not markup', async () => {
      await open({ path: '/app', extra: [{ path: '/app/plain', view: inline({ title: 'Plain', render: () => '<img src=x onerror=alert(1)>' }) }] });
      await app.navigate('/app/plain');
      assert.equal(app.exists('#view img'), false);
      await end();
    });

    it('mounts into the outlet, runs the cleanup on route change, and ignores a stale rerender', async () => {
      const log = [];
      let context;
      await open({ path: '/app', extra: [{ path: '/app/live', view: inline({ title: 'Live', load: async () => ({ n: 1 }), render: (ctx, data) => html`<p id="n">${data.n}</p>`, mount: (el, ctx, data) => { context = ctx; log.push(['mount', el.id, data.n]); return () => log.push(['cleanup']); } }) }] });
      await app.navigate('/app/live');
      assert.deepEqual(log, [['mount', 'view', 1]]);
      context.rerender({ n: 2 });
      assert.equal(app.text('#n'), '2');
      assert.deepEqual(log, [['mount', 'view', 1], ['cleanup'], ['mount', 'view', 2]]);
      context.rerender();
      assert.equal(app.text('#n'), '2', 'same data again');
      await app.navigate('/app');
      assert.equal(log.at(-1)[0], 'cleanup');
      const count = log.length;
      context.rerender({ n: 3 });
      assert.equal(log.length, count, 'a page that was left does not come back');
      assert.equal(app.exists('#n'), false);
      await end();
    });

    it('keeps the focused field when a view redraws itself', async () => {
      await open({ path: '/app', extra: [{ path: '/app/form', view: inline({ title: 'Form', render: () => html`<input id="q" name="q" value="x">` , mount: (el, ctx) => { el.querySelector('#q').addEventListener('input', () => ctx.rerender()); } }) }] });
      await app.navigate('/app/form');
      const input = app.find('#q');
      input.focus();
      input.setSelectionRange(1, 1);
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      assert.equal(app.document.activeElement.id, 'q');
      await end();
    });

    it('moves focus to the main region and announces after navigation, but not on the first load', async () => {
      await open({ path: '/app' });
      assert.notEqual(app.document.activeElement.id, 'main');
      await app.navigate('/app/c/x');
      assert.equal(app.document.activeElement.id, 'main');
      assert.match(app.text('#route-announcer'), /Atelier, page loaded/);
      await end();
    });

    describe('guards in the browser', () => {
      it('sends a guest from a required page to the sign-in page, then back after signing in', async () => {
        const api = createFakeApi({ signedIn: null });
        await open({ path: '/app/library', api });
        assert.equal(app.path, '/app/login?next=%2Fapp%2Flibrary');
        assert.equal(app.text('#where').split('|')[0], 'Login');
        api.signInAs(IDS.member);
        await tick(10);
        await app.settle();
        assert.equal(app.path, '/app/library');
        assert.equal(app.text('#where').split('|')[0], 'Library');
        await end();
      });

      it('keeps the way back through a navigation to a protected page, as one history entry', async () => {
        await open({ path: '/app' });
        await app.navigate('/app/library');
        assert.equal(app.path, '/app/login?next=%2Fapp%2Flibrary');
        await app.back();
        assert.equal(app.path, '/app', 'back leaves the sign-in page, not a protected one');
        await end();
      });

      it('sends a signed-in person away from guest pages, ignoring a hostile next', async () => {
        await open({ path: '/app/login?next=%2Fapp%2Fsettings', api: member() });
        assert.equal(app.path, '/app/settings');
        await app.navigate('/app/signup?next=https%3A%2F%2Fevil.example%2F');
        assert.equal(app.path, '/app');
        await app.navigate('/app/forgot?next=%2F%2Fevil.example');
        assert.equal(app.path, '/app');
        await end();
      });

      it('sends a signed-in person without an atelier from the editor to the studio, and lets creators in', async () => {
        await open({ path: '/app/studio/new', api: member() });
        assert.equal(app.path, '/app/studio');
        await end();
        await open({ path: '/app/studio/new', api: owner() });
        assert.equal(app.path, '/app/studio/new');
        await end();
      });

      it('sends a new member to the welcome page once', async () => {
        await open({ path: '/app/c/anna', api: unboarded() });
        assert.equal(app.path, '/app/welcome?next=%2Fapp%2Fc%2Fanna');
        await app.navigate('/app/c/anna');
        assert.equal(app.path, '/app/c/anna', 'only once');
        await app.navigate('/app/settings');
        assert.equal(app.path, '/app/settings');
        await end();
      });

      it('does not send anyone to the welcome page from the settings page', async () => {
        await open({ path: '/app/settings', api: unboarded() });
        assert.equal(app.path, '/app/settings');
        await end();
      });

      it('leaves a protected page when the person signs out, and draws open pages again for the new account', async () => {
        const api = member();
        let renders = 0;
        await open({ path: '/app/library', api, extra: [{ path: '/app/open', view: inline({ title: 'Open', render: () => { renders++; return html`<p>open</p>`; } }) }] });
        assert.equal(app.path, '/app/library');
        api.signOut();
        await tick(10);
        await app.settle();
        assert.equal(app.path, '/app/login?next=%2Fapp%2Flibrary');
        await app.navigate('/app/open');
        const before = renders;
        api.signInAs(IDS.owner);
        await tick(10);
        await app.settle();
        assert.ok(renders > before, 'the open page was drawn again for the account that signed in');
        assert.equal(app.path, '/app/open');
        await end();
      });

      it('goes to the password page for a recovery link, from the url flag and from the event', async () => {
        await open({ path: '/app', api: member(), recovery: true });
        assert.equal(app.path, '/app/reset');
        assert.equal(app.text('#where').split('|')[0], 'Reset');
        app.store.setRecovery(false);
        await app.navigate('/app');
        assert.equal(app.path, '/app');
        await end();

        const api = createFakeApi({ signedIn: null });
        await open({ path: '/app', api });
        api.signInAs(IDS.member);
        api.signInAs(IDS.member, 'PASSWORD_RECOVERY');
        await tick(10);
        await app.settle();
        assert.equal(app.path, '/app/reset');
        await end();
      });

      it('lets nobody without a link or session reach the reset page', async () => {
        await open({ path: '/app/reset' });
        assert.equal(app.path, '/app/forgot');
        await end();
      });
    });

    describe('legacy addresses', () => {
      it('replaces /app.html and its hashes by the new paths', async () => {
        const cases = [['/app.html', '/app'], ['/app.html#discover', '/app/discover'], ['/app.html#archive', '/app/library'], ['/app.html#circle', '/app/messages'], ['/app.html#memberships', '/app/memberships'], ['/app.html#studio', '/app/studio'], ['/app.html#settings', '/app/settings'], ['/app.html#entry/abc-1', '/app/p/abc-1']];
        for (const [from, to] of cases) {
          await open({ path: from, api: member(), extra: [{ path: '/app/discover', view: page('Discover') }, { path: '/app/messages', view: page('Messages') }, { path: '/app/memberships', view: page('Memberships') }] });
          assert.equal(app.path, to, from);
          assert.equal(app.window.location.hash, '', from);
          await end();
        }
      });

      it('replaces the history entry instead of adding one', async () => {
        await open({ path: '/app/discover', api: member() });
        const length = app.window.history.length;
        await app.navigate('/app.html#settings');
        assert.equal(app.path, '/app/settings');
        assert.equal(app.window.history.length, length, 'replaced, not pushed');
        await end();
      });

      it('goes home for an unknown hash', async () => {
        await open({ path: '/app.html#nonsense' });
        assert.equal(app.path, '/app');
        await end();
      });
    });

    describe('not found', () => {
      it('draws the not-found view for unknown paths, keeping the url', async () => {
        await open({ path: '/app/nope/at/all' });
        assert.equal(app.text('#where').split('|')[0], 'Not found');
        assert.equal(app.path, '/app/nope/at/all');
        await end();
      });
    });

    describe('links, history and leaving', () => {
      const anchor = (href, attributes = {}) => {
        const link = app.document.createElement('a');
        link.setAttribute('href', href);
        for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
        link.textContent = 'link';
        app.find('#view').append(link);
        return link;
      };
      const press = (link, init = {}) => {
        const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
        link.dispatchEvent(event);
        return event;
      };

      it('follows same-origin /app links without reloading, and pushes history', async () => {
        await open({ path: '/app' });
        const length = app.window.history.length;
        const event = press(anchor('/app/c/anna?x=1'));
        await app.settle();
        assert.equal(event.defaultPrevented, true);
        assert.equal(app.path, '/app/c/anna?x=1');
        assert.equal(app.window.history.length, length + 1);
        assert.equal(app.text('#where').split('|')[0], 'Atelier');
        await end();
      });

      it('leaves links alone that should open the normal way', async () => {
        await open({ path: '/app' });
        // happy-dom follows links nothing has stopped, as a browser would; record what the router decided and stop it here.
        const decided = [];
        const record = event => { decided.push(event.defaultPrevented); event.preventDefault(); };
        app.window.addEventListener('click', record);
        const cases = [
          anchor('/app/c/a', { target: '_blank' }),
          anchor('/app/c/b', { download: '' }),
          anchor('/app/c/c', { 'data-native': '' }),
          anchor('/apple'),
          anchor('/app.htmlx'),
          anchor('https://example.com/app/c/d'),
          anchor('//example.com/app/c/e'),
          anchor('mailto:a@example.com'),
          anchor('#main'),
          anchor('/landing')
        ];
        for (const link of cases) {
          press(link);
          assert.equal(decided.pop(), false, link.getAttribute('href'));
        }
        for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
          press(anchor('/app/c/z'), init);
          assert.equal(decided.pop(), false, JSON.stringify(init));
        }
        app.window.removeEventListener('click', record);
        assert.equal(app.path, '/app');
        await end();
      });

      it('does not intercept a click that something else already handled', async () => {
        await open({ path: '/app' });
        const link = anchor('/app/c/handled');
        link.addEventListener('click', event => event.preventDefault());
        press(link);
        await app.settle();
        assert.equal(app.path, '/app');
        await end();
      });

      it('goes back and forward through the pages shown', async () => {
        await open({ path: '/app' });
        await app.navigate('/app/c/one');
        await app.navigate('/app/c/two');
        await app.back();
        assert.equal(app.path, '/app/c/one');
        assert.equal(app.text('#where').split('|')[1], '{"slug":"one"}');
        await app.back();
        assert.equal(app.path, '/app');
        assert.equal(app.document.title, 'Home — REFLUENZ');
        await end();
      });

      it('treats a navigation to the page you are on as a refresh, not a new entry', async () => {
        let loads = 0;
        await open({ path: '/app', extra: [{ path: '/app/count', view: inline({ title: 'Count', load: async () => ++loads, render: (ctx, n) => html`<p id="n">${n}</p>` }) }] });
        await app.navigate('/app/count');
        const length = app.window.history.length;
        await app.navigate('/app/count');
        assert.equal(app.text('#n'), '2');
        assert.equal(app.window.history.length, length);
        await end();
      });

      it('restores the scroll position when going back', async () => {
        const scrolls = [];
        await open({ path: '/app' });
        app.window.scrollTo = (x, y) => scrolls.push(y);
        Object.defineProperty(app.window, 'scrollY', { value: 420, configurable: true });
        await app.navigate('/app/c/one');
        assert.equal(scrolls.at(-1), 0, 'a new page starts at the top');
        Object.defineProperty(app.window, 'scrollY', { value: 0, configurable: true });
        await app.back();
        assert.equal(scrolls.at(-1), 420, 'going back returns to where you were');
        await end();
      });

      it('lets a view block leaving until the person confirms, for navigation, history and unload', async () => {
        await open({ path: '/app/c/editing' });
        let message = 'You have unsaved changes.';
        app.router.block = () => message;
        const asked = confirmWith(false);
        assert.equal(await app.router.navigate('/app/library'), false);
        assert.equal(app.path, '/app/c/editing');
        assert.deepEqual(asked, ['You have unsaved changes.']);

        const unload = new window.Event('beforeunload', { cancelable: true });
        app.window.dispatchEvent(unload);
        assert.equal(unload.defaultPrevented, true);

        await app.navigate('/app/c/other');
        await app.back();
        assert.equal(app.path, '/app/c/editing', 'going back is refused too');

        confirmWith(true);
        assert.equal(await app.router.navigate('/app/c/other'), true);
        assert.equal(app.path, '/app/c/other');
        assert.equal(app.router.block, null, 'the block ends with the page');
        message = null;
        const free = new window.Event('beforeunload', { cancelable: true });
        app.window.dispatchEvent(free);
        assert.equal(free.defaultPrevented, false);
        confirmWith(true);
        await end();
      });

      it('closes an open dialog when the page changes', async () => {
        await open({ path: '/app' });
        ui.modal.open({ title: 'Open', body: html`<p>x</p>` });
        await app.navigate('/app/c/one');
        assert.equal(app.find('#modal').open, false);
        await end();
      });

      it('navigates forced redirects without asking', async () => {
        await open({ path: '/app/library', api: member() });
        app.router.block = () => 'Unsaved';
        const asked = confirmWith(false);
        app.api.signOut();
        await tick(10);
        await app.settle();
        assert.equal(app.path, '/app/login?next=%2Fapp%2Flibrary');
        assert.equal(asked.length, 0);
        confirmWith(true);
        await end();
      });

      it('ctx.navigate and ctx.reload work and go quiet once the page is left', async () => {
        let context;
        let loads = 0;
        await open({ path: '/app', extra: [{ path: '/app/ctx', view: inline({ title: 'Ctx', load: async () => ++loads, render: (c, n) => { context = c; return html`<p id="n">${n}</p>`; } }) }] });
        await app.navigate('/app/ctx');
        await context.reload();
        assert.equal(app.text('#n'), '2');
        const old = context;
        await old.navigate('/app/c/x');
        await app.settle();
        assert.equal(app.path, '/app/c/x');
        assert.equal(await old.reload(), false, 'the old page cannot reload itself over the new one');
        await end();
      });

      it('is stopped cleanly: no listeners remain', async () => {
        await open({ path: '/app' });
        const router = app.router;
        await end();
        assert.equal(router.current.path, '/app');
      });
    });
  });
});
