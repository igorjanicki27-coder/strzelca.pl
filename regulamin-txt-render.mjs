/**
 * Zamiana treści regulaminu-witryny.txt na HTML w stylu dokumentów strzelca.pl (karty, działy, §).
 */

export function renderRegulaminTxtToHtml(raw, options = {}) {
  const includeFooter = options.includeFooter === true;
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  const isBulletLine = (l) => /^\s*•\s*/.test(l);
  const isSection = (t) => /^§\d+/i.test(t);
  const isDzial = (t) => /^Dział\s+[IVXLC]+/i.test(t) || /^DZIAŁ\s+[IVXLCDM]+/i.test(t);
  const isSpis = (t) => /^SPIS\s+TREŚCI/i.test(t);

  function flushBullets(buf) {
    if (!buf.length) return;
    out.push(
      '<ul class="list-disc pl-5 space-y-1.5 text-zinc-300 text-sm leading-relaxed my-3">' +
        buf.map((t) => `<li>${esc(t.replace(/^\s*•\s*/, ""))}</li>`).join("") +
        "</ul>",
    );
  }

  function formatParagraphs(text) {
    const parts = String(text || "")
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.map((p) => `<p class="mb-2 last:mb-0">${esc(p).replace(/\n/g, "<br/>")}</p>`).join("");
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
      out.push(`<h3 class="text-lg font-bold coyote-text mb-3 mt-2 tracking-wide">${esc(trimmed)}</h3>`);
      i++;
      continue;
    }

    if (isDzial(trimmed)) {
      out.push(
        `<h3 class="text-xl md:text-2xl font-bold coyote-text mt-10 mb-4 pt-8 border-t border-zinc-700 first:mt-0 first:pt-0 first:border-t-0">${esc(trimmed)}</h3>`,
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
        if (isSection(t) || isDzial(t) || isSpis(t) || isBulletLine(l)) break;
        bodyLines.push(l);
        i++;
      }
      const bodyText = bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      out.push(
        `<div class="border-l-4 bg-zinc-800/40 rounded-r-lg pl-4 pr-3 py-3 mt-4 first:mt-0" style="border-left-color:var(--coyote,#C19A6B);border-left-style:solid">` +
          `<h4 class="text-base font-bold coyote-text mb-2">${esc(titleLine)}</h4>` +
          (bodyText ? `<div class="text-zinc-300 text-sm leading-relaxed">${formatParagraphs(bodyText)}</div>` : "") +
          `</div>`,
      );
      continue;
    }

    const paraLines = [];
    while (i < lines.length) {
      const l = lines[i];
      const t = l.trim();
      if (!t) break;
      if (isSection(t) || isDzial(t) || isSpis(t) || isBulletLine(l)) break;
      paraLines.push(l);
      i++;
    }
    const block = paraLines.join("\n").trim();
    if (!block) continue;

    const firstLine = block.split("\n")[0].trim();
    if (/^Regulamin witryny strzelca\.pl$/i.test(firstLine)) {
      out.push(
        `<h2 class="text-2xl md:text-3xl font-bold coyote-text mb-5 leading-tight">${esc(firstLine)}</h2>`,
      );
      const rest = block.split("\n").slice(1).join("\n").trim();
      if (rest) {
        out.push(
          `<div class="bg-zinc-800/60 p-5 rounded-xl border border-zinc-700/80 text-zinc-300 text-sm leading-relaxed mb-6">${formatParagraphs(rest)}</div>`,
        );
      }
    } else if (
      /^Regulamin strzelca\.pl$/i.test(firstLine) ||
      /^Regulamin Sklepu Internetowego/i.test(firstLine) ||
      /^Regulamin Użytkowania Serwisu Bazar/i.test(firstLine) ||
      /^Regulamin korzystania ze szkoleń/i.test(firstLine) ||
      /^Regulamin zamówień/i.test(firstLine)
    ) {
      out.push(
        `<div class="bg-zinc-800/50 p-4 rounded-lg mb-3" style="border:1px solid rgba(193,154,107,0.35)"><p class="text-lg font-bold text-zinc-100 coyote-text">${esc(firstLine)}</p></div>`,
      );
      const rest = block.split("\n").slice(1).join("\n").trim();
      if (rest) {
        out.push(`<div class="text-zinc-300 text-sm leading-relaxed mb-4">${formatParagraphs(rest)}</div>`);
      }
    } else {
      out.push(
        `<div class="bg-zinc-800/50 p-4 rounded-lg text-zinc-300 text-sm leading-relaxed mb-3 border border-zinc-700/40">${formatParagraphs(block)}</div>`,
      );
    }
  }

  const foot = includeFooter
    ? `<p class="text-zinc-500 text-xs mt-6 pt-4 border-t border-zinc-800">STRZELCA.PL — dokumenty i regulaminy · dokumenty.strzelca.pl</p>`
    : "";
  return `<div class="space-y-0 max-w-none regulamin-rich">${out.join("")}${foot}</div>`;
}
