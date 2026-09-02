# AGENTS.md — BiliPlaylist

> 本文件是给 AI 编码代理与人类开发者共用的项目说明与开发约定。
> **开发任何功能前，请先通读本文件**；结论性约定如需变更，先更新本文件再改代码。
> **当前版本：v1.2.4**（v1.2 分组/文件夹；v1.2.1 组头播放按钮；v1.2.2 分P断点续播；v1.2.3 分P结束误判；v1.2.4 断点/连播系统改造：连续保存、URL分P跟踪、官方历史同步修复、播完不被 B 站接管、显示最小化更新；版本变更须同步更新 manifest.json 与本文档）。

---

## 1. 项目是什么

BiliPlaylist：一个运行在哔哩哔哩（B 站）网页端的**播放列表增强工具**，以 **Chrome 扩展（Manifest V3）** 形式实现。

> 技术选型沿革：最初计划用油猴脚本（Tampermonkey，开发迭代快），但需求 8"切到列表下一个视频后**自动**恢复 网页全屏/全屏"受浏览器用户手势限制，油猴无法实现，故**直接采用 Chrome 扩展开发**，不做"先油猴再迁移"（详见 §2 ADR-001）。

**v1.0 目标功能（已与用户确认）：**

- 在 **UP 主空间**页面提供**多选视频 → 批量加入播放列表**，覆盖两种页面：
  - 投稿列表页：`space.bilibili.com/{uid}/video`
  - **空间内搜索页**：`space.bilibili.com/{uid}/search?keyword=...`（用户典型用法：在空间内搜索特定词来找系列视频）
- 在 **视频播放页**（`www.bilibili.com/video/BV...`）提供：
  - "加入播放列表"按钮（把当前视频加入列表）
  - **播放列表侧边栏**（仅 B 站站内生效，交互约定见下）
- **侧边栏交互**：
  - **生效范围**：`www.bilibili.com`（视频页含「＋ 加入列表」按钮）、`space.bilibili.com`（含「多选」按钮）、`t.bilibili.com` 动态页（仅侧边栏按钮）
  - 右下角**热区按钮簇**平时隐藏，鼠标移动到右下角**热区**（120px）附近时才显示，位于热区中心（距边约 60px）；点击**侧边栏按钮**（☰）打开/收起侧边栏；**点击侧边栏外部任意位置关闭侧边栏**
  - 同一热区在侧边栏按钮**左侧平行**显示页面相关按钮：视频页为**「＋ 加入列表」**、空间页为**「多选」**（两者页面不同，不冲突）
  - 每个视频项显示：**视频名称、UP主名、分P进度（如 `1/11`，只显示总数、不显示当前分P）、当前分P播放时间 `hh:mm:ss`、播放按钮（▶，新标签页打开播放）、删除按钮**；点击条目本身不跳转；**已播放完的视频显示完成标记**
  - 侧边栏头部（单行）：**播放列表标题 + 视频数量 + 窗口模式下拉框（默认/网页全屏/全屏）+ 刷新按钮 + 关闭按钮**；刷新 = 刷新列表 + 同步观看历史（如跨页面添加视频后点刷新即可看到最新列表）
  - **多选默认关闭**：点热区「多选」按钮开启，才显示【已选 N / 加入播放列表 / 清空】工具栏；**整卡覆盖层**为点击目标（多选模式点卡片即切换选中，不进入播放页），小复选框绝对定位在**日期行高度、卡片右端**作选中指示，并抑制缩略图悬停预览；**添加完成弹提示**（如"已添加 3 个视频，2 个重复已跳过"）
  - **空间页 SPA 适配**：URL 变化（含首次搜索、tab 切换）后热区按钮自动更新，无需刷新页面（800ms 轮询监听）
- **排序规则 + 查重**：**多选批量加入按发布日期升序排列**（日期早的在前、先播放）；**视频页单个加入直接追加到列表末尾**（不参与排序）；手动拖拽排序仍可用；**按 bvid 查重**，重复视频不添加并提示
- **分P连播**：视频含多分P时，当前分P播完**无刷新自动切换下一分P**（播放器内部切换）；全部分P播完后，再通过播放列表**跳转播放下一个视频**
- **播放器窗口模式记忆**：记住播放窗口大小设置（**默认 / 网页全屏 / 全屏**），切换到列表下一个视频（刷新页面后）自动恢复之前的设置
- **播放进度记忆（B 站播放器恢复 + 插件捕获保存）**：**插件不主动 seek**——打开视频时由 B 站播放器自身恢复到"上次看到"（官方最新，播放器会显示该文案），避免插件旧值覆盖；插件只负责**捕获保存**：① 页面加载 5s 后读取播放器实际位置 ② 关闭标签页/切走时保存一次精确位置 ③ **打开视频页/空间页自动同步官方历史（节流 1 分钟一次）**④ 全局刷新按钮手动同步（≤5 页，找到即停）；仅当 B 站未恢复断点（5s 后仍在开头）时插件才本地兜底 seek；只保存播放列表内视频（视频名/UP名/分P/断点永久保留，不受 B 站历史清理影响）；旧 video 轮询方案停用（代码留存于 git 历史）
- 播放列表持久化：页面刷新 / 重启浏览器后仍在（存储方案见 §6.5）
- 目标浏览器：仅 Chrome / Edge

**明确不做（v1.0）：**

- 不涉及视频下载 / 解析 / 去广告、不做收藏夹导入
- 不改动 B 站播放器本体，只做"播放列表 + 跳转/连播"增强
- 不做登录、不绕过任何风控或付费限制

---

## 2. 技术选型：Chrome 扩展（Manifest V3）

> 结论（ADR-001）：本项目采用 **Chrome 扩展（MV3）** 直接开发，不再使用油猴脚本。
> 理由：需求 8 要求"自动跳转到列表下一个视频后恢复 网页全屏/全屏"。浏览器强制 `requestFullscreen` 必须由**用户手势触发**（transient user activation），油猴脚本在自动跳转后调用会被 Chrome 拒绝，无法满足需求；而扩展可用 `chrome.windows.update({ state: 'fullscreen' })` **无手势完成窗口级全屏**（扩展调用无需额外权限；`"fullscreen"` 权限是 Chrome App 专用，扩展声明会被忽略并打 warning）。既然已知受限，直接采用扩展，避免开发中途换载体。

| 维度 | Chrome 扩展（MV3） ✅ | 油猴脚本（Tampermonkey） |
|---|---|---|
| 全屏自动恢复 | ✅ `chrome.windows.update` 窗口级全屏无需手势；元素级全屏仍受限 | ❌ `requestFullscreen` 必须用户手势，自动恢复被拒 |
| 开发流程 | manifest + content script，`chrome://extensions` 重新加载 | 单文件 `.user.js` 刷新即生效（迭代更快） |
| 分发/安装 | Chrome 商店审核，或开发者模式手动加载 | GreasyFork 一键安装 |
| 跨域请求 | content script fetch + `host_permissions` | `GM_xmlhttpRequest` |
| 存储 | `chrome.storage.local`（扩展级，跨页面/跨子域共享） | `GM_setValue`（按脚本隔离） |
| 页面注入 | `content_scripts`（`matches` + `all_frames: true`） | `@match` 全 frame 注入 |

**配套约定：**

- 目标浏览器：仅 Chrome / Edge（开发者模式加载，见 §5）。
- 代码组织：**v1.0 直接多文件开发、无打包**：`src/content.js` 为主逻辑（注入所有匹配 frame），`src/background.js` 为 MV3 Service Worker（扩展级能力：窗口全屏、跨 frame 消息等）。逻辑按 §4 分模块，避免 content.js 单文件过大；超过约 800 行或需合并打包时再引入 esbuild（届时更新 §5）。
- **各 frame 的 content script 是独立实例**：顶层 frame 与跨域 iframe（`player.bilibili.com`）各自运行一份。UI 只在顶层 frame 挂载（`window === window.top` 判断），iframe 实例只跑播放器适配层；跨 frame 通信用 `chrome.runtime.sendMessage` 或监听 `chrome.storage.onChanged`。

---

## 3. 环境与工具

- 浏览器：Chrome（或 Edge），`chrome://extensions` 开启"开发者模式"
- Node.js ≥ 18 / pnpm（仅引入打包构建后需要）
- 版本管理：git（仓库根即本目录）

---

## 4. 目录结构（约定）

```
BiliPlaylist/
├── agents.md                  # 本文件
├── README.md                  # 使用说明（安装步骤、功能列表）
├── .gitignore
├── manifest.json              # MV3 清单（权限 / content_scripts / background）
├── icons/                     # 扩展图标（16/32/48/128 px，白灰简约风）
├── src/
│   ├── content.js             # 内容脚本入口：按模块组织（UI / 多选 / 侧边栏 / 主流程）
│   ├── background.js          # MV3 Service Worker：窗口全屏、消息转发等
│   ├── api/                   # B 站接口封装（wbi 签名、fetch 封装）
│   ├── storage/               # 持久化封装（chrome.storage.local）
│   ├── ui/                    # 侧边栏 / 悬浮按钮 / 多选 UI（Shadow DOM）
│   └── player/                # 播放器适配层（iframe 内 video / 分P / 进度 / 窗口模式）
├── docs/
│   ├── api-notes.md           # B 站接口 / 页面结构 / 播放器调研笔记（见 §7/§8）
│   ├── features-sort.md       # 侧边栏排序模式规格
│   └── features-group.md      # 侧边栏分组/文件夹规格
└── dist/                      # （引入构建后）可打包目录（zip 上传商店用）
```

---

## 5. 常用命令

v1.0（无构建）：

- **安装/调试**：`chrome://extensions` → 开启"开发者模式" → "加载已解压的扩展程序" → 选择项目根目录。
- **改动后生效（两步缺一不可）**：扩展页点击该扩展的"重新加载"按钮 → 刷新 B 站页面。只刷新页面不重载扩展 = "改了没生效"的常见原因。
- **日志**：B 站页面 DevTools console（content script 日志）；扩展卡片 → "检查视图"（service worker 日志）。
- **纯逻辑测试**：`npm test`（`test/api.test.js`：MD5 / WBI 签名；`test/storage.test.js`：存储层；零依赖，无需浏览器）。

引入构建后（预留）：

- `pnpm install`
- `pnpm build` → 合并输出到 `dist/`（可压缩 zip 上传商店）
- `pnpm dev` → watch 模式

---

## 6. 开发约定

1. **代码质量**
   - 标识符用英文，注释与用户可见文案用中文。
   - 常量配置集中在各模块顶部，manifest 的 `version` 与功能版本保持一致。
   - 不做无谓的防御性包装；但接口请求必须有错误处理与重试退避。
2. **UI 隔离与风格**
   - 所有注入页面的 UI 用 **Shadow DOM** 包裹，不污染 B 站页面样式，也避免被 B 站样式影响。
   - **配色约定（用户明确要求）**：整体采用**白灰配色**，符合 B 站网页版简约风格；**不使用粉色/彩色**；强调色限用 B 站蓝（`#00AEEC` 系）或中性灰阶，深色模式下用灰阶适配。
   - 图标/交互保持与 B 站视觉风格协调；侧边栏宽约 300–360px，固定于页面右侧。
   - **例外（最小污染）**：空间页卡片上的多选勾选框必须注入页面 DOM，其样式通过独立 `<style id="biliplaylist-page-css">` + `biliplaylist-*` 前缀类注入，禁用前缀类即可整体移除。
3. **DOM 选择器**
   - 优先使用 B 站页面上稳定、语义化的选择器（`data-*` 属性、`class` 前缀 `bili-`）；避免依赖可能随改版变化的深嵌套 class。
   - 挂载点选择在页面里寻找后**写进 `docs/api-notes.md` 并注明验证日期**。
4. **接口调用**
   - 所有 B 站接口调用集中在 `src/api.js`，不在 UI 逻辑里散落 fetch。
   - **请求方式（已实现，核心依赖）**：content script → `chrome.runtime.sendMessage('api-fetch')` → background 用 `chrome.scripting.executeScript({ world: 'MAIN' })` 在**页面上下文**执行 fetch（`credentials: 'include'`）——等同站点自身请求，自动带 cookie（登录态/buvid3）与 CORS。需 `"scripting"` 权限。
   - 需要扩展级能力（如窗口全屏）时通过 `chrome.runtime.sendMessage` 交给 `background.js`。
5. **持久化（重要）**
   - 统一走 **`chrome.storage.local`**：扩展级存储，**天然跨页面、跨子域共享**（`www` / `space` / `player` 都能读写），直接解决跨源问题，无需 GM 存储。
   - 存储 key 统一加 `biliplaylist:` 前缀（如 `biliplaylist:list`、`biliplaylist:progress`、`biliplaylist:playerMode`）避免冲突。
   - 数据写入采用"整体序列化 + 版本号字段"（如 `{ version: 1, items: [...] }`），方便未来迁移格式。
   - 跨 frame 实时同步（如 iframe 更新进度 → 顶层侧边栏刷新）可监听 `chrome.storage.onChanged`。
6. **版本与提交**
   - `manifest.json` 的 `version` 字段维护语义化版本；有可见变更必须递增。
   - commit message 用中文，遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:`）。
7. **权限最小化**
   - manifest 权限只申请必需项：`storage`、`scripting`（MAIN world fetch 桥）、`host_permissions`（bilibili 相关域）；新增权限必须谨慎并在 §11 记录理由。
   - 注意：`fullscreen` 是 Chrome App 专用权限，**扩展声明会被忽略并打 warning**（`chrome.windows.update` 窗口级全屏无需该权限），不要加。
8. **不做什么**
   - 不绕过风控、不爬取用户不可见数据、不干扰 B 站广告以外的正常功能。
   - 不请求任何需要额外鉴权（除登录 cookie 外）的接口。

---

## 7. B 站接口要点（关键知识，开发前必读）

来源：公开文档 [bilibili-API-collect](https://github.com/Dreamkaka/bilibili-API-collect) 等；**具体字段与可用性以开发时实测为准，实测结果记录到 `docs/api-notes.md`**。

- **API 基址**：`https://api.bilibili.com`。content script 以页面上下文请求，`credentials: 'include'` 自动携带登录 cookie（见 §6.4）。
- **WBI 签名**：自 2023 年 3 月起，B 站 web 端部分接口要求 `w_rid` + `wts` 参数（WBI 签名），算法已公开（img_key/sub_key 经 mixin key 混淆表生成签名）。实现要点：
  - 从 `https://api.bilibili.com/x/web-interface/nav` 获取 `img_url` / `sub_url` 中的密钥，或使用预置的公开密钥对。
  - 请求参数需按 key 排序后拼接，加盐（mixin key）做 MD5。
  - **开发时需实测当前哪些接口强制 WBI、密钥获取路径是否变更**。
- **常用接口**（v1.0 用到的）：
  - 视频信息：`GET /x/web-interface/view?bvid=...`（返回 `pages` 分P数组，用于展示分P总数）
  - UP 主投稿/搜索列表：`GET /x/space/wbi/arc/search?mid={uid}&pn=1&ps=30`（**强制 WBI 签名**；带 `keyword` 参数即空间内搜索，即搜索页 `space.bilibili.com/{uid}/search?keyword=...` 背后的接口；分页拉取，页面"加载更多"即翻页）
  - 空间页视频卡片本身已含 bvid / 标题 / 封面 / 发布时间，**多选批量加入优先直接读 DOM**（含搜索页），接口仅用于补充信息（如分P数）或分页场景
  - **排序依据**：多选批量加入按发布时间（`pubdate`）升序（旧→新）排列；视频页单个加入追加到列表末尾
- **风控注意事项**：
  - 保持浏览器默认 UA 与 cookie（content script 在页面上下文运行，天然满足）。
  - 请求需携带 `buvid3` cookie（浏览器访问 B 站后自动有）。
  - 控制请求频率（如空间页分页拉取加节流），失败做指数退避，避免触发风控。

---

## 8. 已知坑与风险

1. **B 站前端频繁改版**：播放器 DOM、页面布局、接口签名可能随时变化。选择器与接口结论必须记录验证日期，改版后优先怀疑此处。
2. **播放器已内嵌主页面（2025 实测修正，非 iframe）**：B 站视频页播放器直接渲染在**顶层页面 DOM** 中（实测页面 iframe 列表仅剩 `s1.hdslb.com` 工具 iframe，无 `player.bilibili.com`）。播放器适配层**在顶层 frame 直接操作 video 元素**（读取分P/时间、监听 `timeupdate`/`ended`、切换分P），无需跨 frame；原 iframe 分支保留为兼容。
   - **分P内连播（已实现）**：监听 `video.ended` → 无刷新切换下一分P：**优先点击页面分P列表（选集）中下一分P**（选择器待实测），失败回退整页 `?p=N+1`；分P总数优先读 `currentVideo.pages`（打开视频时 view 接口补全），兜底读分P列表 DOM。全部分P播完 → 发 `video-completed` → 顶层跳转列表下一个视频（URL 携带 `?p=1&playerMode=`）。
   - **跨 frame 通信**（仅旧版 iframe 播放器场景）：iframe 实例用 `chrome.runtime.sendMessage` 或写 `chrome.storage` 触发 `onChanged`，顶层实例据此更新侧边栏进度显示。
3. **注入范围控制**：content_scripts 用 `matches` + `all_frames: true` 精确控制注入域；**UI 只在顶层 frame 挂载**（`window === window.top`），iframe 实例只跑播放器适配层，避免重复挂面板。
4. **"改了没生效"排查**：顺序 = 扩展"重新加载" → 页面刷新 → console 看报错（§5）。
5. **跨子域数据**：`chrome.storage.local` 已解决共享问题（§6.5）；manifest matches 需覆盖 `https://www.bilibili.com/*`、`https://space.bilibili.com/*`、`https://player.bilibili.com/*`、`https://t.bilibili.com/*`。
6. **空间页是 SPA + 懒加载**：`space.bilibili.com/{uid}/video` 与 `space.bilibili.com/{uid}/search?keyword=...` 都是单页应用，列表滚动才"加载更多"。多选 UI 需监听列表容器变化（MutationObserver），分页加载出的新卡片也要能多选。
7. **右下角热区按钮簇**：侧边栏按钮（☰，44px 圆形）+ 页面相关按钮（视频页「＋ 加入列表」/ 空间页「多选」）平时隐藏，鼠标移到右下角热区（120px）才显示，按钮位于**热区中心**（距边约 60px），页面按钮在侧边栏按钮左侧平行（`right: 112px`）；移出后延迟隐藏。注意不要遮挡 B 站自身的右下角控件（"回到顶部"、"小窗播放"等），开发时实测布局。
8. **播放器窗口模式恢复（需求 8 的技术核心）**：
   - 跳转 URL 携带模式参数（如 `?playerMode=web-fullscreen`），新页面加载后由播放器适配层恢复；若 B 站 URL 已有类似参数需复用或避开。
   - **默认**：无操作。
   - **网页全屏（已实现，尽力而为）**：跳转 URL 携带 `playerMode=web-fullscreen` → 顶层写 `pendingWebFs` 标记 → 播放器 iframe 加载后尝试点击"网页全屏"按钮（候选选择器见 `player.js pickWebFullscreenButton`，命中后把实际选择器记入 api-notes）。
   - **全屏**：元素级 `requestFullscreen` 仍受用户手势限制（自动跳转后无手势会被拒）；**自动恢复用 background 的 `chrome.windows.update({ state: 'fullscreen' })` 窗口级全屏**（视觉等价 F11，扩展调用无需 `fullscreen` 权限）规避；若检测到用户刚有过手势（如点击过页面）则优先尝试元素级全屏。
   - 实测结论记录到 `docs/api-notes.md`。

---

## 9. 测试方式

- **手动测试（主要）**：
  1. `chrome://extensions` 开发者模式 → "加载已解压的扩展程序" → 选择项目根目录。
  2. 改动后：扩展页"重新加载" → 刷新 B 站页面（两步都要做）。
  3. 打开 B 站视频页（如 `https://www.bilibili.com/video/BV1xx411c7mD`）、UP 主投稿页（`space.bilibili.com/{uid}/video`）与**空间搜索页**（`space.bilibili.com/{uid}/search?keyword=...`）验证：右下角热区按钮、侧边栏开关、视频页加入、空间页/搜索页多选批量加入、自动排序（旧→新）、拖拽排序、移除、分P进度与播放时间显示、分P内无刷新连播、全部分P后跳转下一视频、窗口模式恢复、进度记忆、刷新后持久化、跨子域数据一致。
  4. DevTools console + 扩展"检查视图"（service worker 日志）查看报错。
- **边界用例**：空列表连播、重复添加同一视频、单分P视频、拿不到分P信息时的兜底显示、非匹配页面不注入、未登录状态（空间页多选应优雅降级）、跨子域数据一致性（空间页加入 → 视频页可见）、右下角热区与 B 站自带按钮不冲突、**卸载扩展后页面无残留痕迹**。
- **自动化（可选，引入构建后）**：对纯逻辑（WBI 签名、列表状态机）用 vitest 单测；不做端到端测试。

---

## 10. 发布（可选，v1.0 后可做）

- 上架 **Chrome 应用商店**（需一次性 $5 开发者注册）或 **Edge 加载项商店**（免费）；也可手动分发 zip（用户解压后开发者模式加载）。
- 上架注意：MV3 权限最小化（`fullscreen`、`host_permissions` 等敏感权限需在商店审核说明用途）、提供隐私政策、图标齐全（16/32/48/128）。

---

## 11. 决策记录与待确认事项

**已确认（已写入 §1/§2）：**

- [x] 技术选型：**Chrome 扩展（MV3）直接开发**（原油猴方案因"无用户手势自动恢复全屏"受限而弃用，见 §2 ADR-001）
- [x] 加入来源：UP 主空间投稿页 + **空间内搜索页**多选批量加入；视频页"加入列表"按钮（不做收藏夹导入）
- [x] 侧边栏：仅 B 站站内生效（`www` / `space` / `t` 三域）；右下角**热区按钮簇**（平时隐藏、热区悬停显示，位于热区中心）：侧边栏按钮 + 页面按钮（视频页「＋ 加入列表」/ 空间页「多选」）左侧平行；动态页 `t.bilibili.com` 仅侧边栏按钮
- [x] 侧边栏条目信息：视频名称、UP主名、分P进度（如 `1/11`，只显示总数）、当前分P播放时间 `hh:mm:ss`、**播放按钮 ▶（新标签页打开）**、删除按钮、已播完标记；头部单行 = 标题 + 数量 + **窗口模式下拉框**（默认/网页全屏/全屏）+ 刷新（同步列表+历史）+ 关闭
- [x] 多选：**默认关闭**，热区「多选」按钮开启；**整卡覆盖层点击切换选中**（不进入播放页，抑制缩略图悬停预览），小复选框绝对定位在日期行高度、卡片右端作指示；添加后 toast 提示（含重复数）
- [x] 空间页 SPA 适配：URL 轮询（800ms），首次搜索/tab 切换后热区按钮即时出现，无需刷新
- [x] 排序与查重：多选批量加入按发布日期升序；视频页单个加入追加到列表末尾；+ **拖拽排序**手动调整；**按 bvid 查重**（重复不添加并提示）
- [x] 分P连播：分P内无刷新连播下一分P；全部分P播完 → 列表跳转下一视频
- [x] 播放器窗口模式记忆：默认 / 网页全屏 / 全屏，切视频刷新后恢复（全屏走窗口级 `chrome.windows.update`）
- [x] 配色：白灰简约、B 站风格、不用粉色
- [x] 播放进度记忆：需要（含分P位置）；**B 站播放器自身恢复"上次看到"（插件不主动 seek，避免覆盖），插件只捕获保存**（加载 5s 后位置 + 关闭时一次 + 刷新按钮合并历史同步 ≤5 页），本地永久保存播放列表内视频历史；旧 video 轮询方案停用（代码留存于 git 历史）
- [x] 目标浏览器：仅 Chrome / Edge
- [x] 扩展权限最小集：`storage`、`scripting`（MAIN world fetch 桥）、`host_permissions`（bilibili 相关域）；`fullscreen` 为 Chrome App 专用权限已移除——新增权限需在此记录理由
- [x] （v1.1，已实现）侧边栏**排序模式**：多选（单击 / Shift 范围 / Ctrl 单独 / 全选）+ **手动分组拖拽**（含落点指示线）+ **按发布日期升/倒序自动排序**（仅对选中视频生效，采用「原位置内重排」，缺失日期先补全、未补齐放末尾）+ **撤销上一步**。详细规格见 `docs/features-sort.md`
- [x] （v1.2，已实现）侧边栏**分组/文件夹**：成组（按钮「成组」，允许重新成组）+ 文件夹标签（选中勾选指示 / 重命名 / 收起展开，**默认收起、每次加载重置**，收起显示成员数与首条摘要，点组头**切换选中该组成员**）+ 自动排序**组内排、组间不排** + 拖进/移出、拖标签改位、取消分组（**无颜色功能**；重命名输入阻止按键冒泡，避免触发播放器快捷键）。详细规格见 `docs/features-group.md`
- [x] （v1.2.1）**组头播放按钮**：文件夹标签新增 ▶，点击播放组内第一个视频、从断点续播（逻辑同直接点击该视频）。
- [x] （v1.2.2）**修复分P断点续播 bug**：分P感知保存（分P变化即保存，避免新分P time 小于旧分P而跳过）；`jumpToVideo` 以断点分P作为 `?p=`；侧边栏/组头分P显示改用断点分P（如 3/11）。
- [x] （v1.2.3）**修复分P结束误判**：`getTotalParts` 增加播放列表 item.pages 兜底；`onEnded` 仅当分P总数已知且到最后一P才判完成并跳下一视频，总数未知时先尝试下一分P、不误跳/不误标已看完；非最后分P清除误判 done；侧边栏/组头仅在 `done && part>=pages` 时显示「已看完」。
- [x] （v1.2.4）**断点/连播系统改造（待实测）**：①连续保存——每 ~10s/跨阈值「边看边存」，数值没变不写；②URL `p=` 分P监听——B 站驱动切集/F5 后按 URL 校准并记录，切分P后同步 URL p；③修 `syncHistory` 单位不一致（view_at 秒 vs 本地毫秒）致官方历史永不覆盖（Bug②）；④播完以可靠分P判定最后一P及时接管（Bug①，仍有与 B 站自动连播竞态的边界待实测）；⑤显示侧最小化——进度只原地更新播放条文本、仅侧边栏打开时更新、保持滚动；⑥跳列表下一个视频按其自身断点分P打开。详记见 `docs/features-group.md`。

**剩余待确认（不阻塞开发，可后续再定）：**

- [ ] 列表容量上限、是否需要导出/导入列表（JSON）

> 未确认项按"可扩展的最小实现"处理，不阻塞 v1.0 开发。

---

## 12. 给后续代理的开工提示（checklist）

1. 通读本文件与 `README.md`（如有）。
2. 查看 `docs/api-notes.md` 中已记录的接口/选择器/播放器结论与验证日期；缺失或过期则先实测补充。
3. **改动生效流程**：扩展页"重新加载" → 刷新 B 站页面，两步缺一不可；"没生效"先按此排查。
4. 任何涉及 B 站页面结构、接口或播放器的假设，都要在 `docs/api-notes.md` 留下实测记录。
5. manifest.json 的权限与 matches 需与 §6.7/§8.5 保持一致；新增权限要同步更新 §11 记录。
