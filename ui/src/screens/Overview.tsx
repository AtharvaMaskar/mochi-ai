// Overview: the greeting, the morning report's summary, and the dream's steps. Every count is a NumPill.
import { morningReport, dreamRun, tickets } from '../../fixtures/index.ts';
import { parseStory, type Visual } from '@mochi/contracts';
import { ReceiptProvider, NumPill, fmtTime } from '../components/receipts.tsx';
import { BlockView } from '../components/blocks.tsx';
import { StoryMarkdown } from '../components/markdown.tsx';
import { MochiGreeting, PipelineFlow, type FlowStep } from '../components/desk.tsx';
import { NeedsYou } from '../components/ds.tsx';

const reportHref = `#/r/${morningReport.id}`;

export function Overview() {
  const parsed = parseStory(morningReport);
  const d = (column: string) => <NumPill query_id="q_1" column={column} size="lg" />;
  const steps: FlowStep[] = [
    { label: 'Ingest', icon: 'inbox', count: d('ingested'), caption: 'Tickets read into memory' },
    { label: 'Cluster', icon: 'cluster', count: d('clustered'), caption: 'Clusters live this morning' },
    { label: 'Retire', icon: 'retire', count: d('retired'), caption: 'Facts proven wrong' },
    { label: 'Mismatch', icon: 'mismatch', count: d('mismatches'), caption: 'Docs that disagree with the desk', tone: 'warn' },
    { label: 'Report', icon: 'report', count: d('reports'), caption: 'Morning report written' },
  ];
  const ready = tickets.filter((t) => t.status === 'todo').length;
  return (
    <div className="mb-page">
      <ReceiptProvider queries={dreamRun}>
        <div className="mb-tiles">
          <MochiGreeting still mood="done" action="Open the tickets" onAction={() => { location.hash = '#/'; }}
            headline={<>The dream found <NumPill query_id="q_1" column="mismatches" /> places where the docs and the desk disagree.</>}
            receipt={<>Overnight I read <NumPill query_id="q_1" column="ingested" /> tickets and retired <NumPill query_id="q_1" column="retired" /> facts.</>} />
          <div className="mb-tile">
            <span className="mb-tile-label">Waiting for your team</span>
            <span className="t-headline">{ready === 0 ? 'Nothing waiting' : `${ready === 1 ? 'One ticket' : 'Tickets'} ready, each with my brief`}</span>
            <a href="#/">Open them</a>
          </div>
        </div>
        <PipelineFlow steps={steps} summary={{ text: `Finished at ${fmtTime(dreamRun.q_1.ran_at)}` }}
          rail={{ at: 5, mood: 'done', line: 'I wrote the morning report. It’s below.' }} />
      </ReceiptProvider>

      <section className="mb-tile" aria-label="Morning report">
        <span className="mb-tile-label">Morning report</span>
        <h2 className="mb-story-title">{morningReport.title}</h2>
        {parsed.ok ? (
          <ReceiptProvider queries={morningReport.queries}>
            {parsed.segments.filter((s) => s.type === 'markdown').slice(0, 1).map((s, i) => <StoryMarkdown key={i} text={(s as { text: string }).text} />)}
            <div className="mb-grid" style={{ ['--cols' as string]: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              {parsed.segments.flatMap((s) => (s.type === 'grid' ? s.children : [s])).filter((s) => s.type === 'kpi' || s.type === 'suggestion').map((s, i) => <BlockView key={i} v={s as Visual} />)}
            </div>
          </ReceiptProvider>
        ) : <NeedsYou mood="sorry" reason={parsed.errors.join('; ')} />}
        <a href={reportHref}>Read the full report</a>
      </section>
    </div>
  );
}
