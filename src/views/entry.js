// Placeholder: this section is being built. The page contract is in docs/ARCHITECTURE.md (5.2).
import { html, emptyState } from '../core/ui.js';

export default {
  title: 'Post',
  auth: 'optional',
  render: () => html`<section class="page">
    <header class="page-head"><div><p class="eyebrow muted">REFLUENZ</p><h1>A post</h1></div></header>
    ${emptyState({ icon: 'text', title: 'Being prepared', text: 'The post page is being prepared.' })}
  </section>`
};
