/**
 * Zamiana treści regulaminu-witryny.txt na HTML w stylu dokumentów strzelca.pl
 * (akapity, listy, nagłówki działów i paragrafów w kolorystyce Coyote — bez ramek wokół bloków tekstu).
 * Opcjonalnie: spis treści z kotwicami (sticky + scroll-spy inicjowany na stronie hosta).
 */

export function renderRegulaminTxtToHtml(raw, options = {}) {
  const includeFooter = options.includeFooter === true;
  /** Domyślnie wyłączony — włącz na stronie dokumentów (`includeToc: true`). */
  const includeToc = options.includeToc === true;

  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const escAttr = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const tocEntries = [];
  let sectionIdx = 0;
  let i = 0;

  const isBulletLine = (l) => /^\s*•\s*/.test(l);
  const isSection = (t) => /^§\d+/i.test(t);
  /** Tylko prawdziwe nagłówki działów (np. „DZIAŁ III — …”), nie odesłania w tekście („DZIAŁ III niniejszego”). */
  const isDzial = (t) =>
    /^Dział\s+[IVXLC]+\s*[—–\-]\s*\S/i.test(t) ||
    /^DZIAŁ\s+[IVXLCDM]+\s*[—–\-]\s*\S/i.test(t);
  const isSpis = (t) => /^SPIS\s+TREŚCI/i.test(t);
  const isPodsumowanie = (t) => /^PODSUMOWANIE\b/i.test(t);

  function nextSectionId() {
    sectionIdx += 1;
    return `regulamin-sekcja-${sectionIdx}`;
  }

  function pushTocHeading(rawTitle) {
    const id = nextSectionId();
    tocEntries.push({ id, label: rawTitle });
    return id;
  }

  function flushBullets(buf) {
    if (!buf.length) return;
    out.push(
      '<ul class="list-disc pl-5 space-y-2 text-zinc-300 text-sm leading-relaxed my-4 marker:text-[#C19A6B]">' +
        buf.map((t) => `<li class="pl-1">${esc(t.replace(/^\s*•\s*/, ""))}</li>`).join("") +
        "</ul>",
    );
  }

  function formatParagraphs(text) {
    const parts = String(text || "")
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    return parts
      .map(
        (p) =>
          `<p class="mb-3 last:mb-0 text-zinc-300 text-sm leading-relaxed">${esc(p).replace(/\n/g, "<br/>")}</p>`,
      )
      .join("");
  }

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i++;
      continue;
    }

    if (isBulletLine(lines[i])) {
      const buf = [];
      while (i < lines.length && isBulletLine(lines[i])) {
        buf.push(lines[i].trim());
        i++;
      }
      flushBullets(buf);
      continue;
    }

    if (isSpis(trimmed)) {
      out.push(`<h3 class="text-lg font-bold coyote-text mb-4 mt-2 tracking-wide">${esc(trimmed)}</h3>`);
      i++;
      continue;
    }

    if (isPodsumowanie(trimmed)) {
      const id = includeToc ? pushTocHeading(trimmed) : nextSectionId();
      out.push(
        `<h3 id="${escAttr(id)}" class="text-xl md:text-2xl font-bold coyote-text mt-14 mb-5 first:mt-0 tracking-tight scroll-mt-24 regulamin-dzial-heading">${esc(trimmed)}</h3>`,
      );
      i++;
      continue;
    }

    if (isDzial(trimmed)) {
      const id = includeToc ? pushTocHeading(trimmed) : nextSectionId();
      out.push(
        `<h3 id="${escAttr(id)}" class="text-xl md:text-2xl font-bold coyote-text mt-14 mb-5 first:mt-0 tracking-tight scroll-mt-24 regulamin-dzial-heading">${esc(trimmed)}</h3>`,
      );
      i++;
      continue;
    }

    if (isSection(trimmed)) {
      const titleLine = trimmed;
      i++;
      const bodyLines = [];
      while (i < lines.length) {
        const l = lines[i];
        const t = l.trim();
        if (!t) {
          bodyLines.push("");
          i++;
          continue;
        }
        if (isSection(t) || isDzial(t) || isSpis(t) || isPodsumowanie(t) || isBulletLine(l)) break;
        bodyLines.push(l);
        i++;
      }
      const bodyText = bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      out.push(
        `<section class="mt-6 scroll-mt-24">` +
          `<h4 class="text-base font-bold coyote-text mb-3">${esc(titleLine)}</h4>` +
          (bodyText ? `<div class="space-y-0">${formatParagraphs(bodyText)}</div>` : "") +
          `</section>`,
      );
      continue;
    }

    const paraLines = [];
    while (i < lines.length) {
      const l = lines[i];
      const t = l.trim();
      if (!t) break;
      if (isSection(t) || isDzial(t) || isSpis(t) || isPodsumowanie(t) || isBulletLine(l)) break;
      paraLines.push(l);
      i++;
    }
    const block = paraLines.join("\n").trim();
    if (!block) continue;

    const firstLine = block.split("\n")[0].trim();
    if (/^Regulamin witryny strzelca\.pl$/i.test(firstLine) || /^Regulamin witryny STRZELCA\.pl$/i.test(firstLine)) {
      out.push(
        `<h2 class="text-2xl md:text-3xl font-bold coyote-text mb-4 leading-tight">${esc(firstLine)}</h2>`,
      );
      const rest = block.split("\n").slice(1).join("\n").trim();
      if (rest) {
        out.push(`<div class="mb-8 space-y-0">${formatParagraphs(rest)}</div>`);
      }
    } else if (
      /^Regulamin STRZELCA\.pl$/i.test(firstLine) ||
      /^Regulamin strzelca\.pl$/i.test(firstLine) ||
      /^Regulamin Sklepu Internetowego/i.test(firstLine) ||
      /^Regulamin Użytkowania Serwisu Bazar/i.test(firstLine) ||
      /^Regulamin korzystania ze szkoleń/i.test(firstLine) ||
      /^Regulamin Wydarzeń/i.test(firstLine) ||
      /^Regulamin Bloga/i.test(firstLine) ||
      /^Regulamin Pomocy/i.test(firstLine) ||
      /^Regulamin Kontaktu/i.test(firstLine) ||
      /^Regulamin zamówień/i.test(firstLine)
    ) {
      out.push(`<h3 class="text-lg md:text-xl font-bold coyote-text mt-10 mb-4">${esc(firstLine)}</h3>`);
      const rest = block.split("\n").slice(1).join("\n").trim();
      if (rest) {
        out.push(`<div class="mb-6 space-y-0">${formatParagraphs(rest)}</div>`);
      }
    } else {
      out.push(`<div class="mb-5 space-y-0">${formatParagraphs(block)}</div>`);
    }
  }

  const foot = includeFooter
    ? `<p class="text-zinc-500 text-xs mt-6 pt-4 border-t border-zinc-800">STRZELCA.PL — dokumenty i regulaminy · dokumenty.strzelca.pl</p>`
    : "";

  const mainInner = `<div class="space-y-0 max-w-none regulamin-rich">${out.join("")}${foot}</div>`;

  if (!includeToc || !tocEntries.length) {
    return mainInner;
  }

  const tocLinks = tocEntries
    .map(({ id, label }) => {
      const short = label.length > 72 ? `${label.slice(0, 69)}…` : label;
      return `<a href="#${escAttr(id)}" class="regulamin-toc-link">${esc(short)}</a>`;
    })
    .join("");

  const tocAside = `<aside class="regulamin-toc-aside" aria-label="Spis działów regulaminu">
      <div class="text-[10px] uppercase font-bold tracking-[0.2em] text-zinc-500 mb-2 px-1">Spis działów</div>
      <nav class="regulamin-toc flex flex-col gap-0.5">${tocLinks}</nav>
    </aside>`;

  return `<div class="regulamin-doc-layout">${tocAside}<div class="regulamin-doc-main min-w-0 flex-1">${mainInner}</div></div>`;
}
