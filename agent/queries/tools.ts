// The seven read tools, defined once: the harness builds its Pi tools from these, and bench arm D hands the same
// names, descriptions and schemas to the answer model through pi-ai tool calling.
import { Type, type TSchema } from '@earendil-works/pi-ai';
import * as Q from './index.ts';
import { ALGORITHMS, graphAlgorithm, queryGraph, ROW_CAP, type ToolCtx } from './graph-tools.ts';

export type ReadToolSpec = {
  name: 'briefing' | 'likely_cause' | 'who_knows' | 'emerging_clusters' | 'blast_radius' | 'search_similar' | 'customer_profile' | 'query_graph' | 'graph_algorithm' | 'trace_story';
  description: string;
  parameters: TSchema;
  run(db: Q.Db, args: any, as_of: number, graph: string, embed?: Q.EmbedFn, ctx?: ToolCtx): Promise<Q.Result>;
};

export const READ_TOOL_SPECS: ReadToolSpec[] = [
  { name: 'briefing', description: 'Brief on a ticket: customer profile and live plan, last 3 tickets, what fixed similar tickets (shared Issue, or vector fallback), with the traversal path.',
    parameters: Type.Object({ ticketId: Type.String() }), run: (db, a, t, g) => Q.briefing(db, a, t, g) },
  { name: 'likely_cause', description: 'The release that introduced the ticket\'s issue, if that link is still live.',
    parameters: Type.Object({ ticketId: Type.String() }), run: (db, a, t, g) => Q.likelyCause(db, a, t, g) },
  { name: 'who_knows', description: 'Agents ranked by how many tickets on this issue they solved.',
    parameters: Type.Object({ issueId: Type.String() }), run: (db, a, t, g) => Q.whoKnows(db, a, t, g) },
  { name: 'emerging_clusters', description: 'Ticket clusters the dream detected, ranked by growth over the window.',
    parameters: Type.Object({ days: Type.Optional(Type.Number()) }), run: (db, a, t, g) => Q.emergingClusters(db, { days: a.days ?? 7 }, t, g) },
  { name: 'blast_radius', description: 'For a release: affected customers, segments and open tickets, with the Release→Issue←Ticket←Customer path.',
    parameters: Type.Object({ version: Type.String() }), run: (db, a, t, g) => Q.blastRadius(db, a, t, g) },
  { name: 'search_similar', description: 'Tickets nearest to a text, from the vector index.',
    parameters: Type.Object({ text: Type.String(), k: Type.Optional(Type.Number()) }), run: (db, a, t, g, embed) => Q.searchSimilar(db, a, t, g, embed) },
  { name: 'customer_profile', description: 'A customer: segment, live plan and city; earlier tickets and how each ended; open tickets; merged duplicates.',
    parameters: Type.Object({ customerId: Type.String() }), run: (db, a, t, g) => Q.customerProfile(db, a, t, g) },
  { name: 'query_graph', description: `Your own read-only Cypher over the graph schema, for anything the fixed tools do not cover. Must reference $as_of (filter nodes with n.created_at <= $as_of, temporal edges with r.valid_from <= $as_of AND r.valid_until > $as_of). Labels and edges must be in the schema. Up to ${ROW_CAP} rows, 5 s timeout. Returns a table card and q_<n>.`,
    parameters: Type.Object({ cypher: Type.String(), purpose: Type.String(), graph: Type.Optional(Type.String()) }),
    run: (db, a, t, g, _e, ctx) => queryGraph(db, a, t, g, ctx) },
  { name: 'graph_algorithm', description: 'A FalkorDB graph algorithm over live edges: shortest_path (how two nodes connect, path receipt), pagerank (whose fixes sit at the centre), communities (similar-ticket groups), components, betweenness (bridging issues/areas), neighbourhood. Returns a card and q_<n>.',
    parameters: Type.Object({
      algorithm: Type.Union(ALGORITHMS.map((a) => Type.Literal(a))),
      params: Type.Optional(Type.Object({
        source: Type.Optional(Type.Object({ label: Type.String(), id: Type.String() })), target: Type.Optional(Type.Object({ label: Type.String(), id: Type.String() })),
        labels: Type.Optional(Type.Array(Type.String())), relTypes: Type.Optional(Type.Array(Type.String())),
        maxLen: Type.Optional(Type.Number()), depth: Type.Optional(Type.Number()), top: Type.Optional(Type.Number()), area: Type.Optional(Type.String()),
      })),
      purpose: Type.String(),
    }),
    run: (db, a, t, g, _e, ctx) => graphAlgorithm(db, a, t, g, ctx) },
];
