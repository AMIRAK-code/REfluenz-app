// Placeholder: this section is being built. The page contract is in docs/ARCHITECTURE.md (5.2).
import { html, emptyState } from '../core/ui.js';

export default {
  title: 'Discover',
  auth: 'optional',
  render: () => html`<section class="page">
    <header class="page-head"><div><p class="eyebrow muted">REFLUENZ</p><h1>Find creators and their work</h1></div></header>
    ${emptyState({ icon: 'compass', title: 'Being prepared', text: 'Discover is being prepared.' })}
  </section>`
};
