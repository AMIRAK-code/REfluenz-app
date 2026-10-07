import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createApi } from '../src/api/index.js';
import { routes } from '../src/core/routes.js';
import { createFakeApi, IDS } from './helpers/fake-api.mjs';
import { stubApi } from './helpers/dom.mjs';

// The contract of docs/ARCHITECTURE.md, checked against the code on both sides: the real data layer (src/api), the in-memory one the view
// tests run on (tests/helpers/fake-api.mjs), and everything that calls them (the core, the views, main.js).

const ROOT = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, ROOT), 'utf8');
const doc = read('docs/ARCHITECTURE.md');
const section = (from, to) => doc.slice(doc.indexOf(from), doc.indexOf(to));

// The real api, built over a client that does nothing: createApi only wires functions together.
const idle = { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, from() {}, rpc() {}, storage: {}, channel() {} };
const real = createApi(idle);
const FAKE_HELPERS = ['session', 'db', 'calls', 'signInAs', 'confirmEmail', 'fail', 'emit', 'refresh'];
const fake = createFakeApi();
const fakeMethods = Object.keys(fake).filter(name => !FAKE_HELPERS.includes(name));

// "`name(args)`" in the Methods list of section 6.
const documented = [...new Set([...section('**Methods**', '**Notes**').matchAll(/\b([a-z][A-Za-z]+)\(/g)].map(match => match[1]))];

describe('contract: the api methods', () => {
  it('lists the same methods in docs/ARCHITECTURE.md, the real api and the fake api', () => {
    const names = list => [...list].sort();
    assert.ok(documented.length >= 60, `the document lists ${documented.length} methods`);
    assert.deepEqual(names(Object.keys(real)), names(documented), 'src/api against section 6');
    assert.deepEqual(names(fakeMethods), names(documented), 'tests/helpers/fake-api.mjs against section 6');
    for (const name of documented) {
      assert.equal(typeof real[name], 'function', `real.${name}`);
      assert.equal(typeof fake[name], 'function', `fake.${name}`);
    }
  });

  it('is what the test stand-in is built on: it only adds helpers and redefines real methods', () => {
    const stub = stubApi();
    const own = ['calls', 'session', 'viewer', 'unread', 'emit', 'pushRealtime'];
    const unknown = Object.keys(stub).filter(name => !own.includes(name) && !documented.includes(name));
    assert.deepEqual(unknown, [], 'stubApi() invents methods that are not in the contract');
    assert.deepEqual(documented.filter(name => typeof stub[name] !== 'function'), [], 'and lacks none');
  });

  it('is called only with methods that exist, by the core, main.js and every view', () => {
    const files = [];
    const walk = dir => {
      for (const entry of readdirSync(new URL(dir, ROOT))) {
        const path = `${dir}${entry}`;
        if (statSync(new URL(path, ROOT)).isDirectory()) walk(`${path}/`);
        else if (path.endsWith('.js')) files.push(path);
      }
    };
    for (const dir of ['src/core/', 'src/views/']) walk(dir);
    files.push('src/main.js');
    const used = new Map();
    for (const file of files) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const [, name] of code.matchAll(/\bapi\??\.(\w+)(?:\?\.)?\(/g)) used.set(name, [...(used.get(name) ?? []), file]);
    }
    assert.ok(used.size >= 10, `found ${used.size} calls`);
    const missing = [...used].filter(([name]) => !documented.includes(name)).map(([name, where]) => `${name} (${[...new Set(where)].join(', ')})`);
    assert.deepEqual(missing, [], 'api methods that the contract does not have');
  });
});

// "`Name { a, b?, c: type }`" lines of section 6 → the keys of each shape, optional ones marked with "?".
function shapesOf(text) {
  const shapes = {};
  for (const [, name, body] of text.matchAll(/`(\w+) \{([^`]*)\}`/g)) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const char of body.replace(/\/\*.*?\*\//g, '')) {
      if ('[{('.includes(char)) depth++;
      if (']})'.includes(char)) depth--;
      if (char === ',' && depth === 0) { parts.push(current); current = ''; } else current += char;
    }
    parts.push(current);
    shapes[name] = parts.map(part => /^\s*(\w+)(\?)?/.exec(part)).filter(Boolean).map(([, key, optional]) => ({ key, optional: Boolean(optional) }));
  }
  return shapes;
}

describe('contract: the shapes of results', () => {
  const shapes = shapesOf(section('**Shapes**', '**Methods**'));

  const sameKeys = (name, value) => {
    assert.ok(value && typeof value === 'object', `${name}: an object`);
    const keys = Object.keys(value);
    const expected = shapes[name];
    assert.deepEqual(expected.filter(field => !field.optional && !keys.includes(field.key)).map(field => field.key), [], `${name}: keys the contract lists and the result lacks`);
    assert.deepEqual(keys.filter(key => !expected.some(field => field.key === key)), [], `${name}: keys the result has and the contract does not list`);
  };

  it('are described in the document', () => {
    for (const name of ['Creator', 'Tier', 'Entry', 'Person', 'Comment', 'Membership', 'Thread', 'Message', 'Note', 'Notification', 'Stats']) assert.ok(shapes[name]?.length >= 3, name);
  });

  it('are those the fake api returns (it shares its mappers with src/api)', async () => {
    const owner = createFakeApi({ signedIn: IDS.owner });
    const { items } = await owner.feed({ scope: 'all' });
    sameKeys('Entry', items[0]);
    sameKeys('Entry', await owner.getEntry(IDS.entries.firstDraftHabits));
    sameKeys('Creator', await owner.getCreator(IDS.verne));
    sameKeys('Creator', (await owner.getCreatorBySlug('verne-and-co')).creator);
    sameKeys('Tier', (await owner.listTiers(IDS.verne))[0]);
    sameKeys('Stats', await owner.creatorStats(IDS.verne));
    sameKeys('Note', (await owner.listNotes(IDS.verne))[0]);
    const [thread] = await owner.inbox();
    sameKeys('Thread', thread);
    sameKeys('Message', (await owner.thread(thread.creatorId, thread.memberId))[0]);

    const viewer = await createFakeApi().loadViewer();
    assert.deepEqual(Object.keys(viewer).sort(), ['following', 'liked', 'memberships', 'myCreator', 'profile', 'saved', 'settings', 'tiers'], 'loadViewer');
    sameKeys('Membership', viewer.memberships[0]);

    const world = createFakeApi({ signedIn: IDS.fan1 });
    const comment = await world.addComment(IDS.entries.firstDraftHabits, 'A good start.');
    sameKeys('Comment', comment);
    sameKeys('Person', comment.author);
    world.signInAs(IDS.owner);
    sameKeys('Notification', (await world.listNotifications()).items[0]);
  });

  it('are the pages the lists return: items and nextCursor', async () => {
    for (const page of [await fake.feed({ scope: 'all' }), await fake.savedEntries(), await fake.listNotifications(), await fake.creatorEntries(IDS.solene)]) {
      assert.deepEqual(Object.keys(page).sort(), ['items', 'nextCursor']);
      assert.ok(Array.isArray(page.items));
    }
  });
});

describe('contract: the routes', () => {
  // | `/app/c/:slug` (`?join=1` opens the join dialog) | `views/creator.js` | optional |
  const rows = section('## 3. Routes', '## 4.').split('\n').filter(line => line.startsWith('| `/app')).map(line => {
    const [, first, second, third] = line.replaceAll('\\|', '\u0001').split('|').map(cell => cell.trim());
    return {
      paths: [...first.matchAll(/`(\/app[^`\s?]*)`/g)].map(match => match[1]),
      view: /`(views\/[^`]+)`/.exec(second)?.[1],
      auth: third.startsWith('recovery') ? 'recovery' : third.split(/\s/)[0]
    };
  });

  it('has a route for every path of section 3, loading the view module it names', () => {
    assert.ok(rows.length >= 15);
    for (const row of rows) {
      for (const path of row.paths) {
        const route = routes.find(candidate => candidate.path === path);
        assert.ok(route, `no route for ${path}`);
        assert.ok(String(route.view).includes(`../${row.view}'`), `${path} should load ${row.view}`);
      }
    }
    const documentedPaths = rows.flatMap(row => row.paths);
    assert.deepEqual(routes.map(route => route.path).filter(path => path !== '*' && !documentedPaths.includes(path)), [], 'routes that the document does not list');
    assert.equal(routes.at(-1).path, '*', 'the catch-all comes last');
  });

  it('guards each path as section 3 says (the route’s own auth, else the view’s)', async () => {
    for (const row of rows) {
      for (const path of row.paths) {
        const route = routes.find(candidate => candidate.path === path);
        const view = (await route.view()).default;
        assert.equal(route.auth ?? view.auth, row.auth, path);
      }
    }
  });
});
