// BiliPlaylist UI 层
// 侧边栏 / 右下角热区按钮簇（侧边栏 + 视频页"加入列表" / 空间页"多选"）/ 空间页多选
// 所有 UI 用 Shadow DOM 隔离（白灰简约、B站风格）；空间页卡片多选框注入页面 DOM，
// 样式通过独立 <style id="biliplaylist-page-css"> 前缀类注入（最小污染）
'use strict';

var BiliUI = (function () {
  const HOTZONE = 120;          // 右下角热区半径（px）
  const FAB_HIDE_DELAY = 1200;  // 移出热区后延迟隐藏（ms）
  const HOT_CENTER = 60;        // 热区中心距边距 = HOTZONE/2
  const FAB_SIZE = 44;          // 侧边栏按钮直径
  const BTN_GAP = 8;            // 按钮间距
  const SIDE_BTN_RIGHT = HOT_CENTER + FAB_SIZE + BTN_GAP; // 页面按钮在侧边栏按钮左侧平行

  let host = null;              // shadow host
  let root = null;              // shadow root
  let fab = null;
  let panel = null;
  let listEl = null;
  let countEl = null;
  let open = false;
  let hideTimer = null;
  let modeState = 'default';
  let dragIndex = -1;
  let dragBvid = null;          // 当前被拖拽的单个条目 bvid（普通模式使用）
  let isDragging = false;
  let currentBvid = null;
  let isVideoPage = false;
  let isSpacePage = false;
  const clusterBtns = [];       // 热区按钮簇（fab + 页面相关按钮）

  // 侧边栏「排序模式」状态：多选 / 分组拖拽 / 按日期自动排序 / 撤销
  let sortMode = false;         // 是否处于排序（编辑）模式
  let sortDirection = 'asc';    // 自动排序方向：'asc' | 'desc'
  let anchorIndex = -1;         // Shift 范围选择的锚点（当前列表 index）
  let biliSel = new Set();      // 排序模式下选中的视频 bvid 集合
  const undoStack = [];         // 撤销快照（list items 数组深拷贝，≤20 个）
  let dropLine = null;          // 分组拖拽时的落点指示线元素
  let dropAtIdx = -1;           // 落点目标下标（list 中的 index）
  let dropAfter = false;        // 落点是否位于目标条目之后

  // 「分组/文件夹」状态
  let currentItems = [];        // 最近一次渲染的列表（含折叠组里隐藏的成员），供 index/范围计算使用
  let dragFolderId = null;      // 正在拖拽的文件夹 id（拖动整个组）
  let dropOnFolder = null;      // 鼠标悬停在某个文件夹标签上（拖进该组）
  let renamedInput = null;      // 正在重命名的输入框

  // 空间页多选状态
  const sel = { mode: false, map: new Map(), bar: null, button: null, countEl: null, observer: null };

  const SHADOW_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
    .fab {
      position: fixed; right: ${HOT_CENTER}px; bottom: ${HOT_CENTER}px; z-index: 2147483646;
      width: ${FAB_SIZE}px; height: ${FAB_SIZE}px; border-radius: 50%;
      background: #ffffff; color: #61666d;
      border: 1px solid #e3e5e7; box-shadow: 0 2px 8px rgba(0,0,0,.12);
      font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: opacity .2s, transform .2s;
      opacity: 0; transform: translateY(8px); pointer-events: none;
    }
    .side-btn {
      position: fixed; right: ${SIDE_BTN_RIGHT}px; bottom: ${HOT_CENTER}px; z-index: 2147483646;
      border: 1px solid #e3e5e7; background: #ffffff; color: #18191c;
      font-size: 13px; padding: 10px 14px; border-radius: 22px; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.12); white-space: nowrap;
      display: flex; align-items: center; justify-content: center;
      transition: opacity .2s, transform .2s;
      opacity: 0; transform: translateY(8px); pointer-events: none;
    }
    .fab.show, .side-btn.show { opacity: 1; transform: none; pointer-events: auto; }
    .fab:hover { background: #f5f6f7; }
    .side-btn:hover { background: #f5f6f7; }
    .side-btn.on { background: #00aeec; border-color: #00aeec; color: #fff; }
    .side-btn.on:hover { background: #00b3f0; }
    .side-btn.flash { background: #eef7fd; border-color: #00aeec; }
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
      display: flex; align-items: center; gap: 6px; flex-wrap: nowrap;
    }
    .panel-title { font-size: 15px; font-weight: 600; color: #18191c; white-space: nowrap; }
    .panel-count { font-size: 12px; color: #9499a0; white-space: nowrap; }
    .mode-select {
      border: 1px solid #e3e5e7; background: #fff; color: #61666d;
      font-size: 11px; padding: 2px 4px; border-radius: 6px; cursor: pointer;
      margin-left: auto; max-width: 96px; white-space: nowrap;
    }
    .refresh-all, .close {
      border: none; background: none; color: #9499a0; font-size: 15px; cursor: pointer; padding: 2px 6px;
    }
    .refresh-all:hover, .close:hover { color: #18191c; }
    .refresh-all.busy { opacity: .5; pointer-events: none; }
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
    .author { font-size: 12px; color: #9499a0; margin-top: 2px; }
    .meta { font-size: 12px; color: #9499a0; margin-top: 4px; }
    .meta .done { color: #00aeec; font-weight: 600; }
    .actions { display: flex; flex-direction: column; gap: 4px; }
    .actions .play:hover { color: #00aeec; border-color: #00aeec; }
    .actions button {
      width: 24px; height: 24px; border: 1px solid #e3e5e7; background: #fff; color: #61666d;
      border-radius: 6px; cursor: pointer; font-size: 13px; line-height: 1;
    }
    .actions button:hover { background: #f1f2f3; }
    .empty { padding: 40px 16px; text-align: center; color: #9499a0; font-size: 13px; line-height: 1.8; }
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
    .toast {
      position: fixed; bottom: 130px; left: 50%; transform: translateX(-50%) translateY(8px);
      z-index: 2147483647; background: #ffffff; border: 1px solid #e3e5e7; color: #18191c;
      font-size: 13px; padding: 8px 16px; border-radius: 8px; white-space: nowrap;
      box-shadow: 0 4px 16px rgba(0,0,0,.14);
      opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    /* —— 排序模式：头部按钮 + 排序工具栏 + 条目勾选 + 落点指示线 —— */
    .sort-toggle {
      border: 1px solid #e3e5e7; background: #fff; color: #61666d;
      width: 26px; height: 24px; border-radius: 6px; cursor: pointer; font-size: 14px; line-height: 1;
      display: flex; align-items: center; justify-content: center; padding: 0;
    }
    .sort-toggle:hover { background: #f5f6f7; }
    .sort-toggle.on { background: #00aeec; border-color: #00aeec; color: #fff; }
    .sort-bar {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      padding: 8px 14px; border-bottom: 1px solid #f1f2f3; font-size: 12px; color: #18191c;
    }
    .sort-bar .sel-count { color: #61666d; white-space: nowrap; }
    .sort-bar .sel-count-n { color: #00aeec; font-weight: 600; }
    .sort-bar button {
      border: 1px solid #e3e5e7; background: #fff; color: #61666d;
      font-size: 12px; padding: 2px 8px; border-radius: 10px; cursor: pointer; white-space: nowrap;
    }
    .sort-bar button:hover { background: #f5f6f7; }
    .sort-bar button.primary { background: #00aeec; border-color: #00aeec; color: #fff; }
    .sort-bar button.primary:hover { background: #00b3f0; }
    .sort-bar select {
      border: 1px solid #e3e5e7; background: #fff; color: #61666d;
      font-size: 11px; padding: 1px 3px; border-radius: 6px; cursor: pointer;
    }
    .item .sel-check {
      width: 16px; height: 16px; border: 2px solid #c6cbd1; border-radius: 4px;
      flex: none; display: none; align-items: center; justify-content: center;
      font-size: 11px; color: #fff; background: #fff; margin-top: 2px;
    }
    .item .sel-check::after { content: '✓'; opacity: 0; }
    .sorting .item .sel-check { display: flex; }
    .item.selected { background: #eef7fd; }
    .item.selected .sel-check { background: #00aeec; border-color: #00aeec; }
    .item.selected .sel-check::after { opacity: 1; }
    .drop-line { height: 2px; background: #00aeec; border-radius: 1px; margin: 0 8px; }
    /* —— 分组/文件夹 —— */
    .folder-head {
      border-radius: 8px; cursor: pointer; background: #f7f8fa; border: 1px solid #eef0f3;
      margin: 2px 0 4px; padding: 6px 8px;
    }
    .folder-head:hover { background: #f0f2f5; }
    .folder-head.drag-over-folder { background: #eef7fd; border-color: #00aeec; }
    .folder-row { display: flex; align-items: center; gap: 6px; }
    .folder-head .chev { width: 14px; text-align: center; color: #9499a0; font-size: 11px; flex: none; transition: transform .15s; }
    .folder-head.collapsed .chev { transform: rotate(-90deg); }
    .folder-head .folder-check {
      width: 16px; height: 16px; border: 2px solid #c6cbd1; border-radius: 4px;
      flex: none; display: none; align-items: center; justify-content: center;
      font-size: 11px; color: #fff; background: #fff;
    }
    .folder-head .folder-check::before { content: '·'; opacity: 0; font-weight: 700; }
    .folder-head .folder-check::after { content: '✓'; opacity: 0; }
    .sorting .folder-head .folder-check { display: flex; }
    .folder-head.selected { background: #eef7fd; }
    .folder-head.selected .folder-check { background: #00aeec; border-color: #00aeec; }
    .folder-head.selected .folder-check::after { opacity: 1; }
    .folder-head.partial .folder-check { border-color: #00aeec; background: #fff; }
    .folder-head.partial .folder-check::before { opacity: 1; }
    .folder-name { font-size: 13px; font-weight: 600; color: #18191c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .folder-rename-input {
      font-size: 13px; font-weight: 600; color: #18191c; border: 1px solid #00aeec; border-radius: 4px;
      padding: 0 4px; outline: none; min-width: 60px; box-sizing: border-box;
    }
    .folder-count { font-size: 11px; color: #9499a0; white-space: nowrap; }
    .folder-tools { margin-left: auto; display: flex; gap: 2px; align-items: center; flex: none; }
    .folder-tools button { border: none; background: none; color: #9499a0; cursor: pointer; font-size: 12px; padding: 2px 3px; }
    .folder-tools button:hover { color: #18191c; }
    .folder-summary { display: flex; align-items: center; gap: 6px; padding: 4px 8px 2px 20px; font-size: 11px; color: #9499a0; }
    .folder-summary .fs-t { color: #61666d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .item.grouped { margin-left: 24px; }
  `;

  // 空间页卡片多选样式（注入页面 DOM，前缀类名避免冲突）
  const PAGE_CSS = `
    .biliplaylist-card { position: relative !important; }
    .biliplaylist-select-layer {
      position: absolute; inset: 0; z-index: 10; cursor: pointer; background: transparent;
    }
    .biliplaylist-card:hover .biliplaylist-select-layer { background: rgba(0, 174, 236, 0.05); }
    .biliplaylist-card.biliplaylist-selected .biliplaylist-select-layer { background: rgba(0, 174, 236, 0.08); }
    .biliplaylist-card.biliplaylist-selected::after {
      content: ''; position: absolute; inset: 0; z-index: 12;
      border: 2px solid #00aeec; border-radius: 6px; pointer-events: none; box-sizing: border-box;
    }
    .biliplaylist-check {
      position: absolute; z-index: 11; width: 18px; height: 18px; border-radius: 4px;
      border: 2px solid #9499a0; background: #ffffff;
      font-size: 12px; color: #fff; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none; user-select: none;
    }
    .biliplaylist-check.on { background: #00aeec; border-color: #00aeec; }
    .biliplaylist-card.biliplaylist-select-active img { pointer-events: none; }
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
    const s = String(text || '');
    // 兼容 2024-05-01 / 2024/05/01 / 2024.05.01（及带时间/后缀）
    const m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000);
    // 兼容 "MM-DD"（无年份）→ 视为当年
    const m2 = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
    if (m2) {
      const now = new Date();
      return Math.floor(Date.UTC(now.getUTCFullYear(), +m2[1] - 1, +m2[2]) / 1000);
    }
    return 0;
  }

  // 仅对「未分组」段按发布日期升序重排，保持分组连续性不变（组内与组间都不动）
  function sortUngroupedRunsAsc(items) {
    const runs = [];
    let cur = [];
    let curGid = null;
    for (const it of items) {
      const gid = it.groupId || null;
      if (!cur.length) { curGid = gid; cur = [it]; continue; }
      if (gid === curGid) { cur.push(it); }
      else { runs.push({ gid: curGid, items: cur }); curGid = gid; cur = [it]; }
    }
    if (cur.length) runs.push({ gid: curGid, items: cur });
    const rebuilt = [];
    for (const run of runs) {
      if (run.gid === null) {
        run.items = run.items.slice().sort((a, b) => {
          const pa = a.pubdate || Number.MAX_SAFE_INTEGER;
          const pb = b.pubdate || Number.MAX_SAFE_INTEGER;
          return pa - pb;
        });
      }
      rebuilt.push(...run.items);
    }
    return rebuilt;
  }

  // ---------- 初始化（顶层 frame 调用） ----------
  async function initTop() {
    const u = new URL(location.href);
    isVideoPage = u.hostname === 'www.bilibili.com' && /^\/video\//.test(u.pathname);
    isSpacePage = u.hostname === 'space.bilibili.com' &&
      (/\/video$/.test(u.pathname) || /\/search$/.test(u.pathname));
    const m = u.pathname.match(/^\/video\/(BV\w+)/);
    if (m) currentBvid = m[1];

    ensureSidebar();
    initFab();
    initModes();
    updateSideButtons();
    // 默认收起：每次加载页面时把各分组重置为收起（手动展开状态不跨刷新保持）
    await resetGroupsCollapsed();
    renderList();
    initStorageSync();
    initSpaWatcher();
    // 自动同步官方历史（节流 1 分钟一次，视频页/空间页；≤5 页且播放列表内视频都找到即提前结束）
    if (isVideoPage || isSpacePage) {
      setTimeout(() => maybeAutoSyncHistory(), 3000);
    }
  }

  // 页面加载时把所有分组重置为收起（默认收起）
  async function resetGroupsCollapsed() {
    try {
      const groups = await BiliStorage.getGroups();
      if (!groups.length) return;
      let changed = false;
      for (const g of groups) {
        if (g.collapsed !== true) { g.collapsed = true; changed = true; }
      }
      if (changed) await BiliStorage.saveGroups(groups);
    } catch (e) { /* 忽略 */ }
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
          <select class="mode-select" id="modeSelect" title="播放器窗口模式">
            <option value="default">默认</option>
            <option value="web-fullscreen">网页全屏</option>
            <option value="fullscreen">全屏</option>
          </select>
          <button class="sort-toggle" id="sortToggle" title="排序模式（多选/拖动/自动排序）">⇅</button>
          <button class="refresh-all" id="refreshAll" title="刷新列表 + 同步观看历史（官方断点，本地保存）">↻</button>
          <button class="close" id="close" title="关闭">✕</button>
        </header>
        <div class="sort-bar" id="sortBar" style="display:none">
          <span class="sel-count">已选 <b class="sel-count-n" id="sortCountN">0</b> 个</span>
          <button id="sortSelectAll">全选</button>
          <button id="sortUndo">撤销</button>
          <select id="sortDir" title="自动排序方向">
            <option value="asc">升序↑</option>
            <option value="desc">倒序↓</option>
          </select>
          <button class="primary" id="sortDo">自动排序</button>
          <button class="primary" id="groupDo">成组</button>
          <button id="ungroupDo">取消分组</button>
          <button id="sortDone">完成</button>
        </div>
        <ul class="list" id="list"></ul>
      </aside>
    `;
    document.documentElement.appendChild(host);
    fab = root.querySelector('#fab');
    clusterBtns.push(fab);
    panel = root.querySelector('#panel');
    listEl = root.querySelector('#list');
    countEl = root.querySelector('#count');
    root.querySelector('#refreshAll').addEventListener('click', () => {
      renderList();
      // 历史同步已合并到刷新按钮（小量翻页，≤5 页）
      syncHistory({ pages: 5, silent: false });
    });
    root.querySelector('#close').addEventListener('click', () => togglePanel(false));
    initSortModeControls();
    // 页面级样式（空间页卡片勾选框用）
    if (!document.getElementById('biliplaylist-page-css')) {
      const style = document.createElement('style');
      style.id = 'biliplaylist-page-css';
      style.textContent = PAGE_CSS;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  // ---------- 热区按钮簇 ----------
  function showCluster(show) {
    for (const b of clusterBtns) {
      if (b) b.classList.toggle('show', show);
    }
  }

  function initFab() {
    fab.addEventListener('click', () => togglePanel());
    document.addEventListener('mousemove', onMouseMove);
    // 点击侧边栏外部任意位置 → 关闭侧边栏（点击扩展 UI 内部不关闭）
    document.addEventListener('click', (e) => {
      if (!open) return;
      const path = (e.composedPath && e.composedPath()) || [];
      if (path.indexOf(host) !== -1) return;
      togglePanel(false);
    });
  }

  function onMouseMove(e) {
    const near = (window.innerWidth - e.clientX) < HOTZONE &&
                 (window.innerHeight - e.clientY) < HOTZONE;
    clearTimeout(hideTimer);
    if (near) {
      showCluster(true);
    } else {
      hideTimer = setTimeout(() => {
        if (!open) showCluster(false);
      }, FAB_HIDE_DELAY);
    }
  }

  function togglePanel(force) {
    open = force !== undefined ? force : !open;
    panel.classList.toggle('open', open);
    if (open) {
      showCluster(true);
      renderList();
    }
  }

  // ---------- 窗口模式（下拉框） ----------
  async function initModes() {
    modeState = await BiliStorage.getPlayerMode();
    refreshModeButtons();
    const sel = root.querySelector('#modeSelect');
    if (sel) {
      sel.addEventListener('change', async () => {
        modeState = sel.value;
        await BiliStorage.setPlayerMode(modeState);
        refreshModeButtons();
      });
    }
  }

  function refreshModeButtons() {
    const sel = root.querySelector('#modeSelect');
    if (sel && sel.value !== modeState) sel.value = modeState;
  }

  // ---------- 列表渲染 ----------
  async function renderList() {
    if (!root) return;
    const items = await BiliStorage.getList();
    currentItems = items;
    const progress = await BiliStorage.getProgress();
    const groups = await BiliStorage.getGroups();
    const gmap = new Map(groups.map((g) => [g.id, g]));
    renamedInput = null;
    // 清理排序选中集合中已不在列表里的 bvid（如删除后），保持计数准确
    const present = new Set(items.map((it) => it.bvid));
    for (const b of biliSel) if (!present.has(b)) biliSel.delete(b);
    countEl.textContent = items.length ? items.length + ' 个' : '';
    if (!items.length) {
      listEl.innerHTML = '<div class="empty">播放列表为空<br>视频页右下角点「＋ 加入列表」，<br>或在 UP 主空间右下角点「多选」批量加入</div>';
      updateSortCount();
      return;
    }
    listEl.innerHTML = '';
    const n = items.length;
    let i = 0;
    while (i < n) {
      const it = items[i];
      const gid = it.groupId || null;
      if (gid && gmap.get(gid)) {
        const grp = gmap.get(gid);
        const members = [];
        let j = i;
        while (j < n && (items[j].groupId || null) === gid) { members.push(items[j]); j++; }
        const selCountInGrp = sortMode ? members.filter((m) => biliSel.has(m.bvid)).length : 0;
        const someSel = selCountInGrp > 0;
        const allSel = selCountInGrp === members.length && members.length > 0;
        const collapsed = grp.collapsed !== false; // 缺省视为收起
        listEl.appendChild(buildFolderHead(grp, members[0], members.length, progress, allSel, someSel, collapsed));
        if (!collapsed) {
          for (let k = 0; k < members.length; k++) {
            listEl.appendChild(buildItem(items[i + k], i + k, progress, true));
          }
        }
        i = j;
        continue;
      }
      listEl.appendChild(buildItem(it, i, progress, false));
      i++;
    }
    updateSortCount();
  }

  // 渲染单个视频条目（grouped = 是否组内成员，带缩进）
  function buildItem(it, idx, progress, grouped) {
    const p = progress[it.bvid] || {};
    const pages = it.pages || '?';
    const part = p.part || 1;
    const time = p.time || 0;
    const done = !!p.done;
    const current = isVideoPage && it.bvid === currentBvid;
    const selected = sortMode && biliSel.has(it.bvid);
    const li = document.createElement('li');
    li.className = 'item' + (current ? ' current' : '') + (selected ? ' selected' : '') + (grouped ? ' grouped' : '');
    li.draggable = sortMode || !grouped;
    li.dataset.bvid = it.bvid;
    li.dataset.gid = it.groupId || '';
    li.innerHTML =
      '<span class="sel-check"></span>' +
      '<div class="item-main">' +
        '<div class="title">' + escapeHtml(it.title || it.bvid) + '</div>' +
        (it.author ? '<div class="author">' + escapeHtml(it.author) + '</div>' : '') +
        '<div class="meta">' + part + '/' + pages + ' · ' + fmtTime(time) +
          (done ? ' · <span class="done">✓ 已看完</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="play" title="播放">▶</button>' +
        '<button class="del" title="删除">✕</button>' +
      '</div>';
    li.querySelector('.play').addEventListener('click', (e) => {
      e.stopPropagation();
      jumpToVideo(it.bvid);
    });
    li.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeItem(it.bvid);
    });
    // 排序模式：单击条目切换选中（播放/删除按钮已 stopPropagation，不受影响）
    li.addEventListener('click', (e) => {
      if (!sortMode) return;
      if (e.target.closest('.play, .del')) return;
      handleItemSelect(it.bvid, idx, e);
    });
    // 拖拽：排序模式下为「移动/分组」；普通模式为「单条移动」
    li.addEventListener('dragstart', (e) => {
      if (sortMode) {
        // 拖动未选中项 → 视为仅选中它再移动
        if (!biliSel.has(it.bvid)) {
          biliSel.clear();
          biliSel.add(it.bvid);
          anchorIndex = idx;
          applySelectionUI();
          updateSortCount();
        }
      }
      dragBvid = it.bvid;
      dragIndex = idx;
      isDragging = true;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', it.bvid);
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('drag-over');
      showDropLineFor(e, li);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      hideDropLine();
      if (sortMode) {
        await dropSelection(e, li);
      } else {
        // 普通模式：只重排未分组项（不改隶属组），放置到顶层边界
        await moveSelection(null, li.dataset.bvid, dropAfter, new Set([dragBvid]));
      }
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      isDragging = false;
      dragFolderId = null;
      hideDropLine();
      clearDropFolderHighlights();
      renderList();
    });
    return li;
  }

  // 渲染文件夹标签（组头）：勾选指示 + 名字 + 成员数 + 收起/展开 + 收起时首条摘要
  function buildFolderHead(grp, firstItem, count, progress, allSel, someSel, collapsed) {
    const li = document.createElement('li');
    const cls = 'folder-head' + (collapsed ? ' collapsed' : '') +
      (allSel ? ' selected' : (someSel ? ' partial' : ''));
    li.className = cls;
    li.dataset.gid = grp.id;
    const p = progress[firstItem.bvid] || {};
    const pages = firstItem.pages || '?';
    const part = p.part || 1;
    const time = p.time || 0;
    const done = !!p.done;
    const summary = '<span class="fs-t">' + escapeHtml(firstItem.title || firstItem.bvid) + '</span>' +
      '<span>' + part + '/' + pages + '</span>' +
      '<span>· ' + fmtTime(time) + (done ? ' ✓已看完' : '') + '</span>';
    li.innerHTML =
      '<div class="folder-row">' +
        '<span class="folder-check"></span>' +
        '<span class="chev">▶</span>' +
        '<span class="folder-name">' + escapeHtml(grp.name) + '</span>' +
        '<span class="folder-count">' + count + ' 个</span>' +
        '<span class="folder-tools">' +
          '<button class="fc-play" title="播放组内第一个视频">▶</button>' +
          '<button class="fc-rename" title="重命名">✎</button>' +
        '</span>' +
      '</div>' +
      (collapsed ? '<div class="folder-summary">' + summary + '</div>' : '');

    const nameEl = li.querySelector('.folder-name');
    const renameBtn = li.querySelector('.fc-rename');
    const playBtn = li.querySelector('.fc-play');
    // 播放：打开组内第一个视频（新标签页、从断点续播，与点击该视频完全一致）
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      jumpToVideo(firstItem.bvid);
    });
    renameBtn.addEventListener('click', (e) => { e.stopPropagation(); startRenameFolder(grp.id, nameEl); });
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.fc-rename') || e.target.closest('.fc-play')) return;
      if (e.target.closest('.chev')) { toggleFolder(grp.id); return; }
      if (sortMode) { toggleGroupSelection(grp.id); return; }
      toggleFolder(grp.id);
    });
    // 拖拽整组（仅排序模式可拖动改变位置）
    li.draggable = !!sortMode;
    li.addEventListener('dragstart', (e) => {
      if (!sortMode) { e.preventDefault(); return; }
      dragFolderId = grp.id;
      isDragging = true;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'folder:' + grp.id);
    });
    li.addEventListener('dragover', (e) => {
      if (!sortMode) return;
      if (dragFolderId) return; // 组不能放到组头里
      e.preventDefault();
      dropOnFolder = grp.id;
      li.classList.add('drag-over-folder');
      hideDropLine();
    });
    li.addEventListener('dragleave', () => {
      li.classList.remove('drag-over-folder');
      if (dropOnFolder === grp.id) dropOnFolder = null;
    });
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      li.classList.remove('drag-over-folder');
      if (sortMode && !dragFolderId) await addSelectionToGroup(grp.id);
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      isDragging = false;
      dragFolderId = null;
      hideDropLine();
      renderList();
    });
    return li;
  }

  // opts.sort = true（多选批量加入）：全列表按发布时间升序重排（日期早的在前、先播放）
  // opts.sort = false（视频页单个加入）：新增项直接追加到列表末尾，不参与排序
  // 查重：按 bvid 去重，重复的视频不添加（返回 added/dup 供提示）
  async function addItems(newItems, opts) {
    if (!newItems || !newItems.length) return { added: 0, dup: 0 };
    const list = await BiliStorage.getList();
    const byBvid = new Map(list.map((it) => [it.bvid, it]));
    let added = 0;
    let dup = 0;
    for (const it of newItems) {
      if (it.bvid && !byBvid.has(it.bvid)) {
        byBvid.set(it.bvid, Object.assign({ addedAt: Date.now() }, it));
        added++;
      } else if (it.bvid) {
        dup++;
      }
    }
    let merged = Array.from(byBvid.values());
    if (opts && opts.sort && added > 0) {
      // 多选批量加入：仅对「未分组」段按发布时间升序重排（保序分组连续）
      merged = sortUngroupedRunsAsc(merged);
    }
    // sort=false 或全部重复时，merged 保持"原列表顺序 + 新项按加入顺序追加"（Map 插入序），即追加到末尾
    await BiliStorage.saveList(merged);
    renderList();
    return { added, dup };
  }

  async function removeItem(bvid) {
    const list = await BiliStorage.getList();
    const filtered = list.filter((it) => it.bvid !== bvid);
    await cleanEmptyGroups(filtered);
    await BiliStorage.saveList(filtered);
    renderList();
  }

  async function jumpToVideo(bvid) {
    // 从断点分P开始：读本地保存的 part（默认第 1P）；已看完(done)则重播第 1P；B 站播放器在该分P内恢复「上次看到」
    let part = 1;
    try {
      const progress = await BiliStorage.getProgress();
      const p = progress[bvid];
      if (p && !p.done && p.part > 0) part = p.part;
    } catch (e) { /* 忽略 */ }
    const url = 'https://www.bilibili.com/video/' + bvid +
      '?p=' + part + '&fromPlaylist=1&playerMode=' + modeState;
    // 侧边栏手动播放：新标签页打开，不替换当前页
    chrome.runtime.sendMessage({ type: 'open-tab', url }).catch(() => {
      try { window.open(url, '_blank'); } catch (e) { /* 忽略 */ }
    });
  }

  // ---------- 视频页「加入播放列表」按钮（热区按钮簇成员） ----------
  function initAddButton() {
    const btn = document.createElement('button');
    btn.className = 'side-btn add-btn';
    btn.textContent = '＋ 加入列表';
    btn.title = '把当前视频加入播放列表';
    btn.addEventListener('click', onAddCurrentVideo);
    root.appendChild(btn);
    clusterBtns.push(btn);
  }

  async function onAddCurrentVideo() {
    if (!currentBvid) {
      console.warn('[BiliPlaylist] 未找到当前视频 bvid');
      return;
    }
    let item = { bvid: currentBvid, title: '', author: '', pubdate: 0, pages: null };
    try {
      const v = await BiliApi.fetchView(currentBvid);
      item.title = v.data.title;
      item.pubdate = v.data.pubdate || 0;
      item.pages = (v.data.pages || []).length || null;
      item.author = v.data.owner ? v.data.owner.name : '';
    } catch (e) {
      console.warn('[BiliPlaylist] 获取视频信息失败，退回页面标题', e);
      item.title = document.title.replace(/_[^_]*$/, '').trim();
    }
    const { added, dup } = await addItems([item], { sort: false });
    if (added > 0) {
      flashAddButton();
    } else if (dup > 0) {
      showToast('该视频已在播放列表中，未重复添加');
    }
  }

  function flashAddButton() {
    const btn = root.querySelector('.add-btn');
    if (!btn) return;
    btn.textContent = '已加入 ✓';
    btn.classList.add('flash');
    setTimeout(() => {
      btn.textContent = '＋ 加入列表';
      btn.classList.remove('flash');
    }, 1200);
  }

  // ---------- 空间页多选（默认关闭，热区「多选」按钮开启） ----------
  function initSelButton() {
    const btn = document.createElement('button');
    btn.className = 'side-btn sel-btn';
    btn.textContent = '多选';
    btn.title = '开启/关闭多选模式';
    btn.addEventListener('click', toggleMultiSelect);
    root.appendChild(btn);
    clusterBtns.push(btn);
    sel.button = btn;
  }

  // ---------- 页面按钮随 URL 更新（空间页 SPA 内切换/搜索后无需刷新） ----------
  function updateSideButtons() {
    const keepMode = sel.mode && isSpacePage;
    removeButton('.add-btn');
    removeButton('.sel-btn');
    if (isVideoPage) initAddButton();
    if (isSpacePage) {
      initSelButton();
      if (keepMode) {
        if (sel.button) sel.button.classList.add('on');
        ensureSelBar();
        if (sel.bar) sel.bar.style.display = '';
        attachToCards();
        if (!sel.observer) {
          sel.observer = new MutationObserver(() => attachToCards());
          sel.observer.observe(document.body, { childList: true, subtree: true });
        }
      }
    } else if (sel.mode) {
      // 离开空间页：关闭多选
      sel.mode = false;
      detachCheckboxes();
      if (sel.observer) { sel.observer.disconnect(); sel.observer = null; }
    }
  }

  function removeButton(cls) {
    const el = root && root.querySelector(cls);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    const name = cls.slice(1);
    const idx = clusterBtns.findIndex((b) => b && b.classList && b.classList.contains(name));
    if (idx >= 0) clusterBtns.splice(idx, 1);
  }

  // 轻量 URL 轮询：B 站空间页是 SPA（pushState），URL 变化后更新页面类型与热区按钮
  function initSpaWatcher() {
    let lastHref = location.href;
    setInterval(() => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      const u = new URL(location.href);
      isVideoPage = u.hostname === 'www.bilibili.com' && /^\/video\//.test(u.pathname);
      isSpacePage = u.hostname === 'space.bilibili.com' &&
        (/\/video$/.test(u.pathname) || /\/search$/.test(u.pathname));
      const m = u.pathname.match(/^\/video\/(BV\w+)/);
      currentBvid = m ? m[1] : null;
      updateSideButtons();
      renderList();
    }, 800);
  }

  // ---------- 轻量提示（底部居中，自动消失） ----------
  function showToast(message) {
    if (!root) return;
    let t = root.querySelector('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      root.appendChild(t);
    }
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- 官方观看历史同步（自动 + 刷新按钮触发；只保存播放列表内视频，本地永久保留） ----------
  // 说明：断点来源 = ① 打开视频时 B 站播放器自身恢复"上次看到"（插件不干预）② 页面加载 5s 后捕获播放器实际位置
  //       ③ 关闭页面时保存一次 ④ 自动同步/刷新按钮做小量历史翻页补充（≤5 页，播放列表内视频都找到即提前结束）
  let historySyncing = false;
  let lastAutoSync = 0;

  // 自动同步（节流：1 分钟一次，静默）
  function maybeAutoSyncHistory() {
    const now = Date.now();
    if (now - lastAutoSync < 60000) return;
    lastAutoSync = now;
    syncHistory({ pages: 5, silent: true });
  }
  async function syncHistory(opts) {
    opts = opts || {};
    if (historySyncing) return;
    historySyncing = true;
    const btn = root && root.querySelector('#syncHistory');
    if (btn) btn.classList.add('busy');
    try {
      const list = await BiliStorage.getList();
      const bvids = new Set(list.map((it) => it.bvid));
      if (!bvids.size) {
        if (!opts.silent) showToast('播放列表为空，无需同步');
        return;
      }
      const found = new Set();
      let fetched = 0;
      let updated = 0;
      let max = 0;
      const cap = Math.min(opts.pages || 5, 10); // 上限 10 页，避免过慢
      for (let page = 0; page < cap; page++) {
        let data;
        try {
          data = await BiliApi.fetchHistory(max || undefined);
        } catch (e) {
          if (!page && e && e.code === -101) {
            if (!opts.silent) showToast('未登录，无法同步观看历史');
          }
          break;
        }
        const entries = (data && data.data && data.data.list) || [];
        if (!entries.length) break;
        const cursorMax = data.data && data.data.cursor && data.data.cursor.max;
        if (!cursorMax) break;
        max = cursorMax;
        fetched += entries.length;
        // bvid 在 history.bvid（实测发现不在顶层）
        const mine = entries.filter((it) => {
          const bvid = (it.history && it.history.bvid) || it.bvid;
          if (!bvid || !bvids.has(bvid)) return false;
          if (!it.history || it.history.business !== 'archive') return false;
          found.add(bvid);
          return true;
        });
        if (mine.length) {
          const progress = await BiliStorage.getProgress();
          const hist = await BiliStorage.getHistory();
          const hm = new Map(hist.map((h) => [h.bvid + ':' + (h.part || 1), h]));
          let changed = false;
          for (const it of mine) {
            const bvid = (it.history && it.history.bvid) || it.bvid;
            const partIdx = it.history.page || 1;
            const time = Math.floor(it.progress || 0);
            const viewAt = it.history.view_at || 0;
            const prev = progress[bvid];
            if (!prev || (viewAt || 0) >= (prev.updatedAt || 0) || time > (prev.time || 0)) {
              progress[bvid] = { part: partIdx, time, updatedAt: viewAt || Date.now() };
              changed = true;
              updated++;
            }
            const key = bvid + ':' + partIdx;
            const old = hm.get(key);
            if (!old || (viewAt || 0) >= (old.viewAt || 0)) {
              hm.set(key, {
                bvid,
                title: it.title || '',
                author: it.author_name || '',
                part: partIdx,
                partTitle: it.history.part || '',
                time,
                duration: it.duration || 0,
                viewAt
              });
              changed = true;
            }
          }
          if (changed) {
            await BiliStorage.saveProgress(progress);
            await BiliStorage.saveHistory(Array.from(hm.values()));
          }
        }
        // 播放列表内视频都找到了 → 提前结束
        if (bvids.size > 0 && found.size >= bvids.size) break;
      }
      if (!opts.silent) {
        showToast(updated > 0
          ? '已同步 ' + fetched + ' 条历史，更新 ' + updated + ' 个断点'
          : '已同步 ' + fetched + ' 条历史（播放列表内暂无记录）');
      }
      // 应用当前视频的官方断点
      try { BiliPlayer.applySavedProgress(); } catch (e) { /* 忽略 */ }
    } catch (e) {
      console.warn('[BiliPlaylist] 同步历史失败', e);
      if (!opts.silent) showToast('同步历史失败');
    } finally {
      historySyncing = false;
      if (btn) btn.classList.remove('busy');
    }
  }

  function toggleMultiSelect() {
    sel.mode = !sel.mode;
    if (sel.button) sel.button.classList.toggle('on', sel.mode);
    if (sel.mode) {
      ensureSelBar();
      if (sel.bar) sel.bar.style.display = '';
      attachToCards();
      if (!sel.observer) {
        sel.observer = new MutationObserver(() => attachToCards());
        sel.observer.observe(document.body, { childList: true, subtree: true });
      }
    } else {
      detachCheckboxes();
      if (sel.observer) { sel.observer.disconnect(); sel.observer = null; }
    }
  }

  function ensureSelBar() {
    if (sel.bar) return;
    const bar = document.createElement('div');
    bar.className = 'sel-bar';
    bar.style.display = 'none';
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

  // 收集页面视频卡片（外层卡片优先，避免嵌套链接重复勾选）
  function getCards() {
    const seen = new Set();
    const cards = [];
    for (const a of document.querySelectorAll('a[href*="/video/BV"]')) {
      if (a.closest('#biliplaylist-root') || a.closest('[data-biliplaylist-sel]')) continue;
      const card = a.closest('.bili-video-card') || a;
      if (seen.has(card)) continue;
      seen.add(card);
      cards.push(card);
    }
    return cards;
  }

  function attachToCards() {
    if (!sel.mode) return;
    for (const card of getCards()) {
      if (card.dataset.biliplaylistSel) continue;
      card.dataset.biliplaylistSel = '1';
      card.classList.add('biliplaylist-card', 'biliplaylist-select-active');
      const ui = makeSelectUI(card);
      sel.map.set(card, ui);
    }
  }

  // 多选模式：整卡覆盖层为点击目标（点卡片切换选中，不进入播放页），
  // 小复选框仅作选中指示，绝对定位到"日期行"高度、卡片右端（与日期平行）
  function makeSelectUI(card) {
    const layer = document.createElement('div');
    layer.className = 'biliplaylist-select-layer';
    layer.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSelect(card);
    });
    card.appendChild(layer);

    const box = document.createElement('span');
    box.className = 'biliplaylist-check';
    box.textContent = '✓';
    card.appendChild(box);

    const dateEl = findDateEl(card);
    if (dateEl) {
      try {
        const cardRect = card.getBoundingClientRect();
        const dateRect = dateEl.getBoundingClientRect();
        if (cardRect.height && dateRect.height) {
          const top = dateRect.top - cardRect.top + (dateRect.height - box.offsetHeight) / 2;
          box.style.top = Math.max(0, Math.round(top)) + 'px';
        } else {
          box.style.top = '8px';
        }
      } catch (e) {
        box.style.top = '8px';
      }
    } else {
      box.style.top = '8px';
    }
    box.style.right = '8px';
    return { layer, box };
  }

  function findDateEl(card) {
    try {
      return card.querySelector('.bili-video-card__info--date, .bili-video-card__subtitle span, .bili-video-card__subtitle, .date, [class*="date"], [class*="pubdate"]');
    } catch (e) {
      return null;
    }
  }

  function detachCheckboxes() {
    for (const [card, ui] of sel.map) {
      card.classList.remove('biliplaylist-selected', 'biliplaylist-card', 'biliplaylist-select-active');
      if (ui.layer && ui.layer.parentNode) ui.layer.parentNode.removeChild(ui.layer);
      if (ui.box && ui.box.parentNode) ui.box.parentNode.removeChild(ui.box);
    }
    sel.map.clear();
    if (sel.bar) sel.bar.style.display = 'none';
    if (sel.countEl) sel.countEl.textContent = '0';
  }

  function toggleSelect(card) {
    const on = card.classList.toggle('biliplaylist-selected');
    const ui = sel.map.get(card);
    if (ui && ui.box) ui.box.classList.toggle('on', on);
    updateSelCount();
  }

  function clearSelection() {
    for (const [card, ui] of sel.map) {
      card.classList.remove('biliplaylist-selected');
      if (ui.box) ui.box.classList.remove('on');
    }
    updateSelCount();
  }

  function updateSelCount() {
    if (!sel.countEl) return;
    let n = 0;
    for (const card of sel.map.keys()) {
      if (card.classList.contains('biliplaylist-selected')) n++;
    }
    sel.countEl.textContent = String(n);
  }

  // —— 排序兜底：DOM 提取不到发布日期时，后台用 view 接口补全并重排（节流防风控） ——
  async function backfillAndResort() {
    try {
      const list = await BiliStorage.getList();
      const missing = list.filter((it) => it.bvid && !it.pubdate);
      if (!missing.length) return;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let changed = false;
      for (const it of missing) {
        try {
          const v = await BiliApi.fetchView(it.bvid);
          const pd = v.data && v.data.pubdate;
          if (pd) {
            it.pubdate = pd;
            changed = true;
          }
        } catch (e) { /* 单个失败继续 */ }
        await sleep(200);
      }
      if (!changed) return;
      // 仅对「未分组」段按日期升序原位排，分组段保持不变（避免破坏分组连续性）
      await BiliStorage.saveList(sortUngroupedRunsAsc(list));
      renderList();
      console.log('[BiliPlaylist] 已按接口发布日期补全并重排');
    } catch (e) {
      console.warn('[BiliPlaylist] 补全发布日期失败', e);
    }
  }

  function extractCard(card) {
    const href = card.href || ((card.querySelector('a[href*="/video/BV"]') || {}).href) || '';
    const m = (href || '').match(/\/video\/(BV\w+)/);
    if (!m) return null;
    const bvid = m[1];
    let title = '';
    const t = card.querySelector('.bili-video-card__info--tit, .title, [title]');
    if (t) {
      title = (t.getAttribute('title') || t.textContent || '').trim();
    }
    if (!title) title = (card.getAttribute('title') || '').trim();
    let dateText = '';
    const d = card.querySelector('.bili-video-card__info--date, .bili-video-card__subtitle span, .bili-video-card__subtitle, .date, [class*="date"], [class*="pubdate"]');
    if (d) dateText = d.textContent.trim();
    return { bvid, title, pubdate: parsePubdate(dateText), pages: null };
  }

  // UP 主名：优先读空间页头部，兜底 document.title（"xxx的个人空间"）
  function getSpaceAuthor() {
    const sels = ['.h-name', '[class*="nickname"]', '[class*="user-name"]', '#h-name', '.name'];
    for (const s of sels) {
      try {
        const el = document.querySelector(s);
        const t = el && el.textContent.trim();
        if (t) return t;
      } catch (e) { /* 忽略 */ }
    }
    const m = document.title.match(/^(.+?)的个人空间/);
    if (m) return m[1].trim();
    return '';
  }

  async function addSelected() {
    const author = getSpaceAuthor();
    const items = [];
    for (const [card] of sel.map) {
      if (!card.classList.contains('biliplaylist-selected')) continue;
      const c = extractCard(card);
      if (c) {
        c.author = author;
        items.push(c);
      }
    }
    const { added, dup } = await addItems(items, { sort: true });
    clearSelection();
    const msg = dup > 0
      ? '已添加 ' + added + ' 个视频，' + dup + ' 个重复已跳过'
      : '已添加 ' + added + ' 个视频';
    showToast(msg);
    console.log('[BiliPlaylist] ' + msg);
    // 后台补全缺失发布日期并重排（DOM 日期提取失败时保证按真实发布日期排序）
    if (added > 0) {
      backfillAndResort();
    }
  }

  // ================= 侧边栏「排序模式」 =================
  // 排序工具栏控件（全选/撤销/方向/自动排序/完成）+ 头部「排序」按钮
  function initSortModeControls() {
    const toggle = root.querySelector('#sortToggle');
    if (toggle) toggle.addEventListener('click', toggleSortMode);
    const selectAll = root.querySelector('#sortSelectAll');
    if (selectAll) selectAll.addEventListener('click', sortSelectAll);
    const undoBtn = root.querySelector('#sortUndo');
    if (undoBtn) undoBtn.addEventListener('click', () => undo());
    const dir = root.querySelector('#sortDir');
    if (dir) dir.addEventListener('change', () => { sortDirection = dir.value; });
    const doBtn = root.querySelector('#sortDo');
    if (doBtn) doBtn.addEventListener('click', () => {
      const d = root.querySelector('#sortDir');
      if (d) sortDirection = d.value;
      autoSortSelected();
    });
    const done = root.querySelector('#sortDone');
    if (done) done.addEventListener('click', toggleSortMode);
    const groupBtn = root.querySelector('#groupDo');
    if (groupBtn) groupBtn.addEventListener('click', () => groupSelected());
    const ungroupBtn = root.querySelector('#ungroupDo');
    if (ungroupBtn) ungroupBtn.addEventListener('click', () => ungroupSelected());
  }

  async function toggleSortMode() {
    sortMode = !sortMode;
    const bar = root.querySelector('#sortBar');
    const t = root.querySelector('#sortToggle');
    if (sortMode) {
      biliSel.clear();
      anchorIndex = -1;
      if (bar) bar.style.display = '';
      if (t) t.classList.add('on');
      panel.classList.add('sorting');
    } else {
      biliSel.clear();
      anchorIndex = -1;
      hideDropLine();
      if (bar) bar.style.display = 'none';
      if (t) t.classList.remove('on');
      panel.classList.remove('sorting');
    }
    renderList();
  }

  // 当前列表的 bvid 顺序（与 storage 一致，含折叠组里隐藏的成员）
  function currentBvids() {
    return currentItems.map((it) => it.bvid);
  }

  function applySelectionUI() {
    for (const li of listEl.querySelectorAll('.item')) {
      li.classList.toggle('selected', biliSel.has(li.dataset.bvid));
    }
    syncFolderHeadSel();
  }

  // 选择变更时同步更新各组头的勾选态（全部选中 ✓ 高亮 / 部分选中 · 圆点 / 未选中）
  function syncFolderHeadSel() {
    for (const head of listEl.querySelectorAll('.folder-head')) {
      const gid = head.dataset.gid;
      let cnt = 0;
      let total = 0;
      if (sortMode && gid) {
        for (const it of currentItems) {
          if ((it.groupId || null) === gid) {
            total++;
            if (biliSel.has(it.bvid)) cnt++;
          }
        }
      }
      const all = total > 0 && cnt === total;
      const some = cnt > 0;
      head.classList.toggle('selected', all);
      head.classList.toggle('partial', some && !all);
    }
  }

  function updateSortCount() {
    const n = root && root.querySelector('#sortCountN');
    if (n) n.textContent = String(biliSel.size);
  }

  // 选中逻辑：单击=仅选中 & 设为锚点；Shift=范围（含两端）；Ctrl/⌘=单独增删
  function handleItemSelect(bvid, idx, e) {
    const bvids = currentBvids();
    const currentIdx = bvids.indexOf(bvid);
    if (currentIdx < 0) return;
    if (e.shiftKey && anchorIndex >= 0) {
      const start = Math.min(anchorIndex, currentIdx);
      const end = Math.max(anchorIndex, currentIdx);
      biliSel.clear();
      for (let i = start; i <= end; i++) biliSel.add(bvids[i]);
    } else if (e.ctrlKey || e.metaKey) {
      if (biliSel.has(bvid)) biliSel.delete(bvid);
      else biliSel.add(bvid);
      anchorIndex = currentIdx;
    } else {
      biliSel.clear();
      biliSel.add(bvid);
      anchorIndex = currentIdx;
    }
    applySelectionUI();
    updateSortCount();
  }

  function sortSelectAll() {
    const bvids = currentBvids();
    bvids.forEach((b) => biliSel.add(b));
    anchorIndex = bvids.length ? 0 : -1;
    applySelectionUI();
    updateSortCount();
  }

  // —— 拖拽：落点指示线（基于列表序，含折叠组成员） ——
  function showDropLineFor(e, li) {
    const rect = li.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    dropAfter = !before;
    const bvid = li.dataset.bvid;
    const idx = currentItems.findIndex((x) => x.bvid === bvid);
    dropAtIdx = idx < 0 ? currentItems.length : idx;
    dropOnFolder = null;
    const ref = before ? li : li.nextSibling;
    ensureDropLine(ref);
  }

  function ensureDropLine(ref) {
    if (!dropLine) {
      dropLine = document.createElement('li');
      dropLine.className = 'drop-line';
    }
    if (dropLine.parentNode !== listEl || dropLine.nextSibling !== ref) {
      listEl.insertBefore(dropLine, ref);
    }
  }

  function hideDropLine() {
    if (dropLine && dropLine.parentNode) dropLine.parentNode.removeChild(dropLine);
  }

  function clearDropFolderHighlights() {
    for (const el of listEl.querySelectorAll('.drag-over-folder')) el.classList.remove('drag-over-folder');
  }

  // —— 落点判定：拖文件夹 / 拖进组 / 拖到条目（组内或顶层） ——
  async function dropSelection(e, li) {
    hideDropLine();
    clearDropFolderHighlights();
    if (dragFolderId) {
      await moveGroupTo(dragFolderId, li.dataset.bvid, dropAfter);
      return;
    }
    if (dropOnFolder) {
      await addSelectionToGroup(dropOnFolder);
      return;
    }
    const zone = li.dataset.gid ? li.dataset.gid : null;
    await moveSelection(zone, li.dataset.bvid, dropAfter);
  }

  // —— 移动选中项到目标：zone = 目标组(null=顶层)，insert 位于 hoveredBvid 前/后 ——
  // 解析插入点下标，保证不破坏分组连续性：
  //  - targetZone 为组 id → 插入到该组连续段内/边界；为 null → 顶层放置，且绝不落入任何组内部
  function resolveInsertion(remaining, targetZone, hoveredBvid, after) {
    let base = remaining.findIndex((x) => x.bvid === hoveredBvid);
    if (base < 0) base = remaining.length;
    let insert = after ? base + 1 : base;
    insert = Math.max(0, Math.min(insert, remaining.length));
    const gidAt = (k) => (k >= 0 && k < remaining.length) ? (remaining[k].groupId || null) : null;
    const H = targetZone || gidAt(insert);
    if (!H) return insert;
    let start = insert;
    while (start > 0 && gidAt(start - 1) === H) start--;
    let end = insert;
    while (end < remaining.length && gidAt(end) === H) end++;
    if (targetZone) {
      const g = gidAt(insert);
      if (g === H) return insert;
      if (insert >= end) return end;
      if (insert <= start) return start;
      return insert;
    }
    // 顶层放置：不能落在组内部，贴到靠近 hovered 的组边界
    return after ? end : start;
  }

  async function moveSelection(zone, hoveredBvid, after, moveSet) {
    await pushUndo();
    const list = await BiliStorage.getList();
    const selSet = moveSet || new Set(biliSel);
    const selItems = list.filter((it) => selSet.has(it.bvid));
    if (!selItems.length) return;
    const remaining = list.filter((it) => !selSet.has(it.bvid));
    selItems.forEach((it) => { it.groupId = zone || undefined; });
    const insertAt = resolveInsertion(remaining, zone, hoveredBvid, after);
    remaining.splice(insertAt, 0, ...selItems);
    await cleanEmptyGroups(remaining);
    await BiliStorage.saveList(remaining);
    renderList();
  }

  // —— 拖动整个文件夹（整组）到目标位置，保持组连续 ——
  async function moveGroupTo(gid, hoveredBvid, after) {
    await pushUndo();
    const list = await BiliStorage.getList();
    const members = list.filter((it) => (it.groupId || null) === gid);
    if (!members.length) return;
    const memberSet = new Set(members.map((it) => it.bvid));
    const remaining = list.filter((it) => !memberSet.has(it.bvid));
    // 整组作为一个块放置到顶层边界（不落入其它组内部）
    const insertion = resolveInsertion(remaining, null, hoveredBvid, after);
    remaining.splice(insertion, 0, ...members);
    await BiliStorage.saveList(remaining);
    renderList();
  }

  // —— 把选中项加入某组（追加到该组末尾，保持组连续） ——
  async function addSelectionToGroup(gid) {
    if (!biliSel.size) return;
    await pushUndo();
    const list = await BiliStorage.getList();
    const selSet = new Set(biliSel);
    const moved = [];
    const remaining = [];
    for (const it of list) {
      if (selSet.has(it.bvid)) { it.groupId = gid; moved.push(it); }
      else remaining.push(it);
    }
    if (!moved.length) return;
    let lastG = -1;
    for (let k = 0; k < remaining.length; k++) if ((remaining[k].groupId || null) === gid) lastG = k;
    const insertAt = lastG < 0 ? remaining.length : lastG + 1;
    remaining.splice(insertAt, 0, ...moved);
    await cleanEmptyGroups(remaining);
    await BiliStorage.saveList(remaining);
    renderList();
  }

  // —— 删除空组（没有任何成员的组） ——
  async function cleanEmptyGroups(list) {
    const used = new Set();
    for (const it of list) if (it.groupId) used.add(it.groupId);
    const groups = await BiliStorage.getGroups();
    const valid = groups.filter((g) => used.has(g.id));
    if (valid.length !== groups.length) await BiliStorage.saveGroups(valid);
  }

  // —— 成组：把选中视频归为新文件夹（允许重新成组；原组抽空则删） ——
  async function groupSelected() {
    const selCount = currentItems.filter((it) => biliSel.has(it.bvid)).length;
    if (selCount < 2) { showToast('请至少选中 2 个视频再成组'); return; }
    await pushUndo();
    const list = await BiliStorage.getList();
    const groups = await BiliStorage.getGroups();
    const selSet = new Set(biliSel);
    const gid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const name = '分组' + (groups.length + 1);
    groups.push({ id: gid, name, collapsed: true });
    const selItems = list.filter((it) => selSet.has(it.bvid));
    const firstSelIdx = list.findIndex((it) => selSet.has(it.bvid));
    selItems.forEach((it) => { it.groupId = gid; });
    const remaining = list.filter((it) => !selSet.has(it.bvid));
    // 收拢到「最早选中项」原本的位置
    let firstRemainingIdx = 0;
    for (let i = 0; i < firstSelIdx; i++) if (!selSet.has(list[i].bvid)) firstRemainingIdx++;
    const insertAt = Math.max(0, Math.min(firstRemainingIdx, remaining.length));
    remaining.splice(insertAt, 0, ...selItems);
    await BiliStorage.saveGroups(groups);
    await BiliStorage.saveList(remaining);
    renderList();
    showToast('已创建分组「' + name + '」，共 ' + selItems.length + ' 个视频');
  }

  // —— 取消分组：把选中成员从所属组拆出 ——
  async function ungroupSelected() {
    if (!biliSel.size) { showToast('请先选中要取消分组的视频'); return; }
    await pushUndo();
    const list = await BiliStorage.getList();
    const selSet = new Set(biliSel);
    let changed = false;
    for (const it of list) {
      if (selSet.has(it.bvid) && it.groupId) { it.groupId = undefined; changed = true; }
    }
    if (!changed) { showToast('选中项中没有已分组的视频'); return; }
    await cleanEmptyGroups(list);
    await BiliStorage.saveList(list);
    renderList();
    showToast('已取消分组');
  }

  // —— 文件夹标签：收起/展开、点组头全选成员、重命名、改色 ——
  async function toggleFolder(gid) {
    const groups = await BiliStorage.getGroups();
    const g = groups.find((x) => x.id === gid);
    if (!g) return;
    g.collapsed = !g.collapsed;
    await BiliStorage.saveGroups(groups);
    renderList();
  }

  // 点击组头：若该组已全选则取消全选，否则全选该组（可来回勾选/取消）
  function toggleGroupSelection(gid) {
    const members = currentItems.filter((it) => (it.groupId || null) === gid);
    const allSelected = members.length > 0 && members.every((m) => biliSel.has(m.bvid));
    for (const m of members) {
      if (allSelected) biliSel.delete(m.bvid);
      else biliSel.add(m.bvid);
    }
    anchorIndex = -1;
    applySelectionUI();
    updateSortCount();
  }

  function startRenameFolder(gid, nameEl) {
    if (renamedInput && renamedInput.parentNode) { renderList(); return; }
    const input = document.createElement('input');
    input.className = 'folder-rename-input';
    input.value = nameEl.textContent;
    const commit = async () => {
      const v = input.value.trim();
      if (v) {
        const groups = await BiliStorage.getGroups();
        const g = groups.find((x) => x.id === gid);
        if (g) { g.name = v; await BiliStorage.saveGroups(groups); }
      }
      renamedInput = null;
      renderList();
    };
    input.addEventListener('click', (e) => e.stopPropagation());
    // 阻止按键冒泡出阴影树，避免影响 B 站播放器快捷键（如 m 静音）
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { renamedInput = null; renderList(); }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('keypress', (e) => e.stopPropagation());
    input.addEventListener('blur', commit);
    nameEl.replaceWith(input);
    renamedInput = input;
    input.focus();
    input.select();
  }

  // —— 自动排序：组内排、组间不排（选中项按所属组分桶，各自组内按日期原位重排） ——
  async function autoSortSelected() {
    if (!biliSel.size) { showToast('请先选中要排序的视频'); return; }
    const list = await BiliStorage.getList();
    const selBvids = new Set(biliSel);
    const byG = new Map();
    list.forEach((it, i) => {
      if (selBvids.has(it.bvid)) {
        const gid = it.groupId || null;
        if (!byG.has(gid)) byG.set(gid, []);
        byG.get(gid).push(i);
      }
    });
    if (!byG.size) return;
    const allSelIdx = [];
    for (const [, idxs] of byG) allSelIdx.push(...idxs);
    // 先补全选中项缺失的发布日期（只针对选中项，200ms 节流，失败继续）
    await backfillDatesFor(allSelIdx, list);
    await pushUndo();
    let total = 0;
    for (const [, idxs] of byG) {
      const selItems = idxs.map((i) => list[i]);
      const sorted = selItems.slice().sort((a, b) => {
        const pa = a.pubdate || Number.MAX_SAFE_INTEGER;
        const pb = b.pubdate || Number.MAX_SAFE_INTEGER;
        return sortDirection === 'asc' ? pa - pb : pb - pa;
      });
      idxs.forEach((slot, k) => { list[slot] = sorted[k]; });
      total += sorted.length;
    }
    await BiliStorage.saveList(list);
    renderList();
    showToast('已按发布日期' + (sortDirection === 'asc' ? '升序' : '倒序') + '排序 ' + total + ' 个视频（组内排、组间不排）');
  }

  // 仅针对选中项补全缺失 pubdate（不复排整表）
  async function backfillDatesFor(selIdx, list) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const i of selIdx) {
      const it = list[i];
      if (!it || !it.bvid || it.pubdate) continue;
      try {
        const v = await BiliApi.fetchView(it.bvid);
        const pd = v.data && v.data.pubdate;
        if (pd) it.pubdate = pd;
      } catch (e) { /* 单个失败继续 */ }
      await sleep(200);
    }
  }

  // —— 撤销：快照栈（list + groups 深拷贝，≤20 个） ——
  async function pushUndo() {
    const items = await BiliStorage.getList();
    const groups = await BiliStorage.getGroups();
    undoStack.push(JSON.parse(JSON.stringify({ items, groups })));
    if (undoStack.length > 20) undoStack.shift();
  }

  async function undo() {
    const prev = undoStack.pop();
    if (!prev) { showToast('没有可撤销的操作'); return; }
    await BiliStorage.saveList(prev.items || []);
    await BiliStorage.saveGroups(prev.groups || []);
    renderList();
    showToast('已撤销');
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
    // 拖拽期间跳过整表重渲染，避免进度写入打断拖拽（拖拽结束/落点后重渲染）
    if (isDragging) return;
    modeState = await BiliStorage.getPlayerMode();
    refreshModeButtons();
    renderList();
  }

  return { initTop };
})();
