import type { ReactNode } from 'react';

// The laptop's morph is a view transition (utils/morph.web): a page is just
// its page here.
export default function MorphFrame({ children }: { morphKey: string; navigation: unknown; children: ReactNode }) {
  return <>{children}</>;
}
