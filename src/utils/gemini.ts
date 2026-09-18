// Talks to Google's Generative Language API directly from the device,
// with the user's OWN key (see geminiKey.ts) - this app ships no key of
// its own, and never will (see the project's "before publishing"
// memory). One call, one answer: no chat session, no memory between
// calls, because nothing built so far needs it - "спитати" is one tick
// on one message (see the project's chat-plan memory), not a
// conversation with Gemini.

// If Google renames or retires this model, a call fails with the API's
// own error text (surfaced to the user as-is, see askGemini below)
// rather than a silent wrong answer - change this constant and nothing
// else if that happens.
const GEMINI_MODEL = 'gemini-2.0-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export class GeminiError extends Error {}

export async function askGemini(prompt: string, apiKey: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
  } catch {
    throw new GeminiError('Немає звʼязку з Gemini - перевір інтернет');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // The API's own message is more useful than the status code alone -
    // it says outright when the key is wrong or the model name has
    // moved on, which a bare "400" would not.
    const message = (data?.error?.message as string | undefined) ?? `Gemini відповів ${response.status}`;
    throw new GeminiError(message);
  }
  const parts = data?.candidates?.[0]?.content?.parts as { text?: string }[] | undefined;
  const text = parts?.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new GeminiError('Gemini не дав відповіді - можливо, запит потрапив під фільтр безпеки');
  return text;
}
