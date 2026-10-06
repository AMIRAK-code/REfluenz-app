// Placeholder: this section is being built. The page contract is in docs/ARCHITECTURE.md (5.2).
import { html, emptyState } from '../core/ui.js';

export default {
  title: 'Messages',
  auth: 'required',
  render: () => html`<section class="page">
    <header class="page-head"><div><p class="eyebrow muted">REFLUENZ</p><h1>Messages</h1></div></header>
    ${emptyState({ icon: 'message', title: 'Being prepared', text: 'Your messages are being prepared.' })}
  </section>`
};
