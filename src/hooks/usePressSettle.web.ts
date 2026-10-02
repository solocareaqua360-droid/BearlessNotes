// The laptop's press is CSS ([data-lift]:active, App.web.tsx) - nothing to
// add here, and an inline transform would switch that rule off.
export function usePressSettle(_cardKey?: string) {
  return { style: undefined, handlers: {} };
}
