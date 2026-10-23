/** Service-worker registration + safe auto-update. */
import { get } from './db';
import { toast } from './ui';
export const APP_VERSION = __APP_VERSION__, BUILD_TIME = __BUILD_TIME__, BUILD_ID = __BUILD_ID__;
const CHECK_EVERY = 30 * 60 * 1000;
let dirty = false; let pending = false;
const EDIT_ROUTES = [/^\/workout\/active/, /^\/routine\//, /^\/food\/edit\//, /^\/food\/label/, /^\/welcome/, /^\/recipe\//, /^\/supp\//];
document.addEventListener('input', (e) => { if ((e.target as HTMLElement)?.closest?.('.page, .sheet, .scanner')) dirty = true; }, true);
addEventListener('hashchange', () => { dirty = false; if (pending) maybeReload(); });

export async function safeToReload() {
  const route = location.hash.slice(1).split('?')[0] || '/';
  if (EDIT_ROUTES.some((r) => r.test(route))) return false;
  if (document.querySelector('.sheet-bg, .scanner, .modal-bg, [data-editing]')) return false; // open sheet/scanner, auto-end review, history edit
  if (dirty) return false;
  const active = await get('kv', 'active').catch(() => null);
  if (active?.w) return false; // workout in progress
  return true;
}
async function maybeReload() {
  if (await safeToReload()) { (window as any).__updateState = 'reloading'; location.reload(); }
  else { (window as any).__updateState = 'banner'; dispatchEvent(new Event('grug-update-ready')); }
}
export function showUpdatedToast() {
  const last = localStorage.getItem('buildId');
  if (last && last !== BUILD_ID) setTimeout(() => toast(`Updated to v${APP_VERSION} ✨`), 400);
  localStorage.setItem('buildId', BUILD_ID);
}
export function registerSW() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; } // first install: nothing to reload
    pending = true; maybeReload();
  });
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then((reg) => {
    (window as any).__swReg = reg;
    const check = () => reg.update().catch(() => {});
    check(); // on launch
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { check(); if (pending) maybeReload(); } });
    setInterval(check, CHECK_EVERY);
  }).catch((e) => console.warn('SW registration failed', e));
}
