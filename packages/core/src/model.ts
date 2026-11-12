import { z } from "zod";

export const STATUSES = ["backlog", "queue", "planning", "doing", "validation"] as const;
export const StatusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof StatusSchema>;

export const PLANNING_STEPS = ["scope", "extras", "mode", "plan", "awaiting-approval"] as const;
export const PlanningStepSchema = z.enum(PLANNING_STEPS);
export type PlanningStep = z.infer<typeof PlanningStepSchema>;

export const SubstatusSchema = z.enum(["waiting-user", "working", "blocked"]);

/** External tracker link: only http(s) is accepted. */
export const ExternalUrlSchema = z
  .string()
  .url()
  .refine((u) => /^https?:$/.test(new URL(u).protocol), "externalUrl must be http or https");

export const CardSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  scope: z.string().default(""),
  originalScope: z.string().optional(),
  extras: z.string().default(""),
  status: StatusSchema.default("queue"),
  substatus: SubstatusSchema.optional(),
  /** Why the card is blocked (the question for the user); only meaningful with substatus "blocked". */
  blockReason: z.string().optional(),
  planningStep: PlanningStepSchema.optional(),
  plan: z.string().optional(),
  planApproved: z.boolean().default(false),
  planSkipped: z.boolean().default(false),
  repo: z.string(),
  origin: z.string().optional(),
  branch: z.string().optional(),
  externalUrl: ExternalUrlSchema.optional(),
  /** Step-by-step checks the agent writes when the card reaches validation, for a human or an agent to run. */
  testSteps: z.string().optional(),
  /** Labels chosen by the user (free text); separate from the status marks the board sets itself. */
  tags: z.array(z.string()).default([]),
  /** Set when the card came from an import: where it was in the exporter's board (never approval or branch). */
  imported: z.object({ status: StatusSchema, planningStep: PlanningStepSchema.optional() }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Card = z.infer<typeof CardSchema>;

export const BoardSchema = z.object({
  version: z.literal(1).default(1),
  /** Project folders registered explicitly (cards also imply a project). */
  projects: z.array(z.string()).default([]),
  cards: z.array(CardSchema).default([]),
});
export type Board = z.infer<typeof BoardSchema>;

/** Trims, drops empty tags and duplicates (ignoring case), keeping the first spelling. */
export function normalizeTags(tags: readonly string[] = []): string[] {
  const seen = new Set<string>();
  return tags.map((t) => t.trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}
