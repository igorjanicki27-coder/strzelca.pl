const {
  initAdmin,
  admin,
  setCors,
  readJsonBody,
  getSessionUser,
} = require("./_sso-utils");
const { sendTransactionalEmail } = require("./_transactional-mail");
const {
  getUserRoleProfile,
  isAdminRoleProfile,
  canAccessBackofficeScope,
} = require("./_moderation");

async function isAdmin(uid) {
  if (!uid) return false;
  try {
    initAdmin();
    const profile = await getUserRoleProfile(admin.firestore(), uid);
    return isAdminRoleProfile(profile) || canAccessBackofficeScope(profile, "users");
  } catch (_) {
    return false;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildVerificationEmailHtml({ displayName, verificationLink }) {
  const safeName = escapeHtml(String(displayName || "").trim());
  const safeLink = escapeHtml(verificationLink);
  const greeting = safeName ? `Dzień dobry ${safeName},` : "Dzień dobry,";
  return `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Aktywuj konto na strzelca.pl</h2>
  <p>${greeting}</p>
  <p>Administrator ponownie wysłał link aktywacyjny do Twojego konta w serwisie strzelca.pl.</p>
  <p>Aby potwierdzić adres e-mail i aktywować konto, kliknij przycisk poniżej:</p>
  <p style="margin: 24px 0;">
    <a href="${safeLink}" style="display: inline-block; background: #c19a6b; color: #111; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 700;">
      Aktywuj konto
    </a>
  </p>
  <p>Jeśli przycisk nie działa, skopiuj ten adres do przeglądarki:</p>
  <p><a href="${safeLink}" style="color: #c19a6b;">${safeLink}</a></p>
  <p style="font-size: 13px; color: #666;">Jeśli to nie Ty zakładałeś konto, zignoruj tę wiadomość.</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`;
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: "POST, OPTIONS" });
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
    const sessionUser = await getSessionUser(req);
    if (!sessionUser?.uid || !(await isAdmin(sessionUser.uid))) {
      res.status(403).json({ success: false, error: "Brak uprawnień" });
      return;
    }

    const body = readJsonBody(req);
    const targetUserId = String(body?.targetUserId || "").trim();
    if (!targetUserId) {
      res.status(400).json({ success: false, error: "Wymagane pole: targetUserId" });
      return;
    }

    const db = admin.firestore();
    const profileSnap = await db.collection("userProfiles").doc(targetUserId).get();
    if (!profileSnap.exists) {
      res.status(404).json({ success: false, error: "Profil użytkownika nie istnieje" });
      return;
    }

    const profile = profileSnap.data() || {};
    const userRecord = await admin.auth().getUser(targetUserId);
    const email = String(userRecord.email || profile.email || "").trim();
    if (!email) {
      res.status(400).json({ success: false, error: "Użytkownik nie ma adresu e-mail" });
      return;
    }

    if (userRecord.emailVerified === true) {
      res.status(409).json({
        success: false,
        error: "Adres e-mail tego użytkownika jest już zweryfikowany",
        emailVerified: true,
      });
      return;
    }

    const verificationLink = await admin.auth().generateEmailVerificationLink(email, {
      url: "https://konto.strzelca.pl/akcja.html?mode=verifyEmail",
      handleCodeInApp: true,
    });

    await sendTransactionalEmail({
      to: email,
      subject: "Aktywuj konto na strzelca.pl",
      html: buildVerificationEmailHtml({
        displayName: profile.displayName || userRecord.displayName || "",
        verificationLink,
      }),
      logCategory: "account_activation_email",
      logMeta: {
        targetUserId,
        sentByAdminUid: sessionUser.uid,
      },
    });

    res.status(200).json({ success: true, sent: true, targetUserId });
  } catch (error) {
    console.error("admin-resend-activation-email:", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Nie udało się wysłać linku aktywacyjnego",
    });
  }
};
