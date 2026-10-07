/** A long-running applier must still target both the same document and the
 *  same committed pixels it read before awaiting model work. */
export interface EditStampSource {
  readonly docGen: number;
  readonly e: { undo_pushes?: () => number };
}

export const editStamp = (source: EditStampSource): string =>
  `${source.docGen}:${source.e.undo_pushes?.() ?? 0}`;

export const docChanged = (source: EditStampSource, stamp: string): boolean =>
  !stamp.startsWith(`${source.docGen}:`) || editStamp(source) !== stamp;
