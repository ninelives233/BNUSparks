from django.db import models
from django.db.models import Q
from django.core.validators import FileExtensionValidator
from django.contrib.auth.models import User


class UserProfile(models.Model):
    class Role(models.TextChoices):
        USER = "user", "普通用户"
        SUB_MODERATOR = "sub_moderator", "小版主"
        MODERATOR = "moderator", "版主"
        SUPER_ADMIN = "super_admin", "总管理员"

    class EducationLevel(models.TextChoices):
        UNDERGRADUATE = "本科", "本科"
        MASTER = "硕士", "硕士"
        DOCTOR = "博士", "博士"
        OTHER = "其他", "其他"

    class HomeLayout(models.TextChoices):
        LOOSE = "loose", "松散首页"
        COMPACT = "compact", "紧凑首页"

    class ColorTheme(models.TextChoices):
        WARM = "warm", "暖色"
        COOL = "cool", "冷色"
        DARK = "dark", "暗色"
        SYSTEM = "system", "跟随系统"

    class MobileNav(models.TextChoices):
        BOTTOM = "bottom", "底部导航"
        BURGER = "burger", "汉堡菜单"

    class DefaultView(models.TextChoices):
        HOME = "home", "首页"
        TIMETABLE = "timetable", "我的课程"

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.USER)
    moderated_sections = models.ManyToManyField(
        "CourseCategory", blank=True,
        verbose_name="主责板块",
    )
    managed_majors = models.ManyToManyField(
        "College", blank=True,
        verbose_name="管辖专业",
        help_text="小版主仅管理这些专业（学院）对应的课程资料审核",
    )
    can_moderate_general = models.BooleanField("可审核通识课", default=False)
    can_moderate_qa = models.BooleanField("可审核问答区", default=False)
    auto_approve = models.BooleanField("自动托管审核", default=False,
        help_text="开启后自动通过管辖板块内所有新上传的资料")
    can_auto_approve = models.BooleanField("允许自动托管", default=False,
        help_text="总管理员设置：该用户是否可以开启自动托管")
    daily_download_count = models.IntegerField("今日已下载", default=0)
    last_download_date = models.DateField("最后下载日期", null=True, blank=True)
    daily_report_count = models.IntegerField("今日已举报", default=0)
    last_report_date = models.DateField("最后举报日期", null=True, blank=True)
    avatar = models.ImageField("头像", upload_to="avatars/", blank=True, null=True)
    token_version = models.IntegerField("JWT 令牌版本", default=0,
        help_text="改密/重置后 +1，使旧 JWT 立即失效（P2.5）")

    # 公开资料字段（Iter 7）
    contact_email = models.EmailField("联系邮箱", blank=True, default="")
    contact_way = models.CharField("联系方式", max_length=200, blank=True, default="")
    bio = models.TextField("个人简介", max_length=200, blank=True, default="",
        help_text="200字以内")

    # 身份标签（培养层次 + 学院 + 专业）—— 学院/专业存名称而非 FK，避免课程树重建影响；
    # 空值只表示历史用户尚未补全，「其他」是可统计的真实选择。
    identity_education = models.CharField(
        "培养层次", max_length=10, choices=EducationLevel.choices, blank=True, default=""
    )
    identity_college = models.CharField("身份学院", max_length=100, blank=True, default="")
    identity_major = models.CharField("身份专业", max_length=100, blank=True, default="")
    show_education_public = models.BooleanField(
        "公开资料显示培养层次", default=True, help_text="默认公开，用户可手动关闭"
    )
    show_college_public = models.BooleanField(
        "公开资料显示学院", default=True, help_text="默认公开，用户可手动关闭"
    )
    show_major_public = models.BooleanField(
        "公开资料显示专业", default=True, help_text="默认公开，用户可手动关闭"
    )
    identity_updated_at = models.DateTimeField("身份最近修改时间", null=True, blank=True)

    # 空值表示历史用户尚未主动设置，接口层回退到松散首页＋暖色＋首页入口。
    home_layout = models.CharField(
        "首页布局", max_length=10, choices=HomeLayout.choices,
        blank=True, default="",
    )
    color_theme = models.CharField(
        "色彩主题", max_length=10, choices=ColorTheme.choices,
        blank=True, default="",
    )
    mobile_nav = models.CharField(
        "移动端导航方式", max_length=10, choices=MobileNav.choices,
        blank=True, default="",
    )
    default_view = models.CharField(
        "打开时进入", max_length=10, choices=DefaultView.choices,
        blank=True, default="",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "用户资料"
        verbose_name_plural = "用户资料"

    def __str__(self):
        return f"{self.user.username} ({self.get_role_display()})"


class College(models.Model):
    name = models.CharField("学院名称", max_length=100)
    short_name = models.CharField("简称", max_length=20, blank=True)
    slug = models.SlugField("URL标识", max_length=100, unique=True)
    description = models.TextField("描述", blank=True)
    order = models.IntegerField("排序", default=0)

    class Meta:
        verbose_name = "学院"
        verbose_name_plural = "学院"
        ordering = ["order", "id"]

    def __str__(self):
        return self.short_name or self.name


class CourseType(models.TextChoices):
    GENERAL = "general", "通识课"
    MAJOR = "major", "专业课"


class Course(models.Model):
    college = models.ForeignKey(
        College, on_delete=models.CASCADE,
        verbose_name="所属学院", null=True, blank=True,
        help_text="通识课无需选择学院",
    )
    name = models.CharField("课程名称", max_length=200)
    code = models.CharField("课程代码", max_length=50, blank=True)
    course_type = models.CharField(
        "课程类型", max_length=10,
        choices=CourseType.choices,
        default=CourseType.MAJOR,
    )
    description = models.TextField("课程简介", blank=True)
    # 同名同位不同码合并：别名课程指向主课程（资料目录、文件列表均跟随主课程）
    merged_into = models.ForeignKey(
        "self", on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="merged_courses",
        verbose_name="同名合并至",
        help_text="非空表示本课程是同名课程的别名代码，展示时与主课程合并",
    )
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    material_count = models.IntegerField("资料数", default=0)

    class Meta:
        verbose_name = "课程"
        verbose_name_plural = "课程"
        ordering = ["-course_type", "college", "name"]

    def __str__(self):
        prefix = ""
        if self.course_type == CourseType.GENERAL:
            prefix = "[通识] "
        elif self.college:
            prefix = f"[{self.college.short_name or self.college.name}] "
        return f"{prefix}{self.name}"


class MaterialType(models.Model):
    name = models.CharField("类型名称", max_length=50)
    slug = models.SlugField("URL标识", max_length=50, unique=True)
    icon = models.CharField("图标", max_length=20, blank=True, default="📄")

    class Meta:
        verbose_name = "资料类型"
        verbose_name_plural = "资料类型"
        ordering = ["id"]

    def __str__(self):
        return f"{self.icon} {self.name}"


class Material(models.Model):
    course = models.ForeignKey(
        Course, on_delete=models.CASCADE, null=True, blank=True,
        verbose_name="所属课程", related_name="materials",
        help_text="新建课程申请随附文件在申请批准前为 NULL",
    )
    title = models.CharField("资料标题", max_length=200)
    teacher = models.CharField("任课教师", max_length=100, blank=True)
    material_type = models.ForeignKey(
        MaterialType, on_delete=models.SET_NULL,
        verbose_name="资料类型", null=True,
    )
    description = models.TextField("描述", blank=True)
    file_name = models.CharField("原始文件名", max_length=255, blank=True)
    file_path = models.CharField("存储路径", max_length=500, blank=True,
                                 help_text="相对于 data/materials/ 的路径")
    file_size = models.IntegerField("文件大小(字节)", default=0)
    file_type = models.CharField("文件类型", max_length=20, blank=True,
                                 help_text="pdf/docx/pptx 等")
    uploader_name = models.CharField("上传者昵称", max_length=50, blank=True)
    download_count = models.IntegerField("下载次数", default=0)
    is_approved = models.BooleanField("已审核", default=True)

    # ── 用户模块扩展字段 ──
    uploader = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="上传者", related_name="uploads",
    )
    assigned_moderator = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="指派审核人", related_name="assigned_reviews",
        help_text="总管理员手动指派，覆盖自动路由。null=按规则路由",
    )
    review_status = models.CharField(
        max_length=20,
        choices=[("pending", "待审核"), ("approved", "已通过"), ("rejected", "已驳回")],
        default="approved",
        verbose_name="审核状态",
    )
    review_notes = models.TextField("审核备注", blank=True)
    reviewed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="审核人", related_name="reviews",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    # 新建课程申请随附文件（course 在申请批准前为 NULL）
    creation_request = models.ForeignKey(
        "CourseCreationRequest", on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="新建课程申请", related_name="materials",
    )

    created_at = models.DateTimeField("上传时间", auto_now_add=True)

    # ── 目录置顶（管理模式可置顶，默认视图置顶优先）──
    is_pinned = models.BooleanField("置顶", default=False)
    pinned_at = models.DateTimeField("置顶时间", null=True, blank=True)

    class Meta:
        verbose_name = "资料"
        verbose_name_plural = "资料"
        ordering = ["-is_pinned", "-created_at"]

    def __str__(self):
        return self.title


class FolderOperation(models.Model):
    """文件夹操作记录——供管理员追溯"""
    class Action(models.TextChoices):
        CREATE = "create", "创建"
        DELETE = "delete", "删除"

    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, verbose_name="操作人")
    action = models.CharField("操作类型", max_length=10, choices=Action.choices)
    category_id = models.IntegerField("文件夹ID", default=0)
    category_name = models.CharField("文件夹名称", max_length=200, blank=True)
    parent_path = models.CharField("路径", max_length=500, blank=True, help_text="父节点名称序列，用 / 分隔")
    folder_type = models.CharField("文件夹类型", max_length=10, blank=True, default="",
                                    help_text="normal=普通文件夹 leaf=底层文件夹")
    reason = models.TextField("操作理由", blank=True, default="")
    is_restored = models.BooleanField("已撤销", default=False)
    restored_at = models.DateTimeField("撤销时间", null=True, blank=True)
    restored_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                     verbose_name="撤销人", related_name="restored_operations")
    created_at = models.DateTimeField("操作时间", auto_now_add=True)

    class Meta:
        verbose_name = "文件夹操作"
        verbose_name_plural = "文件夹操作"
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.get_action_display()}] {self.category_name} by {self.user}"


class CourseCategory(models.Model):
    """导航树节点 — 自引用无限层级"""
    name = models.CharField("节点名称", max_length=200, blank=True)
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE,
        related_name="children", verbose_name="父节点",
    )
    icon_class = models.CharField("图标类名", max_length=50, blank=True)
    order = models.IntegerField("排序", default=0)
    is_divider = models.BooleanField("分隔线", default=False)
    is_math_card = models.BooleanField("数学卡片", default=False)
    is_third_row = models.BooleanField("第三行特排卡片", default=False)

    # 叶子节点：要么关联实际课程
    course = models.ForeignKey(
        Course, null=True, blank=True, on_delete=models.SET_NULL,
        verbose_name="关联课程",
    )
    # 要么是通配符代码（如 "GEN02***"）
    course_text = models.CharField("通配课程代码", max_length=50, blank=True)

    class Meta:
        verbose_name = "课程导航节点"
        verbose_name_plural = "课程导航节点"
        ordering = ["order"]

    def __str__(self):
        if self.is_divider:
            return "─── 分隔线 ───"
        return self.name or f"<节点 #{self.id}>"


class Notification(models.Model):
    class Type(models.TextChoices):
        APPROVED = "approved", "审核通过"
        REJECTED = "rejected", "审核驳回"
        DISAGREE = "disagree", "审核异议"
        REPORT = "report", "举报通知"
        FILE_DELETED = "file_deleted", "用户删除资料"
        OPERATION = "operation", "操作通知"
        ANNOUNCEMENT = "announcement", "系统公告"
        NEW_PENDING = "new_pending", "新待审核"
        REPORT_ALERT = "report_alert", "新举报待处理"
        REPORT_RESULT = "report_result", "举报处理结果"
        REPORT_ESCALATED = "report_escalated", "举报已升级"
        REPORT_MALICIOUS = "report_malicious", "恶意举报提醒"
        MERGE_ALERT = "merge_alert", "同名课程合并待复核"
        FEEDBACK = "feedback", "意见反馈"

    recipient = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="notifications",
        verbose_name="接收人",
    )
    type = models.CharField(max_length=20, choices=Type.choices, verbose_name="通知类型")
    title = models.CharField("标题", max_length=200)
    message = models.TextField("消息内容", blank=True)
    is_read = models.BooleanField("已读", default=False)
    material = models.ForeignKey(
        Material, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="关联资料",
    )
    course_code = models.CharField("课程代码", max_length=50, blank=True, help_text="通知创建时冗余存储，material 删除后仍可导航")
    course_name = models.CharField("课程名称", max_length=200, blank=True)
    triggered_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="触发人", related_name="triggered_notifications",
    )
    created_at = models.DateTimeField("创建时间", auto_now_add=True)

    class Meta:
        verbose_name = "通知"
        verbose_name_plural = "通知"
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.get_type_display()}] {self.title}"


class DeletionRecord(models.Model):
    """已删除资料的存档记录——供管理员追溯"""
    material_id = models.IntegerField("原资料ID")
    title = models.CharField("标题", max_length=200)
    file_name = models.CharField("文件名", max_length=500)
    file_size = models.BigIntegerField("文件大小", default=0)
    course_code = models.CharField("课程代码", max_length=50)
    course_name = models.CharField("课程名称", max_length=200)
    uploader_name = models.CharField("上传者", max_length=150)
    college_id = models.IntegerField("所属学院ID", null=True, blank=True, default=None,
                                      help_text="冗余字段，用于管理员按管辖范围过滤删除记录")
    deleted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, verbose_name="删除人")
    deleted_at = models.DateTimeField("删除时间", auto_now_add=True)
    delete_reason = models.TextField("删除理由", blank=True, default="")
    trash_path = models.CharField("暂存路径", max_length=500, blank=True, default="",
                                  help_text="软删除时物理文件移入 data/trash/ 的相对路径（MEDIA_ROOT 相对）；空表示当时文件已不存在。48h 内可据此恢复。")
    is_restored = models.BooleanField("已恢复", default=False)
    restored_at = models.DateTimeField("恢复时间", null=True, blank=True)
    restored_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                     verbose_name="恢复人", related_name="restored_deletions")

    class Meta:
        verbose_name = "删除记录"
        verbose_name_plural = "删除记录"
        ordering = ["-deleted_at"]

    def __str__(self):
        return f"[删除] {self.title} by {self.deleted_by}"


class ReviewComment(models.Model):
    """审核异议/评论——同一条待审核资料的可被多方看到时的讨论"""
    material = models.ForeignKey(
        Material, on_delete=models.CASCADE, related_name="review_comments",
        verbose_name="关联资料",
    )
    commenter = models.ForeignKey(
        User, on_delete=models.CASCADE, verbose_name="评论者",
    )
    content = models.TextField("异议内容")
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE,
        related_name="replies", verbose_name="父评论",
    )
    created_at = models.DateTimeField("创建时间", auto_now_add=True)

    class Meta:
        verbose_name = "审核评论"
        verbose_name_plural = "审核评论"
        ordering = ["created_at"]

    def __str__(self):
        return f"[{self.commenter.first_name or self.commenter.username}] {self.content[:40]}"


class Announcement(models.Model):
    """系统公告——可动态发布、删除"""
    title = models.CharField("公告标题", max_length=200)
    content = models.TextField("公告内容")
    publisher = models.ForeignKey(User, on_delete=models.CASCADE, verbose_name="发布者")
    is_published = models.BooleanField("已发布", default=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)

    class Meta:
        verbose_name = "系统公告"
        verbose_name_plural = "系统公告"
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class CampusLink(models.Model):
    """全站共享的校园外部快捷入口，由总管理员维护。"""

    name = models.CharField("入口名称", max_length=40)
    url = models.URLField("网址", max_length=500)
    order = models.PositiveIntegerField("排序", default=0)
    is_enabled = models.BooleanField("启用", default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "校园快捷入口"
        verbose_name_plural = "校园快捷入口"
        ordering = ["order", "id"]

    def __str__(self):
        return self.name


class Favorite(models.Model):
    """收藏——用户收藏的资料"""
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="favorites",
        verbose_name="收藏用户",
    )
    material = models.ForeignKey(
        Material, on_delete=models.CASCADE, related_name="favorited_by",
        verbose_name="收藏的资料",
    )
    created_at = models.DateTimeField("收藏时间", auto_now_add=True)

    class Meta:
        verbose_name = "收藏"
        verbose_name_plural = "收藏"
        ordering = ["-created_at"]
        unique_together = ["user", "material"]

    def __str__(self):
        return f"{self.user.username} → {self.material.title}"


class DownloadRecord(models.Model):
    """文件访问留痕——区分正式下载、预览与迁移前旧记录。"""

    class ActivityType(models.TextChoices):
        LEGACY = "legacy", "旧下载记录"
        DOWNLOAD = "download", "下载"
        PREVIEW = "preview", "预览"
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="download_records",
        verbose_name="下载用户",
    )
    material = models.ForeignKey(
        Material, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="关联资料",
        help_text="资料删除后保留下载快照，material 置空",
    )
    course_code = models.CharField("课程代码", max_length=50, blank=True)
    course_name = models.CharField("课程名称", max_length=200, blank=True)
    material_title = models.CharField("资料标题", max_length=200, blank=True)
    file_name = models.CharField("文件名", max_length=255, blank=True)
    activity_type = models.CharField(
        "行为类型", max_length=12, choices=ActivityType.choices,
        default=ActivityType.LEGACY,
    )
    request_id = models.CharField(
        "行为请求编号", max_length=64, null=True, blank=True, unique=True,
        help_text="同一短时下载令牌重复请求时用于幂等去重",
    )
    created_at = models.DateTimeField("下载时间", auto_now_add=True)

    class Meta:
        verbose_name = "下载记录"
        verbose_name_plural = "下载记录"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} → {self.material_title}"


class DownloadQuotaReservation(models.Model):
    """普通用户每日不同资料配额占位；唯一约束负责并发去重。"""
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    material = models.ForeignKey(Material, on_delete=models.CASCADE)
    quota_date = models.DateField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "material", "quota_date"],
                name="uniq_download_quota_user_material_date",
            ),
        ]


class CourseCreationRequest(models.Model):
    """新建课程申请——用户申请创建新课程，管理员审批后在目标位置创建课程文件夹"""
    class Type(models.TextChoices):
        GENERAL = "general", "通识课"
        MAJOR = "major", "专业课"

    class Status(models.TextChoices):
        PENDING = "pending", "待审核"
        APPROVED = "approved", "已通过"
        REJECTED = "rejected", "已驳回"

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="course_requests",
        verbose_name="申请人",
    )
    course_type = models.CharField("课程类型", max_length=10, choices=Type.choices)
    course_name = models.CharField("课程名称", max_length=200)
    course_code = models.CharField("课程代码", max_length=50, blank=True)
    college = models.ForeignKey(
        College, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="学院", related_name="+",
    )
    # 专业课：目标父节点（用户在课程树中选定的层级）
    target_category = models.ForeignKey(
        CourseCategory, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="目标父节点", related_name="+",
    )
    # 通识课：所选通识分类
    general_category = models.ForeignKey(
        CourseCategory, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="通识分类", related_name="+",
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING,
        verbose_name="审核状态",
    )
    auto_approved = models.BooleanField(
        default=False, verbose_name="管理员辖区内自动通过",
        help_text="申请人在自己辖区内提交时直接创建课程文件夹，无需人工审核",
    )
    assigned_moderator = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="指派审核人", related_name="+",
        help_text="按审核路由原则自动指派；null=未指派（仅总管理员可见）",
    )
    reviewed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name="审核人", related_name="+",
    )
    reviewed_at = models.DateTimeField("审核时间", null=True, blank=True)
    review_notes = models.TextField("审核备注", blank=True)
    created_at = models.DateTimeField("申请时间", auto_now_add=True)

    class Meta:
        verbose_name = "新建课程申请"
        verbose_name_plural = "新建课程申请"
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.get_course_type_display()}] {self.course_name} by {self.user}"


class CourseFavorite(models.Model):
    """收藏——用户收藏的课程（叶子课程节点，与资料收藏 Favorite 并列）"""
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="course_favorites",
        verbose_name="收藏用户",
    )
    course = models.ForeignKey(
        Course, on_delete=models.CASCADE, related_name="favorited_by",
        verbose_name="收藏的课程",
    )
    created_at = models.DateTimeField("收藏时间", auto_now_add=True)

    class Meta:
        verbose_name = "课程收藏"
        verbose_name_plural = "课程收藏"
        ordering = ["-created_at"]
        unique_together = ["user", "course"]

    def __str__(self):
        return f"{self.user.username} → {self.course.name}"


class Report(models.Model):
    """资料 / 连带用户举报

    material-kind：举报资料；user-kind：连带举报上传者（与资料举报同次提交产生）。
    FK 全部 SET_NULL + 冗余字段：材料/用户删除后举报记录仍可追溯展示。
    candidates M2M 创建时按审核路由计算，举报受理按此过滤；升级时重设为全部总管理员。
    """

    class Kind(models.TextChoices):
        MATERIAL = "material", "资料举报"
        USER = "user", "连带举报用户"
        # v183：问答区举报（复用本模型，受理走问答区版主）
        QUESTION = "question", "问题举报"
        ANSWER = "answer", "回答举报"

    class Status(models.TextChoices):
        PENDING = "pending", "待处理"
        HANDLED = "handled", "已处理"
        ESCALATED = "escalated", "已升级"  # 仅连带举报（属实=是，转发总管理）

    class Action(models.TextChoices):
        DELETE = "delete", "删除"
        KEEP = "keep", "保留"

    kind = models.CharField("举报类型", max_length=10, choices=Kind.choices, default=Kind.MATERIAL)
    # 被举报对象（material-kind 有 material，user-kind 有 target_user；
    # v183 question-kind 有 qa_question，answer-kind 有 qa_answer）
    material = models.ForeignKey(
        Material, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reports", verbose_name="被举报资料",
    )
    material_pk = models.IntegerField("被举报资料ID", null=True, blank=True,
        help_text="冗余：材料删除后 FK 置空，此字段保留原始 ID 供聚合/删除联动判断")
    target_user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reported", verbose_name="被连带举报用户",
    )
    qa_question = models.ForeignKey(
        "QaQuestion", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reports", verbose_name="被举报问题",
    )
    qa_question_pk = models.IntegerField("被举报问题ID", null=True, blank=True,
        help_text="冗余：问题删除后 FK 置空，此字段保留原始 ID 供聚合/处理定位")
    qa_answer = models.ForeignKey(
        "QaAnswer", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reports", verbose_name="被举报回答",
    )
    qa_answer_pk = models.IntegerField("被举报回答ID", null=True, blank=True,
        help_text="冗余：回答删除后 FK 置空，此字段保留原始 ID 供聚合/处理定位")
    qa_question_title = models.CharField("问题标题", max_length=200, blank=True,
        help_text="冗余：问答区举报记被举报问题标题（回答举报记父问题标题），FK 失效后仍可读")
    # 举报内容
    reporter = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reports_submitted", verbose_name="举报人",
    )
    reporter_name = models.CharField("举报人昵称", max_length=50, blank=True)
    reasons = models.JSONField("举报原因", default=list, blank=True)  # code 列表
    detail = models.TextField("详细说明", blank=True, default="")
    # 冗余字段（FK 失效后记录仍可读）
    material_title = models.CharField("资料标题", max_length=200, blank=True)
    course_code = models.CharField("课程代码", max_length=50, blank=True)
    course_name = models.CharField("课程名称", max_length=200, blank=True)
    target_user_name = models.CharField("被举报用户昵称", max_length=50, blank=True)
    # 受理候选人（创建时按审核路由计算；升级时重设为全部总管理员）
    candidates = models.ManyToManyField(
        User, related_name="report_candidates", blank=True, verbose_name="受理候选人",
        help_text="举报受理/作用域过滤依据；升级（连带属实）后重设为全部总管理员",
    )
    created_at = models.DateTimeField("举报时间", auto_now_add=True)
    # 处理结果
    status = models.CharField("状态", max_length=10, choices=Status.choices, default=Status.PENDING)
    is_true = models.BooleanField("属实", null=True, blank=True)
    actual_situation = models.TextField("实际情况/保留原因", blank=True, default="")
    action = models.CharField("处理方式", max_length=10, choices=Action.choices, null=True, blank=True)
    allow_retry = models.BooleanField("允许重新上传", null=True, blank=True)
    is_malicious = models.BooleanField("恶意举报", null=True, blank=True)
    handled_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="handled_reports", verbose_name="处理人",
    )
    handled_at = models.DateTimeField("处理时间", null=True, blank=True)

    class Meta:
        verbose_name = "举报"
        verbose_name_plural = "举报"
        ordering = ["-created_at"]
        constraints = [
            # 同一用户同一资料只报一次；连带举报按被举报用户防重复；
            # v183 问答区举报：同一用户对同一问题/回答只报一次
            models.UniqueConstraint(
                fields=["reporter", "material"], condition=Q(kind="material"),
                name="uniq_material_report",
            ),
            models.UniqueConstraint(
                fields=["reporter", "target_user"], condition=Q(kind="user"),
                name="uniq_user_report",
            ),
            models.UniqueConstraint(
                fields=["reporter", "qa_question"], condition=Q(kind="question"),
                name="uniq_qa_question_report",
            ),
            models.UniqueConstraint(
                fields=["reporter", "qa_answer"], condition=Q(kind="answer"),
                name="uniq_qa_answer_report",
            ),
        ]

    def __str__(self):
        if self.kind == self.Kind.MATERIAL:
            return f"[举报资料] {self.material_title} by {self.reporter_name}"
        if self.kind == self.Kind.QUESTION:
            return f"[举报问题] {self.qa_question_title} by {self.reporter_name}"
        if self.kind == self.Kind.ANSWER:
            return f"[举报回答] {self.qa_question_title} by {self.reporter_name}"
        return f"[举报用户] {self.target_user_name} by {self.reporter_name}"


# ═══════════════════════════════════════════════════════════════
# 课程树缓存失效信号
# CourseCategory 任何增删改（新建/删除/移动/改名/绑定课程等）→
# 清除 /api/courses/tree/ 缓存，管理员改树即时生效（TTL 10min 兜底）
# ═══════════════════════════════════════════════════════════════

COURSE_TREE_CACHE_KEY = "api_course_tree_data"
STATS_CACHE_VERSION_KEY = "api_stats_data_version"


def get_stats_cache_key(limit):
    """返回带版本号的统计缓存键，支持一次失效所有 limit 变体。"""
    version = cache.get(STATS_CACHE_VERSION_KEY)
    if version is None:
        version = 1
        cache.add(STATS_CACHE_VERSION_KEY, version, timeout=None)
        version = cache.get(STATS_CACHE_VERSION_KEY) or version
    return f"api_stats_data_{version}_{limit}"


def invalidate_stats_cache():
    """使所有首页统计缓存失效，不依赖 DatabaseCache 的 delete_pattern。"""
    try:
        cache.incr(STATS_CACHE_VERSION_KEY)
    except ValueError:
        # 首次写入前没有版本键；add 保证不会覆盖并发请求已写入的版本。
        cache.add(STATS_CACHE_VERSION_KEY, 1, timeout=None)

from django.core.cache import cache
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver


@receiver(post_save, sender=CourseCategory)
@receiver(post_delete, sender=CourseCategory)
@receiver(post_save, sender=Course)
def _invalidate_course_tree_cache(sender, **kwargs):
    cache.delete(COURSE_TREE_CACHE_KEY)


# ═══════════════════════════════════════════════════════════════
# Material 变更信号
# 资料任何增删改（上传/删除/审核通过·驳回/编辑）→
#   1. 失效 /api/courses/tree/ 缓存（fileCount 即时更新，修「暂无资料」陈旧）
#   2. 递增上传者公开页代际计数 user_public_gen_{uid}，公开页缓存即时失效
#      （缓存键含代际，旧键 60s TTL 自然过期，删除自传后不再残留显示）
# ═══════════════════════════════════════════════════════════════

USER_PUBLIC_GEN_PREFIX = "user_public_gen_"


def _bump_user_public_gen(user_id):
    """递增用户公开页代际计数，使 api_user_public 的旧缓存键即时失效。"""
    if not user_id:
        return
    key = f"{USER_PUBLIC_GEN_PREFIX}{user_id}"
    gen = cache.get(key) or 0
    cache.set(key, gen + 1)


@receiver(post_save, sender=Material)
@receiver(post_delete, sender=Material)
def _invalidate_material_caches(sender, instance, **kwargs):
    cache.delete(COURSE_TREE_CACHE_KEY)
    # 首页统计（最近上传/下载榜/计数）也依赖 Material，删除/上传/审批后必须即时失效，
    # 否则被删除的文件最长残留 120s 仍显示在「最近上传排行榜」里。
    invalidate_stats_cache()
    _bump_user_public_gen(getattr(instance, "uploader_id", None))


# ═══════════════════════════════════════════════════════════════
# 问答区（新生指南）模块 — Phase 1
# 管理员/问答区版主发布图文问题与回答；已认证学生及通过 2026 门控的
# 未注册新生浏览、搜索、收藏、点赞。
# Phase 2 预留（仅建字段/枚举，不实现）：用户提问/回答、最佳回答采纳、
# 通知、热度排序。
# ═══════════════════════════════════════════════════════════════

from datetime import date as _date


class QaTag(models.Model):
    """问答区预设分类标签（两级：L1=学院/通用，L2=8 个固定分类）"""
    name = models.CharField("标签名", max_length=50)
    icon = models.CharField("图标", max_length=50, blank=True, default="")
    color = models.CharField("颜色", max_length=20, blank=True, default="")
    sort_order = models.IntegerField("排序", default=0)
    level = models.IntegerField("级别", default=2, choices=[(1, "一级"), (2, "二级")])
    description = models.CharField("说明", max_length=200, blank=True, default="",
        help_text="二级标签点击后显示的括号内解释")

    class Meta:
        verbose_name = "问答区标签"
        verbose_name_plural = "问答区标签"
        ordering = ["level", "sort_order", "id"]

    def __str__(self):
        return self.name


class QaQuestion(models.Model):
    """问答区问题（Phase 1 全部由管理员/问答区版主发布）"""
    class Status(models.TextChoices):
        PUBLISHED = "published", "已发布"
        DELETED = "deleted", "已删除"
        # Phase 2 预留
        PENDING = "pending", "待审核"
        REJECTED = "rejected", "已驳回"

    title = models.CharField("标题", max_length=100)
    content = models.TextField("正文（富文本 HTML）", max_length=1000)
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name="qa_questions")
    tag_l1 = models.ForeignKey(QaTag, on_delete=models.PROTECT, related_name="+", verbose_name="一级标签")
    tag_l2 = models.ForeignKey(QaTag, on_delete=models.PROTECT, related_name="+", verbose_name="二级标签")
    is_pinned = models.BooleanField("置顶", default=False)
    pinned_at = models.DateTimeField("置顶时间", null=True, blank=True)
    status = models.CharField("状态", max_length=20, choices=Status.choices, default=Status.PUBLISHED)
    view_count = models.IntegerField("浏览量", default=0)
    favorite_count = models.IntegerField("收藏数", default=0)
    heat_score = models.IntegerField("热度分（Phase 2 预留）", default=0)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)
    deleted_at = models.DateTimeField("删除时间", null=True, blank=True)

    class Meta:
        verbose_name = "问答区问题"
        verbose_name_plural = "问答区问题"
        ordering = ["-is_pinned", "-created_at"]

    def __str__(self):
        return self.title


class QaAnswer(models.Model):
    """问答区回答（Phase 1 由管理员发布）"""
    class Status(models.TextChoices):
        PUBLISHED = "published", "已发布"
        DELETED = "deleted", "已删除"
        # Phase 2 预留
        PENDING = "pending", "待审核"
        REJECTED = "rejected", "已驳回"

    question = models.ForeignKey(QaQuestion, on_delete=models.CASCADE, related_name="answers")
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name="qa_answers")
    content = models.TextField("回答正文（富文本 HTML）", max_length=20000)
    is_pinned = models.BooleanField("置顶", default=False)
    pinned_at = models.DateTimeField("置顶时间", null=True, blank=True)
    like_count = models.IntegerField("点赞数", default=0)
    is_accepted = models.BooleanField("最佳回答（Phase 2 预留）", default=False)
    status = models.CharField("状态", max_length=20, choices=Status.choices, default=Status.PUBLISHED)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)
    deleted_at = models.DateTimeField("删除时间", null=True, blank=True)

    class Meta:
        verbose_name = "问答区回答"
        verbose_name_plural = "问答区回答"
        ordering = ["-is_pinned", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["question"], condition=Q(is_accepted=True),
                name="uniq_qa_accepted_answer_per_question",
            ),
        ]

    def __str__(self):
        return f"回答 {self.id}"


class QaAnswerLike(models.Model):
    """回答点赞（Phase 1 用户互动，点赞过的按钮高亮）"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="qa_answer_likes")
    answer = models.ForeignKey(QaAnswer, on_delete=models.CASCADE, related_name="likes")
    created_at = models.DateTimeField("点赞时间", auto_now_add=True)

    class Meta:
        verbose_name = "回答点赞"
        verbose_name_plural = "回答点赞"
        constraints = [
            models.UniqueConstraint(fields=["user", "answer"], name="uniq_qa_answer_like"),
        ]

    def __str__(self):
        return f"{self.user.username} → 回答{self.answer_id}"


class QaFavorite(models.Model):
    """问答区收藏（问题级 + 回答级；收藏回答自动同时收藏其问题，我的收藏合并显示）

    条件唯一约束（SQLite 有效）：
    - answer 非空 → 回答级收藏，唯一 (user, answer)
    - answer 为空 → 问题级收藏，唯一 (user, question)
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="qa_favorites")
    question = models.ForeignKey(QaQuestion, on_delete=models.CASCADE, related_name="qa_favorited_by")
    answer = models.ForeignKey(QaAnswer, on_delete=models.CASCADE, related_name="qa_favorited_by",
                               null=True, blank=True)
    created_at = models.DateTimeField("收藏时间", auto_now_add=True)

    class Meta:
        verbose_name = "问答区收藏"
        verbose_name_plural = "问答区收藏"
        constraints = [
            models.UniqueConstraint(fields=["user", "answer"], condition=Q(answer__isnull=False),
                                    name="uniq_qa_fav_answer"),
            models.UniqueConstraint(fields=["user", "question"], condition=Q(answer__isnull=True),
                                    name="uniq_qa_fav_question"),
        ]

    def __str__(self):
        return f"{self.user.username} → 问题{self.question_id}"


class QaEditHistory(models.Model):
    """问答区编辑留痕（快照式：记录编辑前后标题/正文，支撑回滚）"""
    TARGET_CHOICES = [("question", "问题"), ("answer", "回答")]

    target_type = models.CharField("目标类型", max_length=10, choices=TARGET_CHOICES)
    target_id = models.PositiveIntegerField("目标ID")
    editor = models.ForeignKey(User, on_delete=models.CASCADE, related_name="qa_edit_histories")
    old_title = models.CharField("编辑前标题", max_length=100, blank=True, default="")
    new_title = models.CharField("编辑后标题", max_length=100, blank=True, default="")
    old_content = models.TextField("编辑前正文", blank=True, default="")
    new_content = models.TextField("编辑后正文", blank=True, default="")
    created_at = models.DateTimeField("编辑时间", auto_now_add=True)

    class Meta:
        verbose_name = "问答区编辑历史"
        verbose_name_plural = "问答区编辑历史"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["target_type", "target_id"], name="qa_edit_hist_target")]

    def __str__(self):
        return f"{self.get_target_type_display()}{self.target_id} @ {self.created_at:%Y-%m-%d %H:%M}"


class QaViewLog(models.Model):
    """问答区浏览量去重（同一用户每日只算一次浏览）

    条件唯一约束：匿名（user IS NULL）按 (question, date)；登录按 (user, question, date)。
    SQLite 上单一 unique_together 对匿名 NULL 不去重，故拆两条。
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="qa_views",
                             null=True, blank=True)
    question = models.ForeignKey(QaQuestion, on_delete=models.CASCADE, related_name="view_logs")
    date = models.DateField("浏览日期")

    class Meta:
        verbose_name = "问答区浏览日志"
        verbose_name_plural = "问答区浏览日志"
        constraints = [
            models.UniqueConstraint(fields=["question", "date"], condition=Q(user__isnull=True),
                                    name="uniq_qa_view_guest"),
            models.UniqueConstraint(fields=["user", "question", "date"], condition=Q(user__isnull=False),
                                    name="uniq_qa_view_user"),
        ]

    def __str__(self):
        return f"问题{self.question_id} @ {self.date}"


class QaAskClickDaily(models.Model):
    """「我要提问」按钮无权限点击埋点（当日聚合，日报命令读取）"""
    date = models.DateField("日期", unique=True)
    count = models.IntegerField("当日点击", default=0)

    class Meta:
        verbose_name = "问答区提问点击埋点"
        verbose_name_plural = "问答区提问点击埋点"

    def __str__(self):
        return f"{self.date}: {self.count}"


class QaConfig(models.Model):
    """站点级问答区配置（单例 pk=1）：普通用户提问/回答开放开关（Phase 2 v183）

    默认关闭。总管理员在 管理后台→待审核→论坛管理 切换；后端用户提交端点
    必须读此开关（关→403），前端按钮只是 UX 门控。
    """
    user_open = models.BooleanField("普通用户提问/回答开放", default=False)
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="qa_config_updates", verbose_name="最近操作人",
    )
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "问答区配置"
        verbose_name_plural = "问答区配置"

    @classmethod
    def user_can_post(cls):
        cfg, _ = cls.objects.get_or_create(pk=1)
        return cfg.user_open

    def __str__(self):
        return f"问答区开放：{'开' if self.user_open else '关'}"


class QaDeleteRequest(models.Model):
    """问答区删除申请（Phase 2 v183）：用户删除有互动内容 → 管理员批准/驳回

    target 用 (target_type, target_id) 无 FK 设计，48h 硬删后申请记录仍可追溯展示；
    简单删除（无互动）自动批准并立即软删，auto_approved=True 留痕。
    部分唯一约束防同一用户对同一目标重复提交 PENDING 申请（并发 IntegrityError 兜底）。
    """
    class Status(models.TextChoices):
        PENDING = "pending", "待批准"
        APPROVED = "approved", "已批准"
        REJECTED = "rejected", "已驳回"

    TARGET_CHOICES = [("question", "问题"), ("answer", "回答")]

    target_type = models.CharField("目标类型", max_length=10, choices=TARGET_CHOICES)
    target_id = models.PositiveIntegerField("目标ID")
    requester = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="qa_delete_requests",
        verbose_name="申请人",
    )
    reason = models.TextField("删除理由", max_length=500)
    status = models.CharField("状态", max_length=10, choices=Status.choices, default=Status.PENDING)
    auto_approved = models.BooleanField("简单删除自动批准", default=False)
    handled_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="qa_delreq_handled", verbose_name="处理人",
    )
    handled_at = models.DateTimeField("处理时间", null=True, blank=True)
    created_at = models.DateTimeField("申请时间", auto_now_add=True)

    class Meta:
        verbose_name = "问答区删除申请"
        verbose_name_plural = "问答区删除申请"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["target_type", "target_id"], name="qa_delreq_target"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["requester", "target_type", "target_id"],
                condition=Q(status="pending"),
                name="uniq_qa_delreq_pending",
            ),
        ]

    def __str__(self):
        return f"删{self.get_target_type_display()}{self.target_id} by {self.requester_id} [{self.status}]"


class UserTimetable(models.Model):
    """我的课表——教务导出解析后的课表数据（JSON），按用户隔离，支持跨设备同步"""

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="timetable",
        verbose_name="用户",
    )
    data = models.JSONField("课表数据")
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "用户课表"
        verbose_name_plural = "用户课表"

    def __str__(self):
        return f"课表 of {self.user_id} @ {self.updated_at:%Y-%m-%d %H:%M}"


class TimetableImportRecord(models.Model):
    """用户主动导入教务课表的幂等留痕，用于总管理员监测。"""

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="timetable_imports",
        verbose_name="用户",
    )
    event_id = models.CharField("导入事件编号", max_length=64)
    course_count = models.PositiveIntegerField("导入课程数", default=0)
    created_at = models.DateTimeField("导入时间", auto_now_add=True)

    class Meta:
        verbose_name = "课表导入记录"
        verbose_name_plural = "课表导入记录"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["created_at"], name="ttimport_created"),
            models.Index(fields=["user", "created_at"], name="ttimport_user_created"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["user", "event_id"], name="uniq_ttimport_user_event"),
        ]

    def __str__(self):
        return f"课表导入 {self.user_id} @ {self.created_at:%Y-%m-%d %H:%M}"
