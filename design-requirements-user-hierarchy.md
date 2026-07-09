# 需求规格：用户分级 & 权限体系

> 日期：2026-07-09
> 来源：审计报告 [design-audit-user-file-modules.md](design-audit-user-file-modules.md)
> 状态：设计方案·草稿

---

## 一、概述

为 BNUSparks 引入四级用户权限体系，建立"总管理员 → 管理员(版主) → 普通用户 → 访客"的权限层级，配合文件审核流程，实现可控的社区化内容管理。

---

## 二、用户角色定义

### 2.1 四级权限矩阵

| 能力 | 总管理员 | 管理员/版主 | 普通用户 | 未登录访客 |
|------|---------|-----------|---------|-----------|
| 浏览页面 & 课程树 | ✅ | ✅ | ✅ | ✅ |
| 查看文件列表 | ✅ | ✅ | ✅ | ✅ |
| **下载文件** | ✅ 无限 | ✅ 无限 | ⚠️ 限量 | ❌ |
| **上传文件** | ✅ 免审 | ✅ 免审 | ⚠️ 需审核 | ❌ |
| 审核/驳回上传 | ✅ | ✅ 主责板块 | ❌ | ❌ |
| 增删课程节点(一级) | ✅ | ❌ | ❌ | ❌ |
| 增删课程节点(二级+) | ✅ | ✅ | ❌ | ❌ |
| 增删任意文件 | ✅ | ✅ 主责板块 | ❌ | ❌ |
| 分配版主管辖板块 | ✅ | ❌ | ❌ | ❌ |
| 删除/编辑任意资料元数据 | ✅ | ✅ 主责板块可删 | ❌ | ❌ |

### 2.2 角色详细说明

#### 总管理员（Super Admin）
- 映射到 Django `is_superuser`
- 完全无视所有权限检查
- 可管理课程分类树的**任意层级**节点：新建学院门类、通识课门类、细分课程等
- 可增删改**任意**资料（包含他人上传的）
- 可管理用户角色：提权、降权、分配版主板块
- 可访问 Django Admin 后台

#### 管理员 / 版主（Moderator）
- 映射到新模型 `UserProfile.role = "moderator"`
- **不能**改动一级分类节点（通识课分类大类、学院门类）
- **可以**在一级分类**之下**的二级目录中增删文件夹与课程节点
- **可以**在自己的"主责板块"内：
  - 审核/通过/驳回该板块下的用户上传
  - 删除该板块下的文件
  - 编辑该板块下的资料元数据（标题、描述、教师等）
- **也可以**在非主责板块行使上述权力（但以主责板块为核心生态）
- 一个版主可负责**多个**板块；一个板块也可有**多个**版主

#### 普通用户（Regular User）
- 映射到新模型 `UserProfile.role = "user"`（注册后默认）
- 可上传文件，上传后 `review_status = "pending"`，需版主/总管理员审核通过后**才对其他用户可见**
- 自己上传的文件（含未审核的）在自己的视角里始终可见，并标注"审核中"
- 可下载文件，但有**每日限量**，下载计数每日零点刷新
- 具体限额梯度：
  - **0~20 次/日**：正常下载，无提示
  - **21~60 次/日**：每5次下载弹出温和提醒——"请考虑一下平台的维护成本，珍惜每一次下载"
  - **≥61 次/日**：当日上限到达，下载按钮置灰，提示——"今日下载次数已达上限，请理解开发者的苦衷，明天再来吧"
- 可查看任何文件列表、课程树

> 注：此限额针对普通用户。总管理员和版主不受限。

#### 未登录访客（Guest）
- 无 token 或 token 无效
- 只可浏览公开页面：首页、课程树结构、文件列表（不含下载链接）
- 下载链接不显示，点击上传/下载跳转到登录弹窗

---

## 三、权限边界界定

### 3.1 课程树层级定义

以当前课程导航树的结构为例：

```
层级 0（根）:   通识课                         专业课
层级 1（一级）: 思想政治理论类    体育……    经管学院    法学院
层级 2（二级）: 思想道德与法治  中国近现代史纲要     金融学    经济学……    法学
层级 3（三级）:  [课程文件]                         刑法学    民法学……
```

**凡尔赛条款**（权限边界规则）：
1. 一级节点（层级1）→ 仅总管理员可创建/删除/更名
2. 二级及以下节点（层级2+）→ 总管理员和版主均可操作
3. "主责板块"以**层级1节点**为单位——版主可被分配负责"思想政治理论类"板块
4. 文件审核同理：版主可审核其主责板块下所有二级节点的文件

### 3.2 主责板块（版主系统）

```
版主 张三
  ├─ 主责板块: ["思想政治理论类", "体育与健康类"]
  ├─ 审核队列: → 这两个分类下的所有待审核文件
  └─ 管理能力: → 在这两个分类下可增删课程节点、审核文件、删除文件

版主 李四
  ├─ 主责板块: ["经管学院"]
  ├─ 审核队列: → 经管学院下的所有待审核文件
  └─ 管理能力: → 在经管学院下可增删课程节点、审核文件、删除文件
```

版主在没有被分配的板块中**也可以**行使权力，但系统优先向主责板块的版主推送审核任务。

### 3.3 审核流程

```
用户上传文件
    │
    ▼
is_approved = False
    │
    ├─ 仅上传者自己可见（标注"审核中"）
    ├─ 其他人的文件列表和搜索结果中隐藏
    │
    ▼
版主/总管理员 在审核队列中查看
    │
    ├─ ✅ 通过
    │   ├─ review_status = "approved"
    │   ├─ reviewed_by = 当前用户, reviewed_at = now
    │   └─ → 自动推送通知给上传者："你的资料「xxx」已通过审核"
    │
    └─ ❌ 驳回
        ├─ review_status = "rejected"
        ├─ review_notes = 驳回原因
        ├─ reviewed_by = 当前用户, reviewed_at = now
        └─ → 自动推送通知给上传者："你的资料「xxx」未通过审核，原因：…"
```

---

## 四、后端数据模型变更

### 4.1 UserProfile 模型（新增）

```python
class UserProfile(models.Model):
    class Role(models.TextChoices):
        USER = "user", "普通用户"
        MODERATOR = "moderator", "版主"
        SUPER_ADMIN = "super_admin", "总管理员"

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.USER)
    # 版主的主责板块（层级1的 CourseCategory 节点）
    moderated_sections = models.ManyToManyField(
        CourseCategory, blank=True,
        verbose_name="主责板块",
        help_text="仅对 role=moderator 有效，一级分类节点",
    )
    created_at = models.DateTimeField(auto_now_add=True)
```

### 4.2 Material 模型变更

- `uploader_name`（字符串）→ 改为 `uploader`（FK → User）（需要数据迁移）
- 新增 `review_status` 字段替代布尔 `is_approved`：

```python
class Material(models.Model):
    class ReviewStatus(models.TextChoices):
        PENDING = "pending", "待审核"
        APPROVED = "approved", "已通过"
        REJECTED = "rejected", "已驳回"

    # ... 现有字段 ...
    uploader = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="上传者", related_name="uploads",
    )
    review_status = models.CharField(
        max_length=20, choices=ReviewStatus.choices,
        default=ReviewStatus.PENDING,
    )
    review_notes = models.TextField("审核备注", blank=True)
    reviewed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="审核人", related_name="reviews",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
```

### 4.3 消息通知模型（新增）

```python
class Notification(models.Model):
    class Type(models.TextChoices):
        REVIEW_APPROVED = "approved", "审核通过"
        REVIEW_REJECTED = "rejected", "审核驳回"
        MOD_DISAGREE = "disagree", "审核异议"

    recipient = models.ForeignKey(
        User, on_delete=models.CASCADE,
        verbose_name="接收人", related_name="notifications",
    )
    type = models.CharField("通知类型", max_length=20, choices=Type.choices)
    title = models.CharField("标题", max_length=200)
    message = models.TextField("消息内容", blank=True)
    is_read = models.BooleanField("已读", default=False)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)

    # 关联资源
    material = models.ForeignKey(
        Material, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="关联资料",
    )

    # 异议相关：谁发起的异议
    triggered_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="触发人", related_name="triggered_notifications",
    )

    class Meta:
        verbose_name = "消息通知"
        verbose_name_plural = "消息通知"
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.get_type_display()}] → {self.recipient}: {self.title}"
```

通知类型说明：

| 类型 | 触发条件 | 接收人 | 内容模板 |
|------|---------|--------|---------|
| `approved` | 版主通过审核 | 上传者 | "你的资料「xxx」已通过审核，现在其他同学也能看到了" |
| `rejected` | 版主驳回审核 | 上传者 | "你的资料「xxx」未通过审核。原因：{驳回理由}" |
| `disagree` | 版主点击"异议" | 原审核人 | "{对方昵称} 对你在「xxx」的审核结果有异议，点击查看" |

### 4.4 JWT Payload 扩展

当前 JWT 仅含 `user_id` 和 `exp`，需增加角色信息以减少重复查询：

```python
# payload 结构
{
    "user_id": 1,
    "role": "moderator",      # 新增
    "exp": 1700000000,
}
```

---

## 五、API 变更清单

### 5.1 新增 API

| 方法 | 路径 | 权限 | 作用 |
|------|------|------|------|
| GET | `/api/admin/users/` | 总管理员 | 用户列表 & 角色管理 |
| PATCH | `/api/admin/users/<id>/role/` | 总管理员 | 修改用户角色 |
| POST | `/api/admin/users/<id>/sections/` | 总管理员 | 分配版主板块 |
| GET | `/api/admin/review-queue/` | 版主+ | 获取待审核文件列表 |
| POST | `/api/admin/review/<id>/approve/` | 版主+ | 通过审核 |
| POST | `/api/admin/review/<id>/reject/` | 版主+ | 驳回审核（含原因） |
| POST | `/api/admin/categories/` | 版主+ | 新建课程分类节点 |
| DELETE | `/api/admin/categories/<id>/` | 版主+ | 删除课程分类节点 |
| PATCH | `/api/admin/categories/<id>/` | 版主+ | 编辑分类节点 |
| DELETE | `/api/admin/files/<id>/` | 版主+ | 删除文件（软删/硬删） |
| PATCH | `/api/admin/files/<id>/` | 版主+ | 编辑资料元数据 |
| GET | `/api/user/uploads/` | 登录用户 | 自己的上传记录与审核状态 |
| GET | `/api/user/notifications/` | 登录用户 | 获取自己的消息通知列表 |
| PATCH | `/api/user/notifications/<id>/read/` | 登录用户 | 标记通知为已读 |
| POST | `/api/user/notifications/read-all/` | 登录用户 | 一键全部已读 |
| GET | `/api/user/notifications/unread-count/` | 登录用户 | 未读通知数量（header 小红点用） |
| POST | `/api/admin/review/<id>/disagree/` | 版主+ | 对审核结果提出异议 → 通知原审核人 |

### 5.2 现有 API 变更

| API | 变更内容 |
|-----|---------|
| `POST /api/auth/register/` | 注册后自动创建 UserProfile role=user |
| `GET /api/auth/me/` | 返回增加 `role`、`moderated_sections` 字段 |
| `POST /api/files/upload/` | 普通用户上传后 `review_status=pending`；上传者改为 FK |
| `GET /api/files/<id>/download/` | 需要登录；普通用户 & 访客禁止 |
| `GET /api/courses/<code>/files/` | 对非审核者隐藏 `pending`/`rejected` 文件 |
| `GET /api/stats/` | 只统计 `review_status=approved` 的文件 |

---

## 六、前端变更清单

### 6.1 新增页面/视图

| 视图 | 权限 | 说明 |
|------|------|------|
| **通知中心** (`/notifications`) | 登录用户 | 消息列表：审核结果、异议提醒；未读标记 + 一键已读 |
| **审核队列** (`/admin/review`) | 版主+ | 文件审核排队面板，可通过/驳回/提出异议 |
| **用户管理** (`/admin/users`) | 总管理员 | 用户列表、改角色、分配板块 |
| **分类管理** (`/admin/categories`) | 版主+ | 增删课程树节点 |
| **个人中心** (`/profile`) | 登录用户 | 上传历史 + 审核状态 |

### 6.2 现有 UI 改动

| 组件          | 变更                           |
| ----------- | ---------------------------- |
| 下载按钮        | 未登录不显示；普通用户超限置灰并提示        |
| 上传弹窗        | 普通用户上传后提示"待审核"               |
| 文件列表        | 审核中的文件对自己可见并标注状态             |
| Header 用户菜单 | 展开下拉菜单：通知中心（带未读数红点）、个人中心、退出；版主+额外显示"管理后台"入口 |
| 侧栏导航        | 版主+在底部显示"管理后台"分组（含审核队列、分类管理；总管理员额外+用户管理） |
| 搜索结果        | 不展示 `pending`/`rejected` 的文件 |

### 6.3 审核队列 UI 示意

```
┌─ 审核队列 ──────────────────────────────────────┐
│  板块筛选: [全部] [思想政治理论类] [体育与健康类] … │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │ 《民法总论笔记》 张三上传 → 经管学院-法学   │ │
│  │ 2026-07-08 14:30  ·  民法总论.pdf  ·  2.3MB  │ │
│  │ [查看详情]  [✅ 通过]  [❌ 驳回]  [⚠️ 异议]   │ │
│  └─────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────┐ │
│  │ 《高数复习提纲》 李四上传 → 数学类          │ │
│  │ ...                                         │ │
│  └─────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘

注：[⚠️ 异议] 按钮仅在该文件已被其他版主审核过时显示
```

---

## 七、实现顺序建议

分三个阶段实现，每阶段独立可部署。

### 阶段一：基础权限骨架 🔴

1. 创建 `UserProfile` 模型 + 数据迁移（含 `uploader` FK 迁移）
2. 用户注册时自动创建 profile
3. JWT payload 增加 role
4. 编写 `require_role` 装饰器（比 `require_login` 更细粒度）
5. 下载限制（需要登录）+ 每日限额计数器
6. API: `GET /api/auth/me/` 返回 role 信息
7. 前端统一报头添加用户菜单 + 未登录下载引导

### 阶段二：审核流程 + 通知系统 🔴

1. 普通用户上传后 `review_status=pending`
2. 审核队列 API + 前端面板（通过/驳回/异议）
3. `Notification` 模型 + 数据迁移
4. 审核通过/驳回时自动推送通知
5. 通知中心 API + 前端页面（未读数红点、一键已读）
6. 版主板块分配系统
7. 版主异议机制：异议按钮 → 推送通知 → 原审核人可撤销
8. 上传者在个人中心查看审核状态 + 被驳回文件的重新上传

### 阶段三：管理后台 🟡

1. 课程节点 CRUD API（版主层级限制）
2. 前端分类管理页面
3. 用户管理页面（总管理员）
4. 文件删除/编辑 API
5. 前端文件管理能力

---

## 八、注意事项

### 8.1 与现有架构的兼容

- `uploader_name` 字符串→FK 迁移需要处理存量数据。建议：
  1. 先新增 `uploader` FK 字段（nullable）
  2. 运行脚本：根据 `uploader_name` 匹配 User → 填入 `uploader`
  3. 下次大版本移除 `uploader_name`
- `is_approved` 布尔→`review_status` 枚举迁移同理：先新增字段并存，逐步切换

### 8.2 审核可见性规则

```
文件查询时:
  若当前用户是 uploader → 返回该文件（含 pending/rejected）
  若 review_status=approved → 返回（所有人可见）
  否则 → 不返回（隐藏）
```

### 8.3 版主覆盖能力

版主的非主责板块能力与主责板块**相同**——区别在于**推送优先级**和**UI 默认筛选**，而非真正的权限隔离。这样设计可以降低维护复杂度，同时通过 UI 引导形成"版主看自己的板块"的习惯。

---

## 九、开放问题（已确认）

### ✅ 已定：注册密码策略

> **问题：** 注册时是否允许用户自定义密码？密码怎么管理和恢复？

**决定：** 防接口满——只允许校内邮箱注册，但禁止用户自定义密码，防止用户使用校园系统同名密码。改为：

**注册流程：**
- 用户仅填写校内邮箱 + 昵称
- 系统自动生成 10 位随机高强度密码
- 注册成功弹窗顶部显示提示行：**"为了保护你的校内账号安全，本平台不使用你自定义的密码，已为你随机生成。如需更换，请前往个人中心更改。"**
- 弹窗显示密码 + "📋 复制密码"按钮
- 弹窗下方有复选框 **"我已妥善保存密码"**，不勾选则"知道了"按钮不可点击，弹窗不可关闭（包括 ✕ 按钮和背景点击）
- 勾选后按钮亮起，点击关闭

**修改密码：**
- 个人中心提供修改密码功能
- 修改表单上方显示醒目提示：**"请勿使用与校园网、数字京师等校内系统相同的密码"**
- 密码强度指示器
- 修改成功后重新登录

**密码重置 / 找回：**
- 提供"忘记密码"入口
- 通过注册邮箱发送密码重置链接（需配置 SMTP 邮件服务）
- Django 内置 `password_reset` 机制可用
- 推荐方案：使用 `bnusparks@163.com` 的 SMTP 服务发送

> **问题：** 驳回后用户是否能修改后重新提交？还是另开一个上传？

**决定：** 用户在个人中心 → 上传记录里看到被驳回的文件时，显示驳回原因，点击可展开，直接在文件列表行上展示"重新上传"按钮。

重新上传的交互：
1. 驳回的文件记录保留（`review_status=rejected`），作为历史凭证
2. 用户点击"重新上传" → 弹出上传弹窗，**自动填充原标题、描述、教师等信息**
3. 用户选择新文件 → 提交后，系统**创建一条全新的 Material 记录**（`review_status=pending`）
4. 新旧两条记录在 UI 上关联展示，旧记录标注"已驳回·已替换"

### ✅ 已定：版主操作冲突 & 异议机制

> **问题：** 版主之间操作冲突（A 通过、B 又驳回）怎么处理？

**决定：** 引入"异议"机制替代硬冲突：

**规则：**
- 第一个审批动作（通过或驳回）生效，改变 `review_status`
- 第二个版主在审核队列中打开该文件，会看到当前状态（如"已由张三通过"）以及一个**异议按钮**
- 点击异议 → 自动向原审核人推送一条 `disagree` 类型通知："李四对你的审核结果有异议"
- 异议不改变 `review_status`——文件保持已通过/已驳回状态不变
- 原审核人收到通知后，可以主动撤销自己的审核（改为相反状态）或与对方沟通
- 总管理员可以无视异议，直接强行改变审核状态

**不引入硬冲突的原因：**
- 如果异议导致状态反转，文件在"通过→驳回→通过"之间反复，对上传者体验极差
- 异议+通知的软机制保留决策链完整性的同时，允许人与人沟通解决分歧

### ✅ 已定：操作日志（AuditLog）

> **问题：** 是否需要操作日志？

**决定：** 需要。最初考虑用 Material 模型字段兜着（`reviewed_by`、`reviewed_at` 等），但加入**异议机制**后，以下动作无法被 Material 模型覆盖：

| 动作 | 为什么 Material 字段兜不住 |
|------|--------------------------|
| 版主提交异议 | 异议不改变 `review_status`，没有字段可写 |
| 原审核人撤销重审 | 需要记录"谁撤销了谁的决定" |
| 总管理员强行改状态 | 需要记录"管理员绕过常规流程" |
| 文件删除 | 记录没了，无从追溯 |
| 分类节点增删 | 不涉及 Material |
| 用户角色变更 | 不涉及 Material |

因此需要新增 `AuditLog` 模型：

```python
class AuditLog(models.Model):
    class Action(models.TextChoices):
        FILE_UPLOAD = "file_upload", "上传文件"
        FILE_DELETE = "file_delete", "删除文件"
        REVIEW_APPROVE = "review_approve", "审核通过"
        REVIEW_REJECT = "review_reject", "审核驳回"
        REVIEW_DISAGREE = "review_disagree", "提交异议"
        REVIEW_OVERRIDE = "review_override", "强制改审"
        REVIEW_REVOKE = "review_revoke", "撤销重审"
        CATEGORY_CREATE = "cat_create", "新建分类"
        CATEGORY_DELETE = "cat_delete", "删除分类"
        CATEGORY_EDIT = "cat_edit", "编辑分类"
        USER_ROLE_CHANGE = "user_role_change", "用户角色变更"

    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        verbose_name="操作人", related_name="audit_logs",
    )
    action = models.CharField("动作", max_length=30, choices=Action.choices)
    # 资源 FK —— AI / 代码可直接顺着关系查
    material = models.ForeignKey(
        Material, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="关联资料",
    )
    category = models.ForeignKey(
        CourseCategory, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="关联分类",
    )
    target_user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="关联用户", related_name="targeted_logs",
    )
    target_desc = models.CharField("目标简述", max_length=200, blank=True,
                                    help_text="资源删除后 FK 变为 null，此字段仍保留可读描述")
    detail = models.TextField("详细内容", blank=True)
    created_at = models.DateTimeField("操作时间", auto_now_add=True)

    class Meta:
        verbose_name = "操作日志"
        verbose_name_plural = "操作日志"
        ordering = ["-created_at"]
```

**设计说明：**
- 对主要资源类型（Material、CourseCategory、User）使用**直接 FK**，以便 AI/代码跨表查询
- 同时冗余存储 `target_desc`，即使资源被删除后 FK 变为 `null`，可读描述仍然保留
- 没有 FK 的次要操作（如用户角色变更）仅靠 `action` + `detail` 即可追溯

### ✅ 已定：点赞 / 点踩 / 举报

> **问题：** 已审核通过的文件，普通用户是否可以举报？

**决定：** 后续开发加入**点赞与点踩**机制，同时留一个**举报入口**。

**点赞 / 点踩：**
- 每个文件在下载量与下载按钮之间展示 👍 / 👎 计数
- 每个用户对同一文件只能投一次（可切换方向）
- 点赞和点踩的数量在文件列表和文件详情页展示
- 仅登录用户可操作，访客不可见
- 点踩多的文件可以在审核队列中标记提醒版主关注
- 移动端依旧折叠信息，防止内容溢出

**举报：**
- 文件详情页提供"举报"入口
- 用户点击举报 → 弹出表单：选择原因（侵权/虚假/无关/其他）+ 备注文字
- 提交后 → 自动向**所有版主 + 总管理员**推送一条 `report` 类型通知
- 举报不改变文件可见性，仅作为提醒信号
- 版主收到通知后，在审核队列的"被举报"筛选分类中查看，决定是否驳回或删除

**模型变更：**

```python
class MaterialReaction(models.Model):
    """点赞/点踩/举报"""
    class Type(models.TextChoices):
        LIKE = "like", "点赞"
        DISLIKE = "dislike", "点踩"
        REPORT = "report", "举报"

    user = models.ForeignKey(User, on_delete=models.CASCADE)
    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="reactions")
    type = models.CharField(max_length=10, choices=Type.choices)
    reason = models.TextField("举报原因", blank=True)  # 仅 report 时填写
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("user", "material")]  # 每人每文件只能有一种反应
```

**通知补充**（在 4.3 节 Notification 模型新增类型）：
```python
class Type(models.TextChoices):
    # ... 原有类型 ...
    REPORT_SUBMITTED = "report", "文件被举报"
```
- 触发条件：用户提交举报
- 接收人：所有版主 + 总管理员
- 内容模板："用户 {昵称} 举报了《{文件标题}》，原因：{举报原因}"

### ✅ 已定：上传课程范围

> **问题：** 普通用户上传时选择课程是否受限制？

**决定：** 不限制。任何注册用户都可以向任意课程上传资料，上传范围与用户在课程树中浏览到的课程一致。走审核流程制衡内容质量，而非用权限限制上传入口。
