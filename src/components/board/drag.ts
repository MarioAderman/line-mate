/**
 * What the Board knows while a job is in the air.
 *
 * The wire format and the landing are not ours: a drag is written with
 * `writeWorkItemDrag` and a drop goes to `routeFromDrop`, which alone decides
 * whether it edits the proposal draft or routes the world. What lives here is
 * only the presentation question the sheet has to answer mid-drag — which
 * lanes can take this job, and which must step back.
 *
 * Eligibility itself comes from `eligibleResourceIds` in the story stream. We
 * import it; forking it would let the Board offer a drop the command refuses.
 */
import type { Scenario } from "@/domain";
import { WORK_ITEM_DRAG_TYPE } from "@/components/story/dragDrop";
import { eligibleResourceIds } from "@/components/story/planCards";

export interface BoardDrag {
  workItemId: string;
  /** Where it came from, so the source lane can show the gap it left. */
  fromResourceId: string | null;
  /** Resource ids that can actually run this job's steps. */
  eligible: string[];
}

export type DropState = "none" | "eligible" | "ineligible" | "source";

export function beginDrag(
  scenario: Scenario,
  workItemId: string,
  fromResourceId: string | null,
): BoardDrag {
  return { workItemId, fromResourceId, eligible: eligibleResourceIds(scenario, workItemId) };
}

/**
 * How a resource should draw itself while a drag is happening: highlighted when
 * it can take the job, stepped back when it cannot, and marked as the place the
 * job is leaving so the move reads as a move.
 */
export function dropStateFor(drag: BoardDrag | null, resourceId: string): DropState {
  if (!drag) return "none";
  if (drag.fromResourceId === resourceId) return "source";
  return drag.eligible.includes(resourceId) ? "eligible" : "ineligible";
}

/**
 * Whether to let a drag hover here at all.
 *
 * A drag that started on the Board carries its eligibility, so an impossible
 * lane can refuse the pointer outright. A drag that started somewhere else — a
 * proposal card, the Floor — is opaque until it lands: `dragover` may read the
 * data *types* but never the data. So an unknown drag is welcomed, and
 * `canRoute` decides once the payload is actually readable.
 */
export function acceptsHover(drag: BoardDrag | null, resourceId: string, dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer?.types.includes(WORK_ITEM_DRAG_TYPE)) return false;
  return dropStateFor(drag, resourceId) !== "ineligible";
}

/**
 * The authority on a drop: can this resource actually run this job's steps?
 * Asked of the payload at drop time, so a card dragged in from another stream
 * is judged by the same rule as a block dragged across the Board — and the
 * Board never asks the command layer for a route it would refuse.
 */
export function canRoute(scenario: Scenario, workItemId: string, resourceId: string): boolean {
  return eligibleResourceIds(scenario, workItemId).includes(resourceId);
}
