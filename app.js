// LiteTube - Core Application Logic

// Fallback instances list if dynamic fetching of api.invidious.io list fails
const HARDCODED_INSTANCES = [
  { uri: 'https://inv.thepixora.com', label: 'ThePixora (US)' },
  { uri: 'https://invidious.privacydev.net', label: 'PrivacyDev (FR)' },
  { uri: 'https://invidious.projectsegfau.lt', label: 'Project Segfault (FR)' },
  { uri: 'https://yewtu.be', label: 'Yewtu.be (NL)' },
  { uri: 'https://invidious.nerdvpn.de', label: 'NerdVPN (DE)' },
  { uri: 'https://inv.nadeko.net', label: 'Nadeko (CL)' }
];

// App State
const AppState = {
  activeInstanceIndex: 0,
  instances: [...HARDCODED_INSTANCES],
  activeInstanceUri: HARDCODED_INSTANCES[0].uri,
  instanceStatus: 'testing', // 'testing', 'online', 'offline'
  
  bookmarks: [],
  history: [],
  
  currentView: 'home',
  currentVideoId: '',
  searchQuery: '',
  
  settings: {
    playerSource: 'youtube-embed', // 'youtube-embed', 'invidious-embed'
    theme: 'dark'
  }
};

// Toast Notifications Helper
const Toast = {
  show(message, type = 'success', duration = 3000) {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `notification-toast toast-${type}`;
    
    let iconName = 'check';
    if (type === 'error') iconName = 'close';
    else if (type === 'info') iconName = 'info';

    toast.innerHTML = `
      ${Icons.get(iconName)}
      <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'none'; // reset animation for out transition
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};

// LocalStorage Helper
const Storage = {
  save(key, data) {
    localStorage.setItem(`litetube_${key}`, JSON.stringify(data));
  },
  load(key) {
    const val = localStorage.getItem(`litetube_${key}`);
    return val ? JSON.parse(val) : null;
  }
};

// Invidious API Manager (handles CORS checking, latency testing, failover)
const InstanceManager = {
  async init() {
    this.updateStatusUI('testing', 'Initializing instances...');
    
    // Attempt to load settings
    const savedSettings = Storage.load('settings');
    if (savedSettings) {
      AppState.settings = { ...AppState.settings, ...savedSettings };
    }
    
    // Load Bookmarks and History
    AppState.bookmarks = Storage.load('bookmarks') || [];
    AppState.history = Storage.load('history') || [];
    
    // Apply Theme
    document.documentElement.setAttribute('data-theme', AppState.settings.theme);
    
    // Fetch dynamic list from Invidious API
    try {
      const response = await fetch('https://api.invidious.io/instances.json');
      if (response.ok) {
        const rawList = await response.json();
        const apiInstances = [];
        
        for (const item of rawList) {
          const domain = item[0];
          const info = item[1];
          // Filter out onion, i2p, and HTTP-only instances, and ensure API is enabled
          if (info.uri && info.uri.startsWith('https:') && info.api !== false && !domain.includes('.onion') && !domain.includes('.i2p')) {
            apiInstances.push({
              uri: info.uri,
              label: `${domain} (${info.region || 'Global'})`,
              uptime: info.monitor ? info.monitor.uptime : 100
            });
          }
        }
        
        if (apiInstances.length > 0) {
          AppState.instances = apiInstances;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch dynamic instance list, using fallback list.', e);
    }
    
    // Test instances to find a working one
    await this.findBestInstance();
  },

  async findBestInstance() {
    this.updateStatusUI('testing', 'Testing server speeds...');
    
    const maxTest = Math.min(AppState.instances.length, 10);
    const testPromises = AppState.instances.slice(0, maxTest).map((inst, index) => {
      return new Promise((resolve) => {
        const start = Date.now();
        // Use a lightweight API endpoint for speed tests (trending endpoint with limit=1)
        fetch(`${inst.uri}/api/v1/trending?limit=1&hl=en`, { signal: AbortSignal.timeout(4000) })
          .then(res => {
            if (res.ok) {
              const elapsed = Date.now() - start;
              resolve({ index, latency: elapsed, ok: true });
            } else {
              resolve({ index, ok: false });
            }
          })
          .catch(() => resolve({ index, ok: false }));
      });
    });
    
    const results = await Promise.all(testPromises);
    const successful = results.filter(r => r.ok).sort((a, b) => a.latency - b.latency);
    
    if (successful.length > 0) {
      const best = successful[0];
      AppState.activeInstanceIndex = best.index;
      AppState.activeInstanceUri = AppState.instances[best.index].uri;
      this.updateStatusUI('online', AppState.instances[best.index].label);
      console.log(`Connected to fastest instance: ${AppState.activeInstanceUri} (${best.latency}ms)`);
    } else {
      // If speed test failed, select first available instance and hope for the best
      AppState.activeInstanceIndex = 0;
      AppState.activeInstanceUri = AppState.instances[0].uri;
      this.updateStatusUI('yellow', 'No tested servers online. Retrying first.');
      
      // Let's test the first one directly with a longer timeout
      try {
        const res = await fetch(`${AppState.activeInstanceUri}/api/v1/trending?limit=1`, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          this.updateStatusUI('online', AppState.instances[0].label);
        } else {
          this.updateStatusUI('offline', 'Offline (Rotate needed)');
        }
      } catch (err) {
        this.updateStatusUI('offline', 'All servers offline');
      }
    }
  },

  // Rotate to next instance in case of failure
  rotateInstance() {
    AppState.activeInstanceIndex = (AppState.activeInstanceIndex + 1) % AppState.instances.length;
    AppState.activeInstanceUri = AppState.instances[AppState.activeInstanceIndex].uri;
    const current = AppState.instances[AppState.activeInstanceIndex];
    
    this.updateStatusUI('yellow', `Rotating to: ${current.label}`);
    Toast.show(`خادم بطيء، جاري التبديل إلى: ${current.label.split(' ')[0]}`, 'info');
    
    return AppState.activeInstanceUri;
  },

  updateStatusUI(status, label) {
    AppState.instanceStatus = status;
    
    const dot = document.getElementById('status-dot');
    const name = document.getElementById('active-instance-name');
    
    if (dot && name) {
      dot.className = `dot ${status === 'online' ? 'green' : status === 'testing' ? 'yellow' : 'red'}`;
      name.textContent = label;
    }
  }
};

// API Client - fetches YouTube data from Invidious with automatic failover rotation
const ApiClient = {
  async fetchWithRetry(endpoint, retries = 3) {
    let currentUri = AppState.activeInstanceUri;
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const url = `${currentUri}${endpoint}`;
        console.log(`API Call (Attempt ${attempt + 1}): ${url}`);
        
        const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
        
        if (!response.ok) {
          throw new Error(`HTTP Error Status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // If we succeeded, make sure our status shows green
        InstanceManager.updateStatusUI('online', AppState.instances[AppState.activeInstanceIndex].label);
        return data;
        
      } catch (error) {
        console.warn(`Request failed on ${currentUri}: ${error.message}`);
        
        if (attempt < retries - 1) {
          // Rotate to next instance and retry
          currentUri = InstanceManager.rotateInstance();
          // Small pause before retrying
          await new Promise(r => setTimeout(r, 500));
        } else {
          InstanceManager.updateStatusUI('offline', 'Connection Error');
          throw new Error('All instance retries failed.');
        }
      }
    }
  },

  getTrending() {
    return this.fetchWithRetry('/api/v1/trending?hl=ar');
  },

  search(query) {
    return this.fetchWithRetry(`/api/v1/search?q=${encodeURIComponent(query)}&hl=ar`);
  },

  getVideo(videoId) {
    return this.fetchWithRetry(`/api/v1/videos/${videoId}?hl=ar`);
  }
};

// UI Rendering Utilities
const UIRenderer = {
  formatViews(views) {
    if (!views && views !== 0) return '';
    if (views >= 1000000) {
      return (views / 1000000).toFixed(1) + ' مليون مشاهدة';
    }
    if (views >= 1000) {
      return (views / 1000).toFixed(0) + ' ألف مشاهدة';
    }
    return views + ' مشاهدة';
  },

  formatDuration(seconds) {
    if (!seconds) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    const pad = (n) => String(n).padStart(2, '0');
    
    if (hrs > 0) {
      return `${hrs}:${pad(mins)}:${pad(secs)}`;
    }
    return `${mins}:${pad(secs)}`;
  },

  renderSkeletons(count = 12) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `
        <div class="skeleton-card">
          <div class="skeleton-thumbnail"></div>
          <div class="skeleton-info">
            <div class="skeleton-line title"></div>
            <div class="skeleton-line author"></div>
            <div class="skeleton-line stats"></div>
          </div>
        </div>
      `;
    }
    return html;
  },

  renderVideoGrid(videos, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!videos || videos.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          ${Icons.get('info')}
          <h3>لا توجد فيديوهات للعرض</h3>
          <p>يرجى التحقق من الاتصال بالخادم أو تجربة بحث آخر.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = videos.map(video => {
      // Find highest resolution thumbnail
      let thumbUrl = '';
      if (video.videoThumbnails && video.videoThumbnails.length > 0) {
        // Find medium or high quality
        const thumb = video.videoThumbnails.find(t => t.quality === 'medium') || video.videoThumbnails[0];
        thumbUrl = thumb.url;
      } else {
        // Fallback standard YouTube thumbnail URL
        thumbUrl = `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`;
      }

      // Format view text if present
      const viewText = video.viewCountText || this.formatViews(video.viewCount);
      const timeText = video.publishedText || '';

      return `
        <div class="video-card" onclick="Navigation.goToWatch('${video.videoId}')" data-id="${video.videoId}">
          <div class="thumbnail-wrapper">
            <img class="thumbnail-img" src="${thumbUrl}" alt="${video.title}" loading="lazy" onerror="this.onerror=null; this.src='https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg';">
            <span class="video-duration">${this.formatDuration(video.lengthSeconds)}</span>
          </div>
          <div class="video-info-container">
            <h4 class="video-title-text" title="${video.title}">${video.title}</h4>
            <div class="video-meta">
              <span class="video-author">${video.author}</span>
              <div class="video-stats">
                <span>${viewText}</span>
                ${timeText ? `<span class="dot-separator"></span><span>${timeText}</span>` : ''}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
};

// Bookmarks & History Controller
const LibraryController = {
  toggleBookmark(video) {
    const idx = AppState.bookmarks.findIndex(b => b.videoId === video.videoId);
    let isBookmarked = false;
    
    if (idx >= 0) {
      AppState.bookmarks.splice(idx, 1);
      Toast.show('تمت الإزالة من المفضلة', 'info');
    } else {
      AppState.bookmarks.unshift(video);
      isBookmarked = true;
      Toast.show('تمت الإضافة للمفضلة', 'success');
    }
    
    Storage.save('bookmarks', AppState.bookmarks);
    this.updateBookmarkButtonUI(isBookmarked);
    return isBookmarked;
  },

  isBookmarked(videoId) {
    return AppState.bookmarks.some(b => b.videoId === videoId);
  },

  updateBookmarkButtonUI(isBookmarked) {
    const btn = document.getElementById('btn-bookmark-video');
    if (!btn) return;
    
    if (isBookmarked) {
      btn.innerHTML = `${Icons.get('heart')} <span>مفضلة</span>`;
      btn.classList.add('active');
    } else {
      btn.innerHTML = `${Icons.get('heartBorder')} <span>إضافة للمفضلة</span>`;
      btn.classList.remove('active');
    }
  },

  addToHistory(video) {
    // Filter out previous entries of the same video
    AppState.history = AppState.history.filter(h => h.videoId !== video.videoId);
    
    // Add to beginning of array
    AppState.history.unshift({
      videoId: video.videoId,
      title: video.title,
      author: video.author,
      lengthSeconds: video.lengthSeconds,
      viewCountText: video.viewCountText || UIRenderer.formatViews(video.viewCount),
      videoThumbnails: video.videoThumbnails,
      watchedAt: Date.now()
    });
    
    // Cap history size at 100
    if (AppState.history.length > 100) {
      AppState.history.pop();
    }
    
    Storage.save('history', AppState.history);
  },

  clearHistory() {
    AppState.history = [];
    Storage.save('history', AppState.history);
    Toast.show('تم مسح سجل المشاهدة', 'info');
    Navigation.renderHistory();
  }
};

// Router & View Controller
const Navigation = {
  init() {
    // Bind search form submit
    const searchForm = document.getElementById('search-form');
    if (searchForm) {
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('search-input');
        if (input && input.value.trim()) {
          this.goToSearch(input.value.trim());
        }
      });
    }

    // Bind sidebar clicks manually (SPA navigation)
    document.querySelectorAll('[data-target-view]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.getAttribute('data-target-view');
        window.location.hash = view;
      });
    });

    // Handle hash routing
    window.addEventListener('hashchange', () => this.route());
    // Initial route
    this.route();
  },

  route() {
    const hash = window.location.hash || '#home';
    const cleanHash = hash.split('?')[0];
    
    // Update active nav item
    document.querySelectorAll('[data-target-view]').forEach(item => {
      const target = item.getAttribute('data-target-view');
      if (cleanHash === `#${target}`) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    if (cleanHash === '#home') {
      this.switchView('home');
      this.renderHome();
    } 
    else if (cleanHash === '#search') {
      this.switchView('search');
      const params = new URLSearchParams(hash.split('?')[1] || '');
      const query = params.get('q') || '';
      this.renderSearch(query);
    } 
    else if (cleanHash === '#watch') {
      this.switchView('watch');
      const params = new URLSearchParams(hash.split('?')[1] || '');
      const videoId = params.get('v') || '';
      this.renderWatch(videoId);
    } 
    else if (cleanHash === '#bookmarks') {
      this.switchView('bookmarks');
      this.renderBookmarks();
    } 
    else if (cleanHash === '#history') {
      this.switchView('history');
      this.renderHistory();
    } 
    else if (cleanHash === '#settings') {
      this.switchView('settings');
      this.renderSettings();
    }
  },

  switchView(viewId) {
    AppState.currentView = viewId;
    
    document.querySelectorAll('.view-section').forEach(section => {
      section.classList.remove('active');
    });
    
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add('active');
    
    // Scroll content panel to top on view change
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
  },

  goToHome() {
    window.location.hash = 'home';
  },

  goToSearch(query) {
    window.location.hash = `search?q=${encodeURIComponent(query)}`;
  },

  goToWatch(videoId) {
    window.location.hash = `watch?v=${videoId}`;
  },

  async renderHome() {
    const grid = document.getElementById('home-video-grid');
    if (!grid) return;
    
    grid.innerHTML = UIRenderer.renderSkeletons();
    
    try {
      const data = await ApiClient.getTrending();
      UIRenderer.renderVideoGrid(data, 'home-video-grid');
    } catch (e) {
      console.error('Failed to load trending content', e);
      grid.innerHTML = `
        <div class="empty-state">
          ${Icons.get('close')}
          <h3>خطأ في تحميل الفيديوهات الشائعة</h3>
          <p>فشلت كافة خوادم الاتصال. يرجى التحقق من الإنترنت وإعادة المحاولة.</p>
          <button class="btn-action" style="margin-top:16px;" onclick="Navigation.renderHome()">إعادة المحاولة</button>
        </div>
      `;
    }
  },

  async renderSearch(query) {
    AppState.searchQuery = query;
    const input = document.getElementById('search-input');
    if (input) input.value = query;

    const titleEl = document.getElementById('search-view-title');
    if (titleEl) titleEl.textContent = `نتائج البحث عن: ${query}`;

    const grid = document.getElementById('search-video-grid');
    if (!grid) return;
    
    grid.innerHTML = UIRenderer.renderSkeletons();
    
    try {
      const data = await ApiClient.search(query);
      // Filter only videos from search results
      const videosOnly = data.filter(item => item.type === 'video');
      UIRenderer.renderVideoGrid(videosOnly, 'search-video-grid');
    } catch (e) {
      console.error('Search failed', e);
      grid.innerHTML = `
        <div class="empty-state">
          ${Icons.get('close')}
          <h3>فشل البحث</h3>
          <p>حدثت مشكلة أثناء الاتصال بالخادم. يرجى تكرار المحاولة.</p>
          <button class="btn-action" style="margin-top:16px;" onclick="Navigation.renderSearch('${query}')">إعادة المحاولة</button>
        </div>
      `;
    }
  },

  async renderWatch(videoId) {
    if (!videoId) {
      this.goToHome();
      return;
    }
    
    AppState.currentVideoId = videoId;
    
    const container = document.getElementById('view-watch');
    if (!container) return;
    
    // Render Skeleton layout for Watch page
    container.innerHTML = `
      <div class="player-layout">
        <div class="main-player-section">
          <div class="video-wrapper-outer" style="background:#121026;">
            <div class="loading-overlay">
              <div class="loading-spinner-box">
                ${Icons.get('spinner')}
                <p>جاري تهيئة مشغل الفيديو الخفيف...</p>
              </div>
            </div>
          </div>
          <div class="skeleton-info" style="margin-top:16px; background:var(--bg-secondary); border-radius:var(--radius-md); padding:20px;">
            <div class="skeleton-line title" style="width: 80%;"></div>
            <div class="skeleton-line stats" style="width: 40%; margin-top:12px;"></div>
          </div>
        </div>
        <div class="related-videos-section">
          <h3 class="panel-title">فيديوهات مقترحة</h3>
          <div class="related-list">
            ${UIRenderer.renderSkeletons(4)}
          </div>
        </div>
      </div>
    `;

    try {
      const video = await ApiClient.getVideo(videoId);
      
      // Save to watch history
      LibraryController.addToHistory(video);
      
      // Select appropriate video embed URL based on user settings
      let embedUrl = '';
      if (AppState.settings.playerSource === 'youtube-embed') {
        embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&modestbranding=1&rel=0`;
      } else {
        embedUrl = `${AppState.activeInstanceUri}/embed/${videoId}?autoplay=true`;
      }

      const isBookmarked = LibraryController.isBookmarked(videoId);
      const viewText = video.viewCountText || UIRenderer.formatViews(video.viewCount);
      const timeText = video.publishedText || '';
      
      // Update HTML structure with loaded video details
      container.innerHTML = `
        <div class="player-layout">
          <div class="main-player-section">
            <div class="video-wrapper-outer">
              <iframe 
                src="${embedUrl}" 
                title="${video.title}" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                allowfullscreen>
              </iframe>
            </div>
            
            <div class="video-detail-info">
              <h2 class="video-detail-title">${video.title}</h2>
              
              <div class="video-detail-meta">
                <div class="channel-info-section">
                  <div class="channel-avatar">
                    ${(video.author || 'Y')[0].toUpperCase()}
                  </div>
                  <div class="channel-details">
                    <span class="channel-name">${video.author}</span>
                    <span class="channel-subscribers">${video.subCountText || 'قناة غير رسمية'}</span>
                  </div>
                </div>
                
                <div class="video-actions">
                  <button class="btn-action ${isBookmarked ? 'active' : ''}" id="btn-bookmark-video">
                    ${isBookmarked ? Icons.get('heart') : Icons.get('heartBorder')}
                    <span>${isBookmarked ? 'مفضلة' : 'إضافة للمفضلة'}</span>
                  </button>
                  <button class="btn-action" id="btn-copy-link">
                    ${Icons.get('share')}
                    <span>مشاركة</span>
                  </button>
                  <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" class="btn-action" style="text-decoration:none;">
                    ${Icons.get('play')}
                    <span>فتح في YouTube</span>
                  </a>
                </div>
              </div>
              
              <div class="description-container">
                <div class="description-header">
                  <span>الوصف</span>
                  <span style="font-size:0.8rem; color:var(--text-muted);">${viewText} • ${timeText}</span>
                </div>
                <div class="description-text" id="desc-text-body">${video.description || 'لا يوجد وصف متاح.'}</div>
                ${video.description && video.description.length > 200 ? `<button class="btn-toggle-desc" id="btn-toggle-desc">عرض المزيد...</button>` : ''}
              </div>
            </div>
          </div>
          
          <div class="related-videos-section">
            <h3 class="panel-title">فيديوهات مقترحة</h3>
            <div class="related-list" id="related-videos-list">
              <!-- Related Videos render -->
            </div>
          </div>
        </div>
      `;

      // Set up click handlers for detail view actions
      document.getElementById('btn-bookmark-video').addEventListener('click', () => {
        LibraryController.toggleBookmark(video);
      });
      
      document.getElementById('btn-copy-link').addEventListener('click', () => {
        const shareUrl = `${window.location.origin}${window.location.pathname}#watch?v=${videoId}`;
        navigator.clipboard.writeText(shareUrl).then(() => {
          Toast.show('تم نسخ رابط الفيديو الخفيف بنجاح!', 'success');
        }).catch(() => {
          Toast.show('فشل نسخ الرابط.', 'error');
        });
      });
      
      const toggleDescBtn = document.getElementById('btn-toggle-desc');
      if (toggleDescBtn) {
        toggleDescBtn.addEventListener('click', () => {
          const body = document.getElementById('desc-text-body');
          if (body.classList.toggle('expanded')) {
            toggleDescBtn.textContent = 'عرض أقل...';
          } else {
            toggleDescBtn.textContent = 'عرض المزيد...';
          }
        });
      }

      // Render Related Videos
      this.renderRelated(video.recommendedVideos || []);

    } catch (e) {
      console.error('Failed to load watch video data', e);
      container.innerHTML = `
        <div class="empty-state">
          ${Icons.get('close')}
          <h3>خطأ في تحميل الفيديو</h3>
          <p>يرجى العودة للصفحة الرئيسية أو تجربة خادم آخر في الإعدادات.</p>
          <button class="btn-action" style="margin-top:16px;" onclick="Navigation.goToHome()">العودة للرئيسية</button>
        </div>
      `;
    }
  },

  renderRelated(relatedVideos) {
    const listContainer = document.getElementById('related-videos-list');
    if (!listContainer) return;
    
    if (!relatedVideos || relatedVideos.length === 0) {
      listContainer.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">لا توجد مقترحات متاحة.</p>';
      return;
    }
    
    // We only take the top 10 recommended videos
    listContainer.innerHTML = relatedVideos.slice(0, 10).map(video => {
      let thumbUrl = `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`;
      if (video.videoThumbnails && video.videoThumbnails.length > 0) {
        thumbUrl = video.videoThumbnails.find(t => t.quality === 'medium' || t.quality === 'default')?.url || thumbUrl;
      }
      
      return `
        <div class="related-card" onclick="Navigation.goToWatch('${video.videoId}')">
          <div class="related-thumb-wrapper">
            <img class="related-thumb-img" src="${thumbUrl}" alt="${video.title}" loading="lazy" onerror="this.onerror=null; this.src='https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg';">
          </div>
          <div class="related-info">
            <h4 class="related-title" title="${video.title}">${video.title}</h4>
            <span class="related-channel">${video.author}</span>
            <span class="related-stats">${UIRenderer.formatViews(video.viewCount)}</span>
          </div>
        </div>
      `;
    }).join('');
  },

  renderBookmarks() {
    const grid = document.getElementById('bookmarks-video-grid');
    if (!grid) return;
    
    UIRenderer.renderVideoGrid(AppState.bookmarks, 'bookmarks-video-grid');
  },

  renderHistory() {
    const grid = document.getElementById('history-video-grid');
    if (!grid) return;
    
    const container = document.getElementById('view-history');
    const headerControls = container.querySelector('.view-header');
    
    // Manage dynamic render of the 'Clear' button depending on data
    let clearBtn = document.getElementById('btn-clear-history');
    if (AppState.history.length > 0) {
      if (!clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.id = 'btn-clear-history';
        clearBtn.className = 'btn-action';
        clearBtn.innerHTML = `${Icons.get('trash')} <span>مسح السجل</span>`;
        clearBtn.addEventListener('click', () => LibraryController.clearHistory());
        headerControls.appendChild(clearBtn);
      }
    } else {
      if (clearBtn) clearBtn.remove();
    }
    
    UIRenderer.renderVideoGrid(AppState.history, 'history-video-grid');
  },

  renderSettings() {
    const card = document.getElementById('settings-card-container');
    if (!card) return;
    
    card.innerHTML = `
      <div class="settings-group">
        <label class="settings-label">${Icons.get('play')} مصدر مشغل الفيديو</label>
        <span class="settings-desc">اختر المشغل الافتراضي. مشغل يوتيوب الرسمي (Embedded) مستقر جداً وخفيف ويدعم الترجمة، بينما مشغل Invidious يحمي خصوصيتك تماماً بدون اتصالات مع جوجل ولكنه قد يعلق أحياناً.</span>
        <div class="chip-group">
          <label class="chip-label">
            <input type="radio" name="setting-player" value="youtube-embed" ${AppState.settings.playerSource === 'youtube-embed' ? 'checked' : ''}>
            <span class="chip-text">YouTube Embed (مستقر وموصى به)</span>
          </label>
          <label class="chip-label">
            <input type="radio" name="setting-player" value="invidious-embed" ${AppState.settings.playerSource === 'invidious-embed' ? 'checked' : ''}>
            <span class="chip-text">Invidious Embed (خصوصية مطلقة)</span>
          </label>
        </div>
      </div>
      
      <div class="settings-group">
        <label class="settings-label">${Icons.get('moon')} مظهر الموقع (Theme)</label>
        <span class="settings-desc">قم بالتغيير بين المظهر المظلم المتوهج والمظهر المضيء.</span>
        <div class="chip-group">
          <label class="chip-label">
            <input type="radio" name="setting-theme" value="dark" ${AppState.settings.theme === 'dark' ? 'checked' : ''}>
            <span class="chip-text">وضع مظلم متوهج (Dark Mode)</span>
          </label>
          <label class="chip-label">
            <input type="radio" name="setting-theme" value="light" ${AppState.settings.theme === 'light' ? 'checked' : ''}>
            <span class="chip-text">وضع مضيء (Light Mode)</span>
          </label>
        </div>
      </div>
      
      <div class="settings-group">
        <label class="settings-label">${Icons.get('server')} خوادم البيانات النشطة (API Server)</label>
        <span class="settings-desc">يقوم الموقع تلقائياً باختيار الخادم الأسرع، كما يمكنك التبديل يدوياً لخادم آخر في حال تعطل أحدها.</span>
        <div class="instance-table-wrapper" style="margin-top:10px;">
          <table class="instance-table">
            <thead>
              <tr>
                <th>عنوان الخادم</th>
                <th>اسم النطاق</th>
                <th>الحالة</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody id="settings-instances-body">
              <!-- Instances populated dynamically -->
            </tbody>
          </table>
        </div>
        <button class="btn-action" id="btn-retest-servers" style="align-self:flex-start; margin-top:10px;">
          ${Icons.get('spinner')}
          <span>إعادة فحص سرعة الخوادم</span>
        </button>
      </div>
    `;

    // Populate instances table
    const tbody = document.getElementById('settings-instances-body');
    if (tbody) {
      tbody.innerHTML = AppState.instances.map((inst, idx) => {
        const isActive = AppState.activeInstanceUri === inst.uri;
        return `
          <tr class="${isActive ? 'active-instance' : ''}">
            <td style="font-weight:600;">${inst.uri}</td>
            <td>${inst.label}</td>
            <td>
              <span class="status-indicator">
                <span class="dot ${isActive ? 'green' : 'yellow'}"></span>
                <span>${isActive ? 'نشط حالياً' : 'متاح'}</span>
              </span>
            </td>
            <td>
              ${isActive ? `<span style="font-size:0.75rem; color:var(--accent); font-weight:bold;">متصل</span>` : `
                <button class="btn-small" onclick="Navigation.selectInstance(${idx})">اتصال</button>
              `}
            </td>
          </tr>
        `;
      }).join('');
    }

    // Set up listeners for settings changes
    const playerRadios = document.querySelectorAll('input[name="setting-player"]');
    playerRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        AppState.settings.playerSource = e.target.value;
        Storage.save('settings', AppState.settings);
        Toast.show('تم حفظ إعداد المشغل الافتراضي', 'success');
      });
    });

    const themeRadios = document.querySelectorAll('input[name="setting-theme"]');
    themeRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        AppState.settings.theme = e.target.value;
        Storage.save('settings', AppState.settings);
        document.documentElement.setAttribute('data-theme', e.target.value);
        Toast.show('تم تحديث مظهر الموقع', 'success');
      });
    });

    const retestBtn = document.getElementById('btn-retest-servers');
    if (retestBtn) {
      retestBtn.addEventListener('click', async () => {
        retestBtn.querySelector('.icon').classList.add('spin');
        retestBtn.disabled = true;
        
        await InstanceManager.findBestInstance();
        this.renderSettings();
        
        Toast.show('اكتمل فحص الخوادم، وتم تحديد الأسرع!', 'success');
      });
    }
  },

  selectInstance(index) {
    if (index >= 0 && index < AppState.instances.length) {
      AppState.activeInstanceIndex = index;
      AppState.activeInstanceUri = AppState.instances[index].uri;
      
      InstanceManager.updateStatusUI('online', AppState.instances[index].label);
      Toast.show(`تم التحويل للخادم: ${AppState.instances[index].label.split(' ')[0]}`, 'success');
      
      this.renderSettings();
    }
  }
};

// Global hook to theme toggling inside header
document.addEventListener('DOMContentLoaded', async () => {
  // Populate global icons placeholders in HTML if any
  document.querySelectorAll('[data-icon]').forEach(el => {
    const name = el.getAttribute('data-icon');
    el.innerHTML = Icons.get(name);
  });
  
  // Theme toggle button click handler in header
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.innerHTML = Icons.get('sun');
    themeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      
      AppState.settings.theme = newTheme;
      Storage.save('settings', AppState.settings);
      document.documentElement.setAttribute('data-theme', newTheme);
      
      themeToggle.innerHTML = Icons.get(newTheme === 'dark' ? 'sun' : 'moon');
      Toast.show(newTheme === 'dark' ? 'تم تفعيل الوضع المظلم' : 'تم تفعيل الوضع المضيء', 'success');
    });
  }

  // Initialize Invidious Instances
  await InstanceManager.init();

  // Initialize Router and forms
  Navigation.init();
});
