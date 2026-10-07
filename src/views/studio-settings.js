// Atelier settings: /app/studio/settings?tab=atelier|tiers (docs/ARCHITECTURE.md section 3). Only for the owner of an atelier.
//
// Atelier: name, address, category, tagline, location, description, links, banner and picture, with a live preview of the header.
// Tiers: the three levels of the circle as editable cards (name, price, description, perks, open or closed).
// The tabs are links, so the address says which one is open; a tab with unsaved changes asks before it is left (router.block).
// Each tab keeps its own state in the object `load` returns, see studio-settings/atelier.js and studio-settings/tiers.js.

import { button, html, raw } from '../core/ui.js';
import { paths } from '../core/paths.js';
import { loadAtelier, mountAtelier, renderAtelier } from './studio-settings/atelier.js';
import { loadTiers, mountTiers, renderTiers } from './studio-settings/tiers.js';

const TABS = [
  { id: 'atelier', label: 'Atelier' },
  { id: 'tiers', label: 'Tiers' }
];
const INTRO = {
  atelier: 'How your atelier looks and where it lives: its name, address, pictures and links.',
  tiers: 'The three levels of your circle. Name them, price them and say what each one offers.'
};

const tabOf = query => (TABS.some(tab => tab.id === query?.tab) ? query.tab : 'atelier');

export default {
  title: (ctx, data) => (data?.tab === 'tiers' ? 'Tier settings' : 'Atelier settings'),
  auth: 'creator',

  async load(ctx) {
    const creator = ctx.store.state.myCreator;
    if (!creator) throw Error('We could not load your atelier. Check your connection and try again.');
    const tab = tabOf(ctx.query);
    const data = { tab, creator };
    if (tab === 'tiers') data.tiers = await loadTiers(ctx, creator);
    else data.atelier = loadAtelier(ctx, creator);
    return data;
  },

  render(ctx, data) {
    const creator = data.creator;
    return html`<section class="page settings-page studio-settings">
      <header class="page-head">
        <div><p class="eyebrow muted">${creator.name}</p><h1>Atelier settings</h1><p class="page-sub">${INTRO[data.tab]}</p></div>
        <div class="page-actions">${button('View your atelier', { variant: 'secondary', href: paths.creator((data.atelier?.saved.slug) || creator.slug), icon: 'arrow' })}</div>
      </header>
      <nav class="tabs" aria-label="Atelier settings sections">${TABS.map(tab => html`<a class="tab" href="${paths.studioSettings({ tab: tab.id })}"${tab.id === data.tab ? raw(' aria-current="page"') : ''}>${tab.label}</a>`)}</nav>
      <div class="settings-panel">${data.tab === 'tiers' ? renderTiers(ctx, data) : renderAtelier(ctx, data)}</div>
    </section>`;
  },

  mount(el, ctx, data) {
    return data.tab === 'tiers' ? mountTiers(el, ctx, data) : mountAtelier(el, ctx, data);
  }
};
