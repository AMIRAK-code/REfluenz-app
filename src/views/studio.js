// Placeholder: this section is being built. The page contract is in docs/ARCHITECTURE.md (5.2).
import { html, emptyState } from '../core/ui.js';

export default {
  title: 'Studio',
  auth: 'required',
  render: () => html`<section class="page">
    <header class="page-head"><div><p class="eyebrow muted">REFLUENZ</p><h1>Your studio</h1></div></header>
    ${emptyState({ icon: 'studio', title: 'Being prepared', text: 'Your studio is being prepared.' })}
  </section>`
};
