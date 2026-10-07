// The "Atelier" tab of /app/studio/settings: name, address, category, tagline, location, description, links, the banner
// and the picture, with a live preview of the atelier header.
//
// Everything lives in `data.atelier` (see loadAtelier): typed text is kept there as it is typed, so the page can be drawn again
// (a picture was chosen, a link row was added, a save failed) without losing anything. The limits and the wording of the messages
// are the api's own (src/api/util.js cleanAtelier / cleanLinks).

import { avatar, button, confirmDialog, debounce, delegate, html, icon, setBusy, toast } from '../../core/ui.js';
import { presetUrl } from '../../core/constants.js';
import { CATEGORIES, IMAGE_PRESETS, MAX_LINKS, SLUG, cleanAtelier, cleanLinks } from '../../api/util.js';
import { tools } from '../settings/tools.js';
import { focusFirstInvalid, formError, formNote, messenger, reason, refreshCounter, setError, textField, validateEach } from '../settings/form.js';

const LIMITS = { name: 60, slug: 40, descriptor: 60, location: 60, bio: 400, label: 40, url: 300 };
const FIELDS = ['name', 'slug', 'category', 'descriptor', 'location', 'bio', 'image'];
const PRESET_LABELS = { atelier: 'Atelier', ritual: 'Ritual', architecture: 'Architecture' };
const SLUG_PREFIX = '/app/c/';
const SLUG_MESSAGE = 'Use 2 to 40 letters, numbers or hyphens for the address.';
const SLUG_STATUS = {
  checking: 'Checking availability…',
  available: 'That address is available.',
  taken: 'That address is taken. Try another.',
  invalid: SLUG_MESSAGE,
  unknown: 'We could not check this address right now. You can still try to save.',
  current: 'This is your current address.'
};
const CHECK_DELAY = 320;
const IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';
const PICTURES = {
  cover: { noun: 'banner', title: 'Banner', help: 'A wide picture behind your header, about 1600 by 500 pixels. It is cropped from the centre.', crop: { aspect: 16 / 5, width: 1600 } },
  avatar: { noun: 'picture', title: 'Picture', help: 'Shown beside your name and on your cards. It is cropped to a square from the centre.', crop: { aspect: 1, width: 512 } }
};
export const LEAVE_MESSAGE = 'You have unsaved changes to your atelier. Leave without saving?';

const trimmed = value => String(value ?? '').trim();
const normal = (field, value) => (field === 'slug' ? trimmed(value).toLowerCase() : trimmed(value));
const rowsOf = links => (links || []).map(link => ({ label: trimmed(link.label), url: trimmed(link.url) })).filter(link => link.label || link.url);

// --- Data ---------------------------------------------------------------------

const snapshot = creator => ({
  name: creator.name ?? '', slug: creator.slug ?? '', category: creator.category ?? '', descriptor: creator.descriptor ?? '', location: creator.location ?? '',
  bio: creator.bio ?? '', image: creator.image ?? IMAGE_PRESETS[0], links: (creator.links || []).map(link => ({ label: link.label ?? '', url: link.url ?? '' }))
});

// The editable copy of a snapshot: link rows get a key that stays with the row when it moves.
function editable(saved, start = 1) {
  let next = start;
  const form = { ...saved, links: saved.links.map(link => ({ key: `l${next++}`, label: link.label, url: link.url })) };
  return { form, next };
}

export function loadAtelier(ctx, creator) {
  const saved = snapshot(creator);
  const { form, next } = editable(saved);
  return {
    creator, // as the server has it: the pictures come from here
    saved, form, next,
    errors: {}, // wrong fields, by control id
    error: {}, // messages of a whole form or action, by name
    note: {},
    slug: { state: '', ticket: 0 },
    uploading: {}, // pictures being prepared or sent: {cover: true}
    saving: false
  };
}

export function isDirty(data) {
  const state = data.atelier;
  if (!state) return false;
  return FIELDS.some(field => normal(field, state.form[field]) !== normal(field, state.saved[field])) || JSON.stringify(rowsOf(state.form.links)) !== JSON.stringify(rowsOf(state.saved.links));
}

const slugChanged = state => normal('slug', state.form.slug) !== state.saved.slug;

// → {values: what to send, errors: {controlId: message}}. Each field is checked alone, so every wrong one gets its own message.
export function validateAtelier(state) {
  const { form } = state;
  const { clean, errors } = validateEach(cleanAtelier, Object.fromEntries(FIELDS.map(field => [field, form[field]])), field => `atelier-${field}`);
  const links = [];
  for (const row of form.links) {
    const label = trimmed(row.label);
    const url = trimmed(row.url);
    if (!label && !url) continue;
    const labelId = `link-${row.key}-label`;
    const urlId = `link-${row.key}-url`;
    if (!label) errors[labelId] = 'Name this link, for example Newsletter.';
    else {
      try { cleanLinks([{ label, url: 'https://example.com' }]); } catch (error) { errors[labelId] = reason(error, 'Check this label.'); }
    }
    if (!url) errors[urlId] = 'Add the web address of this link.';
    else {
      try { if (label) links.push(...cleanLinks([{ label, url }])); else cleanLinks([{ label: 'Link', url }]); } catch (error) { errors[urlId] = reason(error, 'Check this address.'); }
    }
  }
  const values = { ...clean, links };
  if (!slugChanged(state)) delete values.slug;
  return { values, errors };
}

// --- Markup ---------------------------------------------------------------------

// The preview is drawn in parts so that typing does not reload the pictures: the banner changes with the default cover, the
// picture only matters (as initials) while there is none, the text follows every key.
const previewBanner = state => html`<img src="${state.creator.coverUrl || presetUrl(state.form.image)}" alt="">`;
const previewAvatar = state => avatar({ name: trimmed(state.form.name) || 'Your atelier', avatarUrl: state.creator.avatarUrl }, { size: 72 });

function previewNames(state) {
  const { form } = state;
  const line = [form.category, trimmed(form.location)].filter(Boolean).join(' · ');
  return html`${line && html`<p class="eyebrow preview-line">${line}</p>`}
    <h3 class="preview-name">${trimmed(form.name) || 'Your atelier'}</h3>
    ${trimmed(form.descriptor) && html`<p class="preview-descriptor">${trimmed(form.descriptor)}</p>`}`;
}

function previewAbout(state) {
  const links = rowsOf(state.form.links);
  return html`${trimmed(state.form.bio) && html`<p class="preview-bio">${trimmed(state.form.bio)}</p>`}
    ${links.length > 0 && html`<ul class="preview-links" aria-label="Links">${links.map(link => html`<li class="preview-link">${icon('external', 13)}<span>${link.label || link.url}</span></li>`)}</ul>`}`;
}

function previewSection(state) {
  return html`<section class="settings-section preview-section" aria-labelledby="preview-title">
    <div class="settings-intro"><h2 id="preview-title">Preview</h2><p>How the top of your atelier looks. It follows what you type, before you save.</p></div>
    <div class="settings-body"><div class="atelier-preview" data-preview>
      <div class="preview-banner${state.creator.coverUrl ? '' : ' is-preset'}" data-preview-banner>${previewBanner(state)}</div>
      <div class="preview-head">
        <span class="preview-avatar" data-preview-avatar>${previewAvatar(state)}</span>
        <div class="preview-names" data-preview-names>${previewNames(state)}</div>
      </div>
      <div class="preview-about" data-preview-about>${previewAbout(state)}</div>
    </div></div>
  </section>`;
}

function pictureControl(state, kind) {
  const spec = PICTURES[kind];
  const url = kind === 'cover' ? state.creator.coverUrl : state.creator.avatarUrl;
  const busy = state.uploading[kind] === true;
  const attrs = { 'data-kind': kind, disabled: busy ? true : null, 'aria-busy': busy ? 'true' : null };
  const thumb = kind === 'avatar'
    ? avatar(state.creator, { size: 88 })
    : html`<span class="picture-thumb${url ? '' : ' is-empty'}">${url ? html`<img src="${url}" alt="">` : icon('image', 22)}</span>`;
  return html`<div class="picture-control picture-control--${kind}" data-picture="${kind}">
    <div class="picture-preview">${thumb}</div>
    <div class="picture-actions">
      <h3>${spec.title}</h3>
      <p class="field-help">${spec.help}</p>
      <input id="atelier-${kind}-file" type="file" accept="${IMAGE_TYPES}" data-file="${kind}" aria-label="Choose a ${spec.noun}" hidden>
      <div class="row">
        ${button(busy ? 'Uploading…' : url ? `Change ${spec.noun}` : `Choose a ${spec.noun}`, { variant: 'secondary', icon: busy ? null : 'camera', attrs: { ...attrs, id: `atelier-${kind}-pick`, 'data-action': 'pick-image' } })}
        ${url && button('Remove', { variant: 'ghost', attrs: { ...attrs, 'data-action': 'remove-image' } })}
      </div>
      <p class="field-help" role="status" data-note="image-${kind}">${state.note[`image-${kind}`] || ''}</p>
      ${formError(`image-${kind}`, state.error[`image-${kind}`])}
    </div>
  </div>`;
}

function picturesSection(state) {
  return html`<section class="settings-section" aria-labelledby="pictures-title">
    <div class="settings-intro"><h2 id="pictures-title">Pictures</h2><p>A new picture is used as soon as it is uploaded.</p></div>
    <div class="settings-body">${pictureControl(state, 'cover')}${pictureControl(state, 'avatar')}</div>
  </section>`;
}

function linkRow(state, row, index) {
  const { errors, form } = state;
  const last = form.links.length - 1;
  const tool = (action, label, iconName, disabled, extra = '') => html`<button type="button" class="icon-button${extra}" id="link-${row.key}-${action}" data-action="${action}-link" data-key="${row.key}" aria-label="${label}"${disabled ? html` disabled` : ''}>${icon(iconName, 16)}</button>`;
  return html`<li class="link-row" data-link="${row.key}">
    <div class="link-fields">
      ${textField({ id: `link-${row.key}-label`, label: `Link ${index + 1} label`, value: row.label, max: LIMITS.label, error: errors[`link-${row.key}-label`], extra: { 'data-link-key': row.key, 'data-part': 'label', placeholder: 'Newsletter' } })}
      ${textField({ id: `link-${row.key}-url`, label: `Link ${index + 1} address`, value: row.url, max: LIMITS.url, error: errors[`link-${row.key}-url`], extra: { 'data-link-key': row.key, 'data-part': 'url', inputmode: 'url', autocapitalize: 'none', spellcheck: 'false', placeholder: 'https://example.com' } })}
    </div>
    <div class="link-tools">
      ${tool('up', `Move link ${index + 1} up`, 'down', index === 0, ' is-flipped')}
      ${tool('down', `Move link ${index + 1} down`, 'down', index === last)}
      ${tool('remove', `Remove link ${index + 1}`, 'trash', false)}
    </div>
  </li>`;
}

function linksEditor(state) {
  const count = state.form.links.length;
  return html`<fieldset class="links-editor">
    <legend>Links</legend>
    <p class="field-help" id="links-hint">Up to ${MAX_LINKS}. They appear on your atelier page, in the order below.</p>
    ${count > 0 && html`<ol class="link-rows">${state.form.links.map((row, index) => linkRow(state, row, index))}</ol>`}
    <div class="link-add">${button('Add a link', { variant: 'secondary', icon: 'plus', attrs: { id: 'link-add', 'data-action': 'add-link', disabled: count >= MAX_LINKS ? true : null } })}${count >= MAX_LINKS ? html`<span class="field-help">That is the most links an atelier can show.</span>` : ''}</div>
  </fieldset>`;
}

function detailsSection(state) {
  const { form, errors } = state;
  const dirty = isDirty({ atelier: state });
  const changed = slugChanged(state) && Boolean(trimmed(form.slug));
  return html`<section class="settings-section" aria-labelledby="atelier-details-title">
    <div class="settings-intro"><h2 id="atelier-details-title">Details</h2><p>What people read first when they open your atelier.</p></div>
    <form class="settings-body" data-form="atelier" novalidate>
      ${textField({ id: 'atelier-name', label: 'Atelier name', value: form.name, max: LIMITS.name, required: true, error: errors['atelier-name'], extra: { 'data-field': 'name', autocomplete: 'organization' } })}
      ${textField({ id: 'atelier-slug', label: 'Address', value: form.slug, max: LIMITS.slug, prefix: SLUG_PREFIX, hint: 'Letters, numbers and hyphens, 2 to 40. This is the link to your atelier.', describedBy: 'atelier-slug-status atelier-slug-warning', error: errors['atelier-slug'], required: true, extra: { 'data-field': 'slug', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' } })}
      <div class="slug-notes">
        <p class="slug-status" id="atelier-slug-status" role="status" aria-live="polite" data-slug-status data-state="${state.slug.state}">${SLUG_STATUS[state.slug.state] || ''}</p>
        <p class="notice slug-warning" id="atelier-slug-warning" data-slug-warning${changed ? '' : html` hidden`}>Changing your address breaks the links you have already shared: anyone who opens <strong>${SLUG_PREFIX}${state.saved.slug}</strong> will no longer find your atelier.</p>
      </div>
      ${textField({ id: 'atelier-category', label: 'Category', control: 'select', value: form.category, options: [...(CATEGORIES.includes(form.category) ? [] : [{ value: '', label: 'Choose a category' }]), ...CATEGORIES.map(name => ({ value: name, label: name }))], required: true, error: errors['atelier-category'], extra: { 'data-field': 'category' } })}
      <div class="field-row">
        ${textField({ id: 'atelier-descriptor', label: 'Tagline', value: form.descriptor, max: LIMITS.descriptor, hint: 'A few words under your name.', error: errors['atelier-descriptor'], extra: { 'data-field': 'descriptor' } })}
        ${textField({ id: 'atelier-location', label: 'Location', value: form.location, max: LIMITS.location, hint: 'A city or a region, if you want to share it.', error: errors['atelier-location'], extra: { 'data-field': 'location', autocomplete: 'address-level2' } })}
      </div>
      ${textField({ id: 'atelier-bio', label: 'About your work', control: 'textarea', rows: 5, value: form.bio, max: LIMITS.bio, counter: true, hint: 'Tell people what to expect from your circle.', error: errors['atelier-bio'], extra: { 'data-field': 'bio' } })}
      ${textField({ id: 'atelier-image', label: 'Default cover', control: 'select', value: form.image, options: IMAGE_PRESETS.map(name => ({ value: name, label: PRESET_LABELS[name] || name })), hint: 'Shown behind your header and on your cards until you upload a banner.', error: errors['atelier-image'], extra: { 'data-field': 'image' } })}
      ${linksEditor(state)}
      ${formError('atelier', state.error.atelier)}
      ${formNote('atelier', state.note.atelier)}
      <div class="form-actions">
        ${button('Save changes', { type: 'submit', icon: 'check', attrs: { id: 'atelier-save' } })}
        ${button('Discard changes', { variant: 'secondary', attrs: { 'data-action': 'discard', hidden: dirty ? null : true } })}
        <p class="save-status" role="status" data-dirty-status>${dirty ? 'You have unsaved changes.' : ''}</p>
      </div>
    </form>
  </section>`;
}

export function renderAtelier(ctx, data) {
  const state = data.atelier;
  return html`${previewSection(state)}${picturesSection(state)}${detailsSection(state)}`;
}

// --- Behaviour ------------------------------------------------------------------

export function mountAtelier(el, ctx, data) {
  const { api } = ctx;
  const viewer = ctx.store;
  const state = data.atelier;
  const doc = el.ownerDocument;
  const say = messenger(el, state);
  let alive = true;

  const redraw = () => ctx.rerender();
  const field = id => doc.getElementById(id);

  function paintDirty() {
    const dirty = isDirty(data);
    const status = el.querySelector('[data-dirty-status]');
    if (status) status.textContent = dirty ? 'You have unsaved changes.' : '';
    const discard = el.querySelector('[data-action="discard"]');
    if (discard) discard.hidden = !dirty;
  }

  function paintPreview(changed) {
    const write = (name, markup) => {
      const node = el.querySelector(`[data-preview-${name}]`);
      if (node) node.innerHTML = markup.value;
    };
    write('names', previewNames(state));
    write('about', previewAbout(state));
    if (!state.creator.avatarUrl) write('avatar', previewAvatar(state));
    if (changed === 'image') write('banner', previewBanner(state));
  }

  // --- The address ---
  function setSlugState(next) {
    state.slug.state = next;
    const status = el.querySelector('[data-slug-status]');
    if (status) {
      status.textContent = SLUG_STATUS[next] || '';
      status.dataset.state = next;
    }
    const warning = el.querySelector('[data-slug-warning]');
    if (warning) warning.hidden = !(slugChanged(state) && Boolean(trimmed(state.form.slug)));
  }

  const check = debounce(async () => {
    const slug = normal('slug', state.form.slug);
    const mine = state.slug.ticket;
    let free;
    try {
      free = await api.slugAvailable(slug);
    } catch {
      if (alive && mine === state.slug.ticket) setSlugState('unknown');
      return;
    }
    if (!alive || mine !== state.slug.ticket) return;
    setSlugState(free ? 'available' : 'taken');
    if (free) setError(doc, 'atelier-slug', '');
  }, CHECK_DELAY);

  function scheduleSlugCheck() {
    state.slug.ticket++; // an answer for an older address is not wanted any more
    const slug = normal('slug', state.form.slug);
    if (!slug) setSlugState('');
    else if (slug === state.saved.slug) setSlugState('current');
    else if (!SLUG.test(slug)) setSlugState('invalid');
    else {
      setSlugState('checking');
      check();
    }
  }

  // A rerender cancelled the wait of a check that was under way: start it again.
  if (state.slug.state === 'checking') check();

  ctx.router.block = () => (isDirty(data) ? LEAVE_MESSAGE : null);

  // --- Typing ---
  // Puts what a control shows into the state. Returns false for a control that is not part of the state.
  function store(control) {
    const name = control.dataset.field;
    if (name) {
      state.form[name] = control.value;
      return true;
    }
    const row = state.form.links.find(item => item.key === control.dataset.linkKey);
    if (!row) return false;
    row[control.dataset.part] = control.value;
    return true;
  }

  function edit(control) {
    const name = control.dataset.field;
    if (name === 'slug') {
      const clean = control.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (clean !== control.value) control.value = clean;
    }
    if (!store(control)) return;
    if (state.errors[control.id]) {
      delete state.errors[control.id];
      setError(doc, control.id, '');
    }
    refreshCounter(control);
    if (name === 'slug') scheduleSlugCheck();
    paintPreview(name);
    paintDirty();
  }

  // --- Links ---
  function addLink() {
    if (state.form.links.length >= MAX_LINKS) return;
    const key = `l${state.next++}`;
    state.form.links.push({ key, label: '', url: '' });
    redraw();
    field(`link-${key}-label`)?.focus();
  }

  function removeLink(key) {
    state.form.links = state.form.links.filter(row => row.key !== key);
    delete state.errors[`link-${key}-label`];
    delete state.errors[`link-${key}-url`];
    redraw();
    field('link-add')?.focus();
  }

  function moveLink(key, step) {
    const list = state.form.links;
    const from = list.findIndex(row => row.key === key);
    const to = from + step;
    if (from < 0 || to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    redraw();
    const first = step < 0 ? 'up' : 'down';
    const second = step < 0 ? 'down' : 'up';
    (el.querySelector(`#link-${key}-${first}:not([disabled])`) || el.querySelector(`#link-${key}-${second}:not([disabled])`))?.focus();
  }

  // --- Pictures ---
  async function chooseImage(kind, input) {
    const file = input.files?.[0];
    try { input.value = ''; } catch { /* some engines keep the list; the next choice replaces it */ }
    if (!file || state.uploading[kind]) return;
    state.uploading[kind] = true;
    say('error', `image-${kind}`, '');
    say('note', `image-${kind}`, '');
    redraw();
    try {
      const blob = await tools.cropImage(file, PICTURES[kind].crop);
      const creator = await api.uploadCreatorImage(state.creator.id, kind, blob);
      state.creator = creator;
      viewer.update({ myCreator: creator });
      state.note[`image-${kind}`] = `Your ${PICTURES[kind].noun} was updated.`;
      toast(`Your ${PICTURES[kind].noun} was updated.`, { tone: 'success' });
    } catch (error) {
      const message = reason(error, `We could not upload your ${PICTURES[kind].noun}. Try again.`);
      state.error[`image-${kind}`] = message;
      toast(message, { tone: 'error' });
    }
    state.uploading[kind] = false;
    redraw();
    field(`atelier-${kind}-pick`)?.focus();
  }

  async function removeImage(kind) {
    const spec = PICTURES[kind];
    const sure = await confirmDialog({
      title: `Remove your ${spec.noun}?`,
      text: kind === 'cover' ? 'Your default cover is shown again. You can upload a banner at any time.' : 'Your initials are shown again. You can upload a picture at any time.',
      confirmLabel: `Remove ${spec.noun}`
    });
    if (!sure) return;
    state.uploading[kind] = true;
    say('error', `image-${kind}`, '');
    say('note', `image-${kind}`, '');
    redraw();
    try {
      const creator = await api.removeCreatorImage(state.creator.id, kind);
      state.creator = creator;
      viewer.update({ myCreator: creator });
      state.note[`image-${kind}`] = `Your ${spec.noun} was removed.`;
      toast(`Your ${spec.noun} was removed.`, { tone: 'success' });
    } catch (error) {
      const message = reason(error, `We could not remove your ${spec.noun}. Try again.`);
      state.error[`image-${kind}`] = message;
      toast(message, { tone: 'error' });
    }
    state.uploading[kind] = false;
    redraw();
    field(`atelier-${kind}-pick`)?.focus();
  }

  // --- Saving ---
  function showErrors(errors) {
    for (const id of new Set([...Object.keys(state.errors), ...Object.keys(errors)])) setError(doc, id, errors[id]);
    state.errors = errors;
  }

  async function save(form) {
    if (state.saving) return;
    for (const control of form.querySelectorAll('[data-field], [data-link-key]')) store(control);
    say('error', 'atelier', '');
    say('note', 'atelier', '');
    const { values, errors } = validateAtelier(state);
    if (!errors['atelier-slug'] && values.slug && state.slug.state === 'taken') errors['atelier-slug'] = SLUG_STATUS.taken;
    showErrors(errors);
    if (Object.keys(errors).length) {
      say('error', 'atelier', 'Check the highlighted fields and try again.');
      focusFirstInvalid(el);
      return;
    }
    if (values.slug) {
      const sure = await confirmDialog({
        title: 'Change your address?',
        text: `${SLUG_PREFIX}${state.saved.slug} will stop working, and every link to it will lead nowhere. Your atelier will live at ${SLUG_PREFIX}${values.slug}.`,
        confirmLabel: 'Change address',
        tone: 'danger'
      });
      if (!sure) return;
    }
    const submit = form.querySelector('[type="submit"]');
    state.saving = true;
    setBusy(submit, true);
    try {
      const creator = await api.updateAtelier(state.creator.id, values);
      viewer.update({ myCreator: creator });
      state.creator = creator;
      state.saved = snapshot(creator);
      const next = editable(state.saved, state.next);
      state.form = next.form;
      state.next = next.next;
      state.errors = {};
      state.slug = { state: '', ticket: state.slug.ticket + 1 };
      state.error.atelier = '';
      state.note.atelier = values.slug ? `Your atelier is now at ${SLUG_PREFIX}${creator.slug}.` : 'Your atelier was updated.';
      toast('Atelier saved.', { tone: 'success' });
      state.saving = false;
      redraw();
    } catch (error) {
      state.saving = false;
      const message = reason(error, 'We could not save your atelier. Your changes are still here. Try again.');
      if (/address is taken/i.test(message)) {
        setSlugState('taken');
        setError(doc, 'atelier-slug', SLUG_STATUS.taken);
        state.errors['atelier-slug'] = SLUG_STATUS.taken;
      }
      say('error', 'atelier', message);
      toast(message, { tone: 'error' });
      setBusy(submit, false);
    }
  }

  async function discard() {
    const sure = await confirmDialog({ title: 'Discard your changes?', text: 'The details go back to what is saved.', confirmLabel: 'Discard changes', tone: 'danger' });
    if (!sure) return;
    const next = editable(state.saved, state.next);
    state.form = next.form;
    state.next = next.next;
    state.errors = {};
    state.error.atelier = '';
    state.note.atelier = '';
    state.slug = { state: '', ticket: state.slug.ticket + 1 };
    redraw();
  }

  const actions = {
    'pick-image': control => el.querySelector(`#atelier-${control.dataset.kind}-file`)?.click(),
    'remove-image': control => removeImage(control.dataset.kind),
    'add-link': addLink,
    'remove-link': control => removeLink(control.dataset.key),
    'up-link': control => moveLink(control.dataset.key, -1),
    'down-link': control => moveLink(control.dataset.key, 1),
    discard
  };

  const stops = [
    delegate(el, 'input', '[data-field], [data-link-key]', (event, control) => edit(control)),
    delegate(el, 'change', 'select[data-field]', (event, control) => edit(control)),
    delegate(el, 'submit', 'form[data-form="atelier"]', (event, form) => {
      event.preventDefault();
      save(form);
    }),
    delegate(el, 'click', '[data-action]', (event, control) => {
      const act = actions[control.dataset.action];
      if (!act) return;
      event.preventDefault();
      act(control);
    }),
    delegate(el, 'change', 'input[data-file]', (event, input) => { chooseImage(input.dataset.file, input); })
  ];

  return () => {
    alive = false;
    check.cancel();
    for (const stop of stops) stop();
  };
}
