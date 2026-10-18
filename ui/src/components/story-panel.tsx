// The artifact panel beside the chat (Claude-style): the open story or dashboard with full receipts, its versions with
// "what changed", Draft/Published, hold-to-publish (copies the public link), Unpublish, open as page, as-of.
// Edits by chat arrive over the live socket and the panel moves to the new version.
import { useEffect, useState } from 'react';
import { StoryView, AsOfBanner } from './story.tsx';
import { Button, NeedsYou, Segmented } from './ds.tsx';
import { api, shareUrl, storyHref, useData, useStory, type StoryMeta } from '../data/api.ts';

/** "Live · updated 12s ago", ticking; "Frozen" under as-of. */
export function LiveSince({ at, frozen }: { at: number; frozen?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (frozen) return <span className="mb-live-since">Frozen in time</span>;
  const s = Math.max(0, Math.round((now - at) / 1000));
  return <span className="mb-live-since" data-live><i aria-hidden="true" />Live · updated {s < 60 ? `${s}s` : `${Math.round(s / 60)} min`} ago</span>;
}

export function StoryPanel({ id, onClose }: { id: string; onClose: () => void }) {
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

  const publish = async (on: boolean) => {
    try {
      const next = await api.publish(id, on);
      setTimeout(() => setMeta(next), 900); // let the held button land first
      if (on) {
        const url = shareUrl(id, next.kind);
        await navigator.clipboard?.writeText(url).catch(() => {});
        setToast(`Published. Link copied: ${url}`);
      } else setToast('Unpublished. Only you can see it now.');
    } catch (e) { setToast((e as Error).message); }
  };

  const versions = m?.versions ?? [];
  const latest = versions.at(-1);
  const live = m?.published?.at(-1);
  return (
    <aside className="mb-panel" aria-label="Open story">
      <header className="mb-panel-head">
        <div className="mb-panel-title">
          <h2 className="t-title">{story?.title ?? 'Loading…'}</h2>
          <Button variant="link" size="sm" onClick={onClose}>Close</Button>
        </div>
        {m && story && (
          <div className="mb-panel-meta">
            <span className="mb-badge" data-state={m.status}>{m.status === 'published' ? 'Published' : 'Draft'}</span>
            <span className="t-caption muted">{m.kind === 'dashboard' ? 'Dashboard' : 'Story'}{m.status === 'published' && live && latest && live < latest ? ` · public link shows v${live}` : ''}</span>
            <LiveSince at={r.updatedAt} frozen={asOf !== undefined} />
          </div>
        )}
        {m && story && (
          <div className="mb-panel-actions">
            {versions.length > 1 && (
              <Segmented label="Version" value={String(shown)} onChange={(v) => setPick(Number(v) === latest ? undefined : Number(v))}
                options={versions.slice(-6).map((v) => ({ id: String(v), label: `v${v}` }))} />
            )}
            {m.owner && (m.status !== 'published' || (live !== undefined && latest !== undefined && live < latest)
              ? <Button key="publish" variant="primary" size="sm" hold={700} success="Published" onClick={() => void publish(true)}>{m.status === 'published' ? `Publish v${latest}` : 'Publish'}</Button>
              : m.owner && <Button key="unpublish" size="sm" hold={700} success="Unpublished" onClick={() => void publish(false)}>Unpublish</Button>)}
            <a className="mb-btn mb-btn-secondary mb-btn-sm" href={storyHref(id, m.kind)} target="_blank" rel="noreferrer"><span className="mb-btn-label">Open as page</span></a>
            {asOf === undefined
              ? <Button variant="link" size="sm" onClick={() => setAsOf(story.generated_at - 86_400_000)}>As of the day before</Button>
              : null}
          </div>
        )}
      </header>
      <div className="mb-panel-body">
        {asOf !== undefined && <div className="mb-panel-asof"><AsOfBanner asOf={asOf} /><Button variant="link" size="sm" onClick={() => setAsOf(undefined)}>See it live</Button></div>}
        {r.error ? <NeedsYou mood="sorry" title="I can't open this story" reason={r.error} />
          : !story ? <div className="mb-skel" aria-label="Loading the story">{[90, 70, 80].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
          : <div className="mb-fade" key={story.version}>
            <StoryView input={story} asOf={asOf} header={false} prev={prev.data?.story} dashboard={m?.kind === 'dashboard'} />
          </div>}
      </div>
      {toast && <div className="mb-toast" role="status">{toast}</div>}
    </aside>
  );
}
