"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { formatMinute, type Resource, type Scenario } from "@/domain";
import type { SimulationResult } from "@/simulation";
import { useWorkshopStore } from "@/store";
import { DRAG_MIME } from "./WaitingColumn";
import type { BayView, FloorView } from "./floor";

interface Props {
  scenario: Scenario;
  simulation: SimulationResult | null;
  floor: FloorView;
}

/* ----------------------------------------------------------- node data */

type ResourceNodeData = {
  resource: Resource;
  view: BayView;
  selected: boolean;
  agentLooking: boolean;
  isBottleneck: boolean;
  onSelect: () => void;
  onDrop: (workItemId: string) => void;
};

type PortalNodeData = { label: string; count: number; caption: string };

type ResourceNode = Node<ResourceNodeData, "resource">;
type PortalNode = Node<PortalNodeData, "portal">;
type FloorNode = ResourceNode | PortalNode;

/**
 * A bay or the diagnostics station. Fully custom on purpose (CLAUDE.md
 * gotchas): the default React Flow rectangle would make the floor generic.
 */
function ResourceNodeView({ data }: NodeProps<ResourceNode>) {
  const { resource, view, selected, agentLooking, isBottleneck } = data;
  const tone =
    view.status === "blocked" || view.status === "down"
      ? "border-coral"
      : view.status === "working"
        ? "border-amber"
        : "border-line-strong";
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${resource.name}, ${view.statusLabel}${view.current ? `, ${view.current.workItem.vehicle}` : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          data.onSelect();
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault();
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(DRAG_MIME);
        if (id) {
          e.preventDefault();
          data.onDrop(id);
        }
      }}
      className={`w-[228px] cursor-pointer border-2 bg-slate text-porcelain shadow-[0_2px_0_#05090c] ${tone} ${
        selected ? "outline outline-2 outline-offset-2 outline-coolant" : ""
      } ${agentLooking ? "shadow-[0_0_0_3px_rgba(185,167,255,0.45)]" : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center justify-between border-b border-line bg-graphite-2 px-2.5 py-1">
        <span className="font-display text-base font-semibold uppercase tracking-wider">{resource.name}</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-porcelain-dim">
          {isBottleneck && <span className="text-amber">bottleneck</span>}
          {agentLooking && <span className="text-agent">agent</span>}
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${
              view.status === "working"
                ? "bg-amber"
                : view.status === "idle"
                  ? "bg-coolant"
                  : "bg-coral"
            }`}
          />
        </span>
      </div>
      <div className="px-2.5 py-2">
        {view.current ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium">{view.current.workItem.vehicle}</span>
              <span className="font-mono text-[11px] text-porcelain-dim">{view.current.technicianName}</span>
            </div>
            <div className="truncate text-xs text-porcelain-dim">{view.current.operation}</div>
            <div
              className="mt-1.5 h-1.5 w-full bg-graphite-2"
              role="progressbar"
              aria-valuenow={Math.round(view.current.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full bg-amber" style={{ width: `${Math.max(2, view.current.progress * 100)}%` }} />
            </div>
            <div className="mt-1 font-mono text-[11px] text-porcelain-dim">done {view.current.endsAt}</div>
          </>
        ) : (
          <div className={`text-xs ${view.status === "blocked" ? "text-coral" : "text-porcelain-dim"}`}>
            {view.statusLabel}
            {view.status === "blocked" && resource.blockingReason && (
              <div className="mt-0.5 text-[11px] leading-snug text-porcelain-dim">{resource.blockingReason}</div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line px-2.5 py-1 font-mono text-[11px] text-porcelain-dim">
        <span>queue {view.queued.length}</span>
        <span>{view.queued.map((w) => w.vehicle.split(" ")[0]).slice(0, 3).join(" · ")}</span>
      </div>
    </div>
  );
}

function PortalNodeView({ data }: NodeProps<PortalNode>) {
  return (
    <div className="w-[120px] border border-dashed border-line-strong bg-graphite-2 px-2.5 py-2 text-center">
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="hmi-label">{data.label}</div>
      <div className="font-mono text-2xl leading-tight">{data.count}</div>
      <div className="text-[11px] text-porcelain-dim">{data.caption}</div>
    </div>
  );
}

const nodeTypes = { resource: ResourceNodeView, portal: PortalNodeView };

/* --------------------------------------------------------------- canvas */

export function WorkshopCanvas({ scenario, simulation, floor }: Props) {
  const select = useWorkshopStore((s) => s.select);
  const selection = useWorkshopStore((s) => s.selection);
  const agentAttention = useWorkshopStore((s) => s.agentAttention);
  const run = useWorkshopStore((s) => s.run);

  const onDrop = useCallback(
    (resourceId: string, workItemId: string) => {
      run("route_work_item", { workItemId, resourceId, scenarioId: scenario.id }, "human");
      select({ kind: "workItem", id: workItemId });
    },
    [run, scenario.id, select],
  );

  const built = useMemo<FloorNode[]>(() => {
    const bays = scenario.resources.filter((r) => r.type === "bay");
    const stations = scenario.resources.filter((r) => r.type === "station");
    const resourceNode = (r: Resource, x: number, y: number): ResourceNode => ({
      id: r.id,
      type: "resource",
      position: { x, y },
      draggable: false,
      data: {
        resource: r,
        view: floor.bays[r.id],
        selected: selection?.kind === "resource" && selection.id === r.id,
        agentLooking: agentAttention?.kind === "resource" && agentAttention.id === r.id,
        isBottleneck: simulation?.totals.bottleneck?.id === r.id,
        onSelect: () => select({ kind: "resource", id: r.id }),
        onDrop: (workItemId) => onDrop(r.id, workItemId),
      },
    });
    const nodes: FloorNode[] = [
      {
        id: "intake",
        type: "portal",
        position: { x: 0, y: 90 },
        draggable: false,
        data: { label: "Waiting", count: floor.waiting.length, caption: `at ${formatMinute(floor.minute)}` },
      },
      // One column of equipment, intake on the left, delivery on the right:
      // every edge is a clean left-to-right run with nothing crossing a node.
      ...bays.map((r, i) => resourceNode(r, 240, i * 150)),
      ...stations.map((r, i) => resourceNode(r, 240, (bays.length + i) * 150)),
      {
        id: "delivery",
        type: "portal",
        position: { x: 620, y: 90 },
        draggable: false,
        data: { label: "Delivered", count: floor.completed.length, caption: "keys back to customers" },
      },
    ];
    return nodes;
  }, [scenario, floor, simulation, selection, agentAttention, select, onDrop]);

  const [nodes, setNodes, onNodesChange] = useNodesState<FloorNode>(built);
  useEffect(() => setNodes(built), [built, setNodes]);

  const edges = useMemo<Edge[]>(() => {
    const list: Edge[] = [];
    for (const r of scenario.resources) {
      const active = floor.bays[r.id]?.status === "working";
      list.push({
        id: `in-${r.id}`,
        source: "intake",
        target: r.id,
        type: "smoothstep",
        className: active ? "flowing" : undefined,
      });
      list.push({
        id: `out-${r.id}`,
        source: r.id,
        target: "delivery",
        type: "smoothstep",
        className: active ? "flowing" : undefined,
      });
    }
    return list;
  }, [scenario.resources, floor]);

  return (
    <ReactFlow<FloorNode>
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.4}
      maxZoom={1.6}
      nodesConnectable={false}
      elementsSelectable={false}
      // Selection is handled at the flow level: React Flow only gives nodes
      // pointer events when it knows they are interactive.
      onNodeClick={(_, node) => {
        if (node.type === "resource") select({ kind: "resource", id: node.id });
      }}
      onPaneClick={() => select(null)}
    >
      <Background variant={BackgroundVariant.Lines} gap={28} color="#16232c" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}
