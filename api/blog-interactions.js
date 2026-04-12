const {
  initAdmin,
  admin,
  setCors,
  readJsonBody,
  getSessionUser,
} = require('./_sso-utils');
const {
  getUserRoleProfile,
  isAdminRoleProfile,
  isModeratorRoleProfile,
  hasOperatorScope,
} = require('./_moderation');
const { createUserNotification, cleanString } = require('./_notifications');

const COMMENT_MIN_LENGTH = 3;
const COMMENT_MAX_LENGTH = 3000;
const COMMENT_COOLDOWN_MS = 30 * 1000;
const DELETE_REASON_MIN_LENGTH = 5;
const DELETE_REASON_MAX_LENGTH = 500;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeComment(input) {
  const text = cleanString(String(input ?? '').replace(/\r\n/g, '\n'), COMMENT_MAX_LENGTH);
  const collapsed = text.trim();
  if (collapsed.length < COMMENT_MIN_LENGTH) {
    throw new Error(`Komentarz musi mieć co najmniej ${COMMENT_MIN_LENGTH} znaki.`);
  }
  return {
    text: collapsed,
    html: escapeHtml(collapsed).replace(/\n/g, '<br>'),
  };
}

function sanitizeModerationReason(input) {
  const text = cleanString(String(input ?? '').replace(/\r\n/g, '\n'), DELETE_REASON_MAX_LENGTH).trim();
  if (text.length < DELETE_REASON_MIN_LENGTH) {
    throw new Error(`Powód usunięcia musi mieć co najmniej ${DELETE_REASON_MIN_LENGTH} znaków.`);
  }
  return text;
}

function buildPostLikeId(postId, userId) {
  return `${postId}_${userId}`;
}

function buildCommentLikeId(commentId, userId) {
  return `${commentId}_${userId}`;
}

async function requireUser(req, res) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser?.uid) {
    res.status(401).json({ success: false, error: 'Musisz być zalogowany.' });
    return null;
  }
  return sessionUser;
}

async function getActorProfile(db, uid, fallbackEmail = '') {
  const snap = await db.collection('userProfiles').doc(uid).get();
  const data = snap.exists ? snap.data() || {} : {};
  return {
    uid,
    displayName: cleanString(data.displayName || fallbackEmail || 'Użytkownik', 120) || 'Użytkownik',
    avatar: cleanString(data.avatar || '', 4096),
    role: cleanString(data.role || 'user', 30).toLowerCase() || 'user',
  };
}

function canModerateBlogComments(roleProfile) {
  return isAdminRoleProfile(roleProfile) || isModeratorRoleProfile(roleProfile) || hasOperatorScope(roleProfile, 'blog');
}

function canViewBlogLikes(roleProfile) {
  return isAdminRoleProfile(roleProfile) || isModeratorRoleProfile(roleProfile) || hasOperatorScope(roleProfile, 'blog');
}

function createHttpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function fetchLikeUsers(db, collectionName, keyField, keyValue) {
  let snapshot;
  try {
    snapshot = await db.collection(collectionName)
      .where(keyField, '==', keyValue)
      .orderBy('createdAt', 'desc')
      .get();
  } catch (error) {
    if (error?.code === 9 || error?.code === 'failed-precondition') {
      snapshot = await db.collection(collectionName)
        .where(keyField, '==', keyValue)
        .get();
    } else {
      throw error;
    }
  }

  const likes = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  likes.sort((a, b) => {
    const aMs = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime() || 0;
    const bMs = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime() || 0;
    return bMs - aMs;
  });

  const uniqueUserIds = [...new Set(
    likes
      .map((item) => cleanString(item.userId || '', 128))
      .filter(Boolean)
  )];

  const profileMap = new Map();
  for (let i = 0; i < uniqueUserIds.length; i += 100) {
    const chunk = uniqueUserIds.slice(i, i + 100);
    const refs = chunk.map((uid) => db.collection('userProfiles').doc(uid));
    const snaps = refs.length ? await db.getAll(...refs) : [];
    snaps.forEach((profileSnap, index) => {
      const uid = chunk[index];
      const data = profileSnap.exists ? profileSnap.data() || {} : {};
      profileMap.set(uid, {
        uid,
        displayName: cleanString(data.displayName || data.email || 'Użytkownik', 120) || 'Użytkownik',
        email: cleanString(data.email || '', 200),
        avatar: cleanString(data.avatar || '', 4096),
        role: cleanString(data.role || 'user', 30).toLowerCase() || 'user',
      });
    });
  }

  return likes.map((item) => {
    const uid = cleanString(item.userId || '', 128);
    const profile = profileMap.get(uid) || {
      uid,
      displayName: 'Użytkownik',
      email: '',
      avatar: '',
      role: 'user',
    };
    return {
      userId: uid,
      displayName: profile.displayName,
      email: profile.email,
      avatar: profile.avatar,
      role: profile.role,
      likedAt: item.createdAt || null,
    };
  });
}

async function handleCreateComment(db, actor, body) {
  const postId = cleanString(body.postId, 128);
  const parentId = cleanString(body.parentId, 128);
  if (!postId) throw new Error('Brak postId.');
  const content = sanitizeComment(body.content || '');

  const postRef = db.collection('blogPosts').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) throw new Error('Wpis nie istnieje.');

  const latestCommentSnap = await db.collection('blogPostComments')
    .where('postId', '==', postId)
    .where('userId', '==', actor.uid)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  if (!latestCommentSnap.empty) {
    const latest = latestCommentSnap.docs[0].data() || {};
    const latestDate = latest.createdAt?.toDate ? latest.createdAt.toDate() : null;
    if (latestDate) {
      const diff = Date.now() - latestDate.getTime();
      if (diff < COMMENT_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((COMMENT_COOLDOWN_MS - diff) / 1000);
        const error = new Error('Możesz dodać kolejny komentarz do tego wpisu za kilka minut.');
        error.code = 'comment_cooldown';
        error.remainingSeconds = remainingSeconds;
        throw error;
      }
    }
  }

  let parentData = null;
  if (parentId) {
    const parentSnap = await db.collection('blogPostComments').doc(parentId).get();
    if (!parentSnap.exists) throw new Error('Komentarz nadrzędny nie istnieje.');
    parentData = { id: parentSnap.id, ...parentSnap.data() };
    if (String(parentData.postId || '') !== postId) {
      throw new Error('Komentarz nadrzędny należy do innego wpisu.');
    }
  }

  const commentRef = db.collection('blogPostComments').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.runTransaction(async (tx) => {
    tx.set(commentRef, {
      postId,
      parentId: parentId || '',
      userId: actor.uid,
      userDisplayName: actor.displayName,
      userAvatar: actor.avatar,
      userRole: actor.role,
      contentText: content.text,
      contentHtml: content.html,
      status: 'active',
      likeCount: 0,
      replyCount: 0,
      isEdited: false,
      editedAt: null,
      updatedAt: now,
      createdAt: now,
      editHistory: [],
    });
    tx.update(postRef, {
      commentCount: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
    });
    if (parentId) {
      tx.update(db.collection('blogPostComments').doc(parentId), {
        replyCount: admin.firestore.FieldValue.increment(1),
      });
    }
  });

  if (parentData && parentData.userId && parentData.userId !== actor.uid) {
    const postTitle = cleanString(postSnap.data()?.title || 'wpisu na blogu', 160);
    try {
      await createUserNotification(db, {
        userId: parentData.userId,
        title: 'Nowa odpowiedź na Twój komentarz',
        bodyHtml: `
          <p><strong>${escapeHtml(actor.displayName)}</strong> odpowiedział na Twój komentarz pod wpisem <strong>${escapeHtml(postTitle)}</strong>.</p>
          <p>${content.html}</p>
        `,
        category: 'blog',
        linkUrl: `https://blog.strzelca.pl/?open=${encodeURIComponent(postId)}`,
        linkLabel: 'Otwórz wpis',
        sourceType: 'blog_comment_reply',
        sourceId: commentRef.id,
        createdById: actor.uid,
        createdByName: actor.displayName,
      });
    } catch (notificationError) {
      console.warn('blog reply notification:', notificationError);
    }
  }

  return {
    commentId: commentRef.id,
    cooldownUntil: Date.now() + COMMENT_COOLDOWN_MS,
  };
}

async function handleEditComment(db, actor, body) {
  const commentId = cleanString(body.commentId, 128);
  if (!commentId) throw new Error('Brak commentId.');
  const nextContent = sanitizeComment(body.content || '');
  const commentRef = db.collection('blogPostComments').doc(commentId);
  const commentSnap = await commentRef.get();
  if (!commentSnap.exists) throw new Error('Komentarz nie istnieje.');
  const comment = commentSnap.data() || {};

  if (String(comment.userId || '') !== actor.uid) {
    throw new Error('Możesz edytować tylko własny komentarz.');
  }
  if (String(comment.status || 'active') !== 'active') {
    throw new Error('Nie można edytować usuniętego komentarza.');
  }

  const nextHistory = Array.isArray(comment.editHistory) ? [...comment.editHistory] : [];
  nextHistory.unshift({
    contentText: comment.contentText || '',
    contentHtml: comment.contentHtml || '',
    editedAt: comment.editedAt || comment.updatedAt || comment.createdAt || null,
  });

  await commentRef.update({
    contentText: nextContent.text,
    contentHtml: nextContent.html,
    isEdited: true,
    editedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    editHistory: nextHistory.slice(0, 20),
  });

  return { commentId };
}

async function handleDeleteComment(db, actor, actorRoleProfile, body) {
  const commentId = cleanString(body.commentId, 128);
  if (!commentId) throw new Error('Brak commentId.');
  if (!canModerateBlogComments(actorRoleProfile)) {
    throw new Error('Brak uprawnień do moderacji komentarzy bloga.');
  }
  const reason = sanitizeModerationReason(body.reason || '');

  const commentRef = db.collection('blogPostComments').doc(commentId);
  const commentSnap = await commentRef.get();
  if (!commentSnap.exists) throw new Error('Komentarz nie istnieje.');
  const comment = commentSnap.data() || {};
  if (String(comment.status || '') === 'deleted') {
    return { commentId, alreadyDeleted: true };
  }

  await db.runTransaction(async (tx) => {
    tx.update(commentRef, {
      status: 'deleted',
      contentText: '',
      contentHtml: '<p><em>Komentarz usunięty przez moderację.</em></p>',
      deleteReason: reason,
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      deletedById: actor.uid,
      deletedByRole: actor.role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.update(db.collection('blogPosts').doc(comment.postId), {
      commentCount: admin.firestore.FieldValue.increment(-1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (comment.parentId) {
      tx.update(db.collection('blogPostComments').doc(comment.parentId), {
        replyCount: admin.firestore.FieldValue.increment(-1),
      });
    }
  });

  if (comment.userId && comment.userId !== actor.uid) {
    try {
      await createUserNotification(db, {
        userId: comment.userId,
        title: 'Twój komentarz został usunięty',
        bodyHtml: `
          <p>Twój komentarz pod wpisem na blogu został usunięty przez moderację.</p>
          <p><strong>Powód:</strong> ${escapeHtml(reason)}</p>
        `,
        category: 'blog',
        linkUrl: comment.postId ? `https://blog.strzelca.pl/?open=${encodeURIComponent(comment.postId)}` : '',
        linkLabel: 'Otwórz wpis',
        sourceType: 'blog_comment_deleted',
        sourceId: commentId,
        createdById: actor.uid,
        createdByName: actor.displayName,
      });
    } catch (notificationError) {
      console.warn('blog delete notification:', notificationError);
    }
  }

  return { commentId, reason };
}

async function handleTogglePostLike(db, actor, body) {
  const postId = cleanString(body.postId, 128);
  if (!postId) throw new Error('Brak postId.');
  const postRef = db.collection('blogPosts').doc(postId);
  const likeRef = db.collection('blogPostLikes').doc(buildPostLikeId(postId, actor.uid));

  const result = await db.runTransaction(async (tx) => {
    const [postSnap, likeSnap] = await Promise.all([tx.get(postRef), tx.get(likeRef)]);
    if (!postSnap.exists) throw new Error('Wpis nie istnieje.');
    const currentlyLiked = likeSnap.exists;
    tx.update(postRef, {
      likeCount: admin.firestore.FieldValue.increment(currentlyLiked ? -1 : 1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (currentlyLiked) {
      tx.delete(likeRef);
    } else {
      tx.set(likeRef, {
        postId,
        userId: actor.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    const currentCount = Number(postSnap.data()?.likeCount || 0);
    return {
      liked: !currentlyLiked,
      likeCount: Math.max(0, currentCount + (currentlyLiked ? -1 : 1)),
    };
  });

  return result;
}

async function handleToggleCommentLike(db, actor, body) {
  const commentId = cleanString(body.commentId, 128);
  if (!commentId) throw new Error('Brak commentId.');
  const commentRef = db.collection('blogPostComments').doc(commentId);

  const result = await db.runTransaction(async (tx) => {
    const commentSnap = await tx.get(commentRef);
    if (!commentSnap.exists) throw new Error('Komentarz nie istnieje.');
    const comment = commentSnap.data() || {};
    if (String(comment.status || 'active') !== 'active') {
      throw new Error('Nie można polubić usuniętego komentarza.');
    }

    const likeRef = db.collection('blogCommentLikes').doc(buildCommentLikeId(commentId, actor.uid));
    const likeSnap = await tx.get(likeRef);
    const currentlyLiked = likeSnap.exists;

    tx.update(commentRef, {
      likeCount: admin.firestore.FieldValue.increment(currentlyLiked ? -1 : 1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (currentlyLiked) {
      tx.delete(likeRef);
    } else {
      tx.set(likeRef, {
        commentId,
        postId: cleanString(comment.postId || '', 128),
        userId: actor.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    const currentCount = Number(comment.likeCount || 0);
    return {
      liked: !currentlyLiked,
      likeCount: Math.max(0, currentCount + (currentlyLiked ? -1 : 1)),
      commentId,
    };
  });

  return result;
}

async function handleListPostLikes(db, actorRoleProfile, body) {
  if (!canViewBlogLikes(actorRoleProfile)) {
    throw createHttpError('Brak uprawnień do podglądu polubień wpisów bloga.', 403);
  }

  const postId = cleanString(body.postId, 128);
  if (!postId) throw new Error('Brak postId.');

  const postSnap = await db.collection('blogPosts').doc(postId).get();
  if (!postSnap.exists) {
    throw new Error('Wpis nie istnieje.');
  }

  const likes = await fetchLikeUsers(db, 'blogPostLikes', 'postId', postId);
  return {
    likes,
    likeCount: likes.length,
  };
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    initAdmin();
    const sessionUser = await requireUser(req, res);
    if (!sessionUser) return;

    const db = admin.firestore();
    const body = readJsonBody(req) || {};
    const action = cleanString(body.action, 60);
    const actor = await getActorProfile(db, sessionUser.uid, sessionUser.email || '');
    const actorRoleProfile = await getUserRoleProfile(db, sessionUser.uid);

    let data;
    switch (action) {
      case 'comment.create':
        data = await handleCreateComment(db, actor, body);
        break;
      case 'comment.edit':
        data = await handleEditComment(db, actor, body);
        break;
      case 'comment.delete':
        data = await handleDeleteComment(db, actor, actorRoleProfile, body);
        break;
      case 'post.toggleLike':
        data = await handleTogglePostLike(db, actor, body);
        break;
      case 'comment.toggleLike':
        data = await handleToggleCommentLike(db, actor, body);
        break;
      case 'post.likes.list':
        data = await handleListPostLikes(db, actorRoleProfile, body);
        break;
      default:
        return res.status(400).json({ success: false, error: 'Nieznana akcja.' });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('blog-interactions:', error);
    const status = error?.status || (error?.code === 'comment_cooldown' ? 429 : 400);
    return res.status(status).json({
      success: false,
      error: error?.message || 'Błąd bloga',
      code: error?.code || null,
      remainingSeconds: error?.remainingSeconds || null,
    });
  }
};
