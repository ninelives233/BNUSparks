# BNU Sparks · 木铎星火

> 为爱发电的校内资源共享平台 · 致力于贯彻开源精神，抹平信息差
>
> 面向北京师范大学的课程资料共享平台，免费、开放、社区驱动。
>
> 🔗 https://bnusparks.cn（备案中，当前 IP 访问 http://62.234.182.156）

---

## 🔗 访问网站

| 方式 | 地址 | 说明 |
|------|------|------|
| **主站** | http://62.234.182.156 | 当前可直接访问 |
| **域名** | https://bnusparks.cn | 备案中，后续启用 |

无需注册即可浏览课程、搜索资料。使用北师大 `@mail.bnu.edu.cn` 邮箱注册后可上传和下载。

---

## 📬 投稿与反馈

- **投稿**：注册后直接在各课程页面上传，系统自动进入审核流程
- **Bug / 建议**：提交 [GitHub Issue](https://github.com/ninelives233/BNUSparks/issues)
- **贡献代码**：Fork → PR，欢迎任何形式的参与

---

## ✨ 当前状态：**已上线运营中** 🟢

### ✅ 已完成

- **认证闭环**：注册（北师大邮箱限）+ 登录 + JWT 7天过期 + 密码重置（163 SMTP）
- **资料上传/下载**：文件存储 + Git 自动备份，下载配额（60次/天/用户）
- **课程分类浏览**：导航树动态加载 + 通识/专业分栏 + 同名课程智能合并
- **搜索**：全文搜索（课程名/代码 + 资料标题/描述）
- **五级角色体系**：super_admin → moderator → sub_moderator → user → guest
- **审核系统**：上传待审 → 自动路由 → 版主批准/驳回 → 异议 → 通知上传者
- **自动托管审核**：开启后所辖板块新上传资料自动通过，1 分钟延迟显示，上传者无感知
- **一键过审**：待审核页面一键通过全部待审资料
- **审核分流机制**：上级管理员默认隐藏下级版主板块的待审核，可一键切换查看
- **通知系统**：抽屉式快捷通知 + 完整通知独立页面，通知消息可直接跳转至对应课程
- **个人中心**：昵称编辑、密码修改、角色展示、下载配额、我的上传记录
- **管理后台**：概览统计、待审核面板、审核历史、用户管理、文件管理模式
- **排行榜**：下载排行 + 学院筛选 + 文件跳转高亮
- **文件管理**：树形导航文件管理模式，支持删除
- **响应式设计**：桌面侧边栏 + 移动端滑出抽屉
- **部署上线**：腾讯云 2C2G + Nginx + Gunicorn + Supervisor

### 🗓️ 迭代记录

| 迭代 | 内容 | 完成时间 |
|------|------|----------|
| Iter 0 | 基础设施、Django 项目、CSS 设计系统、课程树 | 7月7日 |
| Iter 1 | 认证闭环、JWT、角色系统、SMTP | 7月8日 |
| Iter 2 | 个人中心、通知抽屉、审核标签、下载配额 | 7月9日 |
| Iter 3 | 管理后台、审核面板、用户管理、统计概览 | 7月9日 |
| Iter 3.1 | 体验优化：标签页隔离、角色动态刷新、移动端布局、历史导航 | 7月9日 |
| Iter 4 | 五级角色 + 审核路由 + 文件管理 + 自动托管 + 完整通知系统 | 7月10-11日 |

### 📋 待办

- [ ] 域名备案 + HTTPS
- [ ] 文件在线预览
- [ ] 用户头像上传
- [ ] 单元测试

---

## 🏗️ 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | 纯 HTML + CSS + Vanilla JS | SPA 架构，零框架，~2,900 行 |
| **后端** | Django 6.0 + Gunicorn | 纯 Python，无 DRF ~1,600 行 |
| **数据库** | SQLite | 单用户量级足够，零配置 |
| **认证** | 手工 JWT（HMAC-SHA256） | 仅存 user_id + exp，角色从 DB 实时读取 |
| **样式** | OKLCH 色彩空间 + CSS 变量 | `--brand-hue` 控制全局调性，~2,300 行 |
| **部署** | Nginx → Gunicorn → Supervisor | 腾讯云，进程守护 |
| **邮件** | SMTP via 163.com（SSL 465） | 密码重置通知 |
| **文件** | 服务器磁盘 + Git 自动提交 | 备份+版本历史 |

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

## 📡 API 概览（47 条路由）

```
/auth/register|login|me|change-password|forgot-password|reset-password
/auth/notifications|/notifications/<id>/read
/auth/profile|/user/uploads

/courses|/courses/tree|/courses/<code>/files
/files/upload|/files/<id>/download|/files/<id>/delete

/moderation/pending|/batch-approve|/<id>/approve|/<id>/reject
/moderation/<id>/reassign|/<id>/comments|/history|/stats

/admin/users|/users/<id>/role|/users/<id>/auto-approve
/admin/sections

/search|/stats|/colleges
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
│   ├── settings_prod.py   # 生产配置（DEBUG=False）
│   └── urls.py            # 根路由
├── materials/             # 核心应用
│   ├── views.py           # 全部 API 视图（~1,600 行）
│   ├── models.py          # 8 个数据模型（247 行）
│   └── urls.py            # API 路由（52 行）
├── public/                # 前端 SPA
│   ├── index.html         # 入口 + 视图 DOM
│   ├── css/style.css      # 完整设计系统
│   └── js/app.js          # 全部前端逻辑（~2,900 行）
├── data/                  # 数据库 + 上传文件
├── docs/                  # 项目文档
│   └── PROJECT_OVERVIEW.md
├── README.md
├── .gitignore
└── requirements.txt       # django>=6.0 + gunicorn>=22.0
```

---

## 📬 联系方式

- 邮箱：bnusparks@163.com
- 建议 & 贡献：欢迎 [PR / Issue](https://github.com/ninelives233/BNUSparks/issues)

---

## 📄 许可

[MIT License](LICENSE)

Copyright © 2026 BNU Sparks
