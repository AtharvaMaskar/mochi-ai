// The shareable page: #/story/:id or #/dashboard/:id [@n][?asOf=ms], from GET /api/stories/:id (a stranger gets the
// published version; a draft is 404 to anyone but its author). Live (no asOf) it follows the story's WebSocket and
// re-runs its queries on every push, and every 60s for a dashboard. #/r/:id redirects to the kind's route;
// #/r/latest opens the newest morning report. With ?print=1 it is the PDF export: the as-of fixed at load, every row
// shown, a receipts appendix with each stored query's full Cypher, then the browser's print dialog once.
import { useEffect, useMemo, useRef } from 'react';
import { FileDown } from 'lucide-react';
import type { Story } from '@mochi/contracts';
import { StoryView, AsOfBanner } from '../components/story.tsx';
import { NeedsYou } from '../components/ds.tsx';
import { LiveSince } from '../components/story-panel.tsx';
import { fmtTime } from '../components/receipts.tsx';
import { api, isPrint, printHref, storyHref, useData, useStory, type Kind, type StoryMeta } from '../data/api.ts';

function Latest() {
  const s = useData(() => api.stories(), []);
  const top = s.data?.find((x) => x.generated_by === 'dream') ?? s.data?.[0];
  useEffect(() => { if (top) location.replace(storyHref(top.id, top.kind)); }, [top?.id]);
  if (s.error) return <NeedsYou mood="sorry" title="I can't load the reports" reason={s.error} action="Try again" onAction={s.reload} />;
  if (s.data && !top) return <NeedsYou title="No reports yet" reason="The dream writes the first morning report. Run it from Overview." />;
  return <div className="mb-skel" aria-label="Loading the report">{[90, 70, 80].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>;
}

/** Print only: every stored query in full, so each [q_n] in the PDF can be checked on paper. */
function ReceiptsAppendix({ story, asOf }: { story: Story; asOf: number }) {
  const qs = Object.entries(story.queries).sort(([a], [b]) => Number(a.slice(2)) - Number(b.slice(2)));
  return (
    <section className="mb-print-receipts" aria-label="Receipts">
      <h2 className="mb-story-title">Receipts</h2>
      <p className="t-caption muted">Every figure above carries a query id. Each ran read-only against the graph named, as it stood at the as-of time.</p>
      {qs.map(([qid, q]) => (
        <div className="mb-print-receipt" key={qid}>
          <div className="t-caption"><b className="mono">{qid}</b> · graph{" "}<span className="mono">{q.graph}</span> · as of{" "}<span className="mono">{fmtTime(asOf)}</span> · <span className="mono">{q.rows.length}</span> {q.rows.length === 1 ? "row" : "rows"}</div>
          {Object.keys(q.params).length > 0 && <div className="t-caption mono muted">params {JSON.stringify(q.params)}</div>}
          <pre className="mono">{q.cypher}</pre>
        </div>
      ))}
    </section>
  );
}

function PrintHead({ story, meta, asOf }: { story: Story; meta: StoryMeta; asOf: number }) {
  return (
    <p className="mb-print-head t-caption">
      <span>{story.title}</span><span>{meta.kind === 'dashboard' ? 'Dashboard' : 'Story'}</span><span className="mono">@{story.version}</span>
      <span>{meta.status === 'published' ? 'Published' : 'Draft'}</span><span>As of{" "}<span className="mono">{fmtTime(asOf)}</span></span><span>E Corp Securities · Mochi</span>
    </p>
  );
}

export function Report({ id, version, asOf, kind: routeKind }: { id: string; version?: number; asOf?: number; kind?: Kind }) {
  const print = isPrint();
  const printAt = useMemo(() => Date.now(), [print]);
  const r = useStory(id === 'latest' ? undefined : id, version, asOf ?? (print ? printAt : undefined));
  const kind = r.data?.meta.kind;
  // #/r/:id and a wrong-kind link land on the kind's own route
  useEffect(() => { if (kind && kind !== routeKind) location.replace(storyHref(id, kind, version, asOf)); }, [kind, routeKind]);
  const story = r.data?.story;
  const printed = useRef(false);
  useEffect(() => {
    if (!print || !story || printed.current) return;
    let live = true;
    document.fonts.ready.then(() => requestAnimationFrame(() => {
      if (!live || printed.current) return;
      printed.current = true;
      document.documentElement.dataset.printReady = '1'; // headless export waits on this
      window.print();
    }));
    return () => { live = false; };
  }, [print, story]);
  if (id === 'latest') return <div className="mb-page mb-page-narrow"><Latest /></div>;
  const latest = r.data?.meta.versions.at(-1);
  const dash = kind === 'dashboard';
  return (
    <div className={dash ? 'mb-page' : 'mb-page mb-page-narrow'}>
      {print && story && r.data && <><a className="mb-print-back t-caption" href={storyHref(id, kind, version, asOf)}>Back to the report</a>
        <PrintHead story={story} meta={r.data.meta} asOf={r.data.as_of} /></>}
      {print ? null : asOf !== undefined ? <AsOfBanner asOf={asOf} liveHref={storyHref(id, kind, version)} />
        : story && <p className="t-caption muted mb-page-live"><LiveSince at={r.updatedAt} /> <a href={storyHref(id, kind, version, story.generated_at - 86400000)}>Read it as of the day before</a></p>}
      {r.error ? <NeedsYou mood="sorry" title="I can't find this report"
        reason={r.error === 'story not found' ? (version ? `Version ${version} isn't stored${latest ? `. The latest is version ${latest}` : ''}.` : 'No report is stored under this link.') : r.error} />
        : !story ? <div className="mb-skel" aria-label="Loading the report">{[90, 70, 80].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
        : <div className="mb-fade" key={`${asOf ?? 'live'}@${story.version}`}><StoryView input={story} asOf={asOf} dashboard={dash}
          versionLabel={`@${story.version}${!latest || story.version === latest ? ' · latest' : ` · latest is @${latest}`}`}
          actions={!print && <a className="mb-icon-btn" href={printHref(id, kind, version, asOf)} aria-label="Export as PDF" title="Export as PDF"><FileDown size={16} strokeWidth={1.5} aria-hidden="true" /></a>} />
          {print && r.data && <ReceiptsAppendix story={story} asOf={r.data.as_of} />}</div>}
    </div>
  );
}
