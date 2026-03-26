/**
 * Swipe w poziomie na viewport karuzeli (mobile) — wywołuje te same akcje co strzałki.
 */
export function attachHorizontalCarouselSwipe(viewport, { onPrev, onNext, minDelta = 48 }) {
  if (!viewport || typeof onPrev !== "function" || typeof onNext !== "function") {
    return () => {};
  }
  let startX = null;
  let startY = null;
  let moved = false;
  let suppressClickUntilTs = 0;

  const onStart = (e) => {
    const t = e.touches && e.touches[0];
    if (!t) return;
    startX = t.clientX;
    startY = t.clientY;
    moved = false;
  };

  const onMove = (e) => {
    if (startX == null || startY == null) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) >= 8 || Math.abs(dy) >= 8) {
      moved = true;
    }
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
    suppressClickUntilTs = Date.now() + 420;
    if (dx < 0) onNext();
    else onPrev();
  };

  const onCancel = () => {
    startX = null;
    startY = null;
    moved = false;
  };

  const onClickCapture = (e) => {
    if (!moved) return;
    if (Date.now() > suppressClickUntilTs) return;
    e.preventDefault();
    e.stopPropagation();
  };

  viewport.addEventListener("touchstart", onStart, { passive: true });
  viewport.addEventListener("touchmove", onMove, { passive: true });
  viewport.addEventListener("touchend", onEnd, { passive: true });
  viewport.addEventListener("touchcancel", onCancel, { passive: true });
  viewport.addEventListener("click", onClickCapture, true);
  return () => {
    viewport.removeEventListener("touchstart", onStart);
    viewport.removeEventListener("touchmove", onMove);
    viewport.removeEventListener("touchend", onEnd);
    viewport.removeEventListener("touchcancel", onCancel);
    viewport.removeEventListener("click", onClickCapture, true);
  };
}
