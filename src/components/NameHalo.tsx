import { useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

// UNDER THE NAME, A HALO OF THE GROUND'S OWN COLOUR (2026-10-29, the user, of the name's plate at the top left: «прибери
// контур і затемнення... не обрізай рівно по краю капсули, а трохи розмаж. Ми робимо підкладку, щоб текст залишався
// читабельним, і капсула своїм виглядом не забирала вагу столу на свою сторону»). Dense under the text, gone at its edge -
// on an empty ground it cannot be seen at all (it IS the ground), over a list it quietly puts out what passes under the name.
//
// TRIED FIRST AND TAKEN OUT («погано»): a bare blur feathered by four layers. Android's blur (Dimezis BlurView inside
// expo-blur) lays a blue-noise texture over every blur - a drawable in the library, not something JS can switch off - so
// without a coat over it the plate showed as a grainy oval on black. A real blurred plate with a soft edge needs a native
// change (a mask and no noise) - an APK.
export default function NameHalo({ color, spread = 12 }: { color: string; spread?: number }) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const id = `halo${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View
      pointerEvents="none"
      style={[styles.fill, { left: -spread, right: -spread, top: -spread / 2, bottom: -spread / 2 }]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
      }}
    >
      {box && (
        <Svg width={box.w} height={box.h}>
          <Defs>
            <RadialGradient id={id} cx="0.5" cy="0.5" rx="0.5" ry="0.5">
              {/* 0.4 of the first density (the user, 2026-10-29: «на 50», then «ще відсотків на 20»). */}
              <Stop offset="0" stopColor={color} stopOpacity={0.38} />
              <Stop offset="0.62" stopColor={color} stopOpacity={0.34} />
              <Stop offset="0.82" stopColor={color} stopOpacity={0.18} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={box.w / 2} cy={box.h / 2} rx={box.w / 2} ry={box.h / 2} fill={`url(#${id})`} />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute' },
});
