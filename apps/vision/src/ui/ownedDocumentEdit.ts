/** Image Size and Rename Layer capture the document (and, for rename, the layer)
 *  that was active when the dialog opened. OK applies only while that document
 *  is still active — a Window-menu switch must not resize or rename the tab
 *  that happens to be active at commit time. */
export function commitOwnedEdit(
  ownerDocId: number,
  activeDocId: number,
  apply: () => void,
  close: () => void,
): boolean {
  if (ownerDocId !== activeDocId) {
    close();
    return false;
  }
  apply();
  close();
  return true;
}
