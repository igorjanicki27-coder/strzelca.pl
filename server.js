// =============================================================================
// SERWER API DLA STATUSU USŁUG - strzelca.pl
// =============================================================================
// Prosty serwer Express.js do obsługi API statusu usług
// Uruchomienie: node server.js
// =============================================================================

const express = require('express');
const cors = require('cors');
const https = require('https');
const { checkAllServices, checkService } = require('./api/status');
const gaStats = require('./api/ga-stats');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());

// Status endpoint
app.get('/api/status', async (req, res) => {
  try {
    const status = await checkAllServices();
    res.json(status);
  } catch (error) {
    console.error('Error in status endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// Visit tracking endpoint
app.post('/api/track-visit', (req, res) => {
  try {
    const visitData = {
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.body.path || '/',
      referrer: req.get('Referer') || 'direct',
      sessionId: req.body.sessionId || 'anonymous'
    };

    // Save to file (simple implementation)
    const fs = require('fs');
    const visitsFile = './visits.json';

    let visits = [];
    if (fs.existsSync(visitsFile)) {
      visits = JSON.parse(fs.readFileSync(visitsFile, 'utf8'));
    }

    visits.push(visitData);

    // Keep only last 10000 visits for performance
    if (visits.length > 10000) {
      visits = visits.slice(-10000);
    }

    fs.writeFileSync(visitsFile, JSON.stringify(visits, null, 2));

    res.json({ success: true });
  } catch (error) {
    console.error('Error tracking visit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Event logging endpoint
app.post('/api/log-event', (req, res) => {
  try {
    const eventData = {
      timestamp: new Date().toISOString(),
      type: req.body.type || 'system',
      user: req.body.user || 'system',
      action: req.body.action || 'Unknown action',
      details: req.body.details || '',
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      status: req.body.status || 'info'
    };

    const fs = require('fs');
    const eventsFile = './system-events.json';

    let events = [];
    if (fs.existsSync(eventsFile)) {
      events = JSON.parse(fs.readFileSync(eventsFile, 'utf8'));
    }

    events.push(eventData);

    // Keep only last 5000 events for performance
    if (events.length > 5000) {
      events = events.slice(-5000);
    }

    fs.writeFileSync(eventsFile, JSON.stringify(events, null, 2));

    res.json({ success: true });
  } catch (error) {
    console.error('Error logging event:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Active users endpoint - rozszerzony
app.post('/api/user-activity', (req, res) => {
  try {
    const activityData = {
      userId: req.body.userId || req.body.sessionId || 'anonymous',
      userEmail: req.body.userEmail || null,
      timestamp: new Date().toISOString(),
      action: req.body.action || 'page_view',
      path: req.body.path || '/',
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      sessionType: req.body.sessionType || 'standard', // standard, remember_me, admin
      lastActivity: new Date().toISOString()
    };

    const fs = require('fs');
    const activityFile = './user-activity.json';

    let activities = [];
    if (fs.existsSync(activityFile)) {
      activities = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
    }

    // Remove old activities (older than 30 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    activities = activities.filter(a => new Date(a.timestamp) > thirtyMinutesAgo);

    // Update or add activity for this user
    const existingIndex = activities.findIndex(a => a.userId === activityData.userId);
    if (existingIndex >= 0) {
      // Update existing activity, preserve some data
      activities[existingIndex] = {
        ...activities[existingIndex],
        ...activityData,
        lastActivity: new Date().toISOString()
      };
    } else {
      activities.push(activityData);
    }

    fs.writeFileSync(activityFile, JSON.stringify(activities, null, 2));

    res.json({
      success: true,
      activeUsers: activities.length,
      sessionExtended: true
    });
  } catch (error) {
    console.error('Error tracking user activity:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get active users count
app.get('/api/active-users', (req, res) => {
  try {
    const fs = require('fs');
    const activityFile = './user-activity.json';

    if (!fs.existsSync(activityFile)) {
      return res.json({ loggedIn: 0, guests: 0, total: 0 });
    }

    let activities = JSON.parse(fs.readFileSync(activityFile, 'utf8'));

    // Remove old activities (older than 30 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    activities = activities.filter(a => new Date(a.timestamp) > thirtyMinutesAgo);

    // Count logged in vs guests
    const loggedIn = activities.filter(a => a.userId !== 'anonymous' && !a.userId.startsWith('guest')).length;
    const guests = activities.filter(a => a.userId === 'anonymous' || a.userId.startsWith('guest')).length;

    res.json({
      loggedIn: loggedIn,
      guests: guests,
      total: activities.length
    });
  } catch (error) {
    console.error('Error getting active users:', error);
    res.json({ loggedIn: 0, guests: 0, total: 0 });
  }
});

// Get detailed active sessions (for admin panel)
app.get('/api/active-sessions', (req, res) => {
  try {
    const fs = require('fs');
    const activityFile = './user-activity.json';

    if (!fs.existsSync(activityFile)) {
      return res.json({ sessions: [], total: 0 });
    }

    let activities = JSON.parse(fs.readFileSync(activityFile, 'utf8'));

    // Remove old activities (older than 30 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    activities = activities.filter(a => new Date(a.timestamp) > thirtyMinutesAgo);

    // Format sessions for admin view
    const sessions = activities.map(activity => ({
      userId: activity.userId,
      userEmail: activity.userEmail,
      lastActivity: activity.lastActivity || activity.timestamp,
      action: activity.action,
      path: activity.path,
      sessionType: activity.sessionType || 'standard',
      ip: activity.ip,
      userAgent: activity.userAgent,
      isActive: true,
      timeSinceLastActivity: Math.floor((Date.now() - new Date(activity.lastActivity || activity.timestamp)) / 1000)
    }));

    // Sort by last activity (most recent first)
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    res.json({
      sessions: sessions,
      total: sessions.length,
      loggedIn: sessions.filter(s => s.userId !== 'anonymous' && !s.userId.startsWith('guest')).length,
      guests: sessions.filter(s => s.userId === 'anonymous' || s.userId.startsWith('guest')).length
    });
  } catch (error) {
    console.error('Error getting active sessions:', error);
    res.status(500).json({ sessions: [], total: 0, error: error.message });
  }
});

// Get session details for specific user
app.get('/api/session-details/:userId', (req, res) => {
  try {
    const fs = require('fs');
    const activityFile = './user-activity.json';
    const userId = req.params.userId;

    if (!fs.existsSync(activityFile)) {
      return res.json({ session: null, message: 'No session data available' });
    }

    let activities = JSON.parse(fs.readFileSync(activityFile, 'utf8'));

    // Find session for this user
    const userSession = activities.find(a => a.userId === userId);

    if (!userSession) {
      return res.json({ session: null, message: 'User session not found' });
    }

    // Check if session is still active (within 30 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const isActive = new Date(userSession.timestamp) > thirtyMinutesAgo;

    const sessionDetails = {
      userId: userSession.userId,
      userEmail: userSession.userEmail,
      lastActivity: userSession.lastActivity || userSession.timestamp,
      action: userSession.action,
      path: userSession.path,
      sessionType: userSession.sessionType || 'standard',
      ip: userSession.ip,
      userAgent: userSession.userAgent,
      isActive: isActive,
      timeSinceLastActivity: Math.floor((Date.now() - new Date(userSession.lastActivity || userSession.timestamp)) / 1000),
      sessionDuration: Math.floor((new Date(userSession.lastActivity || userSession.timestamp) - new Date(userSession.timestamp)) / 1000)
    };

    res.json({ session: sessionDetails });
  } catch (error) {
    console.error('Error getting session details:', error);
    res.status(500).json({ session: null, error: error.message });
  }
});

// Get system events
app.get('/api/system-events', (req, res) => {
  try {
    const fs = require('fs');
    const eventsFile = './system-events.json';

    if (!fs.existsSync(eventsFile)) {
      return res.json([]);
    }

    let events = JSON.parse(fs.readFileSync(eventsFile, 'utf8'));

    // Sort by timestamp (newest first)
    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Return last 100 events
    res.json(events.slice(0, 100));
  } catch (error) {
    console.error('Error getting system events:', error);
    res.json([]);
  }
});

// Statistics endpoint
app.get('/api/stats', (req, res) => {
  try {
    const fs = require('fs');
    const visitsFile = './visits.json';

    let visits = [];
    if (fs.existsSync(visitsFile)) {
      visits = JSON.parse(fs.readFileSync(visitsFile, 'utf8'));
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const weekStart = getWeekStart(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];

    // Calculate statistics
    const stats = {
      today: visits.filter(v => v.timestamp.startsWith(today)).length,
      week: visits.filter(v => v.timestamp >= weekStart).length,
      month: visits.filter(v => v.timestamp >= monthStart).length,
      year: visits.filter(v => v.timestamp >= yearStart).length,
      total: visits.length,
      lastUpdated: now.toISOString()
    };

    res.json(stats);
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      today: 0,
      week: 0,
      month: 0,
      year: 0,
      total: 0,
      error: error.message
    });
  }
});

// Helper function for week start
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0] + 'T00:00:00.000Z';
}

// Google Analytics stats endpoint
app.get('/api/ga-stats', gaStats);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Serve static files from root directory
app.use(express.static('.'));

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Status API server running on port ${PORT}`);
  console.log(`📊 Status endpoint: http://localhost:${PORT}/api/status`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
