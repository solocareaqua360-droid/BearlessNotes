import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import SaveRing from '../SaveRing';
import { isVoicedOffline, isVoicing, subscribeVoice, subscribeVoiced, voiceState, type VoiceState } from '../../utils/thoughtVoice';

// THE LISTEN BUTTON SAYS WHAT IT HAS (2026-10-15, the user: «на кнопці з озвучкою треба якийсь індикатор що цей
// текст вже озвучений і є офлайн. А етап озвучування треба окантовкою на кнопці, як це було з індикатором
// синхронізації сторінки документа»). Two marks, laid over any listen button:
//  - a small round badge in three states, the user's own (2026-10-15: «якщо не скачане то стрілка вниз, якщо
//    скачане дві галочки, якщо качається то одна галочка»): an arrow down - not kept yet; one tick - Gemini is making
//    the voice now; two ticks - every piece is kept on the phone in the chosen voice and plays with no network;
//  - the save ring's travelling arc round the button's outline while the voice is being made.
export function useListenMarks(items: { id: string; text: string }[]): { offline: boolean; voicing: boolean; making: boolean } {
  const [offline, setOffline] = useState(false);
  const [making, setMaking] = useState(false);
  const [v, setV] = useState<VoiceState>(voiceState);
  useEffect(() => subscribeVoice(setV), []);
  const key = items.map((i) => `${i.id}:${i.text.length}`).join('|');
  useEffect(() => {
    let live = true;
    const check = () => {
      setMaking(items.some((i) => isVoicing(i.id)));
      return Promise.all(items.map((i) => isVoicedOffline(i.text)))
        .then((all) => live && setOffline(all.length > 0 && all.every(Boolean)))
        .catch(() => {});
    };
    check();
    const off = subscribeVoiced(check);
    return () => {
      live = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const voicing = v.playing && v.source === null && !!v.thoughtId && items.some((i) => i.id === v.thoughtId);
  return { offline, voicing, making };
}

// `voicing`: waiting for the first sound (the ring runs); `making`: any of its pieces still being made (one tick).
export function ListenMarks({ offline, voicing, making, ink, ground, radius }: { offline: boolean; voicing: boolean; making?: boolean; ink: string; ground: string; radius?: number }) {
  const tick = voicing || !!making;
  return (
    <>
      <SaveRing saving={voicing} color={ink} radius={radius} />
      <View pointerEvents="none" style={[styles.badge, { backgroundColor: ink, borderColor: ground }]}>
        <Ionicons name={(tick ? 'checkmark' : offline ? 'checkmark-done' : 'arrow-down') as never} size={tick || !offline ? 9 : 10} color={ground} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
