import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, classify, mimeOf, validateFiles, formatDuration, fitWithin, prepareImage, prepareVideo, stripGifMetadata, thumbnail } from '../src/media.js';

const MB = 1024 * 1024;
const f = (name, type, size = 1000) => ({ name, type, size });
const files = (n, name, type) => Array.from({ length: n }, (_, i) => f(`${i}-${name}`, type));

test('LIMITS has the documented shape', () => {
 assert.deepEqual(LIMITS, { maxImages: 10, maxImageInputBytes: 25 * MB, maxVideoBytes: 50 * MB,
  imageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], videoTypes: ['video/mp4', 'video/webm', 'video/quicktime'] });
 assert.equal(LIMITS.maxVideoBytes, 52428800, 'matches the entry-media bucket limit');
 assert.ok(Object.isFrozen(LIMITS) && Object.isFrozen(LIMITS.imageTypes), 'callers cannot loosen the limits');
});

test('classify goes by MIME type and falls back to the extension', () => {
 assert.equal(classify(f('a.jpg', 'image/jpeg')), 'image');
 assert.equal(classify(f('a', 'image/png')), 'image');
 assert.equal(classify(f('a.mp4', 'video/mp4')), 'video');
 assert.equal(classify(f('a', 'video/quicktime')), 'video');
 for (const name of ['a.jpg', 'a.JPEG', 'a.png', 'A.WebP', 'a.gif', 'multi.dot.name.png']) assert.equal(classify(f(name, '')), 'image', name);
 for (const name of ['a.mp4', 'a.WEBM', 'a.mov', 'a.m4v']) assert.equal(classify(f(name, '')), 'video', name);
 assert.equal(classify(f('IMG_1.jpg', 'application/octet-stream')), 'image');
 assert.equal(classify(f('clip.mov', 'application/octet-stream')), 'video');
 assert.equal(classify(f('lie.mp4', 'image/png')), 'image', 'the MIME type wins over the extension');
});
test('classify rejects everything else', () => {
 for (const [name, type] of [['a.pdf', 'application/pdf'], ['a.svg', 'image/svg+xml'], ['a.heic', 'image/heic'], ['a.mkv', 'video/x-matroska'], ['a.avi', ''], ['noext', ''], ['a.', ''], ['', ''], ['.jpg.exe', '']]) assert.equal(classify(f(name, type)), null, name);
 assert.equal(classify({}), null);
 assert.equal(classify(null), null);
 assert.equal(classify(undefined), null);
});
test('mimeOf normalises the types browsers report badly', () => {
 assert.equal(mimeOf(f('Holiday.MOV', '')), 'video/quicktime');
 assert.equal(mimeOf(f('a.mov', 'video/mp4')), 'video/quicktime');
 assert.equal(mimeOf(f('a.m4v', 'video/x-m4v')), 'video/mp4');
 assert.equal(mimeOf(f('a.mp4', '')), 'video/mp4');
 assert.equal(mimeOf(f('a.webm', 'video/webm')), 'video/webm');
 assert.equal(mimeOf(f('a.jpeg', '')), 'image/jpeg');
 assert.equal(mimeOf(f('a.png', 'IMAGE/PNG')), 'image/png');
 assert.equal(mimeOf(f('a.heic', 'image/heic')), '');
 assert.equal(mimeOf(null), '');
});

test('validateFiles accepts valid selections', () => {
 const ok = (...args) => assert.doesNotThrow(() => validateFiles(...args));
 ok('image', [f('a.jpg', 'image/jpeg')], 0);
 ok('image', files(10, 'a.png', 'image/png'), 0);
 ok('image', files(10, 'a.png', 'image/png'));
 ok('image', [f('a.webp', 'image/webp'), f('b.gif', 'image/gif')], 8);
 ok('image', [f('exactly.jpg', 'image/jpeg', LIMITS.maxImageInputBytes)], 0);
 ok('image', [f('IMG_0001.JPG', '')], 3);
 ok('image', { length: 1, 0: f('a.jpg', 'image/jpeg') }, 0);
 ok('video', [f('a.mp4', 'video/mp4', LIMITS.maxVideoBytes)], 0);
 ok('video', [f('a.webm', 'video/webm')], 0);
 ok('video', [f('Holiday.MOV', '')], 0);
 ok('text', [], 0);
 assert.equal(validateFiles('image', [f('a.jpg', 'image/jpeg')], 0), undefined);
});
test('validateFiles asks for a file when nothing is selected', () => {
 assert.throws(() => validateFiles('image', [], 0), /No file was selected\. Choose an image \(JPG, PNG, WebP or GIF\)/);
 assert.throws(() => validateFiles('video', [], 0), /No file was selected\. Choose a video \(MP4, WebM or MOV\)/);
 assert.throws(() => validateFiles('image', null, 2), /No file was selected/);
 assert.throws(() => validateFiles('video', undefined, 0), /No file was selected/);
});
test('validateFiles names the problem when the type does not fit the post kind', () => {
 assert.throws(() => validateFiles('image', [f('clip.mp4', 'video/mp4')], 0), /"clip\.mp4" is a video, but this is an image post\. Use JPG, PNG, WebP or GIF\./);
 assert.throws(() => validateFiles('video', [f('photo.jpg', 'image/jpeg')], 0), /"photo\.jpg" is an image, but this is a video post\. Use MP4, WebM or MOV\./);
 assert.throws(() => validateFiles('image', [f('a.jpg', 'image/jpeg'), f('clip.mov', '')], 0), /"clip\.mov" is a video/, 'one bad file in a good batch');
 assert.throws(() => validateFiles('image', [f('doc.pdf', 'application/pdf')], 0), /"doc\.pdf" is not a supported image\. Use JPG, PNG, WebP or GIF\./);
 assert.throws(() => validateFiles('image', [f('shot.heic', 'image/heic')], 0), /"shot\.heic" is not a supported image/);
 assert.throws(() => validateFiles('image', [f('logo.svg', 'image/svg+xml')], 0), /not a supported image/);
 assert.throws(() => validateFiles('video', [f('a.mkv', 'video/x-matroska')], 0), /"a\.mkv" is not a supported video\. Use MP4, WebM or MOV\./);
 assert.throws(() => validateFiles('image', [f('a.mkv', 'video/x-matroska')], 0), /"a\.mkv" is a video, but this is an image post/);
 assert.throws(() => validateFiles('video', [f('notes.txt', 'text/plain')], 0), /not a supported video/);
 assert.throws(() => validateFiles('video', [f('mystery', '')], 0), /"mystery" is not a supported video/);
});
test('validateFiles limits the number of images, counting the ones already on the post', () => {
 assert.throws(() => validateFiles('image', files(11, 'a.jpg', 'image/jpeg'), 0), /Too many images: you chose 11, but a post holds up to 10\./);
 assert.throws(() => validateFiles('image', files(3, 'a.jpg', 'image/jpeg'), 8), /already has 8 images, so you can add 2 more \(up to 10 per post\)\./);
 assert.throws(() => validateFiles('image', files(2, 'a.jpg', 'image/jpeg'), 9), /already has 9 images, so you can add 1 more/);
 assert.throws(() => validateFiles('image', files(10, 'a.jpg', 'image/jpeg'), 1), /already has 1 image, so you can add 9 more/);
 assert.throws(() => validateFiles('image', files(1, 'a.jpg', 'image/jpeg'), 10), /already has the maximum of 10 images\. Remove one/);
 assert.throws(() => validateFiles('image', files(1, 'a.jpg', 'image/jpeg'), 14), /maximum of 10/);
});
test('validateFiles allows exactly one video', () => {
 assert.throws(() => validateFiles('video', [f('a.mp4', 'video/mp4'), f('b.mp4', 'video/mp4')], 0), /Choose a single video: a post holds exactly one\./);
 assert.throws(() => validateFiles('video', [f('a.mp4', 'video/mp4')], 1), /already has a video\. Remove it before adding another\./);
});
test('validateFiles enforces the size limits', () => {
 assert.throws(() => validateFiles('video', [f('big.mp4', 'video/mp4', LIMITS.maxVideoBytes + 1)], 0), /"big\.mp4" is 50\.1 MB\. Videos can be up to 50 MB\./);
 assert.throws(() => validateFiles('video', [f('huge.webm', 'video/webm', 200 * MB)], 0), /is 200 MB\. Videos can be up to 50 MB/);
 assert.throws(() => validateFiles('image', [f('raw.png', 'image/png', LIMITS.maxImageInputBytes + 1)], 0), /"raw\.png" is 25\.1 MB\. Images can be up to 25 MB/);
 assert.throws(() => validateFiles('image', [f('a.jpg', 'image/jpeg'), f('raw.jpg', 'image/jpeg', 40 * MB)], 0), /"raw\.jpg" is 40 MB/);
 assert.throws(() => validateFiles('image', [f('zero.jpg', 'image/jpeg', 0)], 0), /"zero\.jpg" is empty\./);
 assert.throws(() => validateFiles('video', [f('zero.mp4', 'video/mp4', 0)], 0), /is empty/);
});
test('validateFiles handles text posts, unknown kinds and long names', () => {
 assert.throws(() => validateFiles('text', [f('a.jpg', 'image/jpeg')], 0), /Text entries carry no images or videos/);
 assert.throws(() => validateFiles('poem', [f('a.jpg', 'image/jpeg')], 0), /Choose Text, Image or Video/);
 assert.throws(() => validateFiles(undefined, [], 0), /Choose Text, Image or Video/);
 const long = 'x'.repeat(80) + '.pdf';
 assert.throws(() => validateFiles('image', [f(long, 'application/pdf')], 0), e => e.message.includes('"' + 'x'.repeat(37) + '..."') && !e.message.includes(long));
 assert.throws(() => validateFiles('image', [{ type: 'application/pdf', size: 5 }], 0), /^Error: This file is not a supported image/);
});

test('formatDuration formats m:ss and h:mm:ss', () => {
 for (const [seconds, text] of [[7, '0:07'], [0, '0:00'], [59, '0:59'], [60, '1:00'], [185, '3:05'], [600, '10:00'], [3599, '59:59'], [3600, '1:00:00'], [3723, '1:02:03'], [36000, '10:00:00']]) assert.equal(formatDuration(seconds), text, String(seconds));
});
test('formatDuration rounds and tolerates junk', () => {
 for (const [input, text] of [[59.6, '1:00'], [7.4, '0:07'], [7.5, '0:08'], ['12', '0:12'], [NaN, '0:00'], [Infinity, '0:00'], [-5, '0:00'], [null, '0:00'], [undefined, '0:00'], ['abc', '0:00']]) assert.equal(formatDuration(input), text, String(input));
});

test('fitWithin scales the long edge down and never upscales', () => {
 assert.deepEqual(fitWithin(4000, 3000, 2400), { width: 2400, height: 1800 });
 assert.deepEqual(fitWithin(3000, 4000, 2400), { width: 1800, height: 2400 });
 assert.deepEqual(fitWithin(6000, 6000, 2400), { width: 2400, height: 2400 });
 assert.deepEqual(fitWithin(1920, 1080, 1280), { width: 1280, height: 720 });
 assert.deepEqual(fitWithin(2400, 1600, 2400), { width: 2400, height: 1600 }, 'already at the limit');
 assert.deepEqual(fitWithin(800, 600, 2400), { width: 800, height: 600 }, 'smaller images are left alone');
 assert.deepEqual(fitWithin(1, 1, 2400), { width: 1, height: 1 });
});
test('fitWithin returns integers of at least 1 and survives extreme ratios', () => {
 const fit = fitWithin(4001, 3001, 2400);
 assert.ok(Number.isInteger(fit.width) && Number.isInteger(fit.height));
 assert.equal(fit.width, 2400);
 assert.equal(fit.height, Math.round(3001 * 2400 / 4001));
 assert.deepEqual(fitWithin(10000, 1, 2400), { width: 2400, height: 1 });
 assert.deepEqual(fitWithin(1, 10000, 2400), { width: 1, height: 2400 });
 assert.deepEqual(fitWithin(799.6, 600.2, 2400), { width: 800, height: 600 }, 'fractional sizes are rounded');
 assert.deepEqual(fitWithin(500, 400, 0), { width: 500, height: 400 }, 'no limit given');
});
test('fitWithin reports unusable sizes as 0 x 0', () => {
 for (const [w, h] of [[0, 100], [100, 0], [-5, 10], [NaN, 10], [10, undefined], [Infinity, 10], [0.2, 0.2]]) assert.deepEqual(fitWithin(w, h, 2400), { width: 0, height: 0 }, `${w} x ${h}`);
});

// prepareImage / prepareVideo against hand-made browser fakes (restored after each test).
const withGlobals = async (patch, run) => {
 const saved = Object.keys(patch).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
 for (const [key, value] of Object.entries(patch)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
 try { return await run(); } finally { for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; }
};
// Records every encode. `size` decides how big each encoded blob is; `webp: false` mimics browsers that answer PNG. The 1 x 1 probe that
// asks whether WebP can be encoded at all has no quality, so `real(log)` leaves it out. `watch` sees every real encode as it happens.
const canvasFake = ({ webp = true, size = () => 100, watch = () => {} } = {}) => {
 const log = [], canvases = [];
 class FakeCanvas {
  constructor(width, height) { this.width = width; this.height = height; canvases.push(this); }
  getContext() { return { fillRect() {}, drawImage() {} }; }
  async convertToBlob({ type, quality }) {
   const out = type === 'image/webp' && !webp ? 'image/png' : type;
   log.push({ width: this.width, height: this.height, type, quality });
   if (quality !== undefined) watch();
   return new Blob([new Uint8Array(size({ width: this.width, height: this.height, type: out, quality }))], { type: out });
  }
 }
 return { FakeCanvas, log, canvases };
};
const real = log => log.filter(e => e.quality !== undefined);
const bitmapFake = (width, height) => {
 const state = { width, height, closed: false, options: [] };
 state.createImageBitmap = async (file, options) => { state.options.push(options); return { width, height, close() { state.closed = true; } }; };
 return state;
};
const picture = (size, name = 'IMG_1.JPG', type = 'image/jpeg') => new File([new Uint8Array(size)], name, { type });

test('prepareImage downscales to 2400px WebP, makes a 32px preview and a 640px card thumbnail', async () => {
 const { FakeCanvas, log } = canvasFake({ size: ({ width }) => width === 32 ? 800 : width === 640 ? 40000 : 200000 }), bitmap = bitmapFake(4000, 3000);
 const file = picture(5 * MB);
 const out = await withGlobals({ createImageBitmap: bitmap.createImageBitmap, OffscreenCanvas: FakeCanvas }, () => prepareImage(file));
 assert.deepEqual({ kind: out.kind, mime: out.mime, ext: out.ext, size: out.size, width: out.width, height: out.height, duration: out.duration, name: out.name },
  { kind: 'image', mime: 'image/webp', ext: 'webp', size: 200000, width: 2400, height: 1800, duration: null, name: 'IMG_1.JPG' });
 assert.equal(out.blob.type, 'image/webp');
 assert.equal(out.blob.size, out.size);
 assert.equal(out.preview.type, 'image/webp');
 assert.equal(out.preview.size, 800);
 assert.deepEqual([out.poster.type, out.poster.size], ['image/webp', 40000], 'the card thumbnail travels as the poster');
 assert.deepEqual(real(log), [{ width: 32, height: 24, type: 'image/webp', quality: 0.6 }, { width: 2400, height: 1800, type: 'image/webp', quality: 0.86 }, { width: 640, height: 480, type: 'image/webp', quality: 0.72 }]);
 assert.deepEqual(bitmap.options, [{ imageOrientation: 'from-image' }]);
 assert.equal(bitmap.closed, true, 'the bitmap is released');
});
test('prepareImage releases the full-size bitmap before it encodes anything', async () => {
 const bitmap = bitmapFake(4000, 3000), seen = [];
 const { FakeCanvas } = canvasFake({ watch: () => seen.push(bitmap.closed) });
 await withGlobals({ createImageBitmap: bitmap.createImageBitmap, OffscreenCanvas: FakeCanvas }, () => prepareImage(picture(MB)));
 assert.ok(seen.length >= 3 && seen.every(Boolean), 'preview, main and thumbnail all come from the small canvas');
});
test('prepareImage frees the canvas it drew the picture on', async () => {
 const { FakeCanvas, canvases } = canvasFake();
 await withGlobals({ createImageBitmap: bitmapFake(3000, 2000).createImageBitmap, OffscreenCanvas: FakeCanvas }, () => prepareImage(picture(MB)));
 const base = canvases.find(c => c.width === 0 && c.height === 0);
 assert.ok(base, 'the working canvas is shrunk to nothing when the work is done');
});
test('prepareImage goes straight to JPEG when the browser cannot encode WebP', async () => {
 const { FakeCanvas, log } = canvasFake({ webp: false }), bitmap = bitmapFake(1000, 500);
 const out = await withGlobals({ createImageBitmap: bitmap.createImageBitmap, OffscreenCanvas: FakeCanvas }, () => prepareImage(picture(MB, 'a.png', 'image/png')));
 assert.equal(out.mime, 'image/jpeg');
 assert.equal(out.ext, 'jpg');
 assert.equal(out.blob.type, 'image/jpeg');
 assert.equal(out.preview.type, 'image/jpeg');
 assert.equal(out.poster.type, 'image/jpeg');
 assert.deepEqual(real(log).map(e => [e.type, e.quality]), [['image/jpeg', 0.6], ['image/jpeg', 0.88], ['image/jpeg', 0.78]], 'no PNG is ever encoded and thrown away first');
});
test('prepareImage asks whether WebP works once per canvas implementation, not once per image', async () => {
 const { FakeCanvas, log } = canvasFake();
 await withGlobals({ createImageBitmap: bitmapFake(800, 600).createImageBitmap, OffscreenCanvas: FakeCanvas }, async () => { await prepareImage(picture(MB)); await prepareImage(picture(MB)); await prepareImage(picture(MB)); });
 assert.equal(log.filter(e => e.quality === undefined).length, 1);
 const other = canvasFake({ webp: false });
 await withGlobals({ createImageBitmap: bitmapFake(800, 600).createImageBitmap, OffscreenCanvas: other.FakeCanvas }, async () => { await prepareImage(picture(MB)); });
 assert.equal(other.log.filter(e => e.quality === undefined).length, 1, 'a different implementation is probed on its own');
 assert.ok(real(other.log).every(e => e.type === 'image/jpeg'));
});
test('prepareImage never uploads the original bytes of a still, so EXIF and GPS cannot reach the server', async () => {
 const { FakeCanvas } = canvasFake({ size: ({ width }) => width === 32 ? 300 : 20000 }), bitmap = bitmapFake(800, 600);
 const file = picture(10000, 'icon.png', 'image/png');
 const out = await withGlobals({ createImageBitmap: bitmap.createImageBitmap, OffscreenCanvas: FakeCanvas }, () => prepareImage(file));
 assert.notEqual(out.blob, file);
 assert.deepEqual([out.mime, out.ext, out.size, out.width, out.height], ['image/webp', 'webp', 20000, 800, 600], 'the re-encode is used even though it came out bigger');
 assert.equal(out.preview.size, 300);
});
test('prepareImage retries a re-encode that came out bigger than the original at a lower quality', async () => {
 const { FakeCanvas, log } = canvasFake({ size: ({ width, quality }) => width === 32 ? 300 : quality === 0.7 ? 8000 : 20000 });
 const out = await withGlobals({ createImageBitmap: bitmapFake(800, 600).createImageBitmap, OffscreenCanvas: FakeCanvas }, () => prepareImage(picture(10000, 'lightroom.jpg', 'image/jpeg')));
 assert.equal(out.size, 8000);
 assert.deepEqual(real(log).slice(1, 3).map(e => [e.width, e.quality]), [[800, 0.86], [800, 0.7]]);
 const small = await withGlobals({ createImageBitmap: bitmapFake(800, 600).createImageBitmap, OffscreenCanvas: canvasFake({ size: () => 500 }).FakeCanvas }, () => prepareImage(picture(10000, 'small.jpg', 'image/jpeg')));
 assert.equal(small.size, 500, 'a re-encode that is already smaller is left alone');
});
test('prepareImage re-encodes a file whose type the browser did not report', async () => {
 const { FakeCanvas } = canvasFake({ size: () => 20000 }), bitmap = bitmapFake(800, 600);
 const out = await withGlobals({ createImageBitmap: bitmap.createImageBitmap, OffscreenCanvas: FakeCanvas }, () => prepareImage(picture(10, 'photo.JPG', '')));
 assert.equal(out.blob.type, 'image/webp');
 assert.deepEqual([out.mime, out.ext], ['image/webp', 'webp']);
});
test('prepareImage only makes a card thumbnail for pictures bigger than a card', async () => {
 const run = (width, height) => withGlobals({ createImageBitmap: bitmapFake(width, height).createImageBitmap, OffscreenCanvas: canvasFake().FakeCanvas }, () => prepareImage(picture(MB)));
 assert.equal((await run(600, 400)).poster, null, 'already small: the file itself is the cover');
 assert.equal((await run(640, 640)).poster, null);
 assert.ok((await run(641, 100)).poster, 'one pixel over');
 const fake = canvasFake(), tall = await withGlobals({ createImageBitmap: bitmapFake(1000, 3000).createImageBitmap, OffscreenCanvas: fake.FakeCanvas }, () => prepareImage(picture(MB)));
 assert.ok(tall.poster);
 assert.deepEqual(real(fake.log).at(-1), { width: 213, height: 640, type: 'image/webp', quality: 0.72 }, 'the long edge is 640');
});
test('prepareImage never keeps the original when it had to be resized, or when its type is not allowed', async () => {
 const { FakeCanvas } = canvasFake({ size: ({ width }) => width === 32 ? 300 : 20000 });
 const run = (file, bitmap) => withGlobals({ createImageBitmap: bitmap.createImageBitmap, OffscreenCanvas: FakeCanvas }, () => prepareImage(file));
 const resized = await run(picture(100), bitmapFake(3000, 2000));
 assert.deepEqual([resized.mime, resized.width, resized.height, resized.size], ['image/webp', 2400, 1600, 20000]);
 const heic = await run(picture(100, 'shot.heic', 'image/heic'), bitmapFake(800, 600));
 assert.deepEqual([heic.mime, heic.ext, heic.width, heic.size], ['image/webp', 'webp', 800, 20000]);
});

// A tiny GIF89a assembled from parts, so the metadata blocks can be put in and checked for.
const ascii = text => [...text].map(c => c.charCodeAt(0));
const subBlocks = (...chunks) => [...chunks.flatMap(c => [c.length, ...c]), 0];
const comment = text => [0x21, 0xfe, ...subBlocks(ascii(text))];
const xmp = text => [0x21, 0xff, 11, ...ascii('XMP DataXMP'), ...subBlocks(ascii(text))];
const netscape = [0x21, 0xff, 11, ...ascii('NETSCAPE2.0'), 3, 1, 0, 0, 0];
const graphicControl = [0x21, 0xf9, 4, 0, 10, 0, 0, 0];
const frame = ({ local = false, data = [0x44, 0x01] } = {}) => [...graphicControl, 0x2c, 0, 0, 0, 0, 2, 0, 2, 0, local ? 0x80 : 0, ...(local ? [9, 9, 9, 8, 8, 8] : []), 2, ...subBlocks(data)];
const gif = ({ before = [], frames = [frame()], trailer = [0x3b], after = [] } = {}) => Uint8Array.from([...ascii('GIF89a'), 2, 0, 2, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255, ...before, ...frames.flat(), ...trailer, ...after]);

test('stripGifMetadata cuts comments, XMP and trailing data but keeps looping, timing and every frame', () => {
 const dirty = gif({ before: [...comment('Shot at 41.9N 12.5E'), ...netscape, ...xmp('<x:xmpmeta>gps</x:xmpmeta>')], frames: [frame(), frame({ local: true }), [...comment('frame note'), ...frame()]], after: ascii('EXIF secret') });
 const out = stripGifMetadata(dirty);
 assert.deepEqual([...out], [...gif({ before: netscape, frames: [frame(), frame({ local: true }), frame()] })]);
 const text = String.fromCharCode(...out);
 for (const gone of ['41.9N', 'xmpmeta', 'frame note', 'secret']) assert.ok(!text.includes(gone), gone);
 assert.ok(text.includes('NETSCAPE2.0'));
 assert.deepEqual([...stripGifMetadata(out)], [...out], 'cleaning is idempotent');
});
test('stripGifMetadata keeps a clean GIF as it is, adds a missing trailer and refuses what is not a GIF', () => {
 const clean = gif({ before: netscape });
 assert.deepEqual([...stripGifMetadata(clean)], [...clean]);
 assert.deepEqual([...stripGifMetadata(gif({ trailer: [] }))], [...gif()], 'a GIF cut off after its last frame still decodes in browsers');
 assert.deepEqual([...stripGifMetadata(gif({ before: [0x21, 0x01, ...subBlocks(ascii('plain text'))] }))], [...gif()], 'plain text blocks go too');
 for (const junk of [null, undefined, new Uint8Array(0), Uint8Array.from(ascii('GIF89a')), Uint8Array.from(ascii('not a gif at all, just text')), gif({ frames: [] }), gif({ before: [0x99] }), gif({ frames: [frame().slice(0, 18)], trailer: [] })])
  assert.equal(stripGifMetadata(junk), null);
});
test('prepareImage keeps a GIF animated but cuts its metadata, and previews the first frame', async () => {
 const { FakeCanvas, log } = canvasFake({ size: () => 50 }), bitmap = bitmapFake(500, 400);
 const original = gif({ before: [...comment('lat 41.9, lon 12.5'), ...netscape], frames: [frame(), frame()] });
 const file = new File([original], 'loop.gif', { type: 'image/gif' });
 const out = await withGlobals({ createImageBitmap: bitmap.createImageBitmap, OffscreenCanvas: FakeCanvas }, () => prepareImage(file));
 assert.notEqual(out.blob, file);
 assert.deepEqual([...new Uint8Array(await out.blob.arrayBuffer())], [...gif({ before: netscape, frames: [frame(), frame()] })]);
 assert.deepEqual([out.mime, out.ext, out.width, out.height, out.blob.type], ['image/gif', 'gif', 500, 400, 'image/gif']);
 assert.equal(out.size, out.blob.size);
 assert.equal(out.preview.type, 'image/webp');
 assert.equal(out.poster, null, 'a small GIF is its own cover');
 assert.deepEqual(real(log), [{ width: 32, height: 26, type: 'image/webp', quality: 0.6 }], 'only the preview is encoded');
 assert.equal(bitmap.closed, true);
});
test('prepareImage gives a heavy GIF a still card thumbnail from its first frame', async () => {
 const { FakeCanvas, log } = canvasFake({ size: ({ width }) => width === 32 ? 50 : 30000 });
 const heavy = gif({ frames: [frame({ data: new Array(250).fill(7) }), ...Array.from({ length: 700 }, () => frame({ data: new Array(250).fill(9) }))] });
 assert.ok(heavy.length > 150 * 1024);
 const out = await withGlobals({ createImageBitmap: bitmapFake(1200, 800).createImageBitmap, OffscreenCanvas: FakeCanvas }, () => prepareImage(new File([heavy], 'big.gif', { type: 'image/gif' })));
 assert.equal(out.mime, 'image/gif');
 assert.deepEqual([out.poster.type, out.poster.size], ['image/webp', 30000]);
 assert.deepEqual(real(log).at(-1), { width: 640, height: 427, type: 'image/webp', quality: 0.72 });
});
test('prepareImage turns a GIF it cannot parse into a still instead of uploading the bytes', async () => {
 const { FakeCanvas } = canvasFake({ size: () => 700 });
 const out = await withGlobals({ createImageBitmap: bitmapFake(300, 200).createImageBitmap, OffscreenCanvas: FakeCanvas }, () => prepareImage(new File([Uint8Array.from([...ascii('GIF89a'), 1, 2, 3])], 'odd.gif', { type: 'image/gif' })));
 assert.deepEqual([out.mime, out.ext], ['image/webp', 'webp']);
});
test('prepareImage uses an <img> when createImageBitmap is unavailable and revokes the object URL', async () => {
 const { FakeCanvas } = canvasFake(), revoked = [], realRevoke = URL.revokeObjectURL;
 class FakeImage { naturalWidth = 1000; naturalHeight = 500; set src(url) { this.url = url; queueMicrotask(() => this.onload()); } }
 URL.revokeObjectURL = url => { revoked.push(url); realRevoke.call(URL, url); };
 try {
  const out = await withGlobals({ createImageBitmap: undefined, Image: FakeImage, OffscreenCanvas: FakeCanvas }, () => prepareImage(picture(2 * MB)));
  assert.deepEqual([out.mime, out.width, out.height], ['image/webp', 1000, 500]);
  assert.equal(revoked.length, 1);
 } finally { URL.revokeObjectURL = realRevoke; }
});
test('prepareImage also falls back to an <img> when createImageBitmap throws', async () => {
 const { FakeCanvas } = canvasFake();
 class FakeImage { naturalWidth = 640; naturalHeight = 480; set src(url) { queueMicrotask(() => this.onload()); } }
 const out = await withGlobals({ createImageBitmap: async () => { throw new TypeError('bad option'); }, Image: FakeImage, OffscreenCanvas: FakeCanvas }, () => prepareImage(picture(MB)));
 assert.deepEqual([out.width, out.height], [640, 480]);
});
test('prepareImage reports unreadable images in plain words', async () => {
 const { FakeCanvas } = canvasFake();
 class BrokenImage { set src(url) { queueMicrotask(() => this.onerror()); } }
 await withGlobals({ createImageBitmap: async () => { throw new Error('nope'); }, Image: BrokenImage, OffscreenCanvas: FakeCanvas }, () => assert.rejects(prepareImage(picture(10)), /This image could not be read/));
 await withGlobals({ createImageBitmap: async () => { throw new Error('nope'); }, Image: undefined, OffscreenCanvas: FakeCanvas }, () => assert.rejects(prepareImage(picture(10)), /This image could not be read/));
 await withGlobals({ createImageBitmap: bitmapFake(0, 0).createImageBitmap, OffscreenCanvas: FakeCanvas }, () => assert.rejects(prepareImage(picture(10)), /This image could not be read/));
});

// A <video> stand-in: an EventTarget that answers src/currentTime with loadedmetadata/seeked.
const videoFake = ({ duration = 9.4, width = 1920, height = 1080, ready = 4, fail = false, silent = false, noSeek = false } = {}) => {
 const video = new EventTarget(), calls = { attrs: [], removed: [], loads: 0, tag: null, src: null, seek: null };
 Object.assign(video, { duration, videoWidth: width, videoHeight: height, readyState: ready, pause() {}, load() { calls.loads++; },
  setAttribute(name) { calls.attrs.push(name); }, removeAttribute(name) { calls.removed.push(name); } });
 Object.defineProperty(video, 'src', { set(url) { calls.src = url; if (!silent) setTimeout(() => video.dispatchEvent(new Event(fail ? 'error' : 'loadedmetadata')), 0); } });
 Object.defineProperty(video, 'currentTime', { set(t) { calls.seek = t; if (!noSeek) setTimeout(() => video.dispatchEvent(new Event('seeked')), 0); } });
 return { video, calls, document: { createElement(tag) { calls.tag = tag; return video; } } };
};
const clip = (name, type, size = 4321) => new File([new Uint8Array(size)], name, { type });
const withVideo = async (options, file, extra = {}) => {
 const fake = videoFake(options), { FakeCanvas, log } = canvasFake({ size: () => 64 }), revoked = [], realRevoke = URL.revokeObjectURL;
 URL.revokeObjectURL = url => { revoked.push(url); realRevoke.call(URL, url); };
 try {
  const out = await withGlobals({ document: fake.document, OffscreenCanvas: FakeCanvas, ...extra }, () => prepareVideo(file));
  return { out, ...fake, log, revoked };
 } finally { URL.revokeObjectURL = realRevoke; }
};

test('prepareVideo reads metadata, grabs a poster and releases the video element', async () => {
 const { out, calls, log, revoked } = await withVideo({ duration: 9.4 }, clip('clip.mp4', 'video/mp4'));
 assert.deepEqual({ kind: out.kind, mime: out.mime, ext: out.ext, size: out.size, width: out.width, height: out.height, duration: out.duration, name: out.name },
  { kind: 'video', mime: 'video/mp4', ext: 'mp4', size: 4321, width: 1920, height: 1080, duration: 9, name: 'clip.mp4' });
 assert.equal(out.blob.type, 'video/mp4');
 assert.equal(out.poster.type, 'image/webp');
 assert.equal(out.preview.type, 'image/webp');
 assert.deepEqual(real(log), [{ width: 1280, height: 720, type: 'image/webp', quality: 0.82 }, { width: 32, height: 18, type: 'image/webp', quality: 0.6 }]);
 assert.equal(calls.tag, 'video');
 assert.equal(calls.seek, 1, 'seeks one second in');
 assert.ok(calls.attrs.includes('playsinline') && calls.attrs.includes('muted'));
 assert.deepEqual(calls.removed, ['src']);
 assert.equal(calls.loads, 1);
 assert.deepEqual(revoked, [calls.src], 'the object URL is revoked');
});
test('prepareVideo takes the poster a third of the way into short clips and rounds the duration', async () => {
 const short = await withVideo({ duration: 0.9 }, clip('a.mp4', 'video/mp4'));
 assert.ok(Math.abs(short.calls.seek - 0.3) < 1e-9);
 assert.equal(short.out.duration, 1);
 const long = await withVideo({ duration: 185.4 }, clip('a.mp4', 'video/mp4'));
 assert.equal(long.calls.seek, 1);
 assert.equal(long.out.duration, 185);
});
test('prepareVideo treats an unknown duration as 0 and still gets a frame', async () => {
 for (const duration of [Infinity, NaN, 0, -1]) {
  const { out, calls } = await withVideo({ duration }, clip('live.webm', 'video/webm'));
  assert.equal(out.duration, 0, String(duration));
  assert.ok(calls.seek > 0 && calls.seek <= 0.1 + 1e-9, 'a non-zero seek, otherwise no seeked event fires');
  assert.equal(out.poster.type, 'image/webp');
 }
});
test('prepareVideo normalises the MIME type and extension', async () => {
 const mov = await withVideo({}, clip('Holiday.MOV', ''));
 assert.deepEqual([mov.out.mime, mov.out.ext, mov.out.blob.type], ['video/quicktime', 'mov', 'video/quicktime']);
 const m4v = await withVideo({}, clip('trailer.m4v', 'video/x-m4v'));
 assert.deepEqual([m4v.out.mime, m4v.out.ext, m4v.out.blob.type], ['video/mp4', 'mp4', 'video/mp4']);
 const mp4 = await withVideo({}, clip('a.mp4', ''));
 assert.deepEqual([mp4.out.mime, mp4.out.ext], ['video/mp4', 'mp4']);
 const webm = await withVideo({}, clip('a.webm', 'video/webm'));
 assert.deepEqual([webm.out.mime, webm.out.ext], ['video/webm', 'webm']);
 const blank = await withVideo({}, clip('mystery', ''));
 assert.deepEqual([blank.out.mime, blank.out.ext], ['video/quicktime', 'mov']);
});
test('prepareVideo falls back to JPEG for the poster when WebP cannot be encoded', async () => {
 const { FakeCanvas } = canvasFake({ webp: false }), { document, calls } = videoFake();
 const out = await withGlobals({ document, OffscreenCanvas: FakeCanvas }, () => prepareVideo(clip('a.mp4', 'video/mp4')));
 assert.equal(out.poster.type, 'image/jpeg');
 assert.equal(out.preview.type, 'image/jpeg');
 assert.equal(calls.loads, 1);
});
test('prepareVideo explains unreadable videos and still cleans up', async () => {
 for (const options of [{ fail: true }, { width: 0, height: 0 }]) {
  const fake = videoFake(options), { FakeCanvas } = canvasFake();
  await withGlobals({ document: fake.document, OffscreenCanvas: FakeCanvas }, () => assert.rejects(prepareVideo(clip('a.mkv', 'video/x-matroska')), /^Error: This video could not be read\. Try an MP4 \(H\.264\) file\.$/));
  assert.deepEqual(fake.calls.removed, ['src'], JSON.stringify(options));
  assert.equal(fake.calls.loads, 1);
 }
});
test('prepareVideo uploads a video it can read but not draw, just without a poster', async () => {
 for (const options of [{ ready: 1 }, { ready: 0 }]) {
  const { out, calls, log } = await withVideo(options, clip('lazy.mp4', 'video/mp4'));
  assert.deepEqual([out.kind, out.poster, out.preview, out.width, out.height, out.mime], ['video', null, null, 1920, 1080, 'video/mp4'], JSON.stringify(options));
  assert.equal(out.blob.size, 4321, 'the video itself is untouched');
  assert.deepEqual(real(log), [], 'nothing was drawn');
  assert.deepEqual(calls.removed, ['src']);
 }
});
test('prepareVideo still uploads when the poster cannot be encoded', async () => {
 const fake = videoFake(), failing = { OffscreenCanvas: undefined };
 const out = await withGlobals({ document: { createElement: tag => tag === 'video' ? fake.video : { getContext: () => null } }, ...failing }, () => prepareVideo(clip('a.mp4', 'video/mp4')));
 assert.deepEqual([out.poster, out.preview, out.width], [null, null, 1920]);
});
test('prepareVideo waits at most four seconds for a frame', async t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const fake = videoFake({ ready: 4, noSeek: true }), { FakeCanvas } = canvasFake();   // the seek never completes
 await withGlobals({ document: fake.document, OffscreenCanvas: FakeCanvas }, async () => {
  const result = prepareVideo(clip('a.mp4', 'video/mp4'));
  await Promise.resolve();
  t.mock.timers.tick(0); await new Promise(r => setImmediate(r));
  t.mock.timers.tick(3999); await new Promise(r => setImmediate(r));
  let settled = false; result.then(() => { settled = true; });
  await new Promise(r => setImmediate(r));
  assert.equal(settled, false, 'still waiting just before four seconds');
  t.mock.timers.tick(1);
  const out = await result;
  assert.equal(out.poster.type, 'image/webp', 'a frame was available, so the poster is still drawn');
 });
});
test('prepareVideo gives up after 15 seconds without metadata', async t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const fake = videoFake({ silent: true }), { FakeCanvas } = canvasFake();
 await withGlobals({ document: fake.document, OffscreenCanvas: FakeCanvas }, async () => {
  const result = prepareVideo(clip('a.mp4', 'video/mp4'));
  t.mock.timers.tick(14999);
  let settled = false;
  result.catch(() => {}).finally(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false, 'still waiting just before the timeout');
  t.mock.timers.tick(1);
  await assert.rejects(result, /This video could not be read/);
 });
 assert.equal(fake.calls.loads, 1);
});

test('thumbnail makes a small copy for the editor grid, decoding at reduced size where the browser can', async () => {
 const { FakeCanvas, log } = canvasFake({ size: () => 2500 }), bitmap = bitmapFake(260, 195);   // what createImageBitmap hands back for resizeWidth 260
 const out = await withGlobals({ createImageBitmap: bitmap.createImageBitmap, OffscreenCanvas: FakeCanvas }, () => thumbnail(picture(5 * MB)));
 assert.deepEqual([out.type, out.size], ['image/webp', 2500]);
 assert.deepEqual(bitmap.options, [{ imageOrientation: 'from-image', resizeWidth: 260, resizeQuality: 'medium' }]);
 assert.deepEqual(real(log), [{ width: 260, height: 195, type: 'image/webp', quality: 0.7 }]);
 assert.equal(bitmap.closed, true);
 const tall = await withGlobals({ createImageBitmap: bitmapFake(260, 520).createImageBitmap, OffscreenCanvas: canvasFake().FakeCanvas }, () => thumbnail(picture(MB), 260));
 assert.ok(tall, 'a tall picture is cut down to the long edge too');
});
test('thumbnail falls back to a plain decode, and gives up quietly', async () => {
 const { FakeCanvas, log } = canvasFake();
 class FakeImage { naturalWidth = 1000; naturalHeight = 500; set src(url) { queueMicrotask(() => this.onload()); } }
 const out = await withGlobals({ createImageBitmap: async () => { throw new TypeError('no resize options'); }, Image: FakeImage, OffscreenCanvas: FakeCanvas }, () => thumbnail(picture(MB)));
 assert.equal(out.type, 'image/webp');
 assert.deepEqual([real(log)[0].width, real(log)[0].height], [260, 130]);
 await withGlobals({ createImageBitmap: async () => { throw new Error('nope'); }, Image: undefined, OffscreenCanvas: FakeCanvas }, async () => assert.equal(await thumbnail(picture(MB)), null));
 await withGlobals({ createImageBitmap: bitmapFake(300, 200).createImageBitmap, OffscreenCanvas: FakeCanvas }, async () => assert.equal(await thumbnail(clip('a.mp4', 'video/mp4')), null, 'videos have no thumbnail here'));
});
