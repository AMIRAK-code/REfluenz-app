// Placeholder: this section is being built. The page contract is in docs/ARCHITECTURE.md (5.2).
import { html, emptyState } from '../core/ui.js';

export default {
  title: 'Welcome',
  auth: 'required',
  render: () => html`<section class="page">
    <header class="page-head"><div><p class="eyebrow muted">REFLUENZ</p><h1>Welcome to REFLUENZ</h1></div></header>
    ${emptyState({ icon: 'star', title: 'Being prepared', text: 'The welcome tour is being prepared.' })}
  </section>`
};
