/** Only http(s) links are ever stored, since they are rendered as hrefs to everyone. */
export function isSafeUrl(url: unknown): boolean {
  try {
    const parsed = new URL(url as string);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** For the webhooks: a bad url is dropped to null rather than failing the ticket move. */
export function safeUrlOrNull(url: unknown): string | null {
  return url && isSafeUrl(url) ? (url as string) : null;
}
