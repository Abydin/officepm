// jest-dom's own vitest typings declare Assertion with one type parameter, but
// Vitest 5's has two, so the shipped augmentation does not merge. Same matchers, right shape.
// The interfaces must stay empty: declaration merging cannot be done with a type alias.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

/* eslint-disable @typescript-eslint/no-empty-object-type */
declare module 'vitest' {
  interface Assertion<
    R extends void | Promise<void> = void,
    T = unknown,
  > extends TestingLibraryMatchers<T, R> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
