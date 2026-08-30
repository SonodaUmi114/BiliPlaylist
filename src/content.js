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
  // —— 播放器窗口模式恢复（仅播放列表跳转携带 playerMode 参数时） ——
  const mode = new URLSearchParams(location.search).get('playerMode');
  if (mode === 'fullscreen') {
    chrome.runtime.sendMessage({ type: 'set-window-fullscreen', state: 'fullscreen' }).catch(() => {});
  } else if (mode === 'web-fullscreen') {
    // TODO(实测)：通知播放器 iframe 点击"网页全屏"按钮（选择器待验证，见 docs/api-notes.md）
    console.log('[BiliPlaylist] 网页全屏恢复：待播放器适配层实现');
  }

  // —— 播放完成消息（来自播放器 iframe，经 background 转发） ——
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'video-completed') {
      handleVideoCompleted(msg.bvid);
    }
  });
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
