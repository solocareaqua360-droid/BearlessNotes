import { useEffect, useState } from 'react';
import DeleteContentsSheet from './DeleteContentsSheet';
import type { BoardPlan, PlanItem } from '../utils/deletionPlan';

// «Що лишити?» as a function call, the way ask() is: any screen says what
// is about to go and gets back which of its contents should go with it
// (null = cancelled). Drawn once at the root (App.tsx / App.web.tsx).

type Pending = {
  title: string;
  subtitle: string;
  noun: string;
  plan: BoardPlan;
  note?: string;
  place?: string;
  withIt?: string;
  resolve: (chosen: PlanItem[] | null) => void;
};

let current: Pending | null = null;
let listener: (() => void) | null = null;

export function askWhatToKeep(options: Omit<Pending, 'resolve'>): Promise<PlanItem[] | null> {
  // One window at a time: a second question while one is open refuses.
  if (current) return Promise.resolve(null);
  return new Promise((resolve) => {
    current = { ...options, resolve };
    listener?.();
  });
}

export default function DeleteContentsHost() {
  const [, bump] = useState(0);
  useEffect(() => {
    listener = () => bump((n) => n + 1);
    return () => {
      listener = null;
    };
  }, []);
  if (!current) return null;
  const pending = current;
  const finish = (chosen: PlanItem[] | null) => {
    current = null;
    pending.resolve(chosen);
    bump((n) => n + 1);
  };
  return (
    <DeleteContentsSheet
      visible
      title={pending.title}
      subtitle={pending.subtitle}
      noun={pending.noun}
      plan={pending.plan}
      note={pending.note}
      place={pending.place}
      withIt={pending.withIt}
      onCancel={() => finish(null)}
      onConfirm={(chosen) => finish(chosen)}
    />
  );
}
