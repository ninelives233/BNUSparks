from django.db import models
from django.core.validators import FileExtensionValidator
from django.contrib.auth.models import User


class UserProfile(models.Model):
    class Role(models.TextChoices):
        USER = "user", "普通用户"
        SUB_MODERATOR = "sub_moderator", "小版主"
        MODERATOR = "moderator", "版主"
        SUPER_ADMIN = "super_admin", "总管理员"

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
    auto_approve = models.BooleanField("自动托管审核", default=False,
        help_text="开启后自动通过管辖板块内所有新上传的资料")
    can_auto_approve = models.BooleanField("允许自动托管", default=False,
        help_text="总管理员设置：该用户是否可以开启自动托管")
    daily_download_count = models.IntegerField("今日已下载", default=0)
    last_download_date = models.DateField("最后下载日期", null=True, blank=True)
    avatar = models.ImageField("头像", upload_to="avatars/", blank=True, null=True)

    # 公开资料字段（Iter 7）
    contact_email = models.EmailField("联系邮箱", blank=True, default="")
    contact_way = models.CharField("联系方式", max_length=200, blank=True, default="")
    bio = models.TextField("个人简介", max_length=200, blank=True, default="",
        help_text="200字以内")

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
        Course, on_delete=models.CASCADE,
        verbose_name="所属课程", related_name="materials",
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

    created_at = models.DateTimeField("上传时间", auto_now_add=True)

    class Meta:
        verbose_name = "资料"
        verbose_name_plural = "资料"
        ordering = ["-created_at"]

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


class DownloadRecord(models.Model):
    """下载记录——用户每次下载留痕"""
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="download_records",
        verbose_name="下载用户",
    )
    material = models.ForeignKey(
        Material, on_delete=models.CASCADE, verbose_name="关联资料",
    )
    course_code = models.CharField("课程代码", max_length=50, blank=True)
    course_name = models.CharField("课程名称", max_length=200, blank=True)
    material_title = models.CharField("资料标题", max_length=200, blank=True)
    file_name = models.CharField("文件名", max_length=255, blank=True)
    created_at = models.DateTimeField("下载时间", auto_now_add=True)

    class Meta:
        verbose_name = "下载记录"
        verbose_name_plural = "下载记录"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} → {self.material_title}"
