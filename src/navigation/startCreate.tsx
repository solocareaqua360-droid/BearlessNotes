import { useEffect, useRef } from 'react';
import { navigationRef } from '../navigationRef';
import { useNavDockBeads } from './navDock';

// MAKING A THING FROM THE START DESK. «Створити» does not skip the list:
// it goes to the thing's own list and presses that list's own «+» - the
// dock's right bead every list publishes - so each list makes its things
// exactly the way it always has and nothing here has to know how (the
// laptop's start page does the same: desktop/StartPage). The start desk
// is left the moment it is pressed, so the waiting is done by
// CreateWatcher, which stays mounted at the root.

type Job = { wanted: string; since: number; arrivedAt: number };
let pending: Job | null = null;

// `wanted` is the name the navigator reports once it stands on the list:
// the innermost focused route, which for a desk is the tab's own name (or
// the boards' inner list).
export function requestCreate(route: string, params: Record<string, unknown> | undefined, wanted: string) {
  if (!navigationRef.isReady()) return;
  pending = { wanted, since: Date.now(), arrivedAt: 0 };
  (navigationRef.navigate as (name: string, p?: unknown) => void)(route, params);
}

export function CreateWatcher() {
  const beads = useNavDockBeads();
  const beadsRef = useRef(beads);
  beadsRef.current = beads;
  useEffect(() => {
    const timer = setInterval(() => {
      const job = pending;
      if (!job) return;
      if (Date.now() - job.since > 4000) {
        pending = null;
        return;
      }
      const here = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
      if (here !== job.wanted) return;
      if (!job.arrivedAt) job.arrivedAt = Date.now();
      // A beat for the list to publish its beads.
      if (Date.now() - job.arrivedAt < 250) return;
      const right = beadsRef.current.right;
      if (!right || right.badge !== 'add-circle-outline') return;
      pending = null;
      right.onPress();
    }, 80);
    return () => clearInterval(timer);
  }, []);
  return null;
}
