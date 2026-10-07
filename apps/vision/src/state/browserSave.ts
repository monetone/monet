export interface BrowserSaveTask<T> {
  exportFile: () => T;
  download: (file: T) => void;
  markSaved: () => void;
  reportError: (error: unknown) => void;
  shouldMarkSaved: boolean;
}

/** Complete a browser download transaction. The document becomes saved only
 * after both export and download initiation succeed. */
export function runBrowserSave<T>(task: BrowserSaveTask<T>): boolean {
  try {
    const file = task.exportFile();
    task.download(file);
    if (task.shouldMarkSaved) task.markSaved();
    return true;
  } catch (error) {
    task.reportError(error);
    return false;
  }
}
