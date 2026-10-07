import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate, formatsFor, formatFor, readingMinutes, accessIds, RULES, paragraphs, pool } from '../src/views/editor/model.js';
import { KINDS, FORMATS, TEXT_FORMATS, DEFAULT_FORMAT, PRESETS } from '../src/core/constants.js';
import { csvCell } from '../src/views/studio/csv.js';
import { html } from '../src/core/ui.js';
import { cleanAtelier } from '../src/api/util.js';

// The rules of the old store.js test (validators, formats, CSV safety, escaping), as they live in the new modules.

const access = accessIds([{ id: 'essential' }, { id: 'premium' }, { id: 'signature' }]);
const base = { kind: 'text', title: 'A study', subtitle: '', body: 'word '.repeat(10).trim() + ' and a little more to pass the minimum.', category: 'Design', image: 'atelier', access: 'public', format: 'Essay' };
const check = (values, options = {}) => validate({ ...base, ...values }, { status: 'draft', access, ...options });

describe('post validation (editor model)', () => {
  it('accepts a complete text post and trims nothing it was not given', () => {
    assert.equal(check({}), null);
    assert.equal(check({ access: 'premium' }), null);
  });

  it('keeps the title between 3 and 100 characters, for every kind', () => {
    for (const kind of KINDS) {
      assert.equal(check({ kind, title: 'ab' }).field, 'title', kind);
      assert.match(check({ kind, title: 'ab' }).message, /title/, kind);
      assert.equal(check({ kind, title: 't'.repeat(101) }).field, 'title', kind);
      assert.equal(check({ kind, title: 'abc' })?.field, undefined, kind);
    }
  });

  it('keeps the introduction under 180 characters, for every kind', () => {
    for (const kind of KINDS) {
      assert.match(check({ kind, subtitle: 's'.repeat(181) }).message, /introduction/, kind);
      assert.equal(check({ kind, subtitle: 's'.repeat(180) })?.field, undefined, kind);
    }
  });

  it('needs between 30 and 20,000 characters for a text post', () => {
    assert.match(check({ body: 'short' }).message, /30 and 20,000/);
    assert.match(check({ body: 'x'.repeat(20001) }).message, /30 and 20,000/);
    assert.equal(check({ body: 'x'.repeat(30) }), null);
    assert.equal(check({ body: 'x'.repeat(20000) }), null);
  });

  it('lets image and video posts go without a caption, but not beyond 20,000 characters', () => {
    for (const kind of ['image', 'video']) {
      assert.equal(check({ kind, body: '' }), null, kind);
      assert.equal(check({ kind, body: '  A caption.  ' }), null, kind);
      assert.equal(check({ kind, body: 'x'.repeat(20000) }), null, kind);
      assert.match(check({ kind, body: 'x'.repeat(20001) }).message, /caption/, kind);
    }
  });

  it('rejects a post type that does not exist', () => {
    assert.equal(check({ kind: 'audio' }).field, 'kind');
    assert.match(check({ kind: 'audio' }).message, /post type/);
    assert.equal(check({ kind: '' }).field, 'kind');
  });

  it('accepts only the access levels of the atelier, a known category and a known cover', () => {
    assert.match(check({ access: 'vip' }).message, /who can read/);
    assert.equal(check({ access: 'public' }), null);
    assert.equal(check({ access: 'signature' }, { access: ['public', 'essential'] }).field, 'access', 'a tier the atelier does not have');
    assert.match(check({ category: 'Astrology' }).message, /category/);
    assert.match(check({ image: 'javascript:alert(1)' }).message, /cover/);
    for (const preset of PRESETS) assert.equal(check({ image: preset }), null, preset);
  });

  it('needs a picture or a film to publish, but not to save a draft, and holds the media limits', () => {
    assert.equal(check({ kind: 'image', body: '' }, { status: 'draft', mediaCount: 0 }), null);
    assert.match(check({ kind: 'image', body: '' }, { status: 'published', mediaCount: 0 }).message, /at least one image/);
    assert.equal(check({ kind: 'image', body: '' }, { status: 'published', mediaCount: 10 }), null);
    assert.match(check({ kind: 'image', body: '' }, { status: 'draft', mediaCount: 11 }).message, /up to 10 images/);
    assert.match(check({ kind: 'video', body: '' }, { status: 'published', mediaCount: 0 }).message, /Add a video/);
    assert.match(check({ kind: 'video', body: '' }, { status: 'draft', mediaCount: 2 }).message, /exactly one video/);
    assert.equal(check({ kind: 'video', body: '' }, { status: 'published', mediaCount: 1 }), null);
  });

  it('keeps its limits in one frozen table', () => {
    assert.deepEqual({ ...RULES }, { titleMin: 3, titleMax: 100, bodyMin: 30, bodyMax: 20000, introMax: 180, altMax: 200 });
    assert.throws(() => { 'use strict'; RULES.titleMin = 1; });
  });
});

describe('formats and reading time', () => {
  it('offers the five text formats for text and every format for media, in a fixed order', () => {
    assert.deepEqual(formatsFor('text'), TEXT_FORMATS);
    assert.deepEqual(formatsFor('image'), FORMATS);
    assert.deepEqual(formatsFor('video'), FORMATS);
    assert.ok(FORMATS.includes('Gallery') && FORMATS.includes('Film'));
    assert.deepEqual(DEFAULT_FORMAT, { text: 'Essay', image: 'Gallery', video: 'Film' });
  });

  it('falls back to the default format of the kind, and keeps any format that fits', () => {
    assert.equal(formatFor('text', 'Nope'), 'Essay');
    assert.equal(formatFor('video', 'Nope'), 'Film');
    assert.equal(formatFor('image', undefined), 'Gallery');
    assert.equal(formatFor('video', 'Essay'), 'Essay', 'any known format may be chosen for media');
    assert.equal(formatFor('text', 'Film'), 'Essay', 'a text post cannot be a film');
    assert.equal(formatFor('text', 'Guide'), 'Guide');
  });

  it('keeps an old "Update" format when editing a post that has it', () => {
    assert.ok(formatsFor('text', 'Update').includes('Update'));
    assert.equal(formatFor('text', 'Update'), 'Update');
    assert.ok(!formatsFor('text').includes('Update'));
  });

  it('derives the reading time from the words, at 200 a minute and at least one', () => {
    assert.equal(readingMinutes('word '.repeat(450)), 3);
    assert.equal(readingMinutes('word '.repeat(200)), 1);
    assert.equal(readingMinutes('word '.repeat(201)), 2);
    assert.equal(readingMinutes(''), 1);
    assert.equal(readingMinutes(null), 1);
  });

  it('splits the text into paragraphs on blank lines', () => {
    assert.deepEqual(paragraphs('One.\n\nTwo.\r\n \r\nThree.'), ['One.', 'Two.', 'Three.']);
    assert.deepEqual(paragraphs(''), []);
  });
});

describe('the pool of uploads', () => {
  it('runs at most `limit` jobs at once and reports failures in order', async () => {
    let running = 0;
    let peak = 0;
    const errors = await pool([1, 2, 3, 4, 5], 2, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      running -= 1;
    });
    assert.deepEqual(errors, []);
    assert.equal(peak, 2);
  });

  it('starts nothing new after a failure, but awaits the jobs that are running', async () => {
    const started = [];
    const errors = await pool(['a', 'b', 'c', 'd'], 2, async item => {
      started.push(item);
      await new Promise(resolve => setTimeout(resolve, 5));
      if (item === 'a') throw Error('a failed');
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'a failed');
    assert.deepEqual(started, ['a', 'b'], 'the third file never started');
  });
});

describe('atelier validation (api rules shared by the views)', () => {
  it('trims, limits and names every wrong field', () => {
    const values = cleanAtelier({ name: ' Aria ', category: 'Design', image: 'ritual', descriptor: ' Quiet work ' });
    assert.equal(values.name, 'Aria');
    assert.equal(values.descriptor, 'Quiet work');
    assert.throws(() => cleanAtelier({ name: 'Aria', category: 'Design', image: 'ritual', descriptor: 'x'.repeat(90) }), /60 characters/);
    assert.throws(() => cleanAtelier({ name: 'A', category: 'Design', image: 'ritual' }), /name/i);
    assert.throws(() => cleanAtelier({ name: 'Aria', category: 'Astrology', image: 'ritual' }), /category/i);
  });
});

describe('escaping and CSV safety', () => {
  it('escapes markup in text and attributes', () => {
    assert.equal(String(html`${`<a href="x">'&`}`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    assert.equal(String(html`<p title="${'"><script>'}">x</p>`).includes('<script>'), false);
  });

  it('quotes every cell and defuses spreadsheet formulas', () => {
    assert.equal(csvCell('=SUM(A1)'), `"'=SUM(A1)"`);
    assert.equal(csvCell('@cmd'), `"'@cmd"`);
    assert.equal(csvCell('+1'), `"'+1"`);
    assert.equal(csvCell('-1'), `"'-1"`);
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  });
});
