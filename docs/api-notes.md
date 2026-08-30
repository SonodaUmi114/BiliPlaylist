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
- 用途：v0.1 未使用（空间页多选直接读 DOM），预留
- 是否强制 WBI：✅ 路径带 `wbi`，强制签名（已按公开算法实现 `api.js` 的 `wbiSign`）
- 密钥获取：`GET /x/web-interface/nav` → `data.wbi_img.{img_url,sub_url}` 文件名去掉扩展名即密钥
- 状态：⚠️ 算法已实现，接口本身待实测

### 1.3 请求方式：页面 MAIN world fetch 桥（重要实现决策）
- 实现：content script → `chrome.runtime.sendMessage('api-fetch')` → background 用 `chrome.scripting.executeScript({ world:'MAIN' })` 在页面上下文执行 fetch（`credentials:'include'`）
- 原因：content script 的 fetch 受扩展隔离上下文影响，cookie/CORS 行为与站点自身请求不同；MAIN world fetch 等同站点自己发请求，自动带 cookie（登录态、buvid3）与 CORS
- 已用此方案实现 `api.js`，需实测确认带 cookie 成功

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

### 2.3 播放器 iframe
- URL：`player.bilibili.com/player.html?bvid=...&p=N`（参数名 `p` 还是 `page`：⚠️ 待实测，当前实现两者都读）
- video 元素：iframe 内 `document.querySelector('video')`：⚠️ 待实测
- 分P列表 DOM（`getTotalParts` 用）：`.list-box .list-item` / `.video-parts-list .list-item` 等候选：⚠️ 待实测
- 分P连播方案（已实现）：iframe 播完 → 自身刷新 `?p=N+1`（只刷新播放器 iframe，顶层页面不刷新，满足"不刷新模式"）；`p` / `page` 两个参数名都会设置以兼容
- 分P总数来源（优先级）：① 顶层写入的 `biliplaylist:currentVideo.pages`（打开视频时若列表项缺分P数则调 view 接口补全并缓存）② 播放器分P列表 DOM（待实测）③ null（按已播完处理）
- "网页全屏"自动恢复（已实现，尽力而为）：跳转 URL 携带 `playerMode=web-fullscreen` → 顶层写 `biliplaylist:pendingWebFs` 标记 → iframe 加载后尝试点击网页全屏按钮（候选选择器见 `player.js pickWebFullscreenButton`）；未命中会打印 warn 日志，把实际 DOM 记录到本文件

### 2.4 右下角热区按钮簇（我们的 UI）
- 生效范围：`www` / `space` / `t` 三域（`t.bilibili.com` 动态页仅侧边栏按钮，待实测）
- 热区：右下角 120px；按钮位于热区中心（距边约 60px）：侧边栏按钮（☰，44px 圆形）`right:60px / bottom:60px`，页面按钮（视频页「＋ 加入列表」/ 空间页「多选」）在其左侧平行 `right:112px / bottom:60px`
- B 站右下角自带控件（回到顶部/小窗播放）位置：⚠️ 待实测是否冲突
- 多选按钮点击后出现顶部工具栏（`top:80px / right:24px`）与卡片复选框

### 2.5 空间页多选（opt-in）
- 默认关闭；热区「多选」开启后：卡片复选框插在日期元素之后（日期行最右端），待实测
- UP 主名提取：`.h-name` / `[class*="nickname"]` 等头部选择器 → 兜底 `document.title` 正则（"xxx的个人空间"），待实测
- 卡片收集：`a[href*="/video/BV"]` 向上找 `.bili-video-card`（避免嵌套链接重复勾选），待实测

---

## 3. 待验证清单（按优先级）

- [ ] `chrome.scripting` MAIN world fetch 桥在真实页面上带 cookie 成功（核心依赖）
- [ ] 空间页卡片选择器与数据提取（bvid/标题/发布时间）
- [ ] player iframe 的 video 元素与分P参数名
- [ ] 分P总数选择器（`.list-box .list-item` 等）
- [ ] 网页全屏按钮选择器：已实现候选列表（`pickWebFullscreenButton`），需实测确认命中并把实际选择器记录到本文档
- [ ] `chrome.windows.update({state:'fullscreen'})` 无手势生效
- [ ] 窗口模式记忆的完整链路（URL `playerMode` → 恢复）

---

## 4. 已确认的固定事实

- 2023-03 起 B 站 web 端部分接口强制 WBI 签名（`w_rid` + `wts`）
- `requestFullscreen` 必须用户手势触发（transient user activation）——这是选型 Chrome 扩展的核心原因
- `chrome.windows.update({state:'fullscreen'})` 无需额外权限（`"fullscreen"` 权限是 Chrome App 专用，扩展声明会被忽略并打 warning：`'app.window.fullscreen' is only allowed for packaged apps`），且无需用户手势
