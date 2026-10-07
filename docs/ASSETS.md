# Editorial artwork and motion assets

The original landing page referenced remote Google-hosted imagery that could not be downloaded in this workspace. Three project-specific photographs were generated with the built-in image-generation tool and copied into `public/editorial/`.

- `atelier.png`: portrait black-and-white film-style photograph of a sculptural tailored wool coat on a metal garment stand in a sunlit Paris atelier; pale plaster, curved chair, tactile wool; no people, text, logos or watermark.
- `ritual.png`: square monochrome beauty still life; unlabelled frosted cosmetic bottle, ceramic bowl, textured linen, travertine plinth and an olive-branch shadow; natural light; no text or people.
- `architecture.png`: square monochrome architectural photograph of a curved concrete staircase, pale textured plaster and a small daylight opening; exacting geometry; no people, text or watermark.

The 1254 px and 1024x1536 PNGs are 2.3-2.7 MB each, so the platform does not use them for card covers, the reader, the studio rows or the sign-in screen. It uses 800 px JPEGs (quality 80, 70-140 KB) in `public/editorial/v1/` (`atelier.jpg`, `ritual.jpg`, `architecture.jpg`); `presetUrl()` in `src/core/constants.js` points there. `vercel.json` caches `/editorial/v1/*` for a year as immutable, so a changed image must go into a new `v2/` folder (and `PRESET_BASE` in `src/core/constants.js` must point at it) instead of replacing a file. The PNGs stay for the landing page and the film.

All are generated editorial illustrations. They do not represent actual creator portfolios, real products, or real customer work.

`public/film/refluenz-introduction.mp4` uses those assets with code-authored typography and geometry. The interface segment is an animated design study matching the app, not a captured live screen. `scripts/render-film.py` contains the complete composition, timing and original synthesized ambient score. No third-party music or stock video is used.

The preferred site font is Hanken Grotesk, inherited from the original design. The file was not supplied and network restrictions prevented downloading it. The demo falls back to Arial/system sans. The video uses the system Nimbus Sans font; production teams can substitute a properly licensed Hanken Grotesk file in the rendering script for an exact match.
