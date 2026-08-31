"use client";

/**
 * Measures the shell's drawing field and hands the exact pixel box to the
 * Isometric Shop, which draws edge to edge. The field is the only thing that
 * knows its size (the fixed bands eat the rest of the frozen pane), so the
 * floor reads it instead of guessing.
 */
import { useEffect, useRef, useState } from "react";
import { IsometricShop } from "./IsometricShop";

export function FloorSlot() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setSize({ width: Math.floor(box.width), height: Math.floor(box.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-slot="floor" className="h-full w-full">
      {size.width > 0 && size.height > 0 && (
        <IsometricShop width={size.width} height={size.height} />
      )}
    </div>
  );
}
