// Account settings (/app/settings) and atelier settings (/app/studio/settings): profile, account, notifications, data,
// the atelier details with its pictures and links, and the three tiers.
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom, mountApp, tick, confirmWith } from '../helpers/dom.mjs';
import { createFakeApi, IDS } from '../helpers/fake-api.mjs';
import { tools } from '../../src/views/settings/tools.js';
import { CATEGORIES } from '../../src/api/util.js';

const HOSTILE = '<img src=x onerror=alert(1)>';
const member = () => createFakeApi();
const owner = () => createFakeApi({ signedIn: IDS.owner });
const guest = () => createFakeApi({ signedIn: null });
const callsTo = (fake, method) => fake.calls.filter(call => call.method === method);
const verne = fake => fake.db.creators.find(row => row.id === IDS.verne);
const tierRow = (fake, id, creator = IDS.verne) => fake.db.creator_tiers.find(row => row.creator_id === creator && row.tier_id === id);
const image = (type = 'image/webp') => new Blob(['pixels'], { type });

describe('settings views', () => {
  before(() => installDom());
  after(() => uninstallDom());

  let app;
  let restore = [];
  const open = async (api, path) => { app = await mountApp({ api, path }); return app; };
  afterEach(async () => {
    for (const undo of restore.splice(0)) undo();
    await app?.destroy();
    app = null;
  });
  const patch = (target, name, value) => {
    const original = target[name];
    target[name] = value;
    restore.push(() => { target[name] = original; });
  };

  const toastText = () => (app.exists('#toast') ? app.text('#toast') : '');
  const dialog = () => (app.exists('#modal') && app.find('#modal').open ? app.find('#modal') : null);
  const fire = async (selector, type) => {
    const control = typeof selector === 'string' ? app.find(selector) : selector;
    control.dispatchEvent(new app.window.Event(type, { bubbles: true, cancelable: true }));
    await app.settle();
    return control;
  };
  const type = async (selector, value) => {
    const control = typeof selector === 'string' ? app.find(selector) : selector;
    control.value = value;
    return fire(control, 'input');
  };
  const choose = async (selector, value) => {
    const control = app.find(selector);
    control.value = value;
    return fire(control, 'change');
  };
  const toggle = async (selector, on) => {
    const control = app.find(selector);
    control.checked = on;
    return fire(control, 'change');
  };
  const press = async (selector, key) => {
    (typeof selector === 'string' ? app.find(selector) : selector).dispatchEvent(new app.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await app.settle();
  };
  const submit = async selector => {
    app.find(selector).dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
    await app.settle();
  };
  const answer = async yes => {
    assert.ok(dialog(), 'a dialog is open');
    await app.click(`#modal [data-confirm="${yes ? 'yes' : 'no'}"]`);
  };
  const pickFile = async (selector, file = new File(['pixels'], 'photo.png', { type: 'image/png' })) => {
    const input = app.find(selector);
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await fire(input, 'change');
    await app.settle();
  };
  // An api method that answers only when the test says so.
  const hold = (fake, method) => {
    const real = fake[method].bind(fake);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    fake[method] = async (...args) => { await gate; return real(...args); };
    return release;
  };
  const labelled = root => {
    for (const control of root.querySelectorAll('input, select, textarea')) {
      if (control.type === 'hidden') continue;
      const named = control.getAttribute('aria-label') || (control.id && root.querySelector(`label[for="${control.id}"]`));
      assert.ok(named, `${control.id || control.name} has a label`);
    }
  };

  // ============================================================================================
  describe('account settings', () => {
    describe('who can open it', () => {
      it('sends a guest to sign in and back', async () => {
        await open(guest(), '/app/settings');
        assert.equal(app.path, '/app/login?next=%2Fapp%2Fsettings');
      });

      it('opens the profile tab for a member, with a heading, tabs and a title', async () => {
        await open(member(), '/app/settings');
        assert.equal(app.document.title, 'Profile settings — REFLUENZ');
        assert.equal(app.text('#view h1'), 'Settings');
        const tabs = [...app.document.querySelectorAll('#view nav.tabs a')];
        assert.deepEqual(tabs.map(tab => tab.textContent.trim()), ['Profile', 'Account', 'Notifications', 'Your data']);
        assert.deepEqual(tabs.map(tab => tab.getAttribute('href')), ['/app/settings?tab=profile', '/app/settings?tab=account', '/app/settings?tab=notifications', '/app/settings?tab=data']);
        assert.equal(app.find('#view nav.tabs').getAttribute('aria-label'), 'Settings sections');
        assert.deepEqual(tabs.filter(tab => tab.getAttribute('aria-current') === 'page').map(tab => tab.textContent.trim()), ['Profile']);
      });

      it('opens the tab named in the address and falls back to the profile for an unknown one', async () => {
        await open(member(), '/app/settings?tab=notifications');
        assert.equal(app.document.title, 'Notification settings — REFLUENZ');
        assert.ok(app.exists('input[data-pref="like"]'));
        await app.navigate('/app/settings?tab=nonsense');
        assert.ok(app.exists('#profile-name'));
        await app.navigate('/app/settings?tab=data');
        assert.equal(app.document.title, 'Your data — REFLUENZ');
        await app.navigate('/app/settings?tab=account');
        assert.equal(app.document.title, 'Account settings — REFLUENZ');
      });

      it('moves between tabs with the links, without a full load', async () => {
        await open(member(), '/app/settings');
        await app.click('#view nav.tabs a[href="/app/settings?tab=account"]');
        assert.equal(app.path, '/app/settings?tab=account');
        assert.ok(app.exists('[data-form="password"]'));
        assert.equal(app.find('#view nav.tabs a[aria-current="page"]').textContent.trim(), 'Account');
      });
    });

    describe('profile', () => {
      it('shows the saved name, bio and website, with labels, a counter and no stray errors', async () => {
        const fake = member();
        fake.db.profiles.find(row => row.id === IDS.member).website = 'https://sofia.example.test';
        await open(fake, '/app/settings');
        assert.equal(app.find('#profile-name').value, 'Sofia Marchetti');
        assert.equal(app.find('#profile-bio').value, 'Reads slowly.');
        assert.equal(app.find('#profile-website').value, 'https://sofia.example.test');
        assert.equal(app.text('[data-counter="profile-bio"]'), '13 / 240');
        labelled(app.find('#view'));
        assert.equal(app.find('#profile-name').getAttribute('autocomplete'), 'name');
        assert.equal(app.find('#profile-name').getAttribute('maxlength'), '60');
        assert.equal(app.find('#profile-bio').getAttribute('maxlength'), '240');
        assert.ok(app.find('#profile-name').getAttribute('aria-describedby').includes('profile-name-error'));
        assert.equal(app.exists('[aria-invalid="true"]'), false);
        const headings = [...app.document.querySelectorAll('#view h2')].map(node => node.textContent.trim());
        assert.deepEqual(headings, ['Photo', 'Details']);
      });

      it('keeps the counter in step with the typing', async () => {
        await open(member(), '/app/settings');
        await type('#profile-bio', 'Slow reader, fast walker.');
        assert.equal(app.text('[data-counter="profile-bio"]'), '25 / 240');
      });

      it('saves the profile: the cleaned values go to the api, the store and the page follow', async () => {
        const fake = member();
        await open(fake, '/app/settings');
        await type('#profile-name', '  Sofia M.  ');
        await type('#profile-bio', 'Reads slowly, writes less.');
        await type('#profile-website', 'sofia.example.test');
        await submit('form[data-form="profile"]');
        assert.deepEqual(callsTo(fake, 'saveProfile').map(call => call.args[0]), [{ name: 'Sofia M.', bio: 'Reads slowly, writes less.', website: 'https://sofia.example.test' }]);
        assert.equal(app.store.state.profile.name, 'Sofia M.');
        assert.equal(app.store.state.profile.website, 'https://sofia.example.test');
        assert.match(toastText(), /Profile saved\./);
        assert.equal(app.find('#profile-name').value, 'Sofia M.');
        assert.equal(fake.db.profiles.find(row => row.id === IDS.member).display_name, 'Sofia M.');
        assert.equal(app.router.block?.() ?? null, null, 'nothing is left to lose');
      });

      it('sends what the form shows even when a browser filled it without an input event', async () => {
        const fake = member();
        await open(fake, '/app/settings');
        app.find('#profile-name').value = 'Filled by a browser';
        await submit('form[data-form="profile"]');
        assert.equal(callsTo(fake, 'saveProfile')[0].args[0].name, 'Filled by a browser');
      });

      it('explains a missing name and does not call the api', async () => {
        const fake = member();
        await open(fake, '/app/settings');
        await type('#profile-name', '   ');
        await submit('form[data-form="profile"]');
        assert.equal(callsTo(fake, 'saveProfile').length, 0);
        assert.match(app.text('#profile-name-error'), /name cannot be empty/i);
        assert.equal(app.find('#profile-name').getAttribute('aria-invalid'), 'true');
        assert.equal(app.document.activeElement.id, 'profile-name', 'focus goes to the field that needs attention');
        await type('#profile-name', 'S');
        assert.equal(app.find('#profile-name').hasAttribute('aria-invalid'), false, 'the mark goes away as the person types');
        assert.equal(app.text('#profile-name-error'), '');
      });

      it('says what is wrong with the website and the bio', async () => {
        const fake = member();
        await open(fake, '/app/settings');
        await type('#profile-website', 'not a web address');
        await type('#profile-bio', 'x'.repeat(241));
        await submit('form[data-form="profile"]');
        assert.equal(callsTo(fake, 'saveProfile').length, 0);
        assert.match(app.text('#profile-website-error'), /web address such as https:\/\/example\.com/);
        assert.match(app.text('#profile-bio-error'), /at most 240 characters/);
        assert.equal(app.document.activeElement.id, 'profile-bio', 'the first wrong field in the page order');
      });

      it('keeps everything typed when the save fails, and tells the person', async () => {
        const fake = member();
        fake.fail('saveProfile', 'Your profile could not be saved right now.');
        await open(fake, '/app/settings');
        await type('#profile-name', 'A better name');
        await type('#profile-bio', 'A longer story');
        await submit('form[data-form="profile"]');
        assert.match(app.text('[data-error="profile"]'), /could not be saved right now/);
        assert.match(toastText(), /could not be saved right now/);
        assert.equal(app.find('#profile-name').value, 'A better name');
        assert.equal(app.find('#profile-bio').value, 'A longer story');
        assert.equal(app.find('form[data-form="profile"] [type="submit"]').disabled, false, 'the button is usable again');
        assert.equal(app.store.state.profile.name, 'Sofia Marchetti', 'the store was not changed');
        fake.fail('saveProfile', null);
        await submit('form[data-form="profile"]');
        assert.equal(app.store.state.profile.name, 'A better name', 'a second try goes through');
        assert.equal(app.text('[data-error="profile"]'), '');
      });

      it('disables the button while the save runs', async () => {
        const fake = member();
        const release = hold(fake, 'saveProfile');
        await open(fake, '/app/settings');
        await type('#profile-name', 'Someone');
        await submit('form[data-form="profile"]');
        const button = app.find('form[data-form="profile"] [type="submit"]');
        assert.equal(button.disabled, true);
        assert.equal(button.getAttribute('aria-busy'), 'true');
        release();
        await app.settle();
        assert.equal(app.find('form[data-form="profile"] [type="submit"]').disabled, false);
      });

      it('asks before leaving with unsaved profile changes, and not after saving', async () => {
        const fake = member();
        await open(fake, '/app/settings');
        assert.equal(app.router.block(), null);
        await type('#profile-name', 'Changed');
        assert.match(app.router.block(), /unsaved changes to your profile/);
        const asked = confirmWith(false);
        await app.navigate('/app/library');
        assert.equal(app.path, '/app/settings', 'staying put when the person says no');
        assert.equal(asked.length, 1);
        confirmWith(true);
        await submit('form[data-form="profile"]');
        assert.equal(app.router.block(), null);
        await app.navigate('/app/library');
        assert.equal(app.path, '/app/library');
      });

      it('shows names with markup as text, in the form and in the menu', async () => {
        const fake = member();
        fake.db.profiles.find(row => row.id === IDS.member).display_name = HOSTILE;
        await open(fake, '/app/settings');
        assert.equal(app.find('#profile-name').value, HOSTILE);
        assert.equal(app.document.querySelectorAll('#view img[src="x"]').length, 0);
        assert.equal(app.document.querySelectorAll('img[onerror]').length, 0);
      });

      describe('photo', () => {
        it('offers to choose a photo, and shows initials until there is one', async () => {
          await open(member(), '/app/settings');
          assert.match(app.text('[data-action="pick-avatar"]'), /Choose a photo/);
          assert.equal(app.exists('[data-action="remove-avatar"]'), false);
          assert.equal(app.find('.photo-preview .avatar').textContent.trim(), 'SM');
          assert.equal(app.find('#avatar-file').getAttribute('aria-label'), 'Choose a photo');
          assert.match(app.find('#avatar-file').getAttribute('accept'), /image\/webp/);
        });

        it('shows the cropped picture as a preview, and uploads it only when saved', async () => {
          const fake = member();
          const cropped = image();
          const seen = [];
          patch(tools, 'cropImage', async (file, options) => { seen.push([file.name, options]); return cropped; });
          await open(fake, '/app/settings');
          await pickFile('#avatar-file');
          assert.deepEqual(seen, [['photo.png', { aspect: 1, width: 512 }]]);
          assert.equal(callsTo(fake, 'uploadAvatar').length, 0, 'nothing is sent before the person agrees');
          assert.ok(app.exists('.photo-preview img'), 'the staged picture is shown');
          assert.match(app.text('.photo-actions'), /how your photo will look/);
          assert.ok(app.exists('[data-action="save-avatar"]'));
          assert.match(app.router.block(), /unsaved changes/, 'a picture waiting to be saved counts as unsaved');
          await app.click('[data-action="save-avatar"]');
          const [call] = callsTo(fake, 'uploadAvatar');
          assert.equal(call.args[0], cropped);
          assert.ok(app.store.state.profile.avatarUrl, 'the store has the new picture');
          assert.match(toastText(), /Photo updated/);
          assert.match(app.text('[data-action="pick-avatar"]'), /Change photo/);
          assert.ok(app.exists('[data-action="remove-avatar"]'));
          assert.equal(app.router.block(), null);
        });

        it('lets the person drop a chosen picture', async () => {
          const fake = member();
          patch(tools, 'cropImage', async () => image());
          await open(fake, '/app/settings');
          await pickFile('#avatar-file');
          await app.click('[data-action="discard-avatar"]');
          assert.equal(callsTo(fake, 'uploadAvatar').length, 0);
          assert.equal(app.exists('[data-action="save-avatar"]'), false);
          assert.match(app.text('[data-action="pick-avatar"]'), /Choose a photo/);
          assert.equal(app.router.block(), null);
        });

        it('explains a file that cannot be read', async () => {
          const fake = member();
          patch(tools, 'cropImage', async () => { throw Error('This image could not be read. Try a JPG, PNG or WebP file.'); });
          await open(fake, '/app/settings');
          await pickFile('#avatar-file', new File(['x'], 'notes.txt', { type: 'text/plain' }));
          assert.match(app.text('[data-error="avatar"]'), /could not be read/);
          assert.equal(app.exists('[data-action="save-avatar"]'), false);
          assert.equal(app.find('[data-action="pick-avatar"]').disabled, false, 'the button is usable again');
        });

        it('keeps the chosen picture when the upload fails', async () => {
          const fake = member();
          fake.fail('uploadAvatar', 'The photo could not be uploaded.');
          patch(tools, 'cropImage', async () => image());
          await open(fake, '/app/settings');
          await pickFile('#avatar-file');
          await app.click('[data-action="save-avatar"]');
          assert.match(app.text('[data-error="avatar"]'), /could not be uploaded/);
          assert.match(toastText(), /could not be uploaded/);
          assert.ok(app.exists('[data-action="save-avatar"]'), 'still staged, so it can be retried');
          assert.equal(app.find('[data-action="save-avatar"]').disabled, false);
          fake.fail('uploadAvatar', null);
          await app.click('[data-action="save-avatar"]');
          assert.match(toastText(), /Photo updated/);
        });

        it('removes the photo after asking', async () => {
          const fake = member();
          fake.db.profiles.find(row => row.id === IDS.member).avatar_path = `${IDS.member}/a0000000-0000-4000-8000-000000000001.webp`;
          await open(fake, '/app/settings');
          assert.ok(app.store.state.profile.avatarUrl);
          await app.click('[data-action="remove-avatar"]');
          await answer(false);
          assert.equal(callsTo(fake, 'removeAvatar').length, 0, 'saying no changes nothing');
          await app.click('[data-action="remove-avatar"]');
          await answer(true);
          assert.equal(callsTo(fake, 'removeAvatar').length, 1);
          assert.equal(app.store.state.profile.avatarUrl, null);
          assert.match(toastText(), /Photo removed/);
          assert.equal(app.exists('[data-action="remove-avatar"]'), false);
        });

        it('reports a photo that could not be removed', async () => {
          const fake = member();
          fake.db.profiles.find(row => row.id === IDS.member).avatar_path = `${IDS.member}/a0000000-0000-4000-8000-000000000001.webp`;
          fake.fail('removeAvatar', 'The photo could not be removed.');
          await open(fake, '/app/settings');
          await app.click('[data-action="remove-avatar"]');
          await answer(true);
          assert.match(app.text('[data-error="avatar"]'), /could not be removed/);
          assert.ok(app.store.state.profile.avatarUrl, 'the photo is still there');
        });
      });

      it('points an owner to the settings of the atelier, and a plain member to nothing', async () => {
        await open(owner(), '/app/settings');
        assert.equal(app.find('#atelier-link-title').textContent, 'Your atelier');
        assert.equal(app.find('[href="/app/studio/settings"]').getAttribute('href'), '/app/studio/settings');
        await app.destroy();
        await open(member(), '/app/settings');
        assert.equal(app.exists('#atelier-link-title'), false);
      });
    });

    describe('account', () => {
      it('shows the email the person signs in with', async () => {
        await open(member(), '/app/settings?tab=account');
        assert.match(app.text('[data-form="email"]'), /Signed in as member@example\.test/);
        labelled(app.find('#view'));
        assert.deepEqual([...app.document.querySelectorAll('#view h2')].map(node => node.textContent.trim()), ['Email', 'Password', 'Sign out']);
      });

      it('asks for a confirmation by email when the address changes', async () => {
        const fake = member();
        await open(fake, '/app/settings?tab=account');
        await type('#email-new', 'sofia.new@example.test');
        await submit('form[data-form="email"]');
        assert.deepEqual(callsTo(fake, 'updateEmail').map(call => call.args), [['sofia.new@example.test']]);
        assert.match(app.text('[data-note="email"]'), /Check your inbox\. We sent a confirmation link to sofia\.new@example\.test/);
        assert.match(toastText(), /Check your inbox to confirm your new email/);
        assert.equal(app.find('#email-new').value, '', 'the field is emptied');
        assert.equal(app.find('form[data-form="email"] [type="submit"]').disabled, false);
      });

      it('refuses an address that is not valid, or that is already the current one', async () => {
        const fake = member();
        await open(fake, '/app/settings?tab=account');
        await type('#email-new', 'nobody');
        await submit('form[data-form="email"]');
        assert.match(app.text('#email-new-error'), /valid email address/);
        assert.equal(app.document.activeElement.id, 'email-new');
        await type('#email-new', 'MEMBER@example.test');
        await submit('form[data-form="email"]');
        assert.match(app.text('#email-new-error'), /already your email address/);
        assert.equal(callsTo(fake, 'updateEmail').length, 0);
      });

      it('tells the person when the change failed and keeps what they typed', async () => {
        const fake = member();
        fake.fail('updateEmail', 'Too many attempts. Wait a few minutes and try again.');
        await open(fake, '/app/settings?tab=account');
        await type('#email-new', 'sofia.new@example.test');
        await submit('form[data-form="email"]');
        assert.match(app.text('[data-error="email"]'), /Too many attempts/);
        assert.equal(app.find('#email-new').value, 'sofia.new@example.test');
        assert.equal(app.text('[data-note="email"]'), '');
      });

      it('updates the password for the current session', async () => {
        const fake = member();
        await open(fake, '/app/settings?tab=account');
        await type('#password-new', 'a-better-secret');
        await type('#password-confirm', 'a-better-secret');
        await submit('form[data-form="password"]');
        assert.deepEqual(callsTo(fake, 'updatePassword').map(call => call.args), [['a-better-secret']]);
        assert.match(app.text('[data-note="password"]'), /Your password was updated/);
        assert.match(toastText(), /Password updated/);
        assert.equal(app.find('#password-new').value, '');
        assert.equal(app.find('#password-confirm').value, '');
        assert.equal(app.find('#password-new').getAttribute('autocomplete'), 'new-password');
        assert.equal(app.find('#password-new').type, 'password');
      });

      it('wants at least 8 characters and the same password twice', async () => {
        const fake = member();
        await open(fake, '/app/settings?tab=account');
        await type('#password-new', 'short');
        await type('#password-confirm', 'short');
        await submit('form[data-form="password"]');
        assert.match(app.text('#password-new-error'), /at least 8 characters/);
        await type('#password-new', 'long-enough-1');
        await type('#password-confirm', 'long-enough-2');
        await submit('form[data-form="password"]');
        assert.equal(app.text('#password-new-error'), '');
        assert.match(app.text('#password-confirm-error'), /do not match/);
        assert.equal(app.document.activeElement.id, 'password-confirm');
        assert.equal(callsTo(fake, 'updatePassword').length, 0);
      });

      it('reports a password the server did not accept, without clearing the fields', async () => {
        const fake = member();
        fake.fail('updatePassword', 'Your session has expired or you do not have permission. Sign in again and retry.');
        await open(fake, '/app/settings?tab=account');
        await type('#password-new', 'long-enough-1');
        await type('#password-confirm', 'long-enough-1');
        await submit('form[data-form="password"]');
        assert.match(app.text('[data-error="password"]'), /Sign in again/);
        assert.equal(app.find('#password-new').value, 'long-enough-1');
      });

      it('explains why to sign out on a shared computer, and signs out', async () => {
        const fake = member();
        await open(fake, '/app/settings?tab=account');
        assert.match(app.text('#view'), /shared or public computer/);
        await app.click('#view [data-action="sign-out"]');
        assert.equal(callsTo(fake, 'signOut').length, 1);
        assert.equal(fake.session, null);
        assert.equal(app.store.state.user, null);
        assert.equal(app.path, '/app');
      });
    });

    describe('notifications', () => {
      const PREFS = ['new_entry', 'reply', 'message', 'note', 'comment', 'like', 'follow', 'membership'];

      it('offers the eight kinds of notification and the card size, each as a labelled switch', async () => {
        await open(member(), '/app/settings?tab=notifications');
        const switches = [...app.document.querySelectorAll('#view input[role="switch"]')];
        assert.equal(switches.length, 9);
        assert.deepEqual(switches.filter(control => control.dataset.pref).map(control => control.dataset.pref), PREFS);
        labelled(app.find('#view'));
        for (const control of switches) assert.ok(control.getAttribute('aria-describedby'), 'every switch has its explanation');
        assert.ok(switches.every(control => control.checked === (control.dataset.setting === 'compact' ? false : true)));
        assert.deepEqual([...app.document.querySelectorAll('#view h2')].map(node => node.textContent.trim()), ['Reading', 'As a reader', 'As a creator']);
        assert.ok(app.exists('.switch-status[role="status"]'));
      });

      it('shows what is saved', async () => {
        const fake = member();
        const row = fake.db.user_settings.find(item => item.user_id === IDS.member);
        row.notify_prefs.like = false;
        row.compact = true;
        await open(fake, '/app/settings?tab=notifications');
        assert.equal(app.find('#pref-like').checked, false);
        assert.equal(app.find('#pref-comment').checked, true);
        assert.equal(app.find('#setting-compact').checked, true);
      });

      it('saves a switch as soon as it is moved and updates the store', async () => {
        const fake = member();
        await open(fake, '/app/settings?tab=notifications');
        await toggle('#pref-like', false);
        assert.deepEqual(callsTo(fake, 'saveSettings').map(call => call.args[0]), [{ notifyPrefs: { like: false } }]);
        assert.equal(app.store.state.settings.notifyPrefs.like, false);
        assert.equal(app.store.state.settings.notifyPrefs.comment, true, 'the others are untouched');
        assert.equal(app.text('#pref-like-status'), 'Saved');
        assert.equal(app.find('#pref-like').disabled, false);
        assert.equal(fake.db.user_settings.find(item => item.user_id === IDS.member).notify_prefs.like, false);
        await toggle('#pref-like', true);
        assert.equal(app.store.state.settings.notifyPrefs.like, true);
      });

      it('saves the card size', async () => {
        const fake = member();
        await open(fake, '/app/settings?tab=notifications');
        await toggle('#setting-compact', true);
        assert.deepEqual(callsTo(fake, 'saveSettings').map(call => call.args[0]), [{ compact: true }]);
        assert.equal(app.store.state.settings.compact, true);
      });

      it('puts the switch back and says so when the save fails', async () => {
        const fake = member();
        fake.fail('saveSettings', 'We could not reach REFLUENZ. Check your connection and try again.');
        await open(fake, '/app/settings?tab=notifications');
        await toggle('#pref-follow', false);
        assert.equal(app.find('#pref-follow').checked, true, 'back to what is saved');
        assert.match(toastText(), /could not reach REFLUENZ/);
        assert.equal(app.store.state.settings.notifyPrefs.follow, true);
        assert.equal(app.find('#pref-follow').disabled, false);
      });

      it('disables a switch while its save runs', async () => {
        const fake = member();
        const release = hold(fake, 'saveSettings');
        await open(fake, '/app/settings?tab=notifications');
        await toggle('#pref-note', false);
        assert.equal(app.find('#pref-note').disabled, true);
        release();
        await app.settle();
        assert.equal(app.find('#pref-note').disabled, false);
      });
    });

    describe('your data', () => {
      it('exports everything as one JSON file', async () => {
        const fake = member();
        const saved = [];
        patch(tools, 'saveFile', (blob, name) => saved.push({ blob, name }));
        patch(tools, 'today', () => '2026-10-07');
        await open(fake, '/app/settings?tab=data');
        assert.equal(callsTo(fake, 'exportData').length, 0, 'nothing is prepared before it is asked for');
        await app.click('[data-action="export"]');
        assert.equal(callsTo(fake, 'exportData').length, 1);
        assert.equal(saved.length, 1);
        assert.equal(saved[0].name, 'refluenz-data-2026-10-07.json');
        assert.equal(saved[0].blob.type, 'application/json');
        const copy = JSON.parse(await saved[0].blob.text());
        assert.equal(copy.account.email, 'member@example.test');
        assert.equal(copy.profile.name, 'Sofia Marchetti');
        assert.match(app.text('[data-note="export"]'), /downloaded as refluenz-data-2026-10-07\.json/);
        assert.match(toastText(), /export is ready/);
        assert.equal(app.find('[data-action="export"]').disabled, false);
      });

      it('says when the export could not be prepared, and offers another try', async () => {
        const fake = member();
        const saved = [];
        patch(tools, 'saveFile', (blob, name) => saved.push(name));
        fake.fail('exportData', 'We could not reach REFLUENZ. Check your connection and try again.');
        await open(fake, '/app/settings?tab=data');
        await app.click('[data-action="export"]');
        assert.match(app.text('[data-error="export"]'), /could not reach REFLUENZ/);
        assert.equal(saved.length, 0);
        assert.equal(app.find('[data-action="export"]').disabled, false);
        fake.fail('exportData', null);
        await app.click('[data-action="export"]');
        assert.equal(saved.length, 1);
        assert.equal(app.text('[data-error="export"]'), '');
      });

      it('names what an owner loses, and what a plain member loses', async () => {
        await open(member(), '/app/settings?tab=data');
        assert.doesNotMatch(app.text('#view'), /atelier/i, 'nothing about an atelier for someone without one');
        await app.destroy();
        await open(owner(), '/app/settings?tab=data');
        assert.match(app.text('[aria-labelledby="export-title"]'), /atelier, posts and circle notes/);
        assert.match(app.text('.danger-zone'), /your atelier, every post, draft and uploaded file, and your circle/);
      });

      describe('deleting the account', () => {
        let assigned;
        const openDelete = async api => {
          assigned = [];
          await open(api, '/app/settings?tab=data');
          patch(app.window.location, 'assign', url => { assigned.push(url); });
          await app.click('[data-action="delete-account"]');
        };
        const confirmWord = async word => {
          const input = app.find('#delete-confirm');
          input.value = word;
          await fire(input, 'input');
        };
        const send = async () => {
          app.find('[data-delete-form]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
          await app.settle();
          await tick(5);
        };

        it('lists the consequences and wants the word DELETE typed first', async () => {
          const fake = member();
          await openDelete(fake);
          assert.ok(dialog());
          assert.equal(app.find('#modal-title').textContent, 'Delete your account?');
          const items = [...app.document.querySelectorAll('#modal .consequences li')].map(node => node.textContent.trim());
          assert.deepEqual(items, ['Your profile, picture and settings', 'Your follows, saves, likes, comments and memberships', 'Your messages']);
          assert.match(app.text('#modal'), /cannot be undone/);
          const submitButton = app.find('#modal [type="submit"]');
          assert.equal(submitButton.disabled, true);
          assert.equal(app.document.activeElement.id, 'delete-confirm', 'the keyboard lands on the field');
          await confirmWord('delete');
          assert.equal(submitButton.disabled, true, 'capitals are required');
          await confirmWord('DELET');
          assert.equal(submitButton.disabled, true);
          await confirmWord(' DELETE ');
          assert.equal(submitButton.disabled, false);
          assert.equal(callsTo(fake, 'deleteAccount').length, 0);
        });

        it('also names the atelier of an owner', async () => {
          await openDelete(owner());
          const items = [...app.document.querySelectorAll('#modal .consequences li')].map(node => node.textContent.trim());
          assert.ok(items.some(item => item.includes('Verne & Co')));
          assert.ok(items.includes('Every post, draft, image and film you uploaded'));
          assert.equal(items.length, 6);
        });

        it('escapes an atelier name written as markup', async () => {
          const fake = owner();
          verne(fake).name = HOSTILE;
          await openDelete(fake);
          assert.equal(app.document.querySelectorAll('#modal img').length, 0);
          assert.ok(app.text('#modal .consequences').includes(HOSTILE));
        });

        it('deletes the account, signs out and goes to the landing page', async () => {
          const fake = owner();
          await openDelete(fake);
          await confirmWord('DELETE');
          await send();
          assert.equal(callsTo(fake, 'deleteAccount').length, 1);
          assert.deepEqual(assigned, ['/']);
          assert.equal(app.store.state.user, null);
          assert.equal(fake.db.creators.some(row => row.id === IDS.verne), false, 'the atelier is gone');
          assert.equal(dialog(), null);
        });

        it('does not ask about unsaved changes on the way out', async () => {
          const fake = member();
          await openDelete(fake);
          await confirmWord('DELETE');
          app.router.block = () => 'You have unsaved changes.';
          const asked = confirmWith(false);
          await send();
          assert.deepEqual(assigned, ['/']);
          assert.equal(asked.length, 0, 'the person was not asked');
          assert.equal(app.router.block, null);
        });

        it('keeps the account and shows the reason when the deletion fails', async () => {
          const fake = member();
          fake.fail('deleteAccount', 'Your account could not be deleted. Try again in a moment.');
          await openDelete(fake);
          await confirmWord('DELETE');
          await send();
          assert.match(app.text('#delete-error'), /could not be deleted/);
          assert.ok(dialog(), 'the dialog stays open');
          assert.equal(assigned.length, 0);
          assert.ok(app.store.state.user, 'still signed in');
          const input = app.find('#delete-confirm');
          assert.equal(input.readOnly, false);
          assert.equal(app.find('#modal [type="submit"]').disabled, false);
          fake.fail('deleteAccount', null);
          await send();
          assert.deepEqual(assigned, ['/']);
        });

        it('closes without a trace when the person keeps the account', async () => {
          const fake = member();
          await openDelete(fake);
          await app.click('#modal [data-modal-close]');
          assert.equal(dialog(), null);
          assert.equal(callsTo(fake, 'deleteAccount').length, 0);
        });

        it('says what is missing when the form is sent without the word', async () => {
          const fake = member();
          await openDelete(fake);
          await send();
          assert.match(app.text('#delete-error'), /Type DELETE in capitals/);
          assert.equal(callsTo(fake, 'deleteAccount').length, 0);
        });
      });
    });
  });

  // ============================================================================================
  describe('atelier settings', () => {
    const FORM = 'form[data-form="atelier"]';
    const wait = async (ms = 400) => { await tick(ms); await app.settle(); };
    const slugTyped = async value => { await type('#atelier-slug', value); await wait(); };
    const linkIds = () => [...app.document.querySelectorAll('.link-row')].map(row => row.dataset.link);
    const linkValues = () => [...app.document.querySelectorAll('.link-row')].map(row => [row.querySelector('[data-part="label"]').value, row.querySelector('[data-part="url"]').value]);

    describe('who can open it', () => {
      it('sends a guest to sign in, and a member without an atelier to the studio', async () => {
        await open(guest(), '/app/studio/settings');
        assert.equal(app.path, '/app/login?next=%2Fapp%2Fstudio%2Fsettings');
        await app.destroy();
        await open(member(), '/app/studio/settings');
        assert.equal(app.path, '/app/studio');
      });

      it('opens the atelier tab for the owner, with a heading, tabs and a title', async () => {
        await open(owner(), '/app/studio/settings');
        assert.equal(app.document.title, 'Atelier settings — REFLUENZ');
        assert.equal(app.text('#view h1'), 'Atelier settings');
        assert.match(app.text('#view .eyebrow'), /Verne & Co/);
        const tabs = [...app.document.querySelectorAll('#view nav.tabs a')];
        assert.deepEqual(tabs.map(tab => tab.textContent.trim()), ['Atelier', 'Tiers']);
        assert.deepEqual(tabs.map(tab => tab.getAttribute('href')), ['/app/studio/settings?tab=atelier', '/app/studio/settings?tab=tiers']);
        assert.equal(app.find('#view nav.tabs').getAttribute('aria-label'), 'Atelier settings sections');
        assert.equal(app.find('#view nav.tabs a[aria-current="page"]').textContent.trim(), 'Atelier');
        assert.equal(app.find('#view .page-actions a').getAttribute('href'), '/app/c/verne-and-co');
      });

      it('opens the tab named in the address and falls back to the atelier for an unknown one', async () => {
        await open(owner(), '/app/studio/settings?tab=tiers');
        assert.equal(app.document.title, 'Tier settings — REFLUENZ');
        assert.ok(app.exists('[data-tier-form="premium"]'));
        await app.navigate('/app/studio/settings?tab=nonsense');
        assert.ok(app.exists('#atelier-name'));
        await app.click('#view nav.tabs a[href="/app/studio/settings?tab=tiers"]');
        assert.equal(app.path, '/app/studio/settings?tab=tiers');
        assert.equal(app.find('#view nav.tabs a[aria-current="page"]').textContent.trim(), 'Tiers');
      });
    });

    describe('details', () => {
      it('shows what is saved, with labels, counters and every category', async () => {
        await open(owner(), '/app/studio/settings');
        assert.equal(app.find('#atelier-name').value, 'Verne & Co');
        assert.equal(app.find('#atelier-slug').value, 'verne-and-co');
        assert.equal(app.find('#atelier-category').value, 'Writing');
        assert.equal(app.find('#atelier-descriptor').value, 'Essays on getting started');
        assert.equal(app.find('#atelier-location').value, 'Turin, Italy');
        assert.equal(app.find('#atelier-bio').value, 'Short essays and small rules for writers.');
        assert.equal(app.find('#atelier-image').value, 'ritual');
        assert.deepEqual([...app.find('#atelier-category').options].map(option => option.value), CATEGORIES);
        assert.equal(app.text('[data-counter="atelier-bio"]'), '41 / 400');
        assert.equal(app.find('#atelier-bio').getAttribute('maxlength'), '400');
        assert.equal(app.find('#atelier-name').required, true);
        labelled(app.find('#view'));
        assert.equal(app.exists('[aria-invalid="true"]'), false);
        assert.deepEqual([...app.document.querySelectorAll('#view h2')].map(node => node.textContent.trim()), ['Preview', 'Pictures', 'Details']);
        assert.equal(app.find('[data-dirty-status]').textContent, '');
        assert.equal(app.find('[data-action="discard"]').hidden, true);
      });

      it('saves the cleaned values, leaves the unchanged address out, and updates the store and the page', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        await type('#atelier-name', '  Verne Studio  ');
        await choose('#atelier-category', 'Art');
        await type('#atelier-descriptor', 'Essays and notes');
        await type('#atelier-location', 'Lisbon');
        await type('#atelier-bio', 'A slower kind of writing.');
        await choose('#atelier-image', 'architecture');
        assert.equal(app.find('[data-dirty-status]').textContent, 'You have unsaved changes.');
        assert.match(app.router.block(), /unsaved changes to your atelier/);
        await submit(FORM);
        const [call] = callsTo(fake, 'updateAtelier');
        assert.equal(call.args[0], IDS.verne);
        assert.deepEqual(call.args[1], {
          name: 'Verne Studio', category: 'Art', descriptor: 'Essays and notes', location: 'Lisbon', bio: 'A slower kind of writing.', image: 'architecture',
          links: [{ label: 'Newsletter', url: 'https://example.test/verne' }]
        });
        assert.equal(verne(fake).name, 'Verne Studio');
        assert.equal(app.store.state.myCreator.name, 'Verne Studio');
        assert.match(toastText(), /Atelier saved\./);
        assert.match(app.text('[data-note="atelier"]'), /Your atelier was updated/);
        assert.equal(app.find('#atelier-name').value, 'Verne Studio');
        assert.equal(app.router.block(), null, 'nothing is left to lose');
        assert.equal(app.find('[data-dirty-status]').textContent, '');
        assert.equal(app.find('#atelier-save').disabled, false);
      });

      it('explains what is wrong and does not call the api', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        await type('#atelier-name', ' ');
        await type('#atelier-bio', 'x'.repeat(401));
        await type('#atelier-descriptor', 'y'.repeat(61));
        await submit(FORM);
        assert.equal(callsTo(fake, 'updateAtelier').length, 0);
        assert.match(app.text('#atelier-name-error'), /atelier name/i);
        assert.match(app.text('#atelier-bio-error'), /at most 400 characters/);
        assert.match(app.text('#atelier-descriptor-error'), /at most 60 characters/);
        assert.equal(app.find('#atelier-name').getAttribute('aria-invalid'), 'true');
        assert.equal(app.document.activeElement.id, 'atelier-name', 'focus goes to the first wrong field');
        assert.match(app.text('[data-error="atelier"]'), /Check the highlighted fields/);
        await type('#atelier-name', 'Verne');
        assert.equal(app.find('#atelier-name').hasAttribute('aria-invalid'), false, 'the mark goes away as the person types');
        assert.equal(app.text('#atelier-name-error'), '');
      });

      it('asks for a category when the atelier has none', async () => {
        const fake = owner();
        verne(fake).category = '';
        await open(fake, '/app/studio/settings');
        assert.equal(app.find('#atelier-category').options[0].textContent, 'Choose a category');
        await submit(FORM);
        assert.equal(callsTo(fake, 'updateAtelier').length, 0);
        assert.match(app.text('#atelier-category-error'), /Choose a category/);
      });

      it('keeps everything typed when the save fails, and saves on the second try', async () => {
        const fake = owner();
        fake.fail('updateAtelier', 'Your atelier could not be saved right now.');
        await open(fake, '/app/studio/settings');
        await type('#atelier-name', 'Better name');
        await type('#atelier-bio', 'A longer story');
        await submit(FORM);
        assert.match(app.text('[data-error="atelier"]'), /could not be saved right now/);
        assert.match(toastText(), /could not be saved right now/);
        assert.equal(app.find('#atelier-name').value, 'Better name');
        assert.equal(app.find('#atelier-bio').value, 'A longer story');
        assert.equal(app.find('#atelier-save').disabled, false);
        assert.equal(app.store.state.myCreator.name, 'Verne & Co');
        fake.fail('updateAtelier', null);
        await submit(FORM);
        assert.equal(app.store.state.myCreator.name, 'Better name');
        assert.equal(app.text('[data-error="atelier"]'), '');
      });

      it('disables the button while the save runs, and ignores a second send', async () => {
        const fake = owner();
        const release = hold(fake, 'updateAtelier');
        await open(fake, '/app/studio/settings');
        await type('#atelier-name', 'Someone');
        await submit(FORM);
        await submit(FORM);
        assert.equal(app.find('#atelier-save').disabled, true);
        assert.equal(app.find('#atelier-save').getAttribute('aria-busy'), 'true');
        release();
        await app.settle();
        assert.equal(callsTo(fake, 'updateAtelier').length, 1);
        assert.equal(app.find('#atelier-save').disabled, false);
      });

      it('asks before leaving with unsaved changes, and discards them on request', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        assert.equal(app.router.block(), null);
        await type('#atelier-name', 'Changed');
        const asked = confirmWith(false);
        await app.navigate('/app/library');
        assert.equal(app.path, '/app/studio/settings', 'staying put when the person says no');
        assert.equal(asked.length, 1);
        assert.match(asked[0], /unsaved changes to your atelier/);
        await app.click('[data-action="discard"]');
        await answer(false);
        assert.equal(app.find('#atelier-name').value, 'Changed', 'saying no keeps the text');
        await app.click('[data-action="discard"]');
        await answer(true);
        assert.equal(app.find('#atelier-name').value, 'Verne & Co');
        assert.equal(app.router.block(), null);
        assert.equal(callsTo(fake, 'updateAtelier').length, 0);
        confirmWith(true);
        await app.navigate('/app/library');
        assert.equal(app.path, '/app/library');
      });

      it('shows names and text with markup as text, in the form, the preview and the heading', async () => {
        const fake = owner();
        verne(fake).name = HOSTILE;
        verne(fake).bio = HOSTILE;
        verne(fake).descriptor = HOSTILE;
        await open(fake, '/app/studio/settings');
        assert.equal(app.find('#atelier-name').value, HOSTILE);
        assert.equal(app.find('.preview-name').textContent, HOSTILE);
        assert.equal(app.find('.preview-bio').textContent, HOSTILE);
        assert.ok(app.text('#view .eyebrow').includes(HOSTILE));
        assert.equal(app.document.querySelectorAll('#view img[src="x"], img[onerror]').length, 0);
      });
    });

    describe('preview', () => {
      it('follows what is typed, before anything is saved', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        assert.equal(app.find('.preview-name').textContent, 'Verne & Co');
        assert.match(app.text('.preview-line'), /Writing · Turin, Italy/);
        assert.equal(app.find('.preview-descriptor').textContent, 'Essays on getting started');
        assert.deepEqual([...app.document.querySelectorAll('.preview-link')].map(node => node.textContent.trim()), ['Newsletter']);
        await type('#atelier-name', HOSTILE);
        await choose('#atelier-category', 'Music');
        await type('#atelier-location', '');
        await type('#atelier-bio', 'New words');
        assert.equal(app.find('.preview-name').textContent, HOSTILE);
        assert.equal(app.document.querySelectorAll('.atelier-preview img[onerror]').length, 0);
        assert.equal(app.find('.preview-line').textContent.trim(), 'Music');
        assert.equal(app.find('.preview-bio').textContent, 'New words');
        await type('#atelier-name', '');
        assert.equal(app.find('.preview-name').textContent, 'Your atelier');
        assert.equal(callsTo(fake, 'updateAtelier').length, 0);
      });

      it('shows the default cover chosen, and the uploaded banner once there is one', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        assert.match(app.find('[data-preview-banner] img').getAttribute('src'), /ritual/);
        assert.equal(app.find('[data-preview-banner]').classList.contains('is-preset'), true);
        await choose('#atelier-image', 'architecture');
        assert.match(app.find('[data-preview-banner] img').getAttribute('src'), /architecture/);
      });
    });

    describe('address', () => {
      it('checks a new address as it is typed, and warns that old links will break', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        assert.equal(app.find('[data-slug-warning]').hidden, true);
        assert.equal(app.find('#atelier-slug').getAttribute('aria-describedby').includes('atelier-slug-status'), true);
        await type('#atelier-slug', 'verne-press');
        assert.match(app.text('[data-slug-status]'), /Checking availability/);
        assert.equal(app.find('[data-slug-warning]').hidden, false);
        assert.match(app.text('[data-slug-warning]'), /\/app\/c\/verne-and-co/);
        await wait();
        assert.deepEqual(callsTo(fake, 'slugAvailable').map(call => call.args[0]), ['verne-press']);
        assert.match(app.text('[data-slug-status]'), /That address is available/);
        assert.equal(app.find('[data-slug-status]').dataset.state, 'available');
      });

      it('waits for the person to stop typing before it asks', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        await type('#atelier-slug', 've');
        await type('#atelier-slug', 'ver');
        await type('#atelier-slug', 'vern');
        await wait();
        assert.deepEqual(callsTo(fake, 'slugAvailable').map(call => call.args[0]), ['vern']);
      });

      it('says when an address is taken, is not valid, or is the current one', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        await slugTyped('atelier-solene');
        assert.match(app.text('[data-slug-status]'), /address is taken/);
        assert.equal(app.find('[data-slug-status]').dataset.state, 'taken');
        await type('#atelier-slug', 'a');
        assert.match(app.text('[data-slug-status]'), /2 to 40 letters/);
        await type('#atelier-slug', 'Verne And Co!');
        assert.equal(app.find('#atelier-slug').value, 'verneandco', 'only letters, numbers and hyphens are kept, in lower case');
        await type('#atelier-slug', 'verne-and-co');
        assert.match(app.text('[data-slug-status]'), /current address/);
        assert.equal(app.find('[data-slug-warning]').hidden, true);
      });

      it('does not use an answer that arrived after the address changed again', async () => {
        const fake = owner();
        const real = fake.slugAvailable.bind(fake);
        const gates = [];
        fake.slugAvailable = slug => new Promise(resolve => gates.push(() => resolve(real(slug))));
        await open(fake, '/app/studio/settings');
        await type('#atelier-slug', 'first-try');
        await tick(400);
        await type('#atelier-slug', 'verne-and-co');
        gates.shift()();
        await app.settle();
        assert.match(app.text('[data-slug-status]'), /current address/);
      });

      it('asks before changing the address, then saves it and says where the atelier is now', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        await slugTyped('verne-press');
        await submit(FORM);
        assert.ok(dialog(), 'the person is asked');
        assert.match(app.text('#modal'), /\/app\/c\/verne-and-co will stop working/);
        await answer(false);
        assert.equal(callsTo(fake, 'updateAtelier').length, 0);
        assert.equal(app.find('#atelier-slug').value, 'verne-press');
        await submit(FORM);
        await answer(true);
        const [call] = callsTo(fake, 'updateAtelier');
        assert.equal(call.args[1].slug, 'verne-press');
        assert.equal(verne(fake).slug, 'verne-press');
        assert.equal(app.store.state.myCreator.slug, 'verne-press');
        assert.match(app.text('[data-note="atelier"]'), /\/app\/c\/verne-press/);
        assert.equal(app.find('#view .page-actions a').getAttribute('href'), '/app/c/verne-press');
        assert.equal(app.find('[data-slug-warning]').hidden, true);
      });

      it('does not save an address that is taken', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        await slugTyped('casa-verano');
        await submit(FORM);
        assert.equal(callsTo(fake, 'updateAtelier').length, 0);
        assert.equal(dialog(), null);
        assert.match(app.text('#atelier-slug-error'), /address is taken/);
        assert.equal(app.document.activeElement.id, 'atelier-slug');
      });

      it('reports an address taken in the meantime, keeping what was typed', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        await slugTyped('verne-press');
        fake.db.creators.find(row => row.id === IDS.verano).slug = 'verne-press';
        await submit(FORM);
        await answer(true);
        assert.match(app.text('[data-error="atelier"]'), /address is taken/);
        assert.match(app.text('#atelier-slug-error'), /address is taken/);
        assert.equal(app.find('#atelier-slug').value, 'verne-press');
        assert.equal(verne(fake).slug, 'verne-and-co');
      });

      it('lets the person save when the check itself cannot run', async () => {
        const fake = owner();
        fake.fail('slugAvailable', 'Network down.');
        await open(fake, '/app/studio/settings');
        await slugTyped('verne-press');
        assert.match(app.text('[data-slug-status]'), /could not check this address/);
        await submit(FORM);
        await answer(true);
        assert.equal(verne(fake).slug, 'verne-press');
      });
    });

    describe('links', () => {
      it('lists the saved links with labelled fields and tools', async () => {
        await open(owner(), '/app/studio/settings');
        assert.deepEqual(linkValues(), [['Newsletter', 'https://example.test/verne']]);
        assert.equal(app.find('#link-l1-label').getAttribute('aria-describedby').includes('link-l1-label-error'), true);
        assert.equal(app.find('#link-l1-up').disabled, true, 'the first row cannot move up');
        assert.equal(app.find('#link-l1-down').disabled, true, 'the only row cannot move down');
        assert.ok(app.find('#link-l1-remove').getAttribute('aria-label'));
        labelled(app.find('.links-editor'));
      });

      it('adds rows up to five, focusing the new one, and then stops offering more', async () => {
        await open(owner(), '/app/studio/settings');
        await app.click('#link-add');
        assert.equal(linkIds().length, 2);
        assert.equal(app.document.activeElement.id, `link-${linkIds()[1]}-label`);
        for (let i = 0; i < 3; i++) await app.click('#link-add');
        assert.equal(linkIds().length, 5);
        assert.equal(app.find('#link-add').disabled, true);
        assert.match(app.text('.link-add'), /most links/);
      });

      it('saves the links in the order shown, adds https:// to a bare address, and drops empty rows', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        await app.click('#link-add');
        await app.click('#link-add');
        const [first, second, third] = linkIds();
        await type(`#link-${second}-label`, 'Shop');
        await type(`#link-${second}-url`, 'shop.example.test');
        await type(`#link-${third}-label`, '');
        await app.click(`#link-${second}-up`);
        assert.deepEqual(linkIds(), [first, second, third].toSpliced(0, 2, second, first));
        assert.equal(app.document.activeElement.id.startsWith(`link-${second}-`), true, 'focus stays with the moved row');
        await submit(FORM);
        const [call] = callsTo(fake, 'updateAtelier');
        assert.deepEqual(call.args[1].links, [{ label: 'Shop', url: 'https://shop.example.test' }, { label: 'Newsletter', url: 'https://example.test/verne' }]);
        assert.deepEqual(verne(fake).links.map(link => link.label), ['Shop', 'Newsletter']);
        assert.equal(app.document.querySelectorAll('.link-row').length, 2);
      });

      it('moves a row down and removes one', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        await app.click('#link-add');
        const [first, second] = linkIds();
        await type(`#link-${second}-label`, 'Podcast');
        await type(`#link-${second}-url`, 'https://podcast.example.test');
        await app.click(`#link-${first}-down`);
        assert.deepEqual(linkValues().map(row => row[0]), ['Podcast', 'Newsletter']);
        assert.match(app.router.block(), /unsaved/);
        await app.click(`#link-${second}-remove`);
        assert.deepEqual(linkValues().map(row => row[0]), ['Newsletter']);
        assert.equal(app.document.activeElement.id, 'link-add');
        assert.equal(app.router.block(), null, 'back to what is saved');
      });

      it('says what is wrong with a link before sending anything', async () => {
        const fake = owner();
        await open(fake, '/app/studio/settings');
        await app.click('#link-add');
        await app.click('#link-add');
        const [first, second, third] = linkIds();
        await type(`#link-${first}-url`, 'not a web address');
        await type(`#link-${second}-url`, 'https://nolabel.example.test');
        await type(`#link-${third}-label`, 'No address');
        await submit(FORM);
        assert.equal(callsTo(fake, 'updateAtelier').length, 0);
        assert.match(app.text(`#link-${first}-url-error`), /web address such as https:\/\/example\.com/);
        assert.match(app.text(`#link-${second}-label-error`), /Name this link/);
        assert.match(app.text(`#link-${third}-url-error`), /Add the web address/);
        assert.equal(app.document.activeElement.id, `link-${first}-url`);
        await type(`#link-${first}-url`, 'https://fixed.example.test');
        assert.equal(app.text(`#link-${first}-url-error`), '');
      });

      it('shows link text with markup as text', async () => {
        const fake = owner();
        verne(fake).links = [{ label: HOSTILE, url: 'https://example.test' }];
        await open(fake, '/app/studio/settings');
        assert.equal(app.find('#link-l1-label').value, HOSTILE);
        assert.ok(app.text('.preview-links').includes(HOSTILE));
        assert.equal(app.document.querySelectorAll('img[onerror]').length, 0);
      });
    });

    describe('pictures', () => {
      const withCrop = (seen = []) => patch(tools, 'cropImage', async (file, options) => { seen.push([file.name, options]); return image(); });

      it('offers a banner and a picture, with a choose button and no remove while there is none', async () => {
        await open(owner(), '/app/studio/settings');
        assert.match(app.text('#atelier-cover-pick'), /Choose a banner/);
        assert.match(app.text('#atelier-avatar-pick'), /Choose a picture/);
        assert.equal(app.exists('[data-action="remove-image"]'), false);
        assert.equal(app.find('#atelier-cover-file').getAttribute('aria-label'), 'Choose a banner');
        assert.match(app.find('#atelier-avatar-file').getAttribute('accept'), /image\/webp/);
        assert.equal(app.find('[data-picture="avatar"] .avatar').textContent.trim(), 'VC');
      });

      it('crops and uploads a banner at once, and the preview and store follow', async () => {
        const fake = owner();
        const seen = [];
        withCrop(seen);
        await open(fake, '/app/studio/settings');
        await pickFile('#atelier-cover-file');
        assert.deepEqual(seen, [['photo.png', { aspect: 16 / 5, width: 1600 }]]);
        const [call] = callsTo(fake, 'uploadCreatorImage');
        assert.deepEqual([call.args[0], call.args[1]], [IDS.verne, 'cover']);
        assert.ok(call.args[2] instanceof Blob);
        assert.ok(app.store.state.myCreator.coverUrl);
        assert.match(toastText(), /Your banner was updated/);
        assert.match(app.text('[data-note="image-cover"]'), /Your banner was updated/);
        assert.match(app.text('#atelier-cover-pick'), /Change banner/);
        assert.equal(app.find('[data-preview-banner]').classList.contains('is-preset'), false);
        assert.equal(app.find('[data-preview-banner] img').getAttribute('src'), app.store.state.myCreator.coverUrl);
        assert.equal(app.document.activeElement.id, 'atelier-cover-pick');
      });

      it('crops a picture to a square, and keeps typed details while it uploads', async () => {
        const fake = owner();
        const seen = [];
        withCrop(seen);
        await open(fake, '/app/studio/settings');
        await type('#atelier-name', 'Typed but unsaved');
        await pickFile('#atelier-avatar-file');
        assert.deepEqual(seen[0][1], { aspect: 1, width: 512 });
        assert.deepEqual(callsTo(fake, 'uploadCreatorImage').map(call => call.args[1]), ['avatar']);
        assert.ok(app.store.state.myCreator.avatarUrl);
        assert.equal(app.find('#atelier-name').value, 'Typed but unsaved');
        assert.ok(app.exists('[data-picture="avatar"] img'));
      });

      it('disables the buttons while a picture is being sent', async () => {
        const fake = owner();
        withCrop();
        const release = hold(fake, 'uploadCreatorImage');
        await open(fake, '/app/studio/settings');
        await pickFile('#atelier-cover-file');
        assert.equal(app.find('#atelier-cover-pick').disabled, true);
        assert.match(app.text('#atelier-cover-pick'), /Uploading/);
        release();
        await app.settle();
        assert.equal(app.find('#atelier-cover-pick').disabled, false);
      });

      it('explains a file that cannot be prepared, and an upload that fails', async () => {
        const fake = owner();
        patch(tools, 'cropImage', async () => { throw Error('This image could not be read. Try a JPG, PNG or WebP file.'); });
        await open(fake, '/app/studio/settings');
        await pickFile('#atelier-cover-file', new File(['x'], 'notes.txt', { type: 'text/plain' }));
        assert.match(app.text('[data-error="image-cover"]'), /could not be read/);
        assert.equal(callsTo(fake, 'uploadCreatorImage').length, 0);
        assert.equal(app.find('#atelier-cover-pick').disabled, false);
        withCrop();
        fake.fail('uploadCreatorImage', 'The banner could not be uploaded.');
        await pickFile('#atelier-cover-file');
        assert.match(app.text('[data-error="image-cover"]'), /could not be uploaded/);
        assert.match(toastText(), /could not be uploaded/);
        assert.equal(app.store.state.myCreator.coverUrl ?? null, null);
        fake.fail('uploadCreatorImage', null);
        await pickFile('#atelier-cover-file');
        assert.ok(app.store.state.myCreator.coverUrl);
      });

      it('removes a picture after asking, and reports a failure', async () => {
        const fake = owner();
        withCrop();
        await open(fake, '/app/studio/settings');
        await pickFile('#atelier-avatar-file');
        assert.ok(app.store.state.myCreator.avatarUrl);
        await app.click('[data-picture="avatar"] [data-action="remove-image"]');
        await answer(false);
        assert.equal(callsTo(fake, 'removeCreatorImage').length, 0, 'saying no changes nothing');
        fake.fail('removeCreatorImage', 'The picture could not be removed.');
        await app.click('[data-picture="avatar"] [data-action="remove-image"]');
        await answer(true);
        assert.match(app.text('[data-error="image-avatar"]'), /could not be removed/);
        assert.ok(app.store.state.myCreator.avatarUrl);
        fake.fail('removeCreatorImage', null);
        await app.click('[data-picture="avatar"] [data-action="remove-image"]');
        await answer(true);
        assert.deepEqual(callsTo(fake, 'removeCreatorImage').at(-1).args, [IDS.verne, 'avatar']);
        assert.equal(app.store.state.myCreator.avatarUrl, null);
        assert.match(toastText(), /Your picture was removed/);
        assert.equal(app.exists('[data-picture="avatar"] [data-action="remove-image"]'), false);
      });
    });
  });

  // ============================================================================================
  describe('tier settings', () => {
    const TIERS = '/app/studio/settings?tab=tiers';
    const form = id => `form[data-tier-form="${id}"]`;
    const perkInputs = id => [...app.document.querySelectorAll(`[data-tier="${id}"][data-perk]`)];
    const perkTexts = id => perkInputs(id).map(input => input.value);
    const addMember = (fake, tier) => fake.db.memberships.push({ user_id: IDS.fan1, creator_id: IDS.verne, tier, created_at: '2026-09-30T09:00:00+00:00', updated_at: '2026-09-30T09:00:00+00:00' });

    it('shows the three levels in order, each with its price, status and members', async () => {
      const fake = owner();
      addMember(fake, 'premium');
      await open(fake, TIERS);
      const forms = [...app.document.querySelectorAll('[data-tier-form]')];
      assert.deepEqual(forms.map(node => node.dataset.tierForm), ['essential', 'premium', 'signature']);
      assert.deepEqual(forms.map(node => node.querySelector('h3').textContent), ['Reader', 'Supporter', 'Inner circle']);
      assert.equal(app.find(`${form('premium')} .tier-editor-price`).textContent.replace(/\s+/g, ' ').trim(), '€19 / month');
      assert.equal(app.find('[data-members="premium"]').textContent, '1 member');
      assert.equal(app.find('[data-members="essential"]').textContent, '0 members');
      assert.match(app.text(`${form('signature')} .tier-editor-meta`), /Open/);
      assert.equal(app.find('#tier-essential-name').value, 'Reader');
      assert.equal(app.find('#tier-essential-price').value, '9');
      assert.equal(app.find('#tier-essential-currency').value, 'EUR');
      assert.deepEqual([...app.find('#tier-essential-currency').options].map(option => option.value), ['EUR', 'USD', 'GBP']);
      assert.equal(app.find('#tier-essential-description').value, 'A closer look at the work.');
      assert.equal(app.text('[data-counter="tier-essential-description"]'), '26 / 280');
      assert.equal(app.find('#tier-essential-enabled').checked, true);
      assert.equal(app.find('#tier-essential-enabled').getAttribute('role'), 'switch');
      assert.deepEqual(perkTexts('essential'), ['All circle entries', 'The complete entry archive', 'Members’ conversation']);
      labelled(app.find('#view'));
      assert.deepEqual(forms.map(node => node.getAttribute('aria-labelledby')), ['tier-essential-title', 'tier-premium-title', 'tier-signature-title']);
    });

    it('says that payments are not live yet', async () => {
      await open(owner(), TIERS);
      assert.match(app.text('.tiers-notice'), /Payments are not live yet/);
      assert.match(app.text('.tiers-notice'), /free during early access/);
      assert.doesNotMatch(app.text('#view'), /demo|mock|fake|lorem/i);
    });

    it('still opens when the member counts cannot be loaded', async () => {
      const fake = owner();
      fake.fail('creatorStats', 'Stats are unavailable.');
      await open(fake, TIERS);
      assert.ok(app.exists('[data-tier-form="premium"]'));
      assert.equal(app.exists('[data-members]'), false);
    });

    it('shows an error with Retry when the tiers cannot be loaded, and opens once they can', async () => {
      const fake = owner();
      fake.fail('listTiers', 'The tiers could not be loaded.');
      await open(fake, TIERS);
      assert.match(app.text('#view .error-state'), /could not be loaded/);
      assert.ok(app.exists('#view .error-state [data-retry]'), 'the error state offers Retry');
      fake.fail('listTiers', null);
      // The Retry button's own listener sits on the first document a test run ever drew one on; what it calls is the router's reload.
      await app.router.reload();
      await app.settle();
      assert.ok(app.exists('[data-tier-form="essential"]'));
    });

    it('shows a closed tier as closed', async () => {
      const fake = owner();
      tierRow(fake, 'signature').enabled = false;
      await open(fake, TIERS);
      assert.equal(app.find('#tier-signature-enabled').checked, false);
      assert.equal(app.find(form('signature')).classList.contains('is-closed'), true);
      assert.match(app.text(`${form('signature')} .tier-editor-meta`), /Closed/);
    });

    it('saves one tier: price with a comma, currency, description and perks, and the card follows', async () => {
      const fake = owner();
      await open(fake, TIERS);
      await type('#tier-premium-name', '  Patron  ');
      await type('#tier-premium-price', '12,50');
      await choose('#tier-premium-currency', 'USD');
      await type('#tier-premium-description', 'For people who read everything.');
      await type(perkInputs('premium')[0], 'Monthly letter');
      assert.match(app.router.block(), /unsaved changes to your tiers/);
      assert.equal(app.find('[data-tier-status="premium"]').textContent, 'You have unsaved changes.');
      assert.equal(app.find('[data-tier-status="essential"]').textContent, '');
      await submit(form('premium'));
      const [call] = callsTo(fake, 'updateTier');
      assert.deepEqual(call.args.slice(0, 2), [IDS.verne, 'premium']);
      assert.deepEqual(call.args[2], {
        name: 'Patron', currency: 'USD', description: 'For people who read everything.', priceCents: 1250,
        perks: ['Monthly letter', 'In-depth studio notes', 'Priority conversation prompts'], enabled: true
      });
      const row = tierRow(fake, 'premium');
      assert.deepEqual([row.name, row.price_cents, row.currency], ['Patron', 1250, 'USD']);
      assert.equal(app.find(`${form('premium')} h3`).textContent, 'Patron');
      assert.equal(app.find(`${form('premium')} .tier-editor-price`).textContent.replace(/\s+/g, ' ').trim(), 'US$12.50 / month');
      assert.equal(app.find('#tier-premium-price').value, '12.50');
      assert.match(toastText(), /Patron saved\./);
      assert.match(app.text('[data-note="tier-premium"]'), /Patron was updated/);
      assert.equal(app.router.block(), null);
      assert.equal(callsTo(fake, 'updateTier').length, 1, 'only the tier that was saved is sent');
    });

    it('keeps the unsaved changes of the other tiers when one is saved', async () => {
      const fake = owner();
      await open(fake, TIERS);
      await type('#tier-essential-name', 'Friend');
      await type('#tier-signature-price', '45');
      await submit(form('signature'));
      assert.equal(tierRow(fake, 'signature').price_cents, 4500);
      assert.equal(tierRow(fake, 'essential').name, 'Reader');
      assert.equal(app.find('#tier-essential-name').value, 'Friend', 'still typed, still unsaved');
      assert.match(app.router.block(), /unsaved changes to your tiers/);
      await submit(form('essential'));
      assert.equal(tierRow(fake, 'essential').name, 'Friend');
      assert.equal(app.router.block(), null);
    });

    it('accepts prices of 0 and 1000, shows cents, and refuses what is out of range or not a number', async () => {
      const fake = owner();
      await open(fake, TIERS);
      await type('#tier-essential-price', '0');
      await submit(form('essential'));
      assert.equal(tierRow(fake, 'essential').price_cents, 0);
      assert.equal(app.find('#tier-essential-price').value, '0');
      await type('#tier-essential-price', '€ 1000');
      await submit(form('essential'));
      assert.equal(tierRow(fake, 'essential').price_cents, 100000);
      const before = callsTo(fake, 'updateTier').length;
      await type('#tier-essential-price', '1000.01');
      await submit(form('essential'));
      assert.match(app.text('#tier-essential-price-error'), /between 0 and 1,000/);
      await type('#tier-essential-price', 'nine');
      await submit(form('essential'));
      assert.match(app.text('#tier-essential-price-error'), /price such as 9 or 9\.50/);
      assert.equal(app.find('#tier-essential-price').getAttribute('aria-invalid'), 'true');
      assert.equal(app.document.activeElement.id, 'tier-essential-price');
      assert.equal(callsTo(fake, 'updateTier').length, before, 'nothing was sent');
    });

    it('says what is wrong with the name, the description and a long perk', async () => {
      const fake = owner();
      await open(fake, TIERS);
      await type('#tier-premium-name', 'x');
      await type('#tier-premium-description', 'y'.repeat(281));
      await type(perkInputs('premium')[1], 'z'.repeat(81));
      await submit(form('premium'));
      assert.equal(callsTo(fake, 'updateTier').length, 0);
      assert.match(app.text('#tier-premium-name-error'), /tier name/i);
      assert.match(app.text('#tier-premium-description-error'), /at most 280 characters/);
      const long = perkInputs('premium')[1];
      assert.match(app.text(`#${long.id}-error`), /at most 80 characters/);
      assert.equal(long.getAttribute('aria-invalid'), 'true');
      assert.match(app.text('[data-error="tier-premium"]'), /Check the highlighted fields/);
      assert.equal(app.document.activeElement.id, 'tier-premium-name');
    });

    it('keeps everything typed when the save fails, and saves on the second try', async () => {
      const fake = owner();
      fake.fail('updateTier', 'This tier could not be saved right now.');
      await open(fake, TIERS);
      await type('#tier-premium-name', 'Patron');
      await type('#tier-premium-price', '25');
      await submit(form('premium'));
      assert.match(app.text('[data-error="tier-premium"]'), /could not be saved right now/);
      assert.match(toastText(), /could not be saved right now/);
      assert.equal(app.find('#tier-premium-name').value, 'Patron');
      assert.equal(app.find('#tier-premium-price').value, '25');
      assert.equal(app.find('#tier-premium-save').disabled, false);
      assert.equal(tierRow(fake, 'premium').name, 'Supporter');
      fake.fail('updateTier', null);
      await submit(form('premium'));
      assert.equal(tierRow(fake, 'premium').name, 'Patron');
      assert.equal(app.text('[data-error="tier-premium"]'), '');
    });

    it('disables the button while a tier is saved, and sends it once', async () => {
      const fake = owner();
      const release = hold(fake, 'updateTier');
      await open(fake, TIERS);
      await type('#tier-premium-name', 'Patron');
      await submit(form('premium'));
      await submit(form('premium'));
      assert.equal(app.find('#tier-premium-save').disabled, true);
      assert.equal(app.find('#tier-premium-save').getAttribute('aria-busy'), 'true');
      assert.equal(app.find('#tier-essential-save').disabled, false, 'the other tiers can still be edited');
      release();
      await app.settle();
      assert.equal(callsTo(fake, 'updateTier').length, 1);
      assert.equal(app.find('#tier-premium-save').disabled, false);
    });

    describe('perks', () => {
      it('adds a perk with focus on it, removes one, and counts them', async () => {
        const fake = owner();
        await open(fake, TIERS);
        assert.equal(app.text('[data-perk-count="premium"]'), '3 / 8');
        await app.click('#tier-premium-add-perk');
        assert.equal(perkInputs('premium').length, 4);
        assert.equal(app.document.activeElement, perkInputs('premium')[3]);
        assert.equal(app.text('[data-perk-count="premium"]'), '4 / 8');
        await type(perkInputs('premium')[3], 'A signed print');
        await app.click(`${form('premium')} [data-action="remove-perk"]`);
        assert.deepEqual(perkTexts('premium'), ['In-depth studio notes', 'Priority conversation prompts', 'A signed print']);
        assert.equal(app.document.activeElement.id, 'tier-premium-add-perk');
        await submit(form('premium'));
        assert.deepEqual(tierRow(fake, 'premium').perks, ['In-depth studio notes', 'Priority conversation prompts', 'A signed print']);
      });

      it('adds the next perk on Enter instead of sending the tier', async () => {
        const fake = owner();
        await open(fake, TIERS);
        await press(perkInputs('premium')[0], 'Enter');
        assert.equal(perkInputs('premium').length, 4);
        assert.equal(callsTo(fake, 'updateTier').length, 0);
      });

      it('stops at eight perks', async () => {
        await open(owner(), TIERS);
        for (let i = 0; i < 5; i++) await app.click('#tier-premium-add-perk');
        assert.equal(perkInputs('premium').length, 8);
        assert.equal(app.find('#tier-premium-add-perk').disabled, true);
        assert.equal(app.text('[data-perk-count="premium"]'), '8 / 8');
        await press(perkInputs('premium')[0], 'Enter');
        assert.equal(perkInputs('premium').length, 8);
      });

      it('leaves out empty perks and can remove them all', async () => {
        const fake = owner();
        await open(fake, TIERS);
        await app.click('#tier-premium-add-perk');
        for (let i = 0; i < 3; i++) await app.click(`${form('premium')} [data-action="remove-perk"]`);
        assert.deepEqual(perkTexts('premium'), ['']);
        await submit(form('premium'));
        assert.deepEqual(tierRow(fake, 'premium').perks, []);
        assert.equal(app.exists(`${form('premium')} .perk-rows`), false);
      });

      it('shows perks with markup as text', async () => {
        const fake = owner();
        tierRow(fake, 'premium').perks = [HOSTILE];
        tierRow(fake, 'premium').name = HOSTILE;
        await open(fake, TIERS);
        assert.equal(perkInputs('premium')[0].value, HOSTILE);
        assert.equal(app.find(`${form('premium')} h3`).textContent, HOSTILE);
        assert.equal(app.document.querySelectorAll('img[onerror]').length, 0);
      });
    });

    describe('open and closed', () => {
      it('closes a tier while another stays open', async () => {
        const fake = owner();
        await open(fake, TIERS);
        await toggle('#tier-signature-enabled', false);
        assert.match(app.router.block(), /unsaved/);
        await submit(form('signature'));
        assert.equal(callsTo(fake, 'updateTier')[0].args[2].enabled, false);
        assert.equal(tierRow(fake, 'signature').enabled, false);
        assert.match(app.text(`${form('signature')} .tier-editor-meta`), /Closed/);
        assert.equal(app.find(form('signature')).classList.contains('is-closed'), true);
      });

      it('shows the server rule when the last open tier would be closed, and keeps the switch where it was put', async () => {
        const fake = owner();
        tierRow(fake, 'essential').enabled = false;
        tierRow(fake, 'premium').enabled = false;
        await open(fake, TIERS);
        await toggle('#tier-signature-enabled', false);
        await submit(form('signature'));
        assert.match(app.text('[data-error="tier-signature"]'), /Keep at least one membership tier open/);
        assert.match(toastText(), /Keep at least one membership tier open/);
        assert.equal(tierRow(fake, 'signature').enabled, true);
        assert.equal(app.document.activeElement.id, 'tier-signature-enabled', 'focus goes to the switch that caused it');
        await toggle('#tier-signature-enabled', true);
        assert.equal(app.find('[data-tier-status="signature"]').textContent, '');
        await toggle('#tier-essential-enabled', true);
        await submit(form('essential'));
        assert.equal(tierRow(fake, 'essential').enabled, true);
        assert.match(app.text(`${form('essential')} .tier-editor-meta`), /Open/);
      });
    });

    describe('unsaved changes', () => {
      it('asks before leaving, and again for each way out', async () => {
        const fake = owner();
        await open(fake, TIERS);
        assert.equal(app.router.block(), null);
        await type('#tier-premium-description', 'Changed');
        const asked = confirmWith(false);
        await app.navigate('/app/library');
        assert.equal(app.path, TIERS);
        assert.equal(asked.length, 1);
        assert.match(asked[0], /unsaved changes to your tiers/);
        await app.click('#view nav.tabs a[href="/app/studio/settings?tab=atelier"]');
        assert.equal(app.path, TIERS);
        confirmWith(true);
        await app.navigate('/app/library');
        assert.equal(app.path, '/app/library');
      });

      it('discards the changes of one tier after asking, and not the others', async () => {
        const fake = owner();
        await open(fake, TIERS);
        await type('#tier-premium-name', 'Changed');
        await type('#tier-premium-price', 'abc');
        await submit(form('premium'));
        await type('#tier-signature-name', 'Other');
        await app.click(`${form('premium')} [data-action="discard-tier"]`);
        await answer(false);
        assert.equal(app.find('#tier-premium-name').value, 'Changed');
        await app.click(`${form('premium')} [data-action="discard-tier"]`);
        await answer(true);
        assert.equal(app.find('#tier-premium-name').value, 'Supporter');
        assert.equal(app.find('#tier-premium-price').value, '19');
        assert.equal(app.text('#tier-premium-price-error'), '');
        assert.equal(app.find('#tier-signature-name').value, 'Other');
        assert.equal(callsTo(fake, 'updateTier').length, 0);
      });

      it('does not count a change that was typed back as unsaved', async () => {
        await open(owner(), TIERS);
        await type('#tier-premium-name', 'Changed');
        await type('#tier-premium-name', 'Supporter');
        await type('#tier-premium-price', '19.00');
        assert.equal(app.router.block(), null);
      });
    });
  });
});
