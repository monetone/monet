export type SmartLinkInfo = {
  docId: number;
  layerId: number;
  name: string;
  path?: string;
  /** Package-relative path retained while `path` is resolved for live native IO. */
  relativePath?: string;
  missing: boolean;
  linkedAt: number;
  updatedAt: number;
};

export type PersistedSmartLinkInfo = Omit<SmartLinkInfo, "docId">;

export const smartLinkKey = (docId: number, layerId: number) => `${docId}:${layerId}`;

const smartLinkInfos = new Map<string, SmartLinkInfo>();

export function getSmartLink(docId: number, layerId: number): SmartLinkInfo | null {
  const info = smartLinkInfos.get(smartLinkKey(docId, layerId));
  return info ? { ...info } : null;
}

export function hasSmartLink(docId: number, layerId: number): boolean {
  return smartLinkInfos.has(smartLinkKey(docId, layerId));
}

export function setSmartLink(info: SmartLinkInfo): void {
  smartLinkInfos.set(smartLinkKey(info.docId, info.layerId), { ...info });
}

export function deleteSmartLink(docId: number, layerId: number): boolean {
  return smartLinkInfos.delete(smartLinkKey(docId, layerId));
}

export function listSmartLinks(docId: number, isLiveSmart?: (layerId: number) => boolean): SmartLinkInfo[] {
  return Array.from(smartLinkInfos.values())
    .filter((info) => info.docId === docId && (!isLiveSmart || isLiveSmart(info.layerId)))
    .map((info) => ({ ...info }));
}

export function markSmartLinkMissing(docId: number, layerId: number, missing: boolean, updatedAt = Date.now()): boolean {
  const info = smartLinkInfos.get(smartLinkKey(docId, layerId));
  if (!info) return false;
  smartLinkInfos.set(smartLinkKey(docId, layerId), { ...info, missing, updatedAt });
  return true;
}

export function clearSmartLinksForDoc(docId: number): number {
  let count = 0;
  for (const info of Array.from(smartLinkInfos.values())) {
    if (info.docId === docId) {
      smartLinkInfos.delete(smartLinkKey(info.docId, info.layerId));
      count++;
    }
  }
  return count;
}

export function serializeSmartLinksForDoc(docId: number, liveLayerIds?: Set<number>): PersistedSmartLinkInfo[] {
  return listSmartLinks(docId)
    .filter((info) => !liveLayerIds || liveLayerIds.has(info.layerId))
    .map(({ docId: _docId, ...rest }) => ({ ...rest, path: rest.relativePath || rest.path }));
}

export function restoreSmartLinksForDoc(docId: number, links: PersistedSmartLinkInfo[], liveLayerIds?: Set<number>): void {
  clearSmartLinksForDoc(docId);
  for (const link of links) {
    if (!Number.isFinite(link.layerId) || (liveLayerIds && !liveLayerIds.has(link.layerId))) continue;
    if (!link.name || !Number.isFinite(link.linkedAt) || !Number.isFinite(link.updatedAt)) continue;
    setSmartLink({
      docId,
      layerId: Math.trunc(link.layerId),
      name: link.name,
      path: link.path,
      relativePath: link.relativePath,
      missing: !!link.missing,
      linkedAt: link.linkedAt,
      updatedAt: link.updatedAt,
    });
  }
}
