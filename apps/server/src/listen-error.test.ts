import { describe, expect, it } from 'vitest';
import { listenErrorMessage, listenFailureLines } from './listen-error.js';

const errno = (code: string) => Object.assign(new Error('listen ' + code), { code });

describe('listenErrorMessage', () => {
  it('names the port and the fix when the port is taken', () => {
    const msg = listenErrorMessage(errno('EADDRINUSE'), 3000);
    expect(msg).toBe(
      '[OfficePM] port 3000 is already in use. Stop whatever is using it, or set PORT to a free port, for example PORT=3001.',
    );
    expect(msg).not.toContain('\n');
  });

  it('explains a port the process may not bind', () => {
    expect(listenErrorMessage(errno('EACCES'), 80)).toBe(
      '[OfficePM] not allowed to listen on port 80. Set PORT to a port above 1023.',
    );
  });

  it('leaves every other error to the caller', () => {
    expect(listenErrorMessage(errno('EMFILE'), 3000)).toBeNull();
    expect(listenErrorMessage(new Error('boom'), 3000)).toBeNull();
    expect(listenErrorMessage('EADDRINUSE', 3000)).toBeNull();
  });
});

describe('listenFailureLines', () => {
  it('repeats the generated password when this run created the admin', () => {
    const lines = listenFailureLines(errno('EADDRINUSE'), 3000, 'abc123XYZ');
    expect(lines).toHaveLength(3);
    expect(lines?.[0]).toContain('port 3000 is already in use');
    expect(lines?.join('\n')).toContain('Its generated password is: abc123XYZ');
  });

  it('prints only the port message when no password was generated this run', () => {
    expect(listenFailureLines(errno('EADDRINUSE'), 3000, null)).toEqual([
      listenErrorMessage(errno('EADDRINUSE'), 3000),
    ]);
  });

  it('leaves every other error to the caller', () => {
    expect(listenFailureLines(errno('EMFILE'), 3000, 'abc123XYZ')).toBeNull();
  });
});
