// Placeholder: this section is being built. The page contract is in docs/ARCHITECTURE.md (5.2).
import { html, emptyState } from '../core/ui.js';

export default {
  title: 'New post',
  auth: 'creator',
  render: () => html`<section class="page">
    <header class="page-head"><div><p class="eyebrow muted">REFLUENZ</p><h1>Write a post</h1></div></header>
    ${emptyState({ icon: 'edit', title: 'Being prepared', text: 'The editor is being prepared.' })}
  </section>`
};
