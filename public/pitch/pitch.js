// REFLUENZ pitch: scroll-told deck. One animation stack (GSAP + ScrollTrigger) with Lenis smooth scroll.
// Without motion (reduced motion, or the libraries fail to load) the page stays a complete, readable document.
const scenes = [...document.querySelectorAll('[data-scene]')];
const counter = document.querySelector('[data-count]');
document.querySelector('[data-total]').textContent = String(scenes.length).padStart(2, '0');

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  // 01 Hero: characters rise, image settles, copy drifts away.
  gsap.from('.hero .c', { yPercent: 110, duration: 1.3, ease, stagger: 0.025, delay: 0.15 });
  gsap.from('.hero .eyebrow, .hero .lede', { y: 24, opacity: 0, duration: 1.1, ease, delay: 0.7, stagger: 0.12 });
  gsap.to('.hero-img img', { scale: 1, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  gsap.to('.hero-copy', { yPercent: -30, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 30%', scrub: true } });

  // 02 Problem: pinned; each claim lands, then gets struck through.
  const claims = gsap.utils.toArray('.claims li');
  const problem = gsap.timeline({ scrollTrigger: { trigger: '.problem', start: 'top top', end: '+=220%', pin: '.problem .sticky', scrub: 0.6 } });
  claims.forEach((li, i) => {
    problem.from(li, { yPercent: 60, opacity: 0, duration: 1, ease: 'power3.out' }, i * 1.2)
      .to(li.querySelector('span'), { '--strike': 1, duration: 0.8, ease: 'power2.inOut' }, i * 1.2 + 0.7)
      .to(li, { color: 'oklch(55% 0.012 60)', duration: 0.6 }, i * 1.2 + 1);
  });
  problem.from('.problem .aside', { opacity: 0, y: 30, duration: 1 }, '>-0.2');

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
