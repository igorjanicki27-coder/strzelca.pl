/**
 * Używamy jednego kanonicznego authDomain dla całego ekosystemu strzelca.pl.
 * Dzięki temu Google OAuth zawsze trafia w ten sam redirect URI
 * (`https://strzelca.pl/__/auth/handler`) niezależnie od subdomeny startowej.
 */
export function resolveStrzelcaAuthDomain() {
  if (typeof window === "undefined") return "strzelca-pl.firebaseapp.com";
  const h = String(window.location.hostname || "")
    .toLowerCase()
    .replace(/^www\./, "");
  if (h === "strzelca.pl" || h.endsWith(".strzelca.pl")) return "strzelca.pl";
  return "strzelca-pl.firebaseapp.com";
}
