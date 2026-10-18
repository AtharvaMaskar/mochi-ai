# Helpdesk model for `sim/` (Freshdesk-shaped)

Research note, 2026-10-18. Sources are Freshdesk's **public** docs only (API reference, public
support.freshdesk.com articles, Freshworks App SDK docs). No real ticket data, no MCP tools.
Every example value below is fictional (E Corp Securities, `*.example` domains).

Sources used (fetched 2026-10-18):

| key | URL |
|---|---|
| API | https://developers.freshdesk.com/api/ (single page; sections: Tickets, Conversations, Contacts, Agents, Groups, Companies, Products, Ticket Fields, SLA Policies, Satisfaction Ratings, Time Entries, Rate Limit, Pagination) |
| EMAIL | https://support.freshdesk.com/support/solutions/articles/50000009268-overview-of-email-channel |
| THREAD | https://support.freshdesk.com/support/solutions/articles/50000011687-understand-threading-logic |
| ADV | https://support.freshdesk.com/support/solutions/articles/50000009270-configuring-advanced-email-settings |
| PROCESS | https://support.freshdesk.com/support/solutions/articles/231527-how-to-process-a-ticket (merge) |
| FIELDS | https://support.freshdesk.com/support/solutions/articles/50000010094-understand-and-customize-ticket-fields |
| REOPEN | https://support.freshdesk.com/en/support/solutions/articles/50000005462-how-to-automatically-reopen-tickets-when-customer-responds- |
| AUTO | https://support.freshdesk.com/support/solutions/articles/207276-when-and-how-to-use-the-triggers-for-automations |
| WEBHOOK | https://support.freshdesk.com/support/solutions/articles/132589-using-webhooks-in-automation-rules |
| NOTIF | https://support.freshdesk.com/support/solutions/articles/220676-what-are-the-different-email-notifications-and-how-to-use-them |
| LINKED | https://support.freshdesk.com/support/solutions/articles/224695-understanding-linked-tickets |
| PARENT | https://support.freshdesk.com/support/solutions/articles/224359-setting-up-parent-child-ticketing |
| SDK | https://developers.freshworks.com/docs/app-sdk/v3.0/support_ticket/serverless-apps/product-events/onTicket/ |

Two articles (80180 "Merging two or more tickets", 37600 "Customizing ticket statuses") now
redirect to a login wall; PROCESS and FIELDS cover the same ground and are what is cited.

---

## 1. Entities and fields

### 1.1 Ticket (API › Tickets)

| field | type | notes |
|---|---|---|
| `id` | number | display id, monotonic per account |
| `subject` | string | |
| `description` / `description_text` | string | HTML / plain text. On List, only returned with `include=description` |
| `structured_description` | object | `{description_contents:[{type:"text",data:{content}}]}` |
| `status` | number | see codes below |
| `priority` | number | 1 Low, 2 Medium, 3 High, 4 Urgent. Hard-coded, tied to SLA (FIELDS) |
| `source` | number | channel that created the ticket, see below |
| `source_info` | number | which web form / chat topic / WhatsApp number |
| `type` | string | ticket type dropdown (e.g. "Question", "Incident") |
| `requester_id` | number | contact id |
| `responder_id` | number | assigned agent id |
| `group_id` | number | assigned group |
| `company_id` | number | requester's company |
| `product_id` | number | product (brand/portal) |
| `email_config_id` | number | which support mailbox received it |
| `to_emails` | string[] | addresses the original mail was sent to |
| `cc_emails` | string[] | CC on the incoming mail |
| `reply_cc_emails` | string[] | CC used on agent replies |
| `fwd_emails` | string[] | addresses the ticket was forwarded to |
| `tags` | string[] | |
| `custom_fields` | object | `cf_*` keys → values |
| `attachments` | object[] | `{id, content_type, file_size|size, name, attachment_url, created_at, updated_at}`; ≤ 20 MB total per ticket |
| `due_by` | datetime | resolution due (from SLA policy) |
| `fr_due_by` | datetime | first response due |
| `fr_escalated` | bool | escalated because first-response SLA breached |
| `is_escalated` | bool | escalated for any reason (resolution SLA breach included) |
| `spam`, `deleted` | bool | excluded from List by default |
| `association_type` | number\|null | 1 Parent, 2 Child, 3 Tracker, 4 Related |
| `associated_tickets_list` | number[] | parent→children, child→[parent], tracker→related, related→[tracker] |
| `created_at`, `updated_at` | datetime | ISO-8601 UTC (`Z`) |
| `stats` (include) | object | documented keys: `first_responded_at`, `resolved_at`, `closed_at` |
| create-only | | `email`/`phone`/`twitter_id`/`facebook_id`/`unique_external_id`/`requester_id` (one required), `name`, `parent_id` (makes a child), `related_ticket_ids` (makes a tracker), `internal_agent_id`, `internal_group_id` |

**Status codes** (API › Ticket Properties; FIELDS):

| code | name | notes |
|---|---|---|
| 2 | Open | default on create; "any time a customer responds to a ticket, it is automatically moved back to Open" (FIELDS) |
| 3 | Pending | "useful to halt your SLA timers" |
| 4 | Resolved | agent considers it solved |
| 5 | Closed | customer accepted; closing after 72 h idle is "the standard practice" |
| 6+ | custom | account-defined. The API's `ticket_fields` sample shows `6: ["Waiting on Customer","Awaiting your Reply"]`, `7: ["Waiting on Third Party","Being Processed"]` |

Status field choices are `code → [agent_label, customer_label]`. Each status has an SLA toggle
(admin turns it off to pause SLA). Custom statuses need Growth plan or higher. Codes ≥ 6 are
assigned in creation order, so consumers must read `GET /api/v2/ticket_fields` rather than
hard-code them.

**Ticket source codes**: 1 Email, 2 Portal, 3 Phone, 4 Forum, 5 Twitter, 6 Facebook, 7 Chat,
9 Feedback Widget, 10 Outbound Email. (Ticket Properties table lists 1/2/3/7/9/10; the
`ticket_fields` sample adds 4/5/6.) Newer channels (WhatsApp etc.) exist but their codes are
not in the public table — `sim/` does not need them.

### 1.2 Conversation (API › Conversations)

One row per reply or note after the ticket's first message (the first message is the ticket's
`description`).

| field | notes |
|---|---|
| `id`, `ticket_id`, `user_id` | `user_id` = contact or agent who wrote it |
| `body` / `body_text` / `structured_body` | HTML / plain / structured |
| `incoming` | true = came from outside (customer email in) |
| `private` | true = private note (agents only) |
| `source` | 0 Reply, 2 Note, 5 Tweet, 6 Survey feedback, 7 Facebook, 8 Forwarded email, 9 Phone, 11 E-commerce |
| `support_email` | mailbox the reply went out from; null for notes |
| `from_email`, `to_emails`, `cc_emails`, `bcc_emails` | envelope |
| `replied_to` | (on reply create response) recipients |
| `attachments` | same shape as ticket attachments |
| `created_at`, `updated_at`, `last_edited_at`, `last_edited_user_id` | |

Classification that matters for ingest:
- customer email in: `incoming=true, private=false, source=0`
- agent reply out: `incoming=false, private=false, source=0`
- private note: `private=true, source=2`; public note: `private=false, source=2`
- forwarded thread: `source=8`

Notes default to private when created via API. Auto-response detection is not a documented
API field; ADV's "Detect automated replies" setting exists, so `sim/` should carry an explicit
`auto_response` flag in its truth sidecar (§9.3).

### 1.3 Other entities (API)

| entity | key fields |
|---|---|
| **Contact** | `id, name, email, other_emails[], phone, mobile, company_id, other_companies[], language, time_zone, tags[], custom_fields, unique_external_id, active, deleted, view_all_tickets, created_at, updated_at` |
| **Company** | `id, name, domains[]` (contacts with that email domain auto-join), `description, note, health_score, account_tier, renewal_date, industry, custom_fields` |
| **Agent** | `id, occasional, available, available_since, signature, ticket_scope (1 global, 2 group, 3 restricted), type (support_agent/field_agent/collaborator), group_ids[], role_ids[], skill_ids[], contact{name,email,language,time_zone,...}` |
| **Group** | `id, name, description, agent_ids[], auto_ticket_assign (0 off, 1 round robin, 2 skill-based, 3 load-based / omniroute), business_hour_id, escalate_to, unassigned_for ("30m","1h",...)` |
| **Product** | `id, name, description` — a brand/portal, not a feature area |
| **Ticket field** | `id, name, label, label_for_customers, type (default_status, default_priority, custom_dropdown, ...), choices, required_for_closure, displayed_to_customers`. Custom types: single-line, multi-line, checkbox, dropdown, dependent (3 levels), date, number, decimal (FIELDS) |
| **Tags** | plain string array on ticket/contact; no tag entity |
| **Satisfaction rating** | `id, survey_id, user_id, agent_id, group_id, ticket_id, feedback, ratings{default_question: n}, created_at`. New-survey scale 103…-103 (Extremely Happy … Extremely Unhappy); classic: 1 happy, 2 neutral, 3 unhappy. Feedback does not reopen a ticket by default (REOPEN search result) |
| **Time entry** | `id, ticket_id, agent_id, billable, time_spent "hh:mm", timer_running, start_time, executed_at, note` |
| **SLA policy** | `id, name, position (first match wins), is_default, active, sla_target{priority_4..priority_1:{respond_within, resolve_within (seconds, multiples of 60, >900), business_hours, escalation_enabled}}, applicable_to{company_ids, group_ids, sources, ticket_types, product_ids}, escalation{response, resolution{level1..level4:{escalation_time, agent_ids}}}` |

SLA mechanics: the policy matched at creation sets `fr_due_by` and `due_by` "within a few
seconds of ticket creation". Breach of first response sets `fr_escalated`; any escalation sets
`is_escalated`. Hourly automations and system events fire "ticket marked overdue for first
response, next response, or resolution" (AUTO).

---

## 2. Lifecycle

**Email → ticket.** Mail to a configured support address (or the wildcard address, if enabled)
becomes a ticket with `source=1`, `to_emails` = the support address, `cc_emails` from the CC
line, requester = sender (contact auto-created if new). If `Reply-To` handling is on, the
Reply-To address becomes the requester (ADV #6). One mail sent to two support addresses makes
two tickets (EMAIL).

**Threading a reply** (EMAIL, "Email Threading Logic"). Two checks, both must pass:
1. *Email marker* — any of: ticket id in subject as `[#{{ticket.id}}]` (optionally with a
   prefix, `[#ECS-1042]`); `Message-ID` of a prior mail found in `In-Reply-To`/`References`;
   a hidden ticket identifier (span) Freshdesk embeds in outgoing HTML mail.
2. *Requester* — sender is the requester, an agent on the ticket, a CC'd address, or an address
   the ticket was forwarded to.

**When a reply opens a NEW ticket instead:**
- no marker matches (customer wrote a fresh mail, stripped the subject, replied in plain text
  so the span is lost, and the Message-ID has expired — it "usually expires seven days after
  the last response");
- marker matches but the sender is a stranger (a spouse replying from another address) — unless
  "Ignore the sender email address while threading" is on;
- "Create a new ticket when subject line changes" is on and the subject changed (ADV #15);
- "Create a new ticket for each customer response" is on (ADV #10);
- the reply lands after the threading interval on a resolved/closed ticket (THREAD);
- the customer adds a second support address mid-thread: a separate ticket, also shown as a
  reply on the current one (EMAIL).

**Reopening.** Default Ticket-Updates rule "Automatically reopen tickets when the customer
responds" sets status back to Open on a customer reply to a Resolved/Closed ticket; it skips
auto-responses; admins can change its action to "create a new ticket" (REOPEN). Freddy's Thank
You Detector can suppress reopen on a bare "thanks". Survey feedback does not reopen.

**Auto-responses and notifications** (NOTIF). Requester notifications: *New Ticket Created*
(the auto-acknowledgement, carries `[#id]` in subject), *Agent adds comment to ticket*, *Agent
solves the ticket*, *Agent closes the ticket*. Agent notifications: new ticket, assigned to
group/agent, requester replies, unattended in group, SLA reminder/violation, collaboration.
A Ticket-Creation automation that also emails the requester produces a second ack unless it
uses "Skip new ticket email notifications". ADV #13 "Detect automated replies" keeps
out-of-office mail from counting as a customer response.

**Forwarded mail.** When an agent forwards a customer mail to the support address, ADV #7
("For forwarded emails, use original sender as requester") attributes the ticket to the
original sender; off, the agent becomes requester. Forwarding a ticket out
(`POST /tickets/[id]/forward`) records `fwd_emails`; replies from that third party thread
(requester check passes) and arrive as `source=8`.

---

## 3. Merging (API › Ticket Merge API; PROCESS)

```
PUT /api/v2/tickets/merge
{ "primary_id": 2041, "ticket_ids": [2041, 2047, 2052],
  "note_in_primary":   { "body": "Merged #2047, #2052", "private": true },
  "note_in_secondary": { "body": "Merged into #2041", "private": true },
  "convert_recepients_to_cc": true }          // sic: "recepients"
→ 204 No Content
```

- **Secondary tickets** are closed (status 5) automatically and drop out of list views. Each
  gets a note linking to the primary (private by default — public would email the requester).
  Merged/secondary tickets are excluded from analytics.
- **Primary** receives the secondaries' conversations, shown in chronological order, plus a
  note with merge details. Its status is not changed by the merge. With
  `convert_recepients_to_cc` the secondary requesters/recipients are added to its CC.
- Conversations are *copied/moved onto the primary*; there is no documented
  "merged_into" field on the secondary — the only link is the note body.
- Not mergeable: web chat, WhatsApp, Facebook, Instagram tickets. A merge cannot be undone.
- A "ticket closed → email requester" automation will fire on the merge unless it has a
  "ticket is not merged" condition (AUTO lists "Whether the ticket is merged or not" as a
  condition).

---

## 4. Linking and parent–child

- **Tracker / linked tickets** (LINKED; API "Create a Tracker"). A tracker is a master ticket
  for one incident; many customer tickets are linked to it as *related*. Create with
  `POST /tickets` + `related_ticket_ids:[...]`. Tracker has `association_type=3`,
  `associated_tickets_list=[related ids]`; each related has `association_type=4`,
  `associated_tickets_list=[tracker id]`. Updates posted on the tracker broadcast to linked
  tickets. A ticket that already has a parent/child, or was a merge primary, cannot be linked.
- **Parent–child** (PARENT; API "Create a Child Ticket"). Splits one request into sub-tasks for
  different agents/teams. `POST /tickets` + `parent_id`. Parent `association_type=1`, child `2`.
  Up to 50 children; the parent can be closed only after all children close.
- A ticket uses trackers *or* parent–child, never both.
- Reads: `GET /tickets/[id]/associated_tickets`, `GET /tickets/[id]/prime_association`.

---

## 5. Webhooks and automations

Freshdesk has **no subscription-style webhook API**. Outbound HTTP comes from an automation
rule action "Trigger webhook" (WEBHOOK):
- rule types: *Ticket Creation* (runs once per new ticket; not for tickets made via the
  outbound-email API), *Ticket Updates* (event-driven), *Hourly Triggers* (scan tickets updated
  in the last 30 days) (AUTO);
- request: method GET/POST/PUT/PATCH/DELETE, URL with placeholders (`{{ticket.id}}`), optional
  auth, custom headers, encoding JSON / XML / XML-encoded, body *Simple* (pick ticket
  properties) or *Advanced* (hand-written JSON with placeholders such as `{{ticket.id}}`,
  `{{ticket.subject}}`, `{{ticket.requester.email}}`, `{{ticket.latest_public_comment}}`,
  `{{Triggered event}}`);
- limits: 1000 webhook calls/hour, excess buffered; non-2xx (non-3xx) responses retried every
  30 min, up to 48 calls; admins emailed on failure;
- some placeholders are not populated at the instant of creation — Freshdesk's own advice is to
  send the id and fetch/update via API.

Ticket-Updates events that matter for ingest (AUTO): *Reply is sent*, *Note is added*
(private/public/any), *Ticket is updated*, a dropdown property (status, priority, type) changes,
*Agent or Group is updated*, *Customer feedback is received*, *Thread is created or updated*;
performer filter: Agent / Requester / Collaborator / System. System events: mail delivery
failed (bounce), forward failed, first/next/resolution overdue.

App SDK product events (SDK) are the closest thing to a typed event schema:
`onTicketCreate`, `onTicketUpdate` (status/priority/type/source/agent/group/spam/escalation;
not tags or custom fields), `onTicketDelete`, `onConversationCreate` (reply or note). Envelope:
`{ event, region, timestamp, data:{ actor, requester, ticket }, currentHost }`; updates carry
`ticket.changes: { "<attr>": [old, new] }`; bodies truncated at 10 KB.

**Ingest pattern recommended by the docs themselves:** thin webhook carrying the id → pull
`GET /tickets/[id]?include=conversations,requester,stats`, plus a periodic
`GET /tickets?updated_since=` sweep to catch anything a webhook missed.

---

## 6. API shapes

**Auth**: HTTP Basic, `apikey:X`. Base: `https://<domain>.freshdesk.com/api/v2`.

**Endpoints relevant to ingest**

| method + path | notes |
|---|---|
| `GET /tickets` | filters: `filter=new_and_my_open|watching|spam|deleted`, `requester_id`, `email`, `company_id`, `updated_since=ISO`; sort `order_by=created_at|due_by|updated_at|status`, `order_type=asc|desc` (default created_at desc); `include=requester,stats,description` (each +2 credits). **Default window: created in last 30 days** unless `updated_since` given. Max 300 pages. `include=conversations` is *not* available on List |
| `GET /tickets/[id]` | `include=conversations` (first 10, ascending, costs 2 calls), `requester`, `company`, `stats` (+1 credit each) |
| `GET /tickets/[id]/conversations` | paginated, 30/page default |
| `GET /search/tickets?query="..."` | query ≤ 512 chars, `AND`/`OR`, `:>` `:<` on dates/numbers, 30/page, max 10 pages, index lag "a few minutes" |
| `PUT /tickets/merge` | §3 |
| `POST /tickets/[id]/reply`, `POST /tickets/[id]/notes` | write-back |
| `GET /tickets/[id]/associated_tickets`, `/prime_association` | §4 |
| `GET /ticket_fields`, `/contacts/[id]`, `/companies/[id]`, `/agents`, `/groups`, `/products`, `/sla_policies` | reference data |
| `GET /tickets/[id]/satisfaction_ratings`, `/tickets/[id]/time_entries` | |

**Pagination**: `page` (1-based), `per_page` (default 30, max 100; >100 is an error). Next page
in `Link: <...&page=2>; rel="next"`; header absent on the last page. Avoid page > 500.

**Rate limits** (per account per minute): trial 50; Growth 100; Pro 400; Enterprise 700, each
with per-endpoint sub-limits (e.g. Enterprise: Tickets List 200, Ticket Create 280). Headers
`X-RateLimit-Total`, `X-RateLimit-Remaining`, `X-RateLimit-Used-CurrentRequest`; on breach
`HTTP 429` + `Retry-After: <seconds>`. Invalid requests count.

**Example — `GET /api/v2/tickets/2041?include=conversations,requester,stats`** (fictional):

```json
{
  "id": 2041,
  "subject": "Re: [#2038] Funds not credited after UPI transfer",
  "description": "<div>Hi, I added ₹25,000 via UPI at 10:12 today. It shows debited in my bank but not in my E Corp wallet.</div>",
  "description_text": "Hi, I added ₹25,000 via UPI at 10:12 today. It shows debited in my bank but not in my E Corp wallet.",
  "status": 2,
  "priority": 3,
  "source": 1,
  "source_info": null,
  "type": "Incident",
  "requester_id": 90000000117,
  "responder_id": 90000000004,
  "group_id": 70000000002,
  "company_id": null,
  "product_id": null,
  "email_config_id": 60000000001,
  "to_emails": ["support@ecorp-securities.example"],
  "cc_emails": ["r.iyer.family@mail.example"],
  "reply_cc_emails": ["r.iyer.family@mail.example"],
  "fwd_emails": [],
  "tags": ["funds", "upi"],
  "custom_fields": { "cf_product_area": "funds", "cf_client_code": "EC100117" },
  "fr_escalated": false,
  "is_escalated": false,
  "spam": false,
  "association_type": null,
  "fr_due_by": "2026-09-14T08:42:00Z",
  "due_by":    "2026-09-15T04:42:00Z",
  "created_at": "2026-09-14T04:42:10Z",
  "updated_at": "2026-09-14T06:05:31Z",
  "attachments": [],
  "requester": {
    "id": 90000000117, "name": "Ravi Iyer", "email": "ravi.iyer@mail.example",
    "mobile": null, "phone": null
  },
  "stats": {
    "first_responded_at": "2026-09-14T05:20:44Z",
    "resolved_at": null,
    "closed_at": null
  },
  "conversations": [
    {
      "id": 51000000881,
      "ticket_id": 2041,
      "user_id": 90000000004,
      "incoming": false,
      "private": false,
      "source": 0,
      "support_email": "support@ecorp-securities.example",
      "from_email": "\"E Corp Securities Support\" <support@ecorp-securities.example>",
      "to_emails": ["ravi.iyer@mail.example"],
      "cc_emails": ["r.iyer.family@mail.example"],
      "bcc_emails": [],
      "body": "<div>Hi Ravi, UPI credits can take up to 2 hours ...</div>",
      "body_text": "Hi Ravi, UPI credits can take up to 2 hours ...",
      "attachments": [],
      "created_at": "2026-09-14T05:20:44Z",
      "updated_at": "2026-09-14T05:20:44Z",
      "last_edited_at": null,
      "last_edited_user_id": null
    }
  ]
}
```

**Example — one conversation from `GET /api/v2/tickets/2041/conversations`** (customer reply
with a screenshot, fictional):

```json
{
  "id": 51000000902,
  "ticket_id": 2041,
  "user_id": 90000000117,
  "incoming": true,
  "private": false,
  "source": 0,
  "support_email": "support@ecorp-securities.example",
  "from_email": "Ravi Iyer <ravi.iyer@mail.example>",
  "to_emails": ["support@ecorp-securities.example"],
  "cc_emails": ["r.iyer.family@mail.example"],
  "bcc_emails": [],
  "body": "<div>Still not credited. Screenshot attached.</div><div class=\"freshdesk_quote\"><blockquote>On Mon, 14 Sep 2026 at 10:50, E Corp Securities Support wrote: ...</blockquote></div>",
  "body_text": "Still not credited. Screenshot attached.\n\nOn Mon, 14 Sep 2026 at 10:50, E Corp Securities Support wrote: ...",
  "attachments": [
    {
      "id": 52000000044,
      "name": "upi-debit.png",
      "content_type": "image/png",
      "size": 48213,
      "attachment_url": "https://sim.ecorp-securities.example/attachments/52000000044/upi-debit.png",
      "created_at": "2026-09-14T06:05:31Z",
      "updated_at": "2026-09-14T06:05:31Z"
    }
  ],
  "created_at": "2026-09-14T06:05:31Z",
  "updated_at": "2026-09-14T06:05:31Z",
  "last_edited_at": null,
  "last_edited_user_id": null
}
```

(The `freshdesk_quote` wrapper is an illustrative choice for `sim/`; the public docs do not
specify how quoted history is marked up in `body`.)

---

## 7. Complexity catalogue for realistic synthetic email

All frequencies are **estimates** (author's judgement for a retail-broker inbox, not measured
from any dataset). "Per ticket" = share of tickets; "per msg" = share of inbound messages.

| # | phenomenon | freq (estimate) | how it shows up in Freshdesk | what `sim/` should generate |
|---|---|---|---|---|
| 1 | Follow-up on an open ticket | 30–40 % of inbound msgs; median 2–3 customer msgs/ticket | conversation `incoming=true, source=0` | replies with `Re: [#id]`, `In-Reply-To` set; "any update?" nudges 24–72 h after last agent reply |
| 2 | Duplicate that should be merged | 3–6 % per ticket | 2+ tickets same requester/issue within hours (email + portal, or re-send) | second ticket, near-identical body, later `PUT /merge` event; truth `duplicate_of` |
| 3 | New ticket instead of replying | 4–8 % per ticket | fresh subject, no `[#id]`, no `In-Reply-To` | new ticket that refers to "my earlier mail"; truth `follows_ticket_id` |
| 4 | Quoted history "On … wrote:" | 60–80 % of reply msgs | in `body_text` | append prior message quoted (`>` or blockquote), sometimes top-posted, sometimes inline |
| 5 | Forwarded chain | 2–5 % per ticket | `Fwd:` subject, `---------- Forwarded message ---------` block; agent-forward → `source=8` | wrapper text + embedded original headers (From/Date/Subject/To) |
| 6 | CC'd third party | 5–10 % per ticket | `cc_emails` non-empty (relative, CA, advisor) | CC address replies later and threads (requester check passes) |
| 7 | Auto-reply / out-of-office | 2–5 % of inbound msgs; true loops < 0.1 % | ADV "Detect automated replies"; reopen rule skips them | `Auto-Submitted: auto-replied`, "I am out of office until…"; one rare ack↔OOO loop capped at 3 |
| 8 | Bounce (NDR) | 0.5–2 % of outbound | system event "mail sent to an address failed" | `MAILER-DAEMON` message, `Delivery Status Notification (Failure)`, references a ticket |
| 9 | Spam | 3–8 % of what reaches the helpdesk (after mailbox filter) | `spam=true`, excluded from List | SEO, crypto, phishing-style "verify your account" (with fictional, dead links) |
| 10 | Mixed languages | 10–20 % per ticket (Indian broker) | free text | Hinglish (Latin-script Hindi), some Devanagari, occasional Tamil/Marathi greeting; contract `language` already exists |
| 11 | Attachment referenced but missing | 3–5 % of msgs that mention one | `attachments: []` but body says "PFA" | "please find attached" with no attachment; customer re-sends next msg |
| 12 | Escalation tone | 8–15 % per ticket; regulator/legal threat 1–2 % | `priority` raised, `is_escalated` | caps, "third time I am writing", "will complain to the exchange / ombudsman" |
| 13 | Template agent replies | 50–70 % of agent replies | canned responses | 15–25 canned bodies with `{{name}}`/`{{ticket.id}}` slots; same text across tickets |
| 14 | Internal notes | 30–50 % of tickets have ≥ 1 | `private=true, source=2` | "checked with payments team, UTR matches", @mentions, handoff notes |
| 15 | Reopened after resolved | 5–10 % per ticket | status 4/5 → 2 on customer reply | reply 1–5 days after resolve: "this happened again" |
| 16 | "Thanks" after resolve | 15–25 % of resolved tickets | should *not* reopen (Thank You Detector) | short gratitude replies; truth `reopen=false` |
| 17 | Multiple issues in one mail | 5–10 % per ticket | one ticket, two topics; often split to child tickets | body covering e.g. KYC + brokerage charge; truth `issue_ids[]` |
| 18 | Wrong requester | 1–3 % per ticket | sender ≠ account holder | "writing for my father, client code EC…"; truth `on_behalf_of` customer_id |
| 19 | Signature / disclaimer noise | signature 70–90 % of msgs; legal disclaimer 15–30 %; "Sent from my iPhone" 20–30 % | in body | append signature blocks, confidentiality footers, mobile footers |
| 20 | Status ping-pong / waiting | 20–30 % of tickets visit Pending or a Waiting status | status 3/6/7 | agent asks for documents → status 6, customer replies → 2 |
| 21 | SLA breach | 5–15 % first-response breach | `fr_escalated=true` | derived from replay timings, not hand-set |

---

## 8. Mapping to our contract (`contracts/graph.ts`, `contracts/data.ts`)

| Freshdesk entity / field | maps to (current contract) | gap |
|---|---|---|
| Ticket `id` | `Ticket.id` (string) | store Freshdesk numeric id as string, e.g. `"2041"`; keep `fd_id` if numeric sort needed |
| `subject`, `description_text` | `Ticket.subject`, `Ticket.body` | body = first message only; later messages need a home (→ conversations) |
| `status` 2/3/4/5 | `TicketStatus` open/pending/resolved/closed | **no codes 6/7** (waiting on customer / third party); no status history |
| `priority` 1–4 | `Priority` low…urgent | 1:1, add code map |
| `source` | `Channel` app/email/chat | add `portal`, `phone`, `outbound_email`; `app` ≈ Freshdesk portal/widget (2/9) |
| `requester_id` → Contact | `Customer` via `customer_id`, edge `RAISED` | **requester ≠ customer** case (wrong requester) unrepresented: need `requester_email` + `on_behalf_of` |
| Contact `email`, `language` | `Customer.language`; no email | add `Customer.email` (+ `other_emails`) — needed for threading and requester checks |
| Company | — | not needed (retail B2C); skip |
| Agent | `AgentUser`, `SOLVED`, `MEMBER_OF` | `responder_id` (assigned) ≠ `solved_by`; fine to keep `solved_by` only |
| Group | `Team` (via `MEMBER_OF`, `OWNED_BY`) | 1:1 by name |
| Product | — | Freshdesk product = brand; our `ProductArea` maps better to a `cf_product_area` custom field |
| `custom_fields.cf_product_area` | `Issue -[:IN]-> ProductArea` | sim emits it as custom field; issue itself is never a Freshdesk field (truth only) |
| `type` | — | optional; could carry `ResolutionKind`-like category |
| `tags` | — | optional; not needed for the graph |
| Solutions (KB) article | `KBArticle`, `BASED_ON` | fine |
| Canned response | `Resolution.summary` text source | template replies reuse resolution text |
| Conversation | — | **missing**: no message records at all |
| `incoming/private/source` | — | needed to tell customer msgs, agent replies, notes apart |
| `to/cc/bcc_emails` | — | **missing** (CC'd third parties) |
| attachments | — | name + content_type only; no blobs |
| `fr_due_by`, `due_by` | `KBArticle.promised_tat_hours`, `Policy` | **missing** on Ticket; `Policy` label exists with no fields in `data.ts` — SLA policy fits it |
| `stats.first_responded_at`, `closed_at` | `Ticket.resolved_at` only | add `first_responded_at`, `closed_at` (measured TAT vs promised needs them) |
| `fr_escalated`, `is_escalated` | — | add booleans (derivable, but Freshdesk exposes them) |
| Merge | `FOLLOWS` (Ticket→Ticket) | **merge ≠ follow-up**: need `merged_into` + edge `MERGED_INTO` |
| Tracker / related | `Ticket -[:ABOUT]-> Issue` | a tracker *is* an incident: map tracker → `Issue`, related → `ABOUT`. No new edge |
| Parent / child | — | optional `CHILD_OF` (Ticket→Ticket); only if multi-issue split is in scope |
| Satisfaction rating | — | optional `Ticket.csat` number; skip unless a report needs it |
| Time entry | — | skip |
| spam / auto-reply / bounce | — | not tickets in the graph; filtered at ingest, recorded in truth |

**New contract fields we would need** (all additive; contract changes are serial per CLAUDE.md):

1. `data.ts` **`Conversation`** records: `{ id, ticket_id, author: 'customer'|'agent'|'system', author_id, incoming, private, source (0|2|8), from_email, to_emails[], cc_emails[], bcc_emails[], body, created_at, attachments: {name, content_type, size}[] }` and `Dataset.conversations[]`. Graph: either no node (bodies feed embeddings only) or a `Message` label with `(:Ticket)-[:HAS_MESSAGE]->(:Message)`.
2. **Status model**: extend `TicketStatus` with `waiting_on_customer`, `waiting_on_third_party`; add `FD_STATUS` code map `{2,3,4,5,6,7}` to contracts; add `status_history: {status, at}[]` on Ticket (reopen and SLA pause are computed from it).
3. **Merge**: `Ticket.merged_into: id | null`, edge `MERGED_INTO: e('Ticket','Ticket')`. Briefing queries must exclude merged secondaries (they are closed and carry no issue).
4. **SLA**: `Ticket.fr_due_by`, `due_by`, `first_responded_at`, `closed_at`, `fr_escalated`, `is_escalated`; an `SlaPolicy` record per segment (retail/premium/hni) × priority with `respond_within_s`, `resolve_within_s` — loadable onto the existing `Policy` label with `P.promisedTat`.
5. **Envelope / identity**: `Customer.email`; `Ticket.requester_email`, `Ticket.cc_emails[]`, `Ticket.on_behalf_of` (customer_id when requester is a relative); `Channel` gains `portal`, `phone`.
6. (sim-only, not graph) **truth sidecar** per message: `{ kind: 'customer'|'auto_reply'|'bounce'|'spam'|'agent'|'note', duplicate_of, follows_ticket_id, issue_ids[], reopen, language }` — see §9.3.

---

## 9. Recommendations for `sim/`

### 9.1 API subset for the demo

Implement read paths faithfully; everything else is out.

| endpoint | why |
|---|---|
| `GET /api/v2/tickets?updated_since&page&per_page&order_by&order_type&include=requester,stats,description` | the ingest sweep; honour the 30-day default window and `Link` header |
| `GET /api/v2/tickets/:id?include=conversations,requester,stats` | the webhook follow-up fetch |
| `GET /api/v2/tickets/:id/conversations?page` | > 10 messages |
| `GET /api/v2/ticket_fields` | status/priority/source choices incl. 6/7 |
| `GET /api/v2/contacts/:id`, `GET /api/v2/agents`, `GET /api/v2/groups` | reference data |
| `POST /api/v2/tickets/:id/notes` | Mochi writes the briefing back as a private note (visible demo moment) |
| `PUT /api/v2/tickets/merge` | optional: lets the agent act on a duplicate it found |
| new-ticket webhook | `POST <subscriber>` with `{ "event": "ticket_created", "ticket_id": 2041, "triggered_event": "Ticket created", "sim_time": "...Z" }`, plus `conversation_created` for replies/notes |

Also: Basic auth `apikey:X`; `X-RateLimit-*` headers with a configurable budget and real 429 +
`Retry-After` (the ingest code then has to handle it — cheap realism). Skip search, bulk,
forward, outbound, CSAT, time entries, SLA admin, attachments upload. Attachment URLs can 404.

### 9.2 Generating thousands of emails

| approach | variety | determinism | cost (5,000 customer msgs) | verdict |
|---|---|---|---|---|
| deterministic templates (per issue × phenomenon × language slot-filling) | low–medium; repetition visible after a few hundred | perfect | $0 | baseline, and the only layer that decides facts |
| LLM paraphrase of every message, cached to disk | high | deterministic after first run (cache keyed by hash of seed+skeleton+prompt) | ~**$0.85** at catalog price | good, but every fact must survive paraphrase |
| **mix (recommended)**: templates build a *skeleton* (facts, ids, amounts, dates, phenomenon flags); Haiku paraphrases only the free-text tone layer for ~1 in 3 skeletons; noise (quotes, signatures, disclaimers, OOO, bounces, forwards) is appended deterministically after | high where it shows, cheap | deterministic (cache committed or regenerated with same hash) | ~**$0.30** at catalog price | recommended |

Cost basis: `claude-haiku-5-5` at **$0.10 / 1M input, $0.50 / 1M output** — read from the
installed `@earendil-works/pi-ai` catalog (`node_modules/@earendil-works/pi-ai/dist/providers/data/anthropic.json`),
which is what `bench/` uses to price runs. (`contracts/results.test.ts` uses a $1 / $5 fixture;
if that is the real price, multiply all figures by 10: full paraphrase ≈ $8.50, mix ≈ $3.)
Assumptions: ~400 input tokens (shared system prompt + skeleton) and ~250 output tokens per
message, batched 10 skeletons per call with a cached system prompt.
Full: 5,000 × 400 = 2.0 M in ($0.20) + 5,000 × 250 = 1.25 M out ($0.63) ≈ $0.83.
Mix (1,700 paraphrased): 0.68 M in + 0.43 M out ≈ $0.28.

Rules that keep the LLM layer safe:
- the LLM never invents a fact: amounts, client codes, ticket ids, dates and the issue are
  placeholders it must keep verbatim (`{{AMOUNT}}`), re-filled after; reject + fall back to
  the template if any placeholder is missing;
- output is plain text only; HTML is rendered by `sim/` (`<div>` per paragraph);
- cache file `sim/cache/paraphrase.jsonl` keyed by `sha256(skeleton_id, style, prompt_version)`;
  a run with a warm cache makes zero API calls, so CI and judges reproduce byte-identical data.

### 9.3 Keeping ground truth computable

- **Truth first, surface second.** `gen/` already produces tickets with `issue_id`,
  `resolution_id`, `follows_ticket_id`. `sim/` *renders* those into Freshdesk-shaped mail; it
  never decides facts. Every phenomenon in §7 is a seeded flag on the skeleton.
- Write a sidecar `sim/out/truth.json` (never served by the API): per message
  `{kind, ticket_id, true_customer_id, issue_ids[], duplicate_of, follows_ticket_id, reopen}`.
  Bench and eval read truth; the agent only sees the API.
- Noise is a *function* of truth: spam/OOO/bounce/thank-you messages carry no issue; duplicates
  point to their primary; the answer to any eval question is computed from `dataset.json` +
  `truth.json`, not from rendered text (same rule as SPEC §2: "Ground truth is computed from
  the JSON, not the graph").
- Ingest-quality metrics fall out for free: threading accuracy, merge recall, spam/auto-reply
  filter precision, on-behalf-of resolution — each a comparison of graph state vs truth.
- Paraphrase may change words, never labels; a validator re-checks placeholders and language.

### 9.4 Replay clock

- One virtual clock: `sim_now = t0 + (wall_now − wall_start) × speed`, with `t0` = dataset
  start (epoch ms UTC, as in `data.ts`). Controls: `POST /sim/clock { speed, pause, jump_to }`,
  `GET /sim/clock`.
- Precompute a single **event log** sorted by `at`: `ticket_created`, `conversation_created`,
  `status_changed`, `merged`, `sla_breached`. Each event is deterministic from the seed.
- Every API read is a view *as of* `sim_now`: a ticket exists iff `created_at ≤ sim_now`; its
  conversations, status and `updated_at` are the latest events ≤ `sim_now`. So
  `updated_since` and the 30-day default window behave like the real thing.
- SLA flags (`fr_escalated`, `is_escalated`) are computed from `fr_due_by`/`due_by` vs the
  first agent reply relative to `sim_now`, not stored — they flip during replay.
- Webhook dispatcher: a loop that fires events whose `at` crossed since the last tick; at-least-
  once delivery with retry (compress Freshdesk's "every 30 min × 48" to "every 30 s × 5");
  receivers must be idempotent on `(event, ticket_id, conversation_id)`.
- Dream boundary: IST midnight in virtual time (`t % 86400000 === 18.5 h UTC`) emits a
  `day_closed` event, so the nightly dream runs on schedule at any replay speed.
- Default demo: 90 days at `speed = 8640` (1 virtual day ≈ 10 s), or `jump_to` a bad-release
  week for the spike.
