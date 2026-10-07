import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom, mountApp } from './helpers/dom.mjs';
import { createFakeApi, IDS } from './helpers/fake-api.mjs';
import { landOnAuthError, parseAuthError, stashAuthError, AUTH_ERROR_KEY } from '../src/views/auth/auth-error.js';

// What src/main.js does with an email link that has died, in the order it does it: read the address, keep the error, start the app,
// then let landOnAuthError send a visitor without a session to the sign-in page.
const EXPIRED = '/app.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

describe('an email link that has expired', () => {
  before(() => installDom());
  after(() => uninstallDom());
  let app;
  afterEach(async () => { await app?.destroy(); app = null; globalThis.sessionStorage.removeItem(AUTH_ERROR_KEY); });

  async function openLikeMain(api) {
    const url = new URL(EXPIRED, 'http://localhost');
    const authError = parseAuthError(url.hash, url.search);
    if (authError) stashAuthError(authError);
    app = await mountApp({ api, path: EXPIRED });
    const landed = await landOnAuthError(app, authError);
    await app.settle();
    return { authError, landed };
  }

  it('takes a visitor without a session to the sign-in page, which says what happened and offers a new link', async () => {
    const { authError, landed } = await openLikeMain(createFakeApi({ signedIn: null }));
    assert.equal(authError.code, 'otp_expired');
    assert.equal(landed, true);
    assert.equal(app.path, '/app/login');
    assert.match(app.text('#view'), /expired or has already been used/);
    assert.equal(app.find('#view a[href="/app/forgot"]').textContent.trim(), 'Send me a new link');
  });

  it('shows the message once: the next visit to the sign-in page is clean', async () => {
    await openLikeMain(createFakeApi({ signedIn: null }));
    await app.navigate('/app/signup');
    await app.navigate('/app/login');
    assert.doesNotMatch(app.text('#view'), /expired or has already been used/);
  });

  it('leaves a signed-in visitor where they are and drops the message', async () => {
    const { landed } = await openLikeMain(createFakeApi({ signedIn: IDS.member }));
    assert.equal(landed, false);
    assert.equal(app.path, '/app');
    assert.equal(globalThis.sessionStorage.getItem(AUTH_ERROR_KEY), null);
  });

  it('does nothing when the address carried no error', async () => {
    app = await mountApp({ api: createFakeApi({ signedIn: null }), path: '/app' });
    assert.equal(await landOnAuthError(app, parseAuthError('', '')), false);
    assert.equal(app.path, '/app');
  });
});

describe('Retry buttons of ui.errorState', () => {
  // The click listener belongs to a document: a second window (each test file installs its own) needs its own.
  it('work in every document, not only in the first one that drew an error', async () => {
    const { errorState } = await import('../src/core/ui.js');
    let retried = 0;
    for (let round = 0; round < 2; round++) {
      installDom();
      document.body.innerHTML = String(errorState(new Error('You are offline.'), { retry: () => { retried += 1; } }));
      document.querySelector('[data-retry]').click();
      await uninstallDom();
    }
    assert.equal(retried, 2);
  });
});
