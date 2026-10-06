const paths={arrow:'M4 12h16m-6-6 6 6-6 6',back:'M20 12H4m6-6-6 6 6 6',down:'M12 4v16m-6-6 6 6 6-6',grid:'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',compass:'M16 8l-3 5-5 3 3-5z',bookmark:'M6 3h12v18l-6-4-6 4z',message:'M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0z',studio:'M4 21h16M6 17l-1-4L16 2l5 5-11 11zM14 4l5 5',search:'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zm5.5 13 5 5',close:'M5 5l14 14M19 5 5 19',plus:'M12 4v16M4 12h16',check:'M4 12l5 5L20 6',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',lock:'M6 10h12v11H6zm2 0V6a4 4 0 0 1 8 0v4',play:'M8 4l13 8-13 8z',user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4 22v-2a8 8 0 0 1 16 0v2',members:'M16 21v-2a5 5 0 0 0-5-5H7a5 5 0 0 0-5 5v2M13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM17 3a4 4 0 0 1 0 8m3 10v-2a5 5 0 0 0-3-4.6',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',export:'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',send:'M22 2 9 15m13-13-8 20-5-7-7-5z',menu:'M3 6h18M3 12h18M3 18h18',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3v6l4 2',logout:'M9 4H3v16h6m4-12 4 4-4 4M7 12h14',trash:'M3 6h18M5 6l1 15h12l1-15M9 6V3h6v3m-5 4v7m4-7v7',image:'M3 4h18v16H3zM3 17l5-5 4 4 3-3 6 6M9 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',video:'M3 6h12v12H3zm12 4 6-3v10l-6-3z',upload:'M12 15V3m-4 4 4-4 4 4M4 16v5h16v-5',text:'M4 6h16M4 12h16M4 18h10'};
export const icon=(name,size=18)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name==='compass'?'<circle cx="12" cy="12" r="10"/>':''}<path d="${paths[name]||paths.arrow}"/></svg>`;
// More glyphs for the app shell and the views. Same 24px grid and stroke as above.
const dot = (x, y) => `M${x - 1} ${y}a1 1 0 1 0 2 0 1 1 0 1 0-2 0z`;
Object.assign(paths, {
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9zm4.3 13a2 2 0 0 0 3.4 0',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  more: dot(5, 12) + dot(12, 12) + dot(19, 12),
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  chart: 'M3 20h18M6 20v-8m6 8V5m6 15v-5',
  grip: dot(9, 6) + dot(15, 6) + dot(9, 12) + dot(15, 12) + dot(9, 18) + dot(15, 18),
  reply: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  globe: 'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0zm0 0h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zm9 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  sort: 'M7 4v16m-4-4 4 4 4-4M17 20V4m-4 4 4-4 4 4',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 3 1.1-6.2L3 9.7l6.2-.9z',
  alert: 'M12 3 2 21h20zM12 10v5m0 3h.01',
  info: 'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0zm9 5v-6m0-3h.01',
  external: 'M14 4h6v6m0-6L10 14M18 14v6H4V6h6'
});
