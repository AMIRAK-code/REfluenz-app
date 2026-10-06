// Browser-side preparation of image and video uploads (contract: docs/POST_FORMATS.md).
// classify, validateFiles, formatDuration, fitWithin and mimeOf are pure and import cleanly in Node;
// prepareImage and prepareVideo need a browser (createImageBitmap, canvas, <video>).
const MB = 1024 * 1024;
export const LIMITS = Object.freeze({
  maxImages: 10, maxImageInputBytes: 25 * MB, maxVideoBytes: 50 * MB,
  imageTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  videoTypes: Object.freeze(['video/mp4', 'video/webm', 'video/quicktime'])
});
const MAX_EDGE = 2400, POSTER_EDGE = 1280, PREVIEW_WIDTH = 32;
const CARD_EDGE = 640, CARD_GIF_BYTES = 150 * 1024;   // cards show a small copy; a GIF only needs one when it is heavy
const BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4' };
const EXT_OF = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const BAD_IMAGE = 'This image could not be read. Try a JPG, PNG or WebP file.';
const BAD_VIDEO = 'This video could not be read. Try an MP4 (H.264) file.';
const NO_ENCODER = 'This browser could not prepare the image. Try another browser or file.';

const lower = value => String(value ?? '').toLowerCase();
const extOf = name => /\.([a-z0-9]+)$/i.exec(String(name ?? ''))?.[1].toLowerCase() ?? '';
const kindOf = mime => LIMITS.imageTypes.includes(mime) ? 'image' : LIMITS.videoTypes.includes(mime) ? 'video' : null;
const label = file => { const name = String(file?.name ?? ''); return name ? `"${name.length > 40 ? name.slice(0, 37) + '...' : name}"` : 'This file'; };
const megabytes = bytes => `${Math.ceil(bytes / MB * 10) / 10} MB`;
// A Blob that carries `mime` as its type (File.type is often '' for .mov/.m4v), without copying the data.
const typed = (blob, mime) => blob.type === mime ? blob : blob.slice(0, blob.size, mime);

// 'image' | 'video' | null. The MIME type wins; the extension is the fallback for '' or generic types.
export function classify(file) { return kindOf(lower(file?.type)) ?? kindOf(BY_EXT[extOf(file?.name)]) ?? null; }
// The MIME type to store: browsers report '' or odd types for .mov and .m4v, so those follow the extension.
export function mimeOf(file) {
  const ext = extOf(file?.name), type = lower(file?.type);
  return ext === 'mov' ? 'video/quicktime' : ext === 'm4v' ? 'video/mp4' : kindOf(type) ? type : BY_EXT[ext] ?? '';
}

// Throws an Error with a message that can be shown to the creator as is.
export function validateFiles(kind, files, existingCount = 0) {
  const list = Array.from(files ?? []), existing = Math.max(0, Number(existingCount) || 0);
  if (kind === 'text') {
    if (list.length) throw Error('Text entries carry no images or videos. Switch to Image or Video to attach files.');
    return;
  }
  if (kind !== 'image' && kind !== 'video') throw Error('Choose Text, Image or Video as the post type.');
  const accepted = kind === 'image' ? 'JPG, PNG, WebP or GIF' : 'MP4, WebM or MOV';
  const article = kind === 'image' ? 'an image' : 'a video';
  if (!list.length) throw Error(`No file was selected. Choose ${article} (${accepted}).`);
  for (const file of list) {
    const found = classify(file);
    if (found === kind) continue;
    const other = found ?? /^(image|video)\//.exec(lower(file?.type))?.[1];
    if (other && other !== kind) throw Error(`${label(file)} is ${other === 'video' ? 'a video' : 'an image'}, but this is ${article} post. Use ${accepted}.`);
    throw Error(`${label(file)} is not a supported ${kind}. Use ${accepted}.`);
  }
  if (kind === 'image') {
    const room = Math.max(0, LIMITS.maxImages - existing);
    if (list.length > room) {
      if (!existing) throw Error(`Too many images: you chose ${list.length}, but a post holds up to ${LIMITS.maxImages}.`);
      if (!room) throw Error(`This post already has the maximum of ${LIMITS.maxImages} images. Remove one to add another.`);
      throw Error(`This post already has ${existing} image${existing > 1 ? 's' : ''}, so you can add ${room} more (up to ${LIMITS.maxImages} per post).`);
    }
  } else if (list.length > 1) throw Error('Choose a single video: a post holds exactly one.');
  else if (existing) throw Error('This post already has a video. Remove it before adding another.');
  const max = kind === 'image' ? LIMITS.maxImageInputBytes : LIMITS.maxVideoBytes;
  for (const file of list) {
    const size = Number(file.size);
    if (size === 0) throw Error(`${label(file)} is empty.`);
    if (size > max) throw Error(kind === 'image'
      ? `${label(file)} is ${megabytes(size)}. Images can be up to ${max / MB} MB before they are optimised.`
      : `${label(file)} is ${megabytes(size)}. Videos can be up to ${max / MB} MB. Trim it or export it at a lower resolution.`);
  }
}

// 'm:ss' or 'h:mm:ss' from a number of seconds (rounded; non-finite or negative values read as 0:00).
export function formatDuration(seconds) {
  const total = Number.isFinite(+seconds) ? Math.max(0, Math.round(+seconds)) : 0;
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// Scales (width, height) down so the long edge is <= maxEdge. Integers, never upscales; {0, 0} for unusable input.
export function fitWithin(width, height, maxEdge) {
  const w = Math.round(width), h = Math.round(height);
  if (!(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)) return { width: 0, height: 0 };
  const scale = maxEdge > 0 ? Math.min(1, maxEdge / Math.max(w, h)) : 1;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
const previewSize = (w, h) => { const width = Math.min(PREVIEW_WIDTH, w); return { width, height: Math.max(1, Math.round(h * width / w)) }; };

// Draws `source` (bitmap, canvas, <img> or <video>) at width x height and encodes it. JPEG has no alpha, so it is flattened on white.
async function encode(source, width, height, type, quality) {
  const paint = ctx => {
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
  };
  if (typeof OffscreenCanvas === 'function') {
    try { const canvas = new OffscreenCanvas(width, height); paint(canvas.getContext('2d')); return await canvas.convertToBlob({ type, quality }); } catch {}
  }
  if (typeof document === 'undefined') throw Error(NO_ENCODER);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error(NO_ENCODER);
    paint(ctx);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error(NO_ENCODER)), type, quality));
  } finally { canvas.width = canvas.height = 0; }   // Safari keeps the backing store of a detached canvas until it is collected
}
// A canvas holding `source` at width x height, so the (possibly huge) decoded original can be released before anything is encoded.
function scaled(source, width, height) {
  let canvas = null;
  if (typeof OffscreenCanvas === 'function') { try { canvas = new OffscreenCanvas(width, height); } catch {} }
  if (!canvas) {
    if (typeof document === 'undefined') throw Error(NO_ENCODER);
    canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error(NO_ENCODER);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}
const dispose = canvas => { try { if (canvas) canvas.width = canvas.height = 0; } catch {} };

// Safari and every iOS browser cannot encode WebP: they answer a PNG, which is slow and large. Probe once per canvas implementation.
const webpProbes = new WeakMap();
async function probeWebp() {
  try {
    if (typeof OffscreenCanvas === 'function') { const canvas = new OffscreenCanvas(1, 1); canvas.getContext('2d'); return (await canvas.convertToBlob({ type: 'image/webp' }))?.type === 'image/webp'; }
  } catch {}
  try {
    if (typeof document !== 'undefined') { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; return await new Promise(resolve => canvas.toBlob(blob => resolve(blob?.type === 'image/webp'), 'image/webp')); }
  } catch {}
  return false;
}
function supportsWebp() {
  const key = typeof OffscreenCanvas === 'function' ? OffscreenCanvas : typeof document !== 'undefined' ? document : null;
  if (!key) return Promise.resolve(false);
  if (!webpProbes.has(key)) webpProbes.set(key, probeWebp());
  return webpProbes.get(key);
}
// WebP when the browser can encode it, JPEG otherwise (no wasted PNG encode first).
async function encodeBest(source, width, height, quality, jpegQuality = quality) {
  if (await supportsWebp()) {
    let blob = null;
    try { blob = await encode(source, width, height, 'image/webp', quality); } catch {}
    if (blob?.type === 'image/webp') return blob;
  }
  const blob = await encode(source, width, height, 'image/jpeg', jpegQuality);
  if (blob.type !== 'image/jpeg') throw Error(NO_ENCODER);
  return blob;
}

// createImageBitmap applies the EXIF orientation; browsers without it (or without the option) use an <img>.
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() }; } catch {}
  }
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function') return reject(Error(BAD_IMAGE));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(Error(BAD_IMAGE)); };
    img.src = url;
  });
}

// Copies a GIF without the blocks that can carry personal data: comments, plain text and every application extension except the
// animation ones (NETSCAPE, ANIMEXTS), plus anything after the trailer. Returns null when the bytes are not a readable GIF.
export function stripGifMetadata(bytes) {
  const n = bytes?.length ?? 0;
  if (n < 14 || String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== 'GIF') return null;
  let p = 13;
  if (bytes[10] & 0x80) p += 3 << ((bytes[10] & 7) + 1);   // global colour table
  if (p > n) return null;
  const ranges = [[0, p]];
  const blocks = at => { while (at < n) { const len = bytes[at++]; if (!len) return at; at += len; } return -1; };   // end of a run of sub-blocks
  let images = 0;
  while (p < n && bytes[p] !== 0x3b) {
    if (bytes[p] === 0x21) {
      const end = blocks(p + 2);
      if (end < 0) return null;
      const label = bytes[p + 1], id = String.fromCharCode(...bytes.subarray(p + 3, p + 3 + Math.min(bytes[p + 2], 11)));
      if (label === 0xf9 || (label === 0xff && /^(NETSCAPE|ANIMEXTS)/.test(id))) ranges.push([p, end]);   // timing and looping stay
      p = end;
    } else if (bytes[p] === 0x2c) {
      if (p + 10 > n) return null;
      const end = blocks(p + 10 + (bytes[p + 9] & 0x80 ? 3 << ((bytes[p + 9] & 7) + 1) : 0) + 1);   // local colour table, then the LZW size byte
      if (end < 0) return null;
      ranges.push([p, end]); p = end; images++;
    } else return null;
  }
  if (!images) return null;
  const out = new Uint8Array(ranges.reduce((sum, [from, to]) => sum + to - from, 0) + 1);
  let at = 0;
  for (const [from, to] of ranges) { out.set(bytes.subarray(from, to), at); at += to - from; }
  out[at] = 0x3b;
  return out;
}

// Prepared = { kind, blob, mime, ext, size, width, height, duration, poster, preview, name }; `name` is the original file name.
// For an image, `poster` is the card thumbnail (null when the image is already small). Metadata never reaches the server: stills are
// re-encoded from their pixels (EXIF, GPS and device data are dropped) and GIFs lose their comment and application blocks.
export async function prepareImage(file) {
  const mime = mimeOf(file), original = kindOf(mime) === 'image' ? mime : '';
  const image = await decodeImage(file);
  let base = null, w = 0, h = 0, fit = null;
  try {
    ({ width: w, height: h } = image);
    if (!(w > 0 && h > 0)) throw Error(BAD_IMAGE);
    fit = fitWithin(w, h, MAX_EDGE);
    base = scaled(image.source, fit.width, fit.height);   // the only draw from the full-size bitmap...
  } finally { image.release(); }                          // ...which is released before anything is encoded
  try {
    const small = previewSize(fit.width, fit.height), preview = await encodeBest(base, small.width, small.height, 0.6);
    const prepared = (blob, type, width, height, poster) => ({ kind: 'image', blob, mime: type, ext: EXT_OF[type], size: blob.size, width, height, duration: null, poster, preview, name: file.name });
    const card = async () => { const t = fitWithin(fit.width, fit.height, CARD_EDGE); try { return await encodeBest(base, t.width, t.height, 0.72, 0.78); } catch { return null; } };
    // GIFs keep their animation, so their bytes are kept with the metadata blocks cut out. One that cannot be parsed is re-encoded as a still.
    const gif = original === 'image/gif' ? stripGifMetadata(new Uint8Array(await file.arrayBuffer())) : null;
    if (gif) { const blob = new Blob([gif], { type: original }); return prepared(blob, original, w, h, blob.size > CARD_GIF_BYTES ? await card() : null); }
    let blob = await encodeBest(base, fit.width, fit.height, 0.86, 0.88);
    // Never upload the original bytes: they may carry EXIF (GPS, device, time). A re-encode that came out bigger is retried lighter.
    if (blob.size > file.size) { const lighter = await encodeBest(base, fit.width, fit.height, 0.7, 0.7); if (lighter.size < blob.size) blob = lighter; }
    return prepared(blob, blob.type, fit.width, fit.height, Math.max(fit.width, fit.height) > CARD_EDGE ? await card() : null);
  } finally { dispose(base); }
}

// A small copy of a picked image for the editor grid, so a dozen phone photos are never decoded at full size on screen.
// Best effort: null when the browser cannot make one (the editor then shows the file itself).
export async function thumbnail(file, edge = 260) {
  if (classify(file) !== 'image') return null;
  let image = null;
  try {
    if (typeof createImageBitmap === 'function') {
      try { const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: edge, resizeQuality: 'medium' }); image = { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() }; } catch {}
    }
    image ??= await decodeImage(file);
    const fit = fitWithin(image.width, image.height, edge);
    return fit.width ? await encodeBest(image.source, fit.width, fit.height, 0.7) : null;
  } catch { return null; } finally { image?.release(); }
}

// Resolves true when `event` fires on `el`, false on an 'error' event or after `ms`. Never rejects.
const waitFor = (el, event, ms) => new Promise(resolve => {
  const done = result => { clearTimeout(timer); el.removeEventListener(event, ok); el.removeEventListener('error', fail); resolve(result); };
  const ok = () => done(true), fail = () => done(false), timer = setTimeout(fail, ms);
  el.addEventListener(event, ok); el.addEventListener('error', fail);
});

export async function prepareVideo(file) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') throw Error(BAD_VIDEO);
  const found = mimeOf(file), mime = kindOf(found) === 'video' ? found : 'video/quicktime', blob = typed(file, mime);
  const url = URL.createObjectURL(blob), video = document.createElement('video');
  try {
    video.muted = true; video.playsInline = true; video.preload = 'metadata';
    video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
    const loaded = waitFor(video, 'loadedmetadata', 15000);   // listeners first, then the source
    video.src = url;
    if (!await loaded) throw Error(BAD_VIDEO);
    const raw = video.duration, known = Number.isFinite(raw) && raw > 0, width = video.videoWidth, height = video.videoHeight;
    if (!(width > 0 && height > 0)) throw Error(BAD_VIDEO);   // audio only, or a codec this browser cannot decode
    // Never seek to 0: the video is already there, so no 'seeked' would fire and no frame would load.
    const seeked = waitFor(video, 'seeked', 4000);
    video.currentTime = Math.min(1, (known ? raw : 0.3) / 3);
    await seeked;
    // The poster is a nicety: a video this browser can play but not draw (frames are decoded lazily on some) is still uploaded without one.
    let poster = null, preview = null;
    if (video.readyState >= 2) {
      try {
        const fit = fitWithin(width, height, POSTER_EDGE), small = previewSize(width, height);
        poster = await encodeBest(video, fit.width, fit.height, 0.82);
        preview = await encodeBest(video, small.width, small.height, 0.6);
      } catch { poster = preview = null; }
    }
    return { kind: 'video', blob, mime, ext: EXT_OF[mime], size: blob.size, width, height, duration: known ? Math.round(raw) : 0, poster, preview, name: file.name };
  } finally {
    video.pause?.(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
  }
}
