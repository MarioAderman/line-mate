"use client";

import { useMemo } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useActiveScenario, useActiveSimulation, useWorkshopStore } from "@/store";
import { WebMcpBridge } from "@/webmcp";
import { ActivityFeed } from "./ActivityFeed";
import { Inspector } from "./Inspector";
import { MetricsRail } from "./MetricsRail";
import { ScenarioStrip } from "./ScenarioStrip";
import { ShiftBar } from "./ShiftBar";
import { WaitingColumn } from "./WaitingColumn";
import { WorkshopCanvas } from "./WorkshopCanvas";
import { floorAt } from "./floor";

/**
 * The one screen (docs/design-system.md layout):
 *
 *   shift clock / promise risk / run control
 *   waiting jobs | LIVE WORKSHOP FLOOR | inspector
 *   throughput / promises / wait / utilization / cost
 *   baseline – agent plan – human + agent | attributed activity
 */
export function ControlRoom() {
  const scenario = useActiveScenario();
  const simulation = useActiveSimulation();
  const playbackMinute = useWorkshopStore((s) => s.playbackMinute);
  const minute = playbackMinute ?? scenario.clock.startMinute;
  const floor = useMemo(() => floorAt(scenario, simulation, minute), [scenario, simulation, minute]);

  return (
    <ReactFlowProvider>
      <WebMcpBridge />
      <div className="flex min-h-screen w-full max-w-full flex-col gap-2 overflow-x-hidden p-2 lg:h-screen lg:overflow-hidden">
        <ShiftBar scenario={scenario} simulation={simulation} minute={minute} />

        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[232px_minmax(0,1fr)_300px]">
          <WaitingColumn scenario={scenario} simulation={simulation} floor={floor} />
          <main
            aria-label="Live workshop floor"
            className="hmi-panel relative min-h-[420px] min-w-0 lg:min-h-0"
          >
            <WorkshopCanvas scenario={scenario} simulation={simulation} floor={floor} />
          </main>
          <Inspector scenario={scenario} simulation={simulation} floor={floor} />
        </div>

        <MetricsRail scenario={scenario} simulation={simulation} />

        <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_420px]">
          <ScenarioStrip />
          <ActivityFeed />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
