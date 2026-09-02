"use client";

/**
 * The fixed-viewport sheet.
 *
 * The two panes the demo is recorded in (1160×865 laptop, 1567×995 monitor)
 * never scroll: the header, the promises strip and the live strip are fixed
 * bands and the drawing field takes the rest. The active view fills the field;
 * the alert card and the title block sit in its bottom band.
 */
import { useEffect, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { VIEWPORTS, useWorkshopStore } from "@/store";
import { AlertCard } from "./AlertCard";
import { ClockTicker } from "./ClockTicker";
import { Cover } from "./Cover";
import { Header } from "./Header";
import { LiveStrip } from "./LiveStrip";
import { Popover } from "./Popover";
import { DemoControls } from "@/components/story/DemoControls";
import { StoryLayer } from "@/components/story/StoryLayer";
import { PromisesStrip } from "./PromisesStrip";
import { TitleBlock } from "./TitleBlock";

interface Props {
  /** Rendered when `store.view === "board"`. */
  board: ReactNode;
  /** Rendered when `store.view === "floor"`. */
  floor: ReactNode;
}

export function Shell({ board, floor }: Props) {
  const view = useWorkshopStore((s) => s.view);
  const cover = useWorkshopStore((s) => s.cover);
  const viewport = useWorkshopStore((s) => s.viewport);
  const setViewport = useWorkshopStore((s) => s.setViewport);
  const preset = VIEWPORTS[viewport];

  // QA affordance: `?viewport=monitor` renders the second frozen pane size so
  // the headless screenshot pass can check both without a control on screen.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("viewport");
    if (wanted === "monitor" || wanted === "laptop") setViewport(wanted);
  }, [setViewport]);

  return (
    <div className="flex h-screen w-full items-center justify-center overflow-hidden">
      <div
        data-slot="shell"
        data-viewport={viewport}
        style={{ width: preset.width, height: preset.height, maxWidth: "100vw", maxHeight: "100vh" }}
        className="flex flex-col overflow-hidden border-x border-rule"
      >
        <AnimatePresence initial={false}>
          {cover ? (
            <Cover key="cover" />
          ) : (
            <>
              <ClockTicker />
              <Header />
              <PromisesStrip />
              <div data-slot="field" className="relative min-h-0 flex-1">
                {view === "board" ? board : floor}
                <AlertCard />
                <TitleBlock />
                <StoryLayer />
              </div>
              <LiveStrip />
            </>
          )}
        </AnimatePresence>
      </div>
      <Popover />
      <DemoControls />
    </div>
  );
}
