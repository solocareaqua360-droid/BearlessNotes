import { useEffect, useRef, useState } from 'react';

// SOMETHING THAT LEAVES SOFTLY: stays drawn for `ms` after `visible` turns
// false, marked as leaving, so it can play its way out (data-fade-out)
// instead of vanishing. `ms` 0 is the old way - gone at once.
export function useLeaving(visible: boolean, ms: number): { mounted: boolean; leaving: boolean } {
  const [lingering, setLingering] = useState(false);
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible) {
      wasVisible.current = true;
      setLingering(false);
      return;
    }
    if (!wasVisible.current || ms <= 0) return;
    wasVisible.current = false;
    setLingering(true);
    const timer = setTimeout(() => setLingering(false), ms);
    return () => clearTimeout(timer);
  }, [visible, ms]);
  return { mounted: visible || lingering, leaving: !visible && lingering };
}
