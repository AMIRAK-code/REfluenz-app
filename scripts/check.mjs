import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { SourceTextModule } from 'node:vm';
const root=resolve(import.meta.dirname,'..');
const dirs=['src','scripts','tests'];let checked=0;
for(const dir of dirs){for(const file of await readdir(resolve(root,dir))){if(!/\.(js|mjs)$/.test(file))continue;const full=resolve(root,dir,file);const text=await readFile(full,'utf8');new SourceTextModule(text,{identifier:full});for(const match of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g))await access(resolve(dirname(full),match[1]));checked++;}}
for(const f of ['index.html','app.html']){const html=await readFile(resolve(root,f),'utf8');for(const m of html.matchAll(/(?:src|href)="(\/[^"#?]+)(?:[?#][^"]*)?"/g)){const path=m[1];let found=false;for(const base of ['', 'public']){try{await access(resolve(root,base,'.'+path));found=true;break}catch{}}if(!found)throw Error(`${f}: missing ${path}`)}}
console.log(`Syntax and local import checks passed for ${checked} scripts; page assets resolve.`);
