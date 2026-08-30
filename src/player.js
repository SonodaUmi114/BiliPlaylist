// BiliPlaylist 播放器适配层
// 仅在 player.bilibili.com iframe 内工作（content script 通过 all_frames 注入该跨域 frame）
// 职责：读取当前分P与播放时间、恢复进度、分P无刷新连播（iframe 自身刷新 p 参数）、
//       全部播完通知顶层跳转下一视频、记录用户手动切换的窗口模式
'use strict';

var BiliPlayer = (function () {
  // 断点方案（2025 切换）：以 B 站官方观看历史接口为准（同步进 biliplaylist:progress）；
  // 旧的 video 元素轮询保存已停用，备份在分支 backup/old-progress-video-element
  const USE_OFFICIAL_PROGRESS = true;

  let bvid = null;
  let part = 1;
  let video = null;
  let lastSave = 0;
  let pollTimer = null;

  function getParam(name) {
    return new URLSearchParams(location.search).get(name);
  }

  async function init() {
    console.log('[BiliPlaylist] player 适配启动: ' + location.href);
    bvid = getBvidFromUrl();
    const pRaw = getParam('p') || getParam('page');
    part = parseInt(pRaw || '1', 10) || 1;
    if (!bvid) {
      // 兜底：URL 无 bvid 时，从顶层写入的 currentVideo 读取
      try {
        const cv = await BiliStorage.getCurrentVideo();
        if (cv && cv.bvid) {
          bvid = cv.bvid;
          console.log('[BiliPlaylist] bvid 从 currentVideo 兜底: ' + bvid);
        }
      } catch (e) { /* 忽略 */ }
    }
    if (!bvid) {
      console.warn('[BiliPlaylist] 未识别 bvid，跳过适配');
      return;
    }
    pollForVideo();
  }

  // bvid：优先 URL query（bvid=），其次视频页路径 /video/BV...
  function getBvidFromUrl() {
    const q = getParam('bvid');
    if (q) return q;
    const m = location.pathname.match(/^\/video\/(BV\w+)/);
    if (m) return m[1];
    return null;
  }

  function pollForVideo() {
    let tries = 0;
    pollTimer = setInterval(() => {
      video = document.querySelector('video');
      if (video) {
        clearInterval(pollTimer);
        bindVideo();
      } else if (++tries > 60) {
        clearInterval(pollTimer);
        console.warn('[BiliPlaylist] 未找到播放器 video 元素');
      }
    }, 500);
  }

  function bindVideo() {
    console.log('[BiliPlaylist] player 适配已绑定 bvid=' + bvid + ' p=' + part);
    restoreProgress();
    tryRestoreWebFullscreen();
    video.addEventListener('ended', onEnded);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    if (!USE_OFFICIAL_PROGRESS) {
      // 旧方案（已停用）：video 元素轮询保存断点
      video.addEventListener('timeupdate', onTimeUpdate);
      window.addEventListener('pagehide', () => saveProgress());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveProgress();
      });
    }
  }

  // —— "网页全屏"自动恢复：消费顶层写入的 pendingWebFs 标记，尝试点击播放器网页全屏按钮 ——
  async function tryRestoreWebFullscreen() {
    try {
      const pending = await BiliStorage.getPendingWebFs();
      if (!pending) return;
      await BiliStorage.setPendingWebFs(false);
      setTimeout(() => {
        const btn = pickWebFullscreenButton();
        if (btn) {
          console.log('[BiliPlaylist] 已点击网页全屏按钮', btn);
          btn.click();
        } else {
          console.warn('[BiliPlaylist] 未找到网页全屏按钮（候选选择器均未命中，需实测记录 DOM，见 docs/api-notes.md）');
        }
      }, 1500);
    } catch (e) { /* 忽略 */ }
  }

  // 候选选择器（B 站改版频繁，命中后请把实际选择器记入 docs/api-notes.md）
  function pickWebFullscreenButton() {
    const sels = [
      'button[class*="web-fullscreen"], [class*="web-fullscreen"] button',
      'button[class*="web-screen"], [class*="web-screen"] button',
      '[title="网页全屏"]',
      '[aria-label="网页全屏"]',
      '.web-fullscreen-btn',
      '[class*="fullscreen"] [class*="web"]'
    ];
    for (const sel of sels) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (e) { /* 忽略 */ }
    }
    return null;
  }

  // —— 进度读取（节流 5s 写一次存储，顶层侧边栏经 storage.onChanged 同步） ——
  function onTimeUpdate() {
    const now = Date.now();
    if (now - lastSave >= 5000) {
      lastSave = now;
      saveProgress();
    }
  }

  let savedOnce = false;
  async function saveProgress() {
    if (USE_OFFICIAL_PROGRESS) return; // 官方历史方案：断点由历史接口同步，不再轮询 video
    if (!video || !bvid) return;
    try {
      const progress = await BiliStorage.getProgress();
      const cur = progress[bvid] || {};
      progress[bvid] = Object.assign({}, cur, {
        part,
        time: Math.floor(video.currentTime || 0),
        updatedAt: Date.now()
      });
      await BiliStorage.saveProgress(progress);
      if (!savedOnce) {
        savedOnce = true;
        console.log('[BiliPlaylist] 进度保存成功 bvid=' + bvid + ' p=' + part);
      }
    } catch (e) { /* 忽略 */ }
  }

  // —— 进度恢复（>30s 且留出结尾 30s 才恢复，避免干扰重看） ——
  const MIN_RESUME = 5;   // 看过 5 秒以上就恢复断点（用户要求精确续播）
  async function restoreProgress() {
    try {
      const progress = await BiliStorage.getProgress();
      const p = progress[bvid];
      if (!p || p.part !== part || !(p.time > MIN_RESUME)) return;
      const seek = () => {
        try {
          if (video.duration > 10 && p.time < video.duration - 10) {
            video.currentTime = p.time;
            console.log('[BiliPlaylist] 已恢复进度 bvid=' + bvid + ' p=' + part + ' 到 ' + p.time + 's');
          }
        } catch (e) { /* 忽略 */ }
      };
      if (video.readyState >= 1) seek();
      else {
        video.addEventListener('loadedmetadata', seek, { once: true });
        video.addEventListener('loadeddata', seek, { once: true });
      }
    } catch (e) { /* 忽略 */ }
  }

  // —— 播放结束 ——
  async function onEnded() {
    // 1) 还有下一分P → 无刷新连播：优先点击页面分P列表（选集）中下一分P，失败回退整页跳转
    const total = await getTotalParts();
    if (total && part < total) {
      console.log('[BiliPlaylist] 分P ' + part + '/' + total + ' 结束，切换到下一分P');
      await saveProgress();
      const next = part + 1;
      if (clickNextPart(next)) {
        part = next;
        return;
      }
      const u = new URL(location.href);
      u.searchParams.set('p', String(next));
      u.searchParams.set('page', String(next));
      location.href = u.toString();
      return;
    }
    // 2) 全部分P播完 → 标记完成 + 通知跳转列表下一个视频
    console.log('[BiliPlaylist] bvid=' + bvid + ' 全部播完，通知跳转下一视频');
    try {
      const progress = await BiliStorage.getProgress();
      progress[bvid] = Object.assign({}, progress[bvid] || {}, {
        part,
        time: 0,
        done: true,
        updatedAt: Date.now()
      });
      await BiliStorage.saveProgress(progress);
    } catch (e) { /* 忽略 */ }
    chrome.runtime.sendMessage({ type: 'video-completed', bvid, part }).catch(() => {});
  }

  // 点击页面分P列表（选集）中第 next 个分P，无刷新切换；找不到返回 false
  function clickNextPart(next) {
    const sels = [
      '.video-parts-list [class*="item"]',
      '.list-box [class*="item"]',
      '[class*="part-list"] [class*="item"]',
      '[class*="parts"] [class*="item"]'
    ];
    for (const sel of sels) {
      try {
        const nodes = document.querySelectorAll(sel);
        for (const el of nodes) {
          const txt = (el.textContent || '').trim();
          const m = txt.match(/(?:P|分P)?\s*(\d+)/);
          if (m && parseInt(m[1], 10) === next) {
            el.click();
            console.log('[BiliPlaylist] 已点击分P ' + next);
            return true;
          }
        }
      } catch (e) { /* 忽略 */ }
    }
    console.warn('[BiliPlaylist] 未找到分P列表项，回退整页跳转 p=' + next + '（选集选择器待实测）');
    return false;
  }

  // 分P总数：优先用顶层写入的 currentVideo.pages（加入列表后打开视频时经 view 接口获得，可靠）；
  // 兜底读播放器分P列表 DOM（选择器待实测，见 docs/api-notes.md）；都拿不到返回 null
  async function getTotalParts() {
    try {
      const cv = await BiliStorage.getCurrentVideo();
      if (cv && cv.bvid === bvid && cv.pages) return cv.pages;
    } catch (e) { /* 忽略 */ }
    const candidates = [
      '.list-box .list-item',
      '.video-parts-list .list-item',
      '[class*="part-list"] [class*="item"]',
      '[class*="parts"] [class*="item"]',
      '[class*="list-box"] [class*="item"]'
    ];
    for (const sel of candidates) {
      try {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length >= 1) return nodes.length;
      } catch (e) { /* 忽略 */ }
    }
    return null;
  }

  // 用户手动切换浏览器全屏 → 记录窗口模式
  function onFullscreenChange() {
    const fs = document.fullscreenElement != null;
    BiliStorage.setPlayerMode(fs ? 'fullscreen' : 'default');
  }

  // 应用官方历史同步来的断点（同步完成后调用；仅当保存值明显超前当前播放位置时 seek，避免覆盖用户手动位置）
  async function applySavedProgress() {
    if (!video || !bvid) return;
    try {
      const progress = await BiliStorage.getProgress();
      const p = progress[bvid];
      if (!p || p.part !== part || !(p.time > 5)) return;
      const cur = video.currentTime || 0;
      if (p.time - cur > 10 && video.duration > 10 && p.time < video.duration - 10) {
        video.currentTime = p.time;
        console.log('[BiliPlaylist] 官方历史断点已应用 ' + p.time + 's');
      }
    } catch (e) { /* 忽略 */ }
  }

  return { init, applySavedProgress };
})();
