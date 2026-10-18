// #/preview: every component in every state, the shell at three widths, and every micro-interaction to try.
import { useState, type ReactNode } from 'react';
import type { StoredQuery } from '@mochi/contracts';
import { briefingCard, brokenStory, chatStory, morningReport, sandboxPass, sandboxReject, sandboxQueriesFixture, tickets, dreamRun } from '../../fixtures/index.ts';
import { Mochi, MochiMood, MOOD_NAMES, Button, Segmented, Signal, Confidence, NeedsYou, Icon, RollingNumber, type IconName } from '../components/ds.tsx';
import { TicketRow, TicketThread, MochiBrief, BriefSection, Noticed, CustomerHeader, CustomerHistory, MochiGreeting, PipelineFlow, type FlowStep } from '../components/desk.tsx';
import { ReceiptProvider, NumPill, QueryTag, PathReceipt } from '../components/receipts.tsx';
import { Kpi, Bars, Line, Table, MemDiff, Suggestion, ToolCard } from '../components/blocks.tsx';
import { StoryView, AsOfBanner } from '../components/story.tsx';
import { SandboxFrame } from '../components/sandbox.tsx';
import { MochiIsland, ScreenNav, SCREENS } from '../components/shell.tsx';

const Sec = ({ title, children }: { title: string; children: ReactNode }) => <section className="mb-prev-sec"><h2>{title}</h2>{children}</section>;
const Row = ({ children }: { children: ReactNode }) => <div className="mb-prev-row">{children}</div>;
const ICONS: IconName[] = ['inbox', 'filter', 'person', 'check', 'cluster', 'retire', 'mismatch', 'report'];

function Frame({ w, h, scale }: { w: number; h: number; scale: number }) {
  return (
    <div className="mb-frame">
      <span className="t-caption muted"><span className="mono">{w}px</span></span>
      <div className="mb-frame-clip" style={{ width: w * scale, height: h * scale }}>
        <iframe title={`Tickets at ${w}px`} src="#/" width={w} height={h} style={{ transform: `scale(${scale})` }} />
      </div>
    </div>
  );
}

function MicroInteractions() {
  const [seg, setSeg] = useState('a');
  const [n, setN] = useState(1284);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState(tickets.slice(0, 3));
  const [leaving, setLeaving] = useState<string | null>(null);
  const [sel, setSel] = useState(tickets[0].id);
  const [live, setLive] = useState<Record<string, StoredQuery>>(morningReport.queries);
  const [asOf, setAsOf] = useState<number | undefined>(undefined);
  const [run, setRun] = useState(0);
  const [briefKey, setBriefKey] = useState(0);
  const [briefLoading, setBriefLoading] = useState(false);
  const bump = () => setLive({ ...live, q_1: { ...live.q_1, rows: [{ median_h: Math.round((5 + Math.random() * 5) * 10) / 10 }] },
    q_2: { ...live.q_2, rows: live.q_2.rows.map((r) => ({ ...r, tickets: Number(r.tickets) + Math.ceil(Math.random() * 6) })) } });
  const steps: FlowStep[] = ['Ingest', 'Cluster', 'Retire', 'Mismatch', 'Report'].map((label, i) => ({
    label, icon: (['inbox', 'cluster', 'retire', 'mismatch', 'report'] as const)[i],
    count: <NumPill query_id="q_1" column={['ingested', 'clustered', 'retired', 'mismatches', 'reports'][i]} size="lg" />,
  }));
  return (
    <Sec title="Micro-interactions">
      <p className="t-caption muted">Every tap answers within 100 ms. With reduced motion on, movement stops; colour, the check and the words stay.</p>
      <Row>
        <Button variant="primary">Press me: sink and spring</Button>
        <Button>Fingertip light</Button>
        <Button variant="primary" success="Confirmed">Confirm</Button>
        <Button variant="secondary" hold={700} success="Escalated">Hold to escalate</Button>
        <Button loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1600); }}>{loading ? 'Saving' : 'Save (loading)'}</Button>
        <Button variant="primary" disabledReason="Pick a ticket first.">Send</Button>
      </Row>
      <Row>
        <div style={{ width: 320 }}><Segmented value={seg} onChange={setSeg} options={[{ id: 'a', label: 'Glide' }, { id: 'b', label: 'To' }, { id: 'c', label: 'Here' }]} /></div>
        <Mochi size="md" label="Tap Mochi to squish it" />
        <span className="t-data-strong"><RollingNumber value={n} /></span>
        <Button size="sm" onClick={() => setN(n + Math.ceil(Math.random() * 90))}>Roll the number</Button>
      </Row>
      <div className="mb-prev-box" style={{ maxWidth: 340 }}>
        {rows.map((t) => <TicketRow key={t.id} name={t.name} time={t.time} subject={t.subject} type={t.type} p={t.p} status={t.status}
          selected={t.id === sel} onClick={() => setSel(t.id)} leaving={leaving === t.id} onLeft={() => { setRows(rows.filter((r) => r.id !== t.id)); setLeaving(null); }} />)}
      </div>
      <Row>
        <Button size="sm" onClick={() => setLeaving(sel)} disabledReason={rows.some((r) => r.id === sel) ? undefined : 'Select a row first.'}>Handle the selected row</Button>
        <Button size="sm" variant="link" onClick={() => setRows(tickets.slice(0, 3))}>Reset rows</Button>
      </Row>
      <ReceiptProvider queries={live} asOf={asOf}>
        <Row>
          <span className="t-body">Open a receipt: <NumPill query_id="q_1" column="median_h" /> hours.</span>
          <Button size="sm" onClick={bump}>Simulate a live update</Button>
          <Button size="sm" onClick={() => setAsOf(asOf ? undefined : morningReport.generated_at - 86400000)}>{asOf ? 'Back to live' : 'Read as of the day before'}</Button>
        </Row>
        {asOf && <AsOfBanner asOf={asOf} />}
        <div className="mb-fade mb-grid" key={asOf ?? 'live'} style={{ ['--cols' as string]: 'minmax(0,1fr) minmax(0,2fr)' }}>
          <Kpi type="kpi" query_id="q_1" label="Median resolution" column="median_h" unit="h" promised={4} bad />
          <Bars type="bars" query_id="q_2" label="Clusters this week" x="cluster" y="tickets" trend="trend" hot="hot" />
        </div>
      </ReceiptProvider>
      <Row><Button size="sm" onClick={() => setBriefKey(briefKey + 1)}>Redraw the path</Button></Row>
      <ToolCard key={briefKey} card={briefingCard} />
      <Row><Button size="sm" onClick={() => { setBriefLoading(true); setTimeout(() => setBriefLoading(false), 900); }}>Fill the brief</Button></Row>
      <div className="mb-prev-box" style={{ maxWidth: 380 }}>
        <MochiBrief loading={briefLoading} mood={briefLoading ? 'thinking' : 'idle'} status={briefLoading ? 'I’m pulling what I know…' : 'Done.'}>
          <BriefSection label="What I noticed"><Noticed>Priya wrote about this on 2 Oct too.</Noticed></BriefSection>
          <BriefSection label="Customer" delay={0.08}><CustomerHeader name="Priya Raman" clientId="EC-204817" status={['Active']} /></BriefSection>
          <BriefSection label="Earlier tickets" delay={0.16}><CustomerHistory tickets={tickets[0].history} /></BriefSection>
        </MochiBrief>
      </div>
      <Row><Button size="sm" onClick={() => setRun(run + 1)}>Run the dream</Button></Row>
      <ReceiptProvider queries={dreamRun}>
        <PipelineFlow run={run} steps={steps} summary={{ text: run ? 'Replaying last night' : 'Finished' }} rail={{ at: 5, line: 'I wrote the morning report.' }} />
      </ReceiptProvider>
    </Sec>
  );
}

export function Preview() {
  const [seg, setSeg] = useState('ready');
  const w = typeof innerWidth === 'number' ? innerWidth : 1280;
  return (
    <div className="mb-page mb-prev">
      <h1 className="mb-story-title">Components</h1>
      <MicroInteractions />

      <Sec title="Shell at 1280, 1000 and 390">
        <div className="mb-frames">
          <Frame w={1280} h={800} scale={Math.min(0.5, (w - 64) / 1280)} />
          <Frame w={1000} h={800} scale={Math.min(0.4, (w - 64) / 1000)} />
          <Frame w={390} h={800} scale={Math.min(0.5, (w - 64) / 390)} />
        </div>
        <Row><ScreenNav items={SCREENS} current="tickets" /></Row>
        <Row><MochiIsland line="I dreamed at 02:00. The morning report is ready." /><MochiIsland working line="I’m reading new tickets" /></Row>
      </Sec>

      <Sec title="Mochi">
        <div className="mb-moods">
          {MOOD_NAMES.map((m) => <div key={m} className="mb-mood-cell"><Mochi mood={m} size="md" /><MochiMood mood={m} /></div>)}
        </div>
        <Row>
          <div className="mb-mood-cell"><Mochi size="lg" mood="thinking" /><MochiMood mood="thinking" /></div>
          <div className="mb-mood-cell"><Mochi size="lg" mood="listening" /><MochiMood mood="listening" /></div>
        </Row>
        <Row>
          <span className="t-caption muted">Sizes</span><Mochi size="xs" /><Mochi size="sm" /><Mochi size="md" />
          <span className="t-caption muted">Still</span><Mochi size="md" still label="Mochi, still" />
          <span className="t-caption muted">tone="mood"</span><Mochi size="md" tone="mood" />
          <span className="t-caption muted">No squish</span><Mochi size="md" squishable={false} />
        </Row>
      </Sec>

      <Sec title="Button">
        <Row>
          <Button variant="primary">Primary</Button><Button>Secondary</Button><Button variant="link">Link</Button>
          <Button size="sm">Small</Button><Button disabled>Disabled</Button>
          <Button variant="primary" disabledReason="Mochi hasn't read this ticket yet.">Disabled with a reason</Button>
        </Row>
      </Sec>

      <Sec title="Segmented, Signal, Confidence, Icon">
        <div style={{ maxWidth: 340 }}><Segmented label="Tickets" value={seg} onChange={setSeg} options={[{ id: 'ready', label: 'Ready', count: 3 }, { id: 'done', label: 'Done today', count: 1 }, { id: 'all', label: 'All received', count: 5 }]} /></div>
        <Row><Signal level="alarm" /><Signal level="warning" /><Signal level="clear" /></Row>
        <Row><Confidence p={0.9} /><Confidence p={0.6} /><Confidence p={0.2} /><Confidence p={0.9} hidePct /></Row>
        <Row>{ICONS.map((i) => <span key={i} className="mb-prev-row" style={{ gap: 'var(--space-1)' }}><Icon name={i} /><span className="t-caption muted">{i}</span></span>)}</Row>
      </Sec>

      <Sec title="NeedsYou">
        <NeedsYou reason="I found no similar resolved tickets in memory." action="Search anyway" />
        <NeedsYou mood="sorry" title="I couldn't finish" reason="The graph didn't answer in time." />
      </Sec>

      <Sec title="TicketRow">
        <div className="mb-prev-box" style={{ maxWidth: 340 }}>
          <TicketRow name="Priya Raman" time="09:42" subject="OTP never arrives since the app update" type="Login and 2FA" p={0.86} selected unread />
          <TicketRow name="Kabir Shah" time="09:30" subject="Payin from yesterday still not in my ledger" type="Funds and payin" p={0.58} unread={false} />
          <TicketRow name="Meera Iyer" time="08:58" subject="Contract note for Friday is missing" reading />
          <TicketRow name="Rohan Das" time="Yesterday" subject="Margin alert says I am short" p={0.31} status="left" type="Margin and risk" />
          <TicketRow name="Leela Nair" time="Yesterday" subject="How do I download my tax P&L?" p={0.92} status="done" type="Reports" />
        </div>
      </Sec>

      <Sec title="TicketThread">
        <div style={{ maxWidth: 640 }}><TicketThread messages={tickets[0].thread} waitingFor="3h" /></div>
        <div style={{ maxWidth: 640 }}><TicketThread collapseAfter={3} messages={[...tickets[1].thread, ...tickets[0].thread, ...tickets[4].thread]} /></div>
      </Sec>

      <Sec title="MochiBrief, Noticed, CustomerHeader, CustomerHistory">
        <div className="mb-prev-box" style={{ maxWidth: 380 }}>
          <MochiBrief status="Read when it arrived.">
            <BriefSection label="What I noticed"><Noticed action="Link #T-0988" success="Linked">Priya wrote about this on 2 Oct too. That ticket closed after a <b>template reply</b>.</Noticed></BriefSection>
            <BriefSection label="Nothing noticed"><Noticed /></BriefSection>
            <BriefSection label="Customer" did={['Looked up the client in the back office']}>
              <CustomerHeader name="Priya Raman" clientId="EC-204817" status={['Active', 'F&O enabled']} source="Back office" age="2 min ago" />
              <CustomerHeader name="Unknown Sender" state="not_found" />
              <CustomerHeader name="Kabir Shah" state="unreachable" />
            </BriefSection>
            <BriefSection label="Earlier tickets"><CustomerHistory tickets={tickets[0].history} continues="T-0988" /><CustomerHistory tickets={[]} /></BriefSection>
          </MochiBrief>
        </div>
      </Sec>

      <Sec title="MochiGreeting and PipelineFlow">
        <ReceiptProvider queries={dreamRun}>
          <MochiGreeting name="Arjun" still action="Open the tickets"
            headline={<>The dream found <NumPill query_id="q_1" column="mismatches" /> places where the docs and the desk disagree.</>}
            receipt={<>Overnight I read <NumPill query_id="q_1" column="ingested" /> tickets.</>} />
        </ReceiptProvider>
      </Sec>

      <Sec title="Receipts: NumPill, QueryTag, PathReceipt">
        <ReceiptProvider queries={briefingCard.queries}>
          <Row>
            <span>Similar this week: <NumPill query_id="q_3" column="similar" /></span>
            <span>Drifted figure: <NumPill query_id="q_3" column="similar" value="99" /></span>
            <QueryTag qid="q_2" />
          </Row>
          <PathReceipt path={briefingCard.path!} />
        </ReceiptProvider>
      </Sec>

      <Sec title="Blocks">
        <ReceiptProvider queries={morningReport.queries}>
          <div className="mb-grid" style={{ ['--cols' as string]: 'minmax(0,1fr) minmax(0,1fr)' }}>
            <Kpi type="kpi" query_id="q_1" label="Median resolution" column="median_h" unit="h" promised={4} bad />
            <Kpi type="kpi" query_id="q_6" label="Promised payin time" column="promised_h" unit="h" />
          </div>
          <Bars type="bars" query_id="q_2" label="Clusters this week" x="cluster" y="tickets" trend="trend" hot="hot" />
          <Line type="line" query_id="q_3" label="Tickets per day" x="day" series={['opened', 'resolved']} />
          <Table type="table" query_id="q_4" label="Repeat contacts this week" columns={['customer', 'contacts', 'issue']} />
          <MemDiff type="memdiff" query_id="q_5" />
          <Suggestion type="suggestion" query_id="q_6" tag="The docs and the desk disagree" edge="CONTRADICTS" actions={['send_to_team:payments', 'draft_kb:KB-12', 'dismiss']}
            text='KB-12 promises <num query_id="q_6" column="promised_h">4</num> hours.' nums={[{ query_id: 'q_6', column: 'promised_h', value: '4' }]} />
        </ReceiptProvider>
      </Sec>

      <Sec title="ToolCard"><ToolCard card={briefingCard} /></Sec>

      <Sec title="Story: grid, table, inline pills, unknown tag">
        <StoryView input={chatStory} />
        <StoryView input={morningReport} />
      </Sec>
      <Sec title="Story that fails its checks"><StoryView input={brokenStory} /></Sec>
      <Sec title="AsOfBanner"><AsOfBanner asOf={1760000000000} liveHref="#/preview" /></Sec>
      <Sec title="SandboxFrame: passing and rejected">
        <SandboxFrame value={sandboxPass} queries={sandboxQueriesFixture} height={220} />
        <SandboxFrame value={sandboxReject} queries={{}} />
      </Sec>
    </div>
  );
}
