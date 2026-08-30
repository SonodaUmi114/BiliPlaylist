// BiliPlaylist background（MV3 Service Worker）
// 职责：
//  1) api-fetch 桥：content script 请求 → 在页面 MAIN world 执行 fetch（自动带 cookie / CORS / buvid，等同站点自身请求）
//  2) video-completed 转发：iframe 播放器播完 → 通知该标签页顶层 frame 跳转下一视频
//  3) set-window-fullscreen：无用户手势的窗口级全屏/还原（规避 requestFullscreen 用户激活限制）
'use strict';

// 在页面 MAIN world 执行的 fetch 函数（会被 chrome.scripting 序列化后注入）
async function pageContextFetch(url, opts) {
  const resp = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text: text };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.type) {
        sendResponse({ ok: false, error: 'bad message' });
        return;
      }
      switch (msg.type) {
        case 'api-fetch': {
          if (!sender.tab || sender.frameId === undefined) {
            sendResponse({ ok: false, error: 'no sender frame' });
            return;
          }
          const results = await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
            world: 'MAIN',
            func: pageContextFetch,
            args: [msg.url, msg.opts || {}]
          });
          sendResponse({ ok: true, data: results[0] && results[0].result });
          break;
        }
        case 'video-completed': {
          // 播放器 iframe 播完一个视频（全部分P），通知顶层 frame 处理列表跳转
          if (sender.tab && sender.tab.id !== undefined) {
            try {
              await chrome.tabs.sendMessage(sender.tab.id, {
                type: 'video-completed',
                bvid: msg.bvid,
                part: msg.part
              });
            } catch (e) { /* 顶层可能已关闭 */ }
          }
          sendResponse({ ok: true });
          break;
        }
        case 'set-window-fullscreen': {
          if (sender.tab && sender.tab.windowId !== undefined) {
            const win = await chrome.windows.get(sender.tab.windowId);
            await chrome.windows.update(win.id, { state: msg.state === 'fullscreen' ? 'fullscreen' : 'normal' });
          }
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'unknown type: ' + msg.type });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message || err) });
    }
  })();
  return true; // 异步响应
});
