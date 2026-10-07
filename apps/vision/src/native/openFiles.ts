export const OPEN_FILES_EVENT = "monet://open-files";
export const OPEN_FILES_READY_EVENT = "monet://open-files/ready";

type Listen = (
  event: string,
  handler: (event: { payload?: string[] }) => void,
) => Promise<() => void>;

export async function installOpenFilesListener(
  listen: Listen,
  emit: (event: string) => Promise<unknown>,
  openPaths: (paths: string[]) => unknown,
): Promise<() => void> {
  const unlisten = await listen(OPEN_FILES_EVENT, ({ payload }) => {
    if (payload?.length) void openPaths(payload);
  });
  try {
    await emit(OPEN_FILES_READY_EVENT);
    return unlisten;
  } catch (error) {
    unlisten();
    throw error;
  }
}
