/**
 * Convert a string to a URL-safe slug.
 * "Reddening & Extinction" -> "reddening-extinction"
 */
export function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Convert a string to an AST identifier.
 * Same as slug but also valid as an HTML id.
 */
export function toIdentifier(text: string): string {
  return toSlug(text);
}
