// `npm run build`: copies the static site (landing page, app shell, every module and stylesheet under src/, public assets) to dist/.
// There is no bundler: the browser loads the same modules that run in development.
import { access, cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
// public/ is copied into the root of dist/, the other entries keep their name.
for (const entry of ['index.html', 'app.html', 'src', 'public']) {
  await cp(resolve(root, entry), resolve(dist, entry === 'public' ? '' : entry), { recursive: true });
}

// A build that misses what the app needs must fail here, not in production.
const required = ['index.html', 'app.html', 'favicon.svg', 'manifest.webmanifest', 'src/main.js', 'src/core/app.js', 'src/core/router.js', 'src/core/routes.js', 'src/views/not-found.js', 'src/styles/base.css', 'src/styles/shell.css'];
for (const file of required) {
  await access(resolve(dist, file)).catch(() => { throw new Error(`The build is missing ${file}`); });
}
console.log('Built self-contained site → dist/');
