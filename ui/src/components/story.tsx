// The story renderer over parseStory segments. A story that fails its checks shows its errors, never a partial render.
import { parseStory, type Segment } from '@mochi/contracts';
import { ReceiptProvider, fmtTime } from './receipts.tsx';
import { BlockView } from './blocks.tsx';
import { StoryMarkdown } from './markdown.tsx';
import { NeedsYou } from './ds.tsx';

function Segments({ segs, changed }: { segs: Segment[]; changed?: Set<number> }) {
  return <>{segs.map((s, i) => {
    // "What changed": a segment that differs from the previous version is wrapped and marked.
    if (changed?.has(i)) return <div key={i} className="mb-changed" title="Changed in this version"><Segments segs={[s]} /></div>;
    switch (s.type) {
      case 'markdown': return <StoryMarkdown key={i} text={s.text} />;
      case 'grid': return (
        <div key={i} className="mb-grid" style={{ ['--cols' as string]: s.widths.map((w) => `minmax(0,${w}fr)`).join(' ') }}>
          <Segments segs={s.children} />
        </div>
      );
      case 'note': return <div key={i} className="mb-note">I can't draw this tag yet, so I left it out: <span className="mono">{s.text}</span></div>;
      default: return <BlockView key={i} v={s} />;
    }
  })}</>;
}

/** Indexes of `segs` with no identical segment in `prev` (both top level). */
function changedFrom(segs: Segment[], prev: unknown): Set<number> | undefined {
  const p = prev ? parseStory(prev) : null;
  if (!p?.ok) return undefined;
  const before = new Set(p.segments.map((s) => JSON.stringify(s)));
  return new Set(segs.flatMap((s, i) => (before.has(JSON.stringify(s)) ? [] : [i])));
}

export function StoryView({ input, asOf, header = true, versionLabel, prev, dashboard }: {
  input: unknown; asOf?: number; header?: boolean; versionLabel?: string;
  /** the previous version: segments that differ from it are highlighted */ prev?: unknown;
  /** kind=dashboard: full-width tile layout */ dashboard?: boolean;
}) {
  const r = parseStory(input);
  if (!r.ok) {
    return <NeedsYou mood="sorry" title="This story didn't pass its checks, so I won't show it"
      reason={<ul>{r.errors.map((e) => <li key={e} className="mono">{e}</li>)}</ul>} />;
  }
  const { story, segments } = r;
  return (
    <ReceiptProvider queries={story.queries} asOf={asOf}>
      <article className={dashboard ? 'mb-story mb-story-dash' : 'mb-story'}>
        {header && (
          <header className="mb-story-head">
            <h1 className="mb-story-title">{story.title}</h1>
            <div className="mb-story-meta">
              <span className="mb-version">{versionLabel ?? `@${story.version}`}</span>
              <span>Written by {story.generated_by === 'dream' ? 'the dream' : story.generated_by.replace('user:', '')}</span>
              <span className="mono">{fmtTime(story.generated_at)}</span>
            </div>
          </header>
        )}
        <Segments segs={segments} changed={changedFrom(segments, prev)} />
      </article>
    </ReceiptProvider>
  );
}

export function AsOfBanner({ asOf, liveHref }: { asOf: number; liveHref?: string }) {
  return (
    <div className="mb-asof" role="status">
      <span>You are reading this as the graph stood at <span className="mono">{fmtTime(asOf)}</span>. Live facts may differ.</span>
      {liveHref && <a href={liveHref}>See it live</a>}
    </div>
  );
}
