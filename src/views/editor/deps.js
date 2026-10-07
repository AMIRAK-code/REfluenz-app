// What the editor needs from the browser and cannot do in a test: preparing pictures and films for upload (src/media.js
// decodes, resizes and re-encodes them with canvas and <video>). The view reads `deps.media` every time it uses it, so a
// test can put a stand-in there (tests/views/editor.test.mjs) and restore the real module afterwards.
import * as media from '../../media.js';

export const deps = { media };
