import { useEffect, useState } from 'react';
import { useThoughts } from '../../hooks/useThoughts';
import { setThoughtListener, type CaptureRequest } from '../../utils/thoughtBus';
import ThoughtCapture from './ThoughtCapture';
import ThoughtsSpace from './ThoughtsSpace';
import VoicePlayer from './VoicePlayer';
import ThoughtView from './ThoughtView';
import { speakThoughts } from '../../utils/thoughtVoice';
import { cardTitle, voiceTextOf } from './thoughtText';

// The thought windows, mounted once at the app's root (App.tsx) and opened through utils/thoughtBus - from the share
// sheet, the living folder, the space's own «+». The lists are read only while one of them is open.
export default function ThoughtsHost() {
  const [capture, setCapture] = useState<CaptureRequest | null>(null);
  const [space, setSpace] = useState(false);
  // A card opened from the island.
  const [reader, setReader] = useState<string | null>(null);
  const { themes, thoughts, countOf } = useThoughts(capture !== null || space || reader !== null);
  useEffect(
    () =>
      setThoughtListener({
        capture: (req) => setCapture(req),
        space: () => setSpace(true),
        reader: (id) => setReader(id),
      }),
    []
  );
  return (
    <>
      <ThoughtsSpace
        visible={space}
        themes={themes}
        thoughts={thoughts}
        countOf={countOf}
        onCatch={(themeId) => setCapture({ themeId })}
        onClose={() => setSpace(false)}
      />
      <ThoughtCapture
        visible={capture !== null}
        source={capture?.source}
        images={capture?.images}
        themes={themes}
        countOf={countOf}
        onElsewhere={capture?.onElsewhere}
        themeId={capture?.themeId}
        onClose={() => setCapture(null)}
      />
      <ThoughtView
        thought={thoughts.find((t) => t.id === reader) ?? null}
        onListen={(t) => speakThoughts([{ title: cardTitle(t) || 'Думка', text: voiceTextOf(t), thoughtId: t.id }]).catch(() => {})}
        onClose={() => setReader(null)}
      />
      <VoicePlayer />
    </>
  );
}
