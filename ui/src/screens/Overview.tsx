// Overview: the greeting, the morning report's summary, and the dream's steps. Every count is a NumPill on the
// stored query the agent ran; the dream's progress streams from POST /api/dream/run.
import { useEffect } from 'react';
import { parseStory, type Visual } from '@mochi/contracts';
import { ReceiptProvider, NumPill, fmtTime } from '../components/receipts.tsx';
import { BlockView } from '../components/blocks.tsx';
import { StoryMarkdown } from '../components/markdown.tsx';
import { MochiGreeting, PipelineFlow, type FlowStep } from '../components/desk.tsx';
import { NeedsYou, Button } from '../components/ds.tsx';
import { api, runDream, useData, useDream, DREAM_STEPS, ADMIN_TOKEN } from '../data/api.ts';

function MorningSummary({ id }: { id: string }) {
  const s = useData(() => api.story(id), [id]);
  if (s.error) return <NeedsYou mood="sorry" reason={s.error} action="Try again" onAction={s.reload} />;
  if (!s.data) return <div className="mb-skel" aria-label="Loading the morning report">{[90, 70].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>;
  const story = s.data.story, parsed = parseStory(story);
  return <>
    <h2 className="mb-story-title">{story.title}</h2>
    {parsed.ok ? (
      <ReceiptProvider queries={story.queries}>
        {parsed.segments.filter((x) => x.type === 'markdown').slice(0, 1).map((x, i) => <StoryMarkdown key={i} text={(x as { text: string }).text} />)}
        <div className="mb-grid" style={{ ['--cols' as string]: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {parsed.segments.flatMap((x) => (x.type === 'grid' ? x.children : [x])).filter((x) => x.type === 'kpi' || x.type === 'suggestion').map((x, i) => <BlockView key={i} v={x as Visual} />)}
        </div>
      </ReceiptProvider>
    ) : <NeedsYou mood="sorry" reason={parsed.errors.join('; ')} />}
    <a href={`#/r/${story.id}`}>Read the full report</a>
  </>;
}

export function Overview() {
  const o = useData(() => api.overview(), []);
  const dream = useDream();
  useEffect(() => { if (!dream.running && dream.runs) o.reload(); }, [dream.running]);
  if (o.error && !o.data) return <div className="mb-page"><NeedsYou mood="sorry" title="I can’t load the overview" reason={o.error} action="Try again" onAction={o.reload} /></div>;
  if (!o.data) return <div className="mb-page"><div className="mb-skel" aria-label="Loading the overview">{[80, 60, 70].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div></div>;
  const { desk, queries, morning_report: mr, dream: ds } = o.data;
  const d = (column: string) => <NumPill query_id="q_1" column={column} size="lg" />;
  const steps: FlowStep[] = [
    { label: 'Ingest', icon: 'inbox', count: d('ingested'), caption: 'Tickets read into memory, last 24 h' },
    { label: 'Cluster', icon: 'cluster', count: d('clustered'), caption: 'Clusters live now' },
    { label: 'Retire', icon: 'retire', count: d('retired'), caption: 'Facts retired, last 24 h' },
    { label: 'Mismatch', icon: 'mismatch', count: d('mismatches'), caption: 'Docs that disagree with the desk', tone: 'warn' },
    { label: 'Report', icon: 'report', count: mr ? <a href={`#/r/${mr.id}`}>@{mr.version}</a> : '—', caption: 'Morning report written' },
  ];
  const ready = 'ready' in desk ? desk.ready : null;
  const at = dream.running ? dream.at : DREAM_STEPS.length;
  const summary = dream.failed ? { text: `The dream stopped: ${dream.failed}`, tone: 'warn' as const }
    : dream.running ? { text: 'Dreaming now' }
    : { text: ds.last_run ? `Last finished at ${fmtTime(ds.last_run)}` : 'The dream has not run yet' };
  return (
    <div className="mb-page">
      <ReceiptProvider queries={queries}>
        <div className="mb-tiles">
          <MochiGreeting still mood={dream.running ? 'thinking' : 'done'} action="Open the tickets" onAction={() => { location.hash = '#/'; }}
            headline={<>The dream found <NumPill query_id="q_1" column="mismatches" /> places where the docs and the desk disagree.</>}
            receipt={<>In the last day I read <NumPill query_id="q_1" column="ingested" /> tickets and retired <NumPill query_id="q_1" column="retired" /> facts. <NumPill query_id="q_1" column="pending" /> new tickets wait for the next dream.</>} />
          <div className="mb-tile">
            <span className="mb-tile-label">Waiting for your team</span>
            {ready === null ? <NeedsYou mood="sorry" reason={(desk as { error: string }).error} />
              : <span className="t-headline">{ready === 0 ? 'Nothing waiting' : `${ready === 1 ? 'One ticket' : `${ready} tickets`} ready, each with my brief`}</span>}
            <a href="#/">Open them</a>
          </div>
        </div>
        <PipelineFlow key={dream.runs} steps={steps} summary={summary}
          rail={{ at, mood: dream.failed ? 'sorry' : 'done', line: dream.failed ? 'I stopped. The reason is above.' : 'I wrote the morning report. It’s below.' }} />
        <div className="mb-prev-row">
          {ADMIN_TOKEN && <Button variant="primary" size="sm" loading={dream.running} onClick={() => void runDream()}>Run dream now</Button>}
          {ds.next_run && <span className="t-caption muted">Next scheduled run {fmtTime(ds.next_run)}</span>}
        </div>
      </ReceiptProvider>

      <section className="mb-tile" aria-label="Morning report">
        <span className="mb-tile-label">Morning report</span>
        {mr ? <MorningSummary key={`${mr.id}@${mr.version}`} id={mr.id} /> : <NeedsYou reason="No morning report yet. Run the dream to write one." />}
      </section>
    </div>
  );
}
