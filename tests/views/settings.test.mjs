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
    const control = app.find(selector);
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
    app.find(selector).dispatchEvent(new app.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
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
});
