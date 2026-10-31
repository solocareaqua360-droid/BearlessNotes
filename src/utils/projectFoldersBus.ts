import { useEffect } from 'react';

// «Додати папку» can be asked from the dock's «+» on the «Проєкти» screen,
// while the folder list that owns the picker is drawn per project page.
// One listener per project page, told which project the dock means.
type Listener = () => void;
const listeners = new Map<string, Listener>();

export function requestAddProjectFolder(groupId: string) {
  listeners.get(groupId)?.();
}

export function useAddProjectFolderRequest(groupId: string, open: Listener) {
  useEffect(() => {
    listeners.set(groupId, open);
    return () => {
      if (listeners.get(groupId) === open) listeners.delete(groupId);
    };
  }, [groupId, open]);
}
