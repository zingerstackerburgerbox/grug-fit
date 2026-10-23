/**
 * v1.9.2 username: a display name chosen at sign-up, kept ON THIS DEVICE ONLY (settings.username → part of Backup).
 * Never sent anywhere: the Coach context (coach.ts buildContext) deliberately leaves it out.
 * Future accounts/login will get their own separate account id; this stays a local display name.
 */
export const USERNAME_RE = /^[A-Za-z0-9_.]{3,20}$/;
export const cleanUsername = (v: string) => (v || '').trim();
/** null when valid, else a short message */
export function usernameError(v: string): string | null {
  const u = cleanUsername(v);
  if (!u) return 'Pick a username';
  if (u.length < 3) return 'At least 3 characters';
  if (u.length > 20) return 'At most 20 characters';
  if (!USERNAME_RE.test(u)) return 'Only letters, numbers, _ and . (no spaces)';
  return null;
}
export const greeting = (d = new Date()) => { const h = d.getHours(); return h < 5 ? 'Hey' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; };
