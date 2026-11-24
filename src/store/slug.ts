const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export function slugify(title: string): string {
  let s = title.normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  s = [...s].slice(0, 40).join("").replace(/-+$/, "");
  if (!s) s = "untitled";
  if (RESERVED.test(s)) s += "-";
  return s;
}

export function cardFileName(fm: { period: string | null; modified: string; title: string; source_hash: string }): string {
  const year = fm.period?.match(/(\d{4})/)?.[1] ?? fm.modified.slice(0, 4);
  const h6 = fm.source_hash.replace(/^sha256:/, "").slice(0, 6);
  return `${year}-${slugify(fm.title)}-${h6}.md`;
}
