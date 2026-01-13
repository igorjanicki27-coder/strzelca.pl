// =============================================================================
// SYSTEM SPRAWDZANIA STATUSU USŁUG - strzelca.pl (Vercel Serverless)
// =============================================================================
// Ten plik zawiera funkcje do sprawdzania statusu różnych usług
// =============================================================================

const https = require('https');

// Lista usług do sprawdzenia
const services = [
  {
    name: 'strzelca.pl',
    url: 'https://strzelca.pl',
    type: 'website'
  },
  {
    name: 'sklep.strzelca.pl',
    url: 'https://sklep.strzelca.pl',
    type: 'website'
  },
  {
    name: 'bazar.strzelca.pl',
    url: 'https://bazar.strzelca.pl',
    type: 'website'
  },
  {
    name: 'szkolenia.strzelca.pl',
    url: 'https://szkolenia.strzelca.pl',
    type: 'website'
  },
  {
    name: 'wydarzenia.strzelca.pl',
    url: 'https://wydarzenia.strzelca.pl',
    type: 'website'
  },
  {
    name: 'blog.strzelca.pl',
    url: 'https://blog.strzelca.pl',
    type: 'website'
  },
  {
    name: 'pomoc.strzelca.pl',
    url: 'https://pomoc.strzelca.pl',
    type: 'website'
  },
  {
    name: 'dokumenty.strzelca.pl',
    url: 'https://dokumenty.strzelca.pl',
    type: 'website'
  },
  {
    name: 'kontakt.strzelca.pl',
    url: 'https://kontakt.strzelca.pl',
    type: 'website'
  },
  {
    name: 'konto.strzelca.pl',
    url: 'https://konto.strzelca.pl/login.html',
    type: 'website'
  }
];

// Funkcja sprawdzająca pojedynczą usługę
async function checkService(service) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const req = https.request(service.url, { method: 'HEAD' }, (res) => {
      const responseTime = Date.now() - startTime;
      const status = res.statusCode === 200 ? 'online' : 'offline';

      resolve({
        name: service.name,
        url: service.url,
        type: service.type,
        status: status,
        responseTime: responseTime,
        timestamp: new Date().toISOString()
      });
    });

    req.on('error', () => {
      resolve({
        name: service.name,
        url: service.url,
        type: service.type,
        status: 'offline',
        responseTime: 0,
        timestamp: new Date().toISOString(),
        error: 'Connection failed'
      });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({
        name: service.name,
        url: service.url,
        type: service.type,
        status: 'offline',
        responseTime: 0,
        timestamp: new Date().toISOString(),
        error: 'Timeout'
      });
    });

    req.end();
  });
}

// Funkcja sprawdzająca wszystkie usługi
async function checkAllServices() {
  try {
    const results = await Promise.all(services.map(checkService));

    const online = results.filter(r => r.status === 'online').length;
    const total = results.length;

    return {
      services: results,
      summary: {
        total: total,
        online: online,
        offline: total - online,
        uptime: (online / total * 100).toFixed(1) + '%'
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error checking services:', error);
    return {
      services: [],
      summary: {
        total: 0,
        online: 0,
        offline: 0,
        uptime: '0%'
      },
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Serverless function handler
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const result = await checkAllServices();
      res.json({
        success: true,
        data: result
      });
    } else {
      res.status(405).json({ success: false, error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Status API error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
