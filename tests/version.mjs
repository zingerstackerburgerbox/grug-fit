import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(process.argv[2]); await p.fill('[data-testid=ob-username]', 'grug_tester').then(() => p.click('[data-testid=ob-next]')).then(() => p.click('[data-testid=ob-skip]')); await p.waitForSelector("text=Today's nutrition"); await p.goto(process.argv[2] + '#/settings');
console.log('live version:', await p.textContent('[data-testid=app-version]'), await p.textContent('[data-testid=build-id]')); await b.close();
