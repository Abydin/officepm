import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/** jsdom has no EventSource. A silent one lets the app shell mount; event behaviour has its own tests. */
class IdleEventSource {
  addEventListener() {}
  close() {}
}

beforeEach(() => {
  vi.stubGlobal('EventSource', IdleEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
