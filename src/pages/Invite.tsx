import { useEffect, useMemo, useState } from 'preact/hooks';
import qrcode from 'qrcode-generator';
import { useSettings } from '../hooks';
import { Top, toast } from '../ui';
import { inviteText, inviteUrl, takeGreeting } from '../invite';

export function InviteRow() {
  return <a class="btn g row between" style="justify-content:space-between" href="#/settings/invite" data-testid="invite-row"><span>👋 Invite friends</span><span class="mut">›</span></a>;
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch { return false; }
}

export function InvitePage() {
  const s = useSettings(); const name = s.username || undefined;
  const url = inviteUrl(name); const text = inviteText(name);
  const svg = useMemo(() => { const q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); }, [url]);
  const canShare = typeof navigator.share === 'function';
  const share = async () => {
    try { await navigator.share({ title: 'Lunk', text, url }); } catch (e: any) { if (e?.name !== 'AbortError') doCopy(); }
  };
  const doCopy = async () => toast((await copy(url)) ? 'Copied' : 'Could not copy, long-press the link instead');
  return <><Top title="Invite friends" backBtn /><div class="page col" data-testid="invite-page">
    <div class="card col">
      <b>Bring your gym mates</b>
      <div class="sm mut">Grug say: lifting more fun with tribe. Send them the link.</div>
      <div class="sm invite-link" data-testid="invite-url" style="word-break:break-all;user-select:all">{url}</div>
      <div class="grid2">
        {canShare && <button class="btn p" data-testid="invite-share" onClick={share}>Share</button>}
        <button class={'btn' + (canShare ? '' : ' p')} data-testid="invite-copy" onClick={doCopy}>Copy link</button>
      </div>
    </div>
    <div class="card col" style="align-items:center">
      <div class="sm mut">At the gym? Let them scan this.</div>
      <div data-testid="invite-qr" style="width:220px;height:220px;background:#fff;border-radius:12px;padding:6px" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
    <div class="card col">
      <div class="sm" data-testid="invite-install">To install: open in Chrome, then tap Add to Home screen.</div>
      <div class="sm mut" data-testid="invite-lb">Compete with them: join the <a href="#/leaderboard">Training leaderboard</a>.</div>
    </div>
  </div></>;
}

/** "<name> invited you", shown once on the invited person's first open */
export function InviteGreeting() {
  const [who, setWho] = useState<string | null>(null);
  useEffect(() => { setWho(takeGreeting()); }, []);
  if (!who) return null;
  return <div class="card row between" data-testid="invite-greeting" style="margin:8px;align-items:center"><span class="sm"><b>{who}</b> invited you. Welcome to Lunk! Grug happy you here.</span>
    <button class="btn g sm" aria-label="Dismiss" onClick={() => setWho(null)}>✕</button></div>;
}
