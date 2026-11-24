import { useLayoutEffect, useRef } from 'react';
import { useAppConfig } from './api';

/** The page reserves this much room at the top (index.css reads it), so the banner never covers the app. */
const HEIGHT_VAR = '--demo-banner-h';

export const DEMO_BANNER_TEXT =
  'Public demo. Anyone can sign in, data is public and wiped nightly.';

/**
 * A slim notice shown only when the server says it is the public demo. It is fixed to the top,
 * and its measured height is published as a CSS variable that pads #root, so the app below keeps
 * its own full-height layout and nothing is covered or pushed off screen. With the demo off it
 * renders nothing and sets nothing.
 */
export function DemoBanner() {
  const demo = useAppConfig().data?.demo === true;
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!demo || !el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty(HEIGHT_VAR, `${el.offsetHeight}px`);
    publish();
    // The text wraps on a phone, so the height changes with the width.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(HEIGHT_VAR);
    };
  }, [demo]);

  if (!demo) return null;
  return (
    <div
      ref={ref}
      role="note"
      aria-label="Public demo"
      className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 border-b border-line bg-raised px-4 py-1.5 text-center text-[13px] text-fg"
    >
      <span className="rounded bg-accent px-1.5 text-[11px] font-bold tracking-wide text-accent-ink uppercase">
        Demo
      </span>
      <span>{DEMO_BANNER_TEXT}</span>
    </div>
  );
}
