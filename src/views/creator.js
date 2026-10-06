// Placeholder: this section is being built. The page contract is in docs/ARCHITECTURE.md (5.2).
import { html, emptyState } from '../core/ui.js';

export default {
  title: 'Atelier',
  auth: 'optional',
  render: () => html`<section class="page">
    <header class="page-head"><div><p class="eyebrow muted">REFLUENZ</p><h1>An atelier</h1></div></header>
    ${emptyState({ icon: 'user', title: 'Being prepared', text: 'This atelier page is being prepared.' })}
  </section>`
};
