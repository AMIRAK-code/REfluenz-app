// `npm run lint`: syntax of every script, local imports (static and dynamic) that resolve, page assets that exist, and the
// rules the production headers depend on (no inline code in app.html, every inline script of the landing page allowed by
// the Content-Security-Policy in vercel.json, no unwanted words in product copy). Nothing is executed.
import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { SourceTextModule } from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const SCRIPT_DIRS = ['src', 'src/api', 'src/core', 'src/views', 'scripts', 'tests', 'tests/helpers', 'tests/views'];
// import x from './a.js'  ·  export * from './a.js'  ·  import './a.js'  ·  import('./a.js')
const LOCAL_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.[^'"]+)['"]/g;
// Comments are dropped before scanning, so an example import in a comment is not mistaken for a real one.
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:\\'"`])\/\/.*$/gm, '$1');
const COPY_PATHS = ['src/core', 'src/views'];
const COPY_FORBIDDEN = /\bdemo\b/i;

const exists = async path => access(path).then(() => true, () => false);
const problems = [];
const fail = message => problems.push(message);

async function listScripts(dir) {
  if (!(await exists(resolve(root, dir)))) return [];
  const names = await readdir(resolve(root, dir));
  return names.filter(name => /\.(js|mjs)$/.test(name)).map(name => resolve(root, dir, name));
}

let checked = 0;
for (const dir of SCRIPT_DIRS) {
  for (const full of await listScripts(dir)) {
    const text = await readFile(full, 'utf8');
    try {
      new SourceTextModule(text, { identifier: full });
    } catch (error) {
      fail(`${full.slice(root.length + 1)}: ${error.message}`);
      continue;
    }
    for (const match of stripComments(text).matchAll(LOCAL_IMPORT)) {
      if (!(await exists(resolve(dirname(full), match[1])))) fail(`${full.slice(root.length + 1)}: cannot resolve ${match[1]}`);
    }
    if (COPY_PATHS.includes(dir) && COPY_FORBIDDEN.test(text)) fail(`${full.slice(root.length + 1)}: product copy must not use the word "demo"`);
    checked++;
  }
}

const inlineScripts = html => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
const sha256 = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

const pages = {};
for (const file of ['index.html', 'app.html']) {
  const html = await readFile(resolve(root, file), 'utf8');
  pages[file] = html;
  for (const match of html.matchAll(/(?:src|href)="(\/[^"#?]+)(?:[?#][^"]*)?"/g)) {
    const path = match[1];
    // /app and /app/* are rewrites to app.html, not files.
    if (path === '/app' || path.startsWith('/app/')) continue;
    if (!(await exists(resolve(root, '.' + path))) && !(await exists(resolve(root, 'public', '.' + path)))) fail(`${file}: missing ${path}`);
  }
}

// app.html runs under a strict policy: no inline script, style or handler.
const app = pages['app.html'];
if (inlineScripts(app).length) fail('app.html: inline <script> is not allowed by the Content-Security-Policy');
if (/<style[\s>]/i.test(app) || /\sstyle\s*=/i.test(app)) fail('app.html: inline styles are not allowed');
if (/\son[a-z]+\s*=/i.test(app)) fail('app.html: inline event handlers are not allowed');
if (COPY_FORBIDDEN.test(app)) fail('app.html: product copy must not use the word "demo"');

// Every inline script of the landing page needs its hash in script-src, or the browser refuses to run it.
const config = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'));
const policy = config.headers?.flatMap(rule => rule.headers).find(header => header.key === 'Content-Security-Policy')?.value;
if (!policy) fail('vercel.json: no Content-Security-Policy header');
else {
  const scriptSrc = /(?:^|;)\s*script-src\s([^;]*)/.exec(policy)?.[1] ?? '';
  for (const code of inlineScripts(pages['index.html'])) {
    if (!scriptSrc.includes(sha256(code))) fail(`vercel.json: script-src does not allow the inline script of index.html (add ${sha256(code)})`);
  }
}
if (!config.rewrites?.some(rule => rule.source === '/app/:path*' && rule.destination === '/app.html')) fail('vercel.json: /app/:path* must be rewritten to /app.html');

if (problems.length) {
  console.error(problems.map(problem => `  ✗ ${problem}`).join('\n'));
  process.exit(1);
}
console.log(`Syntax and local import checks passed for ${checked} scripts; page assets resolve; headers and policy agree.`);
