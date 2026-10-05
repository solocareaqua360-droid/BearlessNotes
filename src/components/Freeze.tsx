import { Fragment, ReactNode, Suspense } from 'react';

// A SUBTREE THAT IS KEPT BUT NOT RENDERED (2026-10-06, the preview plan's
// stage 1). The technique of react-freeze (which react-native-screens uses
// for freezeOnBlur), written out here rather than added as a dependency:
// while `freeze` is on, the child suspends on a promise that never
// settles, so React keeps the mounted tree - its state, its scroll, its
// data - hidden, and does not render it again until it thaws. A desk
// nobody is looking at then costs nothing when the rest of the app moves.
const never = { then() {} };

function Suspender({ freeze, children }: { freeze: boolean; children: ReactNode }) {
  if (freeze) throw never;
  return <Fragment>{children}</Fragment>;
}

export default function Freeze({ freeze, children }: { freeze: boolean; children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Suspender freeze={freeze}>{children}</Suspender>
    </Suspense>
  );
}
