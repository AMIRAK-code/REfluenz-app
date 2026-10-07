// Account settings: /app/settings?tab=profile|account|notifications|data (docs/ARCHITECTURE.md section 3).
//
// Everything the page edits lives in the object `load` returns (`data`): typed text is kept there as it is typed, so the page
// can be drawn again (after a picture is chosen, after a failed save) without losing anything. Messages that belong to one
// form are written straight into their element (data-error / data-note) and kept in `data` for the next drawing.

import { avatar, button, confirmDialog, delegate, html, icon, modal, raw, setBusy, toast } from '../core/ui.js';
import { paths } from '../core/paths.js';
import { cleanProfile } from '../api/util.js';
import { tools } from './settings/tools.js';
import { focusFirstInvalid, formError, formNote, reason, refreshCounter, setError, switchRow, textField, validateEach } from './settings/form.js';

const TABS = [
  { id: 'profile', label: 'Profile', title: 'Profile settings' },
  { id: 'account', label: 'Account', title: 'Account settings' },
  { id: 'notifications', label: 'Notifications', title: 'Notification settings' },
  { id: 'data', label: 'Your data', title: 'Your data' }
];

// The eight kinds of notification the database knows (user_settings.notify_prefs), in the groups people think in.
const NOTIFY_GROUPS = [
  {
    id: 'reading',
    title: 'As a reader',
    text: 'What reaches you from the creators and people you follow.',
    items: [
      { key: 'new_entry', label: 'New posts', text: 'A creator you follow or belong to publishes something new.' },
      { key: 'reply', label: 'Replies', text: 'Someone replies to one of your comments.' },
      { key: 'message', label: 'Messages', text: 'A new message in one of your conversations.' },
      { key: 'note', label: 'Circle notes', text: 'A creator you belong to posts a note to their circle.' }
    ]
  },
  {
    id: 'creating',
    title: 'As a creator',
    text: 'What reaches you about your own atelier. Nothing arrives until you open one.',
    items: [
      { key: 'comment', label: 'Comments', text: 'Someone comments on one of your posts.' },
      { key: 'like', label: 'Likes', text: 'Someone likes one of your posts.' },
      { key: 'follow', label: 'New followers', text: 'Someone follows your atelier.' },
      { key: 'membership', label: 'New members', text: 'Someone joins your circle.' }
    ]
  }
];

const PHOTO_TYPES = 'image/jpeg,image/png,image/webp,image/gif';
const MIN_PASSWORD = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONFIRM_WORD = 'DELETE';
const PROFILE_KEYS = ['name', 'bio', 'website'];

const tabOf = query => (TABS.some(tab => tab.id === query?.tab) ? query.tab : 'profile');
const snapshot = profile => ({ name: profile?.name ?? '', bio: profile?.bio ?? '', website: profile?.website ?? '' });
const valueOf = (data, id, fallback = '') => data.fields[id] ?? fallback;
const profileValues = data => Object.fromEntries(PROFILE_KEYS.map(key => [key, valueOf(data, `profile-${key}`, data.saved[key])]));
const isDirty = data => data.tab === 'profile' && (Boolean(data.avatar) || PROFILE_KEYS.some(key => profileValues(data)[key] !== data.saved[key]));

// --- Panels -------------------------------------------------------------------

function photoSection(ctx, data) {
  const profile = ctx.store.state.profile;
  const staged = data.avatar;
  const person = { name: profileValues(data).name || profile?.name, avatarUrl: staged?.url ?? profile?.avatarUrl };
  const actions = staged
    ? html`${button('Save photo', { attrs: { 'data-action': 'save-avatar' } })}${button('Cancel', { variant: 'secondary', attrs: { 'data-action': 'discard-avatar' } })}`
    : html`${button(profile?.avatarUrl ? 'Change photo' : 'Choose a photo', { variant: 'secondary', icon: 'camera', attrs: { 'data-action': 'pick-avatar' } })}${profile?.avatarUrl && button('Remove photo', { variant: 'ghost', attrs: { 'data-action': 'remove-avatar' } })}`;
  return html`<section class="settings-section" aria-labelledby="photo-title">
    <div class="settings-intro"><h2 id="photo-title">Photo</h2><p>Shown next to your comments, messages and memberships.</p></div>
    <div class="settings-body">
      <div class="photo-row">
        <div class="photo-preview">${avatar(person, { size: 96 })}</div>
        <div class="photo-actions">
          <input id="avatar-file" type="file" accept="${PHOTO_TYPES}" data-file="avatar" aria-label="Choose a photo" hidden>
          <div class="row">${actions}</div>
          <p class="field-help" aria-live="polite">${staged ? 'This is how your photo will look, cropped to a square from the centre. Save it to use it.' : 'JPG, PNG or WebP. It is cropped to a square from the centre.'}</p>
          ${formError('avatar', data.error.avatar)}
        </div>
      </div>
    </div>
  </section>`;
}

function profileSection(ctx, data) {
  const values = profileValues(data);
  const errors = data.errors;
  return html`<section class="settings-section" aria-labelledby="details-title">
    <div class="settings-intro"><h2 id="details-title">Details</h2><p>Creators see these when you write to them or join their circle.</p></div>
    <form class="settings-body" data-form="profile" novalidate>
      ${textField({ id: 'profile-name', name: 'name', label: 'Display name', value: values.name, max: 60, required: true, error: errors['profile-name'], extra: { autocomplete: 'name' } })}
      ${textField({ id: 'profile-bio', name: 'bio', label: 'About you', control: 'textarea', rows: 4, value: values.bio, max: 240, counter: true, hint: 'A line or two. Optional.', error: errors['profile-bio'] })}
      ${textField({ id: 'profile-website', name: 'website', label: 'Website', value: values.website, max: 200, hint: 'Optional. A web address such as https://example.com.', error: errors['profile-website'], extra: { inputmode: 'url', autocomplete: 'url', spellcheck: 'false', autocapitalize: 'none' } })}
      ${formError('profile', data.error.profile)}
      <div class="form-actions">${button('Save profile', { type: 'submit', icon: 'check' })}</div>
    </form>
  </section>`;
}

function atelierLink(ctx) {
  const creator = ctx.store.state.myCreator;
  if (!creator) return '';
  return html`<section class="settings-section" aria-labelledby="atelier-link-title">
    <div class="settings-intro"><h2 id="atelier-link-title">Your atelier</h2><p>The page you share with your circle has its own settings.</p></div>
    <div class="settings-body"><p class="settings-lede"><strong>${creator.name}</strong> has its own name, address, banner and tiers.</p>
    <div class="form-actions">${button('Atelier settings', { variant: 'secondary', href: paths.studioSettings(), icon: 'studio' })}</div></div>
  </section>`;
}

function profilePanel(ctx, data) {
  return html`${photoSection(ctx, data)}${profileSection(ctx, data)}${atelierLink(ctx)}`;
}

function accountPanel(ctx, data) {
  const email = ctx.store.state.user?.email || '';
  const errors = data.errors;
  return html`<section class="settings-section" aria-labelledby="email-title">
      <div class="settings-intro"><h2 id="email-title">Email</h2><p>The address you sign in with and where we write to you.</p></div>
      <form class="settings-body" data-form="email" novalidate>
        <p class="settings-lede">Signed in as <strong>${email}</strong></p>
        ${textField({ id: 'email-new', name: 'email', label: 'New email address', type: 'email', value: valueOf(data, 'email-new'), error: errors['email-new'], extra: { autocomplete: 'email', inputmode: 'email', spellcheck: 'false', autocapitalize: 'none' } })}
        ${formError('email', data.error.email)}
        ${formNote('email', data.note.email)}
        <div class="form-actions">${button('Change email', { type: 'submit', variant: 'secondary' })}</div>
      </form>
    </section>
    <section class="settings-section" aria-labelledby="password-title">
      <div class="settings-intro"><h2 id="password-title">Password</h2><p>You are signed in on this device, so you can choose a new password without entering the old one.</p></div>
      <form class="settings-body" data-form="password" novalidate>
        ${textField({ id: 'password-new', name: 'password', label: 'New password', type: 'password', value: valueOf(data, 'password-new'), hint: `At least ${MIN_PASSWORD} characters.`, error: errors['password-new'], extra: { autocomplete: 'new-password' } })}
        ${textField({ id: 'password-confirm', name: 'confirm', label: 'Confirm the new password', type: 'password', value: valueOf(data, 'password-confirm'), error: errors['password-confirm'], extra: { autocomplete: 'new-password' } })}
        ${formError('password', data.error.password)}
        ${formNote('password', data.note.password)}
        <div class="form-actions">${button('Update password', { type: 'submit', variant: 'secondary' })}</div>
      </form>
    </section>
    <section class="settings-section" aria-labelledby="signout-title">
      <div class="settings-intro"><h2 id="signout-title">Sign out</h2><p>End your session on this device.</p></div>
      <div class="settings-body">
        <p class="settings-lede">On a shared or public computer, sign out when you finish. Closing the tab does not end your session.</p>
        <div class="form-actions"><button type="button" class="button secondary" data-action="sign-out">${icon('logout', 16)}<span>Sign out</span></button></div>
      </div>
    </section>`;
}

function notificationsPanel(ctx) {
  const settings = ctx.store.state.settings;
  const prefs = settings.notifyPrefs || {};
  return html`<section class="settings-section" aria-labelledby="reading-title">
      <div class="settings-intro"><h2 id="reading-title">Reading</h2><p>How posts are laid out for you.</p></div>
      <div class="settings-body switch-list">
        ${switchRow({ id: 'setting-compact', label: 'Compact cards', text: 'Show posts as smaller cards, so more fit on a screen.', checked: settings.compact === true, extra: { 'data-setting': 'compact' } })}
      </div>
    </section>
    ${NOTIFY_GROUPS.map(group => html`<section class="settings-section" aria-labelledby="notify-${group.id}-title">
      <div class="settings-intro"><h2 id="notify-${group.id}-title">${group.title}</h2><p>${group.text}</p></div>
      <div class="settings-body switch-list">
        ${group.items.map(item => switchRow({ id: `pref-${item.key}`, label: item.label, text: item.text, checked: prefs[item.key] !== false, extra: { 'data-pref': item.key } }))}
      </div>
    </section>`)}
    <p class="settings-foot">Changes are saved as you make them. Notifications appear in your activity feed and on the bell.</p>`;
}

function dataPanel(ctx, data) {
  const creator = ctx.store.state.myCreator;
  return html`<section class="settings-section" aria-labelledby="export-title">
      <div class="settings-intro"><h2 id="export-title">Export</h2><p>A copy of what you have given REFLUENZ.</p></div>
      <div class="settings-body">
        <p class="settings-lede">Download your profile, settings, follows, saved and liked posts, memberships, comments and conversations${creator ? ', together with your atelier, posts and circle notes' : ''} as one JSON file.</p>
        ${formError('export', data.error.export)}
        ${formNote('export', data.note.export)}
        <div class="form-actions">${button('Export my data', { variant: 'secondary', icon: 'export', attrs: { 'data-action': 'export' } })}</div>
      </div>
    </section>
    <section class="settings-section danger-zone" aria-labelledby="delete-title">
      <div class="settings-intro"><h2 id="delete-title">Delete your account</h2><p>Permanent. There is no way back.</p></div>
      <div class="settings-body">
        <p class="settings-lede">Deleting your account removes your profile and sign-in${creator ? ', your atelier, every post, draft and uploaded file, and your circle' : ''}, along with your follows, saves, comments, memberships and messages.</p>
        <p class="field-help">Export your data first if you want to keep a copy.</p>
        <div class="form-actions">${button('Delete my account', { variant: 'danger', attrs: { 'data-action': 'delete-account' } })}</div>
      </div>
    </section>`;
}

const PANELS = { profile: profilePanel, account: accountPanel, notifications: notificationsPanel, data: dataPanel };

// --- Deleting the account ------------------------------------------------------

function deleteDialog(ctx) {
  const { api, store, router } = ctx;
  const creator = store.state.myCreator;
  const consequences = [
    'Your profile, picture and settings',
    creator && html`Your atelier <strong>${creator.name}</strong> and its address`,
    creator && 'Every post, draft, image and film you uploaded',
    creator && 'Your circle: members lose access to your posts and your notes',
    'Your follows, saves, likes, comments and memberships',
    'Your messages'
  ].filter(Boolean);
  modal.open({
    title: 'Delete your account?',
    className: 'delete-account',
    body: html`<p>This permanently removes:</p>
      <ul class="consequences">${consequences.map(item => html`<li>${icon('close', 14)}<span>${item}</span></li>`)}</ul>
      <p><strong>This cannot be undone.</strong></p>
      <form data-delete-form novalidate>
        <div class="field">
          <label for="delete-confirm">Type ${CONFIRM_WORD} to confirm</label>
          <input id="delete-confirm" name="confirm" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="delete-error">
        </div>
        <p class="form-error" id="delete-error" role="alert"></p>
        <div class="dialog-actions">${button('Keep my account', { variant: 'secondary', attrs: { 'data-modal-close': true } })}${button('Delete my account', { variant: 'danger', type: 'submit', attrs: { disabled: true } })}</div>
      </form>`,
    onMount: (dialog, handle) => {
      const form = dialog.querySelector('[data-delete-form]');
      const input = form.querySelector('#delete-confirm');
      const submit = form.querySelector('[type="submit"]');
      const out = form.querySelector('#delete-error');
      const confirmed = () => input.value.trim() === CONFIRM_WORD;
      input.addEventListener('input', () => {
        submit.disabled = !confirmed();
        out.textContent = '';
      });
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!confirmed()) {
          out.textContent = `Type ${CONFIRM_WORD} in capitals to confirm.`;
          return;
        }
        setBusy(submit, true);
        input.readOnly = true;
        try {
          await api.deleteAccount();
        } catch (error) {
          input.readOnly = false;
          setBusy(submit, false);
          const message = reason(error, 'We could not delete your account. Nothing was removed. Try again in a moment.');
          if (dialog.open) out.textContent = message;
          else toast(message, { tone: 'error' });
          return;
        }
        router.block = null;
        handle.close();
        ctx.navigate('/');
        store.signOutLocal();
      });
    }
  });
}

// --- The view ------------------------------------------------------------------

export default {
  title: (ctx, data) => TABS.find(tab => tab.id === data?.tab)?.title ?? 'Settings',
  auth: 'required',

  async load(ctx) {
    const { store } = ctx;
    if (!store.state.profile) await store.reloadViewer();
    const profile = store.state.profile;
    if (!profile) throw Error('We could not load your account. Check your connection and try again.');
    return {
      tab: tabOf(ctx.query),
      saved: snapshot(profile),
      fields: {}, // what was typed, by control id
      errors: {}, // wrong fields, by control id
      error: {}, // messages of a whole form or action, by name
      note: {},
      avatar: null // a picture chosen but not saved yet: {blob, url}
    };
  },

  render(ctx, data) {
    return html`<section class="page settings-page">
      <header class="page-head"><div><p class="eyebrow muted">Your account</p><h1>Settings</h1><p class="page-sub">Your profile, how you sign in, what you hear about and the data REFLUENZ holds for you.</p></div></header>
      <nav class="tabs" aria-label="Settings sections">${TABS.map(tab => html`<a class="tab" href="${paths.settings({ tab: tab.id })}"${tab.id === data.tab ? raw(' aria-current="page"') : ''}>${tab.label}</a>`)}</nav>
      <div class="settings-panel">${PANELS[data.tab](ctx, data)}</div>
    </section>`;
  },

  mount(el, ctx, data) {
    const { api, store } = ctx;
    const doc = el.ownerDocument;
    const timers = new Set();

    const redraw = () => ctx.rerender();
    // What a form shows is what is sent, also when a browser filled a field without an input event.
    const syncFields = form => {
      for (const control of form.elements) {
        if (control.id && /^(INPUT|TEXTAREA)$/.test(control.tagName) && control.type !== 'checkbox' && control.type !== 'file') data.fields[control.id] = control.value;
      }
    };
    // A message of one form: kept for the next drawing and shown at once.
    const say = (kind, name, text) => {
      data[kind][name] = text;
      const node = el.querySelector(`[data-${kind === 'error' ? 'error' : 'note'}="${name}"]`);
      if (node) node.textContent = text;
    };
    const stage = blob => {
      if (data.avatar) URL.revokeObjectURL(data.avatar.url);
      data.avatar = blob ? { blob, url: URL.createObjectURL(blob) } : null;
    };

    ctx.router.block = () => (isDirty(data) ? 'You have unsaved changes to your profile. Leave without saving?' : null);

    // --- Profile ---
    const saveProfile = async form => {
      const { clean, errors } = validateEach(cleanProfile, profileValues(data), key => `profile-${key}`);
      data.errors = errors;
      if (Object.keys(errors).length) {
        say('error', 'profile', '');
        redraw();
        focusFirstInvalid(el);
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      say('error', 'profile', '');
      setBusy(submit, true);
      try {
        const profile = await api.saveProfile(clean);
        store.update({ profile });
        data.saved = snapshot(profile);
        for (const key of PROFILE_KEYS) delete data.fields[`profile-${key}`];
        toast('Profile saved.', { tone: 'success' });
        redraw();
      } catch (error) {
        const message = reason(error, 'We could not save your profile. Your changes are still here. Try again.');
        say('error', 'profile', message);
        toast(message, { tone: 'error' });
        setBusy(submit, false);
      }
    };

    const chooseAvatar = async input => {
      const file = input.files?.[0];
      try { input.value = ''; } catch { /* some engines keep the list; the next choice replaces it */ }
      if (!file) return;
      const pick = el.querySelector('[data-action="pick-avatar"]');
      setBusy(pick, true);
      say('error', 'avatar', '');
      try {
        stage(await tools.cropImage(file, { aspect: 1, width: 512 }));
      } catch (error) {
        say('error', 'avatar', reason(error, 'This image could not be read. Try a JPG, PNG or WebP file.'));
        setBusy(pick, false);
        return;
      }
      redraw();
      el.querySelector('[data-action="save-avatar"]')?.focus();
    };

    const saveAvatar = async control => {
      if (!data.avatar) return;
      setBusy(control, true);
      say('error', 'avatar', '');
      try {
        const profile = await api.uploadAvatar(data.avatar.blob);
        store.update({ profile });
        stage(null);
        toast('Photo updated.', { tone: 'success' });
        redraw();
      } catch (error) {
        const message = reason(error, 'We could not upload your photo. Try again.');
        say('error', 'avatar', message);
        toast(message, { tone: 'error' });
        setBusy(control, false);
      }
    };

    const removeAvatar = async control => {
      const sure = await confirmDialog({ title: 'Remove your photo?', text: 'Your initials will be shown instead. You can add a photo again at any time.', confirmLabel: 'Remove photo' });
      if (!sure) return;
      setBusy(control, true);
      say('error', 'avatar', '');
      try {
        const profile = await api.removeAvatar();
        store.update({ profile });
        toast('Photo removed.', { tone: 'success' });
        redraw();
      } catch (error) {
        const message = reason(error, 'We could not remove your photo. Try again.');
        say('error', 'avatar', message);
        toast(message, { tone: 'error' });
        setBusy(control, false);
      }
    };

    // --- Account ---
    const changeEmail = async form => {
      const address = valueOf(data, 'email-new').trim();
      say('error', 'email', '');
      say('note', 'email', '');
      let problem = '';
      if (!EMAIL.test(address)) problem = 'Enter a valid email address.';
      else if (address.toLowerCase() === (store.state.user?.email || '').toLowerCase()) problem = 'That is already your email address.';
      data.errors = problem ? { 'email-new': problem } : {};
      setError(doc, 'email-new', problem);
      if (problem) {
        doc.getElementById('email-new')?.focus();
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      setBusy(submit, true);
      try {
        await api.updateEmail(address);
        delete data.fields['email-new'];
        const input = doc.getElementById('email-new');
        if (input) input.value = '';
        say('note', 'email', `Check your inbox. We sent a confirmation link to ${address}. Your address changes once you open it, and we may also ask you to confirm from your current address.`);
        toast('Check your inbox to confirm your new email.', { tone: 'success' });
      } catch (error) {
        const message = reason(error, 'We could not change your email. Try again in a moment.');
        say('error', 'email', message);
        toast(message, { tone: 'error' });
      }
      setBusy(submit, false);
    };

    const changePassword = async form => {
      const password = valueOf(data, 'password-new');
      const confirm = valueOf(data, 'password-confirm');
      say('error', 'password', '');
      say('note', 'password', '');
      const errors = {};
      if (password.length < MIN_PASSWORD) errors['password-new'] = `Use at least ${MIN_PASSWORD} characters.`;
      if (confirm !== password) errors['password-confirm'] = 'The two passwords do not match.';
      data.errors = errors;
      for (const id of ['password-new', 'password-confirm']) setError(doc, id, errors[id]);
      if (Object.keys(errors).length) {
        focusFirstInvalid(el);
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      setBusy(submit, true);
      try {
        await api.updatePassword(password);
        delete data.fields['password-new'];
        delete data.fields['password-confirm'];
        for (const id of ['password-new', 'password-confirm']) {
          const input = doc.getElementById(id);
          if (input) input.value = '';
        }
        say('note', 'password', 'Your password was updated.');
        toast('Password updated.', { tone: 'success' });
      } catch (error) {
        const message = reason(error, 'We could not update your password. Try again in a moment.');
        say('error', 'password', message);
        toast(message, { tone: 'error' });
      }
      setBusy(submit, false);
    };

    // --- Notifications ---
    const savePreference = async (input, patch, label) => {
      const on = input.checked;
      const status = doc.getElementById(`${input.id}-status`);
      const had = doc.activeElement === input;
      input.disabled = true;
      try {
        const settings = await api.saveSettings(patch(on));
        store.update({ settings });
        if (status) {
          status.textContent = 'Saved';
          const timer = setTimeout(() => { timers.delete(timer); if (status.textContent === 'Saved') status.textContent = ''; }, 2500);
          timer.unref?.();
          timers.add(timer);
        }
      } catch (error) {
        input.checked = !on;
        toast(reason(error, `We could not save your ${label} preference. Try again.`), { tone: 'error' });
      }
      input.disabled = false;
      if (had) input.focus();
    };

    // --- Data ---
    const exportData = async control => {
      say('error', 'export', '');
      say('note', 'export', '');
      setBusy(control, true);
      try {
        const copy = await api.exportData();
        const name = `refluenz-data-${tools.today()}.json`;
        tools.saveFile(new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' }), name);
        say('note', 'export', `Your export was downloaded as ${name}.`);
        toast('Your data export is ready.', { tone: 'success' });
      } catch (error) {
        const message = reason(error, 'We could not prepare your export. Try again in a moment.');
        say('error', 'export', message);
        toast(message, { tone: 'error' });
      }
      setBusy(control, false);
    };

    const forms = { profile: saveProfile, email: changeEmail, password: changePassword };
    const actions = {
      'pick-avatar': () => el.querySelector('#avatar-file')?.click(),
      'save-avatar': saveAvatar,
      'discard-avatar': () => { stage(null); say('error', 'avatar', ''); redraw(); el.querySelector('[data-action="pick-avatar"]')?.focus(); },
      'remove-avatar': removeAvatar,
      export: exportData,
      'delete-account': () => deleteDialog(ctx)
    };

    const stops = [
      delegate(el, 'input', 'input[id], textarea[id]', (event, field) => {
        if (field.type === 'checkbox' || field.type === 'file') return;
        data.fields[field.id] = field.value;
        if (data.errors[field.id]) {
          delete data.errors[field.id];
          setError(doc, field.id, '');
        }
        refreshCounter(field);
      }),
      delegate(el, 'submit', 'form[data-form]', (event, form) => {
        event.preventDefault();
        syncFields(form);
        forms[form.dataset.form]?.(form);
      }),
      delegate(el, 'click', '[data-action]', (event, control) => {
        const act = actions[control.dataset.action];
        if (!act) return;
        event.preventDefault();
        act(control);
      }),
      delegate(el, 'change', 'input[data-file="avatar"]', (event, input) => { chooseAvatar(input); }),
      delegate(el, 'change', 'input[data-pref]', (event, input) => {
        savePreference(input, on => ({ notifyPrefs: { [input.dataset.pref]: on } }), 'notification');
      }),
      delegate(el, 'change', 'input[data-setting="compact"]', (event, input) => {
        savePreference(input, on => ({ compact: on }), 'card');
      })
    ];

    return () => {
      for (const stop of stops) stop();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }
};
