// The opening of the pitch: Michelangelo's Creation of Adam (public domain), torn apart like paper as you scroll.
// One SVG in the painting's own coordinates (3200 × 1452). The viewBox is the camera: it moves in on the fingertips,
// then pulls back. Every torn sheet carries its own shadow, fibre edge and graffiti, so they all move together.
//
//   zoom in on the fingers → they tremble → the paper tears between them → zoom out → graffiti on the figures,
//   a strip rips out of Adam's sheet, God's corner peels back, scraps fly → "The connection broke."

const NS = 'http://www.w3.org/2000/svg';
const W = 3200, H = 1452;
const TIP = { x: 1206, y: 649 };   // the gap between the two fingertips, measured on the photograph
const PAPER = '#fdfaf4', PAPER_EDGE = '#c9bea9';  // bare paper at the torn edges, on a cream backdrop
const BOX = { l: -60, t: -60, r: W + 60, b: H + 60 };

// Deterministic randomness: the tear looks the same on every visit.
function random(seed) {
  return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// The vertical tear, top to bottom. It wanders, but passes exactly between the fingertips.
function verticalTear(rnd) {
  const pts = []; let drift = 0;
  for (let y = BOX.t + 20; y <= BOX.b - 20; y += 9) {
    drift = (drift + (rnd() - 0.5) * 16) * 0.93;
    const far = Math.min(1, Math.max(0, (Math.abs(y - TIP.y) - 50) / 320));
    const sway = (Math.sin(y / 190 + 1.2) * 80 + Math.sin(y / 57) * 16) * far;
    pts.push([TIP.x + sway + drift * far + (rnd() - 0.5) * (2 + 8 * far), y]);
  }
  return pts;
}
// A horizontal tear across the whole width, left to right.
function horizontalTear(rnd, y0, amplitude) {
  const pts = []; let drift = 0;
  for (let x = BOX.l; x <= BOX.r; x += 9) {
    drift = (drift + (rnd() - 0.5) * 14) * 0.92;
    pts.push([x, y0 + Math.sin(x / 210 + y0) * amplitude + Math.sin(x / 47) * 8 + drift + (rnd() - 0.5) * 6]);
  }
  return pts;
}
// The torn fibre: a ragged band of bare paper just outside an edge, sticking out towards (dx, dy).
function fibre(edge, rnd, dx, dy) {
  const out = edge.map(([x, y]) => { const w = 7 + rnd() * 20 + (rnd() < 0.08 ? 18 : 0); return [x + dx * w, y + dy * w]; });
  return [...edge, ...out.reverse()];
}
const poly = pts => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const shifted = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
}
const FONT = 'font-family="Hanken Grotesk, Arial" font-weight="800"';

// Graffiti in image coordinates. side decides which sheet carries it.
const MARKS = [
  ['bubble', 'left', `<g transform="translate(980 500)"><rect x="-110" y="-44" width="220" height="88" rx="44" fill="#e0245e"/><text x="0" y="17" text-anchor="middle" font-size="50" ${FONT} fill="#fff">&#9829; 99+</text></g>`],
  ['badge', 'left', `<g transform="translate(610 640)"><circle r="50" fill="#ff3b30"/><text y="18" text-anchor="middle" font-size="52" ${FONT} fill="#fff">37</text></g>`],
  ['crown', 'left', `<path class="ink" d="M250,470 L280,360 L330,430 L370,330 L410,430 L460,360 L480,470 Z" fill="none" stroke="#ffd400" stroke-width="16" stroke-linejoin="round" filter="url(#tear-spray)"/>`],
  ['eyes', 'left', `<path class="ink" d="M370,505 L470,585 M470,505 L370,585" stroke="#d1001f" stroke-width="20" stroke-linecap="round" filter="url(#tear-spray)"/>`],
  ['lol', 'left', `<text x="560" y="1080" font-size="230" ${FONT} fill="#ffd400" transform="rotate(-7 700 1040)" letter-spacing="-8">LOL</text>`],
  ['dripL', 'left', `<path class="drip" fill="#120d0b" d="M640,0 h260 v160 c0,40 -30,52 -30,96 s30,40 0,84 -40,14 -40,-28 0,-70 -30,-84 -30,40 -40,110 -42,14 -42,-40 12,-96 -20,-140 -58,56 -58,-40 Z"/>`],
  ['crackL', 'left', `<polyline class="ink" points="120,260 300,420 260,560 480,700 450,860 700,980 760,1200" fill="none" stroke="#0d0a09" stroke-width="7"/>`],
  ['toast', 'right', `<g transform="translate(1720 170)"><rect x="-250" y="-62" width="500" height="124" rx="26" fill="#fff" stroke="#111" stroke-width="5"/><text x="0" y="18" text-anchor="middle" font-size="52" ${FONT} fill="#111">New post! Tap now</text></g>`],
  ['horns', 'right', `<path class="ink" d="M1770,250 C1740,170 1760,110 1800,80 C1800,150 1810,200 1840,235 M1940,215 C1980,170 2010,120 2000,60 C2050,110 2050,190 2000,250" fill="none" stroke="#d1001f" stroke-width="18" stroke-linecap="round" filter="url(#tear-spray)"/>`],
  ['stache', 'right', `<path d="M1830,420 C1860,395 1895,400 1915,425 C1935,400 1975,395 2005,420 C1985,450 1945,445 1915,432 C1885,445 1850,450 1830,420 Z" fill="#141010" stroke="#141010" stroke-width="6"/>`],
  ['smile', 'right', `<g transform="translate(2470 330)"><circle class="ink" r="100" fill="none" stroke="#2ef2a0" stroke-width="16" filter="url(#tear-spray)"/><path class="ink" d="M-38,-20 v10 M38,-20 v10 M-50,32 C-20,66 20,66 50,32" fill="none" stroke="#2ef2a0" stroke-width="16" stroke-linecap="round"/></g>`],
  ['fyp', 'right', `<text x="2050" y="880" font-size="190" ${FONT} fill="none" stroke="#ff3ea5" stroke-width="9" transform="rotate(-9 2250 820)">#FYP</text>`],
  ['dripR', 'right', `<path class="drip" fill="#120d0b" d="M2250,0 h340 v130 c0,60 -40,44 -40,130 s-46,30 -46,-46 -20,-60 -46,-60 -20,130 -42,130 -26,-90 -46,-120 -50,14 -50,60 -40,14 -46,-46 8,-90 -12,-210 Z"/>`],
  ['crackR', 'right', `<polyline class="ink" points="2060,1452 2160,1220 2120,1080 2380,940 2340,780 2620,640" fill="none" stroke="#0d0a09" stroke-width="7"/>`],
  ['ad', 'right', `<g transform="translate(2760 1240)"><rect x="-300" y="-110" width="600" height="220" fill="#111"/><text x="0" y="-20" text-anchor="middle" font-size="52" ${FONT} fill="#ffd400">AD · 0:05</text><text x="0" y="62" text-anchor="middle" font-size="64" ${FONT} fill="#fff">SKIP AD &#9656;</text></g>`],
];

export function mountStory({ svg, gsap, sound, imageSrc, end = '+=900%' }) {
  const rnd = random(1512);
  const tear = verticalTear(rnd);
  const upper = horizontalTear(rnd, 955, 26), lower = horizontalTear(rnd, 1105, 22);
  svg.innerHTML = '';
  const defs = el('defs', {}, svg);
  const clip = (id, pts) => { const c = el('clipPath', { id }, defs); return el('polygon', { points: poly(pts) }, c); };

  const leftRegion = [[BOX.l, BOX.t], ...tear, [BOX.l, BOX.b]];
  const rightRegion = [...tear, [BOX.r, BOX.b], [BOX.r, BOX.t]];
  // Adam's sheet is three parts from the start (top, strip, bottom). They overlap by a few units so no seam shows
  // while they still move as one.
  const above = [[BOX.l, BOX.t], [BOX.r, BOX.t], ...shifted([...upper].reverse(), 0, 4)];
  const band = [...shifted(upper, 0, -2), ...shifted([...lower].reverse(), 0, 2)];
  const below = [...shifted(lower, 0, -4), [BOX.r, BOX.b], [BOX.l, BOX.b]];
  clip('keep-left', leftRegion); clip('part-above', above); clip('part-band', band); clip('part-below', below);
  const rightClip = clip('keep-right', rightRegion);

  const grad = el('linearGradient', { id: 'peel-back', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
  for (const [o, c] of [['0', '#bdb2a0'], ['.45', '#eee8dc'], ['1', '#fbf8f1']]) el('stop', { offset: o, 'stop-color': c }, grad);
  const spray = el('filter', { id: 'tear-spray' }, defs);
  el('feTurbulence', { type: 'fractalNoise', baseFrequency: '1.6', numOctaves: '1', result: 'n' }, spray);
  el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: '6' }, spray);

  // A sheet: its shadow, the fibre along its torn edges (hidden until the tear opens), the clipped painting and graffiti.
  function sheet({ region, keep, part, edges, side, shadow = true }) {
    const g = el('g', { class: 'sheet' }, svg);
    if (shadow) el('polygon', { points: poly(shifted(region, 16, 22)), fill: '#3a2e20', opacity: '.32', 'clip-path': part ? `url(#${keep})` : null }, g);
    // Vertical fibres show when the main tear opens, horizontal ones only when the strip rips out.
    const fibres = el('g', { opacity: 0 }, g), across = el('g', { opacity: 0 }, g);
    for (const [e, horizontal] of edges) el('polygon', { points: poly(e), fill: PAPER, stroke: PAPER_EDGE, 'stroke-width': 1.2 }, horizontal ? across : fibres);
    const outer = el('g', { 'clip-path': `url(#${keep})` }, g);
    const inner = part ? el('g', { 'clip-path': `url(#${part})` }, outer) : outer;
    el('image', { href: imageSrc, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none' }, inner);
    for (const [name, at, markup] of MARKS) if (at === side) { const m = el('g', { class: `mark m-${name}`, opacity: 0 }, inner); m.innerHTML = markup; }
    return { g, fibres, across };
  }
  // One shadow under the whole of Adam's sheet (its three parts must not darken each other).
  const leftShadow = el('polygon', { points: poly(shifted(leftRegion, 16, 22)), fill: '#3a2e20', opacity: '.32' }, svg);
  const top = sheet({ shadow: false,  region: leftRegion, keep: 'keep-left', part: 'part-above', side: 'left', edges: [[fibre(tear, rnd, 1, 0)], [fibre(upper, rnd, 0, 1), true]] });
  const strip = sheet({ region: band, keep: 'keep-left', part: 'part-band', side: 'left', edges: [[fibre(upper, rnd, 0, -1), true], [fibre(lower, rnd, 0, 1), true]] });
  const bottom = sheet({ shadow: false, region: leftRegion, keep: 'keep-left', part: 'part-below', side: 'left', edges: [[fibre(tear, rnd, 1, 0)], [fibre(lower, rnd, 0, -1), true]] });
  const right = sheet({ region: rightRegion, keep: 'keep-right', side: 'right', edges: [[fibre(tear, rnd, -1, 0)]] });

  // God's top-right corner peels back along a 45° fold through (W - d, 0) and (W, d).
  const flapShadow = el('polygon', { fill: '#3a2e20', opacity: '.28' }, right.g);
  const flap = el('polygon', { fill: 'url(#peel-back)', stroke: PAPER_EDGE, 'stroke-width': 2 }, right.g);
  function setPeel(d) {
    if (d < 2) { rightClip.setAttribute('points', poly(rightRegion)); flap.setAttribute('points', ''); flapShadow.setAttribute('points', ''); return; }
    const cut = [...tear, [BOX.r, BOX.b], [BOX.r, d + (BOX.r - W)], [W - d - (0 - BOX.t), BOX.t]];
    rightClip.setAttribute('points', poly(cut));
    flap.setAttribute('points', poly([[W - d, 0], [W, d], [W - d, d]]));
    flapShadow.setAttribute('points', poly([[W - d - 12, 14], [W + 8, d + 26], [W - d - 16, d + 34]]));
  }

  // Paper scraps that fly out of the tear.
  const scraps = Array.from({ length: 14 }, (_, i) => {
    const size = 24 + rnd() * 48;
    const pts = Array.from({ length: 6 }, (_, k) => { const a = k / 6 * Math.PI * 2 + rnd() * 0.6, r = size * (0.55 + rnd() * 0.5); return [Math.cos(a) * r, Math.sin(a) * r]; });
    const g = el('g', { opacity: 0 }, svg);
    el('polygon', { points: poly(pts), fill: ['#fdfaf4', '#d9ccb4', '#c4b294'][i % 3], stroke: '#a89a82', 'stroke-width': 1.5 }, g);
    return { g, x: TIP.x + (rnd() - 0.5) * 60, y: 160 + rnd() * 1100, vx: (rnd() - 0.5) * 950, vy: (rnd() - 0.4) * 520, r: (rnd() - 0.5) * 560 };
  });

  // Ink strokes are drawn as they appear.
  svg.querySelectorAll('.ink').forEach(p => { const L = p.getTotalLength?.() || 800; p.style.strokeDasharray = L; p.style.strokeDashoffset = L; });

  // ---------------------------------------------------------------------------------------------------- camera
  // cam.w = painting units across the screen's width, cam.rot = rotation of the whole picture in degrees.
  const cam = { cx: W / 2, cy: H / 2, w: W, rot: 0 };
  const aspect = () => innerWidth / innerHeight;
  const portrait = () => aspect() < 0.9;
  // On phones the painting is a band in the upper part of the screen (the words sit below it), framed wider so both
  // figures and their graffiti stay in view. width = how much of the painting spans the screen.
  const phoneFrame = (w, cx) => ({ w, cx, cy: H / 2 + 0.11 * (w / aspect()) });
  function wide(extra = 1) {
    if (portrait()) return phoneFrame(extra > 1.3 ? 3300 : extra > 1 ? 2400 : 1450, extra > 1.3 ? 1600 : extra > 1 ? 1350 : TIP.x + 170);
    const a = aspect();
    if (a < W / H) { const w = H * a * extra; return { w, cx: Math.min(Math.max(TIP.x + 160, w / 2), W - w / 2), cy: H / 2 }; }
    const w = W * extra; return { w, cx: W / 2, cy: H / 2 };
  }
  const close = () => (portrait() ? { w: 430, cx: TIP.x, cy: TIP.y - 6 } : { w: Math.max(380, 640 * Math.min(1, aspect())), cx: TIP.x, cy: TIP.y - 6 });
  // Phones open with the picture turned sideways so the landscape fresco fills the tall screen; zooming in spins it
  // upright. While it turns, the SVG is a square as wide as the screen's diagonal, so it always covers the screen.
  const turned = () => { const k = Math.max(innerHeight / W, innerWidth / H); return { w: innerWidth / k, cx: W / 2, cy: H / 2, rot: 450 }; };
  const start = () => (portrait() ? turned() : { ...wide(), rot: 0 });
  let squareSize = 0;
  function applyCamera() {
    const vw = innerWidth, vh = innerHeight;
    if (!portrait()) {
      if (squareSize) { svg.removeAttribute('style'); squareSize = 0; }
      const h = cam.w / aspect();
      svg.setAttribute('viewBox', `${(cam.cx - cam.w / 2).toFixed(1)} ${(cam.cy - h / 2).toFixed(1)} ${cam.w.toFixed(1)} ${h.toFixed(1)}`);
      return;
    }
    const D = Math.ceil(Math.hypot(vw, vh));
    if (D !== squareSize) {
      squareSize = D;
      Object.assign(svg.style, { width: `${D}px`, height: `${D}px`, left: `${(vw - D) / 2}px`, top: `${(vh - D) / 2}px`, transformOrigin: '50% 50%' });
    }
    svg.style.transform = cam.rot ? `rotate(${cam.rot.toFixed(2)}deg)` : '';
    const L = D * cam.w / vw;
    svg.setAttribute('viewBox', `${(cam.cx - L / 2).toFixed(1)} ${(cam.cy - L / 2).toFixed(1)} ${L.toFixed(1)} ${L.toFixed(1)}`);
  }
  Object.assign(cam, start()); applyCamera();

  // ------------------------------------------------------------------------------------------------- piece motion
  const S = {
    left: { x: 0, y: 0, r: 0 }, right: { x: 0, y: 0, r: 0 }, strip: { x: 0, y: 0, r: 0 }, bottom: { x: 0, y: 0, r: 0 },
    shake: 0, fibre: 0, fibreAcross: 0, scraps: 0, peel: 0,
  };
  const place = (node, x, y, r, cx, cy) => node.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(3)} ${cx} ${cy})`);
  let lastPeel = -1;
  function render(time) {
    const a = S.shake, t = time;
    const lx = a * (Math.sin(t * 53) * 0.6 + Math.sin(t * 91) * 0.4) * 3.4, ly = a * (Math.sin(t * 61 + 1) * 0.6 + Math.sin(t * 103) * 0.4) * 2.6;
    const rx = a * (Math.sin(t * 57 + 2) * 0.6 + Math.sin(t * 97 + 1) * 0.4) * 3.4, ry = a * (Math.sin(t * 67 + 3) * 0.6 + Math.sin(t * 109) * 0.4) * 2.6;
    const L = S.left;
    place(top.g, L.x + lx, L.y + ly, L.r, 600, 726);
    place(leftShadow, L.x + lx, L.y + ly, L.r, 600, 726);
    place(strip.g, L.x + S.strip.x + lx, L.y + S.strip.y + ly, L.r + S.strip.r, 500, 1030);
    place(bottom.g, L.x + S.bottom.x + lx, L.y + S.bottom.y + ly, L.r + S.bottom.r, 500, 1250);
    place(right.g, S.right.x + rx, S.right.y + ry, S.right.r, 2300, 726);
    const f = Math.min(1, S.fibre).toFixed(2);
    const fa = Math.min(1, S.fibreAcross).toFixed(2);
    for (const s of [top, strip, bottom, right]) { s.fibres.setAttribute('opacity', f); s.across.setAttribute('opacity', fa); }
    if (Math.abs(S.peel - lastPeel) > 0.5) { setPeel(S.peel); lastPeel = S.peel; }
    for (const s of scraps) {
      const p = S.scraps;
      s.g.setAttribute('opacity', p > 0.02 ? Math.min(1, p * 4).toFixed(2) : 0);
      s.g.setAttribute('transform', `translate(${(s.x + s.vx * p).toFixed(1)} ${(s.y + s.vy * p + 260 * p * p).toFixed(1)}) rotate(${(s.r * p).toFixed(1)})`);
    }
    applyCamera();
  }
  gsap.ticker.add(render);

  // ------------------------------------------------------------------------------------------------- the timeline
  const marks = name => svg.querySelectorAll(`.m-${name}`);
  const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: {
    trigger: '.story', start: 'top top', end, pin: '.story .stage', scrub: 0.9, invalidateOnRefresh: true,
    onUpdate: self => sound.setStory(self.progress),
  } });
  const pop = (name, at) => tl.fromTo(marks(name), { opacity: 0, scale: 0.4, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)' }, at);
  const draw = (name, at, d = 0.8) => tl.set(marks(name), { opacity: 1 }, at).to(svg.querySelectorAll(`.m-${name} .ink`), { strokeDashoffset: 0, duration: d, ease: 'power1.inOut' }, at);
  const drip = (name, at) => tl.set(marks(name), { opacity: 1 }, at).fromTo(svg.querySelectorAll(`.m-${name} .drip`), { scaleY: 0, transformOrigin: '50% 0%' }, { scaleY: 1, duration: 2, ease: 'power2.in' }, at);
  // Each camera move goes between two explicit views, so a refresh half way never records a wrong starting point.
  const view = v => () => ({ rot: 0, ...v() });
  const camMove = (from, to, at, d, ease = 'power2.inOut') => tl.fromTo(cam,
    { cx: () => view(from)().cx, cy: () => view(from)().cy, w: () => view(from)().w, rot: () => view(from)().rot },
    { cx: () => view(to)().cx, cy: () => view(to)().cy, w: () => view(to)().w, rot: () => view(to)().rot, duration: d, ease, immediateRender: false }, at);
  const midView = () => wide(1.1);
  const endView = () => { const v = wide(1.45); return portrait() ? v : { ...v, cx: v.cx + 120, cy: H / 2 + 40 }; };

  // 0–2: the camera moves in on the fingertips.
  camMove(start, close, 0, 2.2);
  // 1.6–4: they tremble, then the paper starts to give.
  tl.to(S, { shake: 1, duration: 0.8 }, 1.6)
    .to(S.left, { x: -10, duration: 1.4, ease: 'power1.in' }, 2.6).to(S.right, { x: 12, duration: 1.4, ease: 'power1.in' }, 2.6)
    .to(S, { fibre: 1, duration: 0.6 }, 2.9);
  // 4–6.5: the tear rips open and the camera pulls back to the whole scene.
  camMove(close, midView, 4, 2.6);
  tl.to(S, { shake: 0.25, duration: 1.5 }, 4)
    .to(S.left, { x: -150, y: 20, r: -2.2, duration: 2.5, ease: 'power2.out' }, 4)
    .to(S.right, { x: 170, y: -14, r: 2.6, duration: 2.5, ease: 'power2.out' }, 4)
    .to(S, { scraps: 0.35, duration: 2.5 }, 4.2);
  // 4.8–11: graffiti on the figures: distraction first, then decay.
  pop('bubble', 4.8); pop('badge', 5.1); pop('toast', 5.4);
  draw('crown', 5.7); draw('horns', 6.1); pop('stache', 6.5); draw('smile', 6.8);
  pop('fyp', 7.2); pop('lol', 7.5);
  drip('dripL', 8.4); drip('dripR', 8.6);
  draw('crackL', 9.2, 1.2); draw('crackR', 9.5, 1.2); draw('eyes', 10, 0.5); pop('ad', 10.6);
  // 7.9–12.5: a strip rips out of Adam's sheet and falls away.
  tl.to(S, { fibreAcross: 1, duration: 0.4 }, 7.9)
    .to(S.strip, { y: 170, x: -70, r: -6, duration: 2.2, ease: 'power2.in' }, 7.9)
    .to(S.bottom, { y: 60, r: 1.5, duration: 2.2, ease: 'power2.out' }, 8)
    .to(S.strip, { y: 1000, x: -260, r: -18, duration: 2.4, ease: 'power2.in' }, 10.1);
  // 9–13.5: God's corner peels back, everything drifts further apart, the camera backs away.
  tl.to(S, { peel: 1050, duration: 3.6, ease: 'power1.inOut' }, 9)
    .to(S.left, { x: -420, y: 50, r: -5, duration: 4, ease: 'power1.in' }, 9.5)
    .to(S.right, { x: 460, y: -40, r: 6, duration: 4, ease: 'power1.in' }, 9.5)
    .to(S, { scraps: 1, duration: 4 }, 9.5)
    .fromTo(svg, { filter: 'saturate(1) brightness(1) contrast(1)' }, { filter: 'saturate(0.55) brightness(0.86) contrast(1.06)', duration: 6 }, 7);
  camMove(midView, endView, 10, 3.5, 'power1.inOut');
  tl.set({}, {}, 14.6);

  return { timeline: tl, refresh: applyCamera };
}
