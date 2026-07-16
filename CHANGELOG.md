# Changelog

## 2026-07-17 — Bugfix: View切换残留 + 时区8小时偏差 (v=75)

### Bug 修复

#### 1. 我的上传/下载页面切换残留（100%复现）
- **根因**: `switchView()` 硬编码了 12 个视图 ID 列表，`myUploadsView`、`myDownloadsView` 被遗漏。`showMyUploadsPage()` 使用行内 `display: block` 设置，切换视图时硬编码列表不含这两个视图，行内样式不被清除，导致页面底部持续渲染
- **修复**: `switchView()` 改用 `document.querySelectorAll('.view-section')` 动态查找所有视图，删除硬编码列表
- **相关文件**: `public/js/app.js`

#### 2. 服务器时间比北京时间慢8小时
- **根因**: Django `USE_TZ = True` 在 SQLite 中存储 UTC，`.strftime()` 输出 UTC。更隐蔽的问题是 `deploy.sh` 从未包含 `bnusparks/settings.py`，导致生产服务器运行时一直是 `USE_TZ = True`
- **修复**:
  - 本地: `USE_TZ = True` → `False`，Django 直接存 Asia/Shanghai naive datetime
  - 删除所有 20 处 `timezone.localtime()` 包装器（第1轮错误修复的遗留）
  - 数据迁移: 生产库 1901 个 datetime 值全部 +8 小时（涵盖 14 列，含之前遗漏的 `materials_announcement` 和 `materials_downloadrecord`）
  - 修复 `deploy.sh` 加入 `bnusparks/settings.py` 和 `scripts/migrate_tz.py`
- **相关文件**: `bnusparks/settings.py`, `deploy.sh`, `scripts/migrate_tz.py`

### 功能优化

#### 3. 排行榜隐藏测试账号
- 添加 15 个测试用户名到 `TEST_USERNAMES` 列表，排行榜查询使用 `.exclude(username__in=...)` 过滤
- **相关文件**: `materials/views.py`

#### 4. 用户公开页统计看板
- API 返回 `upload_count`（上传数）、`download_count`（被下载总数）、`collection_count: 0`（预留）
- 前端渲染三个统计卡片（上传数、被下载数、被收藏数）
- **相关文件**: `materials/views.py`, `public/js/app.js`

#### 5. 首页 Hero 区域上传按钮
- Hero 区域内新增上传按钮，导航卡片区域原按钮保留（窄屏显示 Hero 按钮，宽屏显示导航卡片按钮）
- 资料总数同时显示在两处
- **相关文件**: `public/index.html`, `public/css/style.css`, `public/js/app.js`

---

## 2026-07-16 — Iter 7: 个人资料/排行榜/首页/公告系统 (f83341d)

### 新功能
- **个人资料页扩展**: 新增联系邮箱、联系方式、个人简介字段；用户数据看板（上传数/被下载数）
- **用户贡献排行榜**: 侧边栏入口，上传量/下载量双 tab，每页 25 行 × 4 页
- **用户公开主页**: 点击用户头像/昵称查看其公开资料和上传文件列表
- **首页改版**: 醒目的上传按钮 + 动态资料总数显示
- **公告系统**: 动态发布/删除，自动推送通知至所有用户的消息中心
- **Footer 条件隐藏**: 仅首页显示，其他视图自动隐藏
- **AI 学院图标**: 新增人工智能学院 SVG 图标；社会学院/心理学部/文学院/历史学院图标重绘

### 文件变更
- `materials/models.py` — 新增 Announcement 模型、UserProfile 扩展字段
- `materials/views.py` — 新增 4 个 API（排行榜/用户公开页/公告 CRUD）
- `materials/urls.py` — 新增 6 个路由
- `public/index.html` — 新视图（leaderboardView/userPublicView）、首页布局重组、公告动态化
- `public/js/app.js` — 新增 showLeaderboard/showUserPublic/loadAnnouncements 等函数
- `public/css/style.css` — 新增排行榜/公开页/公告样式
