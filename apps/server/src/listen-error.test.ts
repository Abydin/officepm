import { describe, expect, it } from 'vitest';
import { listenErrorMessage } from './listen-error.js';

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
