// Smallest valid dataset/eval, shared by contract tests (and usable by slices before gen lands).
import { Dataset, type DatasetInput, type Eval } from './data.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 20);

export function tinyDataset(): Dataset {
  return Dataset.parse(tinyInput());
}

function tinyInput(): DatasetInput {
  return {
    seed: 42, generated_at: T0 + 90 * DAY, broker: 'E Corp Securities',
    customers: [{
      id: 'C-1', name: 'Meera Iyer', segment: 'premium', city: 'Pune', language: 'en', joined_at: T0,
      plan_history: [
        { plan: 'basic', valid_from: T0, valid_until: T0 + 30 * DAY },
        { plan: 'premium', valid_from: T0 + 30 * DAY, valid_until: null },
      ],
    }],
    tickets: [
      { id: 'T-1', customer_id: 'C-1', subject: 'Order not placed', body: 'Paisa kat gaya, order nahi laga', channel: 'app',
        status: 'resolved', priority: 'high', created_at: T0 + 40 * DAY, resolved_at: T0 + 41 * DAY,
        issue_id: 'I-1', resolution_id: 'R-1', solved_by: 'A-1', follows_ticket_id: null },
      { id: 'T-2', customer_id: 'C-1', subject: 'Still not placed', body: 'Same issue again', channel: 'email',
        status: 'open', priority: 'urgent', created_at: T0 + 42 * DAY, resolved_at: null,
        issue_id: 'I-1', resolution_id: null, solved_by: null, follows_ticket_id: 'T-1' },
    ],
    issues: [{ id: 'I-1', name: 'payment debited, order not placed', area: 'orders', first_seen: T0 + 39 * DAY }],
    product_areas: [{ name: 'orders', team: 'trading' }],
    teams: [{ name: 'trading' }],
    agents: [{ id: 'A-1', name: 'Kabir Rao', team: 'trading' }],
    resolutions: [{ id: 'R-1', kind: 'fix', summary: 'Re-sync order callback', kb_id: 'KB-1' }],
    kb_articles: [{ id: 'KB-1', title: 'Orders stuck after payment', area: 'orders', updated_at: T0, promised_tat_hours: 24, steps: ['Check callback', 'Re-sync'] }],
    releases: [{ version: '2.4.0', shipped_at: T0 + 38 * DAY, notes: 'Order callback rewrite', introduces: [{ issue_id: 'I-1', valid_from: T0 + 38 * DAY, valid_until: null }] }],
    plans: [{ name: 'basic' }, { name: 'premium' }],
    contradiction_events: [
      { id: 'E-1', at: T0 + 30 * DAY, kind: 'plan_change', customer_id: 'C-1', from: 'basic', to: 'premium' },
      { id: 'E-2', at: T0 + 50 * DAY, kind: 'issue_fixed', issue_id: 'I-1', fixed_in: '2.4.0' },
    ],
  };
}

export function tinyEval(): Eval {
  return {
    seed: 42,
    questions: [
      { id: 'Q-1', bucket: 'single_fact', question: 'What plan is C-1 on?', answer: 'premium', scoring: 'exact' },
      { id: 'Q-2', bucket: 'multi_hop', question: 'Which release likely caused T-2?', answer: '2.4.0', scoring: 'judge' },
      { id: 'Q-3', bucket: 'single_fact', question: 'Is I-1 still live?', answer: 'no', scoring: 'exact', after_event: 'E-2' },
    ],
    planted_mismatches: [{ id: 'M-1', kind: 'contradicts', kb_id: 'KB-1', area: 'orders', promised: 24, measured: 71, ticket_ids: ['T-1'] }],
  };
}

// tinyDataset plus the helpdesk scenarios (amend-contracts-3): a merged duplicate,
// a waiting_on_customer history, a CC'd conversation thread and one SLA policy.
// Kept separate so tests that count tinyDataset's nodes stay stable.
export function tinyHelpdeskDataset(): Dataset {
  const d = tinyInput();
  const t2 = d.tickets[1];
  Object.assign(t2, {
    requester_email: 'meera.iyer@example.invalid', cc_emails: ['ravi.iyer@example.invalid'],
    status_history: [{ status: 'open', at: T0 + 42 * DAY }, { status: 'waiting_on_customer', at: T0 + 42 * DAY + 3_600_000 }, { status: 'open', at: T0 + 43 * DAY }],
    fr_due_by: T0 + 42 * DAY + 4 * 3_600_000, first_responded_at: T0 + 42 * DAY + 2 * 3_600_000,
  });
  return Dataset.parse({ ...d, tickets: [...d.tickets,
      { id: 'T-3', customer_id: 'C-1', subject: 'Order not placed (resent)', body: 'Sending again in case you missed it', channel: 'email',
        status: 'closed', priority: 'high', created_at: T0 + 42 * DAY + 600_000, resolved_at: null,
        issue_id: 'I-1', resolution_id: null, solved_by: null, follows_ticket_id: null,
        merged_into: 'T-2', closed_at: T0 + 42 * DAY + 900_000 },
  ],
    conversations: [
      { id: 'CV-1', ticket_id: 'T-2', author: 'customer', author_id: null, incoming: true, private: false, source: 0,
        from_email: 'meera.iyer@example.invalid', to_emails: ['support@ecorp-securities.example'], cc_emails: ['ravi.iyer@example.invalid'], bcc_emails: [],
        body: 'Same issue again, see attached.', created_at: T0 + 42 * DAY, attachments: [{ name: 'screenshot.png', content_type: 'image/png', size: 48211 }] },
      { id: 'CV-2', ticket_id: 'T-2', author: 'agent', author_id: 'A-1', incoming: false, private: false, source: 0,
        from_email: 'support@ecorp-securities.example', to_emails: ['meera.iyer@example.invalid'], cc_emails: [], bcc_emails: [],
        body: 'Can you share the order reference?', created_at: T0 + 42 * DAY + 2 * 3_600_000, attachments: [] },
    ],
    sla_policies: [{ id: 'SLA-premium-high', segment: 'premium', priority: 'high', respond_within_ms: 4 * 3_600_000, resolve_within_ms: 24 * 3_600_000 }],
  });
}
