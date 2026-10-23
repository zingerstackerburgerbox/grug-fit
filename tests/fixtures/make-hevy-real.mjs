// Generates hevy_real_style.csv: 63 workouts (Jan–Oct 2026) in the exact style of real 2024–2026 Hevy exports –
// every text field quoted, numbers bare, "d MMM yyyy, HH:mm" local times, warm-up/normal/failure/dropset sets, empty weights on
// bodyweight sets, supersets, RPE on some sets, a timed plank, a cardio row with distance, notes with commas/quotes/newlines.
import { writeFileSync } from 'node:fs';
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d) => `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const DAYS = {
  Push: [['Bench Press (Barbell)', 60, 8], ['Incline Bench Press (Dumbbell)', 26, 10], ['Lateral Raise (Dumbbell)', 10, 15], ['Triceps Rope Pushdown', 25, 12]],
  Pull: [['Deadlift (Barbell)', 120, 5], ['Chin Up (Weighted)', 5, 6], ['Seated Cable Row - V Grip (Cable)', 55, 10], ['Bicep Curl (Dumbbell)', 14, 10]],
  Legs: [['Squat (Barbell)', 90, 6], ['Romanian Deadlift (Barbell)', 80, 8], ['Leg Extension (Machine)', 50, 12], ['Plank', 0, 60]]
};
const rows = [['title', 'start_time', 'end_time', 'description', 'exercise_title', 'superset_id', 'exercise_notes', 'set_index', 'set_type', 'weight_kg', 'reps', 'distance_km', 'duration_seconds', 'rpe'].map(q).join(',')];
let d = new Date(2026, 0, 5, 6, 40); const order = ['Push', 'Pull', 'Legs'];
for (let i = 0; i < 63; i++) {
  const title = i === 30 ? 'Cardio + core' : order[i % 3] + (i % 6 >= 3 ? ' B' : ' A');
  const start = new Date(d); start.setMinutes(start.getMinutes() + Math.floor(rnd() * 50)); const end = new Date(start.getTime() + (55 + Math.floor(rnd() * 35)) * 60e3);
  const desc = i === 1 ? 'Felt "great", slept 8h\nnew gym' : i % 10 === 0 ? 'Deload week, kept it light' : '';
  const prog = 1 + i * 0.004;
  const exs = i === 30 ? [['Running', 0, 0], ['Plank', 0, 60]] : DAYS[order[i % 3]];
  exs.forEach(([name, kg0, reps], ei) => {
    const ss = ei >= 2 && i % 2 === 0 ? String(0) : ''; const note = ei === 0 && i % 7 === 0 ? 'Pause reps, 1s on chest' : '';
    const sets = name === 'Running' ? [['normal']] : name === 'Plank' ? [['normal'], ['normal']] : [['warmup'], ['normal'], ['normal'], ['normal'], ...(i % 5 === 0 ? [['failure']] : []), ...(i % 9 === 0 && ei === 3 ? [['dropset']] : [])];
    sets.forEach(([type], si) => {
      let w = '', r = '', km = '', dur = '', rpe = '';
      if (name === 'Running') { km = (4 + rnd() * 2).toFixed(2); dur = String(1500 + Math.floor(rnd() * 600)); }
      else if (name === 'Plank') dur = String(reps + si * 15);
      else {
        const k = type === 'warmup' ? kg0 * 0.5 : type === 'dropset' ? kg0 * 0.7 : kg0 * prog;
        w = name.startsWith('Chin Up') && type === 'warmup' ? '' : String(Math.round(k * 2) / 2); r = String(type === 'warmup' ? 10 : type === 'failure' ? reps - 2 : reps + (si === 3 ? -1 : 0));
        if (si === 3 && i % 4 === 0) rpe = String(8 + (i % 3) * 0.5);
      }
      rows.push([q(title), q(fmt(start)), q(fmt(end)), q(desc), q(name), ss, q(note), si, q(type), w, r, km, dur, rpe].join(','));
    });
  });
  d = new Date(d.getTime() + (i % 3 === 2 ? 3 : 2) * 864e5 + Math.floor(rnd() * 2) * 864e5);
}
writeFileSync(new URL('./hevy_real_style.csv', import.meta.url), rows.join('\n') + '\n');
console.log('rows', rows.length - 1, 'last', d.toDateString());
