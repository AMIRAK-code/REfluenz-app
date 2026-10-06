// Placeholder: this section is being built. The page contract is in docs/ARCHITECTURE.md (5.2).
import { html, emptyState } from '../core/ui.js';

export default {
  title: 'Home',
  auth: 'optional',
  render: () => html`<section class="page">
    <header class="page-head"><div><p class="eyebrow muted">REFLUENZ</p><h1>Your reading list</h1></div></header>
    ${emptyState({ icon: 'grid', title: 'Being prepared', text: 'Your home feed is being prepared.' })}
  </section>`
};
