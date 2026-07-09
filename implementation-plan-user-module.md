# 实施计划：用户模块构建

> 日期：2026-07-09
> 范围：用户角色体系、认证流程、个人中心、通知系统、管理后台
> 不涉及：文件在线预览、拖拽上传、批量操作等（见 [design-backlog-file-management.md](design-backlog-file-management.md)）

---

## 总览

三个迭代，每个可独立部署。

```
Iter 1 ▸ 权限骨架 + 认证闭环
  └─ UserProfile → JWT role → require_role → 注册改造
     → 修改密码 → 密码重置(邮件) → Header 用户菜单

Iter 2 ▸ 个人中心 + 通知系统
  └─ 个人中心页面 → 上传记录 → 通知模型 → 通知中心
     → 审核队列(基础) → 下载限额

Iter 3 ▸ 管理后台 + 版主系统
  └─ 用户管理 → 版主板块分配 → 审核全流程(含异议)
     → 操作日志 → AuditLog
```

---

## Iter 1：权限骨架 + 认证闭环

### 1.1 数据模型：UserProfile

**文件：** `materials/models.py`

```python
class UserProfile(models.Model):
    class Role(models.TextChoices):
        USER = "user", "普通用户"
        MODERATOR = "moderator", "版主"
        SUPER_ADMIN = "super_admin", "总管理员"

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.USER)
    moderated_sections = models.ManyToManyField(
        "CourseCategory", blank=True,
        verbose_name="主责板块",
    )
    daily_download_count = models.IntegerField("今日已下载", default=0)
    last_download_date = models.DateField("最后下载日期", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

- `daily_download_count` + `last_download_date` 用于每日限额计数（零点自动重置）
- 注册用户自动创建 `UserProfile(role=USER)`

### 1.2 数据迁移：Material 模型新增字段

**文件：** `materials/models.py`

在 Material 模型中新增（不改原名，保留向后兼容）：

```python
uploader = models.ForeignKey(
    User, on_delete=models.SET_NULL, null=True, blank=True,
    verbose_name="上传者", related_name="uploads",
)
review_status = models.CharField(
    max_length=20,
    choices=[("pending","待审核"), ("approved","已通过"), ("rejected","已驳回")],
    default="approved",  # 存量数据默认为已通过
)
review_notes = models.TextField("审核备注", blank=True)
reviewed_by = models.ForeignKey(
    User, on_delete=models.SET_NULL, null=True, blank=True,
    verbose_name="审核人", related_name="reviews",
)
reviewed_at = models.DateTimeField(null=True, blank=True)
```

> 注意：`review_status` 默认值设为 `"approved"` 而不是 `"pending"`——这样现有存量数据不受影响，新上传才走审核流程。

### 1.3 JWT Payload 扩展

**文件：** `materials/views.py`

`_jwt_encode()` 的 payload 增加 `role`：

```python
payload = {
    "user_id": user.id,
    "role": user.profile.role,     # 新增
    "exp": time.time() + 7 * 86400,
}
```

`_get_user()` 解析后从 token 的 role 字段直接返回，不必每次查数据库。

### 1.4 require_role 装饰器

**文件：** `materials/views.py`

```python
def require_role(*roles):
    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            user = _get_user(request)
            if user is None:
                return _err("请先登录", 401)
            if not hasattr(user, 'profile'):
                return _err("用户资料不完整", 500)
            if user.profile.role not in roles and not user.is_superuser:
                return _err("权限不足", 403)
            request.user = user
            return view(request, *args, **kwargs)
        return wrapper
    return decorator
```

用法：`@require_role("moderator", "super_admin")`

保留现有 `@require_login` 作为快捷别名（等价于不限制角色的 require_role）。

### 1.5 注册改造：强制保存密码

**文件：** `materials/views.py` + `public/index.html` + `public/js/app.js`

后端改动：
- 注册 API 增加自动创建 UserProfile
- 返回数据增加临时标识，让前端弹出强制定制弹窗

前端改动（`public/index.html` 注册弹窗）：
- 注册成功后替换当前弹窗内容为"密码展示"面板
- 面板包含：安全提示行、密码展示、复制按钮、复选框"我已妥善保存密码"
- 复选框不勾选 → "知道了"按钮不可点击，弹窗不可关闭
- 注册弹窗外部点击和 ✕ 按钮在成功状态下全部禁用

### 1.6 修改密码 API + 页面

**新增 API：** `POST /api/auth/change-password/`

```python
@csrf_exempt
@require_login
def api_change_password(request):
    """POST /api/auth/change-password/"""
    body = json.loads(request.body)
    old_password = body.get("old_password")
    new_password = body.get("new_password")
    # 验证旧密码
    if not request.user.check_password(old_password):
        return _err("当前密码错误")
    # 设置新密码
    request.user.set_password(new_password)
    request.user.save()
    return _ok({"message": "密码已修改"})
```

**路由：** `materials/urls.py` 新增 `path("auth/change-password/", views.api_change_password)`

**前端：** 个人中心页面（Iter 2 实现）中提供修改密码表单，上方显示安全提示。

### 1.7 密码重置（忘记密码）

**新增 API：** `POST /api/auth/forgot-password/` + `POST /api/auth/reset-password/`

```python
@csrf_exempt
def api_forgot_password(request):
    """发送密码重置邮件"""
    email = json.loads(request.body).get("email", "").strip().lower()
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return _ok({"message": "如果该邮箱已注册，重置链接已发送"})  # 不暴露邮箱是否存在

    token = default_token_generator.make_token(user)
    link = f"https://bnu.icu/reset-password/?uid={user.id}&token={token}"
    send_mail(
        "BNU Sparks 密码重置",
        f"点击链接重置密码（30分钟内有效）：{link}",
        "bnusparks@163.com",
        [email],
    )
    return _ok({"message": "重置链接已发送到你的邮箱"})
```

> 邮件配置已在 `settings.py` 中完成（163 SMTP + .env 授权码），直接可用。

**路由新增：**
```python
path("auth/forgot-password/", views.api_forgot_password),
path("auth/reset-password/", views.api_reset_password),
```

**前端：** 登录弹窗加"忘记密码？"链接 → 跳转到一个输入邮箱的表单 → 提交后显示"已发送"

### 1.8 GET /api/auth/me/ 增强

增加返回字段：`role`、`moderated_sections`、`daily_download_remaining`

### 1.9 Header 用户下拉菜单

**文件：** `public/index.html` + `public/css/style.css` + `public/js/app.js`

将现有 header 右侧的单一"登录/昵称"按钮改为下拉菜单：

```
未登录状态:
  [登录]  → 弹出登录弹窗（不变）

已登录状态:
  [🔔 3] [👤 张三 ▼]
            ├─ 个人中心
            ├─ 通知中心
            ├─ ─────────
            ├─ 管理后台  (版主+才显示)
            └─ 退出登录
```

CSS：下拉菜单使用绝对定位，与 header 设计语言一致（半透明毛玻璃）

---

## Iter 2：个人中心 + 通知系统

### 2.1 个人中心页面

**新增前端视图：** `public/index.html` 新增 `<div id="profileView">`

页面包含：
- 用户基本信息：头像（占位）、昵称、邮箱、角色、注册日期
- **用户贡献统计：** "你是第 N 个注册用户 · 共上传 X 份资料 · 通过审核 X 份"
- 修改密码表单（含安全提示）
- 上传记录列表：表格，每行显示标题、课程、审核状态、上传日期、操作
  - 状态标签：🟡 待审核 / ✅ 已通过 / ❌ 已驳回（显示原因）
  - 已驳回 → 行内显示"重新上传"按钮

**后端 API 补充：** `GET /api/user/profile/`

```python
@require_login
def api_user_profile(request):
    user = request.user
    total_uploads = Material.objects.filter(uploader=user).count()
    approved = Material.objects.filter(uploader=user, review_status="approved").count()
    user_count = User.objects.count()
    return _ok({
        "nickname": user.first_name or user.username,
        "email": user.email,
        "role": user.profile.role,
        "moderated_sections": [...],
        "registered_at": user.date_joined,
        "user_rank": user.id,           # 注册序号
        "total_users": user_count,
        "total_uploads": total_uploads,
        "approved_uploads": approved,
        "daily_download_remaining": ..., # 今日剩余下载次数
    })
```

### 2.2 通知模型 + API

**模型**（`materials/models.py`，已在需求文档中定义，直接实现）：
- `Notification`：recipient, type, title, message, is_read, material, triggered_by, created_at

**API：**
```python
GET    /api/user/notifications/             → 通知列表，支持 ?unread_only=1
PATCH  /api/user/notifications/<id>/read/   → 标记已读
POST   /api/user/notifications/read-all/    → 全部已读
GET    /api/user/notifications/unread-count/ → 未读数（给 Header 小红点用）
```

### 2.3 通知中心页面

**新增前端视图：** `<div id="notificationsView">`

列表展示通知，按时间倒序：
```
┌─ 通知中心 ───────────────────────────┐
│  [全部已读]                          │
│                                       │
│  ● 2026-07-09 14:30                  │  ← ● = 未读
│  你的资料《民法总论笔记》已通过审核    │
│                                       │
│  ● 2026-07-09 13:00                  │
│  李四对你在「xxx」的审核结果有异议    │
│  [查看详情]                          │
│                                       │
│  ○ 2026-07-08 10:00                  │  ← ○ = 已读
│  ...                                 │
└───────────────────────────────────────┘
```

### 2.4 下载限额实现

**后端逻辑**（在 `api_file_download` 中实现）：

```python
@require_login
def api_file_download(request, file_id):
    user = request.user
    profile = user.profile

    # 仅普通用户受限额
    if profile.role == "user":
        today = date.today()
        if profile.last_download_date != today:
            profile.daily_download_count = 0
            profile.last_download_date = today
        if profile.daily_download_count >= 60:
            return _err("今日下载次数已达上限", 429)
        profile.daily_download_count += 1
        profile.save()

    # ... 正常下载逻辑 ...
```

前端在下载前通过 `/api/auth/me/` 返回的 `daily_download_remaining` 判断：
- 0-20 次：正常显示下载按钮
- 21-60 次：点击下载前弹出提示弹窗
- 61+：按钮置灰，显示"今日已达上限"

### 2.5 上传状态改造

**后端：** `api_file_upload` 中，普通用户上传后 `review_status="pending"`，版主和总管理员仍为 `"approved"`

**前端：** 上传成功后弹窗提示改为：
- 普通用户 → "资料已提交，等待管理员审核"
- 版主/总管理员 → 当前不变

**文件列表可见性：** GET `/api/courses/<code>/files/` 过滤逻辑：
```python
# 当前请求用户
user = _get_user(request)
materials = Material.objects.filter(course=course)
if not user or user.profile.role == "user":
    # 普通用户/访客：只看已通过 + 自己的待审核
    materials = materials.filter(
        Q(review_status="approved") | Q(uploader=user)
    )
```

---

## Iter 3：管理后台 + 版主系统

### 3.1 审核队列页面

**新增前端视图：** `<div id="adminReviewView">`

布局：
```
┌─ 审核队列 ──────────────────────────────────────┐
│  筛选: [全部] [思想政治理论类] [体育与健康类] ... │
│                                                   │
│  ┌─ 待审核 ────────────────────────────────────┐ │
│  │ 《民法总论笔记》 · 张三 · 经管学院-法学      │ │
│  │ 2026-07-09 · 民法总论.pdf · 2.3MB            │ │
│  │ [查看详情] [✅ 通过] [❌ 驳回]               │ │
│  ├─────────────────────────────────────────────┤ │
│  │ ...                                          │ │
│  └──────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ 已处理 ────────────────────────────────────┐ │
│  │ 《xxx》 ✅ 已通过 — 由张三                   │ │
│  │ [⚠️ 异议]                                    │ │
│  └──────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

**后端 API：**
```
GET   /api/admin/review-queue/             → 待审核 + 已处理（分页）
POST  /api/admin/review/<id>/approve/      → 通过
POST  /api/admin/review/<id>/reject/       → 驳回（含原因）
POST  /api/admin/review/<id>/disagree/     → 异议 → 通知原审核人
```

### 3.2 用户管理页面

**新增前端视图：** `<div id="adminUsersView">`（仅总管理员可见）

- 用户列表：用户名、邮箱、角色、注册时间
- 操作：修改角色（user/moderator/super_admin）
- 分配版主板块：选择该版主负责的一级 CourseCategory 节点

**后端 API：**
```
GET   /api/admin/users/                    → 用户列表
PATCH /api/admin/users/<id>/role/          → 改角色
POST  /api/admin/users/<id>/sections/       → 分配板块
```

### 3.3 AuditLog 操作日志

**模型**（`materials/models.py`，已在需求文档中定义，直接实现）：

在所有审核/管理操作中埋点：
```python
AuditLog.objects.create(
    user=request.user,
    action="review_approve",
    material=material,
    target_desc=f"通过了《{material.title}》的审核",
)
```

### 3.4 侧栏管理后台入口

版主/总管理员登录后，侧栏底部显示展开分组：

```
管理后台 ▼
  ├─ 审核队列
  ├─ 分类管理     (总管理员可见全部，版主可见二级+)
  └─ 用户管理     (仅总管理员)
```

---

## 文件修改清单

### 后端

| 文件 | 改动内容 |
|------|---------|
| `materials/models.py` | 新增 UserProfile、Notification、AuditLog 模型；Material 新增字段 |
| `materials/views.py` | JWT 扩展；require_role 装饰器；注册自动创建 profile；修改密码；忘记密码；个人中心 API；通知 API；审核 API；用户管理 API；下载限额 |
| `materials/urls.py` | 新增所有 API 路由 |
| `bnusparks/settings.py` | 已配好邮件（完成） |
| `materials/admin.py` | 注册 UserProfile、Notification 到 Django Admin |

### 前端

| 文件 | 改动内容 |
|------|---------|
| `public/index.html` | 注册弹窗改造（强制保存密码）；个人中心视图；通知中心视图；审核队列视图；用户管理视图；Header 下拉菜单；"忘记密码"入口 |
| `public/js/app.js` | 注册交互流程；用户菜单交互；个人中心逻辑；通知中心逻辑；审核队列逻辑；下载限额前端判断 |
| `public/css/style.css` | 下拉菜单样式；个人中心样式；通知列表样式；审核队列样式；管理后台样式 |

### 数据迁移

```bash
python manage.py makemigrations
python manage.py migrate
```

---

## 预计工作量（粗略）

| 迭代 | 后端代码 | 前端代码 | 依赖条件 |
|------|---------|---------|---------|
| Iter 1 | 模型定义 + 迁移 + 7个 API | 注册弹窗改造 + Header 菜单 | 无 |
| Iter 2 | 4个 API + 通知自动推送 | 个人中心 + 通知中心页面 | Iter 1 |
| Iter 3 | 6个 API + AuditLog 埋点 | 审核队列 + 用户管理页面 | Iter 1 + 2 |

每个 Iter 可以独立部署，Iter 1 完成后即可上线基础认证改造，Iter 2 上线个人中心，Iter 3 上线管理后台。
