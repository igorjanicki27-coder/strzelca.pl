const STYLE_ID = "strzelca-carousel-3d-gallery";

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .carousel-3d-viewport {
            perspective: 1600px;
            perspective-origin: 50% 42%;
            /* clipuje powiększone kafelki — bez tego nachodzą na strzałki (sąsiednie kolumny grida) */
            overflow: hidden;
            padding-inline: clamp(6px, 1.5vw, 18px);
            box-sizing: border-box;
        }

        .carousel-3d-track {
            transform-style: preserve-3d;
            padding-block: clamp(12px, 2.2vw, 24px);
        }

        .carousel-3d-card {
            --carousel-3d-shift-x: 0px;
            --carousel-3d-shift-y: 0px;
            --carousel-3d-shift-z: 0px;
            --carousel-3d-rotate-y: 0deg;
            --carousel-3d-scale: 1;
            --carousel-3d-opacity: 1;
            --carousel-3d-blur: 0px;
            --carousel-3d-saturate: 1;
            --carousel-3d-brightness: 1;
            transform-origin: center center;
            transform-style: preserve-3d;
            backface-visibility: hidden;
            transition:
                transform 280ms cubic-bezier(0.22, 0.61, 0.36, 1),
                opacity 280ms ease,
                filter 280ms ease,
                box-shadow 280ms ease;
            transform:
                translate3d(
                    var(--carousel-3d-shift-x),
                    var(--carousel-3d-shift-y),
                    var(--carousel-3d-shift-z)
                )
                rotateY(var(--carousel-3d-rotate-y))
                scale(var(--carousel-3d-scale));
            opacity: var(--carousel-3d-opacity);
            filter:
                blur(var(--carousel-3d-blur))
                saturate(var(--carousel-3d-saturate))
                brightness(var(--carousel-3d-brightness));
            box-shadow:
                0 12px 30px rgba(0, 0, 0, 0.26),
                0 30px 60px rgba(0, 0, 0, 0.14);
        }

        .carousel-3d-track[data-carousel-3d-disabled="true"] .carousel-3d-card {
            transform: none;
            opacity: 1;
            filter: none;
        }

        @media (max-width: 700px) {
            .carousel-3d-viewport {
                perspective: 1100px;
                perspective-origin: 50% 48%;
            }

            .carousel-3d-track {
                padding-block: 8px;
            }
        }
    `;
    document.head.appendChild(style);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function attachCarousel3dGallery({ viewport, track, cardSelector }) {
    if (!(viewport instanceof HTMLElement) || !(track instanceof HTMLElement) || !cardSelector) {
        return {
            refresh() {},
            destroy() {},
        };
    }

    injectStyles();
    viewport.classList.add("carousel-3d-viewport");
    track.classList.add("carousel-3d-track");

    let refreshRaf = 0;
    let transitionRaf = 0;
    let destroyed = false;

    const getCards = () => [...track.querySelectorAll(cardSelector)].filter((node) => node instanceof HTMLElement);

    const refresh = () => {
        if (destroyed) return;
        const cards = getCards();
        const disabled = cards.length === 0 || track.classList.contains("carousel-track--status-single");
        track.dataset.carousel3dDisabled = disabled ? "true" : "false";

        const viewportRect = viewport.getBoundingClientRect();
        const viewportCenterX = viewportRect.left + viewportRect.width / 2;
        const viewportHalf = Math.max(1, viewportRect.width / 2);
        const singleCard = cards.length <= 1;

        cards.forEach((card) => {
            card.classList.add("carousel-3d-card");
            const rect = card.getBoundingClientRect();
            const cardCenterX = rect.left + rect.width / 2;
            const relative = clamp((cardCenterX - viewportCenterX) / viewportHalf, -2.6, 2.6);
            const distance = Math.abs(relative);
            const visible = rect.right > viewportRect.left && rect.left < viewportRect.right;

            /* Umiarkowany scale — duży (1.1) + gap w flexie dawał fizyczne nakładanie kafelków */
            const scale = disabled
                ? 1
                : singleCard
                    ? 1.03
                    : clamp(1.035 - distance * 0.1, 0.78, 1.035);
            const shiftZ = disabled
                ? 0
                : singleCard
                    ? 95
                    : Math.round(clamp(110 - distance * 100, -55, 110));
            const shiftY = disabled ? 0 : Math.round(clamp(distance * 20, 0, 44));
            const shiftX = disabled ? 0 : Math.round(relative * -30);
            const rotateY = disabled ? 0 : clamp(relative * -24, -28, 28);
            const opacity = disabled ? 1 : clamp((visible ? 1 : 0.75) - distance * 0.18, 0.24, 1);
            const blur = disabled ? 0 : clamp(distance * 0.45, 0, 1.1);
            const saturate = disabled ? 1 : clamp(1.18 - distance * 0.14, 0.78, 1.18);
            const brightness = disabled ? 1 : clamp(1.08 - distance * 0.08, 0.82, 1.08);
            const zIndex = disabled ? 1 : String(200 - Math.round(distance * 100));

            card.style.setProperty("--carousel-3d-shift-x", `${shiftX}px`);
            card.style.setProperty("--carousel-3d-shift-y", `${shiftY}px`);
            card.style.setProperty("--carousel-3d-shift-z", `${shiftZ}px`);
            card.style.setProperty("--carousel-3d-rotate-y", `${rotateY}deg`);
            card.style.setProperty("--carousel-3d-scale", scale.toFixed(3));
            card.style.setProperty("--carousel-3d-opacity", opacity.toFixed(3));
            card.style.setProperty("--carousel-3d-blur", `${blur.toFixed(3)}px`);
            card.style.setProperty("--carousel-3d-saturate", saturate.toFixed(3));
            card.style.setProperty("--carousel-3d-brightness", brightness.toFixed(3));
            card.style.zIndex = zIndex;
        });
    };

    const scheduleRefresh = () => {
        if (destroyed) return;
        cancelAnimationFrame(refreshRaf);
        refreshRaf = requestAnimationFrame(refresh);
    };

    const stopTransitionLoop = () => {
        cancelAnimationFrame(transitionRaf);
        transitionRaf = 0;
    };

    const runTransitionLoop = () => {
        if (destroyed) return;
        refresh();
        transitionRaf = requestAnimationFrame(runTransitionLoop);
    };

    const onTransitionStart = (event) => {
        if (event.target !== track) return;
        if (event.propertyName && event.propertyName !== "transform") return;
        stopTransitionLoop();
        runTransitionLoop();
    };

    const onTransitionEnd = (event) => {
        if (event.target !== track) return;
        if (event.propertyName && event.propertyName !== "transform") return;
        stopTransitionLoop();
        scheduleRefresh();
    };

    const mutationObserver = new MutationObserver(() => {
        scheduleRefresh();
    });
    mutationObserver.observe(track, { childList: true, subtree: false });

    const resizeObserver = new ResizeObserver(() => {
        scheduleRefresh();
    });
    resizeObserver.observe(viewport);
    resizeObserver.observe(track);

    track.addEventListener("transitionrun", onTransitionStart);
    track.addEventListener("transitionstart", onTransitionStart);
    track.addEventListener("transitionend", onTransitionEnd);
    track.addEventListener("transitioncancel", onTransitionEnd);

    scheduleRefresh();

    return {
        refresh: scheduleRefresh,
        destroy() {
            destroyed = true;
            stopTransitionLoop();
            cancelAnimationFrame(refreshRaf);
            mutationObserver.disconnect();
            resizeObserver.disconnect();
            track.removeEventListener("transitionrun", onTransitionStart);
            track.removeEventListener("transitionstart", onTransitionStart);
            track.removeEventListener("transitionend", onTransitionEnd);
            track.removeEventListener("transitioncancel", onTransitionEnd);
        },
    };
}
