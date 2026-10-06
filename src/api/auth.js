// Sign-in, sign-up and session handling. Auth emails link back to /app.html, the address in the Supabase redirect allow-list.
import { check } from './util.js';

const ALREADY_REGISTERED = 'An account with this email already exists. Sign in instead.';

export function createAuth(ctx) {
  const {client} = ctx;

  return {
    async getSession() { return check(await client.auth.getSession())?.session ?? null; },

    // The callback is deferred: calling Supabase from inside onAuthStateChange can deadlock its internal lock.
    // Returns a function that stops listening.
    onAuthChange(fn) {
      const {data} = client.auth.onAuthStateChange((event, session) => {
        ctx.setUserId(session?.user?.id ?? null);
        setTimeout(() => fn(event, session), 0);
      });
      return () => data?.subscription?.unsubscribe?.();
    },

    async signIn(email, password) {
      const data = check(await client.auth.signInWithPassword({email, password}));
      if (data?.session?.user) ctx.setUserId(data.session.user.id);
    },

    // Resolves {confirmed}: true when the account is usable right away, false while the email link is still to be opened.
    async signUp(email, password, displayName) {
      const data = check(await client.auth.signUp({email, password, options: {data: {display_name: displayName}, emailRedirectTo: ctx.redirectUrl()}}));
      // For an address that is already registered Supabase hides the fact and returns a user without identities.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw Error(ALREADY_REGISTERED);
      return {confirmed: Boolean(data?.session)};
    },
    async resendConfirmation(email) { check(await client.auth.resend({type: 'signup', email, options: {emailRedirectTo: ctx.redirectUrl()}})); },
    async resetPassword(email) { check(await client.auth.resetPasswordForEmail(email, {redirectTo: ctx.redirectUrl()})); },
    async updatePassword(password) { check(await client.auth.updateUser({password})); },
    async updateEmail(email) { check(await client.auth.updateUser({email}, {emailRedirectTo: ctx.redirectUrl()})); },

    // Caches are cleared even when the server call fails: the person asked to leave, and a stale token must not keep their data around.
    async signOut() {
      try { check(await client.auth.signOut()); }
      finally { ctx.setUserId(null, {force: true}); }
    }
  };
}
