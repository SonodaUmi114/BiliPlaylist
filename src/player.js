// BiliPlaylist 播放器适配层
// 仅在 player.bilibili.com iframe 内工作（content script 通过 all_frames 注入该跨域 frame）
// 职责：读取当前分P与播放时间、恢复进度、分P无刷新连播（iframe 自身刷新 p 参数）、
//       全部播完通知顶层跳转下一视频、记录用户手动切换的窗口模式
'use strict';

var BiliPlayer = (function () {
  // 断点方案（2025）：B 站播放器自身恢复"上次看到"（官方最新），插件**不再主动 seek**（避免打架）；
  // 插件只做捕获保存（页面加载 5s 后读播放器实际位置 + 关闭时保存一次），B 站未恢复时才本地兜底。
  // 旧的 video 元素"轮询"保存仍停用（代码留存于 git 历史）
  const USE_OFFICIAL_PROGRESS = true; // true = 关闭轮询，只保留关闭时一次保存
  const DO_NOT_SEEK = true;           // 不再主动 seek（B 站播放器自己恢复为准）

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
    tryRestoreWebFullscreen();
    video.addEventListener('ended', onEnded);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    if (!USE_OFFICIAL_PROGRESS) {
      // 旧方案（已停用）：video 元素轮询保存断点
      video.addEventListener('timeupdate', onTimeUpdate);
    }
    // 关闭标签页/切走时保存一次精确进度（本地备份，不 seek）
    window.addEventListener('pagehide', () => saveLocalProgress());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveLocalProgress();
    });
    // 5s 后捕获播放器实际位置（含 B 站自身恢复后的位置）做本地备份；
    // 若此时仍停在开头且本地有断点 → 说明 B 站未恢复，本地兜底 seek
    setTimeout(() => captureCurrentPosition(), 5000);
  }

  // 捕获当前播放位置（本地备份；B 站未恢复断点时兜底 seek）
  async function captureCurrentPosition() {
    if (!video || !bvid) return;
    try {
      const cur = Math.floor(video.currentTime || 0);
      const progress = await BiliStorage.getProgress();
      const p = progress[bvid] || {};
      // 分P变化时必须保存（新分P时间往往从 0 开始，比旧分P的 time 小）；同分P才按时间更靠后保存
      if (cur > 5 && (part !== (p.part || 1) || cur >= (p.time || 0))) {
        progress[bvid] = { part, time: cur, updatedAt: Date.now(), source: 'player' };
        await BiliStorage.saveProgress(progress);
      }
      // B 站播放器未恢复（5s 后仍在开头）且本地有断点 → 兜底 seek（仅相同分P才应用，避免跨分P串位置）
      if (p.part === part && (p.time || 0) > 5 && cur < 5 && video.duration > 10 && p.time < video.duration - 10) {
        video.currentTime = p.time;
        console.log('[BiliPlaylist] B站未恢复断点，本地兜底 ' + p.time + 's');
      }
      // 非最后一分P → 清除之前误判的「已看完」，避免显示成已看完/触发错误跳转
      progress[bvid] = progress[bvid] || p;
      if (progress[bvid].done) {
        const total = await getTotalParts();
        if (total && part < total) {
          progress[bvid].done = false;
          progress[bvid].updatedAt = Date.now();
          await BiliStorage.saveProgress(progress);
        }
      }
    } catch (e) { /* 忽略 */ }
  }

  // 关闭/切走时保存一次精确位置（不轮询；分P变化则保存，同分P时间不小于本地已有值才覆盖）
  async function saveLocalProgress() {
    if (!video || !bvid) return;
    try {
      const time = Math.floor(video.currentTime || 0);
      if (!(time > 5)) return;
      const progress = await BiliStorage.getProgress();
      const prev = progress[bvid] || {};
      if (part !== (prev.part || 1) || time >= (prev.time || 0) || !(prev.updatedAt || 0)) {
        progress[bvid] = { part, time, updatedAt: Date.now(), source: 'local' };
        await BiliStorage.saveProgress(progress);
      }
    } catch (e) { /* 忽略 */ }
  }

  // 记录「已切换到的当前分P」（分P变化时立即写入，使断点不卡在旧分P）
  async function saveCurrentPart() {
    if (!bvid) return;
    try {
      const time = Math.floor((video && video.currentTime) || 0);
      const progress = await BiliStorage.getProgress();
      const prev = progress[bvid] || {};
      if (part !== (prev.part || 1)) {
        progress[bvid] = { part, time, done: false, updatedAt: Date.now(), source: 'part' };
        await BiliStorage.saveProgress(progress);
      }
    } catch (e) { /* 忽略 */ }
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
  const MIN_RESUME = 5;   // 兜底恢复阈值（仅 B 站未恢复时使用）
  async function restoreProgress() {
    if (DO_NOT_SEEK) return; // 2025: 不再主动 seek，以 B 站播放器自身恢复为准
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
      const next = part + 1;
      if (clickNextPart(next)) {
        part = next;
        await saveCurrentPart(); // 立即记录已切换到的新分P，并清除误判的 done
        return;
      }
      const u = new URL(location.href);
      u.searchParams.set('p', String(next));
      u.searchParams.set('page', String(next));
      location.href = u.toString();
      return;
    }
    // 2) 若分P总数未知：不能确定已播完，保守尝试下一分P；点不到则不判完成、不跳转下一视频（避免误跳/误标已看完）
    if (!total) {
      const next = part + 1;
      if (clickNextPart(next)) {
        part = next;
        await saveCurrentPart();
        return;
      }
      console.warn('[BiliPlaylist] 无法确定分P总数且未找到下一分P，不自动跳转下一视频（避免误判）');
      return;
    }
    // 3) 分P总数已知且已到最后一P → 标记完成 + 通知跳转列表下一个视频
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

  // 分P总数：优先顶层写入的 currentVideo.pages；其次播放列表 item 缓存的 pages；再兜底读分P列表 DOM
  async function getTotalParts() {
    try {
      const cv = await BiliStorage.getCurrentVideo();
      if (cv && cv.bvid === bvid && cv.pages) return cv.pages;
    } catch (e) { /* 忽略 */ }
    try {
      const list = await BiliStorage.getList();
      const it = list.find((x) => x.bvid === bvid);
      if (it && it.pages) return it.pages;
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

  // 应用官方历史同步来的断点（已停用主动 seek，仅保留兜底由 captureCurrentPosition 处理）
  async function applySavedProgress() {
    if (DO_NOT_SEEK) return;
    if (!video || !bvid) return;
    try {
      const progress = await BiliStorage.getProgress();
      const p = progress[bvid];
      if (!p || p.part !== part || !(p.time > 5)) return;
      const cur = video.currentTime || 0;
      if (p.time - cur > 10 && video.duration > 10 && p.time < video.duration - 10) {
        video.currentTime = p.time;
        console.log('[BiliPlaylist] 官方/本地断点已应用 ' + p.time + 's');
      }
    } catch (e) { /* 忽略 */ }
  }

  return { init, applySavedProgress };
})();
