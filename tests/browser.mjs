// Run with Playwright + Chromium installed: npm install --no-save playwright && npx playwright install chromium
// This suite serves the built site through Playwright routing; no local HTTP port is needed.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const packagePath=process.env.PLAYWRIGHT_MODULE;
const {chromium}=await import(packagePath?pathToFileURL(packagePath).href:'playwright');
const browser=await chromium.launch({headless:true});
const root=resolve(import.meta.dirname,'..','dist');
await mkdir(resolve(import.meta.dirname,'..','qa'),{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.mp4':'video/mp4','.vtt':'text/vtt'};
let total=0;
async function context(width,height){
 const ctx=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
 await ctx.route('http://refluenz.test/**',async route=>{const path=new URL(route.request().url()).pathname;try{const file=resolve(root,'.'+(path==='/'?'/index.html':path));assert.ok(file.startsWith(root+'/'));await route.fulfill({status:200,contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)})}catch{await route.fulfill({status:404,body:'Not found'})}});
 return ctx;
}
try{
 const ctx=await context(1440,1000),page=await ctx.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://refluenz.test/');await page.getByRole('link',{name:'Step inside the demo'}).click();
 await page.getByRole('heading',{name:'Your daily edit.'}).waitFor();
 await page.screenshot({path:resolve(root,'../qa/atelier-desktop.png'),fullPage:true});total++;
 await page.locator('[data-action="save"][data-id="p1"]').first().click();
 await page.reload();assert.equal(await page.locator('[data-action="save"][data-id="p1"]').first().getAttribute('aria-pressed'),'true');total++;
 await page.locator('.side-nav a[href="#archive"]').click();await page.getByRole('heading',{name:'Your private archive.'}).waitFor();assert.ok(await page.locator('.entry-card').count());total++;
 await page.locator('.side-nav a[href="#discover"]').click();await page.getByRole('textbox',{name:'Search discovery'}).fill('not-a-real-creator');await page.getByRole('textbox',{name:'Search discovery'}).press('Enter');await page.getByRole('heading',{name:'No matches this time.'}).waitFor();await page.getByRole('button',{name:'Clear search'}).click();assert.equal(await page.locator('.creator-card').count(),4);total++;
 await page.locator('[data-action="read"][data-id="p4"]').first().click();await page.getByRole('heading',{name:'There’s more inside the circle.'}).waitFor();await page.getByRole('button',{name:'Explore demo memberships'}).click();await page.locator('[data-action="select-tier"][data-id="premium"]').click();await page.getByRole('button',{name:'Activate demo membership'}).click();assert.ok(await page.locator('.membership-row').count());total++;
 await page.goto('http://refluenz.test/app.html#entry/p4');await page.locator('.reader-body').waitFor();assert.equal(await page.locator('.reader-lock').count(),0);await page.keyboard.press('Escape');total++;
 await page.goto('http://refluenz.test/app.html#circle');await page.getByRole('textbox',{name:'Your message'}).fill('A question for the studio.');await page.getByRole('button',{name:'Send in demo'}).click();await page.reload();assert.ok(await page.getByText('A question for the studio.',{exact:true}).count());total++;
 await page.locator('.role-switch button[data-id="creator"]').click();await page.getByRole('button',{name:'New entry'}).click();await page.getByLabel('Title',{exact:true}).fill('A new study');await page.getByLabel('Introduction',{exact:true}).fill('A studio test.');await page.getByLabel('Your entry',{exact:true}).fill('This is a complete original entry written to verify the publishing journey in the demo.');await page.getByRole('button',{name:'Save draft'}).click();assert.ok(await page.getByRole('heading',{name:'A new study'}).count());total++;
 await page.getByRole('button',{name:'Edit A new study'}).click();await page.getByRole('button',{name:'Publish in demo'}).click();await page.locator('.role-switch button[data-id="member"]').click();assert.ok(await page.getByRole('button',{name:'A new study',exact:true}).count());await page.reload();assert.ok(await page.getByRole('button',{name:'A new study',exact:true}).count());total++;
 await page.goto('http://refluenz.test/app.html#settings');await page.getByLabel('Display name').fill('<img src=x onerror=alert(1)>');await page.getByRole('button',{name:'Save profile'}).click();assert.equal(await page.locator('img[src="x"]').count(),0);total++;
 assert.deepEqual(errors,[]);await ctx.close();
 for(const width of [375,768,1440]){
  const mobile=await context(width,950),p=await mobile.newPage();
  for(const route of ['/','/app.html','/app.html#discover','/app.html#archive','/app.html#circle','/app.html#settings','/app.html?role=creator#studio']){
   await p.goto('http://refluenz.test'+route);await p.locator('body').waitFor();
   const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,`Overflow at ${width}: ${route}`);
   const broken=await p.locator('img').evaluateAll(imgs=>imgs.filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.src));assert.deepEqual(broken,[]);
  }
  await p.screenshot({path:resolve(root,`../qa/studio-${width}.png`),fullPage:true});await mobile.close();total++;
 }
 console.log(`${total} browser journey/layout checks passed.`);
}finally{await browser.close()}
