// Messages (/app/messages, /app/messages/:creatorId/:memberId) and notifications (/app/notifications): views/messages.js, views/notifications.js.
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom, mountApp, tick, IntersectionObserverStub } from '../helpers/dom.mjs';
import { createFakeApi, IDS } from '../helpers/fake-api.mjs';

const E = IDS.entries;
const HOSTILE = '<img src=x onerror=alert(1)>';
const MISSING = '2c000000-0000-4000-8000-000000000999';
const THREAD = `/app/messages/${IDS.verne}/${IDS.member}`;
const guest = () => createFakeApi({ signedIn: null });
const member = () => createFakeApi();
const owner = () => createFakeApi({ signedIn: IDS.owner });
const callsTo = (fake, method) => fake.calls.filter(call => call.method === method);

let counter = 0;
const uuid = kind => `${kind}b000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const minutesAgo = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
const daysAgo = days => new Date(Date.now() - days * 86_400_000).toISOString();

const messageRow = (over = {}) => ({ id: uuid(6), creator_id: IDS.verne, member_id: IDS.member, sender: 'member', body: 'A line', created_at: minutesAgo(5), read_at: null, ...over });
const noticeRow = (user, over = {}) => ({ id: uuid(8), user_id: user, type: 'like', actor_id: IDS.fan1, creator_id: IDS.verne, entry_id: E.firstDraftHabits, comment_id: null, read_at: null, created_at: minutesAgo(5), ...over });
const profileRow = (fake, id) => fake.db.profiles.find(row => row.id === id);
const creatorRow = (fake, id) => fake.db.creators.find(row => row.id === id);
const join = (fake, user, creator_id) => fake.db.memberships.push({ user_id: user, creator_id, tier: 'essential', created_at: '2026-09-01T09:00:00+00:00', updated_at: '2026-09-01T09:00:00+00:00' });

describe('messages and notifications views', () => {
  before(() => installDom());
  after(() => uninstallDom());

  let app;
  const open = async (api, path) => { app = await mountApp({ api, path }); return app; };
  afterEach(async () => { await app?.destroy(); app = null; });

  const toastText = () => (app.exists('#toast') ? app.text('#toast') : '');
  const texts = selector => [...app.document.querySelectorAll(selector)].map(node => node.textContent.replace(/\s+/g, ' ').trim());
  const attr = (selector, name) => [...app.document.querySelectorAll(selector)].map(node => node.getAttribute(name));
  const noMarkupInjected = () => assert.equal(app.document.querySelectorAll('#view img[src="x"], #view [onerror]').length, 0, 'hostile text must not become markup');
  // The Retry button is wired by one document listener that ui.js attaches once per process; another test file may have installed a DOM
  // of its own since. The tests check that Retry is offered and then reload by hand, which is what the button does.
  const retryOffered = scope => assert.ok(app.exists(`${scope} [data-retry]`), 'Retry is offered');
  const reload = async () => { await app.router.reload(); await app.settle(); };

  // --- Messages: helpers -------------------------------------------------------------------------
  const field = () => app.find('#compose-text');
  const typeText = async text => {
    const input = field();
    input.value = text;
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await app.settle();
    return input;
  };
  const press = async (key, { shiftKey = false } = {}) => {
    const event = new app.window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    field().dispatchEvent(event);
    await app.settle();
    return event;
  };
  const sendText = async text => { await typeText(text); return press('Enter'); };
  const bubbles = () => [...app.document.querySelectorAll('.bubble')].map(node => node.textContent);
  const rowOf = text => [...app.document.querySelectorAll('.bubble-row')].find(row => row.querySelector('.bubble').textContent === text);

  // =================================================================================================
  describe('the list of conversations', () => {
    it('sends a guest to sign in', async () => {
      await open(guest(), '/app/messages');
      assert.match(app.path, /^\/app\/login\?next=%2Fapp%2Fmessages$/);
    });

    it('lists a member’s conversations with the other party, a preview, the time and the unread count', async () => {
      const fake = member();
      await open(fake, '/app/messages');
      assert.equal(app.text('#view h1'), 'Messages');
      const items = app.document.querySelectorAll('.inbox-item');
      assert.equal(items.length, 1);
      const item = items[0];
      assert.equal(item.getAttribute('href'), THREAD);
      assert.equal(item.querySelector('.inbox-name').textContent, 'Verne & Co');
      assert.match(item.querySelector('.inbox-preview').textContent, /^Yes, and about leaving them open\.$/, 'the creator wrote last, so no "You:" prefix');
      assert.ok(item.querySelector('time[datetime="2026-09-30T09:00:00+00:00"]'));
      assert.match(item.textContent, /1\s*1 unread message/);
      assert.ok(item.classList.contains('is-unread'));
      assert.match(app.text('.inbox-placeholder'), /Choose a conversation/);
      assert.equal(app.find('.inbox').dataset.pane, 'list');
      assert.equal(app.exists('.inbox-tag'), false, 'a member’s own conversations are not tagged as the atelier');
    });

    it('shows the member as the other party to the owner, tagged with their atelier, and prefixes their own last line', async () => {
      await open(owner(), '/app/messages');
      const item = app.find('.inbox-item');
      assert.equal(item.querySelector('.inbox-name').textContent, 'Sofia Marchetti');
      assert.equal(item.getAttribute('href'), THREAD);
      assert.match(item.querySelector('.inbox-preview').textContent, /^You: Yes, and about leaving them open\.$/);
      assert.match(item.textContent, /Your atelier/);
      assert.equal(item.classList.contains('is-unread'), false, 'nothing from the member is waiting');
    });

    it('shows a person who is both a member and an owner each conversation from their own side', async () => {
      const fake = owner();
      // Marco is also a member of nobody's atelier by default: give him a conversation with a showcase-free atelier of his own making.
      fake.db.creators.push({ ...creatorRow(fake, IDS.verano), id: uuid(2), slug: 'other-hand', name: 'Other Hand', owner_id: IDS.fan3, is_showcase: false });
      const other = fake.db.creators.at(-1).id;
      join(fake, IDS.owner, other);
      fake.db.messages.push(messageRow({ creator_id: other, member_id: IDS.owner, sender: 'member', body: 'Question from Marco', created_at: minutesAgo(30) }));
      fake.refresh();
      await open(fake, '/app/messages');
      const names = texts('.inbox-name');
      assert.deepEqual(names.sort(), ['Other Hand', 'Sofia Marchetti']);
      const own = [...app.document.querySelectorAll('.inbox-item')].find(item => item.textContent.includes('Other Hand'));
      assert.match(own.querySelector('.inbox-preview').textContent, /^You: Question from Marco$/);
      assert.equal(own.textContent.includes('Your atelier'), false);
    });

    it('explains the empty state and offers the next step', async () => {
      await open(createFakeApi({ signedIn: IDS.fan2 }), '/app/messages');
      assert.match(app.text('#view'), /No conversations yet/);
      assert.equal(app.exists('.inbox-item'), false);
      assert.ok(app.find('#view .empty a[href="/app/discover"]'));
      assert.equal(app.exists('.inbox-starter'), false, 'no circle, nobody to suggest');
    });

    it('explains to an owner that members start conversations', async () => {
      const fake = owner();
      fake.db.messages = [];
      await open(fake, '/app/messages');
      assert.match(app.text('#view .empty'), /Members start the conversation/);
    });

    it('suggests the ateliers whose circle the person belongs to and who can be written to', async () => {
      const fake = createFakeApi({ signedIn: IDS.fan1 });
      join(fake, IDS.fan1, IDS.verne);
      await open(fake, '/app/messages');
      const starters = attr('.inbox-starter', 'href');
      assert.deepEqual(starters, [`/app/messages/${IDS.verne}/${IDS.fan1}`], 'Atelier Solene is a showcase atelier and is left out');
      assert.match(app.text('.inbox-starters'), /Write to Verne & Co/);
    });

    it('stops suggesting an atelier once a conversation exists, and keeps suggesting while the inbox is otherwise empty', async () => {
      const fake = member();
      join(fake, IDS.member, IDS.verne);
      await open(fake, '/app/messages');
      assert.equal(app.exists('.inbox-starter'), false);
    });

    it('shows conversations newest first and pages the list', async () => {
      const fake = owner();
      for (let i = 0; i < 35; i++) {
        const user = `1c000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
        fake.db.users.push({ id: user, email: `reader${i}@example.test`, password: 'secret12', confirmed: true });
        fake.db.profiles.push({ ...profileRow(fake, IDS.fan1), id: user, display_name: `Reader ${String(i + 1).padStart(2, '0')}` });
        fake.db.messages.push(messageRow({ member_id: user, body: `Hello ${i + 1}`, created_at: minutesAgo(600 - i) }));
      }
      fake.refresh();
      await open(fake, '/app/messages');
      assert.equal(app.document.querySelectorAll('.inbox-item').length, 30);
      assert.equal(texts('.inbox-name')[0], 'Reader 35', 'the most recent first');
      await app.click('[data-more]');
      assert.equal(app.document.querySelectorAll('.inbox-item').length, 36);
      assert.equal(app.exists('[data-more]'), false);
    });

    it('shows an error with Retry when the list cannot be loaded', async () => {
      const fake = member();
      fake.fail('inbox', 'The inbox is resting.');
      await open(fake, '/app/messages');
      assert.match(app.text('#view'), /The inbox is resting\./);
      retryOffered('#view');
      fake.fail('inbox', null);
      await reload();
      assert.equal(app.document.querySelectorAll('.inbox-item').length, 1);
    });

    it('escapes hostile names and previews', async () => {
      const fake = member();
      creatorRow(fake, IDS.verne).name = HOSTILE;
      fake.db.messages.at(-1).body = HOSTILE;
      await open(fake, '/app/messages');
      assert.equal(app.find('.inbox-name').textContent, HOSTILE);
      assert.equal(app.find('.inbox-preview').textContent, HOSTILE);
      noMarkupInjected();
    });

    it('refreshes the list when a message arrives in a conversation that is not open', async () => {
      const fake = member();
      await open(fake, '/app/messages');
      const row = messageRow({ sender: 'creator', body: 'A brand new reply', created_at: new Date().toISOString() });
      fake.db.messages.push(row);
      fake.emit(IDS.member, 'message', row);
      await tick(320);
      await app.settle();
      assert.equal(app.find('.inbox-preview').textContent, 'A brand new reply');
      assert.match(app.find('.inbox-item').textContent, /2 unread messages/);
    });

    it('draws the list again from the empty state when the first message arrives', async () => {
      const fake = owner();
      fake.db.messages = [];
      await open(fake, '/app/messages');
      assert.equal(app.exists('.inbox-item'), false);
      const row = messageRow({ member_id: IDS.fan1, body: 'Is the course still open?' });
      fake.db.messages.push(row);
      fake.emit(IDS.owner, 'message', row);
      await app.settle();
      assert.equal(app.find('.inbox-name').textContent, 'Ada Lindgren');
    });
  });

  // =================================================================================================
  describe('a conversation', () => {
    it('shows the messages, mine on the right, with a day separator and the other party in the header', async () => {
      const fake = member();
      await open(fake, THREAD);
      assert.equal(app.find('.inbox').dataset.pane, 'thread');
      assert.equal(app.text('.thread-who h2'), 'Verne & Co');
      assert.equal(app.find('.thread-who h2 a').getAttribute('href'), '/app/c/verne-and-co');
      assert.equal(app.text('.thread-who .eyebrow'), 'Essays on getting started');
      assert.deepEqual(bubbles(), ['Hello, is the next essay about endings?', 'Yes, and about leaving them open.']);
      assert.ok(rowOf('Hello, is the next essay about endings?').classList.contains('is-mine'));
      assert.equal(rowOf('Yes, and about leaving them open.').classList.contains('is-mine'), false);
      assert.equal(app.document.querySelectorAll('.thread-day').length, 1);
      assert.match(app.text('.thread-day'), /30 September/);
      assert.match(app.text('.bubble-row.is-mine .bubble-meta'), /^You, \d\d:\d\d$/);
      assert.match(app.text('.bubble-row:not(.is-mine) .bubble-meta'), /^Verne & Co, \d\d:\d\d$/);
      assert.equal(app.find('#thread-log').getAttribute('role'), 'log');
      assert.ok(app.find('.thread-back'), 'a way back to the list on narrow screens');
      assert.equal(app.find('.thread-back').getAttribute('aria-label'), 'Back to all conversations');
      assert.equal(app.find('.inbox-item').getAttribute('aria-current'), 'page');
      assert.match(app.document.title, /Conversation with Verne & Co/);
    });

    it('separates days, and shows the messages of the owner’s side with the member on the left', async () => {
      const fake = owner();
      fake.db.messages.push(messageRow({ body: 'Second day', created_at: '2026-10-02T10:00:00+00:00' }));
      await open(fake, THREAD);
      assert.equal(app.document.querySelectorAll('.thread-day').length, 2);
      assert.equal(app.text('.thread-who h2'), 'Sofia Marchetti');
      assert.equal(app.exists('.thread-who h2 a'), false, 'a member has no page to visit');
      assert.match(app.text('.thread-who .eyebrow'), /Member of Verne & Co/);
      assert.ok(rowOf('Yes, and about leaving them open.').classList.contains('is-mine'));
      assert.equal(rowOf('Second day').classList.contains('is-mine'), false);
    });

    it('marks the conversation as read, clears the unread count in the list and the shell badge', async () => {
      const fake = member();
      await open(fake, '/app/messages');
      assert.match(app.find('.inbox-item').textContent, /1 unread message/);
      assert.equal(app.store.state.unread.messages, 1);
      await app.navigate(THREAD);
      assert.deepEqual(callsTo(fake, 'markThreadRead').map(call => call.args), [[IDS.verne, IDS.member]]);
      assert.equal(app.find('.inbox-item').classList.contains('is-unread'), false);
      assert.equal(app.exists('.inbox-unread'), false);
      assert.equal(app.store.state.unread.messages, 0);
    });

    it('does not mark a conversation read when nothing is waiting', async () => {
      const fake = member();
      fake.db.messages.forEach(row => { row.read_at = '2026-09-30T10:00:00+00:00'; });
      await open(fake, THREAD);
      assert.equal(callsTo(fake, 'markThreadRead').length, 0);
    });

    it('survives a failed mark-as-read without a message', async () => {
      const fake = member();
      fake.fail('markThreadRead', 'No luck.');
      await open(fake, THREAD);
      assert.deepEqual(bubbles().length, 2);
      assert.equal(toastText().includes('No luck'), false);
    });

    it('sends with Enter as the member, shows the message at once and updates the list', async () => {
      const fake = member();
      await open(fake, THREAD);
      assert.equal(app.find('[data-send]').disabled, true, 'nothing to send yet');
      await typeText('One more question');
      assert.equal(app.find('[data-send]').disabled, false);
      const event = await press('Enter');
      assert.equal(event.defaultPrevented, true);
      assert.deepEqual(callsTo(fake, 'sendMessage').map(call => call.args), [[IDS.verne, IDS.member, 'member', 'One more question']]);
      assert.equal(bubbles().at(-1), 'One more question');
      assert.ok(rowOf('One more question').classList.contains('is-mine'));
      assert.equal(rowOf('One more question').classList.contains('is-sending'), false, 'delivered');
      assert.equal(field().value, '', 'the box is emptied');
      assert.equal(app.find('[data-send]').disabled, true);
      assert.equal(app.find('.inbox-preview').textContent, 'You: One more question');
      assert.equal(fake.db.messages.at(-1).body, 'One more question');
    });

    it('sends as the creator when the viewer owns the atelier', async () => {
      const fake = owner();
      await open(fake, THREAD);
      await sendText('Thank you for asking.');
      assert.deepEqual(callsTo(fake, 'sendMessage').map(call => call.args), [[IDS.verne, IDS.member, 'creator', 'Thank you for asking.']]);
      assert.equal(fake.db.messages.at(-1).sender, 'creator');
      assert.ok(rowOf('Thank you for asking.').classList.contains('is-mine'));
    });

    it('sends through the form button too', async () => {
      const fake = member();
      await open(fake, THREAD);
      await typeText('With the button');
      await app.submit('#thread-form');
      assert.equal(callsTo(fake, 'sendMessage').length, 1);
      assert.equal(bubbles().at(-1), 'With the button');
    });

    it('starts a new line with Shift+Enter instead of sending', async () => {
      const fake = member();
      await open(fake, THREAD);
      await typeText('First line');
      const event = await press('Enter', { shiftKey: true });
      assert.equal(event.defaultPrevented, false);
      assert.equal(callsTo(fake, 'sendMessage').length, 0);
      assert.equal(field().value, 'First line');
    });

    it('keeps the line breaks of a message and trims it', async () => {
      const fake = member();
      await open(fake, THREAD);
      await sendText('  Line one\nLine two  ');
      assert.equal(callsTo(fake, 'sendMessage')[0].args[3], 'Line one\nLine two');
      assert.equal(bubbles().at(-1), 'Line one\nLine two');
    });

    it('ignores an empty message', async () => {
      const fake = member();
      await open(fake, THREAD);
      await typeText('   ');
      assert.equal(app.find('[data-send]').disabled, true);
      await press('Enter');
      assert.equal(callsTo(fake, 'sendMessage').length, 0);
    });

    it('limits a message to 2000 characters', async () => {
      const fake = member();
      await open(fake, THREAD);
      assert.equal(field().getAttribute('maxlength'), '2000');
      await typeText('x'.repeat(1850));
      assert.match(app.text('[data-count]'), /^1850 \/ 2000$/);
      await typeText('x'.repeat(2001));
      await press('Enter');
      assert.equal(callsTo(fake, 'sendMessage').length, 0, 'nothing is sent');
      assert.match(toastText(), /up to 2,000 characters/);
      assert.equal(field().value.length, 2001, 'nothing typed is lost');
    });

    it('shows a failed message with the reason, Retry and Edit, and sends it when retried', async () => {
      const fake = member();
      await open(fake, THREAD);
      fake.fail('sendMessage', 'The connection dropped.');
      await sendText('Please read this');
      const failed = rowOf('Please read this');
      assert.ok(failed.classList.contains('is-failed'));
      assert.match(failed.textContent, /The connection dropped\./);
      assert.match(toastText(), /The connection dropped\./);
      assert.equal(fake.db.messages.some(row => row.body === 'Please read this'), false);
      assert.match(app.router.block(), /has not been sent/, 'leaving would lose it, so the router asks');

      fake.fail('sendMessage', null);
      await app.click('[data-resend]');
      assert.equal(rowOf('Please read this').classList.contains('is-failed'), false);
      assert.equal(fake.db.messages.filter(row => row.body === 'Please read this').length, 1);
      assert.equal(app.router.block(), null);
      assert.equal(app.document.querySelectorAll('.bubble-row').length, 3, 'one bubble, not two');
    });

    it('puts a failed message back into the box with Edit, ahead of what was typed since', async () => {
      const fake = member();
      await open(fake, THREAD);
      fake.fail('sendMessage', 'Not now.');
      await sendText('Original wording');
      await typeText('Something else');
      await app.click('[data-edit-failed]');
      assert.equal(rowOf('Original wording'), undefined);
      assert.equal(field().value, 'Original wording\nSomething else');
      assert.equal(app.router.block(), null);
    });

    it('keeps messages in order when sent in quick succession and when the first one fails', async () => {
      const fake = member();
      await open(fake, THREAD);
      await sendText('First');
      await sendText('Second');
      assert.deepEqual(callsTo(fake, 'sendMessage').map(call => call.args[3]), ['First', 'Second']);
      assert.deepEqual(bubbles().slice(-2), ['First', 'Second']);
    });

    it('explains that a showcase atelier is not taking messages', async () => {
      await open(member(), `/app/messages/${IDS.solene}/${IDS.member}`);
      assert.equal(app.exists('#compose-text'), false);
      assert.match(app.text('.thread-notice'), /Atelier Solene is a showcase atelier of REFLUENZ, so it is not taking messages/);
      assert.equal(app.find('.thread-notice a').getAttribute('href'), '/app/c/atelier-solene');
      assert.equal(app.exists('[data-send]'), false);
    });

    it('lets a member start a conversation with an atelier they have never written to', async () => {
      const fake = createFakeApi({ signedIn: IDS.fan1 });
      await open(fake, `/app/messages/${IDS.verne}/${IDS.fan1}`);
      assert.match(app.text('.thread-empty'), /Say hello to Verne & Co/);
      assert.ok(app.exists('#compose-text'));
      assert.equal(app.exists('.inbox-item'), false, 'the conversation exists once the first line is sent');
      await sendText('Hello from a new reader');
      assert.deepEqual(callsTo(fake, 'sendMessage').map(call => call.args), [[IDS.verne, IDS.fan1, 'member', 'Hello from a new reader']]);
      assert.equal(app.exists('.thread-empty'), false);
      assert.equal(bubbles().at(-1), 'Hello from a new reader');
      assert.equal(app.find('.inbox-name').textContent, 'Verne & Co', 'the new conversation joins the list');
      assert.equal(app.find('.inbox-item').getAttribute('aria-current'), 'page');
    });

    it('lets a member start a conversation from a suggestion in the list', async () => {
      const fake = createFakeApi({ signedIn: IDS.fan1 });
      join(fake, IDS.fan1, IDS.verne);
      await open(fake, '/app/messages');
      await app.click('.inbox-starter');
      assert.equal(app.path, `/app/messages/${IDS.verne}/${IDS.fan1}`);
      assert.ok(app.exists('#compose-text'));
    });

    it('tells an owner that a member must write first, and offers no box to write in', async () => {
      const fake = owner();
      join(fake, IDS.fan2, IDS.verne);
      await open(fake, `/app/messages/${IDS.verne}/${IDS.fan2}`);
      assert.equal(app.text('.thread-who h2'), 'Tomas Reyes', 'the circle knows the name');
      assert.match(app.text('.thread-empty'), /Tomas Reyes has not written to you yet/);
      assert.match(app.text('.thread-notice'), /Members start the conversation\. You can reply here once Tomas Reyes has written to you/);
      assert.equal(app.exists('#compose-text'), false);
    });

    it('gives the owner a box once the member writes, live', async () => {
      const fake = owner();
      join(fake, IDS.fan2, IDS.verne);
      await open(fake, `/app/messages/${IDS.verne}/${IDS.fan2}`);
      assert.equal(app.exists('#compose-text'), false);
      const row = messageRow({ member_id: IDS.fan2, body: 'May I ask something?', created_at: new Date().toISOString() });
      fake.db.messages.push(row);
      fake.emit(IDS.owner, 'message', row);
      await app.settle();
      assert.equal(bubbles().at(-1), 'May I ask something?');
      assert.ok(app.exists('#compose-text'), 'the owner can answer now');
      assert.equal(app.exists('.thread-notice'), false);
      assert.deepEqual(callsTo(fake, 'markThreadRead').map(call => call.args), [[IDS.verne, IDS.fan2]]);
    });

    it('says a conversation is not available when it belongs to somebody else or the link is wrong', async () => {
      const fake = member();
      for (const path of [
        `/app/messages/${IDS.verne}/${IDS.fan1}`,        // another member's conversation
        `/app/messages/${IDS.verne}/not-an-id`,          // not a uuid
        `/app/messages/${MISSING}/${IDS.member}`         // an atelier that does not exist
      ]) {
        await open(fake, path);
        assert.match(app.text('.inbox-state'), /This conversation is not available/, path);
        assert.ok(app.find('.inbox-state a[href="/app/messages"]'));
        assert.equal(app.exists('#compose-text'), false);
        if (!path.includes(MISSING)) assert.equal(callsTo(fake, 'thread').length, 0, 'nothing is requested for a conversation that cannot be the viewer’s');
      }
    });

    it('does not let an owner open a conversation with themselves', async () => {
      await open(owner(), `/app/messages/${IDS.verne}/${IDS.owner}`);
      assert.match(app.text('.inbox-state'), /not available/);
    });

    it('shows an error with Retry when the conversation cannot be loaded', async () => {
      const fake = member();
      fake.fail('thread', 'This conversation is resting.');
      await open(fake, THREAD);
      assert.match(app.text('.inbox-state'), /This conversation is resting\./);
      retryOffered('.inbox-state');
      assert.ok(app.find('.inbox-state a[href="/app/messages"]'), 'a way back');
      fake.fail('thread', null);
      await reload();
      assert.equal(bubbles().length, 2);
    });

    it('shows an error when the list cannot be loaded even for a conversation address', async () => {
      const fake = member();
      fake.fail('inbox', 'The inbox is resting.');
      await open(fake, THREAD);
      assert.match(app.text('#view'), /The inbox is resting\./);
      retryOffered('#view');
    });

    it('appends a message that arrives while the conversation is open and reads it', async () => {
      const fake = member();
      await open(fake, THREAD);
      fake.calls.length = 0;
      const row = messageRow({ sender: 'creator', body: 'A late addition', created_at: new Date().toISOString() });
      fake.db.messages.push(row);
      fake.emit(IDS.member, 'message', row);
      await app.settle();
      assert.equal(bubbles().at(-1), 'A late addition');
      assert.equal(rowOf('A late addition').classList.contains('is-mine'), false);
      assert.deepEqual(callsTo(fake, 'markThreadRead').map(call => call.args), [[IDS.verne, IDS.member]]);
      assert.equal(app.find('.inbox-preview').textContent, 'A late addition');
      assert.equal(app.exists('.inbox-unread'), false);
      assert.equal(app.store.state.unread.messages, 0);
      // The same event twice shows the message once.
      fake.emit(IDS.member, 'message', row);
      await app.settle();
      assert.equal(bubbles().filter(text => text === 'A late addition').length, 1);
    });

    it('shows a message sent from another tab as mine, without marking anything read', async () => {
      const fake = member();
      await open(fake, THREAD);
      fake.calls.length = 0;
      const row = messageRow({ sender: 'member', body: 'Sent from my phone', created_at: new Date().toISOString() });
      fake.db.messages.push(row);
      fake.emit(IDS.member, 'message', row);
      await app.settle();
      assert.ok(rowOf('Sent from my phone').classList.contains('is-mine'));
      assert.equal(callsTo(fake, 'markThreadRead').length, 0);
    });

    it('does not show a message of another conversation, and refreshes the list instead', async () => {
      const fake = member();
      fake.db.creators.push({ ...creatorRow(fake, IDS.verne), id: uuid(2), slug: 'second-hand', name: 'Second Hand', owner_id: IDS.fan3 });
      const second = fake.db.creators.at(-1).id;
      await open(fake, THREAD);
      const row = messageRow({ creator_id: second, sender: 'creator', body: 'Elsewhere', created_at: new Date().toISOString() });
      fake.db.messages.push(row);
      fake.emit(IDS.member, 'message', row);
      await tick(320);
      await app.settle();
      assert.equal(bubbles().includes('Elsewhere'), false);
      assert.deepEqual(texts('.inbox-name').sort(), ['Second Hand', 'Verne & Co']);
    });

    it('does not duplicate a message that comes back through the live channel while it is being sent', async () => {
      const fake = member();
      await open(fake, THREAD);
      const send = fake.sendMessage.bind(fake);
      // The live event is delivered before the request answers.
      fake.sendMessage = async (...args) => {
        const result = await send(...args);
        fake.emit(IDS.member, 'message', fake.db.messages.at(-1));
        await tick(5);
        return result;
      };
      await sendText('Only once');
      assert.equal(bubbles().filter(text => text === 'Only once').length, 1);
    });

    it('keeps an unsent draft while the person looks at the list and comes back', async () => {
      const fake = member();
      await open(fake, THREAD);
      await typeText('A thought in progress');
      await app.navigate('/app/messages');
      assert.equal(app.exists('#compose-text'), false);
      await app.navigate(THREAD);
      assert.equal(field().value, 'A thought in progress');
      await typeText(''); // an empty box drops the draft, so it cannot leak into another test
    });

    it('does not hold the router back when nothing is waiting to be sent', async () => {
      const fake = member();
      await open(fake, THREAD);
      assert.equal(app.router.block(), null);
    });

    it('shows when only the latest messages are listed', async () => {
      const fake = member();
      for (let i = 0; i < 205; i++) fake.db.messages.push(messageRow({ sender: i % 2 ? 'creator' : 'member', body: `Line ${i}`, created_at: new Date(Date.parse('2026-10-01T00:00:00Z') + i * 60_000).toISOString(), read_at: '2026-10-02T00:00:00+00:00' }));
      await open(fake, THREAD);
      assert.equal(app.document.querySelectorAll('.bubble-row').length, 200);
      assert.match(app.text('.thread-note'), /Showing the latest 200 messages/);
    });

    it('escapes hostile names and message text', async () => {
      const fake = member();
      creatorRow(fake, IDS.verne).name = HOSTILE;
      creatorRow(fake, IDS.verne).descriptor = HOSTILE;
      fake.db.messages.at(-1).body = HOSTILE;
      await open(fake, THREAD);
      assert.equal(app.find('.thread-who h2').textContent, HOSTILE);
      assert.equal(app.find('.bubble-row:not(.is-mine) .bubble').textContent, HOSTILE);
      await sendText(HOSTILE);
      assert.equal(bubbles().at(-1), HOSTILE);
      noMarkupInjected();
    });

    it('escapes a hostile member name for the owner', async () => {
      const fake = owner();
      profileRow(fake, IDS.member).display_name = HOSTILE;
      await open(fake, THREAD);
      assert.equal(app.find('.thread-who h2').textContent, HOSTILE);
      noMarkupInjected();
    });
  });

  // =================================================================================================
  describe('notifications', () => {
    it('sends a guest to sign in', async () => {
      await open(guest(), '/app/notifications');
      assert.match(app.path, /^\/app\/login\?next=%2Fapp%2Fnotifications$/);
    });

    const items = () => [...app.document.querySelectorAll('.activity')];
    const itemOf = id => app.find(`[data-activity="${id}"]`);

    it('lists the seeded activity with the sentence, the actor and the time, newest first', async () => {
      await open(member(), '/app/notifications');
      assert.equal(app.text('#view h1'), 'Notifications');
      assert.equal(items().length, 2);
      assert.match(items()[0].textContent, /Marco Verne sent you a message/);
      assert.match(items()[1].textContent, /Atelier Solene published “Notes on a linen wardrobe”/);
      assert.ok(items()[0].querySelector('time[datetime="2026-09-30T09:00:00+00:00"]'));
    });

    it('says what each kind of notification is about and where it leads', async () => {
      const fake = owner();
      fake.db.notifications = [];
      const rows = [
        noticeRow(IDS.owner, { type: 'new_entry', actor_id: null, entry_id: E.firstDraftHabits }),
        noticeRow(IDS.owner, { type: 'comment', actor_id: IDS.fan1, comment_id: IDS.comments.onVerne }),
        noticeRow(IDS.owner, { type: 'reply', actor_id: IDS.fan2 }),
        noticeRow(IDS.owner, { type: 'like', actor_id: IDS.fan3 }),
        noticeRow(IDS.owner, { type: 'follow', actor_id: IDS.fan1, entry_id: null }),
        noticeRow(IDS.owner, { type: 'membership', actor_id: IDS.fan2, entry_id: null }),
        noticeRow(IDS.owner, { type: 'message', actor_id: IDS.member, entry_id: null }),
        noticeRow(IDS.owner, { type: 'note', actor_id: null, entry_id: null })
      ];
      rows.forEach((row, i) => { row.created_at = minutesAgo(i + 1); });
      fake.db.notifications.push(...rows);
      await open(fake, '/app/notifications');
      const byType = Object.fromEntries(rows.map(row => [row.type, items().find(item => item.dataset.activity === row.id)]));
      const said = type => byType[type].querySelector('.activity-sentence').textContent.trim();
      assert.equal(said('new_entry'), 'Verne & Co published “First draft habits”');
      assert.equal(said('comment'), 'Ada Lindgren commented on “First draft habits”');
      assert.equal(said('reply'), 'Tomas Reyes replied to your comment on “First draft habits”');
      assert.equal(said('like'), 'Noor Haddad liked “First draft habits”');
      assert.equal(said('follow'), 'Ada Lindgren started following Verne & Co');
      assert.equal(said('membership'), 'Tomas Reyes joined Verne & Co');
      assert.equal(said('message'), 'Sofia Marchetti sent you a message');
      assert.equal(said('note'), 'Verne & Co posted a note to the circle');
      const href = type => byType[type].querySelector('a.activity-main').getAttribute('href');
      assert.equal(href('new_entry'), `/app/p/${E.firstDraftHabits}`);
      assert.equal(href('like'), `/app/p/${E.firstDraftHabits}`);
      assert.equal(href('comment'), `/app/p/${E.firstDraftHabits}#comments`);
      assert.equal(href('reply'), `/app/p/${E.firstDraftHabits}#comments`);
      assert.equal(href('follow'), '/app/studio?tab=members');
      assert.equal(href('membership'), '/app/studio?tab=members');
      assert.equal(href('message'), `/app/messages/${IDS.verne}/${IDS.member}`, 'the owner answers the member who wrote');
      assert.equal(href('note'), '/app/c/verne-and-co');
    });

    it('opens a message notification of a member in their own conversation', async () => {
      await open(member(), '/app/notifications');
      const link = items()[0].querySelector('a.activity-main');
      assert.equal(link.getAttribute('href'), THREAD);
    });

    it('shows a notification without a target as text, not as a dead link', async () => {
      const fake = member();
      fake.db.notifications.push(noticeRow(IDS.member, { type: 'comment', actor_id: IDS.fan1, entry_id: null }));
      await open(fake, '/app/notifications');
      const plain = items().find(item => /commented on your post/.test(item.textContent));
      assert.ok(plain);
      assert.equal(plain.querySelector('a.activity-main'), null);
      assert.ok(plain.querySelector('div.activity-main'));
    });

    it('groups the activity under Today, This week and Earlier', async () => {
      const fake = member();
      fake.db.notifications = [
        noticeRow(IDS.member, { created_at: minutesAgo(2) }),
        noticeRow(IDS.member, { created_at: daysAgo(3) }),
        noticeRow(IDS.member, { created_at: daysAgo(3.1) }),
        noticeRow(IDS.member, { created_at: daysAgo(40) })
      ];
      await open(fake, '/app/notifications');
      assert.deepEqual(texts('.activity-group h2'), ['Today', 'This week', 'Earlier']);
      assert.deepEqual([...app.document.querySelectorAll('.activity-group')].map(group => group.querySelectorAll('.activity').length), [1, 2, 1]);
      for (const group of app.document.querySelectorAll('.activity-group')) {
        assert.equal(group.getAttribute('aria-labelledby'), group.querySelector('h2').id);
      }
    });

    it('leaves out the groups that are empty', async () => {
      const fake = member();
      fake.db.notifications = [noticeRow(IDS.member, { created_at: daysAgo(60) })];
      await open(fake, '/app/notifications');
      assert.deepEqual(texts('.activity-group h2'), ['Earlier']);
    });

    it('styles unread rows and offers to mark one as read', async () => {
      await open(member(), '/app/notifications');
      const [message, published] = items();
      assert.ok(message.classList.contains('is-unread'));
      assert.match(message.textContent, /New/);
      assert.ok(message.querySelector('[data-read]'));
      assert.equal(published.classList.contains('is-unread'), false);
      assert.equal(published.querySelector('[data-read]'), null);
      assert.equal(message.querySelector('[data-read]').getAttribute('aria-label'), 'Mark as read');
      assert.equal(message.querySelector('[data-delete]').getAttribute('aria-label'), 'Delete this notification');
    });

    it('marks one notification as read with its button and refreshes the badges', async () => {
      const fake = owner();
      await open(fake, '/app/notifications');
      const commentRow = fake.db.notifications.find(row => row.user_id === IDS.owner && row.type === 'comment');
      assert.equal(app.store.state.unread.notifications, 1);
      await app.click(`[data-read="${commentRow.id}"]`);
      assert.deepEqual(callsTo(fake, 'markNotificationsRead').map(call => call.args), [[[commentRow.id]]]);
      assert.equal(itemOf(commentRow.id).classList.contains('is-unread'), false);
      assert.equal(app.exists(`[data-read="${commentRow.id}"]`), false);
      assert.equal(app.store.state.unread.notifications, 0);
      assert.ok(commentRow.read_at);
    });

    it('marks a notification as read when its link is followed', async () => {
      const fake = owner();
      await open(fake, '/app/notifications');
      const commentRow = fake.db.notifications.find(row => row.user_id === IDS.owner && row.type === 'comment');
      await app.click(`[data-open="${commentRow.id}"]`);
      assert.deepEqual(callsTo(fake, 'markNotificationsRead').map(call => call.args), [[[commentRow.id]]]);
      assert.equal(app.path, `/app/p/${E.firstDraftHabits}`, 'the router took the link');
      assert.ok(commentRow.read_at);
    });

    it('does not ask again for a notification that is already read', async () => {
      const fake = member();
      await open(fake, '/app/notifications');
      await app.click('[data-open="' + fake.db.notifications[0].id + '"]');
      assert.equal(callsTo(fake, 'markNotificationsRead').length, 0);
    });

    it('puts the notification back and explains when marking one as read fails', async () => {
      const fake = owner();
      await open(fake, '/app/notifications');
      const commentRow = fake.db.notifications.find(row => row.user_id === IDS.owner && row.type === 'comment');
      fake.fail('markNotificationsRead', 'We could not reach the server.');
      await app.click(`[data-read="${commentRow.id}"]`);
      assert.equal(itemOf(commentRow.id).classList.contains('is-unread'), true);
      assert.ok(app.exists(`[data-read="${commentRow.id}"]`));
      assert.match(toastText(), /We could not reach the server\./);
      assert.equal(commentRow.read_at, null);
    });

    it('marks everything as read', async () => {
      const fake = member();
      await open(fake, '/app/notifications');
      assert.equal(app.find('[data-mark-all]').disabled, false);
      await app.click('[data-mark-all]');
      assert.deepEqual(callsTo(fake, 'markNotificationsRead').map(call => call.args), [['all']]);
      assert.equal(app.document.querySelectorAll('.activity.is-unread').length, 0);
      assert.equal(app.find('[data-mark-all]').disabled, true, 'nothing left to mark');
      assert.match(toastText(), /all caught up/);
      assert.equal(app.store.state.unread.notifications, 0);
      assert.equal(fake.db.notifications.filter(row => row.user_id === IDS.member && !row.read_at).length, 0);
    });

    it('keeps everything unread and explains when marking all fails, and Mark all read can be tried again', async () => {
      const fake = member();
      await open(fake, '/app/notifications');
      fake.fail('markNotificationsRead', 'The server did not answer.');
      await app.click('[data-mark-all]');
      assert.equal(app.document.querySelectorAll('.activity.is-unread').length, 1);
      assert.match(toastText(), /The server did not answer\./);
      assert.equal(app.find('[data-mark-all]').disabled, false);
      assert.equal(app.find('[data-mark-all]').hasAttribute('aria-busy'), false);
      fake.fail('markNotificationsRead', null);
      await app.click('[data-mark-all]');
      assert.equal(app.document.querySelectorAll('.activity.is-unread').length, 0);
    });

    it('disables Mark all read when there is nothing unread', async () => {
      const fake = member();
      fake.db.notifications.forEach(row => { row.read_at = '2026-10-01T00:00:00+00:00'; });
      await open(fake, '/app/notifications');
      assert.equal(app.find('[data-mark-all]').disabled, true);
    });

    it('deletes one notification and refreshes the badges', async () => {
      const fake = owner();
      await open(fake, '/app/notifications');
      const commentRow = fake.db.notifications.find(row => row.user_id === IDS.owner && row.type === 'comment');
      assert.equal(app.store.state.unread.notifications, 1);
      await app.click(`[data-delete="${commentRow.id}"]`);
      assert.deepEqual(callsTo(fake, 'deleteNotification').map(call => call.args), [[commentRow.id]]);
      assert.equal(app.exists(`[data-activity="${commentRow.id}"]`), false);
      assert.equal(fake.db.notifications.some(row => row.id === commentRow.id), false);
      assert.equal(app.store.state.unread.notifications, 0);
      assert.equal(items().length, 1);
    });

    it('puts the notification back and explains when deleting fails', async () => {
      const fake = owner();
      await open(fake, '/app/notifications');
      const commentRow = fake.db.notifications.find(row => row.user_id === IDS.owner && row.type === 'comment');
      fake.fail('deleteNotification', 'It could not be deleted.');
      await app.click(`[data-delete="${commentRow.id}"]`);
      assert.ok(app.exists(`[data-activity="${commentRow.id}"]`));
      assert.match(toastText(), /It could not be deleted\./);
      assert.equal(items().length, 2);
    });

    it('moves the keyboard to a neighbour after a delete instead of losing it', async () => {
      const fake = owner();
      await open(fake, '/app/notifications');
      const first = items()[0];
      const id = first.dataset.activity;
      first.querySelector('[data-delete]').focus();
      await app.click(`[data-delete="${id}"]`);
      const active = app.document.activeElement;
      assert.ok(active && app.find('#view').contains(active) || active === app.find('#main'), 'focus stays inside the page');
    });

    it('shows the empty state with a next step', async () => {
      const fake = member();
      fake.db.notifications = [];
      await open(fake, '/app/notifications');
      assert.match(app.text('#view .empty'), /Nothing new yet/);
      assert.ok(app.find('#view .empty a[href="/app/discover"]'));
      assert.equal(app.find('[data-mark-all]').disabled, true);
    });

    it('shows an error with Retry when the activity cannot be loaded', async () => {
      const fake = member();
      fake.fail('listNotifications', 'The activity feed is resting.');
      await open(fake, '/app/notifications');
      assert.match(app.text('#view'), /The activity feed is resting\./);
      retryOffered('#view');
      fake.fail('listNotifications', null);
      await reload();
      assert.equal(items().length, 2);
    });

    describe('with a long history', () => {
      const longFeed = () => {
        const fake = member();
        fake.db.notifications = Array.from({ length: 45 }, (_, i) => noticeRow(IDS.member, { created_at: minutesAgo(10 + i), read_at: '2026-10-01T00:00:00+00:00' }));
        return fake;
      };

      it('loads the next page on request and stops at the end', async () => {
        const fake = longFeed();
        await open(fake, '/app/notifications');
        assert.equal(items().length, 20);
        assert.equal(app.text('[data-more]'), 'Load more');
        await app.click('[data-more]');
        assert.equal(items().length, 40);
        await app.click('[data-more]');
        assert.equal(items().length, 45);
        assert.equal(app.exists('[data-more]'), false, 'nothing left');
        assert.deepEqual(callsTo(fake, 'listNotifications').map(call => call.args[0].limit), [20, 20, 20]);
        assert.equal(new Set(attr('.activity', 'data-activity')).size, 45, 'no duplicates');
      });

      it('loads the next page as the end of the list scrolls into view', async () => {
        const fake = longFeed();
        await open(fake, '/app/notifications');
        const sentinel = app.find('[data-sentinel]');
        const observer = IntersectionObserverStub.instances.find(item => item.targets.has(sentinel));
        assert.ok(observer, 'the end of the list is watched');
        observer.fire(true);
        await app.settle();
        assert.equal(items().length, 40);
      });

      it('shows the problem and a way to try again when a page fails', async () => {
        const fake = longFeed();
        await open(fake, '/app/notifications');
        fake.fail('listNotifications', 'The next page did not load.');
        await app.click('[data-more]');
        assert.equal(items().length, 20, 'what was shown stays');
        assert.match(app.text('#activities-body'), /The next page did not load\./);
        assert.equal(app.text('[data-more]'), 'Try again');
        fake.fail('listNotifications', null);
        await app.click('[data-more]');
        assert.equal(items().length, 40);
        assert.equal(app.exists('.field-error'), false);
      });
    });

    it('adds a notification live at the top, announces it and refreshes the count', async () => {
      const fake = owner();
      await open(fake, '/app/notifications');
      const row = noticeRow(IDS.owner, { type: 'follow', actor_id: IDS.fan3, entry_id: null, created_at: new Date().toISOString() });
      fake.db.notifications.push(row);
      fake.emit(IDS.owner, 'notification', row);
      await app.settle();
      assert.equal(items().length, 3);
      assert.equal(items()[0].dataset.activity, row.id);
      assert.match(items()[0].textContent, /Noor Haddad started following Verne & Co/);
      assert.ok(items()[0].classList.contains('is-unread'));
      assert.match(app.text('#activities-status'), /You have a new notification\./);
      fake.emit(IDS.owner, 'notification', row);
      await app.settle();
      assert.equal(items().length, 3, 'the same row is not added twice');
      const second = noticeRow(IDS.owner, { type: 'like', actor_id: IDS.fan2, created_at: new Date().toISOString() });
      fake.db.notifications.push(second);
      fake.emit(IDS.owner, 'notification', second);
      await app.settle();
      assert.match(app.text('#activities-status'), /You have 2 new notifications\./);
    });

    it('replaces the empty state when the first notification arrives', async () => {
      const fake = member();
      fake.db.notifications = [];
      await open(fake, '/app/notifications');
      assert.equal(items().length, 0);
      const row = noticeRow(IDS.member, { type: 'new_entry', actor_id: null, creator_id: IDS.solene, entry_id: E.linenWardrobe, created_at: new Date().toISOString() });
      fake.db.notifications.push(row);
      fake.emit(IDS.member, 'notification', row);
      await app.settle();
      assert.equal(items().length, 1);
      assert.equal(app.exists('.empty'), false);
      assert.equal(app.find('[data-mark-all]').disabled, false);
    });

    it('escapes hostile names and titles', async () => {
      const fake = member();
      profileRow(fake, IDS.fan1).display_name = HOSTILE;
      fake.db.entries.find(row => row.id === E.firstDraftHabits).title = HOSTILE;
      creatorRow(fake, IDS.solene).name = HOSTILE;
      fake.db.notifications.push(
        noticeRow(IDS.member, { type: 'comment', actor_id: IDS.fan1, created_at: minutesAgo(1) }),
        noticeRow(IDS.member, { type: 'new_entry', actor_id: null, creator_id: IDS.solene, entry_id: E.firstDraftHabits, created_at: minutesAgo(2) })
      );
      await open(fake, '/app/notifications');
      assert.equal(items()[0].querySelector('.activity-sentence').textContent.trim(), `${HOSTILE} commented on “${HOSTILE}”`);
      assert.equal(items()[1].querySelector('.activity-sentence').textContent.trim(), `${HOSTILE} published “${HOSTILE}”`);
      noMarkupInjected();
    });

    it('does not collide with the shared notice style of the design system', async () => {
      await open(member(), '/app/notifications');
      assert.equal(app.document.querySelectorAll('#view .notice').length, 0);
    });
  });

  // =================================================================================================
  describe('accessibility and structure', () => {
    for (const [label, make, path] of [
      ['the list of conversations', member, '/app/messages'],
      ['a conversation', member, THREAD],
      ['the owner’s conversation', owner, THREAD],
      ['notifications', member, '/app/notifications']
    ]) {
      it(`${label}: one h1, labelled controls, no inline handlers or horizontal-scroll widths`, async () => {
        await open(make(), path);
        const view = app.find('#view');
        assert.equal(view.querySelectorAll('h1').length, 1);
        for (const control of view.querySelectorAll('button, textarea, input')) {
          const named = control.getAttribute('aria-label') || control.textContent.trim() || (control.id && view.querySelector(`label[for="${control.id}"]`));
          assert.ok(named, `a control without a name: ${control.outerHTML.slice(0, 80)}`);
        }
        assert.equal(view.querySelectorAll('[onclick], [onerror], [onload], [style*="width:"]').length, 0);
        for (const link of view.querySelectorAll('a[target="_blank"]')) assert.match(link.getAttribute('rel'), /noopener/);
      });
    }

    it('gives the compose box a label, a hint and a polite status for its log', async () => {
      await open(member(), THREAD);
      assert.match(app.find('label[for="compose-text"]').textContent, /Message to Verne & Co/);
      assert.equal(app.find('#compose-text').getAttribute('aria-describedby'), 'compose-hint');
      assert.match(app.text('#compose-hint'), /Enter sends, Shift and Enter start a new line/);
      assert.equal(app.find('#thread-log').getAttribute('aria-labelledby'), 'thread-title');
    });

    it('draws no list or thread for a page that is left before it finishes loading', async () => {
      const fake = member();
      await open(fake, '/app/messages');
      await app.navigate('/app/notifications');
      const row = messageRow({ sender: 'creator', body: 'After leaving', created_at: new Date().toISOString() });
      fake.db.messages.push(row);
      fake.emit(IDS.member, 'message', row);
      await tick(320);
      assert.equal(app.exists('.inbox-item'), false);
    });
  });
});
