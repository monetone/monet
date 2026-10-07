export const IMPORTED_PHOTOSHOP_SAVE_BLOCKED =
  "This non-RGB Photoshop document is an exact-source, read-only preview. Export the original or convert it to RGB before saving an editable copy.";

export interface ImportedPhotoshopApi {
  imported_photoshop_read_only?: () => boolean;
  imported_photoshop_source_is_psb?: () => boolean;
  export_imported_photoshop_original?: () => Uint8Array;
}

export const importedPhotoshopApi = (engine: unknown): ImportedPhotoshopApi =>
  engine as ImportedPhotoshopApi;
