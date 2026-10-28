/**
 * v1.15.0 invite friends: a share link with ?ref=<username>. Nothing is sent anywhere; the invited person's app just reads the
 * ref from its own URL on first open, shows "<name> invited you" once and keeps the name on that device (localStorage).
 */
import { USERNAME_RE } from './username';
export const APP_URL = 'https://zingerstackerburgerbox.github.io/grug-fit/';
export const inviteUrl = (username?: string) => (username && USERNAME_RE.test(username) ? `${APP_URL}?ref=${encodeURIComponent(username)}` : APP_URL);
export const inviteText = (username?: string) => `Join me on Lunk, a free gym and food tracker. Grug rates your training.${username ? ` Find me as ${username}.` : ''}`;
const K_BY = 'lunk-invited-by', K_SEEN = 'lunk-invite-seen';
let pending: string | null = null;
/** run once at startup: read ?ref=, drop it from the address bar, remember who invited (first one wins) */
export function captureRef(loc: Location = location) {
  try {
    const u = new URL(loc.href); const r = (u.searchParams.get('ref') || '').trim();
    if (!u.searchParams.has('ref')) return;
    u.searchParams.delete('ref'); history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
    if (!USERNAME_RE.test(r) || localStorage.getItem(K_BY)) return;
    localStorage.setItem(K_BY, r); pending = r;
  } catch { /* storage blocked: just skip */ }
}
export const invitedBy = () => { try { return localStorage.getItem(K_BY); } catch { return null; } };
/** the name to greet with, once */
export function takeGreeting(): string | null {
  try { if (!pending || localStorage.getItem(K_SEEN)) return null; localStorage.setItem(K_SEEN, String(Date.now())); return pending; } catch { return null; }
}
