// REFLUENZ pitch: scroll-told deck. One animation stack (GSAP + ScrollTrigger) with Lenis smooth scroll.
// Without motion (reduced motion, or the libraries fail to load) the page stays a complete, readable document.
import { createSound } from './sound.js';

const scenes = [...document.querySelectorAll('[data-scene]')];

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

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// The painting is cut between the two fingertips (measured on the photograph) so each half can drift away.
// The image covers the stage and keeps the touching point near the centre on every screen shape.
const PAINT = { ratio: 3200 / 1452, tipX: 0.377, tipY: 0.447 };
const painting = document.querySelector('.painting');
function layoutPainting() {
  if (!painting) return;
  const w = innerWidth, h = innerHeight;
  const imgW = Math.max(w, h * PAINT.ratio), imgH = imgW / PAINT.ratio;
  const x = Math.min(0, Math.max(w - imgW, w / 2 - PAINT.tipX * imgW));
  const y = Math.min(0, Math.max(h - imgH, h * 0.42 - PAINT.tipY * imgH));
  const set = (k, v) => painting.style.setProperty(k, `${Math.round(v)}px`);
  set('--img-w', imgW); set('--img-h', imgH); set('--img-x', x); set('--img-y', y); set('--split', x + PAINT.tipX * imgW);
}
layoutPainting();
addEventListener('resize', layoutPainting);

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
  const i = Math.min(scenes.length - 1, Math.max(0, current() + (next ? 1 : -1)));
  scrollToScene(scenes[i]);
});
function updateChrome() {
  counter.textContent = String(current() + 1).padStart(2, '0');
}
addEventListener('scroll', updateChrome, { passive: true });
updateChrome();

if (!reduce) start().catch(() => document.documentElement.classList.remove('motion'));

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

  // Progress bar
  gsap.to('.progress i', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: true } });

  // 01 Story: the hands drift apart, the painting loses its colour and gets defaced, one line at a time.
  document.querySelectorAll('.vandal-layer .draw').forEach(path => {
    const length = path.getTotalLength?.() || 600;
    path.style.strokeDasharray = length; path.style.strokeDashoffset = length;
  });
  // The opening only plays when the deck opens at the start (a reload half way keeps the scrolled state).
  if (scrollY < innerHeight * 0.1) {
    gsap.from('.l0 > *', { y: 40, opacity: 0, duration: 1.4, ease, delay: 0.2, stagger: 0.15 });
    gsap.from('.painting', { scale: 1.06, opacity: 0, duration: 2.4, ease: 'power3.out' });
  }

  const story = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: {
    trigger: '.story', start: 'top top', end: '+=700%', pin: '.story .stage', scrub: 0.8, invalidateOnRefresh: true,
    onUpdate: self => sound.setStory(self.progress),
  } });
  // From the answer onwards the music is "solved": modern and calm again.
  ScrollTrigger.create({ trigger: '.shift', start: 'top 65%', end: 'max', onToggle: self => sound.setSolved(self.isActive) });
  const T = 14; // timeline length; line i lands at 2i
  // The outer hand groups carry no transform of their own, so x / rotation are plain offsets around each fingertip.
  story.to('.half-left', { x: () => -innerWidth * 0.26, duration: T - 1, ease: 'power1.in' }, 1)
    .to('.half-right', { x: () => innerWidth * 0.26, duration: T - 1, ease: 'power1.in' }, 1)
    .fromTo('.half img', { filter: 'saturate(1) brightness(1) contrast(1)' }, { filter: 'saturate(0.55) brightness(0.82) contrast(1.06)', duration: T - 2 }, 1.5)
    .to('.painting .dim', { opacity: 0.75, duration: T - 3 }, 3)
    .to('.scroll-cue', { opacity: 0, duration: 0.8 }, 0.4);

  // The lines
  story.to('.l0', { opacity: 0, y: -30, duration: 0.8 }, 1.2);
  for (let i = 1; i <= 6; i++) {
    story.fromTo(`.l${i}`, { opacity: 0, y: 40, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7, ease: 'power2.out' }, 2 * i - 0.5);
    if (i < 6) story.to(`.l${i}`, { opacity: 0, y: -30, duration: 0.6 }, 2 * i + 1.1);
  }

  // Playful vandalism first (distraction), then the dark kind (decay).
  const pop = (sel, at) => story.fromTo(sel, { opacity: 0, scale: 0.4, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)' }, at);
  const draw = (sel, at, d = 1) => story.to(`${sel} .draw`, { strokeDashoffset: 0, duration: d, ease: 'power1.inOut' }, at);
  pop('.v5', 1.7); pop('.v7', 2.1); pop('.v6', 2.5);
  story.set('.v1, .v2', { opacity: 1 }, 3.2); draw('.v1', 3.2, 0.8); draw('.v2', 3.6, 0.9);
  pop('.v3', 4.1); pop('.v4', 4.6);
  story.fromTo('.d1 .drip, .d2 .drip', { scaleY: 0, transformOrigin: '50% 0%' }, { scaleY: 1, duration: 2.2, ease: 'power2.in' }, 6)
    .set('.d1, .d2', { opacity: 1 }, 6);
  story.set('.d3', { opacity: 1 }, 7.5); draw('.d3', 7.5, 1.6);
  pop('.d5', 8.4);
  story.set('.d4', { opacity: 1 }, 9.4); draw('.d4', 9.4, 0.6);
  story.fromTo('.d6', { opacity: 0 }, { opacity: 1, duration: 0.3 }, 10.2)
    .to('.d6 .glitch', { x: () => gsap.utils.random(-120, 120), duration: 0.25, stagger: 0.05, repeat: 5, yoyo: true }, 10.2);
  pop('.d7', 11.2);
  story.to('.vandal.fun', { opacity: 0.55, duration: 2 }, 11);

  // 03 Answer: the word arrives from far away, the image moves inside the letters.
  const shift = gsap.timeline({ scrollTrigger: { trigger: '.shift', start: 'top top', end: '+=160%', pin: '.shift .sticky', scrub: 0.6 } });
  shift.fromTo('.mask-word', { scale: 3.2, opacity: 0.2 }, { scale: 1, opacity: 1, ease: 'power2.out', duration: 1 })
    .fromTo('.mask-word', { backgroundPosition: '50% 0%' }, { backgroundPosition: '50% 100%', ease: 'none', duration: 1.4 }, 0)
    .from('.shift-copy', { y: 30, opacity: 0, duration: 0.6 }, 0.8);

  // 04 Product: pinned horizontal tour.
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

  // 05 How: the step numbers count in.
  gsap.utils.toArray('.step-n').forEach(n => gsap.from(n, { yPercent: 40, opacity: 0, duration: 1.2, ease, scrollTrigger: { trigger: n, start: 'top 85%' } }));

  // 06 Trust: the picture comes into focus while pinned.
  gsap.timeline({ scrollTrigger: { trigger: '.lock', start: 'top top', end: '+=120%', pin: '.lock .sticky', scrub: 0.6 } })
    .fromTo('.lock-img img', { '--blur': '22px', scale: 1.2 }, { '--blur': '0px', scale: 1, ease: 'none' })
    .from('.lock-copy > *', { y: 40, opacity: 0, stagger: 0.15, duration: 0.5 }, 0.1);

  // 07 Film: the frame opens up.
  gsap.fromTo('.frame', { clipPath: 'inset(18% 18% 18% 18%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', scrollTrigger: { trigger: '.film', start: 'top 80%', end: 'center center', scrub: true } });

  // 08 Model: the price ladder grows.
  gsap.from('.rung', { scaleY: 0, duration: 1.2, ease: 'power3.out', stagger: 0.12, scrollTrigger: { trigger: '.ladder', start: 'top 80%' } });

  // 10 Roadmap: pinned, a line draws across and each milestone lights up.
  const road = gsap.utils.toArray('.road li');
  gsap.timeline({ scrollTrigger: { trigger: '.roadmap', start: 'top top', end: '+=180%', pin: '.roadmap .sticky', scrub: 0.6,
    onUpdate: self => road.forEach((li, i) => li.classList.toggle('on', self.progress >= i / road.length + 0.02)) } })
    .to('.road-line i', { scaleX: 1, ease: 'none' });

  // 11 Ask
  gsap.from('.ask .c', { yPercent: 110, duration: 1.2, ease, stagger: 0.02, scrollTrigger: { trigger: '.ask', start: 'top 70%' } });

  addEventListener('load', () => ScrollTrigger.refresh());
}
