/**
 * Canonical domain vocabulary (architecture v0.1).
 *
 * Zod schemas are the single source of truth: every type in the app is
 * inferred from them, and every command validates its payload against them
 * before touching state. Nothing here imports React, Zustand, React Flow or
 * WebMCP — it is the bottom of the dependency graph.
 *
 * Time is expressed in minutes of day (14:15 = 855) so the fixture, the
 * engine and the UI all speak the same clock.
 */
import { z } from "zod";

export const RESOURCE_TYPES = ["bay", "station"] as const;
export const ResourceTypeSchema = z.enum(RESOURCE_TYPES);
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const RESOURCE_STATUSES = ["idle", "working", "blocked", "down"] as const;
export const ResourceStatusSchema = z.enum(RESOURCE_STATUSES);
export type ResourceStatus = z.infer<typeof ResourceStatusSchema>;

export const PositionSchema = z.object({ x: z.number(), y: z.number() });
export type Position = z.infer<typeof PositionSchema>;

/**
 * A place where work happens: a bay or the diagnostics station. `capacity`
 * is parallel slots, `availability` a deterministic derating of step
 * durations, and `blockedUntilMinute` models "waiting for a part" so the
 * baseline can start with one bay out of action.
 */
export const ResourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: ResourceTypeSchema,
  position: PositionSchema,
  capacity: z.number().int().min(1).max(8),
  availability: z.number().gt(0).max(1),
  costPerHour: z.number().min(0),
  status: ResourceStatusSchema,
  blockedUntilMinute: z.number().int().min(0).nullable(),
  blockingReason: z.string().nullable(),
});
export type Resource = z.infer<typeof ResourceSchema>;

export const SKILLS = [
  "general",
  "oil",
  "tires",
  "brakes",
  "suspension",
  "diagnostics",
  "electrical",
] as const;
export const SkillSchema = z.enum(SKILLS);
export type Skill = z.infer<typeof SkillSchema>;

export const TechnicianSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  skills: z.array(SkillSchema).min(1),
  shiftStartMinute: z.number().int().min(0),
  shiftEndMinute: z.number().int().min(0),
  costPerHour: z.number().min(0),
});
export type Technician = z.infer<typeof TechnicianSchema>;

export const ProcessStepSchema = z.object({
  operation: z.string().min(1),
  durationMinutes: z.number().int().min(1).max(600),
  requiredResourceType: ResourceTypeSchema,
  requiredSkill: SkillSchema,
});
export type ProcessStep = z.infer<typeof ProcessStepSchema>;

export const WORK_ITEM_STATUSES = [
  "waiting",
  "processing",
  "completed",
  "blocked",
] as const;
export const WorkItemStatusSchema = z.enum(WORK_ITEM_STATUSES);
export type WorkItemStatus = z.infer<typeof WorkItemStatusSchema>;

/** 1 = most urgent. Ties break on due time, arrival, then id. */
export const PrioritySchema = z.number().int().min(1).max(5);

/**
 * A vehicle and the job attached to it. `route` is the human/agent
 * scheduling decision: pin the job to one resource and optionally to a
 * queue position. `null` means "any eligible resource, by priority".
 */
export const RouteSchema = z.object({
  resourceId: z.string().min(1).nullable(),
  position: z.number().int().min(1).nullable(),
});
export type Route = z.infer<typeof RouteSchema>;

export const WorkItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  vehicle: z.string().min(1),
  priority: PrioritySchema,
  arrivalMinute: z.number().int().min(0),
  /** Customer promise. `null` = no promise (walk-in / no due time). */
  dueMinute: z.number().int().min(0).nullable(),
  revenue: z.number().min(0),
  steps: z.array(ProcessStepSchema).min(1).max(6),
  status: WorkItemStatusSchema,
  route: RouteSchema,
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

export const ConstraintsSchema = z.object({
  overtimeAllowed: z.boolean(),
  maxTechnicians: z.number().int().min(1),
  cancellationsAllowed: z.boolean(),
});
export type Constraints = z.infer<typeof ConstraintsSchema>;

export const ClockSchema = z.object({
  dayLabel: z.string().min(1),
  /** Minutes of day at which the scenario opens (the "now" of the story). */
  startMinute: z.number().int().min(0).max(1440),
  /** Closing time. Nothing completes after this unless overtime is allowed. */
  endMinute: z.number().int().min(0).max(1440),
});
export type Clock = z.infer<typeof ClockSchema>;

export const ScenarioSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(""),
    /** ISO-8601. Fixtures freeze it so renders stay deterministic. */
    createdAt: z.string().min(1),
    /** Scenario this one was cloned from, if any. */
    parentId: z.string().nullable().default(null),
    clock: ClockSchema,
    resources: z.array(ResourceSchema).min(1),
    technicians: z.array(TechnicianSchema).min(1),
    workItems: z.array(WorkItemSchema),
    constraints: ConstraintsSchema,
  })
  .refine((s) => s.clock.endMinute > s.clock.startMinute, {
    message: "clock.endMinute must be after clock.startMinute",
  });
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ACTORS = ["human", "agent", "simulation"] as const;
export const ActorSchema = z.enum(ACTORS);
/** Who caused a change. Drives the attribution strip in the UI. */
export type Actor = z.infer<typeof ActorSchema>;

export const ChangeSchema = z.object({
  id: z.string().min(1),
  /** Epoch ms from the command context clock (injectable for tests). */
  at: z.number(),
  actor: ActorSchema,
  command: z.string().min(1),
  scenarioId: z.string().min(1),
  summary: z.string().min(1),
  before: z.unknown(),
  after: z.unknown(),
});
export type Change = z.infer<typeof ChangeSchema>;

export const SelectionSchema = z.object({
  kind: z.enum(["resource", "technician", "workItem"]),
  id: z.string().min(1),
});
export type Selection = z.infer<typeof SelectionSchema>;

/* --------------------------------------------------------------- lookups */

export function findResource(scenario: Scenario, id: string): Resource | undefined {
  return scenario.resources.find((r) => r.id === id);
}

export function findTechnician(
  scenario: Scenario,
  id: string,
): Technician | undefined {
  return scenario.technicians.find((t) => t.id === id);
}

export function findWorkItem(scenario: Scenario, id: string): WorkItem | undefined {
  return scenario.workItems.find((w) => w.id === id);
}

/** Technicians able to perform a step. */
export function skilledTechnicians(
  scenario: Scenario,
  skill: Skill,
): Technician[] {
  return scenario.technicians.filter((t) => t.skills.includes(skill));
}

/** Human-readable clock, e.g. 855 -> "14:15". */
export function formatMinute(minute: number): string {
  const clamped = ((Math.round(minute) % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Structural checks the zod schemas cannot express (cross-references). */
export function validateScenario(scenario: Scenario): string[] {
  const problems: string[] = [];
  const resourceIds = new Set<string>();
  for (const resource of scenario.resources) {
    if (resourceIds.has(resource.id)) {
      problems.push(`Duplicate resource id "${resource.id}".`);
    }
    resourceIds.add(resource.id);
  }
  const technicianIds = new Set<string>();
  for (const tech of scenario.technicians) {
    if (technicianIds.has(tech.id)) {
      problems.push(`Duplicate technician id "${tech.id}".`);
    }
    technicianIds.add(tech.id);
  }
  if (scenario.technicians.length > scenario.constraints.maxTechnicians) {
    problems.push(
      `Scenario has ${scenario.technicians.length} technicians but allows ${scenario.constraints.maxTechnicians}.`,
    );
  }
  const workIds = new Set<string>();
  for (const item of scenario.workItems) {
    if (workIds.has(item.id)) problems.push(`Duplicate work item id "${item.id}".`);
    workIds.add(item.id);

    if (item.route.resourceId !== null) {
      const target = findResource(scenario, item.route.resourceId);
      if (!target) {
        problems.push(
          `Work item "${item.id}" is routed to unknown resource "${item.route.resourceId}".`,
        );
      } else if (!item.steps.some((s) => s.requiredResourceType === target.type)) {
        problems.push(
          `Work item "${item.id}" is routed to ${target.name}, but none of its steps can run on a ${target.type}.`,
        );
      }
    }
    for (const step of item.steps) {
      if (skilledTechnicians(scenario, step.requiredSkill).length === 0) {
        problems.push(
          `Work item "${item.id}" needs skill "${step.requiredSkill}" but no technician has it.`,
        );
      }
      if (!scenario.resources.some((r) => r.type === step.requiredResourceType)) {
        problems.push(
          `Work item "${item.id}" needs a ${step.requiredResourceType} but the scenario has none.`,
        );
      }
    }
  }
  return problems;
}

/* ---------------------------------------------------- story & planning */

export const VIEWS = ["board", "floor"] as const;
export const ViewSchema = z.enum(VIEWS);
/** Which of the two frozen views the human is looking at. */
export type View = z.infer<typeof ViewSchema>;

export const STORY_STATES = ["calm", "escalation", "running", "proposal", "resolved"] as const;
export const StoryStateSchema = z.enum(STORY_STATES);
/** The five beats of the demo (dev/active/foundation/video-concept.md). */
export type StoryState = z.infer<typeof StoryStateSchema>;

/**
 * A deterministic disturbance applied to a scenario. The demo's only kind is
 * a part delay that blocks a bay until a given minute.
 */
export const DisruptionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("part_delay"),
  resourceId: z.string().min(1),
  untilMinute: z.number().int().min(0),
  reason: z.string().min(1),
  /** Work item sitting in the bay, marked blocked while the part is missing. */
  workItemId: z.string().min(1).nullable(),
  /** The work that remains once the part lands (replaces the item's first step). */
  remainingStep: z
    .object({ operation: z.string().min(1), durationMinutes: z.number().int().min(1).max(600) })
    .nullable()
    .default(null),
});
export type Disruption = z.infer<typeof DisruptionSchema>;

/** One schedule change; the vocabulary shared by demo beats, plans and tools. */
export const PlanChangeSchema = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("update_work_item"),
    workItemId: z.string().min(1),
    priority: PrioritySchema,
  }),
  z.object({
    command: z.literal("route_work_item"),
    workItemId: z.string().min(1),
    resourceId: z.string().min(1).nullable(),
    position: z.number().int().min(1).nullable(),
  }),
]);
export type PlanChange = z.infer<typeof PlanChangeSchema>;

export const PlanSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  changes: z.array(PlanChangeSchema).min(1),
});
export type Plan = z.infer<typeof PlanSchema>;

export const NOTE_CHANNELS = ["slack", "email", "sms"] as const;
export const NoteChannelSchema = z.enum(NOTE_CHANNELS);
export type NoteChannel = z.infer<typeof NoteChannelSchema>;

/** A note "sent" to the team. Simulated: it is state the UI renders, nothing leaves the page. */
export const ShiftNoteSchema = z.object({
  id: z.string().min(1),
  at: z.number(),
  author: ActorSchema,
  scenarioId: z.string().min(1),
  text: z.string().min(1).max(400),
  channels: z.array(NoteChannelSchema).min(1),
  recipients: z.array(z.string().min(1)).default([]),
});
export type ShiftNote = z.infer<typeof ShiftNoteSchema>;

/* ------------------------------------------------------------ exploration */

/** One candidate schedule evaluated by `explore_schedules`. */
export interface ExplorationCandidate {
  id: string;
  label: string;
  changes: PlanChange[];
  /** Share of seeded replications that kept every promise (0..1). */
  promisesMetRate: number;
  /** Promises kept in the deterministic (no-jitter) run. */
  promisesMet: number;
  promisedTotal: number;
  completed: number;
  constraintViolations: string[];
}

export interface ExplorationSummary {
  scenarioId: string;
  seed: number;
  replications: number;
  candidatesEvaluated: number;
  /** candidatesEvaluated × replications — the "scenarios run" counter. */
  runsExecuted: number;
  best: ExplorationCandidate | null;
  /** Ranked, bounded (≤ 8). */
  top: ExplorationCandidate[];
}

/** UI-facing progress while an exploration is running, chunk by chunk. */
export interface ExplorationRow {
  id: string;
  label: string;
  /** 0..1 */
  progress: number;
  promisesMet: number | null;
  promisesMetRate: number | null;
}

export interface ExplorationProgress {
  status: "idle" | "running" | "done";
  runsExecuted: number;
  runsPlanned: number;
  rows: ExplorationRow[];
  best: ExplorationCandidate | null;
}

export const STORY_TRANSITIONS: Record<StoryState, StoryState[]> = {
  calm: ["escalation"],
  escalation: ["running", "calm"],
  running: ["proposal", "escalation"],
  proposal: ["resolved", "running"],
  resolved: ["calm"],
};

export function canTransition(from: StoryState, to: StoryState): boolean {
  return STORY_TRANSITIONS[from].includes(to);
}

