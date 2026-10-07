import * as nodeFs from "node:fs";
import { dirname, basename, join } from "node:path";

let counter = 0;

/**
 * Atomically overwrite `targetPath` with `text` (already-serialized JSON,
 * or any UTF-8 text): create a sibling temp with exclusive creation
 * (`wx`), write every byte, fsync the file, rename the temp over the
 * target (POSIX `rename` is atomic and can never leave a truncated
 * target — the destination is either the old bytes or the new bytes,
 * never a partial write), then fsync the containing directory so the
 * rename itself survives a crash. On any failure *before* the rename
 * commits, the prior artifact (if any) is untouched and only the still-
 * owned temp is removed. A failure *after* the rename commits (i.e. only
 * the trailing directory-fsync can fail at that point) is reported via
 * `error.committedWithWarning = true` on the thrown error — the write
 * itself already succeeded and must never be treated as though nothing
 * was written.
 *
 * `impl` is an injectable adapter over `node:fs`'s sync primitives —
 * production code always calls this with the default (real `node:fs`);
 * tests substitute a wrapper that throws at one specific step to prove
 * each failure boundary deterministically, with no real disk-fault
 * simulation required.
 */
export function writeJsonAtomicSync(targetPath, text, impl = nodeFs) {
  const dir = dirname(targetPath);
  const temp = join(dir, `.${basename(targetPath)}.tmp-${process.pid}-${counter++}`);
  const fd = impl.openSync(temp, "wx", 0o600);
  let closed = false;
  let renamed = false;
  try {
    // `writeSync` may legally write fewer bytes than requested (a "short
    // write") — never assume one call flushes the whole buffer. Loop until
    // every byte is written, checking each call's own reported progress:
    // reject a non-integer, zero/negative, or larger-than-requested-
    // remainder count instead of trusting it blindly, since any of those
    // would otherwise let a corrupt or truncated buffer silently reach
    // `fsyncSync`/`renameSync` and become the "durable" artifact.
    const buffer = Buffer.from(text, "utf8");
    let offset = 0;
    while (offset < buffer.length) {
      const remaining = buffer.length - offset;
      const written = impl.writeSync(fd, buffer, offset, remaining);
      if (!Number.isInteger(written) || written <= 0 || written > remaining) {
        throw new Error(
          `writeSync reported an invalid byte count (${written}) for ${remaining} remaining byte(s)`,
        );
      }
      offset += written;
    }
    impl.fsyncSync(fd);
    impl.closeSync(fd);
    closed = true;
    impl.renameSync(temp, targetPath);
    renamed = true;
    const dirFd = impl.openSync(dir, "r");
    try {
      impl.fsyncSync(dirFd);
    } finally {
      impl.closeSync(dirFd);
    }
  } catch (error) {
    if (renamed) {
      // The rename already committed: the target now holds the new bytes.
      // Only the trailing directory-fsync failed — a durability warning,
      // never grounds to claim the write itself failed.
      error.committedWithWarning = true;
      throw error;
    }
    // Nothing is visible yet: close the temp fd if a failure happened
    // before the happy-path close (never leak it), then clean up only
    // the temp this call created, leaving whatever previously existed at
    // `targetPath` (if anything) completely untouched.
    if (!closed) {
      try {
        impl.closeSync(fd);
      } catch {
        // best-effort
      }
    }
    try {
      impl.unlinkSync(temp);
    } catch {
      // best-effort; the temp may not exist if creating it is what failed
    }
    throw error;
  }
}
