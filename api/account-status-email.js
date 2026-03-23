// =============================================================================
// E-mail przy blokadzie / odblokowaniu konta (wywołanie z panelu admina)
// =============================================================================

const {
  initAdmin,
  admin,
  setCors,
  readJsonBody,
  getSessionUser,
} = require('./_sso-utils');
const { replaceTemplateVariables, sendTransactionalEmail } = require('./_transactional-mail');

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

async function isAdmin(uid) {
  if (!uid) return false;
  if (uid === SUPERADMIN_UID) return true;
  try {
    initAdmin();
    const profileDoc = await admin.firestore().collection('userProfiles').doc(uid).get();
    if (!profileDoc.exists) return false;
    return profileDoc.data()?.role === 'admin';
  } catch (_) {
    return false;
  }
}

function userGreetingFromProfile(data) {
  const n = (data?.displayName || '').trim();
  return n ? ` ${n}` : '';
}

function blockedUntilLabel(blockedUntil, isPermanent) {
  if (isPermanent || !blockedUntil) return 'Blokada bezterminowa (do decyzji administratora).';
  try {
    let d;
    if (typeof blockedUntil === 'string') d = new Date(blockedUntil);
    else if (blockedUntil.toDate) d = blockedUntil.toDate();
    else d = new Date(blockedUntil);
    if (Number.isNaN(d.getTime())) return 'Blokada czasowa.';
    return `Blokada do: ${d.toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short' })}.`;
  } catch (_) {
    return 'Blokada czasowa.';
  }
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'POST,OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    initAdmin();
    const sessionUser = await getSessionUser(req);
    if (!sessionUser || !(await isAdmin(sessionUser.uid))) {
      return res.status(403).json({ success: false, error: 'Brak uprawnień' });
    }

    const body = readJsonBody(req);
    if (!body?.targetUserId || !body?.kind) {
      return res.status(400).json({ success: false, error: 'Wymagane: targetUserId, kind' });
    }

    const { targetUserId, kind } = body;
    if (kind !== 'blocked' && kind !== 'unblocked') {
      return res.status(400).json({ success: false, error: 'kind musi być blocked lub unblocked' });
    }

    const db = admin.firestore();
    const profileDoc = await db.collection('userProfiles').doc(targetUserId).get();
    if (!profileDoc.exists) {
      return res.status(404).json({ success: false, error: 'Profil nie znaleziony' });
    }

    const profile = profileDoc.data();
    const to = (profile.email || '').trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(200).json({ success: true, skipped: true, reason: 'Brak adresu e-mail w profilu' });
    }

    const templateId = kind === 'blocked' ? 'account_blocked' : 'account_unblocked';
    const tdoc = await db.collection('emailTemplates').doc(templateId).get();
    if (!tdoc.exists) {
      return res.status(200).json({ success: true, skipped: true, reason: 'Brak szablonu w bazie' });
    }

    const t = tdoc.data();
    const supportEmail = 'kontakt@strzelca.pl';
    const userGreeting = userGreetingFromProfile(profile);

    let variables;
    if (kind === 'blocked') {
      const blockReason = (body.blockReason || profile.blockReason || 'Nie podano powodu.').trim();
      const isPermanent = body.isPermanent === true || profile.isPermanentBlock === true;
      const blockedUntil = body.blockedUntil != null ? body.blockedUntil : profile.blockedUntil;
      variables = {
        userGreeting,
        blockReason,
        blockedUntilText: blockedUntilLabel(blockedUntil, isPermanent),
        supportEmail,
      };
    } else {
      const automatic = body.automatic === true;
      variables = {
        userGreeting,
        unblockContext: automatic
          ? 'Odblokowanie nastąpiło automatycznie po upływie czasu blokady.'
          : 'Konto zostało odblokowane przez administratora.',
        supportEmail,
      };
    }

    const subject = replaceTemplateVariables(t.subject || '', variables);
    const html = replaceTemplateVariables(t.html || '', variables);
    await sendTransactionalEmail({
      to,
      subject,
      html,
      logCategory: 'account_email',
      logMeta: { templateId: templateId, kind },
    });

    return res.status(200).json({ success: true, sent: true });
  } catch (e) {
    console.error('account-status-email:', e);
    return res.status(500).json({
      success: false,
      error: e?.message || 'Błąd wysyłki',
    });
  }
};
