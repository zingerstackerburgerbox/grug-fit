/** v1.9.1 Settings › Appearance: mode + accent (presets / custom) with a live preview; applied instantly.
 * v1.9.3: seasonal overlay section (Halloween decorations on top of any theme while the season runs; one-tap off, remembered). */
import { useEffect } from 'preact/hooks';
import { getSettings, put } from '../db';
import { useQuery, useSettings } from '../hooks';
import { activeSeason, applySeason, applyTheme, MODES, overlaySeason, PRESETS, seasonEndLabel, seasonKey, themeOf, type Theme } from '../theme';
import { Bar, Ring, Seg } from '../ui';

/** keeps the page in sync with the stored theme (also after a backup restore or a change on another tab) */
export function ThemeSync() { const s = useQuery(getSettings, []); const t = s?.theme; const sp = JSON.stringify(s?.seasonal || null);
  useEffect(() => { if (s) applyTheme(t); }, [!!s, t?.mode, t?.accent]); useEffect(() => { if (s) applySeason(s.seasonal); }, [!!s, sp]); return null; } // waits for real settings (no flash to the default)

export function AppearanceSettings() {
  const s = useSettings(); const t = themeOf(s.theme); const se = activeSeason(); const hw = !!overlaySeason(s.seasonal);
  useEffect(() => { if (/[?&]appearance=1/.test(location.hash)) setTimeout(() => document.getElementById('appearance')?.scrollIntoView({ block: 'start' }), 80); }, []);
  const set = async (p: Partial<Theme>) => { const cur = await getSettings(); const next = { ...themeOf(cur.theme), ...p }; applyTheme(next); await put('kv', { ...cur, theme: next }); };
  const setOverlay = async (on: boolean) => { if (!se) return; const cur = await getSettings(); const seasonal = { ...(cur.seasonal || {}), [seasonKey(se)]: on ? 'on' as const : 'off' as const }; applySeason(seasonal); await put('kv', { ...cur, seasonal }); };
  const reset = async () => { const cur = await getSettings(); const { theme, ...rest } = cur; applyTheme(null); await put('kv', rest); };
  const isPreset = PRESETS.some(([, c]) => c === t.accent);
  return <div class="card col" id="appearance" data-testid="appearance">
    {se && <div class="season-box" data-testid="season-box">
      <div class="row between" style="align-items:center;gap:8px"><div><b>{se.emoji} {se.name}</b><div class="mut xs">Spiders, webs and jack-o'-lanterns on top of your theme · until {seasonEndLabel(se)}</div></div>
        {hw ? <button class="btn sm" onClick={() => setOverlay(false)} data-testid="halloween-off">Turn off {se.name} theme</button>
          : <button class="btn p sm" onClick={() => setOverlay(true)} data-testid="halloween-on">Turn on</button>}</div>
    </div>}
    <div class="sm b">Mode</div>
    <Seg value={t.mode} options={MODES} onChange={(m) => set({ mode: m })} />
    <div class="mut xs">{t.mode === 'system' ? 'Follows your phone’s light/dark setting.' : t.mode === 'amoled' ? 'True black background – saves battery on OLED screens.' : ''}</div>
    <div class="sm b" style="margin-top:6px">Accent colour</div>
    <div class="swatches" data-testid="swatches">
      {PRESETS.map(([n, c]) => <button class={'accsw' + (t.accent === c ? ' on' : '')} style={`background:${c}`} aria-label={n} title={n} aria-pressed={t.accent === c} data-testid={'swatch-' + n.toLowerCase()} onClick={() => set({ accent: c })} />)}
      <label class={'accsw custom' + (!isPreset ? ' on' : '')} title="Custom colour" style={!isPreset ? `background:${t.accent}` : ''}>
        <input type="color" value={t.accent} data-testid="accent-custom" aria-label="Custom accent colour" onInput={(e) => set({ accent: e.currentTarget.value })} /><span>{isPreset ? '+' : ''}</span></label>
    </div>
    <div class="mut xs">{isPreset ? PRESETS.find(([, c]) => c === t.accent)![0] : `Custom ${t.accent}`} · text on buttons switches between dark and light automatically so it stays readable.</div>
    <div class="theme-preview" data-testid="theme-preview">
      <div class="row between"><b>Preview</b><span class="pill ok">🏆 2 PR</span></div>
      <div class="row" style="gap:12px;align-items:center"><Ring value={1420} target={2000} color="var(--kcal)" label="kcal" size={70} />
        <div class="grow col" style="gap:8px"><Bar value={65} target={100} color="var(--acc)" /><div class="row" style="gap:6px"><span class="chip on">Chicken</span><span class="chip">Rice</span></div><a style="color:var(--acc-text)" href="#/settings" onClick={(e) => e.preventDefault()}>Link text</a></div></div>
      <button class="btn p full" onClick={(e) => e.preventDefault()}>+ Start workout</button>
    </div>
    {(t.mode !== 'dark' || t.accent !== '#22c55e') && <button class="btn g sm" onClick={reset} data-testid="theme-reset">Reset to default (Dark, Green)</button>}
  </div>;
}
