// /app/welcome: three short steps for a new account. Everything is optional and the whole tour can be skipped.
//   1. your name and an optional picture (api.saveProfile, api.uploadAvatar)
//   2. the subjects you care about (only used to order the suggestions: interests are not stored)
//   3. creators to follow (api.suggestedCreators, the shell wires the follow buttons)
// Finishing or skipping saves settings.onboarded, so the router stops sending the person here.

import { avatar, badge, button, delegate, followButton, html, icon, setBusy, skeleton, toast } from '../core/ui.js';
import { GUEST_PATHS, paths, safeNext } from '../core/paths.js';
import { CATEGORIES } from '../api/util.js';
import { prepareImage, validateFiles } from '../media.js';

// Hooks that tests replace: image preparation needs a real browser (canvas, createImageBitmap).
export const deps = { prepareImage };

const NAME_MAX = 60;
const SUGGESTIONS = 24;
const SHOWN = 8;
const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const STEPS = ['About you', 'Interests', 'Creators'];

const nextPath = value => {
  const target = safeNext(value);
  const base = target?.split(/[?#]/)[0];
  return target && !GUEST_PATHS.includes(base) && base !== paths.welcome() ? target : paths.home;
};

const programming = error => [TypeError, ReferenceError, SyntaxError, RangeError].some(type => error instanceof type);
const messageOf = (error, fallback) => (programming(error) ? fallback : error?.message || fallback);

// --- Markup -----------------------------------------------------------------------

function progress(step) {
  return html`<ol class="steps" aria-label="Progress">${STEPS.map((label, index) => html`<li class="${index + 1 === step ? 'is-current' : index + 1 < step ? 'is-done' : ''}"${index + 1 === step && html` aria-current="step"`}><span class="eyebrow">${index + 1} of ${STEPS.length}</span><span class="steps-label">${label}</span></li>`)}</ol>`;
}

function stepOne(ctx, data) {
  const person = { name: data.name || ctx.store.state.profile?.name, avatarUrl: data.avatar?.previewUrl || ctx.store.state.profile?.avatarUrl };
  const hasPicture = Boolean(data.avatar || ctx.store.state.profile?.avatarUrl);
  return html`<form class="onboard-form" data-step-form novalidate>
    <div class="avatar-picker">
      <span class="avatar-preview">${avatar(person, { size: 88 })}</span>
      <div class="avatar-controls">
        <div class="row">
          <button type="button" class="button secondary small" data-pick-avatar><span>${hasPicture ? 'Choose another photo' : 'Choose a photo'}</span></button>
          ${data.avatar && html`<button type="button" class="text-button" data-clear-avatar>Remove</button>`}
        </div>
        <p class="field-help" id="avatar-help">Optional. A JPG, PNG or WebP picture. You can change it later in Settings.</p>
        <p class="auth-status" role="status" data-avatar-status></p>
        <input type="file" id="avatar-file" accept="${AVATAR_ACCEPT}" hidden data-avatar-input aria-label="Profile photo" aria-describedby="avatar-help">
      </div>
    </div>
    <div class="field">
      <label for="onboard-name">Your name</label>
      <input id="onboard-name" name="name" value="${data.name}" maxlength="${NAME_MAX}" autocomplete="name" autocapitalize="words" aria-describedby="onboard-name-error">
      <p class="field-error" id="onboard-name-error" hidden></p>
    </div>
    <p class="form-error" role="alert" data-step-error></p>
    <div class="form-actions"><button type="submit" class="button"><span>Continue</span>${icon('arrow', 14)}</button></div>
  </form>`;
}

function stepTwo(data) {
  return html`<form class="onboard-form" data-step-form novalidate>
    <div role="group" aria-labelledby="interests-title" class="interests">
      <p class="field-help" id="interests-title">Choose as many as you like.</p>
      <div class="interest-list">${CATEGORIES.map(category => html`<button type="button" class="interest" data-interest="${category}" aria-pressed="${String(data.interests.has(category))}">${category}</button>`)}</div>
    </div>
    <div class="form-actions"><button type="button" class="button secondary" data-back>Back</button><button type="submit" class="button"><span>Continue</span>${icon('arrow', 14)}</button></div>
  </form>`;
}

function suggestionRow(creator) {
  const line = [creator.category, creator.descriptor || creator.location].filter(Boolean).join(' · ');
  return html`<li class="suggest-row" data-creator="${creator.id}">
    ${avatar(creator, { size: 48 })}
    <div class="suggest-text"><p class="suggest-name" id="suggest-${creator.id}">${creator.name}${creator.isShowcase && html` ${badge('Showcase', 'accent')}`}</p>${line && html`<p class="muted suggest-line">${line}</p>`}</div>
    ${followButton(creator.id)}
  </li>`;
}

function ordered(items, interests) {
  const chosen = items.map((creator, index) => ({ creator, index, hit: interests.has(creator.category) }));
  chosen.sort((a, b) => Number(b.hit) - Number(a.hit) || a.index - b.index);
  return { list: chosen.slice(0, SHOWN).map(entry => entry.creator), matched: chosen.some(entry => entry.hit) };
}

// The same box as ui.errorState, with a Retry that this page handles itself (so it never depends on the page-wide retry registry).
function suggestionsError(error) {
  return html`<div class="error-state" role="alert"><span class="empty-icon">${icon('alert', 26)}</span><h3>We could not load suggestions</h3><p>${messageOf(error, 'Check your connection and try again.')}</p>${button('Retry', { variant: 'secondary', attrs: { 'data-retry-suggestions': true } })}</div>`;
}

function stepThree(ctx, data) {
  const { status, items, error } = data.suggestions;
  let body;
  if (status === 'error') body = suggestionsError(error);
  else if (status !== 'ready') body = skeleton('list', 4);
  else if (!items.length) body = html`<div class="empty"><h3>No suggestions yet</h3><p>Browse Discover to find creators worth following.</p></div>`;
  else {
    const { list, matched } = ordered(items, data.interests);
    body = html`${matched && html`<p class="field-help">Creators in your subjects come first.</p>`}<ul class="suggest-list">${list.map(suggestionRow)}</ul>`;
  }
  return html`<form class="onboard-form" data-step-form novalidate>
    ${body}
    <p class="form-note onboard-count" role="status" data-follow-count>${followedLabel(ctx.store.state.following.size)}</p>
    <p class="form-error" role="alert" data-step-error></p>
    <div class="form-actions"><button type="button" class="button secondary" data-back>Back</button><button type="submit" class="button"><span>Finish</span>${icon('check', 14)}</button></div>
  </form>`;
}

const followedLabel = count => (count > 0 ? `You follow ${count} ${count === 1 ? 'creator' : 'creators'}.` : 'Following is optional. You can always do it later.');

const COPY = [
  { heading: 'Welcome to REFLUENZ.', lede: 'Tell us what to call you. Everything here is optional.' },
  { heading: 'What draws you in?', lede: 'We use your choices to put the creators you may like first.' },
  { heading: 'Follow a few creators.', lede: 'Their new work will gather on your home page. Joining a circle is free during early access.' }
];

// --- Data -------------------------------------------------------------------------

function loadSuggestions(ctx, data, { force = false } = {}) {
  const state = data.suggestions;
  // A failure is retried only when the person asks (Retry) or opens the last step again, never by redrawing the page.
  if (!force && state.status !== 'idle') return;
  state.status = 'loading';
  state.error = null;
  ctx.api.suggestedCreators(SUGGESTIONS).then(
    items => { state.items = Array.isArray(items) ? items : []; state.status = 'ready'; },
    error => { state.status = 'error'; state.error = error; }
  ).then(() => { if (data.step === 3) ctx.rerender(); });
  if (force && data.step === 3) ctx.rerender();
}

export default {
  title: 'Welcome',
  auth: 'required',

  load(ctx) {
    return {
      step: 1,
      next: nextPath(ctx.query.next),
      name: ctx.store.state.profile?.name || '',
      savedName: ctx.store.state.profile?.name || '',
      avatar: null, // {prepared, previewUrl}
      interests: new Set(),
      suggestions: { status: 'idle', items: [], error: null },
      focusHeading: false
    };
  },

  render(ctx, data) {
    const copy = COPY[data.step - 1];
    const panel = data.step === 1 ? stepOne(ctx, data) : data.step === 2 ? stepTwo(data) : stepThree(ctx, data);
    return html`<section class="onboard" aria-labelledby="onboard-title">
      <header class="onboard-head">
        <a class="wordmark" href="${paths.home}" aria-label="REFLUENZ, home">REFLUENZ</a>
        <button type="button" class="text-button onboard-skip" data-skip>Skip for now</button>
      </header>
      <div class="onboard-body">
        ${progress(data.step)}
        <h1 id="onboard-title" tabindex="-1">${copy.heading}</h1>
        <p class="auth-lede">${copy.lede}</p>
        ${panel}
      </div>
    </section>`;
  },

  mount(el, ctx, data) {
    const { api, store } = ctx;
    let busy = false;
    let disposed = false;
    const shell = el.closest('.shell');
    shell?.classList.add('shell--focus'); // a focus page: the shell hides its sidebar and bars (styles/auth.css)

    const stepError = message => {
      const slot = el.querySelector('[data-step-error]');
      if (slot) slot.textContent = message;
    };

    function go(step) {
      data.step = step;
      data.focusHeading = true;
      if (step === 3) loadSuggestions(ctx, data, { force: data.suggestions.status === 'error' });
      ctx.rerender();
    }

    // Saves settings.onboarded and leaves for where the person was going.
    async function leave(control) {
      if (busy) return;
      busy = true;
      setBusy(control, true);
      stepError('');
      try {
        const settings = await api.saveSettings({ onboarded: true });
        if (disposed) return;
        store.update({ settings });
        toast('You are all set. Welcome to REFLUENZ.', { tone: 'success' });
        ctx.navigate(data.next, { replace: true });
      } catch (error) {
        if (!disposed) stepError(messageOf(error, 'We could not save that. Try again in a moment.'));
      } finally {
        busy = false;
        setBusy(control, false);
      }
    }

    // --- Step 1 ---------------------------------------------------------------------

    function setNameError(message) {
      const control = el.querySelector('#onboard-name');
      const slot = el.querySelector('#onboard-name-error');
      if (!control || !slot) return;
      if (message) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
      slot.textContent = message;
      slot.hidden = !message;
    }

    async function pickAvatar(file) {
      const status = el.querySelector('[data-avatar-status]');
      const say = text => { if (status) status.textContent = text; };
      try {
        validateFiles('image', [file]);
        say('Preparing your photo…');
        const prepared = await deps.prepareImage(file);
        if (disposed) return;
        if (data.avatar?.previewUrl) URL.revokeObjectURL(data.avatar.previewUrl);
        data.avatar = { prepared, previewUrl: URL.createObjectURL(prepared.blob) };
        ctx.rerender();
      } catch (error) {
        if (!disposed) {
          say('');
          toast(messageOf(error, 'That picture could not be read. Try a JPG, PNG or WebP file.'), { tone: 'error' });
        }
      }
    }

    async function submitOne(formEl) {
      if (busy) return;
      const name = formEl.querySelector('[name="name"]').value.trim();
      data.name = name;
      setNameError('');
      stepError('');
      if (!name) { setNameError('Enter your name.'); formEl.querySelector('[name="name"]').focus(); return; }
      if (name.length > NAME_MAX) { setNameError(`Your name can be at most ${NAME_MAX} characters.`); formEl.querySelector('[name="name"]').focus(); return; }
      busy = true;
      const submit = formEl.querySelector('[type="submit"]');
      setBusy(submit, true);
      try {
        if (name !== data.savedName) {
          const profile = await api.saveProfile({ name });
          data.savedName = name;
          if (!disposed) store.update({ profile });
        }
        if (data.avatar) {
          const profile = await api.uploadAvatar(data.avatar.prepared.blob);
          if (data.avatar.previewUrl) URL.revokeObjectURL(data.avatar.previewUrl);
          data.avatar = null;
          if (!disposed) store.update({ profile });
        }
        if (!disposed) { busy = false; go(2); }
      } catch (error) {
        if (!disposed) stepError(messageOf(error, 'We could not save that. Try again in a moment.'));
      } finally {
        busy = false;
        setBusy(submit, false);
      }
    }

    // --- Events ----------------------------------------------------------------------

    const removers = [
      delegate(el, 'submit', '[data-step-form]', (event, formEl) => {
        event.preventDefault();
        if (data.step === 1) submitOne(formEl);
        else if (data.step === 2) go(3);
        else leave(formEl.querySelector('[type="submit"]'));
      }),
      delegate(el, 'click', '[data-retry-suggestions]', event => { event.preventDefault(); loadSuggestions(ctx, data, { force: true }); }),
      delegate(el, 'click', '[data-skip]', (event, control) => { event.preventDefault(); leave(control); }),
      delegate(el, 'click', '[data-back]', event => { event.preventDefault(); go(data.step - 1); }),
      delegate(el, 'click', '[data-pick-avatar]', () => el.querySelector('[data-avatar-input]')?.click()),
      delegate(el, 'click', '[data-clear-avatar]', () => {
        if (data.avatar?.previewUrl) URL.revokeObjectURL(data.avatar.previewUrl);
        data.avatar = null;
        ctx.rerender();
      }),
      delegate(el, 'change', '[data-avatar-input]', (event, control) => {
        const file = control.files?.[0];
        control.value = '';
        if (file) pickAvatar(file);
      }),
      delegate(el, 'input', '#onboard-name', (event, control) => { data.name = control.value; setNameError(''); stepError(''); }),
      delegate(el, 'click', '[data-interest]', (event, control) => {
        const category = control.dataset.interest;
        const on = !data.interests.has(category);
        if (on) data.interests.add(category); else data.interests.delete(category);
        control.setAttribute('aria-pressed', String(on));
      }),
      store.subscribe(state => {
        const label = el.querySelector('[data-follow-count]');
        if (label) label.textContent = followedLabel(state.following.size);
      })
    ];

    // Suggestions are read while the first steps are filled in, so the last step is ready when it opens.
    if (data.step === 1 || data.step === 3) loadSuggestions(ctx, data);

    // The follow buttons say only "Follow": the creator's name completes it for assistive technology.
    for (const row of el.querySelectorAll('[data-creator]')) {
      row.querySelector('[data-follow]')?.setAttribute('aria-describedby', `suggest-${row.dataset.creator}`);
    }
    if (data.focusHeading) el.querySelector('#onboard-title')?.focus();
    data.focusHeading = false;
    data.mounted = true;

    return () => {
      disposed = true;
      shell?.classList.remove('shell--focus');
      data.mounted = false;
      removers.forEach(remove => remove());
      // A redraw mounts again at once and keeps the picture; only leaving the page lets it go.
      queueMicrotask(() => { if (!data.mounted && data.avatar?.previewUrl) URL.revokeObjectURL(data.avatar.previewUrl); });
    };
  }
};
