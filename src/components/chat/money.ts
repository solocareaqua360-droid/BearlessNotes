// Dollars as the user reads them: a comma, and as many digits as the amount needs to be more than a row of zeros.
// Whole cents stay at two digits ($0,05, not $0,050); smaller amounts get the digits they need.
export function usd(v: number): string {
  const digits = v >= 0.01 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-9 ? 2 : v >= 0.1 ? 2 : v >= 0.01 ? 3 : 4;
  return `$${v.toFixed(digits).replace('.', ',')}`;
}
export function tokensText(n: number): string {
  return `≈ ${Math.round(n).toLocaleString('uk-UA').replace(/,/g, ' ')}`;
}
