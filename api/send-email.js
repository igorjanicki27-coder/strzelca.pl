// =============================================================================
// API WYSYŁANIA MAILI - SMTP dla Strzelca.pl (Vercel Serverless)
// =============================================================================

const nodemailer = require('nodemailer');
const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
  readJsonBody,
} = require('./_sso-utils');

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

async function getSessionUser(req) {
  try {
    initAdmin();
    const cookies = parseCookies(req.headers.cookie || '');
    const cookieName = getCookieName();
    const sessionCookie = cookies[cookieName];
    
    if (sessionCookie) {
      try {
        const decoded = verifyLocalSessionJwt(sessionCookie);
        if (decoded?.uid) {
          return { uid: decoded.uid, emailVerified: decoded.emailVerified === true };
        }
      } catch (e) {
        console.debug('getSessionUser: Cookie SSO verification failed', e?.message);
      }
    }
    
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.substring(7);
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        if (decoded?.uid) {
          return { uid: decoded.uid, emailVerified: decoded.email_verified === true };
        }
      } catch (e) {
        console.debug('getSessionUser: Firebase Auth token verification failed', e?.message);
      }
    }
    
    return null;
  } catch (e) {
    console.debug('getSessionUser error:', e?.message || e);
    return null;
  }
}

async function isAdmin(uid) {
  if (!uid) return false;
  if (uid === SUPERADMIN_UID) return true;
  
  try {
    initAdmin();
    const db = admin.firestore();
    const profileDoc = await db.collection('userProfiles').doc(uid).get();
    if (!profileDoc.exists) return false;
    const profile = profileDoc.data();
    return profile?.role === 'admin';
  } catch (e) {
    console.error('Error checking admin status:', e);
    return false;
  }
}

// Tworzenie transportera SMTP
function createTransporter() {
  // Konfiguracja z zmiennych środowiskowych
  const smtpConfig = {
    host: process.env.SMTP_HOST || 'ssl0.ovh.net',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER || 'kontakt@strzelca.pl',
      pass: process.env.SMTP_PASSWORD || '',
    },
  };

  return nodemailer.createTransport(smtpConfig);
}

// Zamiana zmiennych w szablonie
function replaceTemplateVariables(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    result = result.replace(regex, value || '');
  }
  return result;
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'POST,OPTIONS' });
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  try {
    initAdmin();
    const sessionUser = await getSessionUser(req);
    
    if (!sessionUser) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isUserAdmin = await isAdmin(sessionUser.uid);
    
    if (!isUserAdmin) {
      res.status(403).json({ success: false, error: 'Forbidden - admin only' });
      return;
    }

    const body = readJsonBody(req);
    if (!body) {
      res.status(400).json({ success: false, error: 'Invalid request body' });
      return;
    }

    const { to, subject, html, attachments } = body;

    if (!to || !subject || !html) {
      res.status(400).json({ success: false, error: 'to, subject, and html are required' });
      return;
    }

    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"Strzelca.pl" <${process.env.SMTP_USER || 'kontakt@strzelca.pl'}>`,
      to,
      subject,
      html,
      attachments: attachments || [],
    };

    const info = await transporter.sendMail(mailOptions);
    
    res.status(200).json({ 
      success: true, 
      messageId: info.messageId,
      message: 'Email sent successfully' 
    });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send email: ' + (error.message || 'Unknown error') 
    });
  }
};
