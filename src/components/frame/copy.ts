/** Shared demo copy helpers for the frame and the views. */

/** "Waiting for a water pump — supplier ETA 15:30" -> "Water pump". */
export function partName(reason: string): string {
  const match = /^waiting for (?:a |an |the )?(.+?)(?:\s*[—–-]\s|$)/i.exec(reason.trim());
  const part = (match?.[1] ?? reason).trim();
  return part.charAt(0).toUpperCase() + part.slice(1);
}

/** ["White SUV", "Black wagon"] -> "White SUV and Black wagon". */
export function vehicleList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
