export function tokenize(name: string): string[] {
  return name
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((t) => t.split(/(?<=\p{Ll})(?=\p{Lu})|(?<=\p{N})(?=\p{L})|(?<=\p{L})(?=\p{N})/u))
    .filter(Boolean);
}

export function folderMatchesKeyword(folderName: string, keyword: string): boolean {
  const k = keyword.toLowerCase();
  if ([...keyword].length <= 3) return tokenize(folderName).some((t) => t.toLowerCase() === k);
  return folderName.toLowerCase().includes(k);
}
