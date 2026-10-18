// The artifact panel beside the chat (Claude-style): kind icon, title, version chip, status; one primary action
// (hold-to-publish), open as page, an overflow menu (copy link, as-of, unpublish) and close. Edits by chat arrive over
// the live socket and the panel moves to the new version.
// Motion: the panel slides in over the rail on the compositor only (transform + opacity, 320 ms); when the slide ends
// it settles into the layout (the chat column reflows once) and its content mounts, so nothing lays out mid-motion.
// Close slides out (240 ms) in place, then unmounts.
import { useEffect, useRef, useState } from 'react';
import { Ellipsis, ExternalLink, FileText, Globe, LayoutDashboard, Lock, X } from 'lucide-react';
import { StoryView, AsOfBanner } from './story.tsx';
import { Button, NeedsYou, Segmented } from './ds.tsx';
import { api, printHref, shareUrl, storyHref, useData, useStory, type StoryMeta } from '../data/api.ts';

/** "Live · updated 12s ago", ticking; "Frozen" under as-of. */
export function LiveSince({ at, frozen }: { at: number; frozen?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (frozen) return <span className="mb-live-since">Frozen in time</span>;
  const s = Math.max(0, Math.round((now - at) / 1000));
  return <span className="mb-live-since" data-live><i aria-hidden="true" />Live · updated {s < 60 ? `${s}s` : `${Math.round(s / 60)} min`} ago</span>;
}

const OPEN_MS = 320, CLOSE_MS = 240;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Keeps the panel mounted while it slides out, and holds its content back until the slide in has finished. */
export function StoryPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [s, set] = useState({ id, shown: id, closing: false, ready: false });
  if (s.id !== id) set({ id, shown: id ?? s.shown, closing: !id && !!s.shown, ready: !!id && !!s.id && s.ready }); // derived, no extra commit
  useEffect(() => {
    if (s.closing) { const t = setTimeout(() => set((x) => ({ ...x, shown: null, closing: false, ready: false })), still() ? 0 : CLOSE_MS); return () => clearTimeout(t); }
    if (s.shown && !s.ready) { const t = setTimeout(() => set((x) => ({ ...x, ready: true })), still() ? 0 : OPEN_MS); return () => clearTimeout(t); }
  }, [s.closing, s.shown, s.ready]);
  if (!s.shown) return null;
  return <Panel id={s.shown} ready={s.ready} closing={s.closing} onClose={onClose} />;
}

/** Share, one entry point (Notion/Claude style): a button that says who can see this, and a popover with the access
 *  choice (Segmented: Signed-in people / Anyone with the link), the link with Copy and Open, and "publish the latest" when the
 *  public link lags. Not the owner: just the word. */
export function Share({ m, url, onPublish, onCopy }: { m: StoryMeta; url: string; onPublish: (on: boolean) => void; onCopy: () => void }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!host.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('pointerdown', down); addEventListener('keydown', key);
    return () => { removeEventListener('pointerdown', down); removeEventListener('keydown', key); };
  }, [open]);
  const pub = m.status === 'published';
  const latest = m.versions.at(-1), live = m.published?.at(-1) ?? latest; // no publish history sent: the link shows the latest
  const behind = pub && live !== undefined && latest !== undefined && live < latest;
  const kind = m.kind === 'dashboard' ? 'dashboard' : 'story';
  if (!m.owner) return <span className="mb-share-word">{pub ? <><Globe size={14} strokeWidth={1.5} aria-hidden="true" />Public</> : <><Lock size={14} strokeWidth={1.5} aria-hidden="true" />Draft</>}</span>;
  return (
    <div className="mb-menu-host" ref={host}>
      <Button variant={pub && !behind ? 'secondary' : 'primary'} size="sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {pub ? <Globe size={16} strokeWidth={1.5} aria-hidden="true" /> : <Lock size={16} strokeWidth={1.5} aria-hidden="true" />}Share
      </Button>
      {open && (
        <div className="mb-menu mb-share" role="dialog" aria-label={`Share this ${kind}`}>
          <p className="mb-share-title">Share this {kind}</p>
          <Segmented label="Who can see it" value={pub ? 'link' : 'me'} onChange={(v) => { if ((v === 'link') !== pub) onPublish(v === 'link'); }}
            options={[{ id: 'me', label: 'Signed-in people' }, { id: 'link', label: 'Anyone with the link' }]} />
          <p className="mb-share-who">{pub
            ? <>Anyone with the link, signed in or not, sees <span className="mono">v{live}</span>, live, with every receipt.{behind && <> Your latest is <span className="mono">v{latest}</span>.</>}</>
            : <>Only people signed in to Mochi Brain can see it. Anyone with the link makes a read-only page anyone can open, no sign-in.</>}</p>
          {pub && (
            <div className="mb-share-link">
              <span className="mono" title={url}>{url.replace(/^https?:\/\//, '')}</span>
              <Button size="sm" success="Copied" onClick={onCopy}>Copy</Button>
              <a className="mb-icon-btn" href={url} target="_blank" rel="noreferrer" aria-label="Open the public link" title="Open the public link"><ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" /></a>
            </div>
          )}
          {behind && <Button variant="primary" size="sm" hold={700} success="Published" onClick={() => onPublish(true)}>{`Publish v${latest} to the link`}</Button>}
        </div>
      )}
    </div>
  );
}

export type Item = { label: string; on: () => void };
/** Icon-only "More" menu: closes on Escape (focus back to the trigger) and on an outside press. */
export function Overflow({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!host.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    addEventListener('pointerdown', down); addEventListener('keydown', key);
    host.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => { removeEventListener('pointerdown', down); removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="mb-menu-host" ref={host}>
      <button ref={trigger} type="button" className="mb-icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ellipsis size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && (
        <div className="mb-menu" role="menu">
          {items.map((i) => <button key={i.label} type="button" role="menuitem" className="mb-menu-item" onClick={() => { setOpen(false); i.on(); }}>{i.label}</button>)}
        </div>
      )}
    </div>
  );
}

function Panel({ id, ready, closing, onClose }: { id: string; ready: boolean; closing: boolean; onClose: () => void }) {
  const [pick, setPick] = useState<number | undefined>(); // undefined = follow the latest
  const [asOf, setAsOf] = useState<number | undefined>();
  const [meta, setMeta] = useState<Partial<StoryMeta>>({});
  const [toast, setToast] = useState<string | null>(null);
  const r = useStory(id, pick, asOf);
  const story = r.data?.story;
  const m = { ...r.data?.meta, ...meta } as StoryMeta | undefined;
  useEffect(() => setMeta({}), [r.data]);
  useEffect(() => { setPick(undefined); setAsOf(undefined); }, [id]);
  const shown = story?.version;
  const prev = useData(() => (shown && shown > 1 ? api.story(id, shown - 1) : Promise.resolve(undefined)), [id, shown]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const copy = async (url: string) => { await navigator.clipboard?.writeText(url).catch(() => {}); };
  const publish = async (on: boolean) => {
    try {
      const next = await api.publish(id, on);
      setTimeout(() => setMeta(next), on ? 900 : 0); // let the held button land first
      if (on) { const url = shareUrl(id, next.kind); await copy(url); setToast(`Published. Link copied: ${url}`); }
      else setToast('Unpublished. Only signed-in people can see it now.');
    } catch (e) { setToast((e as Error).message); }
  };

  const versions = m?.versions ?? [];
  const latest = versions.at(-1);
  const live = m?.published?.at(-1);
  const behind = m?.status === 'published' && live !== undefined && latest !== undefined && live < latest;
  const show = ready && story && m;
  const Icon = m?.kind === 'dashboard' ? LayoutDashboard : FileText;
  const items: Item[] = show ? [
    { label: 'Copy link', on: () => void copy(shareUrl(id, m.kind)).then(() => setToast('Link copied.')) },
    { label: 'Export as PDF', on: () => void window.open(printHref(id, m.kind, pick, asOf), '_blank', 'noopener') },
    asOf === undefined ? { label: 'As of the day before', on: () => setAsOf(story.generated_at - 86_400_000) } : { label: 'See it live', on: () => setAsOf(undefined) },
  ] : [];
  return (
    <aside className="mb-panel" data-closing={closing || undefined} data-settled={ready || undefined} aria-label="Open story">
      <header className="mb-panel-head">
        <div className="mb-panel-title">
          {show ? (
            <div className="mb-panel-name">
              <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
              <h2 className="t-title">{story.title}</h2>
              {versions.length > 1
                ? <select className="mb-ver-chip" aria-label="Version" value={String(shown)} onChange={(e) => setPick(Number(e.target.value) === latest ? undefined : Number(e.target.value))}>
                  {versions.map((v) => <option key={v} value={v}>v{v}</option>)}
                </select>
                : <span className="mb-ver-chip">v{shown}</span>}
            </div>
          ) : <div className="mb-panel-name mb-skel" aria-label="Loading the story"><i style={{ width: '60%' }} /></div>}
          <div className="mb-panel-tools">
            {show && <Share key={`s${latest}`} m={m} url={shareUrl(id, m.kind)} onPublish={(on) => void publish(on)} onCopy={() => void copy(shareUrl(id, m.kind))} />}
            {show && <a className="mb-icon-btn" href={storyHref(id, m.kind)} target="_blank" rel="noreferrer" aria-label="Open as page"><ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" /></a>}
            {show && <Overflow items={items} />}
            <button type="button" className="mb-icon-btn" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={1.5} aria-hidden="true" /></button>
          </div>
        </div>
        <p className="mb-panel-caption t-caption muted">
          {show ? <>{m.kind === 'dashboard' ? 'Dashboard' : 'Story'} · {m.status === 'published' ? 'Public' : 'Draft: only signed-in people can see it'}<LiveSince at={r.updatedAt} frozen={asOf !== undefined} /></> : ' '}
        </p>
      </header>
      <div className="mb-panel-body">
        {show && asOf !== undefined && <div className="mb-panel-asof"><AsOfBanner asOf={asOf} /></div>}
        {r.error && ready ? <NeedsYou mood="sorry" title="I can't open this story" reason={r.error} />
          : !show ? <div className="mb-skel mb-panel-skel" aria-label="Loading the story">{[90, 70, 80, 60, 85].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
          : <div className="mb-fade" key={story.version}>
            <StoryView input={story} asOf={asOf} header={false} prev={prev.data?.story} dashboard={m.kind === 'dashboard'} />
          </div>}
      </div>
      {toast && <div className="mb-toast" role="status">{toast}</div>}
    </aside>
  );
}
