// Form pieces shared by the account settings and the atelier settings: labelled fields with counters and errors,
// switches, and the small helpers that keep typed text and messages in step with the page without drawing it again.
// Every value goes through html`` (escaped); nothing here concatenates user text into markup.

import { attrs, html } from '../../core/ui.js';

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError, RangeError];

// The message of an error for a person: the api writes its messages for people, anything else gets the fallback.
export const reason = (error, fallback) => (error && !PROGRAMMING_ERRORS.some(type => error instanceof type) && error.message ? String(error.message) : fallback);

export const length = value => String(value ?? '').length;

// A labelled control. control: 'input' | 'textarea' | 'select'. `error` is drawn below it, `hint` too; `counter` shows "12 / 240".
// `prefix` puts fixed text before an input (the start of an address). The error element is always there so it can be filled later.
export function textField({
  id, name = id, label, value = '', control = 'input', type = 'text', rows = 4, max, hint = '', error = '', counter = false,
  options = [], prefix = '', required = false, describedBy = '', extra = {}
}) {
  const described = [hint && `${id}-hint`, describedBy, `${id}-error`, counter && `${id}-count`].filter(Boolean).join(' ');
  const common = {
    id, name, 'aria-describedby': described, 'aria-invalid': error ? 'true' : null, required: required || null,
    maxlength: control === 'select' ? null : max, ...extra
  };
  let input;
  if (control === 'textarea') input = html`<textarea${attrs({ ...common, rows })}>${value}</textarea>`;
  else if (control === 'select') input = html`<select${attrs(common)}>${options.map(option => html`<option value="${option.value}"${option.value === value ? attrs({ selected: true }) : ''}>${option.label}</option>`)}</select>`;
  else input = html`<input${attrs({ ...common, type, value })}>`;
  return html`<div class="field">
    <div class="field-top"><label for="${id}">${label}</label>${counter && html`<span class="field-count count" id="${id}-count" data-counter="${id}" data-max="${max}">${length(value)} / ${max}</span>`}</div>
    ${prefix ? html`<div class="input-affix"><span class="affix" aria-hidden="true">${prefix}</span>${input}</div>` : input}
    ${hint && html`<p class="field-help" id="${id}-hint">${hint}</p>`}
    <p class="field-error" id="${id}-error">${error}</p>
  </div>`;
}

// A label with a description and an on/off switch on the right. The whole row is the click target (see settings.css).
export function switchRow({ id, label, text, checked, extra = {} }) {
  return html`<div class="switch-row">
    <div class="switch-text"><label for="${id}">${label}</label><p class="field-help" id="${id}-hint">${text}</p></div>
    <span class="switch-status" id="${id}-status" role="status"></span>
    <input${attrs({ id, type: 'checkbox', role: 'switch', class: 'switch', checked: checked ? true : null, 'aria-describedby': `${id}-hint`, ...extra })}>
  </div>`;
}

// A message area that screen readers announce when text appears in it. Filled with textContent, never markup.
export const formError = (name, text = '') => html`<p class="form-error" role="alert" data-error="${name}">${text}</p>`;
export const formNote = (name, text = '') => html`<p class="form-note" role="status" data-note="${name}">${text}</p>`;

// say('error' | 'note', name, text): keeps a message of one form in `data` (for the next drawing) and writes it at once into its
// element (formError / formNote), so a screen reader announces it without the page being drawn again.
export function messenger(root, data) {
  return (kind, name, text) => {
    data[kind][name] = text;
    const node = root.querySelector(`[data-${kind === 'error' ? 'error' : 'note'}="${name}"]`);
    if (node) node.textContent = text;
  };
}

// Shows or clears the error of one field (the control is marked invalid, the message sits below it).
export function setError(doc, id, message) {
  const control = doc.getElementById(id);
  const out = doc.getElementById(`${id}-error`);
  if (out) out.textContent = message || '';
  if (control) {
    if (message) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
  }
}

// The "12 / 240" next to a field follows what is typed.
export function refreshCounter(control) {
  const counter = control.closest?.('.field')?.querySelector('[data-counter]');
  if (counter) counter.textContent = `${length(control.value)} / ${counter.dataset.max}`;
}

export function focusFirstInvalid(root) {
  const control = root.querySelector('[aria-invalid="true"]');
  control?.focus?.();
  return Boolean(control);
}

// Runs a cleaner of src/api/util.js on each value alone, so every wrong field gets its own message.
// → { clean: the cleaned values, errors: {controlId: message} }
export function validateEach(cleaner, values, idOf) {
  const clean = {};
  const errors = {};
  for (const [key, value] of Object.entries(values)) {
    try {
      Object.assign(clean, cleaner({ [key]: value }));
    } catch (error) {
      errors[idOf(key)] = reason(error, 'Check this value and try again.');
    }
  }
  return { clean, errors };
}
