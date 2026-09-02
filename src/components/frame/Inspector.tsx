"use client";

/**
 * The inspector — click is the commitment.
 *
 * Hover gives a light hint (`Popover`); a click opens this, anchored beside
 * what was clicked, and it stays until it is dismissed. It answers the four
 * questions the manager actually has — will the promise hold, who is on it,
 * where is the work up to, is the part here — and then lets them act, through
 * exactly the commands the agent calls: `update_work_item`, `route_work_item`.
 *
 * "Ask agent" copies a question instead of sending one: WebMCP is pull-only,
 * so the page can never push the agent. It hands the manager the sentence.
 *
 * The inspected entity is `store.selection`, so the Floor highlights whatever
 * is open here. Only the anchor rectangle lives in this module.
 */
import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { create } from "zustand";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Selection } from "@/domain";
import { useActiveScenario, useActiveSimulation, useWorkshopStore } from "@/store";
import { routeFromDrop } from "@/store/storySlice";
import { eligibleResourceIds } from "@/components/story/planCards";
import { showToast } from "@/components/story/Toast";
import {
  askAgentQuestion,
  inspectResource,
  inspectTechnician,
  inspectWorkItem,
  type Inspection,
  type StepFact,
} from "@/components/story/inspect";
import { Vehicle } from "@/components/vehicles";

const WIDTH = 268;
const GAP = 10;
/** Conservative box used to clamp the anchor; the panel scrolls past it. */
const ESTIMATED_HEIGHT = 300;
const INSPECTOR_ID = "frame-inspector";

/* ------------------------------------------------------------- the anchor */

interface AnchorPoint {
  /** Viewport px of the left edge the panel would like. */
  x: number;
  y: number;
}

interface AnchorState {
  anchor: AnchorPoint | null;
  /** The Move… picker is open in the actions bar. */
  moving: boolean;
  /** The agent question is on screen, ready to copy by hand if need be. */
  asking: boolean;
  setAnchor(anchor: AnchorPoint | null): void;
  setMoving(moving: boolean): void;
  setAsking(asking: boolean): void;
}

const useAnchorStore = create<AnchorState>((set) => ({
  anchor: null,
  moving: false,
  asking: false,
  setAnchor: (anchor) => set({ anchor, moving: false, asking: false }),
  setMoving: (moving) => set({ moving, asking: false }),
  setAsking: (asking) => set({ asking, moving: false }),
}));

/** The element that opened it, so Escape can hand focus back. */
let opener: HTMLElement | null = null;

function sameTarget(a: Selection | null, b: Selection): boolean {
  return a !== null && a.kind === b.kind && a.id === b.id;
}

/**
 * Opens the inspector for `target`, anchored beside `element`. Clicking the
 * same thing again closes it, so one gesture both opens and dismisses.
 */
export function openInspector(target: Selection, element: HTMLElement): void {
  const store = useWorkshopStore.getState();
  if (sameTarget(store.selection, target)) {
    closeInspector();
    return;
  }
  const rect = element.getBoundingClientRect();
  // To the right of the anchor when it fits, otherwise to its left.
  const right = rect.right + GAP;
  const x = right + WIDTH <= window.innerWidth - GAP ? right : rect.left - WIDTH - GAP;
  opener = element;
  useAnchorStore.getState().setAnchor({ x, y: rect.top });
  store.setPopover(null);
  store.select(target);
}

export function closeInspector(): void {
  useAnchorStore.getState().setAnchor(null);
  useWorkshopStore.getState().select(null);
}

/* --------------------------------------------------------------- fragments */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[66px_1fr] gap-2 border-b border-dashed border-rule px-2.5 py-1.5 last:border-b-0">
      <span className="hmi-label pt-[2px] text-[0.55rem]">{label}</span>
      <div className="min-w-0 text-[0.72rem] leading-snug text-ink">{children}</div>
    </div>
  );
}

function TechBadge({ initial }: { initial: string }) {
  return (
    <span
      aria-hidden="true"
      className="mr-1 inline-grid h-4 w-4 place-items-center rounded-full border-[1.4px] border-ink bg-sheet align-[-2px] font-mono text-[0.5rem] font-semibold text-ink"
    >
      {initial}
    </span>
  );
}

function Bar({ value, tone = "ink" }: { value: number; tone?: "ink" | "agent" | "alarm" }) {
  return (
    <span className="mt-1 block h-[5px] border border-rule bg-paper">
      <span
        className="block h-full"
        style={{
          width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`,
          background: tone === "agent" ? "var(--agent)" : tone === "alarm" ? "var(--alarm)" : "var(--ink)",
        }}
      />
    </span>
  );
}

function Step({ step }: { step: StepFact }) {
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span
        className={
          step.state === "done"
            ? "truncate text-ink-3 line-through"
            : step.state === "live"
              ? "truncate font-medium text-agent"
              : "truncate text-ink"
        }
      >
        {step.operation}
      </span>
      <span
        className={`shrink-0 font-mono text-[0.6rem] ${
          step.state === "live" ? "text-agent" : "text-ink-3"
        }`}
      >
        {step.detail}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------- the actions */

function Actions({ inspection, minute }: { inspection: Inspection; minute: number }) {
  const scenario = useActiveScenario();
  const story = useWorkshopStore((s) => s.story);
  const run = useWorkshopStore((s) => s.run);
  const moving = useAnchorStore((s) => s.moving);
  const setMoving = useAnchorStore((s) => s.setMoving);
  const asking = useAnchorStore((s) => s.asking);
  const setAsking = useAnchorStore((s) => s.setAsking);
  const question = askAgentQuestion(inspection, scenario, minute);

  const isJob = inspection.kind === "workItem";
  // In beat 4 a routing decision belongs to the draft, and `routeFromDrop`
  // puts it there. There is no draft equivalent for a priority bump, so rather
  // than quietly edit the protected baseline the button steps aside.
  const drafting = story === "proposal";
  const topPriority = isJob && inspection.priority === 1;

  /**
   * Put the question on screen first, then try the clipboard.
   *
   * The copy is the convenience, not the feature: `writeText` can reject on a
   * permission, and in an automated or unfocused window it can hang without
   * ever settling — so nothing the manager needs may depend on it. The
   * question is rendered where it can be read and selected either way, and
   * the toast only ever confirms a copy that really happened.
   */
  function ask() {
    setAsking(true);
    copyQuestion(question);
  }

  if (asking) {
    return (
      <div className="border-t border-rule px-2.5 py-2">
        <p className="hmi-label mb-1.5 text-[0.55rem]">Ask the agent</p>
        <p className="max-h-[124px] select-all overflow-y-auto border-l-2 border-agent bg-agent-wash px-2 py-1.5 text-[0.68rem] leading-snug text-ink">
          {question}
        </p>
        <div className="mt-1.5 flex gap-1">
          <button
            type="button"
            className="hmi-button !px-2 !py-1 !text-[0.6rem]"
            onClick={() => copyQuestion(question)}
          >
            Copy
          </button>
          <button
            type="button"
            className="hmi-button !border-rule !px-2 !py-1 !text-[0.6rem] !text-ink-2"
            onClick={() => setAsking(false)}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (moving && isJob) {
    const targets = eligibleResourceIds(scenario, inspection.id);
    return (
      <div className="border-t border-rule px-2.5 py-2">
        <p className="hmi-label mb-1.5 text-[0.55rem]">
          {drafting ? "Move in the draft" : "Move to"}
        </p>
        <div className="flex flex-wrap gap-1">
          {targets.map((resourceId) => (
            <button
              key={resourceId}
              type="button"
              className="hmi-button !px-2 !py-1 !text-[0.6rem]"
              onClick={() => {
                routeFromDrop(inspection.id, resourceId, 1);
                setMoving(false);
              }}
            >
              {scenario.resources.find((r) => r.id === resourceId)?.name ?? resourceId}
            </button>
          ))}
          <button
            type="button"
            className="hmi-button !px-2 !py-1 !text-[0.6rem]"
            onClick={() => {
              routeFromDrop(inspection.id, null, null);
              setMoving(false);
            }}
          >
            Any open bay
          </button>
          <button
            type="button"
            className="hmi-button !border-rule !px-2 !py-1 !text-[0.6rem] !text-ink-2"
            onClick={() => setMoving(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5 border-t border-rule px-2.5 py-2">
      {isJob && (
        <>
          <button
            type="button"
            className="hmi-button hmi-button--primary !px-2 !py-1 !text-[0.6rem]"
            disabled={topPriority || drafting}
            title={
              topPriority
                ? "Already first in line"
                : drafting
                  ? "The plan is still a draft — apply it first"
                  : "Move this job up the queue"
            }
            onClick={() =>
              run(
                "update_work_item",
                { workItemId: inspection.id, changes: { priority: Math.max(1, inspection.priority - 1) } },
                "human",
              )
            }
          >
            Priority ↑
          </button>
          <button
            type="button"
            className="hmi-button !px-2 !py-1 !text-[0.6rem]"
            onClick={() => setMoving(true)}
          >
            Move…
          </button>
        </>
      )}
      <button type="button" className="hmi-button !px-2 !py-1 !text-[0.6rem]" onClick={ask}>
        Ask agent
      </button>
    </div>
  );
}

/**
 * Fire-and-forget: confirm only a copy that resolved, and never block the UI
 * on a promise that may never settle.
 */
function copyQuestion(question: string): void {
  const pending = navigator.clipboard?.writeText(question);
  if (!pending) return;
  pending
    .then(() => showToast("Question copied — paste it to the agent in ChatGPT."))
    .catch(() => {
      /* The question is already on screen; nothing to report. */
    });
}

/* ------------------------------------------------------------- the panel */

export function Inspector() {
  const selection = useWorkshopStore((s) => s.selection);
  const anchor = useAnchorStore((s) => s.anchor);
  const playbackMinute = useWorkshopStore((s) => s.playbackMinute);
  const scenario = useActiveScenario();
  const simulation = useActiveSimulation();
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);

  const minute = playbackMinute ?? scenario.clock.startMinute;
  const inspection: Inspection | null = !selection
    ? null
    : selection.kind === "workItem"
      ? inspectWorkItem(scenario, simulation, minute, selection.id)
      : selection.kind === "resource"
        ? inspectResource(scenario, simulation, minute, selection.id)
        : inspectTechnician(scenario, simulation, minute, selection.id);

  const dismiss = useCallback(() => closeInspector(), []);

  useEffect(() => {
    if (!inspection) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = opener;
      dismiss();
      target?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      const node = event.target as Node | null;
      if (!node) return;
      // The opener toggles itself; anything else outside dismisses.
      if (panelRef.current?.contains(node) || opener?.contains(node)) return;
      dismiss();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [inspection, dismiss]);

  // Clamped with CSS rather than measured: the width is fixed and the side was
  // chosen at the anchor, so this cannot overflow the pane in either axis. The
  // top is kept in a custom property so the height can be bounded by where the
  // panel actually sits — a tall body then scrolls instead of running off the
  // bottom of the pane.
  const left = anchor
    ? `clamp(${GAP}px, ${anchor.x}px, calc(100vw - ${WIDTH + GAP}px))`
    : undefined;
  const top = anchor
    ? `clamp(${GAP}px, ${anchor.y}px, calc(100vh - ${ESTIMATED_HEIGHT + GAP}px))`
    : undefined;

  return (
    // mode="wait": clicking a second thing must never leave two panels on the
    // sheet at once — the first leaves, then the next arrives.
    <AnimatePresence mode="wait">
      {inspection && anchor && (
        <motion.div
          key={`${inspection.kind}:${inspection.id}`}
          ref={panelRef}
          id={INSPECTOR_ID}
          role="dialog"
          aria-label={`${headline(inspection)} details`}
          tabIndex={-1}
          initial={{ opacity: 0, y: reduced ? 0 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : 4 }}
          transition={{ duration: reduced ? 0 : 0.14, ease: "easeOut" }}
          style={
            {
              "--inspector-top": top,
              left,
              top: "var(--inspector-top)",
              width: WIDTH,
              maxHeight: `calc(100vh - var(--inspector-top) - ${GAP}px)`,
            } as CSSProperties
          }
          className="fixed z-[55] flex flex-col overflow-hidden rounded-sheet border border-ink bg-sheet shadow-[0_4px_14px_color-mix(in_srgb,var(--ink)_18%,transparent)]"
        >
          <header className="flex items-baseline justify-between gap-2 border-b border-rule bg-paper-2 px-2.5 py-1.5">
            <span className="hmi-label truncate !text-ink">{headline(inspection)}</span>
            <StatusChip inspection={inspection} />
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <Body inspection={inspection} />
          </div>

          <Actions inspection={inspection} minute={minute} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function headline(inspection: Inspection): string {
  if (inspection.kind === "workItem") return `${inspection.vehicle} · ${inspection.id}`;
  if (inspection.kind === "resource") return inspection.name;
  return inspection.name;
}

function StatusChip({ inspection }: { inspection: Inspection }) {
  if (inspection.kind === "workItem") {
    const { state, dueLabel } = inspection.promise;
    if (state === "none") return <span className="font-mono text-[0.6rem] text-ink-3">walk-in</span>;
    return (
      <span
        className={`shrink-0 font-mono text-[0.62rem] ${state === "missed" ? "text-alarm" : "text-ink"}`}
      >
        {state === "kept" ? "✓" : state === "missed" ? "✗" : "·"} {dueLabel}
      </span>
    );
  }
  if (inspection.kind === "resource") {
    return (
      <span
        className={`hmi-label shrink-0 text-[0.55rem] ${
          inspection.status === "blocked" || inspection.status === "down" ? "!text-alarm" : ""
        }`}
      >
        {inspection.typeLabel}
      </span>
    );
  }
  return <span className="hmi-label shrink-0 text-[0.55rem]">Technician</span>;
}

function Body({ inspection }: { inspection: Inspection }) {
  if (inspection.kind === "workItem") {
    return (
      <>
        <Row label="Job">
          <span className="flex items-center gap-1.5">
            <Vehicle kind={inspection.glyph} stroke="var(--ink)" fill="var(--sheet)" width={30} />
            <span className="min-w-0 truncate">{inspection.jobName}</span>
          </span>
        </Row>
        <Row label="Promise">
          <span className={inspection.promise.state === "missed" ? "text-alarm" : undefined}>
            {inspection.promise.dueLabel ?? "—"} · {inspection.promise.detail}
          </span>
        </Row>
        <Row label="Tech">
          {inspection.technician ? (
            <>
              <TechBadge initial={inspection.technician.initial} />
              {inspection.technician.name} ·{" "}
              <span className="text-ink-2">{inspection.technician.skills.join(", ")}</span>
            </>
          ) : (
            <span className="text-ink-2">not scheduled today</span>
          )}
        </Row>
        <Row label="Steps">
          <span className="flex flex-col gap-0.5">
            {inspection.steps.map((step) => (
              <Step key={step.index} step={step} />
            ))}
          </span>
        </Row>
        <Row label="Parts">
          <span className={inspection.parts.waiting ? "text-warn" : undefined}>
            {inspection.parts.label}
          </span>
        </Row>
        <Row label="Route">
          {inspection.route} · <span className="text-ink-2">priority {inspection.priority}</span>
        </Row>
      </>
    );
  }

  if (inspection.kind === "resource") {
    return (
      <>
        <Row label="Status">
          <span
            className={
              inspection.status === "blocked" || inspection.status === "down" ? "text-alarm" : undefined
            }
          >
            {inspection.statusLabel}
          </span>
        </Row>
        <Row label="Now">
          {inspection.current ? (
            <>
              <span className="flex items-center gap-1.5">
                <Vehicle
                  kind={inspection.current.glyph}
                  stroke="var(--ink)"
                  fill="var(--sheet)"
                  width={30}
                />
                <span className="min-w-0 truncate">
                  {inspection.current.vehicle} · {inspection.current.operation}
                </span>
              </span>
              <span className="mt-0.5 block font-mono text-[0.6rem] text-ink-2">
                {inspection.current.detail} min · ends {inspection.current.endsAt} ·{" "}
                {inspection.current.technicianName}
              </span>
              <Bar value={inspection.current.progress} />
            </>
          ) : (
            <span className="text-ink-2">no job in progress</span>
          )}
        </Row>
        {inspection.parts.waiting && (
          <Row label="Part">
            <span className="text-warn">{inspection.parts.label}</span>
          </Row>
        )}
        <Row label="Next">
          {inspection.next.length === 0 ? (
            <span className="text-ink-2">nothing queued</span>
          ) : (
            <span className="flex flex-col gap-0.5">
              {inspection.next.map((job) => (
                <span key={job.workItemId} className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{job.vehicle}</span>
                  <span className="shrink-0 font-mono text-[0.6rem] text-ink-3">{job.startsAt}</span>
                </span>
              ))}
            </span>
          )}
        </Row>
        <Row label="Load">
          {inspection.utilization === null ? (
            <span className="text-ink-2">not simulated</span>
          ) : (
            <>
              <span className="font-mono">
                {Math.round(inspection.utilization * 100)}% of the shift
                {inspection.jobsToday === null ? "" : ` · ${inspection.jobsToday} jobs`}
              </span>
              <Bar value={inspection.utilization} />
            </>
          )}
        </Row>
      </>
    );
  }

  return (
    <>
      <Row label="Now">
        <TechBadge initial={inspection.initial} />
        {inspection.where}
      </Row>
      <Row label="Skills">{inspection.skills.join(", ")}</Row>
      <Row label="Shift">
        <span className="font-mono">{inspection.shift}</span>
      </Row>
      <Row label="Load">
        {inspection.utilization === null ? (
          <span className="text-ink-2">not simulated</span>
        ) : (
          <>
            <span className="font-mono">
              {Math.round(inspection.utilization * 100)}% of the shift
              {inspection.jobsToday === null ? "" : ` · ${inspection.jobsToday} jobs`}
            </span>
            <Bar value={inspection.utilization} />
          </>
        )}
      </Row>
    </>
  );
}
