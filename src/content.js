// BiliPlaylist content.js —— 入口：按 frame 与页面类型分发
'use strict';

(() => {
  const isTop = window === window.top;
  const host = location.hostname;

  if (!isTop) {
    // 播放器可能位于任意子 frame（不限于 player.bilibili.com）；
    // 一律尝试启动适配层，由 BiliPlayer 自行轮询查找 video（找不到 30s 后放弃）
    try {
      BiliPlayer.init();
    } catch (e) {
      console.error('[BiliPlaylist] player 初始化失败', e);
    }
    return;
  }

  // 顶层 frame：UI + 页面逻辑
  try {
    BiliUI.initTop();
  } catch (e) {
    console.error('[BiliPlaylist] UI 初始化失败', e);
  }
  console.log('[BiliPlaylist] top frame 已注入 v' + chrome.runtime.getManifest().version + ' | ' + location.href);
  initTopLogic();

  // 播放器已内嵌主页面（实测 2025：页面无播放器 iframe）：顶层 frame 直接适配 video
  if (host === 'www.bilibili.com' && /^\/video\//.test(location.pathname)) {
    try {
      BiliPlayer.init();
    } catch (e) {
      console.error('[BiliPlaylist] player 初始化失败', e);
    }
  }

  // 诊断：3 秒后列出页面所有 iframe 地址（用于确认播放器 iframe 所在域名）
  setTimeout(() => {
    try {
      const srcs = Array.from(document.querySelectorAll('iframe')).map((f) => {
        const s = f.getAttribute('src') || f.src || '(无 src)';
        return f.id ? (f.id + '=' + s) : s;
      });
      console.log('[BiliPlaylist] 页面 iframe 列表:', srcs);
    } catch (e) { /* 忽略 */ }
  }, 3000);
})();

function initTopLogic() {
  // —— 记录当前视频信息（供播放器 iframe 判断分P总数，见 player.js getTotalParts） ——
  const vm = location.pathname.match(/^\/video\/(BV\w+)/);
  if (vm) {
    ensureCurrentVideoInfo(vm[1]);
    // 官方断点定向捕获：视频页初始状态自带官方观看进度，直接读取保存（快、准，不拉全量历史）
    setTimeout(() => captureOfficialProgress(vm[1]), 2500);
  }

  // —— 播放器窗口模式恢复（仅播放列表跳转携带 playerMode 参数时） ——
  const mode = new URLSearchParams(location.search).get('playerMode');
  if (mode === 'fullscreen') {
    chrome.runtime.sendMessage({ type: 'set-window-fullscreen', state: 'fullscreen' }).catch(() => {});
  } else if (mode === 'web-fullscreen') {
    // 标记待恢复；播放器 iframe 加载后尝试点击"网页全屏"按钮（见 player.js tryRestoreWebFullscreen）
    BiliStorage.setPendingWebFs(true);
  }

  // —— 播放完成消息（来自播放器 iframe，经 background 转发） ——
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'video-completed') {
      handleVideoCompleted(msg.bvid);
    }
  });
}

// 定向捕获官方断点：从视频页 __INITIAL_STATE__ 读取官方观看进度（B 站续播用的数据），
// 保存到本地（仅播放列表内视频），并应用断点
async function captureOfficialProgress(bvid) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'read-main' });
    const s = res && res.ok && res.data;
    if (!s || !s.bvid) {
      console.warn('[BiliPlaylist] 未捕获到官方断点（__INITIAL_STATE__ 不可用，待实测）');
      return;
    }
    if (s.bvid !== bvid) return;
    const time = Math.floor(s.progress || 0);
    if (!(time > 5)) return; // 看过 5 秒以上才记录
    const part = parseInt(new URLSearchParams(location.search).get('p') || '1', 10) || 1;
    const list = await BiliStorage.getList();
    if (!list.some((it) => it.bvid === bvid)) return; // 只保存播放列表内视频

    const progress = await BiliStorage.getProgress();
    const prev = progress[bvid];
    // 分P变化则保存（避免新分P的 time 小于旧分P而跳过）；同分P才按时间更靠后保存
    if (!prev || part !== (prev.part || 1) || time > (prev.time || 0) || !(prev.updatedAt || 0)) {
      progress[bvid] = { part, time, updatedAt: Date.now() };
      await BiliStorage.saveProgress(progress);
    }
    const hist = await BiliStorage.getHistory();
    const hm = new Map(hist.map((h) => [h.bvid + ':' + (h.part || 1), h]));
    const key = bvid + ':' + part;
    const old = hm.get(key);
    const vd = s.videoData || {};
    if (!old || time >= (old.time || 0)) {
      hm.set(key, {
        bvid,
        title: vd.title || '',
        author: vd.owner || '',
        part,
        partTitle: '',
        time,
        duration: vd.duration || 0,
        viewAt: Date.now()
      });
      await BiliStorage.saveHistory(Array.from(hm.values()));
    }
    console.log('[BiliPlaylist] 官方断点已捕获 bvid=' + bvid + ' p=' + part + ' time=' + time);
    // 应用断点（播放器已就绪则直接 seek）
    try { BiliPlayer.applySavedProgress(); } catch (e) { /* 忽略 */ }
  } catch (e) {
    console.warn('[BiliPlaylist] 捕获官方断点失败', e);
  }
}

// 顶层在视频页写入当前视频信息；列表项缺分P数/UP主名时调用 view 接口补全（1 次/视频，之后缓存于列表）
async function ensureCurrentVideoInfo(bvid) {
  try {
    const items = await BiliStorage.getList();
    const item = items.find((it) => it.bvid === bvid);
    let pages = item ? item.pages : null;
    if (item && (!pages || !item.author)) {
      try {
        const v = await BiliApi.fetchView(bvid);
        const pCount = (v.data && Array.isArray(v.data.pages) ? v.data.pages.length : 0) || null;
        const author = v.data && v.data.owner ? v.data.owner.name : '';
        if (pCount && !item.pages) item.pages = pCount;
        if (author && !item.author) item.author = author;
        await BiliStorage.saveList(items);
        pages = item.pages;
      } catch (e) {
        console.warn('[BiliPlaylist] 获取视频信息失败', e);
      }
    }
    await BiliStorage.saveCurrentVideo({ bvid, pages, updatedAt: Date.now() });
  } catch (e) {
    console.warn('[BiliPlaylist] ensureCurrentVideoInfo 失败', e);
  }
}

// 列表内某视频全部分P播完 → 自动跳转列表下一个视频（携带窗口模式参数供恢复）
async function handleVideoCompleted(bvid) {
  try {
    const items = await BiliStorage.getList();
    const idx = items.findIndex((it) => it.bvid === bvid);
    if (idx === -1) return;
    const next = items[idx + 1];
    if (!next) {
      console.log('[BiliPlaylist] 播放列表已全部播完');
      return;
    }
    const mode = await BiliStorage.getPlayerMode();
    location.href = 'https://www.bilibili.com/video/' + next.bvid +
      '?p=1&fromPlaylist=1&playerMode=' + mode;
  } catch (e) {
    console.error('[BiliPlaylist] 跳转下一视频失败', e);
  }
}
