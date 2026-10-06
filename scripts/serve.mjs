// Local static server. `npm run dev` serves the repository, `npm run preview` serves dist/.
// It mirrors vercel.json: /app and /app/* are the application (app.html), and the site-wide security headers
// (including the Content-Security-Policy) are sent, so a policy violation shows up here and not only in production.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const project = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const root = resolve(project, args.includes('--dist') ? 'dist' : '.');
const p = args.indexOf('--port');
const port = Number(p >= 0 ? args[p + 1] : process.env.PORT || 5173);

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.vtt': 'text/vtt' };
const PRIVATE = ['/backend', '/node_modules', '/supabase', '/scripts', '/tests'];

async function siteHeaders() {
  try {
    const config = JSON.parse(await readFile(resolve(project, 'vercel.json'), 'utf8'));
    const rule = config.headers?.find(entry => entry.source === '/(.*)');
    return Object.fromEntries((rule?.headers ?? []).map(({ key, value }) => [key, value]));
  } catch {
    return { 'X-Content-Type-Options': 'nosniff' };
  }
}
const headers = await siteHeaders();

const isApp = path => path === '/app' || path.startsWith('/app/');

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/') path = '/index.html';
    if (isApp(path)) path = '/app.html';
    if (path.split('/').some(part => part.startsWith('.')) || PRIVATE.some(dir => path === dir || path.startsWith(`${dir}/`))) throw Error('Private path');
    let file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) throw Error('Invalid path');
    try { await stat(file); } catch { file = resolve(root, 'public', '.' + path); }
    if (!file.startsWith(root + sep)) throw Error('Invalid path');
    const data = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, '0.0.0.0', () => console.log(`REFLUENZ → http://localhost:${port}`));
