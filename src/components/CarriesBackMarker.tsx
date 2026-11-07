import { useEffect } from 'react';
import { setDockCarriesBack } from '../navigation/deskBeadsBus';

// Drawn by a dock that carries the way back as its right circle (the board's), so the bar at the top drops its own
// back button while it is up. Draws nothing.
export default function CarriesBackMarker() {
  useEffect(() => {
    setDockCarriesBack(true);
    return () => setDockCarriesBack(false);
  }, []);
  return null;
}
