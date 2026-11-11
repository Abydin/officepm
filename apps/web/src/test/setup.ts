import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/** jsdom has no EventSource. A silent one lets the app shell mount; event behaviour has its own tests. */
class IdleEventSource {
  addEventListener() {}
  close() {}
}

/** cmdk measures its list with ResizeObserver and scrolls the selected row into view; jsdom has neither. */
class IdleResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('EventSource', IdleEventSource);
  vi.stubGlobal('ResizeObserver', IdleResizeObserver);
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
