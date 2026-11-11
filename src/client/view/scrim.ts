// A transparent dark layer behind the header popups (file picker, saved filters, `list:` values), shared by all of them.
const active = new Set<string>();

/** Shows the scrim while at least one popup holds it. */
export function setScrim(source: string, on: boolean): void {
  if (on) active.add(source);
  else active.delete(source);
  const scrim = document.getElementById("scrim");
  if (scrim) scrim.hidden = active.size === 0;
}
