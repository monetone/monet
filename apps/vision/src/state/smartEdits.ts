export type SmartEditBinding = {
  editDocId: number;
  parentDocId: number;
  parentLayerId: number;
  name: string;
  /** True when the contents are a real sub-document (a layer stack) rather than
   *  a single flattened PNG — it decides how the edit commits back. */
  layered?: boolean;
};

const smartEditBindings = new Map<number, SmartEditBinding>();

export function setSmartEditBinding(binding: SmartEditBinding): void {
  smartEditBindings.set(binding.editDocId, { ...binding });
}

export function getSmartEditBinding(docId: number): SmartEditBinding | null {
  const binding = smartEditBindings.get(docId);
  return binding ? { ...binding } : null;
}

export function deleteSmartEditBinding(docId: number): boolean {
  return smartEditBindings.delete(docId);
}

export function listSmartEditBindings(parentDocId?: number): SmartEditBinding[] {
  return Array.from(smartEditBindings.values())
    .filter((binding) => parentDocId === undefined || binding.parentDocId === parentDocId)
    .map((binding) => ({ ...binding }));
}
