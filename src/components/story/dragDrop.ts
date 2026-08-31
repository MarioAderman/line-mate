/**
 * The drag contract between a proposal card and a drop target (a Board lane, a
 * Floor bay). Kept tiny and framework-free so the view streams can accept a
 * drop without importing anything from the story panels.
 *
 * Drop targets: call `readWorkItemDrag(event.dataTransfer)` and hand the
 * payload to `routeFromDrop` — never to `route_work_item` directly:
 *
 *   const drag = readWorkItemDrag(event.dataTransfer);
 *   if (drag) routeFromDrop(drag.workItemId, resourceId, 1);
 *
 * `routeFromDrop` knows the difference the drop target should not have to: in
 * beat 4 a drop edits the unapplied draft, and at any other moment it is an
 * ordinary human routing decision on the world, through the command layer.
 */
export const WORK_ITEM_DRAG_TYPE = "application/x-workshop-work-item";

export interface WorkItemDrag {
  workItemId: string;
  /** Where the plan wanted it, so a target can show what it would replace. */
  fromResourceId: string | null;
}

export function writeWorkItemDrag(dataTransfer: DataTransfer, payload: WorkItemDrag): void {
  dataTransfer.setData(WORK_ITEM_DRAG_TYPE, JSON.stringify(payload));
  // Plain text keeps the drag legible to anything that only reads text/plain.
  dataTransfer.setData("text/plain", payload.workItemId);
  dataTransfer.effectAllowed = "move";
}

export function readWorkItemDrag(dataTransfer: DataTransfer | null): WorkItemDrag | null {
  if (!dataTransfer) return null;
  const raw = dataTransfer.getData(WORK_ITEM_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as WorkItemDrag).workItemId === "string"
    ) {
      const payload = parsed as WorkItemDrag;
      return {
        workItemId: payload.workItemId,
        fromResourceId: payload.fromResourceId ?? null,
      };
    }
  } catch {
    // A malformed payload is simply not a work item drag.
  }
  return null;
}
