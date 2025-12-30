// Shim for import.meta.url in bundled code
export const importMetaUrl =
  typeof __filename !== "undefined" ? "file://" + __filename : "file:///";
