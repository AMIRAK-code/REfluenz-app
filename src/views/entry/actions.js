// Sharing and reporting, the two actions of the post page that open something of their own.

import { html, modal, setBusy, toast } from '../../core/ui.js';
import { paths } from '../../core/paths.js';

// [value the api accepts, what the person reads]
export const REPORT_REASONS = [
  ['spam', 'Spam or a scam'],
  ['harassment', 'Harassment or hate'],
  ['nudity', 'Nudity or sexual content'],
  ['violence', 'Violence or dangerous acts'],
  ['copyright', 'Copyright'],
  ['other', 'Something else']
];

export const REPORT_DETAILS_MAX = 1000;

// The absolute address of a post, for sharing.
export const postUrl = entry => new URL(paths.entry(entry.id), globalThis.location.origin).href;

const coarsePointer = () => {
  try { return Boolean(globalThis.matchMedia?.('(pointer: coarse)')?.matches); } catch { return false; }
};

// Phones and tablets get the system share sheet; on a desktop the link is copied, which is what people expect there.
// When the clipboard is not available either, the link is shown in a dialog so it can be copied by hand.
export async function sharePost(entry) {
  const url = postUrl(entry);
  const nav = globalThis.navigator;
  if (typeof nav?.share === 'function' && coarsePointer()) {
    try {
      await nav.share({ title: entry.title, url });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await nav.clipboard.writeText(url);
    toast('Link copied to the clipboard.', { tone: 'success' });
    return 'copied';
  } catch {
    modal.open({
      title: 'Copy the link',
      body: html`<div class="field"><label for="share-url">Link to this post</label><input id="share-url" type="text" readonly value="${url}"></div>`,
      onMount: dialog => { dialog.querySelector('#share-url')?.select?.(); }
    });
    return 'manual';
  }
}

// subject: 'post' | 'comment' (the word used in the dialog), targetType: 'entry' | 'comment'.
// Guests are asked to sign in first. A failed report keeps the dialog open with what was typed.
export function openReport({ api, store }, { targetType, targetId, subject }) {
  if (!store.requireAuth(`Sign in to report this ${subject}.`)) return null;
  return modal.open({
    title: `Report this ${subject}`,
    className: 'post-report',
    body: html`<form data-report-form novalidate>
      <p>Tell us what is wrong. Reports go to the REFLUENZ team, and the author is not told who sent one.</p>
      <div class="field">
        <label for="report-reason">Reason</label>
        <select id="report-reason" name="reason"><option value="">Choose a reason</option>${REPORT_REASONS.map(([value, label]) => html`<option value="${value}">${label}</option>`)}</select>
      </div>
      <div class="field">
        <label for="report-details">Details <span class="muted">(optional)</span></label>
        <textarea id="report-details" name="details" rows="4" maxlength="${REPORT_DETAILS_MAX}"></textarea>
      </div>
      <p class="form-error" data-form-error role="alert"></p>
      <div class="dialog-actions">
        <button type="submit" class="button">Send report</button>
        <button type="button" class="button secondary" data-modal-close>Cancel</button>
      </div>
    </form>`,
    onMount(dialog, handle) {
      const form = dialog.querySelector('[data-report-form]');
      const problem = dialog.querySelector('[data-form-error]');
      const submit = form.querySelector('[type="submit"]');
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (submit.dataset.busy) return;
        const reason = form.querySelector('[name="reason"]').value;
        const details = form.querySelector('[name="details"]').value;
        problem.textContent = '';
        if (!reason) {
          problem.textContent = 'Choose a reason for the report.';
          form.querySelector('[name="reason"]').focus();
          return;
        }
        setBusy(submit, true);
        try {
          await api.report({ targetType, targetId, reason, details });
          handle.close();
          toast('Thank you. Your report has been sent to our team.', { tone: 'success' });
        } catch (error) {
          problem.textContent = error?.message || 'We could not send your report. Try again.';
        } finally {
          setBusy(submit, false);
        }
      });
    }
  });
}
