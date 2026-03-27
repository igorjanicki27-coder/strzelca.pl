/**
 * Swipe w poziomie na viewport karuzeli (mobile) — wywołuje te same akcje co strzałki.
 */
export function attachHorizontalCarouselSwipe(viewport, { onPrev, onNext, minDelta = 42 }) {
  if (!viewport || typeof onPrev !== "function" || typeof onNext !== "function") {
    return () => {};
  }
  let startX = null;
  let startY = null;
  let startTs = 0;
  let moved = false;
  let lockAxis = null;
  let suppressClickUntilTs = 0;

  const onStart = (e) => {
    const t = e.touches && e.touches[0];
    if (!t) return;
    startX = t.clientX;
    startY = t.clientY;
    startTs = Date.now();
    moved = false;
    lockAxis = null;
  };

  const onMove = (e) => {
    if (startX == null || startY == null) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (!lockAxis && (adx >= 6 || ady >= 6)) {
      lockAxis = adx > ady * 1.1 ? "x" : "y";
    }
    if (lockAxis === "x") {
      moved = true;
      if (e.cancelable) {
        e.preventDefault();
      }
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
    const elapsedMs = Math.max(1, Date.now() - startTs);
    const velocityPxPerMs = Math.abs(dx) / elapsedMs;
    startX = startY = null;
    lockAxis = null;
    const passesDistance = Math.abs(dx) >= minDelta;
    const passesFlick = Math.abs(dx) >= 24 && velocityPxPerMs >= 0.45;
    if (!passesDistance && !passesFlick) return;
    if (Math.abs(dy) > Math.abs(dx) * 1.1) return;
    suppressClickUntilTs = Date.now() + 420;
    if (dx < 0) onNext();
    else onPrev();
  };

  const onCancel = () => {
    startX = null;
    startY = null;
    startTs = 0;
    moved = false;
    lockAxis = null;
  };

  const onClickCapture = (e) => {
    if (!moved) return;
    if (Date.now() > suppressClickUntilTs) return;
    e.preventDefault();
    e.stopPropagation();
  };

  viewport.addEventListener("touchstart", onStart, { passive: true });
  viewport.addEventListener("touchmove", onMove, { passive: false });
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
