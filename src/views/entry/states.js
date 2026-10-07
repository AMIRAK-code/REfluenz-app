// The error box of the post page. It is drawn by the page itself, with its own retry button (a data attribute that the
// page's own listener answers), so a retry never depends on anything outside the element that shows it.

import { button, html, icon } from '../../core/ui.js';

const GENERIC = 'Something went wrong. Try again in a moment.';
// Programming errors say nothing a person can use; the api's own messages are friendly and shown as written.
const PROGRAMMING = [TypeError, ReferenceError, SyntaxError, RangeError];

export function failureState(error, { title, attr }) {
  const message = PROGRAMMING.some(type => error instanceof type) ? GENERIC : (error?.message || GENERIC);
  return html`<div class="error-state" role="alert"><span class="empty-icon">${icon('alert', 26)}</span><h3>${title}</h3><p>${message}</p>${button('Retry', { variant: 'secondary', attrs: { [attr]: true } })}</div>`;
}
