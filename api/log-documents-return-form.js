// Audyt: wygenerowanie PDF formularza zwrotu/reklamacji na dokumenty.strzelca.pl → activityLogs (Admin SDK).
const { initAdmin, admin, setCors, readJsonBody } = require("./_sso-utils");

const MAX = {
  type: 24,
  imie: 100,
  nazwisko: 100,
  zamowienie: 160,
  faktura: 160,
  zadanie: 4000,
  dodatkowe: 8000,
  opis: 12000,
  powod: 8000,
};

function slice(s, max) {
  return String(s ?? "").trim().slice(0, max);
}

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  try {
    initAdmin();
    const body = readJsonBody(req);
    if (!body || typeof body !== "object") {
      res.status(400).json({ success: false, error: "Invalid body" });
      return;
    }

    const { idToken, payload, userAgent } = body;
    if (!payload || typeof payload !== "object") {
      res.status(400).json({ success: false, error: "Missing payload" });
      return;
    }

    const typ = slice(payload.type, MAX.type).toLowerCase();
    if (typ !== "zwrot" && typ !== "reklamacja") {
      res.status(400).json({ success: false, error: "Invalid form type" });
      return;
    }

    let uid = "anonymous";
    let userEmail = null;
    if (idToken && typeof idToken === "string" && idToken.length > 20) {
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        uid = decoded.uid;
        if (decoded.email) userEmail = String(decoded.email).slice(0, 320);
      } catch (_) {
        /* nie blokuj — gość */
      }
    }

    const details = {
      source: "dokumenty.strzelca.pl",
      typeRaw: typ,
      formKind:
        typ === "zwrot"
          ? "Zwrot (odstąpienie od umowy)"
          : "Reklamacja",
      imie: slice(payload.imie, MAX.imie),
      nazwisko: slice(payload.nazwisko, MAX.nazwisko),
      numerZamowienia: slice(
        payload.numerZamowienia ?? payload.zamowienie,
        MAX.zamowienie,
      ),
      numerFaktury: slice(payload.numerFaktury ?? payload.faktura, MAX.faktura),
      zadanie: slice(payload.zadanie, MAX.zadanie),
      dodatkoweInformacje: slice(
        payload.dodatkoweInformacje ?? payload.dodatkowe,
        MAX.dodatkowe,
      ),
      opisWady: typ === "reklamacja" ? slice(payload.opis, MAX.opis) : "",
      powodZwrotu: typ === "zwrot" ? slice(payload.powod, MAX.powod) : "",
      zalogowany: !!payload.zalogowany,
    };

    const db = admin.firestore();
    const doc = {
      userId: uid,
      action: "DOCS_RETURN_FORM_PDF",
      details,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (userEmail) doc.userEmail = userEmail;
    if (typeof userAgent === "string" && userAgent.length > 0) {
      doc.userAgent = userAgent.slice(0, 500);
    }

    await db.collection("activityLogs").add(doc);
    res.status(200).json({ success: true });
  } catch (e) {
    console.error("log-documents-return-form:", e);
    res.status(500).json({ success: false, error: "Server error" });
  }
};
