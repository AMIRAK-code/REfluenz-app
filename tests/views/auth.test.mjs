// Sign in, sign up, forgotten password, new password, the welcome tour, the not-found page and the landing page's
// "Open the app" swap (views/auth.js, views/onboarding.js, views/not-found.js, landing.js + index.html).

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, uninstallDom, mountApp, tick } from '../helpers/dom.mjs';
import { createFakeApi, IDS } from '../helpers/fake-api.mjs';
import { timing } from '../../src/views/auth.js';
import { deps } from '../../src/views/onboarding.js';
import { AUTH_ERROR_KEY, parseAuthError, stashAuthError, takeAuthError } from '../../src/views/auth/auth-error.js';
import { applySignedInCtas, hasSessionToken } from '../../src/views/auth/landing-session.js';
import { SESSION_STORAGE_KEY } from '../../src/core/constants.js';

const HOSTILE = '<img src=x onerror=alert(1)>';
const MEMBER = { email: 'member@example.test', password: 'secret12' };

const guest = options => createFakeApi({ signedIn: null, ...options });
const callsOf = (api, method) => api.calls.filter(call => call.method === method);

// Polls until `check()` is truthy (the store and the router settle a few timers after an api call resolves).
async function until(check, what = 'the condition', ms = 2000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await tick(10);
  }
}

// Holds an api method until release() is called, so a test can look at the page while a write is in flight.
function hold(api, method) {
  const original = api[method];
  let release = () => {};
  const gate = new Promise(resolve => { release = resolve; });
  const state = { calls: 0, release: () => release() };
  api[method] = async (...args) => { state.calls++; await gate; return original(...args); };
  return state;
}

// Types into a field the way a person does (the page listens to "input").
async function type(app, selector, value) {
  const field = app.find(selector);
  field.value = value;
  field.dispatchEvent(new app.window.Event('input', { bubbles: true }));
}

describe('sign in, sign up and recovery (views/auth.js)', () => {
  let app = null;
  before(() => installDom());
  after(async () => { await uninstallDom(); });
  afterEach(async () => {
    await app?.destroy();
    app = null;
    timing.cooldownMs = 30_000;
    timing.signInWaitMs = 6_000;
    sessionStorage.clear();
  });

  describe('sign in', () => {
    it('shows the split layout with labelled fields, a picture and links to the other auth pages', async () => {
      app = await mountApp({ api: guest(), path: '/app/login' });
      assert.equal(app.path, '/app/login');
      assert.equal(app.document.title, 'Sign in — REFLUENZ');
      assert.equal(app.text('#view h1'), 'Step inside.');
      assert.ok(app.exists('.auth .auth-picture img[alt]'), 'a picture with alt text');
      assert.equal(app.find('label[for="auth-email"]').textContent, 'Email');
      assert.equal(app.find('#auth-email').getAttribute('autocomplete'), 'email');
      assert.equal(app.find('#auth-password').getAttribute('autocomplete'), 'current-password');
      assert.equal(app.find('#auth-password').type, 'password');
      assert.equal(app.find('.auth-links a[href="/app/signup"]').textContent, 'Create a free account');
      assert.equal(app.find('.auth-links a[href="/app/forgot"]').textContent, 'Forgot your password?');
      assert.match(app.text('.auth-foot'), /Free to join, nothing is charged/);
      assert.ok(app.find('[data-auth-form]').hasAttribute('novalidate'));
    });

    it('is a focus page: the shell chrome is hidden while it is open and comes back on other pages', async () => {
      app = await mountApp({ api: guest(), path: '/app/login' });
      assert.ok(app.find('.shell').classList.contains('shell--focus'));
      await app.navigate('/app/discover');
      assert.equal(app.find('.shell').classList.contains('shell--focus'), false);
    });

    it('shows and hides the password', async () => {
      app = await mountApp({ api: guest(), path: '/app/login' });
      const toggle = app.find('[data-toggle-password]');
      toggle.checked = true;
      toggle.dispatchEvent(new app.window.Event('change', { bubbles: true }));
      assert.equal(app.find('#auth-password').type, 'text');
      toggle.checked = false;
      toggle.dispatchEvent(new app.window.Event('change', { bubbles: true }));
      assert.equal(app.find('#auth-password').type, 'password');
    });

    it('validates before it calls the api, puts the message next to the field and focuses the first problem', async () => {
      const api = guest();
      app = await mountApp({ api, path: '/app/login' });
      await app.submit('[data-auth-form]', { email: '', password: '' });
      assert.equal(callsOf(api, 'signIn').length, 0);
      assert.equal(app.text('#auth-email-error'), 'Enter your email address.');
      assert.equal(app.text('#auth-password-error'), 'Enter your password.');
      assert.equal(app.find('#auth-email').getAttribute('aria-invalid'), 'true');
      assert.equal(app.document.activeElement?.id, 'auth-email');
      assert.ok(app.find('#auth-email').getAttribute('aria-describedby').includes('auth-email-error'));

      await app.submit('[data-auth-form]', { email: 'not an address', password: 'x' });
      assert.match(app.text('#auth-email-error'), /valid email address/);
      await type(app, '#auth-email', 'a@b.co');
      assert.equal(app.find('#auth-email').hasAttribute('aria-invalid'), false, 'typing clears the message');
      assert.equal(app.find('#auth-email-error').hidden, true);
    });

    it('signs in, says so, and lands on the home page', async () => {
      const api = guest();
      app = await mountApp({ api, path: '/app/login' });
      await app.submit('[data-auth-form]', MEMBER);
      await until(() => app.path === '/app', 'the home page');
      assert.equal(app.store.state.user.email, MEMBER.email);
      assert.deepEqual(callsOf(api, 'signIn')[0].args, [MEMBER.email, MEMBER.password]);
      assert.match(app.text('#toast'), /Welcome back/);
      assert.equal(app.find('.shell').classList.contains('shell--focus'), false);
    });

    it('trims the address before it is sent', async () => {
      const api = guest();
      app = await mountApp({ api, path: '/app/login' });
      await app.submit('[data-auth-form]', { email: `  ${MEMBER.email}  `, password: MEMBER.password });
      await until(() => app.path === '/app');
      assert.equal(callsOf(api, 'signIn')[0].args[0], MEMBER.email);
    });

    it('goes on to the page the person came for (?next=)', async () => {
      app = await mountApp({ api: guest(), path: '/app/login?next=/app/discover%3Fq%3Dlinen' });
      assert.match(app.text('.auth-lede'), /continue where you left off/);
      await app.submit('[data-auth-form]', MEMBER);
      await until(() => app.path === '/app/discover?q=linen', 'the next page');
    });

    it('is sent to the login page with ?next= by a protected page, and returns there', async () => {
      app = await mountApp({ api: guest(), path: '/app/library' });
      assert.equal(app.path, '/app/login?next=%2Fapp%2Flibrary');
      await app.submit('[data-auth-form]', MEMBER);
      await until(() => app.path === '/app/library', 'the library');
    });

    it('ignores a next that leaves the app or points at another auth page', async () => {
      for (const next of ['https://evil.example/app', '//evil.example/app', '/\\evil.example', '/app/../etc', 'javascript:alert(1)', '/app/login', '/app/signup?next=/app/library']) {
        const api = guest();
        app = await mountApp({ api, path: `/app/login?next=${encodeURIComponent(next)}` });
        await app.submit('[data-auth-form]', MEMBER);
        await until(() => app.path === '/app', `home for next=${next}`);
        await app.destroy();
        app = null;
      }
    });

    it('keeps a hostile next out of the markup (links carry it encoded)', async () => {
      const next = `/app/discover?q=${HOSTILE}`;
      app = await mountApp({ api: guest(), path: `/app/login?next=${encodeURIComponent(next)}` });
      assert.equal(app.exists('#view img[src="x"]'), false);
      assert.ok(!app.html('#view').includes('<img src=x'));
      const href = app.find('.auth-links a[href^="/app/signup"]').getAttribute('href');
      assert.ok(href.startsWith('/app/signup?next='));
      assert.ok(!href.includes('<'), 'the link is percent-encoded');
    });

    it('explains a wrong password in place, keeps the address, selects the password and unlocks the button', async () => {
      const api = guest();
      app = await mountApp({ api, path: '/app/login' });
      await app.submit('[data-auth-form]', { email: MEMBER.email, password: 'wrong-password' });
      assert.equal(app.path, '/app/login');
      assert.equal(app.text('#auth-form-error'), 'That email and password do not match.');
      assert.equal(app.find('#auth-form-error').getAttribute('role'), 'alert');
      assert.equal(app.find('#auth-email').value, MEMBER.email);
      assert.equal(app.document.activeElement?.id, 'auth-password');
      const submit = app.find('[type="submit"]');
      assert.equal(submit.disabled, false);
      assert.equal(submit.hasAttribute('aria-busy'), false);
      await type(app, '#auth-password', 'secret12');
      assert.equal(app.text('#auth-form-error'), '', 'the message goes away when the person edits the form');
    });

    it('shows a network failure as written by the api and never loses what was typed', async () => {
      const api = guest();
      api.fail('signIn', 'Connection problem. Check your internet and try again.');
      app = await mountApp({ api, path: '/app/login' });
      await app.submit('[data-auth-form]', MEMBER);
      assert.equal(app.text('#auth-form-error'), 'Connection problem. Check your internet and try again.');
      assert.equal(app.find('#auth-email').value, MEMBER.email);
      assert.equal(app.find('#auth-password').value, MEMBER.password);
      api.fail('signIn', null);
      await app.submit('[data-auth-form]');
      await until(() => app.path === '/app', 'a second try');
    });

    it('hides the message of a programming error behind a plain sentence', async () => {
      const api = guest();
      api.fail('signIn', new TypeError("Cannot read properties of undefined (reading 'x')"));
      app = await mountApp({ api, path: '/app/login' });
      await app.submit('[data-auth-form]', MEMBER);
      assert.equal(app.text('#auth-form-error'), 'Something went wrong. Try again in a moment.');
    });

    it('disables the button while the request is open and ignores a second submit', async () => {
      const api = guest();
      const gate = hold(api, 'signIn');
      app = await mountApp({ api, path: '/app/login' });
      const first = app.submit('[data-auth-form]', MEMBER);
      await tick(5);
      const submit = app.find('[type="submit"]');
      assert.equal(submit.disabled, true);
      assert.equal(submit.getAttribute('aria-busy'), 'true');
      assert.equal(app.find('[data-auth-form]').getAttribute('aria-busy'), 'true');
      app.find('[data-auth-form]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
      await tick(5);
      assert.equal(gate.calls, 1, 'one request');
      gate.release();
      await first;
      await until(() => app.path === '/app');
    });

    it('offers to resend the confirmation when the email is not confirmed yet, and says what happened', async () => {
      const api = guest();
      api.db.users.find(user => user.email === MEMBER.email).confirmed = false;
      app = await mountApp({ api, path: '/app/login' });
      await app.submit('[data-auth-form]', MEMBER);
      assert.match(app.text('#auth-form-error'), /Confirm your email first/);
      const resend = app.find('[data-resend]');
      assert.equal(resend.disabled, false);
      await app.click(resend);
      assert.deepEqual(callsOf(api, 'resendConfirmation')[0].args, [MEMBER.email]);
      assert.match(app.text('[data-status]'), /We sent another email to member@example\.test/);
      assert.equal(resend.disabled, true, 'a cooldown follows');
      assert.match(resend.textContent, /Resend in \d+ s/);
    });

    it('reports a failed resend without leaving the page', async () => {
      const api = guest();
      api.db.users.find(user => user.email === MEMBER.email).confirmed = false;
      app = await mountApp({ api, path: '/app/login' });
      await app.submit('[data-auth-form]', MEMBER);
      api.fail('resendConfirmation', 'Too many attempts. Wait a few minutes and try again.');
      await app.click('[data-resend]');
      assert.equal(app.text('[data-status]'), 'Too many attempts. Wait a few minutes and try again.');
      assert.ok(app.find('[data-status]').classList.contains('is-error'));
      assert.equal(app.find('[data-resend]').disabled, false, 'no cooldown after a failure');
    });

    it('tells the person when they are signed in but the account never arrived, instead of waiting forever', async () => {
      const api = guest();
      timing.signInWaitMs = 30;
      api.onAuthChange = () => () => {}; // the store never hears about the new session
      app = await mountApp({ api, path: '/app/login' });
      await app.submit('[data-auth-form]', MEMBER);
      await until(() => /could not be loaded/.test(app.text('#auth-form-error')), 'the explanation');
      assert.match(app.text('#auth-form-error'), /Reload the page to continue/);
      assert.equal(app.path, '/app/login');
      assert.equal(app.find('[type="submit"]').disabled, false);
    });
  });

  describe('auth error links', () => {
    it('parses what Supabase puts in the address of a failed email link', () => {
      const expired = parseAuthError('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
      assert.equal(expired.code, 'otp_expired');
      assert.match(expired.message, /expired or has already been used/);
      assert.match(parseAuthError('', '?error=access_denied').message, /could not be used/);
      assert.equal(parseAuthError('#error_description=Something+odd').message, 'Something odd.');
      assert.equal(parseAuthError('#access_token=abc&type=recovery'), null);
      assert.equal(parseAuthError('', ''), null);
      assert.match(parseAuthError('#error=server_error').message, /could not complete/);
    });

    it('strips control characters and caps the length of what it keeps', () => {
      const found = parseAuthError(`#error=x&error_description=${encodeURIComponent(`a\u0000b\n${'z'.repeat(500)}`)}`);
      assert.ok(found.message.length <= 202);
      assert.ok(!/[\u0000-\u001f]/.test(found.message));
    });

    it('stashes an error for this tab, reads it once, and drops stale or malformed values', () => {
      const store = new Map();
      const storage = { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
      assert.equal(stashAuthError({ code: 'otp_expired', message: 'Link expired.' }, { storage, now: 1000 }), true);
      assert.deepEqual(takeAuthError({ storage, now: 2000 }), { code: 'otp_expired', message: 'Link expired.' });
      assert.equal(takeAuthError({ storage, now: 2000 }), null, 'read once');
      stashAuthError({ code: 'x', message: 'Old.' }, { storage, now: 0 });
      assert.equal(takeAuthError({ storage, now: 11 * 60 * 1000 }), null, 'older than ten minutes');
      store.set(AUTH_ERROR_KEY, '{not json');
      assert.equal(takeAuthError({ storage }), null);
      store.set(AUTH_ERROR_KEY, JSON.stringify({ message: 42, at: Date.now() }));
      assert.equal(takeAuthError({ storage }), null);
      store.set(AUTH_ERROR_KEY, JSON.stringify({ message: 'From the future.', at: Date.now() + 10 * 60 * 1000 }));
      assert.equal(takeAuthError({ storage }), null);
      assert.equal(stashAuthError(null, { storage }), false);
      assert.equal(stashAuthError({ message: 'x' }, { storage: { setItem() { throw new Error('full'); } } }), false);
    });

    it('shows a stashed error once on the sign-in page, as text, with a way to request a new link', async () => {
      stashAuthError({ code: 'otp_expired', message: `The link ${HOSTILE} expired.` });
      app = await mountApp({ api: guest(), path: '/app/login' });
      assert.match(app.text('.auth-notice'), /The link <img src=x onerror=alert\(1\)> expired\./);
      assert.equal(app.exists('.auth-notice img'), false);
      assert.equal(app.find('.auth-notice').getAttribute('role'), 'alert');
      assert.equal(app.find('.auth-notice a').getAttribute('href'), '/app/forgot');
      assert.equal(sessionStorage.getItem(AUTH_ERROR_KEY), null, 'consumed');
      await app.navigate('/app/signup');
      assert.equal(app.exists('.auth-notice'), false, 'shown once');
    });

    it('shows it on the forgot page too, without a link to itself', async () => {
      stashAuthError({ code: 'otp_expired', message: 'That email link has expired.' });
      app = await mountApp({ api: guest(), path: '/app/forgot' });
      assert.match(app.text('.auth-notice'), /has expired/);
      assert.equal(app.exists('.auth-notice a'), false);
    });
  });

  describe('sign up', () => {
    it('explains early access and asks for name, email and password', async () => {
      app = await mountApp({ api: guest(), path: '/app/signup' });
      assert.equal(app.document.title, 'Create your account — REFLUENZ');
      assert.equal(app.text('#view h1'), 'Find your circle.');
      assert.match(app.text('.auth-lede'), /Joining is free during early access and nothing is charged/);
      assert.equal(app.find('#auth-name').getAttribute('autocomplete'), 'name');
      assert.equal(app.find('#auth-password').getAttribute('autocomplete'), 'new-password');
      assert.match(app.text('#auth-password-help'), /At least 8 characters/);
      assert.equal(app.find('.auth-links a').getAttribute('href'), '/app/login');
      assert.match(app.text('[type="submit"]'), /Create free account/);
    });

    it('validates name, address and password length', async () => {
      const api = guest();
      app = await mountApp({ api, path: '/app/signup' });
      await app.submit('[data-auth-form]', { name: '', email: '', password: '' });
      assert.equal(app.text('#auth-name-error'), 'Enter your name.');
      assert.equal(app.text('#auth-email-error'), 'Enter your email address.');
      assert.equal(app.text('#auth-password-error'), 'Choose a password.');
      assert.equal(app.document.activeElement?.id, 'auth-name');
      await app.submit('[data-auth-form]', { name: 'Ada', email: 'ada@example.test', password: 'short' });
      assert.equal(app.text('#auth-password-error'), 'Use at least 8 characters.');
      assert.equal(app.exists('#auth-name-error:not([hidden])'), false, 'only the real problems are shown');
      await app.submit('[data-auth-form]', { name: 'x'.repeat(61), email: 'ada@example.test', password: 'long-enough-1' });
      assert.match(app.text('#auth-name-error'), /at most 60/);
      assert.equal(callsOf(api, 'signUp').length, 0);
    });

    it('moves to "check your email" after sign-up, with the address, a resend button and a cooldown', async () => {
      const api = guest();
      timing.cooldownMs = 80;
      app = await mountApp({ api, path: '/app/signup' });
      await app.submit('[data-auth-form]', { name: 'Ada Lovelace', email: 'ada@example.test', password: 'long-enough-1' });
      assert.deepEqual(callsOf(api, 'signUp')[0].args, ['ada@example.test', 'long-enough-1', 'Ada Lovelace']);
      assert.equal(app.text('#view h1'), 'Check your email.');
      assert.equal(app.document.title, 'Check your email — REFLUENZ');
      assert.equal(app.document.activeElement?.id, 'auth-title', 'focus moves to the new heading');
      assert.equal(app.text('.auth-address'), 'ada@example.test');
      assert.equal(app.exists('[data-auth-form]'), false);
      const resend = app.find('[data-resend]');
      assert.equal(resend.disabled, true);
      assert.match(resend.textContent, /Resend in \d s/);
      assert.equal(app.store.state.user, null, 'not signed in before the link is opened');
      await tick(160);
      assert.equal(resend.disabled, false);
      assert.equal(resend.textContent.trim(), 'Resend email');
      await app.click(resend);
      assert.deepEqual(callsOf(api, 'resendConfirmation')[0].args, ['ada@example.test']);
      assert.match(app.text('[data-status]'), /We sent another email to ada@example\.test/);
      assert.equal(app.find('[data-resend]').disabled, true, 'a new cooldown');
    });

    it('lets the person go back and correct the address, keeping what they typed', async () => {
      app = await mountApp({ api: guest(), path: '/app/signup' });
      await app.submit('[data-auth-form]', { name: 'Ada', email: 'ada@example.tset', password: 'long-enough-1' });
      await app.click('[data-use-other]');
      assert.ok(app.exists('[data-auth-form]'));
      assert.equal(app.find('#auth-name').value, 'Ada');
      assert.equal(app.find('#auth-email').value, 'ada@example.tset');
      assert.equal(app.find('#auth-password').value, '', 'the password is never kept');
      assert.equal(app.document.activeElement?.id, 'auth-email');
    });

    it('renders hostile names and addresses as text', async () => {
      app = await mountApp({ api: guest(), path: '/app/signup' });
      await app.submit('[data-auth-form]', { name: HOSTILE, email: '<b>@example.test', password: 'long-enough-1' });
      assert.equal(app.text('.auth-address'), '<b>@example.test');
      assert.equal(app.exists('.auth-address b'), false);
      assert.equal(app.exists('#view img[src="x"]'), false);
    });

    it('signs straight in when no confirmation is needed and goes through the welcome tour first', async () => {
      const api = guest({ confirmEmail: false });
      app = await mountApp({ api, path: '/app/signup?next=/app/discover' });
      await app.submit('[data-auth-form]', { name: 'Ada', email: 'ada@example.test', password: 'long-enough-1' });
      await until(() => app.path.startsWith('/app/welcome'), 'the welcome tour');
      assert.equal(app.path, '/app/welcome?next=%2Fapp%2Fdiscover');
      assert.match(app.text('#toast'), /Your account is ready/);
    });

    it('turns "already registered" into a way to sign in with the same address', async () => {
      const api = guest();
      app = await mountApp({ api, path: '/app/signup?next=/app/discover' });
      await app.submit('[data-auth-form]', { name: 'Sofia', email: MEMBER.email, password: 'long-enough-1' });
      assert.match(app.text('#auth-form-error'), /already exists/);
      assert.equal(app.document.activeElement?.id, 'auth-email');
      await app.click('[data-sign-in-with]');
      assert.equal(app.path, '/app/login?next=%2Fapp%2Fdiscover');
      assert.equal(app.find('#auth-email').value, MEMBER.email, 'the address is carried over (in memory, never in the URL)');
      assert.ok(!app.path.includes('example'));
    });

    it('keeps everything typed when sign-up fails and offers a retry', async () => {
      const api = guest();
      api.fail('signUp', 'Too many attempts. Wait a few minutes and try again.');
      app = await mountApp({ api, path: '/app/signup' });
      await app.submit('[data-auth-form]', { name: 'Ada', email: 'ada@example.test', password: 'long-enough-1' });
      assert.equal(app.text('#auth-form-error'), 'Too many attempts. Wait a few minutes and try again.');
      assert.equal(app.find('#auth-name').value, 'Ada');
      assert.equal(app.find('#auth-email').value, 'ada@example.test');
      assert.equal(app.find('[type="submit"]').disabled, false);
      api.fail('signUp', null);
      await app.submit('[data-auth-form]', { password: 'long-enough-1' });
      assert.equal(app.text('#view h1'), 'Check your email.');
    });

    it('carries the address from sign in to the next auth page', async () => {
      app = await mountApp({ api: guest(), path: '/app/login' });
      app.find('#auth-email').value = 'carry@example.test';
      await app.click('a[href="/app/forgot"]');
      assert.equal(app.path, '/app/forgot');
      assert.equal(app.find('#auth-email').value, 'carry@example.test');
    });
  });

  describe('forgotten password', () => {
    it('asks only for the address', async () => {
      app = await mountApp({ api: guest(), path: '/app/forgot' });
      assert.equal(app.text('#view h1'), 'Reset your password.');
      assert.equal(app.exists('#auth-password'), false);
      assert.equal(app.find('a[href="/app/login"]').textContent, 'Back to sign in');
      assert.match(app.text('[type="submit"]'), /Send reset link/);
    });

    it('validates the address', async () => {
      const api = guest();
      app = await mountApp({ api, path: '/app/forgot' });
      await app.submit('[data-auth-form]', { email: 'nope' });
      assert.match(app.text('#auth-email-error'), /valid email/);
      assert.equal(callsOf(api, 'resetPassword').length, 0);
    });

    it('sends the link, confirms without revealing whether the account exists, and can send it again', async () => {
      const api = guest();
      timing.cooldownMs = 40;
      app = await mountApp({ api, path: '/app/forgot' });
      await app.submit('[data-auth-form]', { email: 'nobody@example.test' });
      assert.deepEqual(callsOf(api, 'resetPassword')[0].args, ['nobody@example.test']);
      assert.equal(app.text('#view h1'), 'Check your email.');
      assert.match(app.text('.auth-lede'), /If an account exists for this address/);
      assert.equal(app.text('.auth-address'), 'nobody@example.test');
      await tick(100);
      await app.click('[data-resend]');
      assert.equal(callsOf(api, 'resetPassword').length, 2, 'resend uses the reset email, not the confirmation email');
      assert.equal(callsOf(api, 'resendConfirmation').length, 0);
      assert.equal(app.find('.auth-links a').getAttribute('href'), '/app/login');
    });

    it('shows a failure in place', async () => {
      const api = guest();
      api.fail('resetPassword', 'Too many attempts. Wait a few minutes and try again.');
      app = await mountApp({ api, path: '/app/forgot' });
      await app.submit('[data-auth-form]', { email: 'ada@example.test' });
      assert.equal(app.text('#auth-form-error'), 'Too many attempts. Wait a few minutes and try again.');
      assert.equal(app.find('#auth-email').value, 'ada@example.test');
    });
  });

  describe('new password after a recovery link', () => {
    const recoveryApi = () => createFakeApi({ signedIn: IDS.member });

    it('sends a visitor without a recovery link to the forgot page', async () => {
      app = await mountApp({ api: guest(), path: '/app/reset' });
      assert.equal(app.path, '/app/forgot');
    });

    it('asks twice for the new password and checks both', async () => {
      const api = recoveryApi();
      app = await mountApp({ api, path: '/app/reset', recovery: true });
      assert.equal(app.path, '/app/reset');
      assert.equal(app.text('#view h1'), 'Choose a new password.');
      assert.equal(app.find('#auth-password').getAttribute('autocomplete'), 'new-password');
      assert.equal(app.find('#auth-confirm').getAttribute('autocomplete'), 'new-password');
      await app.submit('[data-auth-form]', { password: '', confirm: '' });
      assert.equal(app.text('#auth-password-error'), 'Choose a new password.');
      await app.submit('[data-auth-form]', { password: 'short', confirm: 'short' });
      assert.equal(app.text('#auth-password-error'), 'Use at least 8 characters.');
      await app.submit('[data-auth-form]', { password: 'long-enough-1', confirm: '' });
      assert.equal(app.text('#auth-confirm-error'), 'Type the new password again.');
      await app.submit('[data-auth-form]', { password: 'long-enough-1', confirm: 'long-enough-2' });
      assert.equal(app.text('#auth-confirm-error'), 'The two passwords do not match.');
      assert.equal(callsOf(api, 'updatePassword').length, 0);
    });

    it('saves the password, ends the recovery state and continues into the app', async () => {
      const api = recoveryApi();
      app = await mountApp({ api, path: '/app/reset', recovery: true });
      assert.equal(app.store.state.recovery, true);
      await app.submit('[data-auth-form]', { password: 'long-enough-1', confirm: 'long-enough-1' });
      await until(() => app.path === '/app', 'the home page');
      assert.deepEqual(callsOf(api, 'updatePassword')[0].args, ['long-enough-1']);
      assert.equal(app.store.state.recovery, false);
      assert.match(app.text('#toast'), /Your password is updated/);
      assert.equal(app.store.state.user.email, MEMBER.email, 'still signed in');
    });

    it('arrives from a PASSWORD_RECOVERY event', async () => {
      const api = guest();
      app = await mountApp({ api, path: '/app' });
      api.signInAs(IDS.member, 'PASSWORD_RECOVERY');
      await until(() => app.path === '/app/reset', 'the reset page');
      assert.equal(app.text('#view h1'), 'Choose a new password.');
    });

    it('explains an expired link and offers a new one, keeping the page', async () => {
      const api = recoveryApi();
      api.fail('updatePassword', 'Your session has expired or you do not have permission. Sign in again and retry.');
      app = await mountApp({ api, path: '/app/reset', recovery: true });
      await app.submit('[data-auth-form]', { password: 'long-enough-1', confirm: 'long-enough-1' });
      assert.match(app.text('#auth-form-error'), /Sign in again/);
      assert.equal(app.find('[data-extra] a').getAttribute('href'), '/app/forgot');
      assert.equal(app.store.state.recovery, true);
      assert.equal(app.path, '/app/reset');
    });

    it('lets the person skip choosing a password', async () => {
      app = await mountApp({ api: recoveryApi(), path: '/app/reset', recovery: true });
      await app.click('[data-skip-reset]');
      await until(() => app.path === '/app');
      assert.equal(app.store.state.recovery, false);
    });
  });

  describe('signed-in visitors', () => {
    it('are sent away from the guest pages', async () => {
      app = await mountApp({ api: createFakeApi(), path: '/app/login' });
      assert.equal(app.path, '/app');
      await app.navigate('/app/signup?next=/app/discover');
      assert.equal(app.path, '/app/discover');
    });
  });
});

describe('not found (views/not-found.js)', () => {
  let app = null;
  before(() => installDom());
  after(async () => { await uninstallDom(); });
  afterEach(async () => { await app?.destroy(); app = null; });

  it('says what happened and offers a way home and to Discover (guest)', async () => {
    app = await mountApp({ api: guest(), path: '/app/no-such-page' });
    assert.equal(app.document.title, 'Page not found — REFLUENZ');
    assert.equal(app.text('#view h1'), 'This page is not here.');
    assert.match(app.text('.not-found'), /We looked for \/app\/no-such-page/);
    assert.equal(app.find('.not-found-actions a[href="/app"]').textContent.trim(), 'Back to home');
    assert.equal(app.find('.not-found-actions a[href="/app/discover"]').textContent.trim(), 'Discover creators');
    assert.ok(app.exists('.not-found-links a[href="/app/signup"]'));
    assert.ok(app.exists('.not-found-links a[href="/app/login"]'));
    assert.equal(app.find('.not-found').getAttribute('aria-labelledby'), 'not-found-title');
    assert.equal(app.find('.not-found-links').getAttribute('aria-label'), 'More places to go');
  });

  it('offers the library and memberships to a member', async () => {
    app = await mountApp({ api: createFakeApi(), path: '/app/studio/nothing/here' });
    assert.ok(app.exists('.not-found-links a[href="/app/library"]'));
    assert.ok(app.exists('.not-found-links a[href="/app/memberships"]'));
    assert.equal(app.exists('.not-found-links a[href="/app/signup"]'), false);
  });

  it('renders a hostile address as text and shortens a very long one', async () => {
    app = await mountApp({ api: guest(), path: `/app/${encodeURIComponent(HOSTILE)}` });
    assert.equal(app.exists('#view img'), false);
    assert.ok(app.text('.not-found-path').includes('%3Cimg'), 'shown as the address it is');
    await app.navigate(`/app/${'a'.repeat(300)}`);
    assert.ok(app.text('.not-found-path').length <= 80);
    assert.ok(app.text('.not-found-path').endsWith('…'));
  });

  it('is reached from a link inside the app and the back button returns', async () => {
    app = await mountApp({ api: guest(), path: '/app' });
    await app.navigate('/app/missing');
    assert.equal(app.text('#view h1'), 'This page is not here.');
    await app.back();
    assert.equal(app.path, '/app');
  });
});

describe('welcome tour (views/onboarding.js)', () => {
  let app = null;
  let api = null;
  before(() => installDom());
  after(async () => { await uninstallDom(); });
  afterEach(async () => {
    await app?.destroy();
    app = null;
    deps.prepareImage = realPrepare;
  });
  const realPrepare = deps.prepareImage;

  // A reader who has not been through the tour and follows nobody yet.
  async function newcomer({ path = '/app/welcome', tweak } = {}) {
    api = createFakeApi({ signedIn: IDS.fan1 });
    api.db.user_settings.find(row => row.user_id === IDS.fan1).onboarded = false;
    api.db.follows.length = 0;
    api.db.memberships.length = 0;
    api.refresh();
    tweak?.(api);
    app = await mountApp({ api, path });
    return app;
  }

  const photo = (name = 'me.png', type = 'image/png') => new File(['pixels'], name, { type });
  async function choose(file) {
    const input = app.find('[data-avatar-input]');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    await until(() => app.exists('[data-clear-avatar]') || /could not|not a supported|is empty/i.test(app.text('#toast')), 'the picture');
  }
  const fakePrepare = async file => ({ kind: 'image', blob: new Blob([await file.text()], { type: file.type }), mime: file.type, name: file.name });

  it('sends a new account to the tour first and back to where it was going afterwards', async () => {
    await newcomer({ path: '/app/discover?q=linen' });
    assert.equal(app.path, '/app/welcome?next=%2Fapp%2Fdiscover%3Fq%3Dlinen');
    await app.click('[data-skip]');
    await until(() => app.path === '/app/discover?q=linen', 'the page they asked for');
    assert.equal(app.store.state.settings.onboarded, true);
  });

  it('needs a signed-in account', async () => {
    app = await mountApp({ api: guest(), path: '/app/welcome' });
    assert.equal(app.path, '/app/login?next=%2Fapp%2Fwelcome');
  });

  it('opens on step one: a heading, progress, the name from the profile and a skip button', async () => {
    await newcomer();
    assert.equal(app.document.title, 'Welcome — REFLUENZ');
    assert.equal(app.text('#view h1'), 'Welcome to REFLUENZ.');
    const steps = [...app.document.querySelectorAll('.steps li')];
    assert.equal(steps.length, 3);
    assert.equal(steps[0].getAttribute('aria-current'), 'step');
    assert.match(steps[0].textContent, /1 of 3/);
    assert.equal(app.find('#onboard-name').value, 'Ada Lindgren');
    assert.equal(app.find('label[for="onboard-name"]').textContent, 'Your name');
    assert.ok(app.find('.shell').classList.contains('shell--focus'));
    assert.match(app.text('[data-skip]'), /Skip for now/);
    assert.ok(app.exists('[data-avatar-input][accept*="image/png"]'));
  });

  it('asks for a name before it goes on, and not for an absurdly long one', async () => {
    await newcomer();
    await app.submit('[data-step-form]', { name: '   ' });
    assert.equal(app.text('#onboard-name-error'), 'Enter your name.');
    assert.equal(app.document.activeElement?.id, 'onboard-name');
    await app.submit('[data-step-form]', { name: 'x'.repeat(70) });
    assert.match(app.text('#onboard-name-error'), /at most 60/);
    assert.equal(callsOf(api, 'saveProfile').length, 0);
    assert.equal(app.text('#view h1'), 'Welcome to REFLUENZ.');
  });

  it('saves a changed name, updates the shell and moves to step two', async () => {
    await newcomer();
    await app.submit('[data-step-form]', { name: 'Fiona Rossi' });
    assert.deepEqual(callsOf(api, 'saveProfile')[0].args, [{ name: 'Fiona Rossi' }]);
    assert.equal(app.store.state.profile.name, 'Fiona Rossi');
    assert.equal(app.text('#view h1'), 'What draws you in?');
    assert.equal(app.document.activeElement?.id, 'onboard-title', 'focus follows to the heading');
    assert.match(app.text('.steps li[aria-current]'), /2 of 3/);
  });

  it('does not save an unchanged name again', async () => {
    await newcomer();
    await app.submit('[data-step-form]', {});
    assert.equal(callsOf(api, 'saveProfile').length, 0);
    assert.equal(app.text('#view h1'), 'What draws you in?');
  });

  it('keeps the typed name and says what failed when saving it fails', async () => {
    await newcomer();
    api.fail('saveProfile', 'Connection problem. Check your internet and try again.');
    await app.submit('[data-step-form]', { name: 'Fiona Rossi' });
    assert.equal(app.text('[data-step-error]'), 'Connection problem. Check your internet and try again.');
    assert.equal(app.find('#onboard-name').value, 'Fiona Rossi');
    assert.equal(app.text('#view h1'), 'Welcome to REFLUENZ.');
    assert.equal(app.find('[type="submit"]').disabled, false);
    api.fail('saveProfile', null);
    await app.submit('[data-step-form]', {});
    assert.equal(app.text('#view h1'), 'What draws you in?');
  });

  it('prepares and uploads a chosen photo, shows it at once, and uploads it with the name', async () => {
    await newcomer();
    deps.prepareImage = fakePrepare;
    await choose(photo());
    assert.ok(app.exists('.avatar-preview img'), 'a preview of the picture');
    assert.equal(app.find('[data-pick-avatar]').textContent.trim(), 'Choose another photo');
    await app.submit('[data-step-form]', {});
    assert.equal(callsOf(api, 'uploadAvatar').length, 1);
    assert.equal(callsOf(api, 'uploadAvatar')[0].args[0].type, 'image/png');
    assert.ok(app.store.state.profile.avatarUrl, 'the shell has the new picture');
    assert.equal(app.text('#view h1'), 'What draws you in?');
  });

  it('removes a chosen photo before it is uploaded', async () => {
    await newcomer();
    deps.prepareImage = fakePrepare;
    await choose(photo());
    await app.click('[data-clear-avatar]');
    assert.equal(app.exists('.avatar-preview img'), false);
    await app.submit('[data-step-form]', {});
    assert.equal(callsOf(api, 'uploadAvatar').length, 0);
  });

  it('refuses a file that is not a picture with a toast and leaves the form alone', async () => {
    await newcomer();
    deps.prepareImage = fakePrepare;
    await choose(photo('notes.txt', 'text/plain'));
    assert.match(app.text('#toast'), /not a supported image/);
    assert.equal(app.exists('[data-clear-avatar]'), false);
  });

  it('says so when a picture cannot be read', async () => {
    await newcomer();
    deps.prepareImage = async () => { throw new Error('That image could not be read. Try a different file.'); };
    await choose(photo());
    assert.match(app.text('#toast'), /could not be read/);
  });

  it('keeps the picture and the name when the upload fails, and retries without saving the name twice', async () => {
    await newcomer();
    deps.prepareImage = fakePrepare;
    await choose(photo());
    api.fail('uploadAvatar', 'This image is too large (5 MB max).');
    await app.submit('[data-step-form]', { name: 'Fiona Rossi' });
    assert.equal(app.text('[data-step-error]'), 'This image is too large (5 MB max).');
    assert.ok(app.exists('.avatar-preview img'), 'the picture is still chosen');
    assert.equal(app.find('#onboard-name').value, 'Fiona Rossi');
    api.fail('uploadAvatar', null);
    await app.submit('[data-step-form]', {});
    assert.equal(callsOf(api, 'saveProfile').length, 1, 'the name was saved once');
    assert.equal(callsOf(api, 'uploadAvatar').length, 2);
    assert.equal(app.text('#view h1'), 'What draws you in?');
  });

  it('disables the button while step one saves', async () => {
    await newcomer();
    const gate = hold(api, 'saveProfile');
    const pending = app.submit('[data-step-form]', { name: 'Fiona Rossi' });
    await tick(5);
    assert.equal(app.find('[type="submit"]').disabled, true);
    app.find('[data-step-form]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(5);
    assert.equal(gate.calls, 1);
    gate.release();
    await pending;
    await until(() => app.text('#view h1') === 'What draws you in?');
  });

  it('offers the subjects as toggle buttons', async () => {
    await newcomer();
    await app.submit('[data-step-form]', {});
    const buttons = [...app.document.querySelectorAll('[data-interest]')];
    assert.ok(buttons.length >= 4);
    assert.ok(buttons.every(control => control.getAttribute('aria-pressed') === 'false'));
    await app.click('[data-interest="Design"]');
    assert.equal(app.find('[data-interest="Design"]').getAttribute('aria-pressed'), 'true');
    await app.click('[data-interest="Design"]');
    assert.equal(app.find('[data-interest="Design"]').getAttribute('aria-pressed'), 'false');
    await app.click('[data-back]');
    assert.equal(app.text('#view h1'), 'Welcome to REFLUENZ.');
  });

  async function toCreators() {
    await app.submit('[data-step-form]', {});
    await app.click('[data-interest="Design"]');
    await app.submit('[data-step-form]');
    await until(() => app.exists('.suggest-row'), 'the suggestions');
  }

  it('lists suggested creators, the ones in the chosen subjects first, and lets the person follow them', async () => {
    await newcomer();
    await toCreators();
    assert.equal(app.text('#view h1'), 'Follow a few creators.');
    assert.match(app.text('.onboard-form'), /Joining a circle is free|Creators in your subjects come first/);
    const rows = [...app.document.querySelectorAll('.suggest-row')];
    assert.equal(rows.length, 3);
    assert.match(rows[0].textContent, /Casa Verano/, 'Design comes first');
    assert.match(rows[0].textContent, /Showcase/);
    assert.equal(app.text('[data-follow-count]'), 'Following is optional. You can always do it later.');
    await app.click(`[data-follow="${IDS.verano}"]`);
    assert.deepEqual(callsOf(api, 'setFollow')[0].args, [IDS.verano, true]);
    assert.equal(app.text('[data-follow-count]'), 'You follow 1 creator.');
    assert.equal(app.find(`[data-follow="${IDS.verano}"]`).getAttribute('aria-pressed'), 'true');
    await app.click(`[data-follow="${IDS.solene}"]`);
    assert.equal(app.text('[data-follow-count]'), 'You follow 2 creators.');
    await app.click(`[data-follow="${IDS.solene}"]`);
    assert.equal(app.text('[data-follow-count]'), 'You follow 1 creator.');
  });

  it('ties each follow button to the creator it belongs to for screen readers', async () => {
    await newcomer();
    await toCreators();
    const control = app.find(`.suggest-row[data-creator="${IDS.verano}"] [data-follow]`);
    const described = control.getAttribute('aria-describedby');
    assert.equal(described, `suggest-${IDS.verano}`);
    assert.match(app.find(`#${described}`).textContent, /Casa Verano/);
  });

  it('shows a skeleton while suggestions load and an error with Retry when they fail', async () => {
    await newcomer({ tweak: fake => fake.fail('suggestedCreators', 'Connection problem. Check your internet and try again.') });
    await app.submit('[data-step-form]', {});
    await app.submit('[data-step-form]');
    await until(() => app.exists('.error-state'), 'the error');
    assert.match(app.text('.error-state'), /We could not load suggestions/);
    assert.match(app.text('.error-state'), /Connection problem/);
    await tick(60);
    assert.equal(callsOf(api, 'suggestedCreators').length, 2, 'the first try while the form was filled in, one more when the last step opened: no retry loop');
    api.fail('suggestedCreators', null);
    await app.click('[data-retry-suggestions]');
    await until(() => app.exists('.suggest-row'), 'the retry');
    assert.equal(app.exists('.error-state'), false);
  });

  it('shows an empty state when there is nobody to suggest', async () => {
    await newcomer({ tweak: fake => { fake.suggestedCreators = async () => []; } });
    await app.submit('[data-step-form]', {});
    await app.submit('[data-step-form]');
    await until(() => app.exists('.empty'), 'the empty state');
    assert.match(app.text('.empty'), /No suggestions yet/);
    assert.match(app.text('.empty'), /Discover/);
  });

  it('escapes hostile creator names', async () => {
    await newcomer({ tweak: fake => { fake.db.creators.find(row => row.id === IDS.verano).name = HOSTILE; } });
    await toCreators();
    assert.equal(app.exists('.suggest-list img[src="x"]'), false);
    assert.ok(app.text('.suggest-list').includes(HOSTILE));
  });

  it('finishes: saves "onboarded", updates the store and goes home', async () => {
    await newcomer();
    await toCreators();
    await app.submit('[data-step-form]');
    await until(() => app.path === '/app', 'the home page');
    assert.deepEqual(callsOf(api, 'saveSettings')[0].args, [{ onboarded: true }]);
    assert.equal(app.store.state.settings.onboarded, true);
    assert.match(app.text('#toast'), /You are all set/);
    assert.equal(app.find('.shell').classList.contains('shell--focus'), false);
  });

  it('stays on the page, with the typed state intact, when finishing fails', async () => {
    await newcomer();
    await toCreators();
    await app.click(`[data-follow="${IDS.verano}"]`);
    api.fail('saveSettings', 'Connection problem. Check your internet and try again.');
    await app.submit('[data-step-form]');
    assert.equal(app.text('[data-step-error]'), 'Connection problem. Check your internet and try again.');
    assert.equal(app.path.split('?')[0], '/app/welcome');
    assert.equal(app.store.state.settings.onboarded, false);
    assert.equal(app.text('[data-follow-count]'), 'You follow 1 creator.');
    assert.equal(app.find('[type="submit"]').disabled, false);
    api.fail('saveSettings', null);
    await app.submit('[data-step-form]');
    await until(() => app.path === '/app');
  });

  it('can be skipped from any step, and skipping is saved too', async () => {
    await newcomer();
    await app.submit('[data-step-form]', {});
    await app.click('[data-skip]');
    await until(() => app.path === '/app');
    assert.deepEqual(callsOf(api, 'saveSettings')[0].args, [{ onboarded: true }]);
  });

  it('reports a failed skip and lets the person try again', async () => {
    await newcomer();
    api.fail('saveSettings', 'Connection problem. Check your internet and try again.');
    await app.click('[data-skip]');
    assert.match(app.text('[data-step-error]'), /Connection problem/);
    assert.equal(app.find('[data-skip]').disabled, false);
    api.fail('saveSettings', null);
    await app.click('[data-skip]');
    await until(() => app.path === '/app');
  });

  it('only follows a next that stays inside the app and is not an auth page', async () => {
    for (const next of ['https://evil.example/', '//evil.example', '/app/login', '/app/welcome', '/app/../x']) {
      await newcomer({ path: `/app/welcome?next=${encodeURIComponent(next)}` });
      await app.click('[data-skip]');
      await until(() => app.path === '/app', `home for ${next}`);
      await app.destroy();
      app = null;
    }
  });

  it('gives every control an accessible name and uses no inline handlers', async () => {
    await newcomer();
    await toCreators();
    for (const control of app.document.querySelectorAll('#view button, #view input:not([type="hidden"])')) {
      const name = control.textContent.trim() || control.getAttribute('aria-label') || (control.id && app.document.querySelector(`label[for="${control.id}"]`)?.textContent);
      assert.ok(name || control.hasAttribute('data-follow'), `a name for ${control.outerHTML.slice(0, 80)}`);
    }
    assert.equal(app.exists('#view [onclick], #view [style*="javascript"]'), false);
  });
});

describe('landing page (index.html, landing.js)', () => {
  const source = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(source)[1].replace(/<script[\s\S]*?<\/script>/gi, '');
  let window = null;
  before(() => { window = installDom(); });
  after(async () => { await uninstallDom(); });
  afterEach(() => { window.localStorage.clear(); });

  const open = () => { window.document.body.innerHTML = body; };
  const session = value => window.localStorage.setItem(SESSION_STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value));

  it('points its calls to action at the new app routes', () => {
    open();
    const hrefs = [...window.document.querySelectorAll('a[href^="/app"]')].map(link => link.getAttribute('href'));
    assert.ok(hrefs.every(href => href !== '/app.html' && !href.startsWith('/app.html')), 'no link to the legacy page');
    const label = text => [...window.document.querySelectorAll('a')].filter(link => link.textContent.trim().startsWith(text)).map(link => link.getAttribute('href'));
    assert.deepEqual(label('Sign in'), ['/app/login']);
    assert.deepEqual(label('Join for free'), ['/app/signup']);
    assert.deepEqual(label('Find your circle'), ['/app/signup']);
    assert.deepEqual(label('Open your studio'), ['/app/studio']);
    assert.deepEqual(label('Try the creator studio'), ['/app/studio']);
    assert.deepEqual(label('Explore the platform'), ['/app']);
  });

  it('does not promise payments or an account-free "preview"', () => {
    assert.ok(!/Pay only for/i.test(source));
    assert.ok(!/No account required/i.test(source));
    assert.ok(!/\bdemo\b/i.test(source));
  });

  it('keeps the inline auth-forwarding script unchanged', () => {
    const inline = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    assert.equal(inline.length, 1);
    assert.match(inline[0], /location\.replace\('\/app\.html'\+q\+h\)/);
  });

  it('shows "Open the app" instead of the sign-in and join links when a session token is stored', () => {
    open();
    session({ access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    const changed = applySignedInCtas(window.document);
    assert.equal(changed, 4);
    const links = [...window.document.querySelectorAll('[data-auth-cta]')];
    assert.ok(links.every(link => link.getAttribute('href') === '/app'));
    assert.ok(links.every(link => link.textContent.trim().startsWith('Open the app')));
    assert.ok(links.every(link => link.textContent.trim() !== 'Sign in'));
    const header = window.document.querySelector('.landing-header nav a.button');
    assert.equal(header.textContent.trim(), 'Open the app', 'the arrow icon span keeps its place');
    assert.ok(header.querySelector('[data-icon="arrow"]'));
    assert.equal(window.document.querySelector('a[href="/app/studio"]').textContent.includes('studio'), true, 'creator links stay');
  });

  it('leaves the page alone for a visitor without a session', () => {
    open();
    assert.equal(applySignedInCtas(window.document), 0);
    assert.equal(window.document.querySelector('.landing-header nav a.button').getAttribute('href'), '/app/login');
  });

  it('recognises only a plausible stored session', () => {
    assert.equal(hasSessionToken(window.localStorage), false);
    session({ access_token: 'a', refresh_token: 'r' });
    assert.equal(hasSessionToken(window.localStorage), true);
    session({ access_token: 'a', expires_at: 1 });
    assert.equal(hasSessionToken(window.localStorage), false, 'an expired token without a refresh token');
    session({ access_token: 'a', expires_at: Math.floor(Date.now() / 1000) + 600 });
    assert.equal(hasSessionToken(window.localStorage), true);
    for (const junk of ['not json', 'null', '"text"', '42', '{}', '{"refresh_token":""}']) {
      session(junk);
      assert.equal(hasSessionToken(window.localStorage), false, junk);
    }
    assert.equal(hasSessionToken({ getItem() { throw new Error('blocked'); } }), false, 'blocked storage');
  });
});
