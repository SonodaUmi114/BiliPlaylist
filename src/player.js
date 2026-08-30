// BiliPlaylist 播放器适配层
// 仅在 player.bilibili.com iframe 内工作（content script 通过 all_frames 注入该跨域 frame）
// 职责：读取当前分P与播放时间、恢复进度、分P无刷新连播（iframe 自身刷新 p 参数）、
//       全部播完通知顶层跳转下一视频、记录用户手动切换的窗口模式
'use strict';

var BiliPlayer = (function () {
  let bvid = null;
  let part = 1;
  let video = null;
  let lastSave = 0;
  let pollTimer = null;

  function getParam(name) {
    return new URLSearchParams(location.search).get(name);
  }

  async function init() {
    bvid = getParam('bvid');
    const pRaw = getParam('p') || getParam('page');
    part = parseInt(pRaw || '1', 10) || 1;
    if (!bvid) {
      // 兜底：iframe URL 无 bvid 参数时，从顶层写入的 currentVideo 读取
      try {
        const cv = await BiliStorage.getCurrentVideo();
        if (cv && cv.bvid) {
          bvid = cv.bvid;
          console.log('[BiliPlaylist] bvid 从 currentVideo 兜底: ' + bvid);
        }
      } catch (e) { /* 忽略 */ }
    }
    if (!bvid) {
      console.warn('[BiliPlaylist] player iframe 未识别 bvid，跳过适配');
      return;
    }
    pollForVideo();
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
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    // 离开页面/切后台前强制保存一次，减少断点丢失（最多丢失 5s 节流窗口）
    window.addEventListener('pagehide', () => saveProgress());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveProgress();
    });
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
  async function restoreProgress() {
    try {
      const progress = await BiliStorage.getProgress();
      const p = progress[bvid];
      if (!p || p.part !== part || !(p.time > 30)) return;
      const seek = () => {
        try {
          if (video.duration > 60 && p.time < video.duration - 30) {
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
    // 1) 还有下一分P → 无刷新连播：iframe 自身刷新 p 参数（顶层页面不刷新）
    const total = await getTotalParts();
    if (total && part < total) {
      console.log('[BiliPlaylist] 分P ' + part + '/' + total + ' 结束，切换到下一分P');
      await saveProgress();
      const u = new URL(location.href);
      const next = String(part + 1);
      // 兼容 p / page 两种参数名，确保 iframe 能识别
      u.searchParams.set('p', next);
      u.searchParams.set('page', next);
      location.href = u.toString();
      return;
    }
    // 2) 全部分P播完 → 标记完成 + 通知顶层跳转列表下一个视频
    console.log('[BiliPlaylist] bvid=' + bvid + ' 全部播完，通知顶层');
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

  return { init };
})();
