export function normalizeActivityAlias(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/\s+/gu, " ");
}
