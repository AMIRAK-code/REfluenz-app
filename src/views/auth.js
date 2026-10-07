// Sign in, sign up, forgotten password and the new password after a recovery link: one module, the mode follows the path
// (/app/login, /app/signup, /app/forgot, /app/reset; the route table gives /app/reset the 'recovery' guard).
//
// The page is a focus layout (no sidebar): a form next to a monochrome picture. Errors are written into the form in place, so
// nothing the person typed is ever lost; a successful sign-in is finished by the router (the guest guard sends a signed-in
// person to `next` or /app), this view only makes sure that happens even if the store was slow.

import { button, delegate, html, icon, raw, setBusy, toast } from '../core/ui.js';
import { GUEST_PATHS, paths, safeNext } from '../core/paths.js';
import { presetUrl } from '../core/constants.js';
import { takeAuthError } from './auth/auth-error.js';

// How long "Resend" stays disabled after an email went out, and how long a sign-in may wait for the account to load.
// Exported so that tests can shorten them.
export const timing = { cooldownMs: 30_000, signInWaitMs: 6_000 };

const MODES = { '/app/login': 'login', '/app/signup': 'signup', '/app/forgot': 'forgot', '/app/reset': 'reset' };
const modeOf = path => MODES[String(path || '').replace(/\/+$/, '')] || 'login';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
const NAME_MAX = 60;
const GENERIC_ERROR = 'Something went wrong. Try again in a moment.';

const COPY = {
  login: { title: 'Sign in', kicker: 'Welcome back', heading: 'Step inside.', lede: 'Your library, your circles and your conversations, as you left them.', ledeNext: 'Sign in to continue where you left off.' },
  signup: { title: 'Create your account', kicker: 'Free to join', heading: 'Find your circle.', lede: 'Follow creators, keep a library and join circles. Joining is free during early access and nothing is charged.' },
  forgot: { title: 'Reset your password', kicker: 'Account recovery', heading: 'Reset your password.', lede: 'Enter the email you signed up with. We will send a link to choose a new password.' },
  reset: { title: 'Choose a new password', kicker: 'Account recovery', heading: 'Choose a new password.', lede: `Use at least ${PASSWORD_MIN} characters. You stay signed in afterwards.` }
};

// An email address typed on one page that the next page can start with ("sign in with this email"). Kept in memory only:
// an address never goes into a URL.
let carriedEmail = '';
const carry = email => { carriedEmail = String(email || '').trim().slice(0, 254); };
const takeCarried = () => { const email = carriedEmail; carriedEmail = ''; return email; };

// Where a person lands after signing in: the `next` they came with, unless it is one of the pages they could not see signed in.
const landingPath = next => {
  const target = safeNext(next);
  return target && !GUEST_PATHS.includes(target.split(/[?#]/)[0]) ? target : paths.home;
};

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError, RangeError];
const messageOf = error => (PROGRAMMING_ERRORS.some(type => error instanceof type) ? GENERIC_ERROR : error?.message || GENERIC_ERROR);

// Resolves true once the store knows the signed-in account (sign-in events reach it a moment after api.signIn resolves).
function untilSignedIn(store, ms) {
  if (store.state.user) return Promise.resolve(true);
  return new Promise(resolve => {
    let stop = () => {};
    const timer = setTimeout(() => done(false), ms);
    function done(ok) { clearTimeout(timer); stop(); resolve(ok); }
    stop = store.subscribe(state => { if (state.user) done(true); });
  });
}

// --- Validation -----------------------------------------------------------------

function validate(mode, values) {
  const errors = {};
  if (mode === 'signup') {
    if (!values.name) errors.name = 'Enter your name.';
    else if (values.name.length > NAME_MAX) errors.name = `Your name can be at most ${NAME_MAX} characters.`;
  }
  if (mode !== 'reset') {
    if (!values.email) errors.email = 'Enter your email address.';
    else if (!EMAIL.test(values.email)) errors.email = 'Enter a valid email address, such as name@example.com.';
  }
  if (mode === 'login' && !values.password) errors.password = 'Enter your password.';
  if (mode === 'signup' || mode === 'reset') {
    if (!values.password) errors.password = mode === 'reset' ? 'Choose a new password.' : 'Choose a password.';
    else if (values.password.length < PASSWORD_MIN) errors.password = `Use at least ${PASSWORD_MIN} characters.`;
    else if (values.password.length > PASSWORD_MAX) errors.password = `Use at most ${PASSWORD_MAX} characters.`;
  }
  if (mode === 'reset' && !errors.password) {
    if (!values.confirm) errors.confirm = 'Type the new password again.';
    else if (values.confirm !== values.password) errors.confirm = 'The two passwords do not match.';
  }
  return errors;
}

// --- Markup ---------------------------------------------------------------------

function field({ id, name, label, type = 'text', value = '', autocomplete, help, maxlength, password = false, hints = '' }) {
  const described = [help && `${id}-help`, `${id}-error`].filter(Boolean).join(' ');
  return html`<div class="field" data-field="${name}">
    <label for="${id}">${label}</label>
    <input id="${id}" name="${name}" type="${type}" value="${value}" autocomplete="${autocomplete}" maxlength="${maxlength}" aria-describedby="${described}"${password && raw(' data-password')}${raw(hints)}>
    ${help && html`<p class="field-help" id="${id}-help">${help}</p>`}
    <p class="field-error" id="${id}-error" hidden></p>
  </div>`;
}

const EMAIL_HINTS = ' inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false"';

const nameField = values => field({ id: 'auth-name', name: 'name', label: 'Your name', value: values.name, autocomplete: 'name', maxlength: NAME_MAX, hints: ' autocapitalize="words"' });
const emailField = values => field({ id: 'auth-email', name: 'email', label: 'Email', type: 'email', value: values.email, autocomplete: 'email', maxlength: 254, hints: EMAIL_HINTS });
const showPassword = html`<label class="check-label auth-show"><input type="checkbox" data-toggle-password> <span>Show password</span></label>`;

function formFields(data) {
  const { mode, values } = data;
  if (mode === 'signup') {
    return html`${nameField(values)}${emailField(values)}${field({ id: 'auth-password', name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', maxlength: PASSWORD_MAX, password: true, help: `At least ${PASSWORD_MIN} characters.` })}${showPassword}`;
  }
  if (mode === 'login') {
    return html`${emailField(values)}${field({ id: 'auth-password', name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password', maxlength: PASSWORD_MAX, password: true })}${showPassword}`;
  }
  if (mode === 'forgot') return emailField(values);
  return html`${field({ id: 'auth-password', name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password', maxlength: PASSWORD_MAX, password: true, help: `At least ${PASSWORD_MIN} characters.` })}${field({ id: 'auth-confirm', name: 'confirm', label: 'Repeat the new password', type: 'password', autocomplete: 'new-password', maxlength: PASSWORD_MAX, password: true })}${showPassword}`;
}

const SUBMIT = {
  login: { label: 'Sign in', glyph: 'arrow' },
  signup: { label: 'Create free account', glyph: 'arrow' },
  forgot: { label: 'Send reset link', glyph: 'send' },
  reset: { label: 'Save new password', glyph: 'check' }
};

function formLinks(data) {
  const { mode, next } = data;
  if (mode === 'login') {
    return html`<a class="text-link" href="${paths.signup(next)}">Create a free account</a><a class="text-link" href="${paths.forgot}" data-carry-email>Forgot your password?</a>`;
  }
  if (mode === 'signup') return html`<a class="text-link" href="${paths.login(next)}" data-carry-email>I already have an account</a>`;
  if (mode === 'forgot') return html`<a class="text-link" href="${paths.login(next)}" data-carry-email>Back to sign in</a>`;
  return html`<button type="button" class="text-button" data-skip-reset>Not now</button>`;
}

function formMarkup(data) {
  const submit = SUBMIT[data.mode];
  return html`<form class="auth-form" data-auth-form novalidate>
    ${formFields(data)}
    <p class="form-error" id="auth-form-error" role="alert" data-form-error></p>
    <div class="auth-extra" data-extra></div>
    <button type="submit" class="button auth-submit"><span>${submit.label}</span>${icon(submit.glyph, 14)}</button>
    <div class="auth-links">${formLinks(data)}</div>
  </form>`;
}

const resendButton = () => button('Resend email', { variant: 'secondary', size: 'small', attrs: { 'data-resend': true } });

function sentMarkup(data) {
  const forgot = data.mode === 'forgot';
  return html`<div class="auth-sent">
    <p class="auth-address">${icon('send', 16)}<strong>${data.email}</strong></p>
    <p class="field-help">${forgot ? 'The link works for a short time. Check your spam folder if it does not arrive.' : 'Open the link on this device to finish. Check your spam folder if it does not arrive.'}</p>
    <div class="auth-actions">${resendButton()}<button type="button" class="text-button" data-use-other>Use a different email</button></div>
    <p class="auth-status" role="status" data-status></p>
    <div class="auth-links">${forgot ? html`<a class="text-link" href="${paths.login(data.next)}">Back to sign in</a>` : html`<a class="text-link" href="${paths.login(data.next)}" data-carry-email>I have confirmed, sign in</a>`}</div>
  </div>`;
}

function headingOf(data) {
  const copy = COPY[data.mode];
  if (data.stage !== 'sent') return { kicker: copy.kicker, heading: copy.heading, lede: data.mode === 'login' && data.next ? copy.ledeNext : copy.lede };
  return data.mode === 'forgot'
    ? { kicker: 'Account recovery', heading: 'Check your email.', lede: 'If an account exists for this address, a link to choose a new password is on its way. It can take a minute to arrive.' }
    : { kicker: 'Almost there', heading: 'Check your email.', lede: 'We sent a confirmation link to the address below. Follow it to finish creating your account.' };
}

function noticeMarkup(data) {
  if (!data.notice) return '';
  const again = data.mode === 'login' || data.mode === 'signup';
  return html`<div class="notice auth-notice" role="alert"><p>${data.notice.message}</p>${again && html`<p><a class="text-link" href="${paths.forgot}">Send me a new link</a></p>`}</div>`;
}

// --- The page ---------------------------------------------------------------------

export default {
  title: (ctx, data) => (data?.stage === 'sent' ? 'Check your email' : COPY[modeOf(ctx.path)].title),
  auth: 'guest',

  load(ctx) {
    const mode = modeOf(ctx.path);
    return {
      mode,
      next: safeNext(ctx.query.next),
      stage: 'form',
      values: { name: '', email: mode === 'reset' ? '' : takeCarried() },
      notice: mode === 'reset' ? null : takeAuthError(),
      email: '', // where the last email went (the "check your email" state)
      resendTo: '', // who a "Resend" belongs to
      cooldownUntil: 0,
      focus: ''
    };
  },

  render(ctx, data) {
    const { kicker, heading, lede } = headingOf(data);
    return html`<section class="auth" aria-labelledby="auth-title">
      <div class="auth-panel">
        <a class="wordmark auth-wordmark" href="${paths.home}" aria-label="REFLUENZ, home">REFLUENZ</a>
        <div class="auth-body">
          <p class="eyebrow bronze">${kicker}</p>
          <h1 id="auth-title" tabindex="-1">${heading}</h1>
          <p class="auth-lede">${lede}</p>
          ${noticeMarkup(data)}
          ${data.stage === 'sent' ? sentMarkup(data) : formMarkup(data)}
        </div>
        <p class="eyebrow muted auth-foot">Early access. Free to join, nothing is charged.</p>
      </div>
      <figure class="auth-picture"><img src="${presetUrl('atelier')}" alt="A monochrome study of a sculptural coat in an atelier" decoding="async"><figcaption class="eyebrow">The digital atelier</figcaption></figure>
    </section>`;
  },

  mount(el, ctx, data) {
    const { api, store } = ctx;
    let busy = false;
    let resending = false;
    let disposed = false;
    let tick = null;

    // A focus page: the shell hides its sidebar and bars while this one is open (styles/auth.css).
    const shell = el.closest('.shell');
    shell?.classList.add('shell--focus');

    const input = name => el.querySelector(`[name="${name}"]`);

    // --- Errors in place -------------------------------------------------------------

    function setFieldError(name, message) {
      const control = input(name);
      const slot = el.querySelector(`#${control?.id}-error`);
      if (!control || !slot) return;
      control.setAttribute('aria-invalid', 'true');
      slot.textContent = message;
      slot.hidden = false;
    }

    function clearFieldError(control) {
      control.removeAttribute('aria-invalid');
      const slot = el.querySelector(`#${control.id}-error`);
      if (slot) { slot.textContent = ''; slot.hidden = true; }
    }

    function setFormError(message, extra = '') {
      const slot = el.querySelector('[data-form-error]');
      const more = el.querySelector('[data-extra]');
      if (slot) slot.textContent = message;
      if (more) more.innerHTML = extra ? extra.value : '';
      refreshCooldown();
    }

    const clearFormError = () => setFormError('');

    function setStatus(message, failed = false) {
      for (const slot of el.querySelectorAll('[data-status]')) {
        slot.textContent = message;
        slot.classList.toggle('is-error', failed);
      }
    }

    // --- Resend with a cooldown -------------------------------------------------------

    function refreshCooldown() {
      clearTimeout(tick);
      const left = data.cooldownUntil - Date.now();
      for (const control of el.querySelectorAll('[data-resend]')) {
        if (control.dataset.busy) continue;
        control.disabled = left > 0;
        const label = control.querySelector('span');
        if (label) label.textContent = left > 0 ? `Resend in ${Math.ceil(left / 1000)} s` : 'Resend email';
      }
      if (left > 0) {
        tick = setTimeout(refreshCooldown, Math.min(1000, left));
        tick?.unref?.();
      }
    }

    async function onResend(event, control) {
      event.preventDefault();
      if (resending || Date.now() < data.cooldownUntil || !data.resendTo) return;
      resending = true;
      setBusy(control, true);
      setStatus('');
      const address = data.resendTo;
      try {
        await (data.mode === 'forgot' ? api.resetPassword(address) : api.resendConfirmation(address));
        data.cooldownUntil = Date.now() + timing.cooldownMs;
        if (!disposed) setStatus(`We sent another email to ${address}.`);
      } catch (error) {
        if (!disposed) setStatus(messageOf(error), true);
      } finally {
        resending = false;
        setBusy(control, false);
        if (!disposed) refreshCooldown();
      }
    }

    // --- Finishing -------------------------------------------------------------------

    // The router signs the person in on its own (a guest page redirects a signed-in visitor); this covers the case where the
    // account was slow to load, and tells the person when it never did.
    async function finishSignIn() {
      const known = await untilSignedIn(store, timing.signInWaitMs);
      if (disposed) return;
      if (!known) {
        setFormError('You are signed in, but your account could not be loaded. Reload the page to continue.');
        return;
      }
      await ctx.router.idle?.();
      if (!disposed && globalThis.location?.pathname === ctx.path) ctx.navigate(landingPath(data.next), { replace: true });
    }

    function showSent(email) {
      data.stage = 'sent';
      data.email = email;
      data.resendTo = email;
      data.cooldownUntil = Date.now() + timing.cooldownMs;
      data.focus = 'title';
      ctx.rerender(data);
    }

    const actions = {
      async login({ email, password }) {
        await api.signIn(email, password);
        if (disposed) return;
        toast('Welcome back.', { tone: 'success' });
        await finishSignIn();
      },
      async signup({ name, email, password }) {
        const { confirmed } = await api.signUp(email, password, name);
        if (disposed) return;
        if (confirmed) {
          toast('Your account is ready.', { tone: 'success' });
          await finishSignIn();
        } else showSent(email);
      },
      async forgot({ email }) {
        await api.resetPassword(email);
        if (!disposed) showSent(email);
      },
      async reset({ password }) {
        await api.updatePassword(password);
        if (disposed) return;
        store.setRecovery(false);
        toast('Your password is updated.', { tone: 'success' });
        ctx.navigate(paths.home, { replace: true });
      }
    };

    // What went wrong, said so that the next step is clear.
    function showFailure(error, values) {
      const message = messageOf(error);
      let extra = '';
      let focus = null;
      if (data.mode === 'login' && (/confirm your email/i.test(message) || error?.cause?.code === 'email_not_confirmed')) {
        data.resendTo = values.email;
        extra = html`<p class="auth-extra-text">Did the email not arrive?</p>${resendButton()}<p class="auth-status" role="status" data-status></p>`;
      } else if (data.mode === 'login') {
        focus = input('password');
      } else if (data.mode === 'signup' && /already (exists|registered)/i.test(message)) {
        extra = html`<button type="button" class="button secondary small" data-sign-in-with>Sign in with this email</button>`;
        focus = input('email');
      } else if (data.mode === 'reset' && /session|expired|sign in again/i.test(message)) {
        extra = html`<a class="text-link" href="${paths.forgot}">Request a new link</a>`;
      }
      setFormError(message, extra);
      focus?.focus();
      try { if (focus?.type === 'password') focus.select(); } catch { /* selection is a convenience */ }
    }

    // --- Events ----------------------------------------------------------------------

    const read = formEl => {
      const get = name => formEl.querySelector(`[name="${name}"]`)?.value ?? '';
      return { name: get('name').trim(), email: get('email').trim(), password: get('password'), confirm: get('confirm') };
    };

    async function onSubmit(event, formEl) {
      event.preventDefault();
      if (busy) return;
      clearFormError();
      for (const control of formEl.querySelectorAll('[aria-invalid]')) clearFieldError(control);
      const values = read(formEl);
      data.values = { name: values.name, email: values.email }; // never the password
      const errors = validate(data.mode, values);
      const first = Object.keys(errors)[0];
      if (first) {
        for (const [name, message] of Object.entries(errors)) setFieldError(name, message);
        input(first)?.focus();
        return;
      }
      busy = true;
      const submit = formEl.querySelector('[type="submit"]');
      setBusy(submit, true);
      formEl.setAttribute('aria-busy', 'true');
      try {
        await actions[data.mode](values);
      } catch (error) {
        if (!disposed) showFailure(error, values);
      } finally {
        busy = false;
        setBusy(submit, false);
        formEl.removeAttribute('aria-busy');
      }
    }

    const removers = [
      delegate(el, 'submit', '[data-auth-form]', onSubmit),
      delegate(el, 'input', '[data-auth-form] input', (event, control) => {
        if (control.hasAttribute('aria-invalid')) clearFieldError(control);
        if (event.target?.type !== 'checkbox') clearFormError();
      }),
      delegate(el, 'change', '[data-toggle-password]', (event, toggle) => {
        for (const control of el.querySelectorAll('input[data-password]')) control.type = toggle.checked ? 'text' : 'password';
      }),
      delegate(el, 'click', '[data-resend]', onResend),
      delegate(el, 'click', '[data-use-other]', () => {
        data.stage = 'form';
        data.focus = 'email';
        ctx.rerender(data);
      }),
      // The address typed here is offered on the next page; the link itself is followed as usual.
      delegate(el, 'click', '[data-carry-email]', () => carry(input('email')?.value || data.email)),
      delegate(el, 'click', '[data-sign-in-with]', event => {
        event.preventDefault();
        carry(data.values.email);
        ctx.navigate(paths.login(data.next));
      }),
      delegate(el, 'click', '[data-skip-reset]', event => {
        event.preventDefault();
        store.setRecovery(false);
        ctx.navigate(paths.home, { replace: true });
      })
    ];

    // After a redraw the router puts the focus back where it was; this runs after that, so the new page's own focus target wins.
    const focusTarget = data.focus;
    data.focus = '';
    if (focusTarget) {
      queueMicrotask(() => {
        if (disposed) return;
        if (focusTarget === 'title') el.querySelector('#auth-title')?.focus();
        else input(focusTarget)?.focus();
      });
    }
    refreshCooldown();

    return () => {
      disposed = true;
      shell?.classList.remove('shell--focus');
      clearTimeout(tick);
      removers.forEach(remove => remove());
    };
  }
};
