/**
 * Pierwsze logowanie Google (m.in. auth-widget na strzelca.pl): utworzenie userProfiles,
 * publicProfiles i rezerwacji displayNames — ta sama logika co konto.strzelca.pl/logowanie.html.
 */

const FIRESTORE_MOD =
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function isGoogleProviderUser(user) {
  return !!user?.providerData?.some((p) => p?.providerId === "google.com");
}

function sanitizeDisplayNameCandidate(value) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "");

  if (normalized.length >= 3) return normalized.slice(0, 12);
  return `${normalized}strzelec`.slice(0, 12);
}

async function buildUniqueDisplayName(db, user) {
  const { doc, getDoc } = await import(FIRESTORE_MOD);

  const emailLocalPart = String(user?.email || "").split("@")[0] || "";
  const baseCandidate = sanitizeDisplayNameCandidate(
    user?.displayName ||
      emailLocalPart ||
      `strzelec${String(user?.uid || "").slice(0, 4)}`,
  );
  const suffixSeed =
    String(user?.uid || "0000")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase() || "0000";

  for (let i = 0; i < 20; i += 1) {
    let candidate = baseCandidate;
    if (i > 0) {
      const suffix = suffixSeed.slice(0, Math.min(4, i + 1));
      const trimmedBase = baseCandidate.slice(0, Math.max(3, 12 - suffix.length));
      candidate = `${trimmedBase}${suffix}`;
    }

    const snap = await getDoc(doc(db, "displayNames", candidate.toLowerCase()));
    if (!snap.exists() || snap.data()?.userId === user.uid) {
      return candidate;
    }
  }

  return `strz${suffixSeed.slice(0, 8)}`.slice(0, 12);
}

/**
 * @returns {Promise<{ created: boolean, displayName?: string }>}
 */
export async function ensureGoogleUserProfileIfNeeded(app, user) {
  if (!app || !user?.uid || !isGoogleProviderUser(user)) {
    return { created: false };
  }

  const { getFirestore, doc, getDoc, setDoc, deleteDoc } = await import(FIRESTORE_MOD);

  const db = getFirestore(app);
  const profileRef = doc(db, "userProfiles", user.uid);
  const existingProfile = await getDoc(profileRef);
  if (existingProfile.exists()) {
    return { created: false };
  }

  const displayName = await buildUniqueDisplayName(db, user);
  const displayNameRef = doc(db, "displayNames", displayName.toLowerCase());
  const publicProfileRef = doc(db, "publicProfiles", user.uid);
  const email = String(user.email || "")
    .trim()
    .toLowerCase();
  const providerName =
    user.providerData?.find((p) => p?.providerId === "google.com")?.displayName ||
    user.displayName ||
    "";

  await setDoc(displayNameRef, {
    displayName,
    userId: user.uid,
    createdAt: new Date(),
  });

  try {
    await setDoc(profileRef, {
      uid: user.uid,
      displayName,
      gender: "",
      firstName: "",
      lastName: "",
      email,
      phone: "",
      parcelLocker: "",
      address: {
        street: "",
        buildingNumber: "",
        postalCode: "",
        city: "",
      },
      ageConfirmed: false,
      termsAccepted: false,
      privacyAccepted: false,
      newsletter: false,
      createdAt: new Date(),
      emailVerified: user.emailVerified === true,
      role: "user",
      status: "active",
      operatorScopes: [],
      authProvider: "google.com",
      providerDisplayName: providerName,
    });

    await setDoc(publicProfileRef, {
      displayName,
      avatar: user.photoURL || "",
      updatedAt: new Date(),
      role: "user",
      emailVerified: user.emailVerified === true,
    });
  } catch (provisionError) {
    try {
      await deleteDoc(displayNameRef);
    } catch {}
    throw provisionError;
  }

  return { created: true, displayName };
}
