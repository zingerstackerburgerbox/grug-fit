// Realistic "Erik" profile for Grug's Review / stars tests and screenshots: 5 weeks of history (Push/Pull/Legs,
// bench creeping up, squat stuck), food logged daily around 2,300 kcal with protein often short, weekday steps ~8.5k and
// lazy weekends, creatine + vitamin D taken every morning. Writes straight into IndexedDB 'grugfit' of the open page.
const pad = (n) => String(n).padStart(2, '0');
export const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export async function seedWeek(page, { days = 35, adminToken, stepsToday = true, history = true } = {}) {
  const now = new Date(); const at = (off, h, m = 0) => { const d = new Date(now); d.setDate(d.getDate() + off); d.setHours(h, m, 0, 0); return d; };
  const exNames = ['Bench Press (Barbell)', 'Overhead Press (Barbell)', 'Incline Bench Press (Dumbbell)', 'Triceps Pushdown (Cable)', 'Lateral Raise (Dumbbell)',
    'Deadlift (Barbell)', 'Pull Up', 'Bent Over Row (Barbell)', 'Bicep Curl (Dumbbell)', 'Squat (Barbell)', 'Romanian Deadlift (Barbell)', 'Leg Press (Machine)', 'Leg Extension (Machine)'];
  const plan = {
    'Push A': [['Bench Press (Barbell)', 4, 5, 'bench'], ['Overhead Press (Barbell)', 3, 8, 50], ['Incline Bench Press (Dumbbell)', 3, 10, 28], ['Triceps Pushdown (Cable)', 3, 12, 30], ['Lateral Raise (Dumbbell)', 3, 15, 10]],
    'Pull A': [['Deadlift (Barbell)', 3, 5, 140], ['Pull Up', 4, 8, 0], ['Bent Over Row (Barbell)', 3, 8, 70], ['Bicep Curl (Dumbbell)', 3, 12, 14]],
    'Legs A': [['Squat (Barbell)', 4, 5, 100], ['Romanian Deadlift (Barbell)', 3, 8, 90], ['Leg Press (Machine)', 3, 12, 180], ['Leg Extension (Machine)', 3, 15, 55]] };
  // workouts: this week Mon Push / Tue Pull / Thu Legs / Fri Push-ish, earlier weeks 3–4 a week
  const sessions = []; let bench = 75;
  for (let off = -days + 1; off <= -1; off++) {
    const d = at(off, 18); const wd = d.getDay(); const thisWeek = off >= -6;
    const name = wd === 1 ? 'Push A' : wd === 2 ? 'Pull A' : wd === 4 ? 'Legs A' : wd === 5 && thisWeek ? 'Push A' : wd === 6 && !thisWeek && off % 2 === 0 ? 'Push A' : null;
    if (!name) continue; if (name === 'Push A') bench = Math.min(82.5, bench + 1.25);
    sessions.push({ off, name, bench: thisWeek && wd === 5 ? 82.5 : thisWeek ? 80 : Math.min(80, bench) });
  }
  const foodsDay = (off) => {
    const short = [-1, -3, -5, -6].includes(off) || off <= -8 && off % 3 === 0; const lazy = at(off, 12).getDay() % 6 === 0;
    const it = [['breakfast', 'Oats with whey and banana', 120, 520, 38, 72, 9, 8], ['lunch', 'Chicken rice bowl', 420, 680, 52, 78, 14, 6],
      ['dinner', short ? 'Spaghetti bolognese' : 'Steak, potatoes and greens', 480, short ? 760 : 720, short ? 38 : 62, short ? 92 : 58, short ? 24 : 26, 7],
      ['snacks', short ? 'Muesli bar' : 'Greek yoghurt and berries', short ? 45 : 250, short ? 190 : 210, short ? 3 : 24, short ? 28 : 22, short ? 7 : 3, 2]];
    if (!short) it.push(['snacks', 'Protein shake', 300, 160, 30, 4, 2, 0]); if (lazy) it.push(['dinner', 'Beer', 375, 150, 1, 11, 0, 0]);
    return it; };
  await page.evaluate(async ({ days, exNames, plan, sessions, food, steps, adminToken, history, today }) => {
    const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
    const P = (req) => new Promise((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); });
    const st = (s, m = 'readwrite') => d.transaction(s, m).objectStore(s);
    const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const day = (off, h = 12, m = 0) => { const x = new Date(); x.setDate(x.getDate() + off); x.setHours(h, m, 0, 0); return x; };
    const exs = await P(st('exercises', 'readonly').getAll()); const id = (n) => exs.find((e) => e.name === n).id;
    exNames.forEach(id);
    let n = 0; const uid = () => 'seed' + (++n).toString(36);
    const s = await P(st('kv', 'readonly').get('settings'));
    await P(st('kv').put({ ...s, username: 'Erik', targets: { ...s.targets, kcal: 2400, protein: 180, carbs: 240, fat: 75, fibre: 30 }, profile: { heightCm: 182, sex: 'male', birthYear: 1992, goal: 'maintain' },
      stepGoal: 8000, workoutGoal: 4, coachConsent: true, factCard: 'off', ...(adminToken ? { adminToken } : {}) }));
    await P(st('bodyweight').put({ id: 'bw-seed', date: ymd(day(-2)), kg: 84.2 }));
    const rIds = {};
    for (const [name, list] of Object.entries(plan)) { const rid = 'r-' + name.replace(/\W/g, ''); rIds[name] = rid;
      await P(st('routines').put({ id: rid, name, updated: Date.now(), exercises: list.map(([e, sets, reps, kg]) => ({ exerciseId: id(e), sets, reps, kg: kg === 'bench' ? 80 : kg || undefined, restSec: 120 })) })); }
    if (history) for (const w of sessions) {
      const start = day(w.off, 18).getTime();
      const exercises = plan[w.name].map(([e, sets, reps, kg], i) => ({ id: uid(), exerciseId: id(e), restSec: 120,
        sets: Array.from({ length: sets }, (_, k) => ({ id: uid(), type: 'N', kg: kg === 'bench' ? w.bench : kg, reps: e === 'Squat (Barbell)' && k === sets - 1 ? 4 : reps, done: true, doneAt: start + (i * 8 + k * 2) * 60000 })) }));
      await P(st('workouts').put({ id: 'w' + w.off, name: w.name, routineId: rIds[w.name], start, end: start + 62 * 60000, exercises }));
    }
    let foodN = 0;
    for (const [off, items] of food) for (const [meal, name, grams, kcal, protein, carbs, fat, fibre] of items) {
      await P(st('diary').put({ id: 'd' + (++foodN), date: ymd(day(off)), meal, foodId: 'seed-' + name, name, grams, qty: grams, serving: 'g', n: { kcal, protein, carbs, fat, fibre }, created: day(off, 8).getTime() }));
    }
    await P(st('kv').put({ id: 'stepLog', days: Object.fromEntries(steps) }));
    const supps = [['s-crea', 'Creatine', 5, 'g', 'powder', '#22c55e'], ['s-vitd', 'Vitamin D', 1000, 'IU', 'capsule', '#f59e0b']];
    for (const [sid, name, amt, unit, form, color] of supps) {
      await P(st('supplements').put({ id: sid, name, kind: 'supplement', doseAmount: amt, unit, form, unitsPerDose: 1, lowStock: 5, stock: 60, color }));
      await P(st('schedules').put({ id: 'sch-' + sid, suppId: sid, type: 'daily', weekdays: [], interval: 1, times: ['07:30'], start: ymd(day(-days)), reminders: false, active: true, created: day(-days, 6).getTime() }));
      for (let off = -days + 1; off <= 0; off++) await P(st('doselogs').put({ id: `dl-${sid}-${off}`, suppId: sid, scheduleId: 'sch-' + sid, date: ymd(day(off)), slot: '07:30', takenAt: day(off, 7, 42).getTime(), amount: 1 }));
    }
    d.close();
  }, { days, exNames, plan, sessions, today: ymdOf(now),
    food: [...Array.from({ length: days - 1 }, (_, i) => [-days + 1 + i, foodsDay(-days + 1 + i)]), [0, [['breakfast', 'Oats with whey and banana', 120, 520, 38, 72, 9, 8], ['lunch', 'Tuna wrap', 230, 360, 30, 34, 10, 4]]]],
    steps: Array.from({ length: days }, (_, i) => { const off = -days + 1 + i; const wd = at(off, 12).getDay(); return [ymdOf(at(off, 12)), off === 0 ? (stepsToday ? 3100 : 0) : wd % 6 === 0 ? 4100 + (i % 3) * 300 : 8200 + (i % 4) * 350]; }).filter(([, v]) => v > 0),
    adminToken, history });
}
