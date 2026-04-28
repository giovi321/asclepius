// Folders the vault returns from /api/vault/tree but that the UI hides
// because they are app plumbing the user doesn't usefully browse:
//
//   - ``config/`` at the root holds settings YAML.
//   - ``imaging-bundles/`` inside a patient directory holds DICOMDIR
//     and JPEG previews extracted from zip uploads — clinicians access
//     them via the imaging detail page, not the file browser.
//
// Both the FileBrowser page and the DocumentViewer's "Pick file from
// vault" recovery picker import this so they show identical trees.
// Keep these constants and the visibility helper here as the single
// source of truth.

export const ROOT_HIDDEN_FOLDERS = new Set(["config"]);
export const PATIENT_HIDDEN_FOLDERS = new Set(["imaging-bundles"]);

/**
 * Decide whether a vault path should be visible to the user. Mirrors
 * the per-segment rules the FileBrowser applies when navigating into
 * each directory.
 *
 * @param relPath POSIX path relative to the vault root, e.g.
 *                ``"patients/giovi/imaging-bundles/foo/DICOMDIR"``.
 */
export function isHiddenVaultPath(relPath: string): boolean {
  if (!relPath) return false;
  const parts = relPath.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  if (ROOT_HIDDEN_FOLDERS.has(parts[0])) return true;
  // ``patients/{slug}/imaging-bundles/...`` — segment 2 is the slug,
  // segment 3 is the hidden marker.
  if (parts.length >= 3 && parts[0] === "patients" && PATIENT_HIDDEN_FOLDERS.has(parts[2])) {
    return true;
  }
  return false;
}
