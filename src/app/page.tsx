import { ShiftBoard } from "@/components/board";
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
        floor={
          <div data-slot="floor" className="flex h-full items-center justify-center">
            <p className="hmi-label">Isometric shop — in build</p>
          </div>
        }
      />
    </>
  );
}
