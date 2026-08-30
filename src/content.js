// BiliPlaylist content.js —— 入口：按 frame 与页面类型分发
'use strict';

(() => {
  const isTop = window === window.top;
  const host = location.hostname;

  if (!isTop) {
    // 非顶层 frame：仅 player.bilibili.com 需要播放器适配
    if (host === 'player.bilibili.com') {
      try {
        BiliPlayer.init();
      } catch (e) {
        console.error('[BiliPlaylist] player 初始化失败', e);
      }
    }
    return;
  }

  // 顶层 frame：UI + 页面逻辑
  try {
    BiliUI.initTop();
  } catch (e) {
    console.error('[BiliPlaylist] UI 初始化失败', e);
  }
  initTopLogic();
})();

function initTopLogic() {
  // —— 记录当前视频信息（供播放器 iframe 判断分P总数，见 player.js getTotalParts） ——
  const vm = location.pathname.match(/^\/video\/(BV\w+)/);
  if (vm) {
    ensureCurrentVideoInfo(vm[1]);
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
