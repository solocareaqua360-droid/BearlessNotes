import { useColorScheme } from 'react-native';

// The soft palette, as mindEva's theme/soft.ts has it on the phone - kept
// as plain values here (sketchEva has no theme settings of its own yet).
export type SoftTokens = {
  dark: boolean;
  bg: string;
  card: string;
  chrome: string;
  ink: string;
  ink2: string;
  ink3: string;
  fill: string;
  fillSolid: string;
  line: string;
  accent: string;
  shadow: string;
  popShadow: string;
};

const LIGHT: SoftTokens = {
  dark: false,
  bg: '#F6F5F2',
  card: '#FFFFFF',
  chrome: '#FFFFFF',
  ink: '#1E1E1C',
  ink2: '#6E6D68',
  ink3: '#A9A79F',
  fill: 'rgba(30,30,28,0.05)',
  fillSolid: '#EBEAE7',
  line: 'rgba(30,30,28,0.08)',
  accent: '#D9793F',
  shadow: '0px 1px 2px rgba(30,30,28,0.05), 0px 10px 24px -12px rgba(30,30,28,0.18)',
  popShadow: '0px 1px 2px rgba(30,30,28,0.06), 0px 18px 40px -14px rgba(30,30,28,0.32)',
};

const DARK: SoftTokens = {
  dark: true,
  bg: '#000000',
  card: '#242426',
  chrome: '#242426',
  ink: '#F1F0EC',
  ink2: '#A3A29D',
  ink3: '#6A6964',
  fill: 'rgba(255,255,255,0.09)',
  fillSolid: '#1C1C1E',
  line: 'rgba(255,255,255,0.10)',
  accent: '#E89A62',
  shadow: '0px 0px 0px 1px rgba(255,255,255,0.09)',
  popShadow: '0px 0px 0px 1px rgba(255,255,255,0.12)',
};

export function useSoft(): SoftTokens {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}

// The paper a drawing lies on (mindEva's theme.paper).
export function useTheme(): { paper: { fill: string; ink: string } } {
  return useColorScheme() === 'dark'
    ? { paper: { fill: '#1C1C1E', ink: '#ECEDEF' } }
    : { paper: { fill: '#FFFFFF', ink: '#111827' } };
}
