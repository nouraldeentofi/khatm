/** "10062.5" → "10,062.50" */
export function money(value: string | number): string {
  const s = typeof value === "number" ? value.toFixed(2) : value;
  const neg = s.startsWith("-");
  const [int, frac = "00"] = s.replace("-", "").split(".");
  return `${neg ? "−" : ""}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac.padEnd(2, "0").slice(0, 2)}`;
}

/** "2026-10-20" → "20/10/2026", the form Saudi accounting uses. */
export function gregorian(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

const hijriFmt = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
export function hijri(iso: string): string {
  return hijriFmt.format(new Date(`${iso}T12:00:00Z`));
}

const monthFmt = new Intl.DateTimeFormat("ar", { month: "long", year: "numeric", calendar: "gregory", numberingSystem: "latn" });
export function monthLabel(d: Date): string {
  return monthFmt.format(d);
}

/** Time of day as people say it: "11:42 ص". */
export function clock(time: string): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "ص" : "م"}`;
}
