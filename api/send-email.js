// =============================================================================
// API WYSYŁANIA MAILI - SMTP dla Strzelca.pl (Vercel Serverless)
// =============================================================================

const nodemailer = require('nodemailer');
const {
  initAdmin,
  admin,
  setCors,
  getSessionUser,
  readJsonBody,
} = require('./_sso-utils');

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

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

  let mailTo = '';
  let mailSubject = '';

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

    mailTo = to;
    mailSubject = subject;

    if (!String(process.env.SMTP_PASSWORD || '').trim()) {
      res.status(503).json({
        success: false,
        error:
          'SMTP nie skonfigurowany na serwerze (brak SMTP_PASSWORD w Vercel).',
      });
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
    if (mailTo) {
      try {
        const { logEmailDeliveryFailure } = require('./_activity-email-log');
        await logEmailDeliveryFailure({
          category: 'admin_smtp',
          to: mailTo,
          subject: mailSubject,
          errorMessage: error.message || String(error),
          meta: { source: 'send-email' },
        });
      } catch (logErr) {
        console.error('logEmailDeliveryFailure:', logErr);
      }
    }
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send email: ' + (error.message || 'Unknown error') 
    });
  }
};
