// BiliPlaylist 存储层
// 统一走 chrome.storage.local（扩展级，跨页面/跨子域共享），key 加 biliplaylist: 前缀
'use strict';

var BiliStorage = (function () {
  const P = 'biliplaylist:';

  async function get(key, fallback) {
    try {
      const raw = await chrome.storage.local.get(key);
      return raw[key] !== undefined ? raw[key] : fallback;
    } catch (e) {
      // 扩展上下文失效（如扩展被重新加载后旧页面脚本仍在运行）：静默返回默认值
      return fallback;
    }
  }

  async function set(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (e) {
      // 同上，静默忽略
    }
  }

  // —— 播放列表 ——
  // item: { bvid, title, pubdate(秒), pages(分P总数|null), addedAt }
  async function getList() {
    const data = await get(P + 'list', { version: 1, items: [] });
    return data && Array.isArray(data.items) ? data.items : [];
  }

  async function saveList(items) {
    await set(P + 'list', { version: 1, items: items || [] });
  }

  // —— 分组元数据（文件夹） ——
  // group: { id, name, color, collapsed }
  // 注意：组成员关系不存这里，而是通过 list 各 item 上的 groupId 表示（undefined = 未分组）
  async function getGroups() {
    const data = await get(P + 'groups', { version: 1, groups: [] });
    return data && Array.isArray(data.groups) ? data.groups : [];
  }

  async function saveGroups(groups) {
    await set(P + 'groups', { version: 1, groups: groups || [] });
  }

  // —— 播放进度 ——
  // progress: { [bvid]: { part, time, done, updatedAt } }
  async function getProgress() {
    return await get(P + 'progress', {});
  }

  async function saveProgress(progress) {
    await set(P + 'progress', progress || {});
  }

  // —— 播放器窗口模式 ——
  // 'default' | 'web-fullscreen' | 'fullscreen'
  async function getPlayerMode() {
    return await get(P + 'playerMode', 'default');
  }

  async function setPlayerMode(mode) {
    await set(P + 'playerMode', mode);
  }

  // —— 当前播放视频信息（顶层写入，播放器 iframe 读取，用于分P连播判断） ——
  // { bvid, pages, updatedAt }
  async function getCurrentVideo() {
    return await get(P + 'currentVideo', {});
  }

  async function saveCurrentVideo(info) {
    await set(P + 'currentVideo', info || {});
  }

  // —— 观看历史备份（仅播放列表内视频，来源：官方历史接口，本地永久保留） ——
  // entries: { bvid, title, author, part, partTitle, time, duration, viewAt }
  async function getHistory() {
    return await get(P + 'history', []);
  }

  async function saveHistory(entries) {
    await set(P + 'history', entries || []);
  }

  // —— 待恢复"网页全屏"标记（顶层写入，播放器 iframe 消费后清除） ——
  async function getPendingWebFs() {
    return await get(P + 'pendingWebFs', false);
  }

  async function setPendingWebFs(v) {
    await set(P + 'pendingWebFs', !!v);
  }

  return {
    getList,
    saveList,
    getGroups,
    saveGroups,
    getProgress,
    saveProgress,
    getPlayerMode,
    setPlayerMode,
    getCurrentVideo,
    saveCurrentVideo,
    getHistory,
    saveHistory,
    getPendingWebFs,
    setPendingWebFs
  };
})();
