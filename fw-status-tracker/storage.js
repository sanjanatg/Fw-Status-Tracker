window.trackerStore = {
  entries: [],
  modules: [],
  revision: 0,
  user: null,
  csrf: null,

  async getCsrf() {
    const response = await fetch('/api/csrf', { credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not obtain a security token.');
    this.csrf = result.token;
    return this.csrf;
  },

  async request(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    const init = { ...options, method, headers, credentials: 'same-origin' };
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
      headers['X-CSRF-Token'] = await this.getCsrf();
    }
    const response = await fetch(path, init);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && path !== '/api/login') {
        window.location.replace('/login.html');
      }
      // ADD THIS BLOCK: If a 403 Forbidden happens, wipe out the old local CSRF cache
      if (response.status === 403) {
        this.csrf = null; 
      }
      throw new Error(result.error || `Server request failed (${response.status}).`);
    }
    return result;
  },

  async initialize() {
    try {
      const [session, workspace, archived] = await Promise.all([
        this.request('/api/session'),
        this.request('/api/entries'),
        this.request('/api/modules')
      ]);
      this.user = session.user;
      this.entries = workspace.entries;
      this.revision = workspace.revision;
      this.modules = archived.rows;
      return true;
    } catch (error) {
      if (error.message && error.message !== 'Authentication required.') {
        console.error(error);
        const toast = document.getElementById('toast') || document.getElementById('summaryToast');
        if (toast) {
          toast.textContent = `Could not load shared tracker data: ${error.message}`;
          toast.classList.add('show');
        }
      }
      return false;
    }
  },

  async saveEntries(entries) {
    const result = await this.request('/api/entries', {
      method: 'PUT',
      body: JSON.stringify({ revision: this.revision, entries })
    });
    this.entries = result.entries;
    this.revision = result.revision;
    const archived = await this.request('/api/modules');
    this.modules = archived.rows;
  },

  async logout() {
    await this.request('/api/logout', { method: 'POST', body: '{}' });
    sessionStorage.removeItem('tw_auth_session');
    window.location.replace('/login.html');
  }
};
