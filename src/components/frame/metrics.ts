/**
 * The fixed vertical budget of the shared frame, in px.
 *
 * The two frozen panes (1160×865 and 1567×995) never scroll, so the header,
 * the promises strip and the live strip are constants and the drawing field
 * takes whatever is left. Views read these instead of guessing.
 */
export const FRAME = {
  header: 60,
  promises: 84,
  live: 42,
  /**
   * Bottom band of the drawing field kept clear for the alert card (left) and
   * the title block (right). Views pad by this so nothing important sits
   * underneath them, and the composition does not jump between story states.
   */
  band: 104,
} as const;

/**
 * Popover geometry. The width is fixed and the height is budgeted rather than
 * measured, so the popover can be clamped inside the pane with pure CSS.
 */
export const POPOVER_GAP = 8;
export const POPOVER_WIDTH = 296;
export const POPOVER_ESTIMATED_HEIGHT = 176;
export const POPOVER_ID = "frame-popover";
