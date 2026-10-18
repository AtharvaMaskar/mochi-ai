// The shareable report: #/r/:id[@n][?asOf=ms].
import { stories } from '../../fixtures/index.ts';
import { StoryView, AsOfBanner } from '../components/story.tsx';
import { NeedsYou } from '../components/ds.tsx';

export function Report({ id, version, asOf }: { id: string; version?: number; asOf?: number }) {
  const versions = stories.filter((s) => s.id === id).sort((a, b) => b.version - a.version);
  const story = version === undefined ? versions[0] : versions.find((s) => s.version === version);
  const latest = versions[0]?.version;
  return (
    <div className="mb-page mb-page-narrow">
      {asOf !== undefined ? <AsOfBanner asOf={asOf} liveHref={`#/r/${id}${version ? `@${version}` : ''}`} />
        : story && <p className="t-caption muted">Live. <a href={`#/r/${id}${version ? `@${version}` : ''}?asOf=${story.generated_at - 86400000}`}>Read it as of the day before</a></p>}
      {!story ? <NeedsYou mood="sorry" title="I can't find this report"
        reason={versions.length ? `Version ${version} isn't stored. The latest is version ${latest}.` : 'No report is stored under this link.'} />
        : <div className="mb-fade" key={asOf ?? "live"}><StoryView input={story} asOf={asOf}
          versionLabel={`@${story.version}${story.version === latest ? ' · latest' : ` · latest is @${latest}`}`} /></div>}
    </div>
  );
}
