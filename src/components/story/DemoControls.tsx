"use client";

/**
 * Hidden keyboard controls for recording the demo.
 *
 * The five beats have to be drivable without a visible control panel: the video
 * shows the shop, not the operator. These shortcuts call exactly the same story
 * functions the agent path uses, so nothing here is a shortcut around the
 * command layer.
 *
 *   Shift+E  the part delay lands
 *   Shift+R  run the schedule exploration, then present the plan
 *   Shift+A  apply the plan and notify the team
 *   Shift+0  reset to the calm shop
 */
import { useEffect } from "react";
import {
  applyAndNotify,
  proposal,
  reset,
  startEscalation,
  startExploration,
  useStory,
} from "@/store/storySlice";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
  );
}

/** Shift+0 arrives as ")" on several layouts, so match the physical key too. */
function matches(event: KeyboardEvent, code: string, keys: string[]): boolean {
  return event.code === code || keys.includes(event.key);
}

export const DEMO_SHORTCUTS = [
  { keys: "Shift + E", action: "Inject the part delay" },
  { keys: "Shift + R", action: "Run the schedule exploration" },
  { keys: "Shift + A", action: "Apply the plan and notify the team" },
  { keys: "Shift + 0", action: "Reset to the calm shop" },
] as const;

export function DemoControls() {
  const story = useStory();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.repeat || isTyping(event.target)) return;

      if (matches(event, "KeyE", ["E", "e"])) {
        event.preventDefault();
        startEscalation();
        return;
      }
      if (matches(event, "KeyR", ["R", "r"])) {
        event.preventDefault();
        // The search and the plan are one gesture for the operator: the agent
        // comes back with a proposal, it does not stop on a finished list.
        void startExploration().then((result) => {
          if (!result.cancelled) proposal();
        });
        return;
      }
      if (matches(event, "KeyA", ["A", "a"])) {
        event.preventDefault();
        applyAndNotify();
        return;
      }
      if (matches(event, "Digit0", ["0", ")"])) {
        event.preventDefault();
        reset();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="sr-only">
      <h2>Demo controls</h2>
      <ul>
        {DEMO_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.keys}>
            {shortcut.keys}: {shortcut.action}
          </li>
        ))}
      </ul>
      <p role="status">Current beat: {story}.</p>
    </div>
  );
}
