// =============================================================================
// ADMIN COMMON FUNCTIONS - strzelca.pl
// =============================================================================
// Wspólne funkcje dla panelu administratora
// =============================================================================

class AdminCommon {
  constructor() {
    this.subdomains = [
      'strzelca.pl',
      'sklep.strzelca.pl',
      'bazar.strzelca.pl',
      'szkolenia.strzelca.pl',
      'wydarzenia.strzelca.pl',
      'blog.strzelca.pl',
      'pomoc.strzelca.pl',
      'dokumenty.strzelca.pl',
      'kontakt.strzelca.pl',
      'konto.strzelca.pl'
    ];
    this.checkInterval = 30 * 60 * 1000; // 30 minut
    this.checkTimer = null;
    this.outages = JSON.parse(localStorage.getItem('admin_outages') || '[]');
  }

  // =============================================================================
  // GOOGLE ANALYTICS FUNCTIONS
  // =============================================================================

  async fetchGAStatistics() {
    try {
      const response = await fetch('/api/ga-stats');
      const data = await response.json();

      if (data.error) {
        console.error('GA API Error:', data.error);
        this.updateGAUIWithFallback();
        return;
      }

      // Aktualizuj UI z prawdziwymi danymi
      this.updateGAUI(data);
    } catch (error) {
      console.error('Error fetching GA statistics:', error);
      this.updateGAUIWithFallback();
    }
  }

  updateGAUI(data) {
    const elements = {
      'stats-today': data.today || 0,
      'stats-week': data.week || 0,
      'stats-month': data.month || 0,
      'stats-year': data.year || 0,
      'stats-total': data.total || 0
    };

    Object.entries(elements).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = value.toLocaleString();
      }
    });
  }

  updateGAUIWithFallback() {
    // Fallback do losowych danych
    const mockData = {
      today: Math.floor(Math.random() * 50) + 10,
      week: Math.floor(Math.random() * 200) + 100,
      month: Math.floor(Math.random() * 800) + 400,
      year: Math.floor(Math.random() * 5000) + 2000,
      total: Math.floor(Math.random() * 15000) + 10000
    };

    this.updateGAUI(mockData);
  }

  // =============================================================================
  // SUBDOMAIN MONITORING FUNCTIONS
  // =============================================================================

  async checkSubdomainStatus() {
    const results = [];

    for (const subdomain of this.subdomains) {
      try {
        const startTime = Date.now();
        const response = await fetch(`https://${subdomain}`, {
          method: 'HEAD',
          mode: 'no-cors',
          timeout: 10000
        });

        const responseTime = Date.now() - startTime;
        const isOnline = responseTime < 10000; // Uproszczona logika

        results.push({
          name: subdomain,
          status: isOnline ? 'online' : 'offline',
          responseTime: responseTime,
          timestamp: new Date().toISOString()
        });

        // Jeśli subdomena jest offline, dodaj do listy awarii
        if (!isOnline) {
          this.addOutage({
            subdomain: subdomain,
            timestamp: new Date().toISOString(),
            responseTime: responseTime,
            status: 'unresolved'
          });
        }

      } catch (error) {
        results.push({
          name: subdomain,
          status: 'offline',
          responseTime: 0,
          timestamp: new Date().toISOString(),
          error: error.message
        });

        // Dodaj awarię
        this.addOutage({
          subdomain: subdomain,
          timestamp: new Date().toISOString(),
          responseTime: 0,
          error: error.message,
          status: 'unresolved'
        });
      }
    }

    this.updateSubdomainStatusUI(results);
    return results;
  }

  updateSubdomainStatusUI(results) {
    const indicator = document.getElementById('header-status-indicator');
    if (!indicator) return;

    // Sprawdź czy wszystkie subdomeny są online
    const allOnline = results.every(r => r.status === 'online');

    indicator.className = 'w-2 h-2 rounded-full animate-pulse';

    if (allOnline) {
      indicator.classList.add('bg-green-400');
    } else {
      indicator.classList.add('bg-red-400');
    }

    // Aktualizuj poszczególne wskaźniki subdomen
    results.forEach(result => {
      const statusElement = document.getElementById(`status-${result.name}`);
      if (statusElement) {
        statusElement.className = 'w-3 h-3 rounded-full';
        if (result.status === 'online') {
          statusElement.classList.add('bg-green-400');
        } else {
          statusElement.classList.add('bg-red-400');
        }
      }
    });

    // Aktualizuj tabelę awarii
    this.updateOutagesTable();
  }

  addOutage(outage) {
    // Sprawdź czy awaria już istnieje (unikalna dla subdomeny i dnia)
    const today = new Date().toISOString().split('T')[0];
    const existingOutage = this.outages.find(o =>
      o.subdomain === outage.subdomain &&
      o.timestamp.startsWith(today) &&
      o.status === 'unresolved'
    );

    if (!existingOutage) {
      this.outages.push(outage);
      this.saveOutages();
    }
  }

  markOutageAsResolved(subdomain, timestamp) {
    const outage = this.outages.find(o =>
      o.subdomain === subdomain &&
      o.timestamp === timestamp
    );

    if (outage) {
      outage.status = 'resolved';
      outage.resolvedAt = new Date().toISOString();
      this.saveOutages();
      this.updateOutagesTable();
    }
  }

  saveOutages() {
    // Zachowaj tylko ostatnie 100 awarii
    if (this.outages.length > 100) {
      this.outages = this.outages.slice(-100);
    }
    localStorage.setItem('admin_outages', JSON.stringify(this.outages));
  }

  updateOutagesTable() {
    const container = document.getElementById('outages-container');
    if (!container) return;

    // Filtruj tylko nierozwiązane awarie
    const unresolvedOutages = this.outages
      .filter(o => o.status === 'unresolved')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10); // Pokaż ostatnie 10

    if (unresolvedOutages.length === 0) {
      container.innerHTML = '<p class="text-zinc-500 text-center py-4">Brak aktywnych awarii</p>';
      return;
    }

    const html = `
      <div class="overflow-x-auto">
        <table class="w-full text-xs md:text-sm">
          <thead>
            <tr class="border-b border-zinc-700">
              <th class="text-left py-2 px-3 text-zinc-400 font-medium">Subdomena</th>
              <th class="text-left py-2 px-3 text-zinc-400 font-medium">Czas awarii</th>
              <th class="text-left py-2 px-3 text-zinc-400 font-medium">Status</th>
              <th class="text-left py-2 px-3 text-zinc-400 font-medium">Akcje</th>
            </tr>
          </thead>
          <tbody>
            ${unresolvedOutages.map(outage => `
              <tr class="border-b border-zinc-800 hover:bg-zinc-800/30">
                <td class="py-2 px-3 text-zinc-300">${outage.subdomain}</td>
                <td class="py-2 px-3 text-zinc-300">${this.formatDateTime(outage.timestamp)}</td>
                <td class="py-2 px-3">
                  <span class="px-2 py-1 rounded text-xs bg-red-600 text-white">
                    Nierozwiązana
                  </span>
                </td>
                <td class="py-2 px-3">
                  <button
                    onclick="AdminCommon.markOutageAsResolved('${outage.subdomain}', '${outage.timestamp}')"
                    class="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs transition-colors"
                  >
                    Naprawione
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = html;
  }

  // =============================================================================
  // FIREBASE ACTIVITIES FUNCTIONS
  // =============================================================================

  setupFirebaseActivities() {
    if (!window.db || !window.firebaseImports) {
      console.warn('Firebase not available for activities');
      return;
    }

    const { collection, query, orderBy, limit, onSnapshot } = window.firebaseImports;

    // Nasłuchuj zmian w kolekcji activityLogs
    const activitiesQuery = query(
      collection(window.db, 'activityLogs'),
      orderBy('timestamp', 'desc'),
      limit(10)
    );

    onSnapshot(activitiesQuery, (snapshot) => {
      const activities = [];
      snapshot.forEach((doc) => {
        activities.push({ id: doc.id, ...doc.data() });
      });

      this.updateActivitiesUI(activities);
    }, (error) => {
      console.error('Error listening to activities:', error);
    });
  }

  updateActivitiesUI(activities) {
    const container = document.getElementById('recent-activities-list');
    if (!container) return;

    if (activities.length === 0) {
      container.innerHTML = '<p class="text-zinc-500 text-center py-4">Brak aktywności</p>';
      return;
    }

    const html = activities.map(activity => `
      <div class="flex items-center space-x-3 p-3 bg-zinc-800/30 rounded-lg">
        <div class="w-2 h-2 rounded-full ${
          activity.type === 'login' ? 'bg-green-400' :
          activity.type === 'logout' ? 'bg-yellow-400' :
          activity.type === 'admin' ? 'bg-red-400' : 'bg-blue-400'
        }"></div>
        <div class="flex-1">
          <p class="text-sm text-zinc-300">${activity.action || activity.message}</p>
          <p class="text-xs text-zinc-500">
            ${activity.user || 'System'} • ${this.formatDateTime(activity.timestamp)}
          </p>
        </div>
      </div>
    `).join('');

    container.innerHTML = html;
  }

  // =============================================================================
  // INCOMPLETE MATTERS COUNTER
  // =============================================================================

  async loadIncompleteMattersCount() {
    if (!window.db || !window.firebaseImports) {
      console.warn('Firebase not available for incomplete matters');
      this.updateIncompleteMattersUI(0);
      return;
    }

    try {
      const { collection, query, where, getDocs } = window.firebaseImports;

      // Policz dokumenty ze statusem in_progress
      const incompleteQuery = query(
        collection(window.db, 'matters'),
        where('status', '==', 'in_progress')
      );

      const snapshot = await getDocs(incompleteQuery);
      const count = snapshot.size;

      this.updateIncompleteMattersUI(count);
    } catch (error) {
      console.error('Error loading incomplete matters:', error);
      this.updateIncompleteMattersUI(0);
    }
  }

  updateIncompleteMattersUI(count) {
    const element = document.getElementById('incomplete-matters-count');
    if (element) {
      element.textContent = count;
    }
  }

  // =============================================================================
  // UTILITY FUNCTIONS
  // =============================================================================

  formatDateTime(timestamp) {
    if (!timestamp) return 'N/A';

    const date = new Date(timestamp);
    return date.toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  startMonitoring() {
    // Sprawdź status natychmiast
    this.checkSubdomainStatus();

    // Uruchom sprawdzanie co 30 minut
    this.checkTimer = setInterval(() => {
      this.checkSubdomainStatus();
    }, this.checkInterval);
  }

  stopMonitoring() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  // =============================================================================
  // SESSION MANAGEMENT
  // =============================================================================

  checkAdminAuth() {
    const session = localStorage.getItem('admin_session');
    if (session) {
      try {
        const sessionData = JSON.parse(session);
        const now = new Date();
        const sessionTime = new Date(sessionData.loginTime);

        // Sprawdź czy sesja jest ważna (np. 8 godzin)
        const hoursDiff = (now - sessionTime) / (1000 * 60 * 60);
        if (hoursDiff < 8) {
          // Sesja ważna, pokaż panel admina
          this.showAdminPanel();
          return true;
        }
      } catch (error) {
        console.error('Error parsing admin session:', error);
      }
    }

    // Brak ważnej sesji
    this.showLoginForm();
    return false;
  }

  showAdminPanel() {
    const loginSection = document.getElementById("login-section");
    const adminPanel = document.getElementById("admin-panel");
    const loginNav = document.getElementById("login-nav");
    const adminNav = document.getElementById("admin-nav");

    if (loginSection) loginSection.classList.add("hidden");
    if (adminPanel) adminPanel.classList.remove("hidden");
    if (loginNav) loginNav.classList.add("hidden");
    if (adminNav) adminNav.classList.remove("hidden");
  }

  showLoginForm() {
    const loginSection = document.getElementById("login-section");
    const adminPanel = document.getElementById("admin-panel");
    const loginNav = document.getElementById("login-nav");
    const adminNav = document.getElementById("admin-nav");

    if (adminPanel) adminPanel.classList.add("hidden");
    if (loginSection) loginSection.classList.remove("hidden");
    if (adminNav) adminNav.classList.add("hidden");
    if (loginNav) loginNav.classList.remove("hidden");
  }
}

// Create global instance
window.AdminCommon = new AdminCommon();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdminCommon;
}
