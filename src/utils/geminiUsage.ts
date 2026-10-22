import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// WHAT GEMINI HAS COST (2026-10-15, the user: «лічильник витрачених грошей, збережених хвилин аудіо та лічильник
// запитів на озвучку ... в налаштуваннях»). Every answer Gemini gives carries usageMetadata - the tokens it counted
// in and out - and the price list turns those into dollars. An ESTIMATE kept on this phone: the bill itself is in
// Google AI Studio (Billing), and requests made from another device are not here.
// Prices per 1M tokens, paid tier, Standard (ai.google.dev/gemini-api/docs/pricing, read 2026-10-15).
// A TTS model's output is audio tokens (25 a second); a model not in the list is counted at gemini-3.6-flash's.
const PRICES: Record<string, { input: number; output: number }> = {
  // 3.8's prices double from 2027-01-01 ($1 / $18).
  'gemini-3.8-flash-tts': { input: 0.5, output: 9.0 },
  'gemini-3.1-flash-tts-preview': { input: 1.0, output: 20.0 },
  'gemini-2.5-flash-preview-tts': { input: 0.5, output: 10.0 },
  'gemini-3.6-flash': { input: 0.75, output: 3.75 },
};
const FALLBACK = PRICES['gemini-3.6-flash'];

export type GeminiUsage = {
  since: number;
  costUsd: number;
  // Voicing: requests sent, and the seconds of sound that came back (kept or not).
  ttsRequests: number;
  ttsSeconds: number;
  // Text: summaries, questions, «що в цьому відео».
  textRequests: number;
};
const KEY = 'gemini.usage';
const EMPTY = (): GeminiUsage => ({ since: Date.now(), costUsd: 0, ttsRequests: 0, ttsSeconds: 0, textRequests: 0 });

let cache: GeminiUsage | null = null;
const listeners = new Set<(u: GeminiUsage) => void>();
let chain: Promise<void> = Promise.resolve();

async function load(): Promise<GeminiUsage> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? { ...EMPTY(), ...JSON.parse(raw) } : EMPTY();
  } catch {
    cache = EMPTY();
  }
  return cache!;
}

type Meta = { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined;

// What one answer cost, in dollars, by the same price list (the assistant shows it under its field).
export function costOfGemini(model: string, usage: Meta): number {
  const price = PRICES[model] ?? FALLBACK;
  const tokensIn = usage?.promptTokenCount ?? 0;
  const tokensOut = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  return (tokensIn * price.input + tokensOut * price.output) / 1e6;
}

// One answer from Gemini. Writes are queued one behind another so two answers landing together both count.
export function recordGemini(kind: 'tts' | 'text', model: string, usage: Meta, ttsSeconds = 0) {
  chain = chain.then(async () => {
    const u = { ...(await load()) };
    const price = PRICES[model] ?? FALLBACK;
    const tokensIn = usage?.promptTokenCount ?? 0;
    // A voice's audio tokens when Gemini does not say: 25 a second.
    const tokensOut = (usage?.candidatesTokenCount ?? (kind === 'tts' ? Math.round(ttsSeconds * 25) : 0)) + (usage?.thoughtsTokenCount ?? 0);
    u.costUsd += (tokensIn * price.input + tokensOut * price.output) / 1e6;
    if (kind === 'tts') {
      u.ttsRequests += 1;
      u.ttsSeconds += ttsSeconds;
    } else u.textRequests += 1;
    cache = u;
    listeners.forEach((l) => l(u));
    await AsyncStorage.setItem(KEY, JSON.stringify(u)).catch(() => {});
  });
}

export async function resetGeminiUsage() {
  cache = EMPTY();
  listeners.forEach((l) => l(cache!));
  await AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
}

export function useGeminiUsage(): GeminiUsage | null {
  const [u, setU] = useState<GeminiUsage | null>(cache);
  useEffect(() => {
    listeners.add(setU);
    load().then(setU);
    return () => {
      listeners.delete(setU);
    };
  }, []);
  return u;
}
