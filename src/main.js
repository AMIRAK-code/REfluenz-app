import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { createApi } from './api/index.js';
import { startApp } from './core/app.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
const root = document.querySelector('#app');

// Last resort: the app could not start at all (the library did not load, an unexpected error). Plain DOM calls only.
function showFatal(error) {
  console.error(error);
  const box = document.createElement('div');
  box.className = 'empty boot-error';
  const title = document.createElement('h1');
  title.textContent = 'REFLUENZ could not start';
  const text = document.createElement('p');
  text.textContent = 'Check your connection and try again.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'button';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => location.reload());
  box.append(title, text, reload);
  root.replaceChildren(box);
}

// supabase-js removes the recovery parameters from the URL while it starts, so they are read first.
const recovery = /(^|[#?&])type=recovery(&|$)/.test(`${location.hash}${location.search}`);

try {
  // Loaded here, not imported at the top, so that a CDN failure ends in the message above instead of a blank page.
  const { createClient } = await import(SUPABASE_JS);
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  await startApp({ api: createApi(client), root, recovery });
} catch (error) {
  showFatal(error);
}
