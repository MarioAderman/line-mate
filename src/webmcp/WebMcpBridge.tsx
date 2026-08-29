"use client";

import { useEffect } from "react";
import { runCommand, useWorkshopStore } from "@/store";
import { registerWebMcpTools } from "./adapter";

/**
 * Mounts the WebMCP adapter for the lifetime of the page.
 *
 * Renders nothing: it exists so the adapter stays a leaf of the dependency
 * graph and the rest of the UI never imports it.
 */
export function WebMcpBridge() {
  const setMcpStatus = useWorkshopStore((state) => state.setMcpStatus);

  useEffect(() => {
    let mounted = true;
    let dispose = () => {};

    void registerWebMcpTools((name, input) => runCommand(name, input, "agent")).then(
      (registration) => {
        if (!mounted) {
          registration.dispose();
          return;
        }
        dispose = registration.dispose;
        setMcpStatus(registration.status, registration.toolCount);
      },
    );

    return () => {
      mounted = false;
      dispose();
    };
  }, [setMcpStatus]);

  return null;
}
