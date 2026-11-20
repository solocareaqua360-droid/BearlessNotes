import { View } from 'react-native';
import { useIsDropOver } from '../hooks/useCardCarry';
import { useSoft } from '../theme/soft';

// The slight change of colour on the folder a carried card would land in (hooks/useCardCarry, the phone). No outline - the
// user: «підсвічування - це значить, що папка повинна трішки змінити свій колір». Laid over the row, takes no touch.
// `inset` lets a borderless row's tint reach a little past its edges (negative = outward).
export default function DropTint({ path, radius = 14, inset = 0 }: { path: string; radius?: number; inset?: number }) {
  const on = useIsDropOver(path);
  const S = useSoft();
  if (!on) return null;
  return <View pointerEvents="none" style={{ position: 'absolute', left: inset, right: inset, top: 0, bottom: 0, borderRadius: radius, backgroundColor: S.accent, opacity: 0.14 }} />;
}
