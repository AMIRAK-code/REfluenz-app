// The route table (docs/ARCHITECTURE.md section 3). Views load on demand: a page's code is fetched the first time it is
// visited. `auth` on a route overrides the view's own `auth` (the password reset page shares the sign-in view).
// Order matters only where patterns overlap: the catch-all comes last.

export const routes = [
  { path: '/app', view: () => import('../views/feed.js') },
  { path: '/app/discover', view: () => import('../views/discover.js') },
  { path: '/app/c/:slug', view: () => import('../views/creator.js') },
  { path: '/app/p/:id', view: () => import('../views/entry.js') },
  { path: '/app/library', view: () => import('../views/library.js') },
  { path: '/app/memberships', view: () => import('../views/memberships.js') },
  { path: '/app/messages', view: () => import('../views/messages.js') },
  { path: '/app/messages/:creatorId/:memberId', view: () => import('../views/messages.js') },
  { path: '/app/notifications', view: () => import('../views/notifications.js') },
  { path: '/app/studio', view: () => import('../views/studio.js') },
  { path: '/app/studio/new', view: () => import('../views/editor.js') },
  { path: '/app/studio/edit/:id', view: () => import('../views/editor.js') },
  { path: '/app/studio/settings', view: () => import('../views/studio-settings.js') },
  { path: '/app/settings', view: () => import('../views/settings.js') },
  { path: '/app/login', view: () => import('../views/auth.js') },
  { path: '/app/signup', view: () => import('../views/auth.js') },
  { path: '/app/forgot', view: () => import('../views/auth.js') },
  // After a recovery link the person has a session, so the page is not a guest page.
  { path: '/app/reset', view: () => import('../views/auth.js'), auth: 'recovery' },
  { path: '/app/welcome', view: () => import('../views/onboarding.js') },
  { path: '*', view: () => import('../views/not-found.js') }
];
