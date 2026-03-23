// =============================================================================
// API WYSYŁANIA EMAILI Z FORMULARZA KONTAKTOWEGO - SMTP dla Strzelca.pl
// =============================================================================

const nodemailer = require('nodemailer');
const {
  initAdmin,
  admin,
  setCors,
  readJsonBody,
} = require('./_sso-utils');

// Tworzenie transportera SMTP
function createTransporter() {
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
    result = result.replace(regex, (value || '').toString().replace(/</g, '&lt;').replace(/>/g, '&gt;'));
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
    const db = admin.firestore();
    const body = readJsonBody(req);
    
    if (!body) {
      res.status(400).json({ success: false, error: 'Invalid request body' });
      return;
    }

    const { to, senderName, message } = body;

    if (!to || !senderName || !message) {
      res.status(400).json({ success: false, error: 'to, senderName, and message are required' });
      return;
    }

    // Walidacja emaila
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to) || to.length > 50) {
      res.status(400).json({ success: false, error: 'Invalid email format or length' });
      return;
    }

    mailTo = to;

    // Pobierz szablon z Firestore
    let template;
    try {
      const templateDoc = await db.collection('emailTemplates').doc('contact_form_auto_reply').get();
      
      if (templateDoc.exists) {
        const templateData = templateDoc.data();
        template = {
          subject: templateData.subject || 'Dziękujemy za wiadomość - strzelca.pl',
          html: templateData.html || '<html><body><p>Dziękujemy za kontakt.</p></body></html>'
        };
      } else {
        // Użyj domyślnego szablonu jeśli nie ma w Firestore
        template = {
          subject: 'Dziękujemy za wiadomość - strzelca.pl',
          html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Dziękujemy za wiadomość</h2>
  <p>Dzień dobry {{senderName}},</p>
  <p>Dziękujemy za kontakt. Otrzymaliśmy Twoją wiadomość i odpowiemy najszybciej jak to możliwe.</p>
  <h3>Twoja wiadomość:</h3>
  <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
    <p>{{message}}</p>
  </div>
  <p>Jeśli masz pilne pytania, możesz skontaktować się z nami bezpośrednio: kontakt@strzelca.pl</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`
        };
      }
    } catch (templateError) {
      console.error('Error loading template:', templateError);
      // Użyj domyślnego szablonu w przypadku błędu
      template = {
        subject: 'Dziękujemy za wiadomość - strzelca.pl',
        html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Dziękujemy za wiadomość</h2>
  <p>Dzień dobry {{senderName}},</p>
  <p>Dziękujemy za kontakt. Otrzymaliśmy Twoją wiadomość i odpowiemy najszybciej jak to możliwe.</p>
  <h3>Twoja wiadomość:</h3>
  <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
    <p>{{message}}</p>
  </div>
  <p>Jeśli masz pilne pytania, możesz skontaktować się z nami bezpośrednio: kontakt@strzelca.pl</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`
      };
    }

    // Zamień zmienne w szablonie
    const subject = replaceTemplateVariables(template.subject, {
      senderName: senderName
    });
    mailSubject = subject;
    
    const html = replaceTemplateVariables(template.html, {
      senderName: senderName,
      message: message.replace(/\n/g, '<br>'),
      topic: 'Formularz kontaktowy'
    });

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
    };

    const info = await transporter.sendMail(mailOptions);
    
    res.status(200).json({ 
      success: true, 
      messageId: info.messageId,
      message: 'Email sent successfully' 
    });
  } catch (error) {
    console.error('Error sending contact email:', error);
    if (mailTo) {
      try {
        const { logEmailDeliveryFailure } = require('./_activity-email-log');
        await logEmailDeliveryFailure({
          category: 'contact_form_auto_reply',
          to: mailTo,
          subject: mailSubject || 'Formularz kontaktowy — auto-odpowiedź',
          errorMessage: error.message || String(error),
          meta: { source: 'send-contact-email' },
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
