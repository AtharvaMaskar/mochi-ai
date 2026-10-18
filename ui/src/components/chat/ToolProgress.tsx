// One step line per tool Mochi runs, saying what it was for: the call's own `purpose` when it has one, else a plain
// phrase for the tool. A live step carries an agent-tint shimmer; a finished one the drawn check. Three or more
// finished steps fold into one line ("Used 3 graph queries") that opens to the list.
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DrawnCheck } from '../ds.tsx';

export type ToolStep = { id: string; name: string; done: boolean; args?: string };

const PHRASE: Record<string, string> = {
  briefing: 'Read the ticket brief', likely_cause: 'Looked for the likely cause', who_knows: 'Found who knows this issue',
  emerging_clusters: 'Checked emerging clusters', blast_radius: 'Measured the blast radius', search_similar: 'Searched similar tickets',
  customer_profile: 'Read the customer profile', trace_story: 'Traced how the story was made', build_story: 'Wrote the story',
  edit_story: 'Edited the story', render_html: 'Drew a view', remember: 'Remembered that', teach: 'Learned a fix',
  record_resolution: 'Recorded the resolution', retire_fact: 'Retired a fact', feedback: 'Noted your feedback',
};
const WRITES = new Set(['build_story', 'edit_story', 'render_html', 'remember', 'teach', 'record_resolution', 'retire_fact', 'feedback']);
/** The purpose arg, read from the (possibly still streaming) JSON arguments. */
const purpose = (args = '') => {
  const m = args.match(/"purpose"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!m) return '';
  try { return JSON.parse(`"${m[1]}"`) as string; } catch { return m[1]; }
};
const stepLabel = (s: ToolStep) => {
  const p = purpose(s.args).trim();
  return p ? p[0].toUpperCase() + p.slice(1) : PHRASE[s.name] ?? s.name.replace(/_/g, ' ');
};

export function ToolProgress({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  const folded = steps.length >= 3 && steps.every((s) => s.done);
  const n = steps.length;
  const summary = steps.every((s) => !WRITES.has(s.name)) ? `Used ${n} graph queries` : `Took ${n} steps`;
  return (
    <div className="mb-chat-steps-wrap">
      {folded && (
        <button type="button" className="mb-chat-steps-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <DrawnCheck /><span>{summary}</span><ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
      {(!folded || open) && (
        <ul className="mb-chat-steps" aria-label="What Mochi did">
          {steps.map((s) => (
            <li key={s.id} className={s.done ? 'is-done' : 'is-live'}>
              {s.done ? <DrawnCheck /> : <span className="mb-chat-step-dot" aria-hidden="true" />}
              <span className="mb-chat-step-text">{stepLabel(s)}{s.done ? '' : '…'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
