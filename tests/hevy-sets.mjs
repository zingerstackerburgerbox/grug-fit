// v1.14.0 Hevy-style set editing, in Edit workout and the live logger: + Add set (copies the previous set), swipe left to delete
// (full swipe, or partial swipe + Delete) with a 5 s Undo, renumbering, vertical drags never delete, a real touch swipe (CDP),
// set-type menu (W/1/D/F + Delete set as the accessible path), exercise ⋮ menu (note, move up/down, remove + Undo),
// + Add exercise, Previous column, Cancel discards / Save persists (and fires the logged event the scores listen to),
// rest timer from the Settings default when a set is ticked.
import { chromium, devices } from 'playwright';
import { seedWeek } from './seed-week.mjs';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney' });
const page = await ctx.newPage(); page.setDefaultTimeout(12000);
page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester'); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
await page.evaluate(() => localStorage.setItem('offpackAuto', '0')); await seedWeek(page); await page.reload(); await page.waitForSelector("text=Today's nutrition");
const idb = (fn, arg) => page.evaluate(async ([src, arg]) => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); }); const P = (q) => new Promise((r) => { q.onsuccess = () => r(q.result); }); const tx = (s, m = 'readonly') => d.transaction(s, m).objectStore(s); const res = await (new Function('P', 'tx', 'arg', 'return (async () => {' + src + '})()'))(P, tx, arg); d.close(); return res; }, [fn, arg]);
const latest = await idb(`const l = await P(tx('workouts').getAll()); l.sort((a, b) => b.start - a.start); return l[0];`);
log('editing', latest.name, latest.exercises.length, 'exercises,', latest.exercises.map((e) => e.sets.length).join('/'), 'sets');
const card = (i) => page.locator('[data-testid=ex-card]').nth(i); const rows = (i) => card(i).locator('.set-row');
const nums = async (i) => (await card(i).locator('[data-testid=set-num]').allTextContents()).join(',');
const vals = async (i, r) => [await rows(i).nth(r).locator('input[aria-label=Weight]').inputValue(), await rows(i).nth(r).locator('input[aria-label=Reps]').inputValue()];
const swipe = async (loc, dx, dy = 0, steps = 12) => { const bb = await loc.boundingBox(); const x = bb.x + bb.width * 0.62, y = bb.y + bb.height / 2; // start on the Previous column (not an input)
  await page.mouse.move(x, y); await page.mouse.down(); for (let k = 1; k <= steps; k++) await page.mouse.move(x + (dx * k) / steps, y + (dy * k) / steps); await page.mouse.up(); await page.waitForTimeout(300); };
const touchSwipe = async (loc, dx) => { const cdp = await ctx.newCDPSession(page); const bb = await loc.boundingBox(); const x = bb.x + bb.width * 0.3, y = bb.y + bb.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let k = 1; k <= 14; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * k) / 14, y }] }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(350); await cdp.detach(); };
const logged = () => page.evaluate(() => (window.__lg || []).slice());
await page.evaluate(() => { window.__lg = []; addEventListener('lunk-logged', (e) => window.__lg.push(e.detail?.store || e.detail || 'x')); });

// ---------- Edit workout ----------
const openEdit = async () => { await page.goto(BASE + '#/'); await page.waitForSelector("text=Today's nutrition"); await page.goto(BASE + `#/history/${latest.id}?edit=1`); await page.waitForSelector('[data-testid=save-workout]'); await page.waitForSelector('[data-testid=ex-card]'); };
await openEdit();
const n0 = await rows(0).count(); const cards0 = await page.locator('[data-testid=ex-card]').count();
if (cards0 !== latest.exercises.length) fail('cards ' + cards0);
if ((await page.locator('[data-testid=add-set]').count()) !== cards0) fail('an Add set button per exercise card'); else log('Add set buttons:', cards0);
if (await page.locator('button[aria-label="Delete set"]').count()) fail('old × delete buttons still there');
const pv = await card(0).locator('[data-testid=set-prev]').first().textContent(); log('Previous column (edit):', pv); if (!/×/.test(pv)) fail('no previous values in edit');
// + Add set copies the previous set
const lastVals = await vals(0, n0 - 1); await card(0).locator('[data-testid=add-set]').click();
if ((await rows(0).count()) !== n0 + 1) fail('add set in edit'); const nv = await vals(0, n0);
log('Add set (edit):', n0, '→', n0 + 1, 'new row', nv.join(' × '), '(previous', lastVals.join(' × ') + ')', '| numbers', await nums(0));
if (nv.join() !== lastVals.join()) fail('new set not prefilled from the previous set');
if ((await rows(0).nth(n0).locator('button[aria-label="Complete set"]').getAttribute('aria-pressed')) !== 'true') fail('set added while editing a finished workout should be ticked');
// full swipe deletes, numbers close up, Undo restores at the same place
const v1 = await vals(0, 1); await swipe(rows(0).nth(1), -330);
let nn = await nums(0); log('full swipe on set 2 →', await rows(0).count(), 'rows, numbers', nn, '| snackbar:', (await page.textContent('[data-testid=snackbar]').catch(() => '')).trim());
if ((await rows(0).count()) !== n0 || nn !== Array.from({ length: n0 }, (_, i) => i + 1).join(',')) fail('full swipe delete / renumber');
await page.click('[data-testid=snackbar-action]'); await page.waitForTimeout(200);
if ((await rows(0).count()) !== n0 + 1 || (await vals(0, 1)).join() !== v1.join()) fail('undo'); else log('Undo → set 2 back', (await vals(0, 1)).join(' × '));
// partial swipe leaves Delete showing; tapping it deletes; snackbar disappears after ~5 s
await swipe(rows(0).nth(0), -110);
const open = await page.locator('[data-testid=swipe-row][data-open="1"]').count(); log('partial swipe: rows open', open); if (open !== 1) fail('partial swipe should leave the row open');
await page.screenshot({ path: 'screenshots/60-swipe-delete.png' });
await card(0).locator('[data-testid=swipe-row][data-open="1"] [data-testid=swipe-delete]').click(); await page.waitForTimeout(300);
if ((await rows(0).count()) !== n0) fail('tap Delete'); await page.waitForTimeout(5400);
if (await page.locator('[data-testid=snackbar]').count()) fail('snackbar should hide after ~5 s'); else log('tap Delete removed it; snackbar gone after 5 s');
// vertical drag never deletes or opens
const before = await rows(0).count(); await swipe(rows(0).nth(0), -20, 160);
if ((await rows(0).count()) !== before || (await page.locator('[data-testid=swipe-row][data-open="1"]').count())) fail('vertical drag engaged the swipe'); else log('vertical drag: nothing happens');
// real touch (CDP touch events, touch-action: pan-y)
await touchSwipe(rows(0).nth(0), -340); log('touch full swipe:', before, '→', await rows(0).count());
if ((await rows(0).count()) !== before - 1) fail('touch swipe delete'); else { await page.click('[data-testid=snackbar-action]'); await page.waitForTimeout(200); }
// set type menu: warm-up + accessible Delete set
await card(0).locator('[data-testid=set-num]').first().click(); await page.click('.sheet >> text=Warm-up'); await page.waitForTimeout(150);
nn = await nums(0); log('first set → warm-up:', nn); if (!nn.startsWith('W,1,2')) fail('warm-up label / renumber');
const c1 = await rows(0).count(); await card(0).locator('[data-testid=set-num]').last().click(); await page.click('[data-testid=menu-delete-set]'); await page.waitForTimeout(250);
if ((await rows(0).count()) !== c1 - 1) fail('Delete set from the set menu'); else log('Delete set via set-number menu (no swipe needed)');
// exercise ⋮ menu: move down, add note, remove + undo
const names = async () => (await page.locator('[data-testid=ex-card] a.b').allTextContents());
const order0 = await names(); await card(0).locator('[data-testid=ex-menu]').click(); await page.waitForSelector('[data-testid=ex-menu-sheet]');
await page.screenshot({ path: 'screenshots/61-exercise-menu.png' }); await page.click('[data-testid=ex-down]'); await page.waitForTimeout(150);
const order1 = await names(); log('move down:', order0.slice(0, 2).join(' / '), '→', order1.slice(0, 2).join(' / ')); if (order1[0] !== order0[1] || order1[1] !== order0[0]) fail('move down');
await card(0).locator('[data-testid=ex-menu]').click(); await page.click('[data-testid=ex-up]').catch(() => {}); await page.waitForTimeout(150); // first card: Move up disabled
if ((await page.locator('[data-testid=ex-menu-sheet]').count())) await page.keyboard.press('Escape');
await card(1).locator('[data-testid=ex-menu]').click(); await page.click('[data-testid=ex-up]'); await page.waitForTimeout(150); if ((await names()).join() !== order0.join()) fail('move up');
await card(0).locator('[data-testid=ex-menu]').click(); await page.click('[data-testid=ex-add-note]'); await card(0).locator('[data-testid=ex-note]').fill('seat 4, slow negatives');
await card(1).locator('[data-testid=ex-menu]').click(); await page.click('[data-testid=ex-remove]'); await page.waitForTimeout(150);
if ((await page.locator('[data-testid=ex-card]').count()) !== cards0 - 1) fail('remove exercise'); await page.click('[data-testid=snackbar-action]'); await page.waitForTimeout(150);
if ((await names()).join() !== order0.join()) fail('undo remove exercise'); else log('remove exercise + Undo ok; note added');
// + Add exercise
await page.click('[data-testid=add-exercise]'); await page.locator('.sheet .item', { hasText: 'Hammer Curl (Dumbbell)' }).first().click(); await page.click('.sheet button.btn.p.grow'); await page.waitForTimeout(200);
const cards1 = await page.locator('[data-testid=ex-card]').count(); log('add exercise:', cards0, '→', cards1, (await names()).at(-1)); if (cards1 !== cards0 + 1 || !/Hammer Curl/.test((await names()).at(-1))) fail('add exercise');
// Cancel editing discards everything
await page.click('text=Cancel editing'); await page.waitForSelector('[data-testid=edit-workout]');
const afterCancel = await idb(`return await P(tx('workouts').get(arg));`, latest.id);
if (JSON.stringify(afterCancel.exercises) !== JSON.stringify(latest.exercises)) fail('cancel changed the saved workout');
const viewCards = await page.locator('.page .card a.b').count(); log('Cancel editing: saved workout unchanged; view shows', viewCards, 'exercises'); if (await page.locator('text=Hammer Curl (Dumbbell)').count()) fail('cancelled exercise still shown');
// Save persists: add a set to exercise 1, delete set 1 of exercise 2, add an exercise with one set
await page.evaluate(() => { window.__lg = []; });
await page.click('[data-testid=edit-workout]'); await page.waitForSelector('[data-testid=ex-card]');
await card(0).locator('[data-testid=add-set]').click(); await swipe(rows(1).nth(0), -330);
await page.click('[data-testid=add-exercise]'); await page.locator('.sheet .item', { hasText: 'Hammer Curl (Dumbbell)' }).first().click(); await page.click('.sheet button.btn.p.grow'); await page.waitForTimeout(200);
const last = page.locator('[data-testid=ex-card]').last(); await last.locator('input[aria-label=Weight]').fill('31.5'); await last.locator('input[aria-label=Reps]').fill('10'); await last.locator('input[aria-label=Reps]').blur();
await last.locator('button[aria-label="Complete set"]').click(); await last.locator('[data-testid=add-set]').click(); await last.locator('input[aria-label=Weight]').nth(1).fill('38.5'); await last.locator('input[aria-label=Weight]').nth(1).blur();
await page.screenshot({ path: 'screenshots/62-edit-add-set.png' });
await page.click('[data-testid=save-workout]'); await page.waitForSelector('[data-testid=edit-workout]'); await page.waitForTimeout(300);
const saved = await idb(`return await P(tx('workouts').get(arg));`, latest.id); const ex = saved.exercises;
const okSave = ex.length === latest.exercises.length + 1 && ex[0].sets.length === latest.exercises[0].sets.length + 1 && ex[1].sets.length === latest.exercises[1].sets.length - 1
  && ex.at(-1).sets.length === 2 && ex.at(-1).sets[1].kg === 38.5 && ex.at(-1).sets[1].reps === 10 && ex.at(-1).sets.every((x) => x.done);
log('Save:', ex.map((e) => e.sets.length).join('/'), 'sets (was', latest.exercises.map((e) => e.sets.length).join('/') + ')', '| new exercise', JSON.stringify(ex.at(-1).sets.map((x) => [x.kg, x.reps, x.done])));
if (!okSave) fail('save did not persist the edits');
const lg = await logged(); log('logged events after save:', lg.join(',')); if (!lg.length) fail('no lunk-logged event after save (scores would not refresh)');
if (!(await page.locator('text=Hammer Curl (Dumbbell)').count())) fail('saved exercise not shown in the view');

// ---------- live logger ----------
await page.goto(BASE + '#/settings'); await page.locator('[data-testid=rest-chips] button', { hasText: '3 min' }).click(); await page.waitForTimeout(200);
const dr = await idb(`return (await P(tx('kv').get('settings'))).defaultRest;`); log('default rest set from Settings chip:', dr); if (dr !== 180) fail('rest chip');
await page.goto(BASE + '#/workouts'); await page.click('text=+ Start empty workout'); await page.click('text=+ Add exercise');
await page.locator('.sheet .item', { hasText: 'Bench Press (Barbell)' }).first().click(); await page.click('.sheet button.btn.p.grow'); await page.waitForTimeout(300);
const lp = await card(0).locator('[data-testid=set-prev]').first().textContent(); log('live Previous:', lp); if (!/×/.test(lp)) fail('live previous column');
await rows(0).nth(0).locator('input[aria-label=Weight]').fill('80'); await rows(0).nth(0).locator('input[aria-label=Reps]').fill('5'); await rows(0).nth(0).locator('input[aria-label=Reps]').blur();
await card(0).locator('[data-testid=add-set]').click(); await card(0).locator('[data-testid=add-set]').click();
log('live Add set:', await rows(0).count(), 'rows', JSON.stringify([await vals(0, 1), await vals(0, 2)]));
if ((await rows(0).count()) !== 3 || (await vals(0, 2)).join() !== '80,5') fail('live add set prefill');
await rows(0).nth(0).locator('button[aria-label="Complete set"]').click(); await page.waitForTimeout(300);
const timer = (await page.textContent('[role=timer] .t').catch(() => '')).trim(); log('rest timer after ticking:', timer, '| row tinted:', await rows(0).nth(0).getAttribute('class'));
if (!/^(3:00|2:5\d)$/.test(timer)) fail('rest timer should start at the 3 min default'); if (!/done/.test(await rows(0).nth(0).getAttribute('class'))) fail('done row not tinted');
await swipe(rows(0).nth(1), -330); log('live swipe delete:', await rows(0).count(), 'rows, numbers', await nums(0)); if ((await rows(0).count()) !== 2 || (await nums(0)) !== '1,2') fail('live swipe delete/renumber');
await page.click('[data-testid=snackbar-action]'); await page.waitForTimeout(200); if ((await rows(0).count()) !== 3) fail('live undo');
const act = await idb(`return (await P(tx('kv').get('active'))).w.exercises[0].sets.length;`); if (act !== 3) fail('live undo not saved'); else log('live Undo saved (3 sets in the active workout)');
await page.click('button:has-text("Discard workout")'); await page.waitForTimeout(300);
if (/\bAI\b/.test(await page.textContent('body'))) fail('"AI" in copy');
await b.close();
if (failed) { console.error(failed, 'failure(s)'); process.exit(1); } console.log('HEVY SETS E2E PASSED');
