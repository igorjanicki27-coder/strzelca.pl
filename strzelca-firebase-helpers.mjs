/**
 * Dla signInWithRedirect na strzelca.pl (hosting poza firebaseapp.com):
 * authDomain musi być tą samą domeną co strona — inaczej przeglądarki blokują
 * dostęp do storage między strzelca.pl a *.firebaseapp.com (Firebase docs: redirect best practices).
 */
export function resolveStrzelcaAuthDomain() {
  if (typeof window === "undefined") return "strzelca-pl.firebaseapp.com";
  const h = String(window.location.hostname || "")
    .toLowerCase()
    .replace(/^www\./, "");
  if (h === "strzelca.pl" || h.endsWith(".strzelca.pl")) return h;
  return "strzelca-pl.firebaseapp.com";
}
