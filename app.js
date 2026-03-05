// ========================================
// YT Keyword Analyzer - Real YouTube API
// ========================================

const API_BASE = 'https://www.googleapis.com/youtube/v3';

// ====== State ======
let state = {
  apiKey: localStorage.getItem('yt_api_key') || '',
  videos: [],        // processed video data
  currentSort: 'growth',
  ascending: false,
  currentCategory: '',
  recentSearches: JSON.parse(localStorage.getItem('yt_recent') || '[]'),
  lastQuery: '',
};

// ====== Init ======
document.addEventListener('DOMContentLoaded', () => {
  if (state.apiKey) {
    hideModal();
    updateApiStatus(true);
  }
  renderRecentSearches();
  bindEvents();
});

// ====== API Key Modal ======
function hideModal() {
  document.getElementById('apiKeyModal').classList.add('hidden');
}

function showModal() {
  document.getElementById('apiKeyModal').classList.remove('hidden');
  document.getElementById('apiKeyInput').value = state.apiKey;
}

function updateApiStatus(connected) {
  const dot = document.querySelector('.api-dot');
  const label = document.querySelector('.api-label');
  if (connected) {
    dot.className = 'api-dot connected';
    label.textContent = 'API 연결됨';
  } else {
    dot.className = 'api-dot disconnected';
    label.textContent = 'API 미연결';
  }
}

// ====== Loading ======
function showLoading(text = '검색 중...') {
  document.getElementById('loadingText').textContent = text;
  document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

// ====== Toast ======
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = isError ? 'toast error show' : 'toast show';
  setTimeout(() => { toast.className = 'toast'; }, 2500);
}

// ====== YouTube API Calls ======
async function ytFetch(endpoint, params) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  params.key = state.apiKey;
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  });

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `API 에러 (${res.status})`;
    throw new Error(msg);
  }
  return res.json();
}

// Search videos by keyword
async function searchVideos(query, maxResults = 25, categoryId = '') {
  const params = {
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: String(maxResults),
    order: 'relevance',
    regionCode: 'KR',
  };
  if (categoryId) params.videoCategoryId = categoryId;

  const data = await ytFetch('search', params);
  return data.items || [];
}

// Get video details (views, likes)
async function getVideoDetails(videoIds) {
  if (!videoIds.length) return [];
  const data = await ytFetch('videos', {
    part: 'statistics,snippet,contentDetails',
    id: videoIds.join(','),
  });
  return data.items || [];
}

// Get channel details (subscribers)
async function getChannelDetails(channelIds) {
  if (!channelIds.length) return [];
  // Deduplicate
  const unique = [...new Set(channelIds)];
  const data = await ytFetch('channels', {
    part: 'statistics,snippet',
    id: unique.join(','),
  });
  return data.items || [];
}

// YouTube search suggestions (autocomplete) for keyword variations
async function getSearchSuggestions(query) {
  // Use YouTube's autocomplete API (no key needed, CORS might be an issue)
  // Fallback: generate variations manually
  const variations = [];
  const suffixes = {
    '키보드': '⌨️',
    '효과음': '🔊',
    '리소스팩': '📦',
    '딜리': '🔑',
    '노래': '🎵',
    '챌린지': '🏆',
    '리뷰': '📝',
    '브이로그': '📹',
    'ASMR': '🎧',
    '먹방': '🍳',
    '모음': '📂',
    '라이브': '📺',
    '반응': '😮',
    '커버': '🎤',
    '다운로드': '⬇️',
  };

  // Try YouTube suggest API via a simple fetch
  try {
    const suggestUrl = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(query)}&hl=ko`;
    const res = await fetch(suggestUrl);
    const text = await res.text();
    // Parse JSONP response
    const match = text.match(/\((\[.*\])\)/);
    if (match) {
      const parsed = JSON.parse(match[1]);
      if (parsed[1]) {
        parsed[1].forEach(item => {
          const suggestion = item[0];
          if (suggestion !== query) {
            let icon = '🔍';
            for (const [key, emoji] of Object.entries(suffixes)) {
              if (suggestion.includes(key)) { icon = emoji; break; }
            }
            variations.push({ text: suggestion, icon });
          }
        });
      }
    }
  } catch (e) {
    // Fallback: generate basic variations
    Object.entries(suffixes).slice(0, 6).forEach(([suffix, icon]) => {
      variations.push({ text: `${query} ${suffix}`, icon });
    });
  }

  return variations.slice(0, 8);
}

// ====== Main Search Flow ======
async function performSearch(query, maxResults = 25) {
  if (!state.apiKey) {
    showModal();
    return;
  }
  if (!query.trim()) {
    showToast('키워드를 입력해주세요', true);
    return;
  }

  showLoading(`"${query}" 검색 중... (${maxResults}개)`);
  state.lastQuery = query;

  try {
    // Step 1: Search videos
    const searchResults = await searchVideos(query, maxResults, state.currentCategory);
    if (!searchResults.length) {
      hideLoading();
      showToast('검색 결과가 없습니다', true);
      renderEmptyResults();
      return;
    }

    showLoading('영상 상세 정보 가져오는 중...');

    // Step 2: Get video details
    const videoIds = searchResults.map(v => v.id.videoId);
    const videoDetails = await getVideoDetails(videoIds);

    showLoading('채널 정보 분석 중...');

    // Step 3: Get channel details
    const channelIds = videoDetails.map(v => v.snippet.channelId);
    const channelDetails = await getChannelDetails(channelIds);

    // Build channel map
    const channelMap = {};
    channelDetails.forEach(ch => {
      channelMap[ch.id] = {
        name: ch.snippet.title,
        subs: parseInt(ch.statistics.subscriberCount || '0', 10),
        hidden: ch.statistics.hiddenSubscriberCount || false,
      };
    });

    // Step 4: Process and calculate growth index
    state.videos = videoDetails.map(v => {
      const views = parseInt(v.statistics.viewCount || '0', 10);
      const likes = parseInt(v.statistics.likeCount || '0', 10);
      const comments = parseInt(v.statistics.commentCount || '0', 10);
      const ch = channelMap[v.snippet.channelId] || { name: '알 수 없음', subs: 0, hidden: true };
      const subs = ch.subs;

      // 떡상 지수: (조회수 / 구독자수) * 100
      // Higher = more viral relative to channel size
      let growth = 0;
      if (subs > 0) {
        growth = (views / subs) * 100;
      }

      return {
        id: v.id,
        title: v.snippet.title,
        channel: ch.name,
        channelId: v.snippet.channelId,
        thumbnail: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.medium?.url || '',
        views,
        likes,
        comments,
        subs,
        subsHidden: ch.hidden,
        growth,
        publishedAt: v.snippet.publishedAt,
        duration: v.contentDetails?.duration || '',
      };
    });

    // Step 5: Get keyword suggestions (parallel)
    showLoading('관련 키워드 분석 중...');
    const suggestions = await getSearchSuggestions(query);

    hideLoading();

    // Save recent search
    addRecentSearch(query);

    // Render everything
    renderKeywordPanel(query, suggestions);
    renderVideoCards();
    renderStatsSummary();
    showToast(`"${query}" 검색 완료! ${state.videos.length}개 결과`);

  } catch (err) {
    hideLoading();
    console.error('Search error:', err);
    if (err.message.includes('forbidden') || err.message.includes('API key')) {
      showToast('API 키가 유효하지 않습니다. 설정을 확인해주세요.', true);
      updateApiStatus(false);
    } else {
      showToast(`오류: ${err.message}`, true);
    }
  }
}

// Deep Search: paginated search for more results
async function deepSearch(query) {
  if (!state.apiKey) { showModal(); return; }
  if (!query.trim()) { showToast('키워드를 입력해주세요', true); return; }

  showLoading(`"${query}" Deep Search 시작...`);
  state.lastQuery = query;

  try {
    let allItems = [];
    let pageToken = '';
    let page = 0;
    const maxPages = 4; // 4 pages * 50 = 200 max

    while (page < maxPages) {
      showLoading(`Deep Search 중... (${allItems.length}개 수집, 페이지 ${page + 1}/${maxPages})`);
      const params = {
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: '50',
        order: 'relevance',
        regionCode: 'KR',
      };
      if (state.currentCategory) params.videoCategoryId = state.currentCategory;
      if (pageToken) params.pageToken = pageToken;

      const data = await ytFetch('search', params);
      allItems = allItems.concat(data.items || []);
      pageToken = data.nextPageToken || '';
      page++;
      if (!pageToken) break;
    }

    if (!allItems.length) {
      hideLoading();
      showToast('검색 결과가 없습니다', true);
      return;
    }

    // Get details in batches of 50
    showLoading(`${allItems.length}개 영상 상세 정보 분석 중...`);
    const videoIds = allItems.map(v => v.id.videoId);
    let allVideoDetails = [];
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const details = await getVideoDetails(batch);
      allVideoDetails = allVideoDetails.concat(details);
      showLoading(`영상 분석 중... (${allVideoDetails.length}/${videoIds.length})`);
    }

    // Get channel details
    showLoading('채널 정보 분석 중...');
    const channelIds = [...new Set(allVideoDetails.map(v => v.snippet.channelId))];
    let allChannelDetails = [];
    for (let i = 0; i < channelIds.length; i += 50) {
      const batch = channelIds.slice(i, i + 50);
      const details = await getChannelDetails(batch);
      allChannelDetails = allChannelDetails.concat(details);
    }

    const channelMap = {};
    allChannelDetails.forEach(ch => {
      channelMap[ch.id] = {
        name: ch.snippet.title,
        subs: parseInt(ch.statistics.subscriberCount || '0', 10),
        hidden: ch.statistics.hiddenSubscriberCount || false,
      };
    });

    state.videos = allVideoDetails.map(v => {
      const views = parseInt(v.statistics.viewCount || '0', 10);
      const likes = parseInt(v.statistics.likeCount || '0', 10);
      const comments = parseInt(v.statistics.commentCount || '0', 10);
      const ch = channelMap[v.snippet.channelId] || { name: '알 수 없음', subs: 0, hidden: true };
      const subs = ch.subs;
      let growth = subs > 0 ? (views / subs) * 100 : 0;

      return {
        id: v.id, title: v.snippet.title,
        channel: ch.name, channelId: v.snippet.channelId,
        thumbnail: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.medium?.url || '',
        views, likes, comments, subs, subsHidden: ch.hidden,
        growth, publishedAt: v.snippet.publishedAt,
        duration: v.contentDetails?.duration || '',
      };
    });

    showLoading('관련 키워드 분석 중...');
    const suggestions = await getSearchSuggestions(query);

    hideLoading();
    addRecentSearch(query);
    renderKeywordPanel(query, suggestions);
    renderVideoCards();
    renderStatsSummary();
    showToast(`Deep Search 완료! ${state.videos.length}개 결과`);

  } catch (err) {
    hideLoading();
    console.error('Deep search error:', err);
    showToast(`오류: ${err.message}`, true);
  }
}

// ====== Recent Searches ======
function addRecentSearch(query) {
  state.recentSearches = state.recentSearches.filter(s => s !== query);
  state.recentSearches.unshift(query);
  state.recentSearches = state.recentSearches.slice(0, 10);
  localStorage.setItem('yt_recent', JSON.stringify(state.recentSearches));
  renderRecentSearches();
}

function renderRecentSearches() {
  const ul = document.getElementById('recentSearches');
  if (!state.recentSearches.length) {
    ul.innerHTML = '<li class="nav-item empty-state"><span class="nav-label">검색 기록 없음</span></li>';
    return;
  }
  ul.innerHTML = state.recentSearches.map((s, i) => `
    <li class="nav-item recent-item" data-query="${s.replace(/"/g, '&quot;')}">
      <span class="nav-number">${i + 1}</span>
      <span class="nav-label">${escapeHtml(s)}</span>
    </li>
  `).join('');

  // Click to re-search
  ul.querySelectorAll('.recent-item').forEach(item => {
    item.addEventListener('click', () => {
      const q = item.dataset.query;
      document.getElementById('searchInput').value = q;
      performSearch(q, parseInt(document.getElementById('maxResults').value));
    });
  });
}

// ====== Keyword Panel ======
function renderKeywordPanel(query, suggestions) {
  const panel = document.getElementById('keywordPanel');

  if (!suggestions.length) {
    panel.innerHTML = `
      <div class="keyword-section">
        <h3 class="keyword-section-title"><span class="section-icon">🔍</span> "${escapeHtml(query)}"</h3>
        <p style="font-size:12px;color:var(--text-muted)">관련 키워드를 찾을 수 없습니다</p>
      </div>`;
    return;
  }

  const langs = [
    { code: 'en', label: 'EN' },
    { code: 'jp', label: 'JP' },
    { code: 'es', label: 'ES' },
    { code: 'hi', label: 'HI' },
    { code: 'pt', label: 'PT' },
  ];

  panel.innerHTML = suggestions.map(s => `
    <div class="keyword-section">
      <h3 class="keyword-section-title">
        <span class="section-icon">${s.icon}</span> ${escapeHtml(s.text)}
      </h3>
      ${langs.map(l => `
        <div class="keyword-row">
          <span class="lang-badge">${l.code}</span>
          <input type="text" class="keyword-input" value="[${l.label}] ${escapeHtml(s.text)}" readonly>
          <button class="btn-copy" onclick="handleCopy(this)">복사</button>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ====== Video Cards ======
function renderVideoCards() {
  const grid = document.getElementById('videoGrid');
  let sorted = [...state.videos];

  sorted.sort((a, b) => {
    let valA, valB;
    switch (state.currentSort) {
      case 'growth': valA = a.growth; valB = b.growth; break;
      case 'views': valA = a.views; valB = b.views; break;
      case 'subs': valA = a.subs; valB = b.subs; break;
      case 'date': valA = new Date(a.publishedAt); valB = new Date(b.publishedAt); break;
      default: valA = a.growth; valB = b.growth;
    }
    return state.ascending ? valA - valB : valB - valA;
  });

  if (!sorted.length) {
    renderEmptyResults();
    return;
  }

  grid.innerHTML = sorted.map(video => {
    const growthClass = getGrowthClass(video.growth);
    const growthLabel = getGrowthLabel(video.growth);
    const ytUrl = `https://www.youtube.com/watch?v=${video.id}`;

    return `
      <div class="video-card">
        <div class="card-thumbnail" onclick="window.open('${ytUrl}', '_blank')">
          <img src="${video.thumbnail}" alt="" loading="lazy"
               onerror="this.style.display='none'">
          <div class="growth-badge ${growthClass}">
            <span class="growth-dot"></span>
            ${growthLabel} (${formatGrowth(video.growth)}%)
          </div>
        </div>
        <div class="card-body">
          <div class="card-title">
            <a href="${ytUrl}" target="_blank">${escapeHtml(video.title)}</a>
          </div>
          <div class="card-channel">${escapeHtml(video.channel)}</div>
          <div class="card-stats">
            <div class="stat-item">
              <span class="stat-label">조회수</span>
              <span class="stat-value">${formatNumber(video.views)}회</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">구독자</span>
              <span class="stat-value">${video.subsHidden ? '비공개' : formatNumber(video.subs) + '명'}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">좋아요</span>
              <span class="stat-value">${formatNumber(video.likes)}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">댓글</span>
              <span class="stat-value">${formatNumber(video.comments)}</span>
            </div>
          </div>
          <div class="card-growth">
            <span class="growth-label">떡상 지수</span>
            <span class="growth-value ${growthClass}">${formatGrowth(video.growth)}%</span>
          </div>
          <button class="btn-ai-copy" onclick='copyAIPlan(${JSON.stringify(video.id)})'>
            <span class="ai-icon">✨</span> AI 기획안 복사
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderEmptyResults() {
  document.getElementById('videoGrid').innerHTML = `
    <div class="empty-results">
      <div class="empty-icon">🎬</div>
      <p>키워드를 검색하면 영상 분석 결과가 표시됩니다</p>
    </div>`;
  document.getElementById('statsSummary').style.display = 'none';
}

function renderStatsSummary() {
  const el = document.getElementById('statsSummary');
  if (!state.videos.length) { el.style.display = 'none'; return; }

  el.style.display = 'flex';
  const totalViews = state.videos.reduce((s, v) => s + v.views, 0);
  const avgGrowth = state.videos.reduce((s, v) => s + v.growth, 0) / state.videos.length;

  document.getElementById('totalResults').textContent = state.videos.length + '개';
  document.getElementById('avgGrowth').textContent = formatGrowth(avgGrowth) + '%';
  document.getElementById('totalViews').textContent = formatNumber(totalViews) + '회';
}

// ====== Utility Functions ======
function formatNumber(num) {
  if (num >= 100000000) return (num / 100000000).toFixed(1) + '억';
  if (num >= 10000) return (num / 10000).toFixed(0) + '만';
  return num.toLocaleString();
}

function formatGrowth(num) {
  if (num >= 10000) return Math.round(num).toLocaleString();
  if (num >= 100) return num.toFixed(0);
  return num.toFixed(2);
}

function getGrowthClass(growth) {
  if (growth >= 10000) return 'mega';
  if (growth >= 1000) return 'super';
  if (growth >= 100) return 'good';
  return 'normal';
}

function getGrowthLabel(growth) {
  if (growth >= 10000) return '메가 떡상';
  if (growth >= 1000) return '슈퍼 떡상';
  if (growth >= 100) return '떡상';
  return '일반';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ====== Copy Functions ======
function handleCopy(btn) {
  const input = btn.previousElementSibling;
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('복사되었습니다!');
    btn.textContent = '완료';
    btn.style.background = '#4caf50';
    setTimeout(() => { btn.textContent = '복사'; btn.style.background = ''; }, 1500);
  });
}

function copyAIPlan(videoId) {
  const video = state.videos.find(v => v.id === videoId);
  if (!video) return;

  const plan = `[AI 기획안] - ${state.lastQuery}
━━━━━━━━━━━━━━━━━━━━━━
📹 참고 영상: ${video.title}
📺 채널: ${video.channel}
👀 조회수: ${video.views.toLocaleString()}회
👥 구독자: ${video.subs.toLocaleString()}명
👍 좋아요: ${video.likes.toLocaleString()}
💬 댓글: ${video.comments.toLocaleString()}
📈 떡상 지수: ${formatGrowth(video.growth)}%

🔗 원본: https://www.youtube.com/watch?v=${video.id}

📌 분석:
- 구독자 대비 조회수 비율이 ${formatGrowth(video.growth)}%로 ${getGrowthLabel(video.growth)} 수준입니다.
- 키워드 "${state.lastQuery}"의 잠재적 시청자 관심이 높습니다.
- 유사 콘텐츠 기획 시 이 영상의 제목/썸네일 전략을 참고하세요.`;

  navigator.clipboard.writeText(plan).then(() => {
    showToast('AI 기획안이 복사되었습니다!');
  });
}

// ====== Event Bindings ======
function bindEvents() {
  // Save API key
  document.getElementById('saveApiKey').addEventListener('click', () => {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) { showToast('API 키를 입력해주세요', true); return; }
    state.apiKey = key;
    localStorage.setItem('yt_api_key', key);
    hideModal();
    updateApiStatus(true);
    showToast('API 키가 저장되었습니다!');
  });

  // Enter key in modal
  document.getElementById('apiKeyInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('saveApiKey').click();
  });

  // Settings button
  document.getElementById('openSettings').addEventListener('click', showModal);

  // Search
  document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      performSearch(e.target.value.trim(), parseInt(document.getElementById('maxResults').value));
    }
  });

  // Deep Search
  document.getElementById('deepSearchBtn').addEventListener('click', () => {
    const query = document.getElementById('searchInput').value.trim();
    deepSearch(query);
  });

  // Sort buttons
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentSort = btn.dataset.sort;
      if (state.videos.length) renderVideoCards();
    });
  });

  // Order toggle
  document.getElementById('orderBtn').addEventListener('click', () => {
    state.ascending = !state.ascending;
    const btn = document.getElementById('orderBtn');
    btn.innerHTML = state.ascending ? '<span>▲</span> 오름차순' : '<span>▼</span> 내림차순';
    if (state.videos.length) renderVideoCards();
  });

  // Category filter
  document.querySelectorAll('#categoryList .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('#categoryList .nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      state.currentCategory = item.dataset.category || '';
      // Re-search if we have a query
      if (state.lastQuery) {
        performSearch(state.lastQuery, parseInt(document.getElementById('maxResults').value));
      }
    });
  });
}
