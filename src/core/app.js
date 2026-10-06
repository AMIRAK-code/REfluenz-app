// Starts the application: store → shell → router. main.js uses it in the browser, tests/helpers/dom.mjs in happy-dom.

import { store as defaultStore } from './store.js';
import { mountShell } from './shell.js';
import { createRouter } from './router.js';
import { routes as defaultRoutes } from './routes.js';

// What #app holds until the session is known (app.html carries the same markup, for the first paint).
const BOOT = '<div class="boot" role="status"><span class="wordmark">REFLUENZ</span><span class="visually-hidden">Loading</span></div>';

// Resolves when the first page has been drawn. `recovery`: the URL carried a password recovery link.
export async function startApp({ api, root, store = defaultStore, routes = defaultRoutes, recovery = false }) {
  root.innerHTML = BOOT;
  await store.init(api, { recovery });
  const shell = mountShell({ root, store, api });
  const router = createRouter({ routes, outlet: shell.outlet, announcer: shell.announcer, store, api });
  shell.attach(router);
  await router.start();
  return {
    store,
    router,
    shell,
    stop() {
      router.stop();
      shell.destroy();
      store.destroy();
    }
  };
}
