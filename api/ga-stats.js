// =============================================================================
// GOOGLE ANALYTICS API ENDPOINT - strzelca.pl
// =============================================================================
// Endpoint do pobierania statystyk z Google Analytics
// Używa biblioteki @google-analytics/data
// =============================================================================

const { BetaAnalyticsDataClient } = require('@google-analytics/data');

// Funkcja do pobierania danych z Google Analytics
async function getAnalyticsData(timeRange) {
  // Konfiguracja klienta Google Analytics
  const analyticsDataClient = new BetaAnalyticsDataClient({
    credentials: {
      type: "service_account",
      ...JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}')
    }
  });

  const propertyId = process.env.GA_PROPERTY_ID;

  if (!propertyId) {
    throw new Error('GA_PROPERTY_ID environment variable is not set');
  }

  // Oblicz zakres dat
  const endDate = new Date();
  let startDate = new Date();

  switch (timeRange) {
    case 'today':
      startDate.setDate(endDate.getDate());
      break;
    case 'week':
      startDate.setDate(endDate.getDate() - 7);
      break;
    case 'month':
      startDate.setMonth(endDate.getMonth() - 1);
      break;
    case 'year':
      startDate.setFullYear(endDate.getFullYear() - 1);
      break;
    default:
      startDate.setDate(endDate.getDate() - 30); // domyślnie miesiąc
  }

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  try {
    // Zapytanie o liczbę sesji
    const [response] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [
        {
          startDate: startDateStr,
          endDate: endDateStr,
        },
      ],
      dimensions: [],
      metrics: [
        {
          name: 'sessions',
        },
        {
          name: 'totalUsers',
        },
        {
          name: 'screenPageViews',
        },
        {
          name: 'averageSessionDuration',
        },
      ],
    });

    // Sumuj wszystkie metryki
    let totalSessions = 0;
    let totalUsers = 0;
    let totalPageviews = 0;
    let avgSessionDuration = 0;

    if (response.rows && response.rows.length > 0) {
      response.rows.forEach(row => {
        if (row.metricValues) {
          totalSessions += parseInt(row.metricValues[0]?.value || 0);
          totalUsers += parseInt(row.metricValues[1]?.value || 0);
          totalPageviews += parseInt(row.metricValues[2]?.value || 0);
          avgSessionDuration = Math.max(avgSessionDuration, parseFloat(row.metricValues[3]?.value || 0));
        }
      });
    }

    return {
      sessions: totalSessions,
      users: totalUsers,
      pageviews: totalPageviews,
      avgSessionDuration: avgSessionDuration,
      timeRange: timeRange,
      startDate: startDateStr,
      endDate: endDateStr,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error fetching Google Analytics data:', error);
    throw new Error(`Failed to fetch analytics data: ${error.message}`);
  }
}

// Funkcja do pobierania wszystkich zakresów czasowych
async function getAllAnalyticsData() {
  try {
    const [today, week, month, year] = await Promise.all([
      getAnalyticsData('today'),
      getAnalyticsData('week'),
      getAnalyticsData('month'),
      getAnalyticsData('year')
    ]);

    return {
      today: today.sessions,
      week: week.sessions,
      month: month.sessions,
      year: year.sessions,
      detailed: {
        today,
        week,
        month,
        year
      },
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error fetching all analytics data:', error);
    // Zwróć dane zastępcze w przypadku błędu
    return {
      today: 0,
      week: 0,
      month: 0,
      year: 0,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Vercel Serverless Function
module.exports = async (req, res) => {
  // Ustawienia CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Obsługa OPTIONS request (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Tylko GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
      message: 'This endpoint only accepts GET requests'
    });
  }

  try {
    // Pobierz parametr timeRange z query string
    const { timeRange } = req.query;

    if (timeRange) {
      // Pobierz dane dla konkretnego zakresu czasowego
      const data = await getAnalyticsData(timeRange);
      res.status(200).json(data);
    } else {
      // Pobierz wszystkie zakresy czasowe
      const data = await getAllAnalyticsData();
      res.status(200).json(data);
    }

  } catch (error) {
    console.error('Error in GA stats endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};



