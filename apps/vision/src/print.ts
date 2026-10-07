const PRINT_LOAD_TIMEOUT_MS = 30_000;
const PRINT_CLEANUP_MS = 5 * 60_000;

/** Print one composite PNG in an isolated document so Vision's UI chrome can
 * never become part of the job. `css` sizes and places it on the page (File ▸
 * Print…'s layout, see `printPageCss`); the OS dialog still owns printer/copy
 * choices. */
export async function printPng(png: Uint8Array, css: string): Promise<void> {
  if (!png.length) throw new Error("The document produced an empty print image.");
  if (typeof document === "undefined" || !document.body) {
    throw new Error("Printing requires the Vision desktop window.");
  }

  const frame = document.createElement("iframe");
  frame.title = "Monet Vision print";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0";
  document.body.appendChild(frame);

  let url = "";
  let released = false;
  let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  const release = () => {
    if (cleanupTimer != null) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
    if (released) return;
    released = true;
    frame.remove();
    if (url) URL.revokeObjectURL(url);
  };
  try {
    const printDocument = frame.contentDocument;
    const printWindow = frame.contentWindow;
    if (!printDocument || !printWindow) throw new Error("The print document could not be created.");

    const style = printDocument.createElement("style");
    style.textContent = css;
    printDocument.head.replaceChildren(style);

    const image = printDocument.createElement("img");
    image.alt = "Document to print";
    printDocument.body.replaceChildren(image);
    url = URL.createObjectURL(new Blob([png as unknown as BlobPart], { type: "image/png" }));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The print image did not load.")), PRINT_LOAD_TIMEOUT_MS);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(new Error("The print image could not be loaded.")); };
      image.src = url;
    });

    cleanupTimer = setTimeout(release, PRINT_CLEANUP_MS);
    printWindow.addEventListener("afterprint", release, { once: true });
    printWindow.focus();
    printWindow.print();
  } catch (error) {
    release();
    throw error;
  }
}
