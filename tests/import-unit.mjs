// v1.8.0 importer unit tests: CSV parsing, file detection, Hevy/Cronometer mapping, exercise matching, dedupe.
import { buildSync } from 'esbuild'; import { mkdtempSync, readFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
const out = join(mkdtempSync(join(tmpdir(), 'imp-')), 'bundle.mjs'); const root = new URL('..', import.meta.url).pathname;
buildSync({ stdin: { contents: "export * from './src/importer.ts'; export { SEED_EXERCISES } from './src/seed.ts'; export { estimateWorkoutKcal } from './src/setKcal.ts';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', outfile: out, logLevel: 'error' });
const I = await import(pathToFileURL(out).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const fx = (n) => ({ name: n, text: readFileSync(new URL('./fixtures/' + n, import.meta.url), 'utf8') });
const ex0 = () => ({ exercises: I.SEED_EXERCISES, workouts: [], diaryIds: new Set(), diaryCronDates: new Set(), bodyweight: [], defaultRest: 90 });

// CSV
const c = I.parseCSV('\uFEFFa,b,c\r\n"x, y","he said ""hi""",3\r\n"multi\nline",,\n\n');
ok(c.length === 3 && c[0][0] === 'a' && c[1][0] === 'x, y' && c[1][1] === 'he said "hi"' && c[2][0] === 'multi\nline' && c[2][2] === '', 'CSV: BOM, CRLF, quoted commas, "" escapes, newline in quotes, blank lines');
ok(I.parseCSV('a;b\n1;2')[1][1] === '2', 'CSV: semicolon delimiter');
ok(I.numOf('"2,105.3"'.replace(/"/g, '')) === 2105.3 && I.numOf('') === null, 'numbers with thousands separators');
// dates
const t = I.parseHevyDate('23 Oct 2026, 07:15'); const d = new Date(t);
ok(d.getFullYear() === 2026 && d.getMonth() === 9 && d.getDate() === 23 && d.getHours() === 7 && d.getMinutes() === 15, 'Hevy date "23 Oct 2026, 07:15" → local time');
ok(new Date(I.parseHevyDate('Oct 5, 2026, 7:15 PM')).getHours() === 19 && new Date(I.parseHevyDate('5 Sept 2026, 09:00')).getMonth() === 8, 'Hevy date variants');
// detection by headers (not file name)
const kinds = ['hevy_workouts_kg.csv', 'hevy_workouts_lbs.csv', 'cronometer_servings.csv', 'cronometer_dailysummary.csv', 'cronometer_biometrics.csv', 'cronometer_exercises.csv', 'random.csv'].map((n) => I.detectKind(I.toTable(fx(n).text).headers));
ok(kinds.join() === 'hevy,hevy,cron-servings,cron-daily,cron-bio,cron-exercises,unknown', 'detect kinds: ' + kinds.join());
ok(I.detectKind(I.toTable(fx('cronometer_servings.csv').text.replace(/^"Day"/, '"Day"')).headers) === 'cron-servings', 'renamed file still detected');
// matching
const m = (n) => I.matchExercise(n, I.SEED_EXERCISES)?.name;
ok(m('Bench Press (Barbell)') === 'Bench Press (Barbell)' && m('bench press (barbell)') === 'Bench Press (Barbell)' && m('Pull-Up') === 'Pull Up' && m('Pullups') === 'Pull Up', 'case/punctuation-insensitive match');
ok(m('Triceps Pushdown') === 'Triceps Pushdown (Cable)' && m('Seated Cable Row - V Grip (Cable)') === 'Seated Cable Row' && m('Skullcrusher (Barbell)') === 'Skullcrusher (EZ Bar)', 'alias table');
ok(m('Goblet Squat') === 'Goblet Squat (Dumbbell)' && m("Farmers Walk") === "Farmer's Walk (Dumbbell)" && m('Bicep Curl (Machine)') === undefined && m('Leg Press (Smith Machine)') === undefined, 'base-name match only when unique and equipment agrees');
const g = I.guessExercise('Iso-Lateral Chest Press (Machine)'); const g2 = I.guessExercise('Running');
ok(g.muscle === 'Chest' && g.equipment === 'Machine' && g2.muscle === 'Cardio', `guess: ${JSON.stringify(g)} ${JSON.stringify(g2)}`);

// Hevy kg
const p = I.buildPlan([fx('hevy_workouts_kg.csv')], ex0());
ok(p.workouts.length === 4 && p.sets === 17, `kg: ${p.workouts.length} workouts, ${p.sets} sets`);
const push = p.workouts.find((w) => w.name === 'Push, Heavy');
ok(push && new Date(push.start).getHours() === 7 && (push.end - push.start) / 60e3 === 77 && push.notes === 'Felt strong, slept 8h', 'title/notes with commas, start/end');
const bench = push.exercises[0];
ok(bench.sets.map((s) => s.type).join('') === 'WNNF' && bench.sets[1].kg === 80 && bench.sets[1].rpe === 7.5 && bench.notes === 'Pause reps, 1s', 'set types W/N/N/F, kg, RPE, exercise notes');
ok(push.exercises[1].sets[1].type === 'D', 'dropset → D');
const plank = push.exercises.find((e) => e.exerciseId === 'ex074'); ok(plank && plank.sets[0].reps === 60, 'plank duration → 60 s');
ok(p.created.join() === 'Iso-Lateral Chest Press (Machine),Running' && p.exercises.every((e) => e.custom && e.importSource === 'hevy'), 'unknown exercises created: ' + p.created.join(', '));
const run = p.workouts.find((w) => w.name === 'Cardio').exercises[0].sets[0]; ok(run.km === 5.2 && run.reps === 30, 'running 5.2 km / 30 min');
const pu = p.workouts.find((w) => w.name === 'Pull Day').exercises.find((e) => e.exerciseId === 'ex017'); ok(pu.sets[0].kg === null && pu.sets[1].kg === 10, 'bodyweight + weighted pull-ups');
const again = p.workouts.find((w) => w.name === 'Push Again'); ok(again.prs.some((x) => x.kind === 'weight' && x.value === 85), 'PRs computed across imported history (bench 85 kg)');
const exMap = new Map([...I.SEED_EXERCISES, ...p.exercises].map((e) => [e.id, e]));
ok(Math.round(I.estimateWorkoutKcal(push, 85, exMap)) > 0, `per-set calories for imported workout: ${Math.round(I.estimateWorkoutKcal(push, 85, exMap))} kcal @85 kg`);
// Hevy lbs
const pl = I.buildPlan([fx('hevy_workouts_lbs.csv')], ex0()); const sq = pl.workouts[0].exercises[0].sets;
ok(Math.abs(sq[1].kg - 102.058) < 0.001 && sq[0].type === 'W', `225 lb → ${sq[1].kg} kg`);
const walk = pl.workouts[0].exercises.find((e) => pl.exercises.some((x) => x.id === e.exerciseId && x.muscle === 'Cardio'));
ok(walk && Math.abs(walk.sets[0].km - 2.414) < 0.001 && walk.sets[0].reps === 25, 'miles → km, cardio minutes');
ok(pl.workouts[0].exercises.some((e) => e.exerciseId === I.SEED_EXERCISES.find((x) => x.name === 'Goblet Squat (Dumbbell)').id), 'Goblet Squat matched');

// Cronometer
const all = [fx('cronometer_servings.csv'), fx('cronometer_dailysummary.csv'), fx('cronometer_biometrics.csv'), fx('cronometer_exercises.csv')];
const pc = I.buildPlan(all, ex0());
ok(pc.diary.filter((e) => !e.id.startsWith('cron-day-')).length === 8, 'servings: 8 food entries (identical bananas kept twice)');
const oats = pc.diary.find((e) => e.name === 'Oats, Rolled, Dry'); ok(oats.meal === 'breakfast' && oats.grams === 50 && oats.serving === 'g' && oats.n.kcal === 189.5 && oats.n.carbs === 33.8 && oats.n.fibre === 5 && oats.n.protein === 6.6, 'oats 50 g, macros');
const yog = pc.diary.find((e) => e.name.startsWith('Yogurt')); ok(yog.amountLabel === '1 cup' && yog.n.protein === 23.2, 'cup amount kept as label');
const sal = pc.diary.find((e) => e.name.startsWith('Salmon')); ok(sal.meal === 'dinner' && Math.abs(sal.n.vitD - 19.7) < 0.01, 'vitamin D IU → µg');
ok(pc.diary.find((e) => e.name === 'Whey Protein Isolate').meal === 'snacks', 'Uncategorized → snacks');
const days = pc.diary.filter((e) => e.id.startsWith('cron-day-')); ok(days.length === 1 && days[0].date === '2026-10-19' && days[0].n.kcal === 2105.3 && days[0].name === 'Cronometer daily total' && pc.skipped.days === 2, 'daily totals only for days without food entries (19 Oct), 0-kcal day ignored');
ok(pc.bodyweight.length === 4 && pc.bodyweight.find((b) => b.date === '2026-10-19').kg === 86 && pc.files.find((f) => f.kind === 'cron-bio').note.includes('2 other'), 'biometrics: 4 weigh-ins, 189.6 lb → 86 kg, BP/body fat skipped');
ok(pc.activities.length === 0, 'Cronometer exercises are opt-in');
const pc2 = I.buildPlan(all, ex0(), { cronExercises: true }); ok(pc2.activities.length === 2 && pc2.activities[0].kcalOverride === 183 && pc2.activities[0].exercises.length === 0, 'opt-in: 2 calorie-only activities');
const onlyDaily = I.buildPlan([fx('cronometer_dailysummary.csv')], ex0()); ok(onlyDaily.diary.length === 3, 'daily summary alone → 3 daily totals');

// dedupe: same files again against the result of the first import
const after = { ...ex0(), exercises: [...I.SEED_EXERCISES, ...p.exercises, ...pl.exercises], workouts: [...p.workouts, ...pl.workouts, ...pc2.activities], diaryIds: new Set(pc.diary.map((e) => e.id)), diaryCronDates: new Set(pc.diary.filter((e) => !e.id.startsWith('cron-day-')).map((e) => e.date)), bodyweight: pc.bodyweight };
const re = I.buildPlan([fx('hevy_workouts_kg.csv'), fx('hevy_workouts_lbs.csv'), ...all], after, { cronExercises: true });
ok(re.workouts.length === 0 && re.diary.length === 0 && re.bodyweight.length === 0 && re.activities.length === 0 && re.exercises.length === 0, 'second import of the same files adds nothing');
ok(re.skipped.workouts === 5 && re.skipped.diary === 9 && re.skipped.weighIns === 4 && re.skipped.activities === 2, 'skipped: ' + JSON.stringify(re.skipped));
ok(I.buildPlan([fx('hevy_workouts_kg.csv')], ex0()).workouts.map((w) => w.id).join() === p.workouts.map((w) => w.id).join(), 'IDs are stable across runs');
if (bad) { console.log(`IMPORT UNIT TESTS FAILED (${bad})`); process.exit(1); } console.log('IMPORT UNIT TESTS PASSED');
