// Placeholder: this section is being built. The page contract is in docs/ARCHITECTURE.md (5.2).
import { html, emptyState } from '../core/ui.js';

export default {
  title: 'Atelier settings',
  auth: 'creator',
  render: () => html`<section class="page">
    <header class="page-head"><div><p class="eyebrow muted">REFLUENZ</p><h1>Atelier settings</h1></div></header>
    ${emptyState({ icon: 'settings', title: 'Being prepared', text: 'Atelier settings are being prepared.' })}
  </section>`
};
