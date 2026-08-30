// BiliPlaylist 存储层
// 统一走 chrome.storage.local（扩展级，跨页面/跨子域共享），key 加 biliplaylist: 前缀
'use strict';

var BiliStorage = (function () {
  const P = 'biliplaylist:';

  async function get(key, fallback) {
    const raw = await chrome.storage.local.get(key);
    return raw[key] !== undefined ? raw[key] : fallback;
  }

  async function set(key, value) {
    await chrome.storage.local.set({ [key]: value });
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

  return {
    getList,
    saveList,
    getProgress,
    saveProgress,
    getPlayerMode,
    setPlayerMode
  };
})();
