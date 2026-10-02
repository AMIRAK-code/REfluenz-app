import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
await rm(resolve(root,'dist'),{recursive:true,force:true});
await mkdir(resolve(root,'dist'),{recursive:true});
for(const f of ['index.html','app.html','src','public'])await cp(resolve(root,f),resolve(root,'dist',f==='public'?'':f),{recursive:true});
console.log('Built self-contained site → dist/');
