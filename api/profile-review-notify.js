// =============================================================================
// Powiadomienie e-mail dla ocenionego użytkownika (nowa opinia na profilu)
// POST { reviewId } + Authorization: Bearer <Firebase ID token oceniającego>
// =============================================================================

const {
  initAdmin,
  admin,
  setCors,
  readJsonBody,
} = require('./_sso-utils');
const { replaceTemplateVariables, sendTransactionalEmail } = require('./_transactional-mail');
const { createUserNotification } = require('./_notifications');

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ratingStars(n) {
  const x = Math.min(5, Math.max(1, parseInt(n, 10) || 0));
  return '★'.repeat(x) + '☆'.repeat(5 - x);
}

function userGreetingFromName(displayName) {
  const n = String(displayName || '').trim();
  return n ? ` ${n}` : '';
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'POST,OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    initAdmin();
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Brak tokenu' });
    }
    const idToken = authHeader.substring(7);
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (_) {
      return res.status(401).json({ success: false, error: 'Nieprawidłowy token' });
    }
    const uid = decoded.uid;

    const body = readJsonBody(req);
    const reviewId = body?.reviewId ? String(body.reviewId).trim() : '';
    if (!reviewId) {
      return res.status(400).json({ success: false, error: 'Wymagane pole reviewId' });
    }

    const db = admin.firestore();
    const reviewSnap = await db.collection('userReviews').doc(reviewId).get();
    if (!reviewSnap.exists) {
      return res.status(404).json({ success: false, error: 'Opinia nie znaleziona' });
    }

    const rev = reviewSnap.data();
    if (rev.raterId !== uid) {
      return res.status(403).json({ success: false, error: 'Brak uprawnień' });
    }

    if (rev.status && rev.status !== 'approved') {
      return res.status(200).json({ success: true, skipped: true, reason: 'Opinia nie jest opublikowana' });
    }

    const ratedId = rev.ratedId;
    if (!ratedId) {
      return res.status(400).json({ success: false, error: 'Brak ratedId w opinii' });
    }

    const ratedPrivate = await db.collection('userProfiles').doc(ratedId).get();

    const rating = Math.min(5, Math.max(1, parseInt(rev.rating, 10) || 1));
    const raterName = escapeHtml(rev.raterName || 'Użytkownik');
    const commentRaw = String(rev.comment || '').trim();
    const comment = escapeHtml(commentRaw).replace(/\r\n/g, '\n').replace(/\n/g, '<br/>');

    const ratedName =
      (rev.ratedName && String(rev.ratedName).trim()) ||
      (ratedPrivate.exists ? String(ratedPrivate.data().displayName || '').trim() : '') ||
      '';

    const profileUrl = `https://konto.strzelca.pl/profil.html?uid=${encodeURIComponent(ratedId)}`;
    const supportEmail = 'kontakt@strzelca.pl';

    await createUserNotification(db, {
      userId: ratedId,
      title: 'Nowa ocena Twojego profilu',
      bodyHtml: `
        <p><strong>${raterName}</strong> ocenił Twój profil na <strong>${rating}/5</strong>.</p>
        <p>${comment || 'Dodano ocenę bez komentarza.'}</p>
      `,
      category: 'profile',
      linkUrl: profileUrl,
      linkLabel: 'Przejdź do profilu',
      sourceType: 'user_review',
      sourceId: reviewId,
      createdById: uid,
      createdByName: rev.raterName || 'Użytkownik',
    });

    const to = ratedPrivate.exists ? String(ratedPrivate.data().email || '').trim() : '';
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(200).json({ success: true, sent: false, inAppOnly: true, reason: 'Brak adresu e-mail u ocenianego' });
    }

    const tdoc = await db.collection('emailTemplates').doc('account_review_received').get();
    if (!tdoc.exists) {
      return res.status(200).json({ success: true, sent: false, inAppOnly: true, reason: 'Brak szablonu account_review_received' });
    }

    const variables = {
      userGreeting: userGreetingFromName(ratedName),
      raterName,
      ratingLabel: `${rating} na 5`,
      ratingStars: ratingStars(rating),
      comment: comment || '—',
      profileUrl,
      supportEmail,
    };

    const t = tdoc.data();
    const subject = replaceTemplateVariables(t.subject || '', variables);
    const html = replaceTemplateVariables(t.html || '', variables);
    await sendTransactionalEmail({
      to,
      subject,
      html,
      logCategory: 'profile_review_email',
      logMeta: { templateId: 'account_review_received', reviewId },
    });

    return res.status(200).json({ success: true, sent: true });
  } catch (e) {
    console.error('profile-review-notify:', e);
    return res.status(500).json({
      success: false,
      error: e?.message || 'Błąd serwera',
    });
  }
};
