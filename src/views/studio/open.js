// "Open your atelier": what the studio shows a member who has no atelier yet. The offer, then the form.
// The api's own rules (src/api/util.js) are the source of the limits and the wording of the messages.

import { button, debounce, delegate, html, icon, raw, setBusy, toast } from '../../core/ui.js';
import { paths } from '../../core/paths.js';
import { CATEGORIES, SLUG, slugify } from '../../api/util.js';

const LIMITS = { name: [2, 60], descriptor: [0, 60], location: [0, 60], bio: [0, 400] };
const SLUG_MESSAGE = 'Use 2 to 40 letters, numbers or hyphens for the address.';
const LEAVE_MESSAGE = 'You have started opening your atelier. Leave without saving?';
const CHECK_DELAY = 320;

// Where the pieces of one field live: the input, its help, its error. Ids are stable so focus survives anything.
const field = (id, name) => ({ id: `atelier-${id}`, error: `atelier-${id}-error`, help: `atelier-${id}-help`, name });

function textField({ id, name, label, help, optional = false, attrs = '', max }) {
  const f = field(id, name);
  return html`<div class="field">
    <label for="${f.id}">${label}${optional && html` <span class="muted">(optional)</span>`}</label>
    <input id="${f.id}" name="${name}" type="text" maxlength="${max}" aria-describedby="${f.help} ${f.error}" data-field="${name}" ${raw(attrs)}>
    <p class="field-help" id="${f.help}">${help}</p>
    <p class="field-error" id="${f.error}" data-error-for="${name}"></p>
  </div>`;
}

export function renderOpen() {
  const bio = field('bio', 'bio');
  const category = field('category', 'category');
  const slug = field('slug', 'slug');
  return html`<section class="page studio-open" aria-labelledby="studio-open-title">
    <header class="page-head"><div>
      <p class="eyebrow muted">The other side of the circle</p>
      <h1 id="studio-open-title">Open your atelier</h1>
      <p class="page-sub">An atelier is your page on REFLUENZ: a home for what you make, and a circle of people who follow it closely. It takes a minute, and you can change everything later.</p>
    </div></header>
    <div class="studio-open-grid">
      <aside class="studio-offer" aria-labelledby="studio-offer-title">
        <h2 id="studio-offer-title" class="eyebrow">What an atelier gives you</h2>
        <ul>
          <li>${icon('text', 18)}<div><strong>Publish what you make</strong><span>Text, image and video posts, open to everyone or kept for your circle.</span></div></li>
          <li>${icon('members', 18)}<div><strong>Build a circle</strong><span>Three membership tiers that you name, describe and price.</span></div></li>
          <li>${icon('message', 18)}<div><strong>Stay close</strong><span>Notes to your circle, messages from members, and a clear view of who joined.</span></div></li>
        </ul>
        <p class="notice">Payments are not live yet. Joining is free during early access, so nothing is charged to your members. The prices you set are shown, and apply once payments launch.</p>
        <p class="muted studio-hint">One atelier per account. You can keep reading as a member whenever you like.</p>
      </aside>
      <form class="studio-open-form" data-open-form novalidate aria-labelledby="studio-form-title">
        <h2 id="studio-form-title" class="eyebrow">Your atelier</h2>
        <div class="form-error" role="alert" data-form-error></div>
        ${textField({ id: 'name', name: 'name', label: 'Atelier name', max: LIMITS.name[1], help: 'The name people see. 2 to 60 characters.', attrs: 'required autocomplete="organization"' })}
        <div class="field">
          <label for="${slug.id}">Address</label>
          <div class="studio-slug"><span class="studio-slug-prefix" aria-hidden="true">/app/c/</span><input id="${slug.id}" name="slug" type="text" maxlength="40" data-field="slug" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="${slug.help} studio-slug-status ${slug.error}"></div>
          <p class="field-help" id="${slug.help}">Letters, numbers and hyphens, 2 to 40. This is the link to your atelier. We suggest one from the name.</p>
          <p class="studio-slug-status" id="studio-slug-status" role="status" aria-live="polite" data-slug-status></p>
          <p class="field-error" id="${slug.error}" data-error-for="slug"></p>
        </div>
        <div class="field">
          <label for="${category.id}">Category</label>
          <select id="${category.id}" name="category" required data-field="category" aria-describedby="${category.error}"><option value="" selected disabled>Choose a category</option>${CATEGORIES.map(name => html`<option value="${name}">${name}</option>`)}</select>
          <p class="field-error" id="${category.error}" data-error-for="category"></p>
        </div>
        ${textField({ id: 'descriptor', name: 'descriptor', label: 'Tagline', optional: true, max: LIMITS.descriptor[1], help: 'A few words under your name, for example "Tailoring and wardrobe".' })}
        ${textField({ id: 'location', name: 'location', label: 'Location', optional: true, max: LIMITS.location[1], help: 'A city or a region, if you want to share it.', attrs: 'autocomplete="address-level2"' })}
        <div class="field">
          <label for="${bio.id}">About your work <span class="muted">(optional)</span></label>
          <textarea id="${bio.id}" name="bio" rows="5" maxlength="${LIMITS.bio[1]}" data-field="bio" aria-describedby="${bio.help} ${bio.error}"></textarea>
          <p class="field-help" id="${bio.help}"><span data-bio-count>0</span> / 400. Tell people what to expect from your circle.</p>
          <p class="field-error" id="${bio.error}" data-error-for="bio"></p>
        </div>
        <div class="form-actions">
          ${button('Open my atelier', { type: 'submit', icon: 'arrow', attrs: { 'data-submit': true } })}
          <a class="button secondary" href="${paths.home}">Not now</a>
        </div>
      </form>
    </div>
  </section>`;
}

// → {field: message}. Same limits and wording as cleanAtelier in the api, with the field each message belongs to.
export function validateAtelier(values) {
  const errors = {};
  const name = values.name.trim();
  if (name.length < LIMITS.name[0]) errors.name = name.length === 0 ? 'Give your atelier a name.' : `The atelier name needs at least ${LIMITS.name[0]} characters.`;
  else if (name.length > LIMITS.name[1]) errors.name = `The atelier name can be at most ${LIMITS.name[1]} characters.`;
  if (!CATEGORIES.includes(values.category)) errors.category = 'Choose a category.';
  const slug = values.slug.trim().toLowerCase();
  if (slug && !SLUG.test(slug)) errors.slug = SLUG_MESSAGE;
  if (values.descriptor.trim().length > LIMITS.descriptor[1]) errors.descriptor = `The tagline can be at most ${LIMITS.descriptor[1]} characters.`;
  if (values.location.trim().length > LIMITS.location[1]) errors.location = `The location can be at most ${LIMITS.location[1]} characters.`;
  if (values.bio.trim().length > LIMITS.bio[1]) errors.bio = `The description can be at most ${LIMITS.bio[1]} characters.`;
  return errors;
}

const SLUG_STATUS = {
  checking: 'Checking availability…',
  available: 'That address is available.',
  taken: 'That address is taken. Try another.',
  invalid: SLUG_MESSAGE,
  unknown: 'We could not check this address right now. You can still continue.'
};

export function mountOpen(el, ctx) {
  const { api, store } = ctx;
  const form = el.querySelector('[data-open-form]');
  const control = name => form.querySelector(`[name="${name}"]`);
  const errorBox = form.querySelector('[data-form-error]');
  const slugStatus = form.querySelector('[data-slug-status]');
  const submitButton = form.querySelector('[data-submit]');
  let alive = true;
  let submitting = false;
  let slugTouched = false; // the person edited the address: stop suggesting one
  let slugState = ''; // '' | checking | available | taken | invalid | unknown
  let ticket = 0;

  const values = () => Object.fromEntries(['name', 'slug', 'category', 'descriptor', 'location', 'bio'].map(name => [name, control(name).value || '']));
  const dirty = () => Object.values(values()).some(value => value.trim() !== '');

  ctx.router.block = () => (dirty() && !submitting ? LEAVE_MESSAGE : null);

  // --- Errors -----------------------------------------------------------------
  function showError(name, message) {
    const input = control(name);
    const box = form.querySelector(`[data-error-for="${name}"]`);
    if (!input || !box) return;
    box.textContent = message || '';
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  const clearErrors = () => {
    errorBox.textContent = '';
    for (const box of form.querySelectorAll('[data-error-for]')) showError(box.dataset.errorFor, '');
  };

  // --- The address ---------------------------------------------------------------
  function setSlugStatus(state) {
    slugState = state;
    slugStatus.textContent = SLUG_STATUS[state] || '';
    slugStatus.dataset.state = state;
  }

  const check = debounce(async () => {
    const slug = control('slug').value.trim().toLowerCase();
    if (!slug) return setSlugStatus('');
    if (!SLUG.test(slug)) return setSlugStatus('invalid');
    const mine = ++ticket;
    setSlugStatus('checking');
    let free;
    try {
      free = await api.slugAvailable(slug);
    } catch {
      if (alive && mine === ticket) setSlugStatus('unknown');
      return;
    }
    if (!alive || mine !== ticket) return;
    setSlugStatus(free ? 'available' : 'taken');
    if (free) showError('slug', '');
  }, CHECK_DELAY);

  function scheduleCheck() {
    ticket++; // an answer for an older address is not wanted any more
    const slug = control('slug').value.trim();
    if (!slug) setSlugStatus('');
    else setSlugStatus(SLUG.test(slug.toLowerCase()) ? 'checking' : 'invalid');
    check();
  }

  // --- Events --------------------------------------------------------------------
  const off = [
    () => check.cancel(),
    delegate(form, 'input', '[data-field]', (event, input) => {
      const name = input.dataset.field;
      if (name === 'bio') form.querySelector('[data-bio-count]').textContent = String(input.value.length);
      if (name === 'slug') {
        slugTouched = true;
        const clean = input.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (clean !== input.value) input.value = clean;
        scheduleCheck();
      }
      if (name === 'name' && !slugTouched) {
        control('slug').value = slugify(input.value);
        scheduleCheck();
      }
      if (input.getAttribute('aria-invalid')) showError(name, '');
    }),
    delegate(form, 'change', '[data-field="category"]', (event, input) => { if (input.value) showError('category', ''); }),
    delegate(el, 'submit', '[data-open-form]', (event) => { event.preventDefault(); submit(); })
  ];

  async function submit() {
    if (submitting) return;
    const typed = values();
    clearErrors();
    const errors = validateAtelier(typed);
    if (!errors.slug && slugState === 'taken' && typed.slug.trim()) errors.slug = 'That atelier address is taken. Try another.';
    const first = Object.keys(errors)[0];
    if (first) {
      for (const [name, message] of Object.entries(errors)) showError(name, message);
      errorBox.textContent = 'Check the highlighted fields and try again.';
      control(first).focus();
      return;
    }

    const payload = { name: typed.name.trim(), category: typed.category, descriptor: typed.descriptor.trim(), location: typed.location.trim(), bio: typed.bio.trim() };
    if (typed.slug.trim()) payload.slug = typed.slug.trim().toLowerCase();
    submitting = true;
    setBusy(submitButton, true);
    try {
      const creator = await api.createAtelier(payload);
      store.update({ myCreator: creator }); // the write happened: the store hears about it even if the person has moved on
      toast('Your atelier is open. Write your first post.', { tone: 'success' });
      if (!alive) return;
      await ctx.navigate(paths.studio(), { force: true });
    } catch (error) {
      if (!alive) return;
      submitting = false;
      setBusy(submitButton, false);
      const message = error?.message || 'We could not open your atelier. Try again.';
      if (/already have an atelier/i.test(message)) {
        // It exists already (another tab, or an earlier attempt that did not report back): carry on to the studio.
        try {
          await store.reloadViewer();
          if (store.state.myCreator) return void ctx.navigate(paths.studio(), { force: true });
        } catch { /* the message below says what happened */ }
      }
      if (/address|slug/i.test(message)) {
        showError('slug', message);
        setSlugStatus('taken');
        control('slug').focus();
      } else {
        const named = /name/i.test(message) ? 'name' : /categor/i.test(message) ? 'category' : '';
        if (named) showError(named, message);
      }
      errorBox.textContent = message;
      toast(message, { tone: 'error' });
    }
  }

  return () => {
    alive = false;
    ticket++;
    for (const stop of off) stop();
  };
}
