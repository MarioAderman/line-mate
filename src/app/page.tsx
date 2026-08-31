import { ShiftBoard } from "@/components/board";
import { FloorSlot } from "@/components/floor";
import { Shell } from "@/components/frame";
import { WebMcpBridge } from "@/webmcp";

/**
 * The one page: the WebMCP bridge (headless) plus the fixed-viewport sheet.
 * The shell picks the view from the store; the Isometric Shop lands in the
 * `floor` slot when that stream ships.
 */
export default function Home() {
  return (
    <>
      <WebMcpBridge />
      <Shell
        board={<ShiftBoard />}
        floor={<FloorSlot />}
      />
    </>
  );
}
