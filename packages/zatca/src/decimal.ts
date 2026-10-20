// Exact decimal arithmetic for invoice amounts. Values are bigint "micros" (6 decimal
// places); rounding is half-up to 2 places at the points ZATCA's rules round.

export type Dec = bigint;

const DP = 6;
const SCALE = 10n ** BigInt(DP);

export function dec(value: number | string): Dec {
  const s = typeof value === "number" ? numberToPlain(value) : value.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Not a decimal number: ${value}`);
  const [, sign, int, frac = ""] = m;
  if (frac.length > DP) throw new Error(`More than ${DP} decimal places: ${value}`);
  const micros = BigInt(int!) * SCALE + BigInt(frac.padEnd(DP, "0"));
  return sign === "-" ? -micros : micros;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Not a finite number: ${n}`);
  // toFixed avoids exponent notation; trim the noise it can append.
  return n.toFixed(DP).replace(/\.?0+$/, "") || "0";
}

export const ZERO: Dec = 0n;

export function add(...xs: Dec[]): Dec {
  return xs.reduce((a, b) => a + b, 0n);
}

export function mul(a: Dec, b: Dec): Dec {
  return divRound(a * b, SCALE);
}

/** a × percent / 100. */
export function percentOf(a: Dec, percent: Dec): Dec {
  return divRound(a * percent, 100n * SCALE);
}

/** Half-up (away from zero) rounding to 2 decimal places. */
export function round2(a: Dec): Dec {
  const step = SCALE / 100n;
  return divRound(a, step) * step;
}

function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const up = (r < 0n ? -r : r) * 2n >= d;
  return up ? q + (n < 0n ? -1n : 1n) : q;
}

/** Fixed number of decimals (used for amounts: always 2). */
export function fmt(a: Dec, places = 2): string {
  const neg = a < 0n;
  const abs = neg ? -a : a;
  const int = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(DP, "0");
  const fracOut = places === 0 ? "" : `.${frac.slice(0, places).padEnd(places, "0")}`;
  if (BigInt(frac.slice(places) || "0") !== 0n) throw new Error(`fmt would truncate ${toPlain(a)} to ${places} places`);
  return `${neg ? "-" : ""}${int}${fracOut}`;
}

/** Shortest exact representation with at least `minPlaces` decimals (quantities, unit prices). */
export function toPlain(a: Dec, minPlaces = 0): string {
  const neg = a < 0n;
  const abs = neg ? -a : a;
  let frac = (abs % SCALE).toString().padStart(DP, "0").replace(/0+$/, "");
  if (frac.length < minPlaces) frac = frac.padEnd(minPlaces, "0");
  return `${neg ? "-" : ""}${abs / SCALE}${frac ? `.${frac}` : ""}`;
}

export function toNumber(a: Dec): number {
  return Number(toPlain(a));
}
