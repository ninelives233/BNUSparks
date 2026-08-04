# BNU Sparks · 木铎星火

> 为爱发电的校内资源共享平台 · 致力于贯彻开源精神，抹平信息差
>
> 面向北京师范大学的课程资料共享平台，免费、开放、社区驱动。
>
> 🔗 https://bnusparks.cn（已上线运营，HTTPS 证书有效）

---

## 🔗 访问网站

| 方式 | 地址 | 说明 |
|------|------|------|
| **正式域名** | https://bnusparks.cn | 推荐访问，HTTPS 证书有效 |

无需注册即可浏览课程、搜索资料。使用北师大 `@mail.bnu.edu.cn` 邮箱注册后可上传和下载。

---

## 📬 投稿与反馈

- **投稿**：注册后直接在各课程页面上传，系统自动进入审核流程
- **Bug / 建议**：提交 [GitHub Issue](https://github.com/ninelives233/BNUSparks/issues)
- **贡献代码**：Fork → PR，欢迎任何形式的参与

---

## ✨ 当前状态：**已上线运营中** 🟢

### ✅ 已完成

- **认证闭环**：注册（北师大邮箱限制 + 邮箱验证 + 自设密码）+ 登录 + JWT + 密码重置（163 SMTP）
- **资料上传/下载**：文件存储（EXIF 清理），下载配额（60次/天/用户），批量上传/下载
- **课程分类浏览**：导航树动态加载 + 通识/专业分栏 + 同名课程按学院分拆 + 管理模式课程树编辑
- **搜索**：全文搜索（课程名/代码 + 资料标题/描述）+ 搜索覆层 UI
- **五级角色体系**：super_admin → moderator → sub_moderator → user → guest
- **审核系统**：上传待审 → 自动路由 → 版主批准/驳回 → 异议回复 → 通知上传者
- **自动托管审核**：开启后所辖板块新上传资料自动通过，1 分钟延迟显示，上传者无感知
- **一键过审**：待审核页面一键通过全部待审资料
- **审核分流机制**：上级管理员默认隐藏下级版主板块的待审核，可一键切换查看
- **文件在线预览**：PDF / 图片浏览器内预览（移动端浏览器天然不支持 PDF）
- **通知系统**：抽屉式快捷通知 + 完整通知独立页面，通知消息可直接跳转至对应课程
- **个人中心**：昵称/签名/联系方式编辑、密码修改、头像上传、角色展示、下载配额
- **用户排行榜**：上传/下载排行 + 学院筛选，公开个人主页
- **收藏系统**：资料收藏/取消收藏 + 我的收藏独立页
- **文件详情页**：单文件详情 + 资料类型标记 + 列表筛选/排序
- **公告系统**：首页公告栏 + 管理端发布，发布推送至通知中心
- **管理后台**：概览统计、待审核面板、审核历史、用户管理、删除记录（可恢复）、文件管理模式
- **管理模式**：树形导航文件/文件夹管理，支持新建、重命名、移动、删除、修改课程代码（含链接合并）、撤销操作、操作记录
- **响应式设计**：桌面侧边栏 + 移动端滑出抽屉
- **性能优化**：N+1 查询修复、接口缓存、前端请求并行化
- **部署上线**：腾讯云 + Nginx + Gunicorn + Supervisor，一键部署脚本 + 部署验证

### 🗓️ 迭代记录

| 迭代 | 内容 | 完成时间 |
|------|------|----------|
| Iter 0 | 基础设施、Django 项目、CSS 设计系统、课程树 | 7月7日 |
| Iter 1 | 认证闭环、JWT、角色系统、SMTP | 7月8日 |
| Iter 2 | 个人中心、通知抽屉、审核标签、下载配额 | 7月9日 |
| Iter 3 | 管理后台、审核面板、用户管理、统计概览 | 7月9日 |
| Iter 3.1 | 体验优化：标签页隔离、角色动态刷新、移动端布局、历史导航 | 7月9日 |
| Iter 4 | 五级角色 + 审核路由 + 文件管理 + 自动托管 + 完整通知系统 | 7月10-11日 |
| Iter 5 | 头像上传、批量上传/下载、弹窗滚动锁、审核异议回复、驳回清理 | 7月12日 |
| Iter 6 | EXIF GPS 清理、邮箱验证+自设密码注册、管理模式/文件编辑/操作记录、移动管理后台 | 7月14-15日 |
| Iter 6.5 | 文件在线预览（PDF/图片）、一级目录卡片布局 | 7月15日 |
| Iter 7 | 个人资料扩展、用户排行榜、首页改版、公告系统 | 7月16日 |
| Iter 8 | 收藏系统、文件详情页、资料类型标记、筛选排序 | 7月19日 |
| Iter 9 | 管理模式课程树编辑（新建/重命名/移动/删除/改课程代码）+ 搜索覆层 UI 重构 | 7月19日 |
| 性能优化 | N+1 查询修复、接口缓存、前端并行化 | 7月20日 |

### 📋 待办

- [ ] ICP 备案状态确认（域名已生效，备案情况待核实）
- [ ] 批量下载漏下问题（Edge 浏览器多文件下载限制，考虑客户端 JSZip / Service Worker 方案）
- [ ] 下载配额调整（考虑继续下调）
- [ ] 更多学院课程树导入（对照培养方案 PDF）
- [ ] 管理员操作手册完善

---

## 🏗️ 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | 纯 HTML + CSS + Vanilla JS | SPA 架构，零框架，8 模块 ~6,200 行 |
| **后端** | Django 6.x + Gunicorn | 纯 Python，无 DRF，视图包 12 模块 ~4,100 行 |
| **数据库** | SQLite | 单用户量级足够，零配置 |
| **认证** | 手工 JWT（HMAC-SHA256） | 仅存 user_id + exp，角色从 DB 实时读取 |
| **样式** | OKLCH 色彩空间 + CSS 变量 | `--brand-hue` 控制全局调性，~4,700 行 |
| **部署** | Nginx → Gunicorn → Supervisor | 腾讯云，进程守护，`deploy.sh` 一键部署 + `deploy_verify.sh` 验证 |
| **邮件** | SMTP via 163.com（SSL 465） | 注册邮箱验证 + 密码重置通知 |
| **文件** | 服务器磁盘 `data/materials/` | 上传自动清理 EXIF 地理信息 |

---

## 🎨 设计体系

| 维度 | 方案 |
|------|------|
| 主色 | OKLCH 250° 暖调藏蓝（跨文化最受信赖色相） |
| 强调色 | 45° 琥珀（与主色互补，冷暖自然悦目） |
| 背景 | 60° 奶油色（减少视疲劳 30%+） |
| 标题字体 | Noto Serif SC（学术权威感） |
| 正文字体 | Noto Sans SC（清晰易读） |
| 风格锚点 | **E-warm-academic** — 温暖学术感 |
| 图标 | 学科门类全手工内联 SVG |
| 动效 | 150-250ms 过渡窗口，克制用 |
| 避开 | ❌ AI 模板风（浅蓝按钮、圆角卡片、灰色渐变） |

---

## 📡 API 概览

```
认证   /auth/register|verify-email|login|me|change-password|forgot-password|reset-password
课程   /courses|/courses/tree|/courses/<code>/files
文件   /files/upload|/files/upload-text|/files/<id>/download-token|/files/<id>/download
       /files/<id>/delete|/files/<id>/update|/files/<id>/|/files/batch-delete|/files/batch-edit
收藏   /files/<id>/favorite|/files/<id>/favorite-status|/user/favorites
文件夹 /folders/create|/folders/<id>/delete|/operations|/operations/<id>/restore
通知   /auth/notifications|/auth/notifications/<id>/read
个人   /auth/profile|/auth/avatar|/user/uploads|/user/downloads|/user/rankings|/user/public/<uid>
公告   /announcements|/announcements/<aid>
搜索   /search|/stats|/colleges
审核   /moderation/pending|/<id>/approve|/<id>/reject|/<id>/reassign|/batch-approve
       /<id>/comments|/history|/deletions|/deletions/<id>/restore|/stats
管理   /admin/users|/admin/users/<id>/role|/admin/sections|/admin/users/<id>/auto-approve
```

响应格式统一：`{"ok": true, "data": ...}` / `{"ok": false, "error": "..."}`

---

## 👑 角色权限

| 角色 | 上传 | 审核 | 用户管理 | 管理后台 |
|------|------|------|----------|----------|
| 游客 | ❌ | ❌ | ❌ | ❌ |
| 普通用户 | ✅（需审核） | ❌ | ❌ | ❌ |
| 小版主 | ✅（自动通过） | ✅（指定专业/课程节点） | ❌ | ✅ |
| 版主 | ✅（自动通过） | ✅（管辖学院/板块） | ❌ | ✅ |
| 总管理员 | ✅（自动通过） | ✅（全部） | ✅ | ✅ |

---

## 📁 项目结构

```
BNUSparks/
├── bnusparks/             # Django 配置
│   ├── settings.py        # 基础配置（SMTP 从 .env 读取）
│   ├── settings_prod.py   # 生产配置（DEBUG=False，安全头）
│   └── urls.py            # 根路由
├── materials/             # 核心应用
│   ├── views/             # 视图包（12 个模块，~4,100 行）
│   │   ├── auth.py        # 认证 API
│   │   ├── courses.py     # 课程/搜索/统计
│   │   ├── files.py       # 文件上传/下载/详情
│   │   ├── favorites.py   # 收藏
│   │   ├── moderation.py  # 审核 API
│   │   ├── admin.py       # 管理员 API
│   │   ├── operations.py  # 文件夹/文件管理
│   │   └── ...            # 通知/个人资料/公告/工具
│   ├── models.py          # 12 个数据模型（383 行）
│   ├── urls.py            # API 路由（57 条）
│   └── tests/             # 测试套件（10 个文件）
├── public/                # 前端 SPA（8 模块，~6,200 行）
│   ├── index.html         # 入口 + 视图 DOM
│   ├── css/style.css      # 设计系统（OKLCH）
│   └── js/
│       ├── app.js         # 入口初始化
│       ├── utils.js       # 工具函数
│       ├── auth.js        # 认证流程
│       ├── profile.js     # 个人中心
│       ├── notifications.js # 通知中心
│       ├── views.js       # 视图导航/静态页
│       ├── explorer.js    # 课程浏览器
│       └── admin.js       # 管理后台
├── data/                  # 数据库 + 上传文件
├── docs/                  # 项目文档
├── scripts/               # 种子/修复/部署脚本
├── deploy.sh              # 一键部署脚本
├── README.md
└── requirements.txt       # django>=6.0 + gunicorn + Pillow + pypdf
```

---

## 📬 联系方式

- 邮箱：bnusparks@163.com
- 建议 & 贡献：欢迎 [PR / Issue](https://github.com/ninelives233/BNUSparks/issues)

---

## 📄 许可

[MIT License](LICENSE)

Copyright © 2026 BNU Sparks
