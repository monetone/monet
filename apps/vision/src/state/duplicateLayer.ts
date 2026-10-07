// Photoshop's Duplicate Layer default name. The stem drops a trailing " copy" or
// " copy N" so duplicating "Layer 1 copy" yields "Layer 1 copy 2" (not "copy copy");
// the result is the first free of "<stem> copy", "<stem> copy 2", … Pure / engine-
// free so it unit-tests in node; the dialog renames the new layer to it.
export function defaultDuplicateName(baseName: string, existingNames: string[]): string {
  const stem = baseName.replace(/ copy( \d+)?$/, "");
  const taken = new Set(existingNames);
  let candidate = `${stem} copy`;
  let n = 2;
  while (taken.has(candidate)) candidate = `${stem} copy ${n++}`;
  return candidate;
}
