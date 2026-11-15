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

/**
 * The lines to print when the server cannot listen, or null for an error that keeps its
 * stack trace. The first admin is created before the port is bound (the server must have
 * a login the moment it answers), and its generated password is printed only once. If the
 * bind then fails, the retry would find the admin already there, so the password is
 * repeated here, in the one place the user is certain to be looking.
 */
export function listenFailureLines(
  error: unknown,
  port: number,
  generatedPassword: string | null,
): string[] | null {
  const friendly = listenErrorMessage(error, port);
  if (!friendly) return null;
  if (generatedPassword === null) return [friendly];
  return [
    friendly,
    '[OfficePM] The first admin was already created on this run. Its generated password is: ' +
      generatedPassword,
    '[OfficePM] Keep it: the next start will not print it again.',
  ];
}
