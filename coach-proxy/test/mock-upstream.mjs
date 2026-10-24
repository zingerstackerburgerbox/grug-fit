// Mock xAI chat-completions endpoint for local testing (no key, no cost). Streams SSE when stream:true.
import http from 'node:http';
export function startMock(port = 8788) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      let j = {}; try { j = JSON.parse(body); } catch {}
      seen.push({ auth: req.headers.authorization, body: j });
      if (j.messages?.some((m) => /UPSTREAM_FAIL/.test(m.content))) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"boom"}'); return; }
      const sys = j.messages?.[0]?.content || ''; const u = JSON.stringify(j.messages?.at(-1)?.content || '');
      if (/^You are Grug, the caveman/.test(sys)) {
        if (/REVIEW_FAIL/.test(u)) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"boom"}'); return; }
        const content = /REVIEW_BAD/.test(u) ? 'Grug think week good.' : JSON.stringify({ scores: { overall: 7.5, training: 8, nutrition: 6.5, consistency: 8 }, headline: 'Strong week', quote: 'Strong week. Protein a bit low, muscle hungry.',
          summary: 'Grug see strong week. You lift heavy rock 4 times.', went_well: ['4 of 4 planned workouts'], slipped: ['Protein hit 3/7 days'],
          tips: [{ icon: '🥩', title: 'Close the protein gap', data: 'Avg 165 g vs 180 g', body: 'Add 15-20 g a day.', action: { type: 'add_food', day: 'tomorrow', meal: 'snacks', foods: [{ name: 'Greek yoghurt', grams: 200, kcal: 146, protein: 20, carbs: 8, fat: 4 }] } },
            { icon: '🏋️', title: 'Unstick your squat', data: 'Squat 100 kg × 5', body: 'Add a back-off set.', action: { type: 'add_routine_set', routine: 'Legs A', exercise: 'Squat (Barbell)', sets: 1, reps: 8, kg: 90 } },
            { icon: '🔔', title: 'Walk on rest days', data: 'Sat 4,200', body: 'Walk 25 min.', action: { type: 'set_reminder', when: 'Sat 4pm' } }] });
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })); return;
      }
      if (/^You estimate/.test(sys)) {
        if (/EST_FAIL/.test(u)) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"boom"}'); return; }
        if (/EST_SLOW/.test(u)) return; // never answers (timeout)
        const content = /EST_BADJSON/.test(u) ? 'Sure! About 400 kcal.' : /EST_NOTFOOD/.test(u) ? '{"items":[],"confidence":"low","note":"A shoe is not food."}'
          : '```json\n{"items":[{"name":"Scrambled eggs","qty":"2 large eggs","grams":110,"kcal":180,"protein":13,"carbs":1,"fat":13},{"name":"Toast","qty":"2 slices","grams":70,"kcal":180,"protein":6,"carbs":33,"fat":2,"fibre":3}],"confidence":"medium","note":"Assumed 5 g butter."}\n```';
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })); return;
      }
      const text = 'Mock coach reply: **eat more protein**.';
      if (j.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const piece of text.match(/.{1,8}/g)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      } else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] })); }
    });
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ srv, seen })));
}
if (import.meta.url === `file://${process.argv[1]}`) startMock(+(process.env.PORT || 8788)).then(() => console.log('mock xAI upstream on http://127.0.0.1:' + (process.env.PORT || 8788)));
