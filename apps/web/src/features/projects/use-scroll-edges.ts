import { useCallback, useState } from 'react';

export interface ScrollEdges {
  /** Content is hidden past the left edge. */
  left: boolean;
  /** Content is hidden past the right edge. */
  right: boolean;
}

/** One pixel of slack, because scrollLeft is fractional on a zoomed screen. */
export function edgesOf(el: Pick<HTMLElement, 'scrollLeft' | 'clientWidth' | 'scrollWidth'>) {
  return {
    left: el.scrollLeft > 1,
    right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
  };
}

const NONE: ScrollEdges = { left: false, right: false };

/**
 * Tells a horizontally scrolling strip which of its edges still has content behind it, so the page
 * can show a fade there. Attach `ref` to the strip. It re-measures on scroll and whenever the strip
 * or one of its children changes size.
 */
export function useScrollEdges(): { ref: (el: HTMLElement | null) => void; edges: ScrollEdges } {
  const [edges, setEdges] = useState<ScrollEdges>(NONE);
  // A callback ref, so the listeners follow the element if it is ever replaced.
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const measure = () =>
      setEdges((prev) => {
        const next = edgesOf(el);
        return next.left === prev.left && next.right === prev.right ? prev : next;
      });
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, []);
  return { ref, edges };
}
