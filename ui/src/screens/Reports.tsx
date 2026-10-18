// The reports library: #/reports[/:id[@n]][?asOf=ms]. Left, every story and dashboard this visitor may read (GET
// /api/stories, same visibility as reading one) with search, kind chips and Today / Yesterday / Earlier groups; right,
// the picked one in the story renderer under a 48px header (version, Publish for the owner, open as page, More).
// Nothing picked: the newest morning report. Below 1180px the list overlays from a list button; on a phone it is a sheet.
import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, FileText, LayoutDashboard, List, PanelLeftClose, Search, Sunrise } from 'lucide-react';
import { StoryView, AsOfBanner } from '../components/story.tsx';
import { Button, NeedsYou } from '../components/ds.tsx';
import { LiveSince, Overflow, type Item } from '../components/story-panel.tsx';
import { useStories } from '../components/chat/outputs-rail.tsx';
import { fmtTime } from '../components/receipts.tsx';
import { api, fmtDay, printHref, shareUrl, storyHref, useData, useStory, type StoryMeta, type StoryRow } from '../data/api.ts';

const icon = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;
const libHref = (id: string, version?: number, asOf?: number) => `#/reports/${id}${version ? `@${version}` : ''}${asOf !== undefined ? `?asOf=${asOf}` : ''}`;
const isDream = (s: StoryRow) => s.generated_by === 'dream';
const FILTERS = [
  { id: 'all', label: 'All', on: () => true },
  { id: 'story', label: 'Stories', on: (s: StoryRow) => s.kind !== 'dashboard' && !isDream(s) },
  { id: 'dashboard', label: 'Dashboards', on: (s: StoryRow) => s.kind === 'dashboard' },
  { id: 'dream', label: 'Morning reports', on: isDream },
] as const;
const ago = (at: number, now: number) => {
  const m = Math.round((now - at) / 60_000);
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const group = (at: number, now: number) => { const d = fmtDay(at, now); return d === 'Today' || d === 'Yesterday' ? d : 'Earlier'; };

function Library({ list, current, onPick, onClose }: { list: StoryRow[]; current?: string; onPick: () => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<(typeof FILTERS)[number]['id']>('all');
  const now = Date.now();
  const needle = q.trim().toLowerCase();
  const rows = list.filter((s) => FILTERS.find((x) => x.id === f)!.on(s) && (!needle || `${s.title} ${s.topic}`.toLowerCase().includes(needle)));
  const groups = ['Today', 'Yesterday', 'Earlier'].map((g) => [g, rows.filter((s) => group(s.generated_at, now) === g)] as const).filter(([, r]) => r.length);
  return (
    <nav className="mb-threads mb-lib-side" aria-label="Reports">
      <div className="mb-col-head">
        <span className="mb-col-title">Reports <span className="mono muted">{list.length}</span></span>
        <button type="button" className="mb-icon-btn mb-lib-close" aria-label="Hide reports" onClick={onClose}><PanelLeftClose {...icon} /></button>
      </div>
      <div className="mb-lib-tools">
        <label className="mb-lib-search"><Search {...icon} /><input type="search" placeholder="Search reports" aria-label="Search reports" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="mb-lib-chips" role="group" aria-label="Show">
          {FILTERS.map((x) => <button key={x.id} type="button" className="mb-lib-chip" aria-pressed={f === x.id} onClick={() => setF(x.id)}>{x.label}</button>)}
        </div>
      </div>
      <ul>
        {groups.map(([g, r]) => (
          <li key={g}>
            <h3 className="mb-lib-group">{g}</h3>
            <ul>
              {r.map((s) => {
                const Icon = isDream(s) ? Sunrise : s.kind === 'dashboard' ? LayoutDashboard : FileText;
                return (
                  <li key={s.id}>
                    <a className="mb-thread-row mb-lib-row" href={libHref(s.id)} aria-current={s.id === current ? 'page' : undefined} onClick={onPick}>
                      <Icon {...icon} />
                      <span className="mb-thread-title">{s.title}</span>
                      <span className="mono mb-thread-at">{ago(s.generated_at, now)}</span>
                      <span className="mb-lib-sub">{s.status === 'published' ? 'Published' : 'Draft'} · <span className="mono">v{s.version}</span></span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {!rows.length && <p className="t-caption muted mb-threads-empty">{needle ? `Nothing matches “${q.trim()}”.` : 'Nothing of this kind yet.'}</p>}
    </nav>
  );
}

function Open({ id, version, asOf, toggle }: { id: string; version?: number; asOf?: number; toggle: ReactNode }) {
  const r = useStory(id, version, asOf);
  const [meta, setMeta] = useState<Partial<StoryMeta>>({});
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => setMeta({}), [r.data]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);
  const story = r.data?.story;
  const m = r.data && ({ ...r.data.meta, ...meta } as StoryMeta);
  const shown = story?.version;
  const prev = useData(() => (shown && shown > 1 ? api.story(id, shown - 1) : Promise.resolve(undefined)), [id, shown]);
  const copy = async (url: string) => { await navigator.clipboard?.writeText(url).catch(() => {}); };
  const publish = async (on: boolean) => {
    try {
      const next = await api.publish(id, on);
      setTimeout(() => { setMeta(next); dispatchEvent(new Event('mochi-stories-changed')); }, on ? 900 : 0); // let the held button land first
      if (on) { const url = shareUrl(id, next.kind); await copy(url); setToast(`Published. Link copied: ${url}`); }
      else setToast('Unpublished. Only you can see it now.');
    } catch (e) { setToast((e as Error).message); }
  };
  const versions = m?.versions ?? [];
  const latest = versions.at(-1);
  const live = m?.published?.at(-1);
  const behind = m?.status === 'published' && live !== undefined && latest !== undefined && live < latest;
  const items: Item[] = story && m ? [
    { label: 'Copy link', on: () => void copy(shareUrl(id, m.kind)).then(() => setToast('Link copied.')) },
    { label: 'Export as PDF', on: () => void window.open(printHref(id, m.kind, version, asOf), '_blank', 'noopener') },
    asOf === undefined ? { label: 'As of the day before', on: () => { location.hash = libHref(id, version, story.generated_at - 86_400_000); } }
      : { label: 'See it live', on: () => { location.hash = libHref(id, version); } },
    ...(m.owner && m.status === 'published' ? [{ label: 'Unpublish', on: () => void publish(false) }] : []),
  ] : [];
  const Icon = m?.kind === 'dashboard' ? LayoutDashboard : story?.generated_by === 'dream' ? Sunrise : FileText;
  return (
    <section className="mb-lib-main" aria-label="Open report">
      <header className="mb-col-head mb-lib-head">
        {toggle}
        {story && m ? (
          <div className="mb-panel-name">
            <Icon {...icon} />
            <h1 className="t-title mb-lib-title">{story.title}</h1>
            {versions.length > 1
              ? <select className="mb-ver-chip" aria-label="Version" value={String(shown)} onChange={(e) => { const v = Number(e.target.value); location.hash = libHref(id, v === latest ? undefined : v, asOf); }}>
                {versions.map((v) => <option key={v} value={v}>v{v}</option>)}
              </select>
              : <span className="mb-ver-chip">v{shown}</span>}
            <span className="mb-badge" data-state={m.status}>{m.status === 'published' ? 'Published' : 'Draft'}</span>
          </div>
        ) : !r.error && <div className="mb-panel-name mb-skel" aria-label="Loading the report"><i style={{ width: '40%' }} /></div>}
        {story && m && (
          <div className="mb-panel-tools">
            {m.owner && (m.status !== 'published' || behind) && (
              <Button key={`p${latest}`} variant="primary" size="sm" hold={700} success="Published" onClick={() => void publish(true)}>{behind ? `Publish v${latest}` : 'Publish'}</Button>
            )}
            <a className="mb-icon-btn" href={storyHref(id, m.kind, version, asOf)} target="_blank" rel="noreferrer" aria-label="Open as page"><ExternalLink {...icon} /></a>
            <Overflow items={items} />
          </div>
        )}
      </header>
      <div className="mb-lib-body">
        <div className={m?.kind === 'dashboard' ? 'mb-page' : 'mb-page mb-page-narrow'}>
          {r.error ? <NeedsYou mood="sorry" title="I can't open this report"
            reason={r.error === 'story not found' ? (version ? `Version ${version} isn't stored. Pick another version from the list.` : 'No report you can see is stored under this link.') : r.error} />
            : !story || !m ? <div className="mb-skel" aria-label="Loading the report">{[90, 70, 80, 60, 85].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
            : <>
              {asOf !== undefined ? <AsOfBanner asOf={asOf} liveHref={libHref(id, version)} />
                : <p className="t-caption muted mb-page-live">
                  <span>{m.kind === 'dashboard' ? 'Dashboard' : story.generated_by === 'dream' ? 'Morning report' : 'Story'} · written by {story.generated_by === 'dream' ? 'the dream' : story.generated_by.replace('user:', '')} · <span className="mono">{fmtTime(story.generated_at)}</span>{behind ? ` · public link shows v${live}` : ''}</span>
                  <LiveSince at={r.updatedAt} />
                </p>}
              <div className="mb-fade" key={`${asOf ?? 'live'}@${story.version}`}>
                <StoryView input={story} asOf={asOf} header={false} prev={prev.data?.story} dashboard={m.kind === 'dashboard'} />
              </div>
            </>}
        </div>
      </div>
      {toast && <div className="mb-toast" role="status">{toast}</div>}
    </section>
  );
}

export function Reports({ id, version, asOf }: { id?: string; version?: number; asOf?: number }) {
  const list = useStories();
  const [side, setSide] = useState(() => innerWidth >= 1180); // below 1180px the list is an overlay: start closed
  const all = list.data ?? [];
  const pick = id ?? (all.find(isDream) ?? all[0])?.id;
  // nothing picked: land on the newest morning report under its own shareable link
  useEffect(() => { if (!id && pick) location.replace(libHref(pick)); }, [id, pick]);
  const narrow = () => innerWidth < 1180;
  const toggle = <button type="button" className="mb-icon-btn mb-lib-toggle" aria-label="Show reports" aria-expanded={side} onClick={() => setSide(true)}><List {...icon} /></button>;
  return (
    <div className="mb-lib" data-side={side ? 'open' : 'closed'}>
      <Library list={all} current={pick} onPick={() => narrow() && setSide(false)} onClose={() => setSide(false)} />
      <button type="button" className="mb-scrim mb-lib-scrim" aria-label="Close" tabIndex={-1} onClick={() => setSide(false)} />
      {pick ? <Open key={pick} id={pick} version={version} asOf={asOf} toggle={toggle} />
        : (
          <section className="mb-lib-main" aria-label="Open report">
            <header className="mb-col-head mb-lib-head">{toggle}</header>
            <div className="mb-lib-body"><div className="mb-page mb-page-narrow">
              {list.error ? <NeedsYou mood="sorry" title="I can't load the reports" reason={list.error} action="Try again" onAction={list.reload} />
                : list.data ? <NeedsYou title="No reports yet" reason="The dream writes the first morning report. Run it from Overview, or ask for a story in Chat." />
                : <div className="mb-skel" aria-label="Loading the reports">{[90, 70, 80].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>}
            </div></div>
          </section>
        )}
    </div>
  );
}
