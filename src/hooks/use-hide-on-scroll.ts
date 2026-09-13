"use client";

import { useEffect, useState } from "react";

/**
 * Hide-on-scroll direction detection for the bottom tab bar.
 *
 * Tracks the scroll position of the given scroll container (default:
 * window/documentElement). The bar hides after scrolling down past
 * `thresholdPx` and reappears on any upward scroll. Scrolling back to the
 * top always reveals the bar so short pages never feel stuck.
 *
 * Respects prefers-reduced-motion: reports "shown" unconditionally so the
 * tab bar stays visible without movement.
 *
 *   const { hidden } = useHideOnScroll()
 */
export function useHideOnScroll({
  scrollElementId,
  thresholdPx = 48,
}: {
  /** Scroll inside this element instead of the window (e.g. a `<main>` scroller). */
  scrollElementId?: string;
  /** Hide only after the user has scrolled at least this far down. */
  thresholdPx?: number;
} = {}): { hidden: boolean } {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      return;
    }

    function getScrollTop(): number {
      const el = scrollElementId
        ? document.getElementById(scrollElementId)
        : null;
      if (el) {
        return el.scrollTop;
      }
      return window.scrollY || document.documentElement.scrollTop || 0;
    }

    let lastScrollTop = getScrollTop();
    let ticking = false;

    function onScroll() {
      if (ticking) {
        return;
      }
      ticking = true;
      requestAnimationFrame(() => {
        const scrollTop = getScrollTop();
        const delta = scrollTop - lastScrollTop;

        if (scrollTop <= 0) {
          // At (or above) the top of the scroller: always reveal.
          setHidden(false);
        } else if (delta > 0 && scrollTop > thresholdPx) {
          // Scrolling down past the threshold: hide.
          setHidden(true);
        } else if (delta < 0) {
          // Any upward scroll: reveal.
          setHidden(false);
        }

        lastScrollTop = scrollTop;
        ticking = false;
      });
    }

    // The layout's scroller may mount after this effect runs; re-resolve it
    // lazily inside getScrollTop, but listen on both window and the element
    // if it already exists.
    const el = scrollElementId
      ? document.getElementById(scrollElementId)
      : null;
    window.addEventListener("scroll", onScroll, { passive: true });
    el?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      el?.removeEventListener("scroll", onScroll);
    };
  }, [scrollElementId, thresholdPx]);

  return { hidden };
}
