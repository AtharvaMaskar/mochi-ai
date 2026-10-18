// The shareable page: #/story/:id or #/dashboard/:id [@n][?asOf=ms], from GET /api/stories/:id (a stranger gets the
// published version; a draft is 404 to anyone but its author). Live (no asOf) it follows the story's WebSocket and
// re-runs its queries on every push, and every 60s for a dashboard. #/r/:id redirects to the kind's route;
// #/r/latest opens the newest morning report.
import { useEffect } from 'react';
import { StoryView, AsOfBanner } from '../components/story.tsx';
import { NeedsYou } from '../components/ds.tsx';
import { LiveSince } from '../components/story-panel.tsx';
import { api, storyHref, useData, useStory, type Kind } from '../data/api.ts';

function Latest() {
  const s = useData(() => api.stories(), []);
  const top = s.data?.find((x) => x.generated_by === 'dream') ?? s.data?.[0];
  useEffect(() => { if (top) location.replace(storyHref(top.id, top.kind)); }, [top?.id]);
  if (s.error) return <NeedsYou mood="sorry" title="I can't load the reports" reason={s.error} action="Try again" onAction={s.reload} />;
  if (s.data && !top) return <NeedsYou title="No reports yet" reason="The dream writes the first morning report. Run it from Overview." />;
  return <div className="mb-skel" aria-label="Loading the report">{[90, 70, 80].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>;
}

export function Report({ id, version, asOf, kind: routeKind }: { id: string; version?: number; asOf?: number; kind?: Kind }) {
  const r = useStory(id === 'latest' ? undefined : id, version, asOf);
  const kind = r.data?.meta.kind;
  // #/r/:id and a wrong-kind link land on the kind's own route
  useEffect(() => { if (kind && kind !== routeKind) location.replace(storyHref(id, kind, version, asOf)); }, [kind, routeKind]);
  if (id === 'latest') return <div className="mb-page mb-page-narrow"><Latest /></div>;
  const story = r.data?.story;
  const latest = r.data?.meta.versions.at(-1);
  const dash = kind === 'dashboard';
  return (
    <div className={dash ? 'mb-page' : 'mb-page mb-page-narrow'}>
      {asOf !== undefined ? <AsOfBanner asOf={asOf} liveHref={storyHref(id, kind, version)} />
        : story && <p className="t-caption muted mb-page-live"><LiveSince at={r.updatedAt} /> <a href={storyHref(id, kind, version, story.generated_at - 86400000)}>Read it as of the day before</a></p>}
      {r.error ? <NeedsYou mood="sorry" title="I can't find this report"
        reason={r.error === 'story not found' ? (version ? `Version ${version} isn't stored${latest ? `. The latest is version ${latest}` : ''}.` : 'No report is stored under this link.') : r.error} />
        : !story ? <div className="mb-skel" aria-label="Loading the report">{[90, 70, 80].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
        : <div className="mb-fade" key={`${asOf ?? 'live'}@${story.version}`}><StoryView input={story} asOf={asOf} dashboard={dash}
          versionLabel={`@${story.version}${!latest || story.version === latest ? ' · latest' : ` · latest is @${latest}`}`} /></div>}
    </div>
  );
}
