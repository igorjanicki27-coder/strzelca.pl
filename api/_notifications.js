const { admin } = require('./_sso-utils');

const ALLOWED_AUDIENCE_ROLES = ['user', 'company', 'admin', 'moderator', 'operator'];
const ALLOWED_CATEGORIES = ['general', 'system', 'account', 'profile', 'blog', 'events', 'bazaar', 'admin'];

function cleanString(value, max = 5000) {
  return String(value == null ? '' : value)
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);
}

function stripHtml(html) {
  return cleanString(String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' '), 8000);
}

function sanitizeRichHtml(html) {
  let safe = String(html || '');
  safe = safe.replace(/<(script|style|iframe|object|embed|meta|link)[^>]*>[\s\S]*?<\/\1>/gi, '');
  safe = safe.replace(/<(script|style|iframe|object|embed|meta|link)[^>]*\/?>/gi, '');
  safe = safe.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '');
  safe = safe.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  safe = safe.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
  return safe.trim();
}

function sanitizeLinkUrl(value) {
  let url = cleanString(value, 2048);
  if (!url) return '';
  if (url.startsWith('//')) return '';
  if (url.startsWith('/')) return url;

  if (!/^https?:\/\//i.test(url)) {
    const hostPart = url.split('/')[0].split('?')[0].split('#')[0];
    const looksLikeHost =
      hostPart.includes('.') &&
      /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(hostPart);
    if (looksLikeHost) {
      url = `https://${url}`;
    } else {
      return '';
    }
  }
  if (/^https:\/\/[a-z0-9./?#[\]@!$&'()*+,;=%:_-]+$/i.test(url)) return url;
  if (/^http:\/\/[a-z0-9./?#[\]@!$&'()*+,;=%:_-]+$/i.test(url)) return url;
  return '';
}

function normalizeCategory(value) {
  const category = cleanString(value, 40).toLowerCase();
  return ALLOWED_CATEGORIES.includes(category) ? category : 'general';
}

function normalizeAudience(input = {}) {
  const all = !!input.all;
  const roles = Array.isArray(input.roles)
    ? input.roles
        .map((role) => cleanString(role, 30).toLowerCase())
        .filter((role, index, list) => ALLOWED_AUDIENCE_ROLES.includes(role) && list.indexOf(role) === index)
    : [];
  const userIds = Array.isArray(input.userIds)
    ? input.userIds
        .map((userId) => cleanString(userId, 128))
        .filter((userId, index, list) => userId && list.indexOf(userId) === index)
        .slice(0, 500)
    : [];

  if (!all && roles.length === 0 && userIds.length === 0) {
    throw new Error('Wybierz co najmniej jedną grupę odbiorców lub użytkownika.');
  }

  return { all, roles, userIds };
}

function normalizeBasePayload(input = {}) {
  const title = cleanString(input.title, 160);
  const bodyHtml = sanitizeRichHtml(input.bodyHtml || input.contentHtml || '');
  const bodyText = stripHtml(bodyHtml);
  const linkUrl = sanitizeLinkUrl(input.linkUrl);
  const linkLabel = cleanString(input.linkLabel || '', 80);
  const category = normalizeCategory(input.category);

  if (!title) throw new Error('Tytuł jest wymagany.');
  if (!bodyHtml || !bodyText) throw new Error('Treść jest wymagana.');

  return {
    title,
    bodyHtml,
    bodyText,
    category,
    linkUrl,
    linkLabel,
  };
}

async function resolveAudienceUserIds(db, audience) {
  const selected = new Set(audience.userIds || []);
  const roles = new Set(audience.roles || []);

  if (!audience.all && roles.size === 0) {
    return Array.from(selected);
  }

  const snap = await db.collection('userProfiles').select('role').get();
  snap.forEach((docSnap) => {
    const role = cleanString(docSnap.data()?.role || 'user', 30).toLowerCase() || 'user';
    if (audience.all || roles.has(role)) {
      selected.add(docSnap.id);
    }
  });
  return Array.from(selected);
}

async function createUserNotification(db, payload = {}) {
  const base = normalizeBasePayload(payload);
  const userId = cleanString(payload.userId, 128);
  if (!userId) throw new Error('Brak userId dla powiadomienia.');

  const docRef = await db.collection('userNotifications').add({
    userId,
    title: base.title,
    bodyHtml: base.bodyHtml,
    bodyText: base.bodyText,
    category: base.category,
    linkUrl: base.linkUrl,
    linkLabel: base.linkLabel,
    isRead: false,
    readAt: null,
    sourceType: cleanString(payload.sourceType || '', 60),
    sourceId: cleanString(payload.sourceId || '', 128),
    createdById: cleanString(payload.createdById || 'system', 128) || 'system',
    createdByName: cleanString(payload.createdByName || 'System', 120) || 'System',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return docRef;
}

async function createUserNotificationsBatch(db, userIds, payload = {}) {
  const base = normalizeBasePayload(payload);
  const uniqueUserIds = Array.from(new Set((userIds || []).map((item) => cleanString(item, 128)).filter(Boolean)));
  const chunks = [];
  for (let i = 0; i < uniqueUserIds.length; i += 400) {
    chunks.push(uniqueUserIds.slice(i, i + 400));
  }

  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach((userId) => {
      const ref = db.collection('userNotifications').doc();
      batch.set(ref, {
        userId,
        title: base.title,
        bodyHtml: base.bodyHtml,
        bodyText: base.bodyText,
        category: base.category,
        linkUrl: base.linkUrl,
        linkLabel: base.linkLabel,
        isRead: false,
        readAt: null,
        sourceType: cleanString(payload.sourceType || '', 60),
        sourceId: cleanString(payload.sourceId || '', 128),
        createdById: cleanString(payload.createdById || 'system', 128) || 'system',
        createdByName: cleanString(payload.createdByName || 'System', 120) || 'System',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }

  return uniqueUserIds.length;
}

async function createAdminBroadcast(db, actor, input = {}) {
  const audience = normalizeAudience(input.audience);
  const base = normalizeBasePayload(input);
  const targetUserIds = await resolveAudienceUserIds(db, audience);

  const campaignRef = db.collection('adminNotificationCampaigns').doc();
  await campaignRef.set({
    kind: 'notification',
    title: base.title,
    bodyHtml: base.bodyHtml,
    bodyText: base.bodyText,
    category: base.category,
    linkUrl: base.linkUrl,
    linkLabel: base.linkLabel,
    audienceAll: audience.all,
    targetRoles: audience.roles,
    targetUserIds: audience.userIds,
    deliveredCount: 0,
    status: 'processing',
    createdById: cleanString(actor?.uid || 'system', 128) || 'system',
    createdByName: cleanString(actor?.displayName || 'System', 120) || 'System',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const deliveredCount = await createUserNotificationsBatch(db, targetUserIds, {
    ...base,
    sourceType: 'admin_campaign',
    sourceId: campaignRef.id,
    createdById: actor?.uid || 'system',
    createdByName: actor?.displayName || 'System',
  });

  await campaignRef.set(
    {
      deliveredCount,
      status: 'sent',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { id: campaignRef.id, deliveredCount, audience };
}

async function createInfoWindow(db, actor, input = {}) {
  const audience = normalizeAudience(input.audience);
  const base = normalizeBasePayload(input);
  const targetUserIds = await resolveAudienceUserIds(db, audience);
  const recipientCount = targetUserIds.length;

  const docRef = await db.collection('infoAnnouncements').add({
    kind: 'info',
    title: base.title,
    bodyHtml: base.bodyHtml,
    bodyText: base.bodyText,
    category: base.category,
    linkUrl: base.linkUrl,
    linkLabel: base.linkLabel,
    audienceAll: audience.all,
    targetRoles: audience.roles,
    targetUserIds: audience.userIds,
    recipientCount,
    isActive: true,
    createdById: cleanString(actor?.uid || 'system', 128) || 'system',
    createdByName: cleanString(actor?.displayName || 'System', 120) || 'System',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { id: docRef.id, audience, recipientCount };
}

module.exports = {
  ALLOWED_AUDIENCE_ROLES,
  ALLOWED_CATEGORIES,
  cleanString,
  stripHtml,
  sanitizeRichHtml,
  sanitizeLinkUrl,
  normalizeAudience,
  normalizeBasePayload,
  resolveAudienceUserIds,
  createUserNotification,
  createUserNotificationsBatch,
  createAdminBroadcast,
  createInfoWindow,
};
