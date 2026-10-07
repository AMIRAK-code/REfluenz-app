// The post editor (docs/ARCHITECTURE.md section 3): /app/studio/new?kind=text|image|video and /app/studio/edit/:id, for the owner of an atelier.
//
// load()   the atelier's tiers and, when editing, the post, its text and its files (editor/load.js)
// render() the page (editor/markup.js)           mount()  one editing session (editor/session.js), save flow in editor/save.js
// Rules of what a post may hold are in editor/model.js; docs/POST_FORMATS.md is the contract for media, uploads and failures.

import { loadEditor } from './editor/load.js';
import { missingMarkup, pageMarkup } from './editor/markup.js';
import { createState } from './editor/model.js';
import { deps } from './editor/deps.js';
import { mountEditor } from './editor/session.js';

// The router calls render() and then mount() with the same `data`: the state of the session is made once and handed over.
const sessions = new WeakMap();

export default {
  title: (ctx, data) => (data?.missing ? 'Post not found' : data?.mode === 'edit' ? 'Edit post' : 'New post'),
  auth: 'creator',
  load: loadEditor,
  render(ctx, data) {
    if (data.missing) return missingMarkup();
    const state = createState(data);
    sessions.set(data, state);
    return pageMarkup(data, state, deps.media);
  },
  mount(el, ctx, data) {
    if (data.missing) return undefined;
    const state = sessions.get(data) ?? createState(data);
    sessions.delete(data);
    return mountEditor(el, ctx, data, state);
  }
};
