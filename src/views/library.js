// Placeholder: this section is being built. The page contract is in docs/ARCHITECTURE.md (5.2).
import { html, emptyState } from '../core/ui.js';

export default {
  title: 'Library',
  auth: 'required',
  render: () => html`<section class="page">
    <header class="page-head"><div><p class="eyebrow muted">REFLUENZ</p><h1>Your library</h1></div></header>
    ${emptyState({ icon: 'bookmark', title: 'Being prepared', text: 'Your library is being prepared.' })}
  </section>`
};
