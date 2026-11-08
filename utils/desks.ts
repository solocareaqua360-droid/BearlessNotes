import { router } from "expo-router";

import type { DeskKey } from "@/components/ui/DeskDock";

const PATH: Record<DeskKey, string> = { home: "/", continue: "/continue", channels: "/channels" };

// Moving between desks: from the start desk a desk is pushed on top; from one
// desk to another it replaces it; back to the start desk drops everything above it.
export function goDesk(from: DeskKey, to: DeskKey) {
  if (from === to) return;
  if (to === "home") return router.dismissAll();
  if (from === "home") return router.push(PATH[to] as any);
  router.replace(PATH[to] as any);
}
