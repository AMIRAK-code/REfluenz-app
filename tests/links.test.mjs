import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { installDom, uninstallDom, mountApp } from './helpers/dom.mjs';
import { createFakeApi, IDS } from './helpers/fake-api.mjs';
import { compileRoutes, matchRoute } from '../src/core/router.js';
import { routes } from '../src/core/routes.js';

// Cross-feature consistency: every link the pages draw lands on a route of docs/ARCHITECTURE.md section 3 and carries only query
// parameters that route reads, and the global styles of the feature stylesheets do not fight each other.

const E = IDS.entries;
const compiled = compileRoutes(routes);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// The query parameters each route reads (section 3), and the values the ones with a fixed set accept.
const QUERY = {
  '/app': [],
  '/app/discover': ['q', 'category', 'kind', 'sort'],
  '/app/c/:slug': ['join', 'tab'],
  '/app/p/:id': [],
  '/app/library': [],
  '/app/memberships': [],
  '/app/messages': [],
  '/app/messages/:creatorId/:memberId': [],
  '/app/notifications': [],
  '/app/studio': ['tab'],
  '/app/studio/new': ['kind'],
  '/app/studio/edit/:id': [],
  '/app/studio/settings': ['tab'],
  '/app/settings': ['tab'],
  '/app/login': ['next'],
  '/app/signup': ['next'],
  '/app/forgot': [],
  '/app/reset': [],
  '/app/welcome': ['next']
};
const VALUES = {
  '/app/c/:slug': { join: ['1'], tab: ['posts', 'membership', 'about'] },
  '/app/discover': { kind: ['text', 'image', 'video'], sort: ['popular', 'new'] },
  '/app/studio': { tab: ['published', 'drafts', 'members', 'notes'] },
  '/app/studio/new': { kind: ['text', 'image', 'video'] },
  '/app/studio/settings': { tab: ['atelier', 'tiers'] },
  '/app/settings': { tab: ['profile', 'account', 'notifications', 'data'] }
};

// The pages to read the links of, for each kind of visitor.
const PAGES = {
  guest: ['/app', '/app/discover', '/app/c/atelier-solene', `/app/p/${E.linenWardrobe}`, '/app/login', '/app/signup', '/app/forgot', '/app/does-not-exist'],
  member: [
    '/app', '/app/discover', '/app/discover?q=linen', '/app/c/atelier-solene', '/app/c/verne-and-co', '/app/c/casa-verano?tab=about', `/app/p/${E.linenWardrobe}`,
    '/app/library', '/app/memberships', '/app/messages', `/app/messages/${IDS.verne}/${IDS.member}`, '/app/notifications',
    '/app/studio', '/app/settings', '/app/settings?tab=account', '/app/settings?tab=notifications', '/app/settings?tab=data', '/app/welcome', '/app/does-not-exist'
  ],
  creator: [
    '/app', '/app/c/verne-and-co', '/app/c/verne-and-co?tab=membership', `/app/p/${E.firstDraftHabits}`, '/app/messages', '/app/notifications', '/app/memberships',
    '/app/studio', '/app/studio?tab=drafts', '/app/studio?tab=members', '/app/studio?tab=notes', '/app/studio/new', '/app/studio/new?kind=image', `/app/studio/edit/${E.firstDraftHabits}`,
    '/app/studio/settings', '/app/studio/settings?tab=tiers', '/app/settings'
  ]
};
const PERSONAS = {
  guest: () => createFakeApi({ signedIn: null }),
  member: () => createFakeApi(),
  creator: () => createFakeApi({ signedIn: IDS.owner })
};

describe('links between the areas', () => {
  before(() => installDom());
  after(() => uninstallDom());

  for (const [name, make] of Object.entries(PERSONAS)) {
    it(`every link on every page a ${name} sees leads to a route, and carries only parameters that route reads`, async () => {
      const app = await mountApp({ api: make(), path: '/app' });
      const problems = [];
      let seen = 0;
      for (const path of PAGES[name]) {
        await app.navigate(path);
        for (const anchor of app.document.querySelectorAll('#app a[href]')) {
          const href = anchor.getAttribute('href');
          if (!/^\/app(\/|\?|$)/.test(href)) continue;
          seen += 1;
          const url = new URL(href, 'http://localhost');
          const match = matchRoute(compiled, url.pathname);
          if (!match || match.route.path === '*') { problems.push(`${path}: ${href} matches no route`); continue; }
          const allowed = QUERY[match.route.path] ?? [];
          for (const [key, value] of url.searchParams) {
            if (!allowed.includes(key)) problems.push(`${path}: ${href} carries ?${key}, which ${match.route.path} does not read`);
            const accepted = VALUES[match.route.path]?.[key];
            if (accepted && !accepted.includes(value)) problems.push(`${path}: ${href} has ${key}=${value}, not one of ${accepted.join(', ')}`);
          }
        }
      }
      await app.destroy();
      assert.ok(seen > 40, `only ${seen} links were found`);
      assert.deepEqual([...new Set(problems)], []);
    });
  }

  it('the shell offers the same routes in the sidebar, the New post chooser and the mobile bar', async () => {
    const app = await mountApp({ api: createFakeApi({ signedIn: IDS.owner }), path: '/app' });
    const hrefs = selector => [...app.document.querySelectorAll(selector)].map(a => a.getAttribute('href'));
    const all = [...new Set(hrefs('#app a[href^="/app"]'))];
    for (const expected of ['/app', '/app/discover', '/app/library', '/app/messages', '/app/notifications', '/app/memberships', '/app/studio', '/app/settings']) {
      assert.ok(all.includes(expected), `the shell links ${expected}`);
    }
    for (const kind of ['text', 'image', 'video']) assert.ok(all.includes(`/app/studio/new?kind=${kind}`), `the New post chooser offers ${kind}`);
    await app.destroy();
  });

  it('the links of the landing page point at routes of the app', () => {
    const page = read('index.html');
    const found = [...page.matchAll(/href="(\/app[^"#]*)"/g)].map(match => match[1]);
    assert.ok(found.length >= 6);
    for (const href of found) {
      const url = new URL(href, 'http://localhost');
      const match = matchRoute(compiled, url.pathname);
      assert.ok(match && match.route.path !== '*', `${href} is a route`);
    }
    assert.doesNotMatch(page, /app\.html#/, 'the landing page no longer links hash routes');
  });
});

describe('the feature stylesheets', () => {
  const dir = new URL('../src/styles/', import.meta.url);
  const sheets = Object.fromEntries(readdirSync(dir).filter(name => name.endsWith('.css')).map(name => [name, readFileSync(new URL(name, dir), 'utf8')]));
  const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('are all linked from app.html', () => {
    const page = read('app.html');
    for (const name of Object.keys(sheets)) assert.ok(page.includes(`href="/src/styles/${name}"`), `${name} is linked`);
  });

  it('never restyle bare elements, the shell or another area from a feature sheet', () => {
    const owners = new Set(['base.css', 'shell.css']);
    const problems = [];
    for (const [name, css] of Object.entries(sheets)) {
      if (owners.has(name)) continue;
      // Selectors only: the text before each `{` that is not inside an @keyframes block.
      const selectors = [...strip(css).matchAll(/(?:^|})\s*([^{}@][^{}]*)\{/g)].map(match => match[1].trim()).filter(Boolean);
      for (const list of selectors) {
        // Pseudo-class arguments (:is(a, b), :not(.x)) are not selectors of their own.
        const flat = list.replace(/\([^()]*\)/g, '');
        for (const selector of flat.split(',').map(part => part.trim())) {
          if (/^(\d+%|from|to)$/.test(selector)) continue;
          const first = selector.split(/[\s>+~]/)[0];
          if (/^[a-z][a-z0-9]*$/.test(first)) problems.push(`${name}: bare element selector "${selector}"`);
          if (/^\.(shell|sidebar|topbar|bottombar|nav-item|toast|modal|skeleton|button|badge|avatar|card|tabs?|empty|error-state|eyebrow)(?![\w-])/.test(selector)) problems.push(`${name}: restyles a shared class with "${selector}"`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  it('declare each feature class once across the feature sheets', () => {
    // A class that two feature sheets both style as the head of a selector would let load order decide the look.
    const owned = new Map();
    const clashes = [];
    for (const [name, css] of Object.entries(sheets)) {
      if (name === 'base.css' || name === 'shell.css') continue;
      const heads = new Set([...strip(css).matchAll(/(?:^|[,{}])\s*\.([a-z][a-z0-9-]*)(?=[\s,{.:>\[+~])/g)].map(match => match[1]));
      for (const head of heads) {
        if (owned.has(head) && owned.get(head) !== name) clashes.push(`.${head}: ${owned.get(head)} and ${name}`);
        else owned.set(head, name);
      }
    }
    assert.deepEqual(clashes, []);
  });
});
