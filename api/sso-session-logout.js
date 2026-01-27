const { setCors, clearSessionCookie } = require("./_sso-utils");

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

  clearSessionCookie(res);
  res.status(200).json({ success: true });
};

