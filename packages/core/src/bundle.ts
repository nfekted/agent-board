import { z } from "zod";
import { ExternalUrlSchema, PlanningStepSchema, StatusSchema } from "./model.js";

/** What travels between people: the work definition, never the local state (branch, approval, paths). */
export const BundleSchema = z.object({
  kanbanBundle: z.union([z.literal(1), z.literal(2)]),
  name: z.string(),
  exportedAt: z.string(),
  cards: z.array(
    z.object({
      title: z.string().min(1),
      scope: z.string().default(""),
      extras: z.string().default(""),
      externalUrl: z.string().optional(),
      tags: z.array(z.string()).default([]),
      /** Markdown content of the plan (the plan file path is local to the exporter). */
      plan: z.string().optional(),
      /** Name of the project folder in the exporter's board (not a path). Absent in version 1 files. */
      project: z.string().optional(),
      /** Where the card was in the exporter's board. */
      from: z.object({ status: StatusSchema, planningStep: PlanningStepSchema.optional() }).optional(),
    }),
  ),
});
export type Bundle = z.infer<typeof BundleSchema>;

/** Title slug used in file names: every character outside A-Za-z0-9._- becomes "_". */
export const slug = (title: string) => title.replace(/[^A-Za-z0-9._-]/g, "_");

export const validLink = (url?: string) => (url && ExternalUrlSchema.safeParse(url).success ? url : undefined);
