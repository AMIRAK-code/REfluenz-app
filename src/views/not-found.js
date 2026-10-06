// Placeholder: this section is being built. The page contract is in docs/ARCHITECTURE.md (5.2).
import { html, emptyState } from '../core/ui.js';

export default {
  title: 'Page not found',
  auth: 'optional',
  render: () => html`<section class="page">
    <header class="page-head"><div><p class="eyebrow muted">REFLUENZ</p><h1>This page does not exist</h1></div></header>
    ${emptyState({ icon: 'search', title: 'Nothing here', text: 'The page you are looking for is not here. It may have moved, or the address may be mistyped.', action: { label: 'Back to home', href: '/app' } })}
  </section>`
};
