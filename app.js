// ========================================
// YT Keyword Analyzer - Clean Rewrite
// ========================================

const API = 'https://www.googleapis.com/youtube/v3';

const state = {
  apiKey: localStorage.getItem('yt_api_key') || '',
  videos: [],
  sort: 'growth',
  asc: false,
  query: '',
  recent: JSON.parse(localStorage.getItem('yt_recent') || '[]'),
};

// ====== Init ======
document.addEventListener('DOMContentLoaded', () => {
  if (state.apiKey) { hideModal(); updateApiDot(true); }
  renderRecent();
  bindAll();
});

// ====== UI Helpers ======
const $ = id => document.getElementById(id);
const hideModal = () => $('apiKeyModal').classList.add('hidden');
const showModal = () => { $('apiKeyModal').classList.remove('hidden'); $('apiKeyInput').value = state.apiKey; };
const showLoad = t => { $('loadingText').textContent = t; $('loadingOverlay').classList.remove('hidden'); };
const hideLoad = () => $('loadingOverlay').classList.add('hidden');

function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = err ? 'toast error show' : 'toast show';
  setTimeout(() => t.className = 'toast', 2500);
}

function updateApiDot(on) {
  document.querySelector('.api-dot').className = `api-dot ${on ? 'connected' : 'disconnected'}`;
  document.querySelector('.api-label').textContent = on ? 'API 연결됨' : 'API 미연결';
}

// ====== YouTube API ======
async function yt(endpoint, params) {
  const url = new URL(`${API}/${endpoint}`);
  params.key = state.apiKey;
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error?.message || `API 에러 (${res.status})`);
  }
  return res.json();
}

async function searchVideos(q, max = 25) {
  const data = await yt('search', {
    part: 'snippet', q, type: 'video', maxResults: String(max),
    order: 'relevance', regionCode: 'KR',
  });
  return data.items || [];
}

async function getVideoDetails(ids) {
  if (!ids.length) return [];
  const data = await yt('videos', { part: 'statistics,snippet,contentDetails', id: ids.join(',') });
  return data.items || [];
}

async function getChannelDetails(ids) {
  if (!ids.length) return [];
  const uniq = [...new Set(ids)];
  // batch in 50s
  let all = [];
  for (let i = 0; i < uniq.length; i += 50) {
    const d = await yt('channels', { part: 'statistics,snippet', id: uniq.slice(i, i + 50).join(',') });
    all = all.concat(d.items || []);
  }
  return all;
}

async function getSuggestions(q) {
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(q)}&hl=ko`);
    const text = await res.text();
    const m = text.match(/\((\[.*\])\)/);
    if (m) {
      const parsed = JSON.parse(m[1]);
      if (parsed[1]) {
        return parsed[1].map(i => i[0]).filter(s => s !== q).slice(0, 10);
      }
    }
  } catch {}
  // fallback
  return ['리뷰', '모음', '효과음', '브이로그', '챌린지'].map(s => `${q} ${s}`);
}

// ====== Duration Parser ======
function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h = m[1] ? `${m[1]}:` : '';
  const min = m[2] || '0';
  const sec = (m[3] || '0').padStart(2, '0');
  return h ? `${h}${min.padStart(2, '0')}:${sec}` : `${min}:${sec}`;
}

// ====== Date Formatter ======
function relativeDate(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return '오늘';
  if (d === 1) return '어제';
  if (d < 7) return `${d}일 전`;
  if (d < 30) return `${Math.floor(d / 7)}주 전`;
  if (d < 365) return `${Math.floor(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

// ====== Main Search ======
async function doSearch(q) {
  if (!state.apiKey) return showModal();
  if (!q.trim()) return toast('키워드를 입력해주세요', true);

  state.query = q;
  showLoad(`"${q}" 검색 중...`);

  try {
    const items = await searchVideos(q, 25);
    if (!items.length) { hideLoad(); toast('검색 결과가 없습니다', true); return; }

    showLoad('영상 분석 중...');
    const vids = await getVideoDetails(items.map(i => i.id.videoId));

    showLoad('채널 분석 중...');
    const chs = await getChannelDetails(vids.map(v => v.snippet.channelId));
    const chMap = {};
    chs.forEach(c => {
      chMap[c.id] = {
        name: c.snippet.title,
        subs: parseInt(c.statistics.subscriberCount || '0'),
        hidden: c.statistics.hiddenSubscriberCount || false,
      };
    });

    state.videos = vids.map(v => {
      const views = parseInt(v.statistics.viewCount || '0');
      const likes = parseInt(v.statistics.likeCount || '0');
      const comments = parseInt(v.statistics.commentCount || '0');
      const ch = chMap[v.snippet.channelId] || { name: '?', subs: 0, hidden: true };
      return {
        id: v.id, title: v.snippet.title,
        channel: ch.name, channelId: v.snippet.channelId,
        thumb: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.medium?.url || '',
        views, likes, comments,
        subs: ch.subs, subsHidden: ch.hidden,
        growth: ch.subs > 0 ? (views / ch.subs) * 100 : 0,
        date: v.snippet.publishedAt,
        duration: parseDuration(v.contentDetails?.duration || ''),
      };
    });

    showLoad('연관 키워드 분석 중...');
    const suggestions = await getSuggestions(q);

    hideLoad();
    saveRecent(q);
    renderKeywordChips(suggestions);
    renderCards();
    renderStats();
    showUI();
    toast(`"${q}" 분석 완료! ${state.videos.length}개 영상`);

  } catch (e) {
    hideLoad();
    if (e.message.includes('API key') || e.message.includes('forbidden')) {
      toast('API 키가 유효하지 않습니다', true);
      updateApiDot(false);
    } else {
      toast(`오류: ${e.message}`, true);
    }
  }
}

function showUI() {
  $('statsSummary').classList.remove('hidden');
  $('sortBar').classList.remove('hidden');
  $('keywordBar').classList.remove('hidden');
}

// ====== Recent Searches ======
function saveRecent(q) {
  state.recent = [q, ...state.recent.filter(s => s !== q)].slice(0, 15);
  localStorage.setItem('yt_recent', JSON.stringify(state.recent));
  renderRecent();
}

function deleteRecent(q) {
  state.recent = state.recent.filter(s => s !== q);
  localStorage.setItem('yt_recent', JSON.stringify(state.recent));
  renderRecent();
}

function renderRecent() {
  const ul = $('recentSearches');
  if (!state.recent.length) {
    ul.innerHTML = '<li class="empty-state">검색 기록 없음</li>';
    return;
  }
  ul.innerHTML = state.recent.map(s => `
    <li class="recent-item" data-q="${esc(s)}">
      <span class="ri-icon">🔍</span>
      <span>${esc(s)}</span>
      <span class="ri-delete" data-del="${esc(s)}">✕</span>
    </li>
  `).join('');

  ul.querySelectorAll('.recent-item').forEach(li => {
    li.addEventListener('click', e => {
      if (e.target.classList.contains('ri-delete')) {
        e.stopPropagation();
        deleteRecent(e.target.dataset.del);
        return;
      }
      $('searchInput').value = li.dataset.q;
      doSearch(li.dataset.q);
    });
  });
}

// ====== Keyword Chips ======
function renderKeywordChips(list) {
  $('keywordChips').innerHTML = list.map(s =>
    `<button class="keyword-chip" data-q="${esc(s)}">${esc(s)}</button>`
  ).join('');

  $('keywordChips').querySelectorAll('.keyword-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      $('searchInput').value = btn.dataset.q;
      doSearch(btn.dataset.q);
    });
  });
}

// ====== Stats ======
function renderStats() {
  if (!state.videos.length) return;
  const totalV = state.videos.reduce((s, v) => s + v.views, 0);
  const avgG = state.videos.reduce((s, v) => s + v.growth, 0) / state.videos.length;
  const top = [...state.videos].sort((a, b) => b.growth - a.growth)[0];

  $('totalResults').textContent = state.videos.length + '개';
  $('avgGrowth').textContent = fmtGrowth(avgG) + '%';
  $('totalViews').textContent = fmtNum(totalV) + '회';
  $('topGrowthName').textContent = top ? truncate(top.title, 18) : '-';
}

// ====== Cards ======
function renderCards() {
  const sorted = [...state.videos].sort((a, b) => {
    let va, vb;
    switch (state.sort) {
      case 'growth': va = a.growth; vb = b.growth; break;
      case 'views': va = a.views; vb = b.views; break;
      case 'subs': va = a.subs; vb = b.subs; break;
      case 'date': va = new Date(a.date); vb = new Date(b.date); break;
      default: va = a.growth; vb = b.growth;
    }
    return state.asc ? va - vb : vb - va;
  });

  $('videoGrid').innerHTML = sorted.map((v, i) => {
    const gc = growthClass(v.growth);
    const gl = growthLabel(v.growth);
    const url = `https://www.youtube.com/watch?v=${v.id}`;
    const isTop = i < 3 && state.sort === 'growth' && !state.asc;
    const rank = isTop ? `<div class="card-rank">${i + 1}</div>` : '';

    return `
      <div class="video-card ${isTop ? 'top-rank' : ''}">
        <div class="card-thumbnail" onclick="window.open('${url}','_blank')">
          ${rank}
          <img src="${v.thumb}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div class="growth-badge ${gc}">${gl} (${fmtGrowth(v.growth)}%)</div>
          ${v.duration ? `<div class="card-duration">${v.duration}</div>` : ''}
        </div>
        <div class="card-body">
          <div class="card-title"><a href="${url}" target="_blank">${esc(v.title)}</a></div>
          <div class="card-meta">
            <span>${esc(v.channel)}</span>
            <span class="dot">●</span>
            <span>${relativeDate(v.date)}</span>
          </div>
          <div class="card-stats-row">
            <div class="stat-item"><span class="stat-label">조회수</span><span class="stat-value">${fmtNum(v.views)}회</span></div>
            <div class="stat-item"><span class="stat-label">구독자</span><span class="stat-value">${v.subsHidden ? '비공개' : fmtNum(v.subs) + '명'}</span></div>
            <div class="stat-item"><span class="stat-label">좋아요</span><span class="stat-value">${fmtNum(v.likes)}</span></div>
            <div class="stat-item"><span class="stat-label">댓글</span><span class="stat-value">${fmtNum(v.comments)}</span></div>
          </div>
          <div class="card-growth-row">
            <div>
              <span style="font-size:11px;color:var(--text-muted)">떡상 지수 </span>
              <span class="growth-value ${gc}">${fmtGrowth(v.growth)}%</span>
            </div>
            <button class="btn-ai-copy" onclick='copyPlan("${v.id}")'>✨ AI 기획안 복사</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ====== CSV Export ======
function exportCsv() {
  if (!state.videos.length) return toast('내보낼 데이터가 없습니다', true);

  const header = '제목,채널,조회수,구독자,좋아요,댓글,떡상지수(%),업로드일,URL';
  const rows = [...state.videos]
    .sort((a, b) => b.growth - a.growth)
    .map(v => [
      `"${v.title.replace(/"/g, '""')}"`,
      `"${v.channel}"`,
      v.views, v.subs, v.likes, v.comments,
      v.growth.toFixed(2),
      v.date.slice(0, 10),
      `https://www.youtube.com/watch?v=${v.id}`
    ].join(','));

  const csv = '\uFEFF' + [header, ...rows].join('\n'); // BOM for Korean Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `yt_analysis_${state.query}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast('CSV 파일이 다운로드되었습니다!');
}

// ====== AI Plan Copy ======
function copyPlan(videoId) {
  const v = state.videos.find(x => x.id === videoId);
  if (!v) return;

  const plan = `[AI 기획안] "${state.query}"
━━━━━━━━━━━━━━━━━━━━━
📹 ${v.title}
📺 ${v.channel} (구독자 ${fmtNum(v.subs)}명)
👀 조회수 ${v.views.toLocaleString()}회
👍 좋아요 ${v.likes.toLocaleString()} | 💬 댓글 ${v.comments.toLocaleString()}
📈 떡상 지수: ${fmtGrowth(v.growth)}% (${growthLabel(v.growth)})
📅 ${v.date.slice(0, 10)}
🔗 https://www.youtube.com/watch?v=${v.id}

💡 분석:
• 구독자 대비 조회수 ${fmtGrowth(v.growth)}%로 ${growthLabel(v.growth)} 수준
• "${state.query}" 키워드의 잠재적 관심도가 높음
• 이 영상의 제목/썸네일 전략 참고 추천`;

  navigator.clipboard.writeText(plan).then(() => toast('AI 기획안 복사 완료!'));
}

// ====== Utilities ======
function fmtNum(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '억';
  if (n >= 1e4) return Math.round(n / 1e4) + '만';
  return n.toLocaleString();
}

function fmtGrowth(n) {
  if (n >= 10000) return Math.round(n).toLocaleString();
  if (n >= 100) return n.toFixed(0);
  return n.toFixed(2);
}

function growthClass(g) {
  if (g >= 10000) return 'mega';
  if (g >= 1000) return 'super';
  if (g >= 100) return 'good';
  return 'normal';
}

function growthLabel(g) {
  if (g >= 10000) return '메가 떡상';
  if (g >= 1000) return '슈퍼 떡상';
  if (g >= 100) return '떡상';
  return '일반';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '...' : s;
}

// ====== Bind Events ======
function bindAll() {
  // API key
  $('saveApiKey').addEventListener('click', () => {
    const k = $('apiKeyInput').value.trim();
    if (!k) return toast('API 키를 입력해주세요', true);
    state.apiKey = k;
    localStorage.setItem('yt_api_key', k);
    hideModal(); updateApiDot(true);
    toast('API 키 저장 완료!');
  });
  $('apiKeyInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('saveApiKey').click(); });
  $('openSettings').addEventListener('click', showModal);

  // Search
  $('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(e.target.value.trim()); });
  $('searchBtn').addEventListener('click', () => doSearch($('searchInput').value.trim()));

  // Sort
  document.querySelectorAll('.sort-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.sort-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.sort = b.dataset.sort;
      if (state.videos.length) renderCards();
    });
  });

  // Order
  $('orderBtn').addEventListener('click', () => {
    state.asc = !state.asc;
    $('orderBtn').textContent = state.asc ? '▲ 오름차순' : '▼ 내림차순';
    if (state.videos.length) renderCards();
  });

  // CSV
  $('exportCsv').addEventListener('click', exportCsv);
}
