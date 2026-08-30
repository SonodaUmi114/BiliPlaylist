# B 站接口 / 页面结构调研笔记

> 规则：每次实测后更新，注明**验证日期**与结论。B 站前端频繁改版，任何选择器/接口结论过期后优先怀疑此处。
> 状态图例：✅ 已验证可用 ／ ⚠️ 初稿待实测 ／ ❌ 已失效

---

## 1. 接口

### 1.1 视频信息 `GET /x/web-interface/view`
- 参数：`bvid`
- 用途：加入列表时获取标题 / 发布时间（`pubdate`）/ 分P总数（`data.pages.length`）
- 是否强制 WBI：⚠️ 初稿按"不强制"实现（未实测）
- 状态：⚠️ 待实测

### 1.2 UP 主投稿 / 空间搜索 `GET /x/space/wbi/arc/search`
- 参数：`mid`（必须）、`keyword`（搜索时）、`pn`、`ps`
- 用途：v1.0 未使用（空间页多选直接读 DOM），预留
- 是否强制 WBI：✅ 路径带 `wbi`，强制签名（已按公开算法实现 `api.js` 的 `wbiSign`）
- 密钥获取：`GET /x/web-interface/nav` → `data.wbi_img.{img_url,sub_url}` 文件名去掉扩展名即密钥
- 状态：⚠️ 算法已实现，接口本身待实测

### 1.3 请求方式：页面 MAIN world fetch 桥（重要实现决策）
- 实现：content script → `chrome.runtime.sendMessage('api-fetch')` → background 用 `chrome.scripting.executeScript({ world:'MAIN' })` 在页面上下文执行 fetch（`credentials:'include'`）
- 原因：content script 的 fetch 受扩展隔离上下文影响，cookie/CORS 行为与站点自身请求不同；MAIN world fetch 等同站点自己发请求，自动带 cookie（登录态、buvid3）与 CORS
- 已用此方案实现 `api.js`，需实测确认带 cookie 成功

### 1.4 官方观看历史 `GET /x/web-interface/history/cursor`（断点补充，2025 启用）
- 参数：`max`（上一页返回的 `data.cursor.max`，首屏省略）、`ps`（默认 30）
- 返回 `data.list[]`：`title`、`author_name`、**`history.bvid`（实测：bvid 在 history 对象里，不在顶层！）**、`progress`（断点秒）、`duration`、`history.{page,part,cid,business,view_at}`
- 需登录（未登录返回 -101）；仅取 `history.business === 'archive'` 的视频条目
- **断点（2025 最终方案）**：**B 站播放器自身恢复"上次看到"**（官方最新，播放器显示该文案），插件**不主动 seek**（避免用旧值覆盖播放器正确恢复）；插件只**捕获保存**：① 页面加载 5s 后读取播放器实际位置（含 B 站恢复后的值）② 关闭标签页/切走时保存一次精确位置 ③ **打开视频页/空间页自动同步官方历史（节流 1 分钟一次，静默）** ④ 全局刷新按钮手动同步（≤5 页，播放列表内视频都找到即提前结束）。仅当 B 站未恢复（5s 后仍在开头）时插件本地兜底 seek。只保存播放列表内视频 → `biliplaylist:progress` + `biliplaylist:history`（本地永久备份）
- ⚠️ 待实测：`__INITIAL_STATE__.progress` 是否存在于当前页面（若不存在需换方案）；`cursor.max` 翻页语义
- 旧 video 元素轮询方案已停用（代码留存于 git 历史）

---

## 2. 页面结构（选择器）

### 2.1 空间页视频卡片
- 候选选择器：`a[href*="/video/BV"]`（通用兜底，当前实现用这个）
  - 新 UI 卡片：`.bili-video-card`（本身是 `<a>`）
  - 旧 UI 卡片：`.small-item`
- 标题：`.bili-video-card__info--tit` / `.title` / `[title]`
- 发布时间：`.bili-video-card__info--date` / `.date` / `[class*="date"]`
- 状态：⚠️ 待实测（开发时在真实空间页确认并补日期）

### 2.2 空间搜索页 `space.bilibili.com/{uid}/search?keyword=...`
- 页面结构是否与投稿页同款卡片：⚠️ 待实测

### 2.3 播放器（2025 实测：内嵌主页面，非 iframe）
- ✅ 实测：视频页 iframe 列表仅 `s1.hdslb.com/bfs/seed/jinkela/short/...` 工具 iframe（cols / leader-election），**无播放器 iframe**；`<video>` 在**顶层页面 DOM**
- 适配层在顶层 frame 直接操作 video：`document.querySelector('video')`
- 分P连播：优先点击页面分P列表（选集）下一分P（选择器候选见 `player.js clickNextPart`，待实测），兜底整页 `?p=N+1`
- 分P总数来源（优先级）：① 顶层写入的 `biliplaylist:currentVideo.pages`（打开视频时若列表项缺分P数则调 view 接口补全并缓存）② 分P列表 DOM（待实测）③ null（按已播完处理）
- 原 `player.bilibili.com` iframe 方案保留为兼容分支（manifest matches 仍含该域）
- **进度记忆（断点，2025 切换官方方案）**：断点来源为**官方观看历史接口**（§1.4），同步进 `biliplaylist:progress`；打开视频时 seek 恢复（看过 5 秒以上即恢复，留 10s 尾）；旧 video 元素轮询保存已停用（代码留存于 git 历史）
- "网页全屏"自动恢复（已实现，尽力而为）：跳转 URL 携带 `playerMode=web-fullscreen` → 顶层写 `biliplaylist:pendingWebFs` 标记 → iframe 加载后尝试点击网页全屏按钮（候选选择器见 `player.js pickWebFullscreenButton`）；未命中会打印 warn 日志，把实际 DOM 记录到本文件

### 2.4 右下角热区按钮簇（我们的 UI）
- 生效范围：`www` / `space` / `t` 三域（`t.bilibili.com` 动态页仅侧边栏按钮，待实测）
- 热区：右下角 120px；按钮位于热区中心（距边约 60px）：侧边栏按钮（☰，44px 圆形）`right:60px / bottom:60px`，页面按钮（视频页「＋ 加入列表」/ 空间页「多选」）在其左侧平行 `right:112px / bottom:60px`
- B 站右下角自带控件（回到顶部/小窗播放）位置：⚠️ 待实测是否冲突
- 多选按钮点击后出现顶部工具栏（`top:80px / right:24px`）与卡片复选框

### 2.5 空间页多选（opt-in）
- 默认关闭；热区「多选」开启后：**整卡覆盖层**（`.biliplaylist-select-layer`）为点击目标（点卡片切换选中，不进入播放页），缩略图悬停预览被抑制（`img { pointer-events: none }`）
- 小复选框绝对定位（`getBoundingClientRect` 测量日期行高度、卡片右端 8px）作选中指示，与日期平行，待实测
- 添加完成 toast 提示（已添加 N 个，M 个重复已跳过）
- 空间页 SPA 内 URL 变化（首次搜索/tab 切换）由 800ms 轮询驱动按钮更新，待实测
- 卡片收集：`a[href*="/video/BV"]` 向上找 `.bili-video-card`（避免嵌套链接重复勾选），待实测
- **发布日期提取与排序（日期选择器已实测确认）**：空间页卡片日期在 `.bili-video-card__subtitle > span`（如 `2024-06-12`），选择器已覆盖 `.bili-video-card__subtitle span` / `.bili-video-card__subtitle` 等；**兜底**：DOM 提取不到时后台调 view 接口补全 `pubdate`（200ms 节流）再按升序重排（日期早的在前、先播放）
  - ✅ 2024-06-12 实测：`.bili-video-card__subtitle span` 文本为 `2024-06-12`

---

## 3. 待验证清单（按优先级）

- [ ] `chrome.scripting` MAIN world fetch 桥在真实页面上带 cookie 成功（核心依赖）
- [ ] 官方观看历史接口：登录态、`cursor.max` 翻页、服务端保留深度（2025 新增）
- [ ] 空间页卡片选择器与数据提取（bvid/标题/发布时间）
- [x] ~~player iframe 的 video 元素与分P参数名~~ → 2025 实测：播放器内嵌主页面（§2.3）
- [ ] 分P总数选择器（`.list-box .list-item` 等）
- [ ] 网页全屏按钮选择器：已实现候选列表（`pickWebFullscreenButton`），需实测确认命中并把实际选择器记录到本文档
- [ ] `chrome.windows.update({state:'fullscreen'})` 无手势生效
- [ ] 窗口模式记忆的完整链路（URL `playerMode` → 恢复）

---

## 4. 已确认的固定事实

- 2023-03 起 B 站 web 端部分接口强制 WBI 签名（`w_rid` + `wts`）
- `requestFullscreen` 必须用户手势触发（transient user activation）——这是选型 Chrome 扩展的核心原因
- `chrome.windows.update({state:'fullscreen'})` 无需额外权限（`"fullscreen"` 权限是 Chrome App 专用，扩展声明会被忽略并打 warning：`'app.window.fullscreen' is only allowed for packaged apps`），且无需用户手势
