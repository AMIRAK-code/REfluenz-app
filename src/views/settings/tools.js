// The two things the settings pages need from the browser that cannot run anywhere else: preparing a picked picture
// (re-encoded from its pixels, centred and cropped) and handing a file to the person. They sit on one object so a test can
// replace them: `tools.cropImage = async () => blob`.

import { prepareImage, validateFiles } from '../../media.js';

const NO_ENCODER = 'This browser could not prepare the image. Try another browser or file.';
const KEPT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
    } catch { /* an <img> is tried next */ }
  }
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function') return reject(Error(NO_ENCODER));
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(Error(NO_ENCODER)); };
    img.src = url;
    return undefined;
  });
}

const encode = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(blob => resolve(blob), type, quality));

// Picked file → a WebP (or JPEG) blob of `aspect` (width / height), at most `width` px wide, cut from the centre of the picture.
// prepareImage() runs first: it checks the file, bounds its size and drops EXIF. When the browser cannot crop, a plain
// JPEG, PNG or WebP is kept as it is (the page shows it with object-fit). Throws an Error with a message for the person.
async function cropImage(file, { aspect = 1, width = 512 } = {}) {
  validateFiles('image', [file]);
  const prepared = await prepareImage(file);
  let image = null;
  try {
    image = await decode(prepared.blob);
    const { width: sw, height: sh } = image;
    if (!(sw > 0 && sh > 0)) throw Error(NO_ENCODER);
    let cw = sw;
    let ch = sh;
    if (sw / sh > aspect) cw = sh * aspect; else ch = sw / aspect;
    const outW = Math.max(1, Math.min(width, Math.floor(cw)));
    const outH = Math.max(1, Math.round(outW / aspect));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const context = canvas.getContext('2d');
    if (!context) throw Error(NO_ENCODER);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, outW, outH);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image.source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, outW, outH);
    let blob = await encode(canvas, 'image/webp', 0.86);
    if (blob?.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', 0.88);
    canvas.width = canvas.height = 0;
    if (!blob || !KEPT_TYPES.includes(blob.type)) throw Error(NO_ENCODER);
    return blob;
  } catch (error) {
    if (KEPT_TYPES.includes(prepared.mime)) return prepared.blob;
    throw error;
  } finally {
    image?.release();
  }
}

// Starts a download of `blob` named `filename`.
function saveFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000).unref?.();
}

const today = () => new Date().toISOString().slice(0, 10);

export const tools = { cropImage, saveFile, today };
