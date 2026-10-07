// The "Tiers" tab of /app/studio/settings: the three levels of the circle (Essential, Premium, Signature) as editable cards.
// Each tier is saved on its own through api.updateTier. Typed text lives in `data.tiers.drafts`, so a failed save or a redraw
// never loses it. Limits and wording come from the api (src/api/util.js cleanTier).

import { badge, button, confirmDialog, delegate, html, icon, setBusy, toast } from '../../core/ui.js';
import { TIER_IDS, TIER_NAMES } from '../../core/constants.js';
import { money, plural } from '../../core/format.js';
import { CURRENCIES, cleanTier } from '../../api/util.js';
import { focusFirstInvalid, formError, formNote, messenger, reason, refreshCounter, setError, switchRow, textField, validateEach } from '../settings/form.js';

export const MAX_PERKS = 8;
const LIMITS = { name: 40, description: 280, perk: 80 };
export const LEAVE_MESSAGE = 'You have unsaved changes to your tiers. Leave without saving?';
const EARLY_ACCESS = 'Payments are not live yet. Joining is free during early access, so nothing is charged to your members. The prices you set are shown on your atelier and apply once payments launch.';

const trimmed = value => String(value ?? '').trim();

// --- Prices ---------------------------------------------------------------------

// 900 → "9", 950 → "9.50": the amount as people type it.
export const formatPrice = cents => {
  const amount = Number(cents) / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
};

// "9", "9.5", "9,50", "€ 9.50" → cents; anything else → null. The api decides whether the amount is in range.
export function parsePrice(text) {
  const clean = String(text ?? '').replace(/[\s ]/g, '').replace(/^[€$£]|[€$£]$/g, '').replace(',', '.');
  if (!/^(\d{1,7}(\.\d{0,2})?|\.\d{1,2})$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

// --- Data ---------------------------------------------------------------------

const perkList = draft => draft.perks.map(perk => trimmed(perk.text)).filter(Boolean);

function draftOf(tier, counter) {
  return {
    name: tier.name ?? '', price: formatPrice(tier.priceCents), currency: tier.currency || 'EUR', description: tier.description ?? '',
    perks: (tier.perks || []).map(text => ({ key: `p${counter.next++}`, text })), enabled: tier.enabled !== false
  };
}

export async function loadTiers(ctx, creator) {
  const { api } = ctx;
  // The numbers only add the member counts: a failure there must not hide the tiers.
  const [list, stats] = await Promise.all([api.listTiers(creator.id), api.creatorStats(creator.id).catch(() => null)]);
  const tiers = (list || []).filter(tier => TIER_IDS.includes(tier.id)).sort((a, b) => a.level - b.level);
  if (!tiers.length) throw Error('We could not find the tiers of your atelier. Reload the page and try again.');
  const counter = { next: 1 };
  return {
    creator, tiers, stats, counter,
    drafts: Object.fromEntries(tiers.map(tier => [tier.id, draftOf(tier, counter)])),
    errors: {}, // wrong fields, by control id
    error: {}, // messages of a whole card, by name
    note: {},
    saving: {}
  };
}

const tierDirty = (state, tier) => {
  const draft = state.drafts[tier.id];
  return trimmed(draft.name) !== tier.name || parsePrice(draft.price) !== tier.priceCents || draft.currency !== tier.currency
    || trimmed(draft.description) !== (tier.description ?? '') || draft.enabled !== (tier.enabled !== false)
    || JSON.stringify(perkList(draft)) !== JSON.stringify(tier.perks || []);
};

export function isDirty(data) {
  const state = data.tiers;
  return Boolean(state) && state.tiers.some(tier => tierDirty(state, tier));
}

// → {values, errors: {controlId: message}}
export function validateTier(id, draft) {
  const pid = suffix => `tier-${id}-${suffix}`;
  const { clean, errors } = validateEach(cleanTier, { name: draft.name, currency: draft.currency, description: draft.description }, key => pid(key));
  const cents = parsePrice(draft.price);
  if (cents === null) errors[pid('price')] = 'Enter a price such as 9 or 9.50.';
  else {
    try { clean.priceCents = cleanTier({ priceCents: cents }).priceCents; } catch (error) { errors[pid('price')] = reason(error, 'Set a price between 0 and 1,000.'); }
  }
  const perks = [];
  for (const perk of draft.perks) {
    const text = trimmed(perk.text);
    if (!text) continue;
    if (text.length > LIMITS.perk) errors[pid(`perk-${perk.key}`)] = `Each perk can be at most ${LIMITS.perk} characters.`;
    perks.push(text);
  }
  if (perks.length > MAX_PERKS) errors[pid('add-perk')] = `List up to ${MAX_PERKS} perks.`;
  return { values: { ...clean, perks, enabled: draft.enabled }, errors };
}

// --- Markup ---------------------------------------------------------------------

function perksEditor(state, tier) {
  const { id } = tier;
  const draft = state.drafts[id];
  const count = draft.perks.length;
  return html`<fieldset class="perks-editor">
    <legend>Perks</legend>
    <p class="field-help" id="tier-${id}-perks-hint">What members get at this level. Up to ${MAX_PERKS}, one line each.</p>
    ${count > 0 && html`<ul class="perk-rows">${draft.perks.map((perk, index) => html`<li class="perk-row">
      <label class="visually-hidden" for="tier-${id}-perk-${perk.key}">Perk ${index + 1}</label>
      <input id="tier-${id}-perk-${perk.key}" name="tier-${id}-perk-${perk.key}" type="text" maxlength="${LIMITS.perk}" value="${perk.text}" data-tier="${id}" data-perk="${perk.key}" aria-describedby="tier-${id}-perk-${perk.key}-error"${state.errors[`tier-${id}-perk-${perk.key}`] ? html` aria-invalid="true"` : ''}>
      <button type="button" class="icon-button" data-action="remove-perk" data-tier="${id}" data-key="${perk.key}" aria-label="Remove perk ${index + 1}">${icon('close', 16)}</button>
      <p class="field-error" id="tier-${id}-perk-${perk.key}-error">${state.errors[`tier-${id}-perk-${perk.key}`] || ''}</p>
    </li>`)}</ul>`}
    <div class="perk-add">
      ${button('Add a perk', { variant: 'secondary', size: 'small', icon: 'plus', attrs: { id: `tier-${id}-add-perk`, 'data-action': 'add-perk', 'data-tier': id, disabled: count >= MAX_PERKS ? true : null } })}
      <span class="field-help" data-perk-count="${id}">${count} / ${MAX_PERKS}</span>
    </div>
  </fieldset>`;
}

function tierEditor(state, tier) {
  const { id } = tier;
  const draft = state.drafts[id];
  const errors = state.errors;
  const pid = suffix => `tier-${id}-${suffix}`;
  const members = state.stats?.byTier?.find(row => row.tierId === id)?.members;
  const dirty = tierDirty(state, tier);
  const open = tier.enabled !== false;
  return html`<form class="tier-editor${open ? '' : ' is-closed'}" data-tier-form="${id}" aria-labelledby="${pid('title')}" novalidate>
    <header class="tier-editor-head">
      <div class="tier-editor-names">
        <p class="eyebrow muted">Level ${tier.level} · ${TIER_NAMES[id] || id}</p>
        <h3 id="${pid('title')}">${tier.name}</h3>
      </div>
      <div class="tier-editor-facts">
        <p class="tier-editor-price"><strong>${money(tier.priceCents, tier.currency)}</strong> <span class="muted">/ month</span></p>
        <p class="tier-editor-meta">${open ? badge('Open', 'accent') : badge('Closed')}${typeof members === 'number' && html`<span class="muted" data-members="${id}">${plural(members, 'member')}</span>`}</p>
      </div>
    </header>
    <div class="tier-editor-grid">
      <div class="tier-editor-main">
        ${textField({ id: pid('name'), label: 'Name', value: draft.name, max: LIMITS.name, required: true, error: errors[pid('name')], extra: { 'data-tier': id, 'data-tier-field': 'name' } })}
        <div class="field-row">
          ${textField({ id: pid('price'), label: 'Monthly price', value: draft.price, hint: 'Between 0 and 1,000. Use 0 for a free tier.', error: errors[pid('price')], required: true, extra: { 'data-tier': id, 'data-tier-field': 'price', inputmode: 'decimal', autocomplete: 'off' } })}
          ${textField({ id: pid('currency'), label: 'Currency', control: 'select', value: draft.currency, options: CURRENCIES.map(code => ({ value: code, label: code })), error: errors[pid('currency')], extra: { 'data-tier': id, 'data-tier-field': 'currency' } })}
        </div>
        ${textField({ id: pid('description'), label: 'Description', control: 'textarea', rows: 3, value: draft.description, max: LIMITS.description, counter: true, hint: 'A sentence or two on what this level is for.', error: errors[pid('description')], extra: { 'data-tier': id, 'data-tier-field': 'description' } })}
        <div class="switch-list">${switchRow({ id: pid('enabled'), label: 'Open to new members', text: 'Closed tiers stay visible but cannot be joined. At least one tier has to stay open.', checked: draft.enabled, extra: { 'data-tier': id, 'data-tier-field': 'enabled' } })}</div>
      </div>
      ${perksEditor(state, tier)}
    </div>
    ${formError(`tier-${id}`, state.error[`tier-${id}`])}
    ${formNote(`tier-${id}`, state.note[`tier-${id}`])}
    <div class="form-actions">
      ${button('Save changes', { type: 'submit', icon: 'check', attrs: { id: pid('save') } })}
      ${button('Discard changes', { variant: 'secondary', attrs: { 'data-action': 'discard-tier', 'data-tier': id, hidden: dirty ? null : true } })}
      <p class="save-status" role="status" data-tier-status="${id}">${dirty ? 'You have unsaved changes.' : ''}</p>
    </div>
  </form>`;
}

export function renderTiers(ctx, data) {
  const state = data.tiers;
  return html`<p class="notice tiers-notice">${EARLY_ACCESS}</p>
    <div class="tier-editors">${state.tiers.map(tier => tierEditor(state, tier))}</div>`;
}

// --- Behaviour ------------------------------------------------------------------

export function mountTiers(el, ctx, data) {
  const { api } = ctx;
  const state = data.tiers;
  const doc = el.ownerDocument;
  const say = messenger(el, state);
  const redraw = () => ctx.rerender();
  const tierOf = id => state.tiers.find(tier => tier.id === id);

  ctx.router.block = () => (isDirty(data) ? LEAVE_MESSAGE : null);

  function paintDirty(id) {
    const tier = tierOf(id);
    if (!tier) return;
    const dirty = tierDirty(state, tier);
    const status = el.querySelector(`[data-tier-status="${id}"]`);
    if (status) status.textContent = dirty ? 'You have unsaved changes.' : '';
    const discard = el.querySelector(`[data-action="discard-tier"][data-tier="${id}"]`);
    if (discard) discard.hidden = !dirty;
  }

  // Puts what a control shows into the draft of its tier.
  function store(control) {
    const draft = state.drafts[control.dataset.tier];
    if (!draft) return false;
    if (control.dataset.perk) {
      const perk = draft.perks.find(item => item.key === control.dataset.perk);
      if (!perk) return false;
      perk.text = control.value;
    } else {
      const name = control.dataset.tierField;
      if (name === 'enabled') draft.enabled = control.checked;
      else draft[name] = control.value;
    }
    return true;
  }

  function edit(control) {
    if (!store(control)) return;
    if (state.errors[control.id]) {
      delete state.errors[control.id];
      setError(doc, control.id, '');
    }
    refreshCounter(control);
    paintDirty(control.dataset.tier);
  }

  function addPerk(id) {
    const draft = state.drafts[id];
    if (!draft || draft.perks.length >= MAX_PERKS) return;
    const key = `p${state.counter.next++}`;
    draft.perks.push({ key, text: '' });
    redraw();
    doc.getElementById(`tier-${id}-perk-${key}`)?.focus();
  }

  function removePerk(id, key) {
    const draft = state.drafts[id];
    if (!draft) return;
    draft.perks = draft.perks.filter(perk => perk.key !== key);
    delete state.errors[`tier-${id}-perk-${key}`];
    redraw();
    doc.getElementById(`tier-${id}-add-perk`)?.focus();
  }

  function showErrors(id, errors) {
    const mine = key => key.startsWith(`tier-${id}-`);
    for (const key of new Set([...Object.keys(state.errors).filter(mine), ...Object.keys(errors)])) setError(doc, key, errors[key]);
    state.errors = { ...Object.fromEntries(Object.entries(state.errors).filter(([key]) => !mine(key))), ...errors };
  }

  async function save(form) {
    const id = form.dataset.tierForm;
    const tier = tierOf(id);
    if (!tier || state.saving[id]) return;
    for (const control of form.querySelectorAll('[data-tier]')) if (control.dataset.tierField || control.dataset.perk) store(control);
    say('error', `tier-${id}`, '');
    say('note', `tier-${id}`, '');
    const { values, errors } = validateTier(id, state.drafts[id]);
    showErrors(id, errors);
    if (Object.keys(errors).length) {
      say('error', `tier-${id}`, 'Check the highlighted fields and try again.');
      focusFirstInvalid(form);
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    state.saving[id] = true;
    setBusy(submit, true);
    try {
      const saved = await api.updateTier(state.creator.id, id, values);
      state.tiers = state.tiers.map(item => (item.id === id ? { ...item, ...saved } : item));
      state.drafts[id] = draftOf(tierOf(id), state.counter);
      state.error[`tier-${id}`] = '';
      state.note[`tier-${id}`] = `${saved.name} was updated.`;
      toast(`${saved.name} saved.`, { tone: 'success' });
      state.saving[id] = false;
      redraw();
    } catch (error) {
      state.saving[id] = false;
      const message = reason(error, 'We could not save this tier. Your changes are still here. Try again.');
      say('error', `tier-${id}`, message);
      toast(message, { tone: 'error' });
      setBusy(submit, false);
      // The one rule of the server: a tier cannot be closed when it is the only open one.
      if (/\bopen\b/i.test(message) && !state.drafts[id].enabled) doc.getElementById(`tier-${id}-enabled`)?.focus();
    }
  }

  async function discard(id) {
    const tier = tierOf(id);
    if (!tier) return;
    const sure = await confirmDialog({ title: `Discard your changes to ${tier.name}?`, text: 'The tier goes back to what is saved.', confirmLabel: 'Discard changes', tone: 'danger' });
    if (!sure) return;
    state.drafts[id] = draftOf(tier, state.counter);
    showErrors(id, {});
    state.error[`tier-${id}`] = '';
    state.note[`tier-${id}`] = '';
    redraw();
  }

  const actions = {
    'add-perk': control => addPerk(control.dataset.tier),
    'remove-perk': control => removePerk(control.dataset.tier, control.dataset.key),
    'discard-tier': control => discard(control.dataset.tier)
  };

  const stops = [
    delegate(el, 'input', '[data-tier]', (event, control) => { if (control.type !== 'checkbox') edit(control); }),
    delegate(el, 'change', 'select[data-tier], input[type="checkbox"][data-tier]', (event, control) => edit(control)),
    // Enter in a perk adds the next one instead of saving the whole tier.
    delegate(el, 'keydown', 'input[data-perk]', (event, control) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      addPerk(control.dataset.tier);
    }),
    delegate(el, 'submit', 'form[data-tier-form]', (event, form) => {
      event.preventDefault();
      save(form);
    }),
    delegate(el, 'click', '[data-action]', (event, control) => {
      const act = actions[control.dataset.action];
      if (!act) return;
      event.preventDefault();
      act(control);
    })
  ];

  return () => { for (const stop of stops) stop(); };
}
