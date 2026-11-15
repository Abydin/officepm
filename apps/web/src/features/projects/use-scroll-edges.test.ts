import { describe, expect, it } from 'vitest';
import { edgesOf } from './use-scroll-edges';

const el = (scrollLeft: number, clientWidth: number, scrollWidth: number) => ({
  scrollLeft,
  clientWidth,
  scrollWidth,
});

describe('edgesOf', () => {
  it('has no edge when everything fits', () => {
    expect(edgesOf(el(0, 1000, 1000))).toEqual({ left: false, right: false });
  });
  it('has only a right edge at the start of a wide strip', () => {
    expect(edgesOf(el(0, 1000, 1400))).toEqual({ left: false, right: true });
  });
  it('has both edges in the middle', () => {
    expect(edgesOf(el(200, 1000, 1400))).toEqual({ left: true, right: true });
  });
  it('has only a left edge at the end, even with a fractional scroll position', () => {
    expect(edgesOf(el(399.6, 1000, 1400))).toEqual({ left: true, right: false });
  });
});
