/**
 * Swipe w poziomie na viewport karuzeli (mobile) — wywołuje te same akcje co strzałki.
 */
export function attachHorizontalCarouselSwipe(viewport, { onPrev, onNext, minDelta = 48 }) {
  if (!viewport || typeof onPrev !== "function" || typeof onNext !== "function") {
    return () => {};
  }
  let startX = null;
  let startY = null;

  const onStart = (e) => {
    const t = e.touches && e.touches[0];
    if (!t) return;
    startX = t.clientX;
    startY = t.clientY;
  };

  const onEnd = (e) => {
    if (startX == null || startY == null) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) {
      startX = startY = null;
      return;
    }
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    startX = startY = null;
    if (Math.abs(dx) < minDelta) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.9) return;
    if (dx < 0) onNext();
    else onPrev();
  };

  viewport.addEventListener("touchstart", onStart, { passive: true });
  viewport.addEventListener("touchend", onEnd, { passive: true });
  return () => {
    viewport.removeEventListener("touchstart", onStart);
    viewport.removeEventListener("touchend", onEnd);
  };
}
