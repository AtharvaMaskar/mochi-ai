import type { FalkorDB } from 'falkordb';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { Models } from '@earendil-works/pi-ai/models';
import type { Story } from '@mochi/contracts';
import type { MismatchEdge } from './rules.ts';

export type Db = Pick<FalkorDB, 'selectGraph' | 'list'>;
/** company / prev / scratch default to GRAPH; teams defaults to GRAPH.LIST filtered to team_*. */
export type DreamGraphs = { company: string; prev: string; scratch: string; teams?: string[] };
export type DreamModel = { models: Models; model: Model<Api> };
export type StepUsage = { input: number; output: number; calls: number };

export type DreamReport = {
  run_id: string; as_of: number; ms: number;
  retired: number; // facts retired: events + cluster moves + superseded mismatch edges
  retired_by: { events: number; clusters: number; mismatches: number };
  created: Record<string, number>;
  ingested: number; dropped: number;
  batches: { id: string; size: number }[];
  clusters: { count: number; ids: string[]; retired: number; receipts: { projection: string; algorithm: string } };
  mismatches: MismatchEdge[];
  suggestions: string[];
  policies: string[];
  usage: { extract: StepUsage; suggest: StepUsage; total: { input: number; output: number } };
  story_id: string | null; story: Story | null; story_errors: string[];
};
