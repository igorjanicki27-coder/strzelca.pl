const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

const OPERATOR_SCOPES = {
  blog: 'blog',
  shop: 'shop',
  help: 'help',
  events: 'events',
  trainings: 'trainings',
  bazaar: 'bazaar',
  users: 'users',
  contact: 'contact',
};

const SEARCH_TYPE_TO_SCOPE = {
  shop: OPERATOR_SCOPES.shop,
  event: OPERATOR_SCOPES.events,
  blog: OPERATOR_SCOPES.blog,
  bazar: OPERATOR_SCOPES.bazaar,
};

function normalizeOperatorScopes(value) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(Object.values(OPERATOR_SCOPES));
  return value
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item, index, list) => allowed.has(item) && list.indexOf(item) === index);
}

async function getUserRoleProfile(db, uid) {
  if (!uid) return null;
  if (uid === SUPERADMIN_UID) {
    return {
      uid,
      role: 'admin',
      operatorScopes: Object.values(OPERATOR_SCOPES),
      isSuperAdmin: true,
    };
  }

  const snap = await db.collection('userProfiles').doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    uid,
    role: String(data.role || '').toLowerCase(),
    operatorScopes: normalizeOperatorScopes(data.operatorScopes || data.moderatorScopes),
    isSuperAdmin: false,
  };
}

function isAdminRoleProfile(profile) {
  return !!profile && profile.role === 'admin';
}

function isOperatorRoleProfile(profile) {
  return !!profile && profile.role === 'operator';
}

function isModeratorRoleProfile(profile) {
  return !!profile && profile.role === 'moderator';
}

function hasOperatorScope(profile, scope) {
  if (isModeratorRoleProfile(profile)) return true;
  return isOperatorRoleProfile(profile) && normalizeOperatorScopes(profile.operatorScopes).includes(scope);
}

function canAccessBackofficeScope(profile, scope) {
  return isAdminRoleProfile(profile) || hasOperatorScope(profile, scope);
}

function canManageSearchType(profile, type) {
  if (isAdminRoleProfile(profile)) return true;
  const scope = SEARCH_TYPE_TO_SCOPE[String(type || '').trim().toLowerCase()];
  return !!scope && hasOperatorScope(profile, scope);
}

module.exports = {
  SUPERADMIN_UID,
  OPERATOR_SCOPES,
  SEARCH_TYPE_TO_SCOPE,
  normalizeOperatorScopes,
  getUserRoleProfile,
  isAdminRoleProfile,
  isOperatorRoleProfile,
  isModeratorRoleProfile,
  hasOperatorScope,
  canAccessBackofficeScope,
  canManageSearchType,
  normalizeModeratorScopes: normalizeOperatorScopes,
  hasModeratorScope: hasOperatorScope,
  canAccessModeratorScope: canAccessBackofficeScope,
};
