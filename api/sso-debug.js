const { initAdmin, getAdminProjectInfo, setCors } = require("./_sso-utils");

function safeProjectFromServiceAccountEnv() {
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) return null;
    const obj = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    return {
      project_id: obj.project_id || null,
      client_email: obj.client_email || null,
      private_key_id: obj.private_key_id || null,
      has_private_key: typeof obj.private_key === "string" && obj.private_key.includes("BEGIN PRIVATE KEY"),
    };
  } catch {
    return { parse_error: true };
  }
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: "GET, OPTIONS" });
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  // Best-effort init (nie wycieka sekretów)
  try {
    initAdmin();
  } catch (e) {
    res.status(200).json({
      success: true,
      ok: false,
      initError: (e?.message || "").slice(0, 200) || "unknown",
      env: {
        has_FIREBASE_SERVICE_ACCOUNT_KEY: !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
        has_GOOGLE_APPLICATION_CREDENTIALS_JSON: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
        has_GOOGLE_APPLICATION_CREDENTIALS: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
        FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || null,
      },
      serviceAccountEnv: safeProjectFromServiceAccountEnv(),
      project: getAdminProjectInfo ? getAdminProjectInfo() : null,
      vercel: {
        env: process.env.VERCEL_ENV || null,
        region: process.env.VERCEL_REGION || null,
        gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      },
    });
    return;
  }

  res.status(200).json({
    success: true,
    ok: true,
    env: {
      has_FIREBASE_SERVICE_ACCOUNT_KEY: !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
      has_GOOGLE_APPLICATION_CREDENTIALS_JSON: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
      has_GOOGLE_APPLICATION_CREDENTIALS: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || null,
    },
    serviceAccountEnv: safeProjectFromServiceAccountEnv(),
    project: getAdminProjectInfo ? getAdminProjectInfo() : null,
    vercel: {
      env: process.env.VERCEL_ENV || null,
      region: process.env.VERCEL_REGION || null,
      gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    },
  });
};

