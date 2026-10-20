// REFLUENZ pitch: scroll-told deck. One animation stack (GSAP + ScrollTrigger) with Lenis smooth scroll.
// Without motion (reduced motion, or the libraries fail to load) the page stays a complete, readable document.
import { createSound } from './sound.js';
import { mountStory } from './story.js';

const scenes = [...document.querySelectorAll('[data-scene]')];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Sound starts only on request (browsers block audio until someone interacts).
const sound = createSound();
const soundButton = document.querySelector('.sound');
soundButton?.addEventListener('click', async () => {
  if (sound.playing) sound.stop(); else await sound.start();
  soundButton.setAttribute('aria-pressed', String(sound.playing));
  soundButton.querySelector('.sound-label').textContent = sound.playing ? 'Sound on' : 'Sound off';
});

const counter = document.querySelector('[data-count]');
document.querySelector('[data-total]').textContent = String(scenes.length).padStart(2, '0');

// --- The feed wall: generic reels, boosts and AI slop (no real platform, no real people). ---------------------------
const SLOP = [
  ['ai', 'A cat made of noodles (AI)'], ['ad', 'Swipe up for 70% off'], ['', 'Wait for it…'], ['boost', 'Boosted · Day 412 of posting'],
  ['ai', '400 sunsets, one prompt'], ['', 'POV: you are still scrolling'], ['ai', 'Top 10 facts (generated)'], ['ad', 'Sponsored · Limited drop'],
  ['', 'Part 37 of 140'], ['ai', 'Motivational quote #8,213'], ['boost', 'Promoted · You won’t believe #7'], ['', 'Reacting to a reaction'],
  ['ai', 'An AI voice reads the news'], ['ad', 'Link in bio'], ['', 'Trend of the hour'], ['ai', 'Same face, 30 outfits (AI)'],
];
const GRADIENTS = ['#ff3ea5,#6a00ff', '#ffd400,#ff3b30', '#00e0ff,#0a66ff', '#2ef2a0,#007a5e', '#ff7a00,#ff3ea5', '#a8ff00,#00c2ff', '#ff0055,#ffd400', '#7b5cff,#00e0ff'];
function buildFeed() {
  const wall = document.querySelector('.feed-wall');
  if (!wall) return;
  const cols = innerWidth < 820 ? 3 : 5;
  wall.style.setProperty('--cols', cols);
  wall.innerHTML = Array.from({ length: cols }, (_, c) => `<div class="feed-col">${Array.from({ length: 9 }, (_, r) => {
    const [tag, caption] = SLOP[(c * 5 + r * 3) % SLOP.length];
    const g = GRADIENTS[(c * 3 + r) % GRADIENTS.length];
    const label = { ai: 'AI-generated', ad: 'Ad', boost: 'Boosted' }[tag] || 'Trending';
    const shapes = [0, 1, 2].map(i => `<span class="shape" style="width:${30 + ((c + r + i) * 17) % 50}%;aspect-ratio:1;left:${((c * 29 + r * 13 + i * 31) % 70)}%;top:${((c * 11 + r * 23 + i * 19) % 60)}%;background:rgb(255 255 255 / ${0.18 + i * 0.08})"></span>`).join('');
    return `<div class="reel" style="--g:linear-gradient(${150 + r * 20}deg,${g})"><span class="tag ${tag}">${label}</span>${shapes}<p class="cap">${caption}</p><div class="side"><i></i>${(r * 37 + c * 91) % 900 + 12}k<i></i>${(r * 7 + c * 3) % 90 + 2}k</div></div>`;
  }).join('')}</div>`).join('');
}
buildFeed();

// Split headings into words and characters for the type reveals.
function split(el) {
  const words = el.innerHTML.split(/(<em>.*?<\/em>|\s+)/).filter(Boolean);
  el.innerHTML = words.map(part => {
    if (/^\s+$/.test(part)) return ' ';
    const em = part.startsWith('<em>');
    const text = em ? part.slice(4, -5) : part;
    const inner = text.split(/(\s+)/).map(t => /^\s+$/.test(t) ? ' ' :
      `<span class="w">${[...t].map(c => `<span class="c">${c}</span>`).join('')}</span>`).join('');
    return em ? `<em>${inner}</em>` : inner;
  }).join('');
}

// Slide-style navigation for presenting: arrows, Page Up/Down, space.
let scrollToScene = el => el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
function current() {
  const mid = innerHeight * 0.45;
  let index = 0;
  scenes.forEach((s, i) => { if (s.getBoundingClientRect().top <= mid) index = i; });
  return index;
}
addEventListener('keydown', e => {
  if (e.target.closest('video, input, textarea, button, a')) return;
  const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key);
  const prev = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key);
  if (!next && !prev) return;
  e.preventDefault();
  scrollToScene(scenes[Math.min(scenes.length - 1, Math.max(0, current() + (next ? 1 : -1)))]);
});
const updateChrome = () => { counter.textContent = String(current() + 1).padStart(2, '0'); };
addEventListener('scroll', updateChrome, { passive: true });
updateChrome();

if (!reduce) start().catch(error => { console.error(error); document.documentElement.classList.remove('motion'); document.documentElement.classList.add('no-tear'); });
else document.documentElement.classList.add('no-tear');

async function start() {
  document.documentElement.classList.add('motion');
  const [{ gsap }, { ScrollTrigger }, { default: Lenis }] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/gsap@3.15.0/+esm'),
    import('https://cdn.jsdelivr.net/npm/gsap@3.15.0/ScrollTrigger/+esm'),
    import('https://cdn.jsdelivr.net/npm/lenis@1.3.27/+esm'),
  ]);
  gsap.registerPlugin(ScrollTrigger);

  const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(t => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  scrollToScene = el => lenis.scrollTo(el, { duration: 1.4, easing: t => 1 - Math.pow(1 - t, 4) });

  const ease = 'power4.out';
  document.querySelectorAll('.split').forEach(split);
  gsap.to('.progress i', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: true } });

  // --- 01 The story: the painting tears apart ---------------------------------------------------------------------
  const imageSrc = innerWidth * (devicePixelRatio || 1) > 1700 ? '/pitch/creation-3200.jpg' : '/pitch/creation-1600.jpg';
  const { timeline: story } = mountStory({ svg: document.querySelector('.tear'), gsap, sound, imageSrc });
  if (scrollY < innerHeight * 0.1) {
    gsap.from('.l0 > *', { y: 40, opacity: 0, duration: 1.4, ease, delay: 0.3, stagger: 0.15 });
    gsap.from('.tear', { opacity: 0, duration: 1.6, ease: 'power2.out' });
  }
  const LINES = [[4.6, 6.2], [6.6, 8.0], [8.4, 9.8], [10.2, 11.4], [11.8, 13.0], [13.3, null]];
  story.to('.l0', { opacity: 0, y: -30, duration: 0.6 }, 3.6).to('.scroll-cue', { opacity: 0, duration: 0.6 }, 0.3);
  LINES.forEach(([inAt, outAt], i) => {
    story.fromTo(`.l${i + 1}`, { opacity: 0, y: 40, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.6, ease: 'power2.out' }, inAt);
    if (outAt) story.to(`.l${i + 1}`, { opacity: 0, y: -30, duration: 0.5 }, outAt);
  });
  story.fromTo('.d6', { opacity: 0 }, { opacity: 1, duration: 0.3 }, 11.6)
    .to('.d6 .glitch', { x: () => gsap.utils.random(-140, 140), duration: 0.22, stagger: 0.05, repeat: 6, yoyo: true }, 11.6)
    .fromTo('.d7', { opacity: 0, scale: 0.6, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)' }, 12.4);

  // From the answer onwards the music is "solved": modern and calm again.
  ScrollTrigger.create({ trigger: '.shift', start: 'top 65%', end: 'max', onToggle: self => sound.setSolved(self.isActive) });

  // --- 02 The feed: an endless wall of reels, boosts and AI slop that speeds up ------------------------------------
  const cols = gsap.utils.toArray('.feed-col');
  const feed = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.feed', start: 'top top', end: '+=320%', pin: '.feed .sticky', scrub: 0.6 } });
  cols.forEach((col, i) => feed.fromTo(col, { yPercent: i % 2 ? -42 : 0 }, { yPercent: i % 2 ? 0 : -42, duration: 10, ease: 'power1.in' }, 0));
  feed.fromTo('.feed-wall', { rotation: -6, scale: 1.08 }, { rotation: -10, scale: 1.25, duration: 10 }, 0)
    .fromTo('.feed-tabs', { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.2);
  [['.f1', 0.4, 3.2], ['.f2', 3.6, 6.4], ['.f3', 6.8, null]].forEach(([sel, a, b]) => {
    feed.fromTo(sel, { opacity: 0, y: 50, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.6, ease: 'power2.out' }, a);
    if (b) feed.to(sel, { opacity: 0, y: -40, duration: 0.5 }, b);
  });
  const popIn = (sel, at) => feed.fromTo(sel, { opacity: 0, scale: 0.7, y: 30 }, { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(2)' }, at);
  popIn('.feed-pop.boost', 3.8); popIn('.feed-pop.again', 5.2); popIn('.feed-pop.gen', 7.0);
  feed.to('.feed-pop', { x: () => gsap.utils.random(-14, 14), y: () => gsap.utils.random(-10, 10), duration: 0.12, repeat: 9, yoyo: true, stagger: 0.04 }, 8.6);

  // --- 03 Your share: the value of a creator's work drains away -----------------------------------------------------
  const share = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.share', start: 'top top', end: '+=300%', pin: '.share .sticky', scrub: 0.6 } });
  [['.s1', 0, 1.8], ['.s2', 2.1, 3.9], ['.s3', 4.2, 6.0], ['.s4', 6.3, null]].forEach(([sel, a, b]) => {
    share.fromTo(sel, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, a);
    if (b) share.to(sel, { opacity: 0, y: -30, duration: 0.5 }, b);
  });
  share.fromTo('.share .value', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' }, 0.6);
  const views = { v: 0 }, viewsEl = document.querySelector('[data-views]');
  share.to(views, { v: 2400000, duration: 7, ease: 'power1.in', onUpdate: () => { viewsEl.textContent = Math.round(views.v).toLocaleString('en'); } }, 1.2)
    .to('.share .seg.you', { '--w': '7%', duration: 4.6, ease: 'power2.inOut' }, 3)
    .fromTo('.share .seg.plat', { '--w': '0%' }, { '--w': '52%', duration: 3.2, ease: 'power2.out' }, 3)
    .fromTo('.share .seg.ads', { '--w': '0%' }, { '--w': '29%', duration: 3.2, ease: 'power2.out' }, 4)
    .fromTo('.share .seg.boost', { '--w': '0%' }, { '--w': '12%', duration: 3, ease: 'power2.out' }, 5);

  // --- The answer: the word arrives from far away, the image moves inside the letters ------------------------------
  const shift = gsap.timeline({ scrollTrigger: { trigger: '.shift', start: 'top top', end: '+=160%', pin: '.shift .sticky', scrub: 0.6 } });
  shift.fromTo('.mask-word', { scale: 3.2, opacity: 0.2 }, { scale: 1, opacity: 1, ease: 'power2.out', duration: 1 })
    .fromTo('.mask-word', { backgroundPosition: '50% 0%' }, { backgroundPosition: '50% 100%', ease: 'none', duration: 1.4 }, 0)
    .from('.shift-copy', { y: 30, opacity: 0, duration: 0.6 }, 0.8);

  // --- For creators: the value flows back -------------------------------------------------------------------------
  gsap.timeline({ scrollTrigger: { trigger: '.fix-flow', start: 'top 80%' } })
    .fromTo('.fix .seg.you', { '--w': '0%' }, { '--w': '88%', duration: 1.6, ease: 'power3.out' })
    .fromTo('.fix .seg.ref', { '--w': '0%' }, { '--w': '12%', duration: 1, ease: 'power3.out' }, 0.9);
  gsap.from('.fix-list s', { opacity: 1, scrollTrigger: { trigger: '.fix-list', start: 'top 80%' }, duration: 0.6, stagger: 0.15, textDecorationColor: 'transparent' });

  // --- Product: pinned horizontal tour ----------------------------------------------------------------------------
  const track = document.querySelector('.track');
  const distance = () => Math.max(0, track.scrollWidth - innerWidth);
  const tour = gsap.to(track, { x: () => -distance(), ease: 'none', scrollTrigger: { trigger: '.product', start: 'top top', end: () => '+=' + distance(), pin: '.product .sticky', scrub: 0.6, invalidateOnRefresh: true } });
  gsap.utils.toArray('.panel').forEach(panel => {
    gsap.from(panel.querySelectorAll('h3, p, .ui'), { y: 40, opacity: 0, stagger: 0.08, duration: 0.9, ease, scrollTrigger: { trigger: panel, containerAnimation: tour, start: 'left 80%' } });
  });
  gsap.to('.ui-bar b', { scaleX: 1, ease: 'none', scrollTrigger: { trigger: '.ui-kinds', containerAnimation: tour, start: 'left 70%', end: 'right 30%', scrub: true } });
  gsap.to('.ui-stats path', { strokeDashoffset: 0, duration: 1.8, ease: 'power2.inOut', scrollTrigger: { trigger: '.ui-stats', containerAnimation: tour, start: 'left 75%' } });
  document.querySelectorAll('[data-countup]').forEach(el => {
    const obj = { v: 0 };
    gsap.to(obj, { v: Number(el.dataset.countup), duration: 1.8, ease: 'power3.out', onUpdate: () => { el.textContent = Math.round(obj.v).toLocaleString('en'); }, scrollTrigger: { trigger: '.ui-stats', containerAnimation: tour, start: 'left 75%' } });
  });

  // Generic reveals (staggered when they enter together).
  ScrollTrigger.batch('.reveal', { start: 'top 88%', once: true, onEnter: els => gsap.to(els, { opacity: 1, y: 0, duration: 0.8, ease, stagger: 0.07 }) });
  gsap.utils.toArray('.step-n').forEach(n => gsap.from(n, { yPercent: 40, opacity: 0, duration: 1.2, ease, scrollTrigger: { trigger: n, start: 'top 85%' } }));

  // Trust: the picture comes into focus while pinned.
  gsap.timeline({ scrollTrigger: { trigger: '.lock', start: 'top top', end: '+=120%', pin: '.lock .sticky', scrub: 0.6 } })
    .fromTo('.lock-img img', { '--blur': '22px', scale: 1.2 }, { '--blur': '0px', scale: 1, ease: 'none' })
    .from('.lock-copy > *', { y: 40, opacity: 0, stagger: 0.15, duration: 0.5 }, 0.1);

  // Film: the frame opens up.
  gsap.fromTo('.frame', { clipPath: 'inset(18% 18% 18% 18%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', scrollTrigger: { trigger: '.film', start: 'top 80%', end: 'center center', scrub: true } });

  // Model: the price ladder grows.
  gsap.from('.rung', { scaleY: 0, duration: 1.2, ease: 'power3.out', stagger: 0.12, scrollTrigger: { trigger: '.ladder', start: 'top 80%' } });

  // Roadmap: pinned, a line draws across and each milestone lights up.
  const road = gsap.utils.toArray('.road li');
  gsap.timeline({ scrollTrigger: { trigger: '.roadmap', start: 'top top', end: '+=180%', pin: '.roadmap .sticky', scrub: 0.6,
    onUpdate: self => road.forEach((li, i) => li.classList.toggle('on', self.progress >= i / road.length + 0.02)) } })
    .to('.road-line i', { scaleX: 1, ease: 'none' });

  // The ask
  gsap.from('.ask .c', { yPercent: 110, duration: 1.2, ease, stagger: 0.02, scrollTrigger: { trigger: '.ask', start: 'top 70%' } });

  addEventListener('load', () => ScrollTrigger.refresh());
  let resizeTimer;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => ScrollTrigger.refresh(), 200); });
}
