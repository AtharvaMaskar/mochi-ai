// One step line per tool Mochi runs: a live dot while it runs, the drawn check once its result is in.
import { DrawnCheck } from '../ds.tsx';

export type ToolStep = { id: string; name: string; done: boolean };

export function ToolProgress({ steps }: { steps: ToolStep[] }) {
  if (!steps.length) return null;
  return (
    <ul className="mb-chat-steps" aria-label="What Mochi is doing">
      {steps.map((s) => (
        <li key={s.id} className={s.done ? 'is-done' : undefined}>
          {s.done ? <DrawnCheck /> : <span className="mb-chat-step-dot" aria-hidden="true" />}
          <span>{s.done ? 'Ran' : 'Running'} <span className="mono">{s.name}</span>{s.done ? '' : '…'}</span>
        </li>
      ))}
    </ul>
  );
}
