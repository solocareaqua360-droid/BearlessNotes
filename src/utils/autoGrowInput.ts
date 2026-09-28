// Making a multi-line field as tall as the text inside it.
//
// On a phone this is not a thing anyone has to do: React Native's
// multiline TextInput grows with its content, and the block row takes
// whatever height that comes to. So this side does nothing, and the `.web`
// sibling is where the work is - see it for why.
export function autoGrowInput(_input: unknown): void {}
