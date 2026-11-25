/**
 * Copies text to the clipboard. The async clipboard API needs a secure context, and OfficePM is
 * often served over plain http on a LAN, so it falls back to selecting a hidden field and the
 * old copy command. Returns false when neither worked; the caller then tells the person to
 * select and copy by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (permissions, insecure origin): try the fallback.
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Offers text as a file download, without a request: the browser saves what it is given. */
export function downloadText(filename: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
