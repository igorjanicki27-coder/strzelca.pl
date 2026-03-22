/**
 * Wspólna logika katalogu dokumentów: dokumenty.strzelca.pl + panel admina.
 * Jedna lista (szablon + Firestore), ta sama kolejność po polu order.
 */

export const FALLBACK_SITE_DOCUMENTS = [
  {
    kind: "file",
    url: "regulamin-witryny.txt",
    title: "Regulamin witryny",
    description: "Jeden dokument tekstowy: wszystkie wcześniejsze regulaminy + regulamin zamówień.",
    icon: "fa-file-lines",
    order: -1,
  },
  {
    kind: "modal",
    modalTarget: "polityka-prywatnosci-platformy",
    title: "Polityka Prywatności Platformy",
    icon: "fa-user-shield",
    order: 0,
  },
  { kind: "modal", modalTarget: "polityka-prywatnosci", title: "Polityka Prywatności Sklepu", icon: "fa-shield-alt", order: 1 },
  {
    kind: "form",
    formId: "zwrot-reklamacja",
    title: "Formularz odstąpienia od umowy zwrotu/reklamacji",
    icon: "fa-file-signature",
    order: 2,
  },
  { kind: "file", url: "pdf/instrukcja-bezpieczenstwa.html", title: "Instrukcja Bezpieczeństwa Zestawu", icon: "fa-shield-alt", order: 3 },
  { kind: "modal", modalTarget: "klauzula-donacji", title: "Klauzula Donacji", icon: "fa-heart", order: 4 },
  { kind: "file", url: "pdf/oswiadczenie-zgodnosci.html", title: "Oświadczenie o zgodności zestawu", icon: "fa-check-circle", order: 5 },
  {
    kind: "modal",
    modalTarget: "procedura-monitorowania",
    title: "Procedura monitorowania po wprowadzeniu do obrotu",
    icon: "fa-chart-line",
    order: 6,
  },
];

/** URL zapisywany w Firestore (spójny z wcześniejszym importem w panelu). */
export function catalogFileUrlForFirestore(pathOrUrl) {
  const t = String(pathOrUrl || "").trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://dokumenty.strzelca.pl/${t.replace(/^\/+/, "")}`;
}

export function normDocPath(url) {
  try {
    const t = String(url || "").trim();
    if (!t) return "";
    if (/^https?:\/\//i.test(t)) {
      const p = new URL(t).pathname.replace(/^\/+|\/+$/g, "");
      return p.toLowerCase();
    }
    return t.replace(/^\/+|\/+$/g, "").toLowerCase();
  } catch {
    return String(url || "").trim().toLowerCase();
  }
}

export function normalizeFirestoreCatalogDocument(data) {
  const order = typeof data.order === "number" ? data.order : 0;
  const rawKind = String(data.kind || "").toLowerCase();
  if (rawKind === "modal") {
    const modalTarget = String(data.modalTarget || "").trim();
    if (!modalTarget || !/^[a-z0-9-]+$/i.test(modalTarget) || !data.title) return null;
    return {
      kind: "modal",
      modalTarget,
      title: data.title,
      description: data.description || "",
      icon: data.icon || "fa-file-lines",
      order,
    };
  }
  if (rawKind === "form") {
    const formId = String(data.formId || "").trim();
    if (!formId || !/^[a-z0-9-]+$/i.test(formId) || !data.title) return null;
    return {
      kind: "form",
      formId,
      title: data.title,
      description: data.description || "",
      icon: data.icon || "fa-file-signature",
      order,
    };
  }
  if (!data.title || !data.url) return null;
  return {
    kind: "file",
    url: data.url,
    title: data.title,
    description: data.description || "",
    icon: data.icon || "fa-file-pdf",
    order,
  };
}

/**
 * Scal szablon z wpisami z Firestore (obiekty z pola kind/title/…; opcjonalnie id poza tym modułem).
 */
export function mergeSiteDocumentsWithFallback(dbItems) {
  const consumed = new WeakSet();
  const merged = [];

  const findDbModal = (mt) => dbItems.find((i) => i.kind === "modal" && i.modalTarget === mt);
  const findDbFile = (fbUrl) => {
    const fp = normDocPath(fbUrl);
    return dbItems.find((i) => i.kind === "file" && normDocPath(i.url) === fp);
  };
  const findDbForm = (fid) => dbItems.find((i) => i.kind === "form" && String(i.formId || "").trim() === fid);

  const DEPRECATED_FILE_PATHS = new Set([
    normDocPath("pdf/formularz-odstapienia.html"),
    normDocPath("pdf/formularz-reklamacyjny.html"),
    normDocPath("regulamin-witryny.html"),
  ]);

  const DEPRECATED_MODAL_TARGETS = new Set([
    "regulamin-platformy",
    "regulamin-sklepu",
    "regulamin-bazar",
    "regulamin-szkolen",
  ]);

  for (const fb of FALLBACK_SITE_DOCUMENTS) {
    if (fb.kind === "modal") {
      const hit = findDbModal(fb.modalTarget);
      if (hit) {
        merged.push(hit);
        consumed.add(hit);
      } else {
        merged.push({ ...fb });
      }
    } else if (fb.kind === "form") {
      const fid = String(fb.formId || "").trim();
      const hit = fid ? findDbForm(fid) : null;
      if (hit) {
        merged.push(hit);
        consumed.add(hit);
      } else {
        merged.push({ ...fb });
      }
    } else {
      const hit = findDbFile(fb.url);
      if (hit) {
        merged.push(hit);
        consumed.add(hit);
      } else {
        merged.push({ ...fb });
      }
    }
  }

  const extras = dbItems.filter((i) => !consumed.has(i));
  const MODAL_LEGACY_FILE_PATHS = [
    { modalTarget: "procedura-monitorowania", path: "pdf/procedura-monitorowania.html" },
    { modalTarget: "klauzula-donacji", path: "pdf/klauzula-donacji.html" },
  ];
  const extrasDeduped = extras.filter((i) => {
    if (i.kind === "modal" && DEPRECATED_MODAL_TARGETS.has(String(i.modalTarget || "").trim())) return false;
    if (i.kind === "file") {
      const p = normDocPath(i.url);
      if (DEPRECATED_FILE_PATHS.has(p)) return false;
      for (const { modalTarget, path } of MODAL_LEGACY_FILE_PATHS) {
        const hasModal = merged.some((m) => m.kind === "modal" && m.modalTarget === modalTarget);
        if (hasModal && p === normDocPath(path)) return false;
      }
    }
    return true;
  });

  function catalogSortKey(item) {
    const o = item.order;
    if (typeof o === "number" && Number.isFinite(o)) return o;
    return 1e9;
  }
  const combined = merged.concat(extrasDeduped);
  combined.sort((a, b) => {
    const d = catalogSortKey(a) - catalogSortKey(b);
    if (d !== 0) return d;
    return String(a.title || "").localeCompare(String(b.title || ""), "pl");
  });
  return combined;
}
