// Every /app/* address the route table does not know. Always says where to go next; the address that was asked for is
// shown (as text) so a mistyped link is easy to spot.

import { html, icon } from '../core/ui.js';
import { paths } from '../core/paths.js';

const SHOWN_PATH_LIMIT = 80;

function shown(path) {
  const text = String(path || '');
  return text.length > SHOWN_PATH_LIMIT ? `${text.slice(0, SHOWN_PATH_LIMIT - 1)}…` : text;
}

export default {
  title: 'Page not found',
  auth: 'optional',

  render(ctx) {
    const signedIn = Boolean(ctx.store.state.user);
    const next = signedIn
      ? [{ href: paths.library, label: 'Your library' }, { href: paths.memberships, label: 'Your memberships' }]
      : [{ href: paths.signup(), label: 'Create a free account' }, { href: paths.login(), label: 'Sign in' }];
    return html`<section class="page not-found" aria-labelledby="not-found-title">
      <header class="page-head"><div>
        <p class="eyebrow bronze">Error 404</p>
        <h1 id="not-found-title">This page is not here.</h1>
        <p class="page-sub">It may have moved, been removed, or the address may have a typing mistake.${ctx.path && html` We looked for <code class="not-found-path">${shown(ctx.path)}</code>.`}</p>
      </div></header>
      <div class="not-found-actions">
        <a class="button" href="${paths.home}"><span>Back to home</span>${icon('arrow', 14)}</a>
        <a class="button secondary" href="${paths.discover()}"><span>Discover creators</span></a>
      </div>
      <nav class="not-found-links" aria-label="More places to go">
        <p class="eyebrow muted">Or try</p>
        <ul>${next.map(link => html`<li><a class="text-link" href="${link.href}">${link.label}</a></li>`)}</ul>
      </nav>
    </section>`;
  }
};
