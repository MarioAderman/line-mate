"use client";

/**
 * SHEET 0 — the cover of the drawing set (Mario-approved mockup, 2026-08-31).
 *
 * Not a login, not a gate: the title page a real set of plans opens with. It
 * fills the shell's sheet on a fresh load and leaves for good on the CTA (or
 * Enter). The WebMCP bridge is mounted behind it, so an agent can link while
 * the cover is still up; a demo reset never brings it back.
 */
import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useWorkshopStore } from "@/store";

const GRID =
  "linear-gradient(color-mix(in srgb, var(--rule) 45%, transparent) 1px, transparent 1px)," +
  "linear-gradient(90deg, color-mix(in srgb, var(--rule) 45%, transparent) 1px, transparent 1px)";

/** The V3-icon car as a dimensioned plate drawing: one rocker height, open
 * wheel arches, wheels tangent to the dashed datum. */
function CarPlate() {
  return (
    <svg
      viewBox="0 0 520 300"
      aria-hidden="true"
      className="pointer-events-none absolute top-[12%] right-[2.5%] w-[55%]"
    >
      <path d="M20 60h480M20 130h480M20 200h480M120 20v260M300 20v260M420 20v260" stroke="var(--rule)" strokeWidth="1" />
      <path d="M36 246h456" stroke="var(--ink-3)" strokeWidth="1.2" strokeDasharray="10 6" />
      <path
        d="M470 210 V172 Q470 150 446 146 L398 140 L354 88 Q346 76 330 76 H244 Q230 76 224 84 L172 138 L82 148 Q68 150 68 162 V210 H120 M180 210 H366 M426 210 H470"
        fill="none"
        stroke="var(--agent)"
        strokeWidth="3.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M300 80 V208 M350 92 L390 138" fill="none" stroke="var(--agent)" strokeWidth="2.2" />
      <circle cx="150" cy="216" r="30" fill="none" stroke="var(--agent)" strokeWidth="3.4" />
      <circle cx="150" cy="216" r="9" fill="none" stroke="var(--agent)" strokeWidth="2" />
      <path d="M150 202v28M136 216h28" stroke="var(--agent)" strokeWidth="1.2" />
      <circle cx="396" cy="216" r="30" fill="none" stroke="var(--agent)" strokeWidth="3.4" />
      <circle cx="396" cy="216" r="9" fill="none" stroke="var(--agent)" strokeWidth="2" />
      <path d="M396 202v28M382 216h28" stroke="var(--agent)" strokeWidth="1.2" />
      <path d="M150 250v14M396 250v14M136 264h28M382 264h28" stroke="var(--ink)" strokeWidth="1.4" />
      <text x="150" y="284" textAnchor="middle" fill="var(--ink-2)" style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 1 }}>
        &#8960; 60
      </text>
      <text x="396" y="284" textAnchor="middle" fill="var(--ink-2)" style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 1 }}>
        &#8960; 60
      </text>
    </svg>
  );
}

export function Cover() {
  const dismiss = useWorkshopStore((s) => s.dismissCover);
  const reduced = useReducedMotion();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Enter") {
        event.preventDefault();
        useWorkshopStore.getState().dismissCover();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const rise = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, ease: "easeOut" as const, delay },
        };

  return (
    <motion.div
      // An overlay, not a flex sibling: while it fades out the board is
      // already underneath instead of stacking below it.
      className="absolute inset-0 z-50 overflow-hidden bg-paper"
      style={{ backgroundImage: GRID, backgroundSize: "32px 32px" }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
      transition={{ duration: reduced ? 0 : 0.25, ease: [0.2, 0, 0, 1] }}
    >
      {/* sheet margin frame with corner ticks */}
      <div aria-hidden className="pointer-events-none absolute inset-[18px] border-[1.5px] border-ink">
        <span className="absolute -top-2 -left-2 h-3.5 w-3.5 border-t-[1.5px] border-l-[1.5px] border-ink" />
        <span className="absolute -right-2 -bottom-2 h-3.5 w-3.5 border-r-[1.5px] border-b-[1.5px] border-ink" />
      </div>

      <div className="absolute top-[30px] left-[34px] font-mono text-[11px] tracking-[.14em] text-ink-2">
        <b className="font-semibold text-ink">SHEET 0</b> · COVER — READ BEFORE OPENING THE FLOOR
      </div>

      <CarPlate />

      <div className="absolute top-[24%] left-[6%] w-[46%]">
        <motion.p {...rise(0)} className="mb-2.5 font-mono text-[12px] tracking-[.22em] text-agent uppercase">
          Friday · 14:15 · six promises before closing
        </motion.p>
        <motion.h1
          {...rise(0.06)}
          className="font-mono leading-[.95] font-semibold tracking-[-0.02em] text-ink"
          style={{ fontSize: "clamp(56px, 8vw, 112px)" }}
        >
          LINE-<span className="text-agent">MATE</span>
        </motion.h1>
        <motion.div {...rise(0.12)} className="mt-5 mb-4 w-[120px] border-t-[3px] border-ink" />
        <motion.p {...rise(0.18)} className="max-w-[46ch] text-[16px] leading-relaxed text-ink-2">
          <b className="font-medium text-ink">One more technician on the line.</b> You keep authority.
        </motion.p>
        <motion.div {...rise(0.24)} className="mt-8">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex cursor-pointer items-center gap-3 border-[1.5px] border-ink bg-ink px-6 py-3.5 font-mono text-[14px] font-semibold tracking-[.12em] text-sheet uppercase transition-[transform,box-shadow] duration-100 hover:translate-x-[2px] hover:translate-y-[2px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent"
            style={{ boxShadow: "4px 4px 0 var(--agent)" }}
          >
            Let&apos;s get started <span className="text-[17px] leading-none">&rarr;</span>
          </button>
        </motion.div>
      </div>

      {/* title block, same grammar as the app's */}
      <div className="absolute right-[34px] bottom-[32px] w-[380px] border-[1.5px] border-ink bg-sheet font-mono text-[10.5px]">
        <div className="grid grid-cols-[1fr_1.2fr_.6fr]">
          <div className="border-r border-rule px-2 py-1.5">
            <span className="block text-[9px] tracking-[.1em] text-ink-2">PROJECT</span>
            <span className="font-semibold text-ink">LINE-MATE</span>
          </div>
          <div className="border-r border-rule px-2 py-1.5">
            <span className="block text-[9px] tracking-[.1em] text-ink-2">SHEET</span>
            <span className="font-semibold text-ink">0 · COVER</span>
          </div>
          <div className="px-2 py-1.5">
            <span className="block text-[9px] tracking-[.1em] text-ink-2">REV</span>
            <span className="font-semibold text-ink">A</span>
          </div>
        </div>
        <div className="flex justify-between border-t border-rule px-2 py-1.5">
          <span>
            <span className="block text-[9px] tracking-[.1em] text-ink-2">DRAWN BY</span>
            <span className="font-semibold text-ink">MANAGER + AGENT</span>
          </span>
          <span>
            <span className="block text-[9px] tracking-[.1em] text-ink-2">SCALE</span>
            <span className="font-semibold text-ink">1 SHIFT</span>
          </span>
        </div>
      </div>
    </motion.div>
  );
}
