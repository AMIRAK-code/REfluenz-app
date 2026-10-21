// Shared vocabulary of the platform (docs/ARCHITECTURE.md sections 1 and 7).
// Pure data: nothing here touches the DOM or the network.

export const SITE_NAME = 'REFLUENZ';

export const KINDS = ['text', 'image', 'video'];
export const TEXT_FORMATS = ['Essay', 'Guide', 'Studio note', 'Field note', 'Collection'];
export const FORMATS = [...TEXT_FORMATS, 'Gallery', 'Film'];
export const DEFAULT_FORMAT = { text: 'Essay', image: 'Gallery', video: 'Film' };

// Editorial cover presets (monochrome). Versioned folder: vercel.json caches it for a year, so a changed
// picture needs a new folder and a new PRESET_BASE (see docs/ASSETS.md).
export const PRESETS = ['atelier', 'ritual', 'architecture'];
export const PRESET_BASE = '/editorial/v1';

// The shared access ladder (public.tiers). Creators rename and price each level, the level itself is fixed.
export const TIER_IDS = ['essential', 'premium', 'signature'];
export const TIER_LEVELS = { public: 0, essential: 1, premium: 2, signature: 3 };
// The House's three doors: Member, Private and Black Label.
export const TIER_NAMES = { public: 'Open', essential: 'Member', premium: 'Private', signature: 'Black Label' };

export const DEFAULT_SETTINGS = Object.freeze({ compact: false, welcomeDismissed: false, onboarded: true, notifyPrefs: {} });

// Where a signed-in session lives (supabase-js default key for this project); the landing page reads it too.
export const SESSION_STORAGE_KEY = 'sb-gughgswzovomkxjlqvsr-auth-token';

export const presetUrl = name => `${PRESET_BASE}/${PRESETS.includes(name) ? name : PRESETS[0]}.jpg`;
