// The shareable report: #/r/:id[@n][?asOf=ms], from GET /api/stories/:id. Live (no @n, no asOf) it also follows the
// story's WebSocket and re-renders when a newer version lands. #/r/latest opens the newest morning report.
import { useEffect } from 'react';
import { StoryView, AsOfBanner } from '../components/story.tsx';
import { NeedsYou } from '../components/ds.tsx';
import { api, useData, useLive } from '../data/api.ts';

function Latest() {
  const s = useData(() => api.stories(), []);
  const top = s.data?.find((x) => x.generated_by === 'dream') ?? s.data?.[0];
  useEffect(() => { if (top) location.replace(`#/r/${top.id}`); }, [top?.id]);
  if (s.error) return <NeedsYou mood="sorry" title="I can't load the reports" reason={s.error} action="Try again" onAction={s.reload} />;
  if (s.data && !top) return <NeedsYou title="No reports yet" reason="The dream writes the first morning report. Run it from Overview." />;
  return <div className="mb-skel" aria-label="Loading the report">{[90, 70, 80].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>;
}

export function Report({ id, version, asOf }: { id: string; version?: number; asOf?: number }) {
  const live = version === undefined && asOf === undefined;
  const r = useData(() => api.story(id, version, asOf), [id, version, asOf]);
  const pushed = useLive(id === 'latest' ? undefined : id);
  if (id === 'latest') return <div className="mb-page mb-page-narrow"><Latest /></div>;
  const fetched = r.data?.story;
  const latest = Math.max(fetched?.version ?? 0, pushed?.version ?? 0) || undefined;
  const story = live && pushed && fetched && pushed.version > fetched.version ? pushed : fetched;
  return (
    <div className="mb-page mb-page-narrow">
      {asOf !== undefined ? <AsOfBanner asOf={asOf} liveHref={`#/r/${id}${version ? `@${version}` : ''}`} />
        : story && <p className="t-caption muted">{live ? 'Live. ' : ''}<a href={`#/r/${id}${version ? `@${version}` : ''}?asOf=${story.generated_at - 86400000}`}>Read it as of the day before</a></p>}
      {r.error ? <NeedsYou mood="sorry" title="I can't find this report"
        reason={r.error === 'story not found' ? (version ? `Version ${version} isn't stored${latest ? `. The latest is version ${latest}` : ''}.` : 'No report is stored under this link.') : r.error} />
        : !story ? <div className="mb-skel" aria-label="Loading the report">{[90, 70, 80].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
        : <div className="mb-fade" key={`${asOf ?? 'live'}@${story.version}`}><StoryView input={story} asOf={asOf}
          versionLabel={`@${story.version}${!latest || story.version === latest ? ' · latest' : ` · latest is @${latest}`}`} /></div>}
    </div>
  );
}
