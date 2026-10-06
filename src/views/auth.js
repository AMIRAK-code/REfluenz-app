// Placeholder: this section is being built. /app/login, /app/signup, /app/forgot and /app/reset share this module
// (the router gives /app/reset the 'recovery' guard).
import { html, emptyState } from '../core/ui.js';

const PAGES = {
  '/app/signup': 'Create your account',
  '/app/forgot': 'Reset your password',
  '/app/reset': 'Choose a new password'
};
const heading = ctx => PAGES[ctx.path] || 'Sign in';

export default {
  title: heading,
  auth: 'guest',
  render: ctx => html`<section class="page">
    <header class="page-head"><div><p class="eyebrow muted">REFLUENZ</p><h1>${heading(ctx)}</h1></div></header>
    ${emptyState({ icon: 'user', title: 'Being prepared', text: 'Accounts are being prepared.' })}
  </section>`
};
