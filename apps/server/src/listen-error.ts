/**
 * A one-line, friendly message for the listen errors a first-time user can hit, or
 * null for anything else (which keeps its stack trace).
 */
export function listenErrorMessage(error: unknown, port: number): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'EADDRINUSE') {
    return (
      '[OfficePM] port ' +
      port +
      ' is already in use. Stop whatever is using it, or set PORT to a free port, for example PORT=' +
      (port + 1) +
      '.'
    );
  }
  if (code === 'EACCES') {
    return '[OfficePM] not allowed to listen on port ' + port + '. Set PORT to a port above 1023.';
  }
  return null;
}
