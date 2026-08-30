// BiliPlaylist UI 层
// 侧边栏 / 右下角热区悬浮按钮 / 视频页加入按钮 / 空间页多选
// 所有 UI 用 Shadow DOM 隔离（白灰简约、B站风格）；空间页卡片勾选框需注入页面 DOM，
// 其样式通过独立 <style id="biliplaylist-page-css"> 前缀类注入（最小污染）
'use strict';

var BiliUI = (function () {
  const HOTZONE = 120;            // 右下角热区半径（px）
  const FAB_HIDE_DELAY = 1200;    // 移出热区后延迟隐藏（ms）

  let host = null;                // shadow host
  let root = null;                // shadow root
  let fab = null;
  let panel = null;
  let listEl = null;
  let countEl = null;
  let open = false;
  let hideTimer = null;
  let modeState = 'default';
  let dragIndex = -1;
  let currentBvid = null;
  let isVideoPage = false;
  let isSpacePage = false;

  // 空间页多选状态
  const sel = { map: new Map(), bar: null, countEl: null, observer: null };

  const SHADOW_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
    .fab {
      position: fixed; right: 24px; bottom: 150px; z-index: 2147483646;
      width: 44px; height: 44px; border-radius: 50%;
      background: #ffffff; color: #61666d;
      border: 1px solid #e3e5e7; box-shadow: 0 2px 8px rgba(0,0,0,.12);
      font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: opacity .2s, transform .2s;
      opacity: 0; transform: translateY(8px); pointer-events: none;
    }
    .fab.show { opacity: 1; transform: none; pointer-events: auto; }
    .fab:hover { background: #f5f6f7; }
    .panel {
      position: fixed; top: 0; right: 0; bottom: 0; width: 340px; z-index: 2147483647;
      background: #ffffff; border-left: 1px solid #e3e5e7;
      box-shadow: -4px 0 16px rgba(0,0,0,.08);
      display: flex; flex-direction: column;
      transform: translateX(100%); transition: transform .25s ease;
    }
    .panel.open { transform: none; }
    .panel-head {
      padding: 12px 14px; border-bottom: 1px solid #f1f2f3;
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    }
    .panel-title { font-size: 15px; font-weight: 600; color: #18191c; }
    .panel-count { font-size: 12px; color: #9499a0; }
    .modes { display: flex; gap: 4px; margin-left: auto; }
    .modes button {
      border: 1px solid #e3e5e7; background: #fff; color: #61666d;
      font-size: 11px; padding: 2px 8px; border-radius: 10px; cursor: pointer; white-space: nowrap;
    }
    .modes button.on { background: #00aeec; border-color: #00aeec; color: #fff; }
    .close { border: none; background: none; color: #9499a0; font-size: 16px; cursor: pointer; padding: 2px 6px; }
    .close:hover { color: #18191c; }
    .list { flex: 1; overflow-y: auto; padding: 8px; list-style: none; }
    .item {
      display: flex; gap: 8px; padding: 10px; border-radius: 8px; cursor: grab;
    }
    .item:hover { background: #f5f6f7; }
    .item.dragging { opacity: .5; }
    .item.drag-over { background: #eef7fd; }
    .item.current .title { color: #00aeec; }
    .item-main { flex: 1; min-width: 0; }
    .title { font-size: 13px; color: #18191c; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-all; }
    .meta { font-size: 12px; color: #9499a0; margin-top: 4px; }
    .meta .done { color: #00aeec; font-weight: 600; }
    .actions { display: flex; flex-direction: column; gap: 4px; }
    .actions button {
      width: 24px; height: 24px; border: 1px solid #e3e5e7; background: #fff; color: #61666d;
      border-radius: 6px; cursor: pointer; font-size: 13px; line-height: 1;
    }
    .actions button:hover { background: #f1f2f3; }
    .empty { padding: 40px 16px; text-align: center; color: #9499a0; font-size: 13px; line-height: 1.8; }
    .add-btn {
      position: fixed; right: 24px; bottom: 205px; z-index: 2147483646;
      border: 1px solid #e3e5e7; background: #ffffff; color: #18191c;
      font-size: 13px; padding: 7px 12px; border-radius: 16px; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.12);
    }
    .add-btn:hover { background: #f5f6f7; }
    .add-btn.flash { background: #eef7fd; border-color: #00aeec; }
    .sel-bar {
      position: fixed; top: 80px; right: 24px; z-index: 2147483646;
      background: #ffffff; border: 1px solid #e3e5e7; border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,.1); padding: 8px 12px;
      display: flex; align-items: center; gap: 8px; font-size: 13px; color: #18191c;
    }
    .sel-bar .count { color: #00aeec; font-weight: 600; }
    .sel-bar button {
      border: 1px solid #e3e5e7; background: #fff; color: #61666d;
      font-size: 12px; padding: 3px 10px; border-radius: 12px; cursor: pointer;
    }
    .sel-bar button.primary { background: #00aeec; border-color: #00aeec; color: #fff; }
    .sel-bar button:hover { background: #f5f6f7; }
    .sel-bar button.primary:hover { background: #00b3f0; }
  `;

  // 空间页卡片勾选框样式（注入页面 DOM 的样式表，前缀类名避免冲突）
  const PAGE_CSS = `
    .biliplaylist-card { position: relative !important; }
    .biliplaylist-card.biliplaylist-selected::after {
      content: ''; position: absolute; inset: 0; z-index: 8;
      border: 2px solid #00aeec; border-radius: 6px; pointer-events: none; box-sizing: border-box;
    }
    .biliplaylist-check {
      position: absolute; top: 8px; left: 8px; z-index: 9;
      width: 18px; height: 18px; border-radius: 4px;
      border: 2px solid #9499a0; background: #ffffff;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 12px; color: #fff; line-height: 1; user-select: none;
    }
    .biliplaylist-check.on { background: #00aeec; border-color: #00aeec; }
  `;

  // ---------- 工具 ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }

  function parsePubdate(text) {
    const m = String(text || '').match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000);
    return 0;
  }

  // ---------- 初始化（顶层 frame 调用） ----------
  function initTop() {
    const u = new URL(location.href);
    isVideoPage = u.hostname === 'www.bilibili.com' && /^\/video\//.test(u.pathname);
    isSpacePage = u.hostname === 'space.bilibili.com' &&
      (/\/video$/.test(u.pathname) || /\/search$/.test(u.pathname));
    const m = u.pathname.match(/^\/video\/(BV\w+)/);
    if (m) currentBvid = m[1];

    ensureSidebar();
    initFab();
    initModes();
    if (isVideoPage) initAddButton();
    if (isSpacePage) initSpaceSelect();
    renderList();
    initStorageSync();
  }

  // ---------- Shadow DOM 骨架 ----------
  function ensureSidebar() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'biliplaylist-root';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${SHADOW_CSS}</style>
      <button class="fab" id="fab" title="播放列表">☰</button>
      <aside class="panel" id="panel">
        <header class="panel-head">
          <span class="panel-title">播放列表</span>
          <span class="panel-count" id="count"></span>
          <div class="modes">
            <button data-mode="default">默认</button>
            <button data-mode="web-fullscreen">网页全屏</button>
            <button data-mode="fullscreen">全屏</button>
          </div>
          <button class="close" id="close" title="关闭">✕</button>
        </header>
        <ul class="list" id="list"></ul>
      </aside>
    `;
    document.documentElement.appendChild(host);
    fab = root.querySelector('#fab');
    panel = root.querySelector('#panel');
    listEl = root.querySelector('#list');
    countEl = root.querySelector('#count');
    root.querySelector('#close').addEventListener('click', () => togglePanel(false));
    // 页面级样式（空间页卡片勾选框用）
    if (!document.getElementById('biliplaylist-page-css')) {
      const style = document.createElement('style');
      style.id = 'biliplaylist-page-css';
      style.textContent = PAGE_CSS;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  // ---------- 悬浮按钮 + 热区 ----------
  function initFab() {
    fab.addEventListener('click', () => togglePanel());
    document.addEventListener('mousemove', onMouseMove);
  }

  function onMouseMove(e) {
    const near = (window.innerWidth - e.clientX) < HOTZONE &&
                 (window.innerHeight - e.clientY) < HOTZONE;
    clearTimeout(hideTimer);
    if (near) {
      fab.classList.add('show');
    } else {
      hideTimer = setTimeout(() => {
        if (!open) fab.classList.remove('show');
      }, FAB_HIDE_DELAY);
    }
  }

  function togglePanel(force) {
    open = force !== undefined ? force : !open;
    panel.classList.toggle('open', open);
    if (open) {
      fab.classList.add('show');
      renderList();
    }
  }

  // ---------- 窗口模式 ----------
  async function initModes() {
    modeState = await BiliStorage.getPlayerMode();
    refreshModeButtons();
    root.querySelectorAll('.modes button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        modeState = btn.dataset.mode;
        await BiliStorage.setPlayerMode(modeState);
        refreshModeButtons();
      });
    });
  }

  function refreshModeButtons() {
    root.querySelectorAll('.modes button').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.mode === modeState);
    });
  }

  // ---------- 列表渲染 ----------
  async function renderList() {
    if (!root) return;
    const items = await BiliStorage.getList();
    const progress = await BiliStorage.getProgress();
    countEl.textContent = items.length ? items.length + ' 个' : '';
    if (!items.length) {
      listEl.innerHTML = '<div class="empty">播放列表为空<br>在 UP 主空间多选视频批量加入，<br>或在视频页点击「＋ 加入播放列表」</div>';
      return;
    }
    listEl.innerHTML = '';
    items.forEach((it, idx) => {
      const p = progress[it.bvid] || {};
      const part = p.part || 1;
      const pages = it.pages || '?';
      const time = p.time || 0;
      const done = !!p.done;
      const current = isVideoPage && it.bvid === currentBvid;
      const li = document.createElement('li');
      li.className = 'item' + (current ? ' current' : '');
      li.draggable = true;
      li.dataset.bvid = it.bvid;
      li.innerHTML =
        '<div class="item-main">' +
          '<div class="title">' + escapeHtml(it.title || it.bvid) + '</div>' +
          '<div class="meta">分P ' + part + '/' + pages + ' · ' + fmtTime(time) +
            (done ? ' · <span class="done">✓ 已看完</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="actions">' +
          '<button class="refresh" title="刷新（重新同步列表与进度）">↻</button>' +
          '<button class="del" title="删除">✕</button>' +
        '</div>';
      li.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        jumpToVideo(it.bvid);
      });
      li.querySelector('.refresh').addEventListener('click', async (e) => {
        e.stopPropagation();
        await renderList();
      });
      li.querySelector('.del').addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeItem(it.bvid);
      });
      // 拖拽排序
      li.addEventListener('dragstart', (e) => {
        dragIndex = idx;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', it.bvid);
      });
      li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drag-over'); });
      li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        li.classList.remove('drag-over');
        await moveItem(dragIndex, idx);
      });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      listEl.appendChild(li);
    });
  }

  async function addItems(newItems) {
    if (!newItems || !newItems.length) return;
    const list = await BiliStorage.getList();
    const byBvid = new Map(list.map((it) => [it.bvid, it]));
    for (const it of newItems) {
      if (it.bvid && !byBvid.has(it.bvid)) {
        byBvid.set(it.bvid, Object.assign({ addedAt: Date.now() }, it));
      }
    }
    let merged = Array.from(byBvid.values());
    // 自动排序：按发布时间升序（旧→新）；无发布时间的排到最后（保持相对顺序）
    merged = merged.sort((a, b) => {
      const pa = a.pubdate || Number.MAX_SAFE_INTEGER;
      const pb = b.pubdate || Number.MAX_SAFE_INTEGER;
      return pa - pb;
    });
    await BiliStorage.saveList(merged);
    renderList();
  }

  async function removeItem(bvid) {
    const list = await BiliStorage.getList();
    await BiliStorage.saveList(list.filter((it) => it.bvid !== bvid));
    renderList();
  }

  async function moveItem(from, to) {
    if (from < 0 || to < 0 || from === to) return;
    const list = await BiliStorage.getList();
    if (from >= list.length || to >= list.length) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    await BiliStorage.saveList(list);
    renderList();
  }

  function jumpToVideo(bvid) {
    location.href = 'https://www.bilibili.com/video/' + bvid +
      '?p=1&fromPlaylist=1&playerMode=' + modeState;
  }

  // ---------- 视频页「加入播放列表」按钮 ----------
  function initAddButton() {
    const btn = document.createElement('button');
    btn.className = 'add-btn';
    btn.textContent = '＋ 加入播放列表';
    btn.addEventListener('click', async () => {
      if (!currentBvid) {
        console.warn('[BiliPlaylist] 未找到当前视频 bvid');
        return;
      }
      let item = { bvid: currentBvid, title: '', pubdate: 0, pages: null };
      try {
        const v = await BiliApi.fetchView(currentBvid);
        item.title = v.data.title;
        item.pubdate = v.data.pubdate || 0;
        item.pages = (v.data.pages || []).length || null;
      } catch (e) {
        console.warn('[BiliPlaylist] 获取视频信息失败，退回页面标题', e);
        item.title = document.title.replace(/_[^_]*$/, '').trim();
      }
      await addItems([item]);
      flashButton(btn);
    });
    root.appendChild(btn);
  }

  function flashButton(btn) {
    btn.textContent = '已加入 ✓';
    btn.classList.add('flash');
    setTimeout(() => {
      btn.textContent = '＋ 加入播放列表';
      btn.classList.remove('flash');
    }, 1200);
  }

  // ---------- 空间页多选 ----------
  function initSpaceSelect() {
    ensureSelBar();
    attachToCards();
    sel.observer = new MutationObserver(() => attachToCards());
    sel.observer.observe(document.body, { childList: true, subtree: true });
  }

  function ensureSelBar() {
    if (sel.bar) return;
    const bar = document.createElement('div');
    bar.className = 'sel-bar';
    bar.innerHTML =
      '<span>已选 <b class="count">0</b> 个</span>' +
      '<button class="primary" id="addSel">加入播放列表</button>' +
      '<button id="clearSel">清空</button>';
    root.appendChild(bar);
    sel.bar = bar;
    sel.countEl = bar.querySelector('.count');
    bar.querySelector('#addSel').addEventListener('click', addSelected);
    bar.querySelector('#clearSel').addEventListener('click', clearSelection);
  }

  function getCardAnchors() {
    return Array.from(document.querySelectorAll('a[href*="/video/BV"]'))
      .filter((a) => !a.closest('#biliplaylist-root') && !a.dataset.biliplaylistSel);
  }

  function attachToCards() {
    for (const a of getCardAnchors()) {
      a.dataset.biliplaylistSel = '1';
      a.classList.add('biliplaylist-card');
      const box = document.createElement('span');
      box.className = 'biliplaylist-check';
      box.textContent = '✓';
      box.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSelect(a, box);
      });
      a.appendChild(box);
      sel.map.set(a, box);
    }
  }

  function toggleSelect(a, box) {
    const on = a.classList.toggle('biliplaylist-selected');
    box.classList.toggle('on', on);
    updateSelCount();
  }

  function clearSelection() {
    for (const [a, box] of sel.map) {
      a.classList.remove('biliplaylist-selected');
      box.classList.remove('on');
    }
    updateSelCount();
  }

  function updateSelCount() {
    if (!sel.countEl) return;
    let n = 0;
    for (const a of sel.map.keys()) {
      if (a.classList.contains('biliplaylist-selected')) n++;
    }
    sel.countEl.textContent = String(n);
  }

  function extractCard(a) {
    const m = (a.href || '').match(/\/video\/(BV\w+)/);
    if (!m) return null;
    const bvid = m[1];
    let title = '';
    const t = a.querySelector('.bili-video-card__info--tit, .title, [title]');
    if (t) {
      title = (t.getAttribute('title') || t.textContent || '').trim();
    }
    if (!title) title = (a.getAttribute('title') || '').trim();
    let dateText = '';
    const d = a.querySelector('.bili-video-card__info--date, .date, [class*="date"]');
    if (d) dateText = d.textContent.trim();
    return { bvid, title, pubdate: parsePubdate(dateText), pages: null };
  }

  async function addSelected() {
    const items = [];
    for (const [a] of sel.map) {
      if (!a.classList.contains('biliplaylist-selected')) continue;
      const card = extractCard(a);
      if (card) items.push(card);
    }
    await addItems(items);
    clearSelection();
    console.log('[BiliPlaylist] 已批量加入 ' + items.length + ' 个视频');
  }

  // ---------- 存储同步 ----------
  function initStorageSync() {
    let timer = null;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const keys = Object.keys(changes);
      if (!keys.some((k) => k.indexOf('biliplaylist:') === 0)) return;
      clearTimeout(timer);
      timer = setTimeout(() => refresh(), 300);
    });
  }

  async function refresh() {
    modeState = await BiliStorage.getPlayerMode();
    refreshModeButtons();
    renderList();
  }

  return { initTop };
})();
