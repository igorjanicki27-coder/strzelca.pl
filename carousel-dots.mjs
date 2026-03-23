/**
 * Wspólny wskaźnik kropek pod karuzelami strzelca.pl.
 * @param {HTMLElement | null} container
 * @param {number} count — liczba pozycji (slajdów)
 * @param {number} activeIndex — indeks karty widocznej jako pierwsza od lewej (0..count-1)
 * @param {(index: number) => void} onSelect
 * @param {boolean} [interactive=true] — false gdy wszystkie karty są widoczne (bez przewijania); kropki tylko jako podgląd liczby
 */
export function syncCarouselDotsNav(container, count, activeIndex, onSelect, interactive = true) {
    if (!container) return;
    if (count <= 1) {
        container.replaceChildren();
        container.hidden = true;
        return;
    }
    container.hidden = false;
    const safeActive = Math.max(0, Math.min(count - 1, activeIndex | 0));
    const needRebuild = container.childElementCount !== count;
    if (needRebuild) {
        container.replaceChildren();
        for (let i = 0; i < count; i++) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "carousel-dot";
            b.addEventListener("click", () => onSelect(i));
            container.appendChild(b);
        }
    }
    [...container.children].forEach((btn, i) => {
        const on = i === safeActive;
        btn.classList.toggle("carousel-dot--active", on);
        btn.setAttribute("aria-current", on ? "true" : "false");
        btn.disabled = !interactive;
        btn.setAttribute(
            "aria-label",
            interactive
                ? `Przejdź do pozycji ${i + 1} z ${count}`
                : `Pozycja ${i + 1} z ${count} (wszystkie widoczne)`,
        );
    });
}
