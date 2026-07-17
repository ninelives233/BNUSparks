"""测试工具函数：JWT 生成、测试数据创建、API 客户端"""

import json
import time
import io

from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.conf import settings

from ..models import (
    UserProfile, College, Course, CourseCategory,
    Material, MaterialType, Notification,
)

# ── JWT ──

def _make_jwt(user_id, exp=None):
    """产生测试用 JWT token（与 views.py 中实现一致）"""
    import hmac, hashlib, base64
    payload = {"user_id": user_id, "exp": exp or int(time.time()) + 3600, "iat": int(time.time())}
    header_b64 = base64.urlsafe_b64encode(
        json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    ).rstrip(b"=").decode()
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).rstrip(b"=").decode()
    sig = hmac.new(
        settings.SECRET_KEY.encode(),
        f"{header_b64}.{payload_b64}".encode(),
        hashlib.sha256,
    ).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{header_b64}.{payload_b64}.{sig_b64}"


# ── API 客户端 ──

class AuthClient(Client):
    """带 JWT 认证的测试客户端"""

    def set_token(self, user):
        self.defaults["HTTP_AUTHORIZATION"] = f"Bearer {_make_jwt(user.id)}"

    def post_json(self, path, data=None):
        return self.post(
            path,
            data=json.dumps(data or {}),
            content_type="application/json",
            **self.defaults,
        )

    def get_json(self, path, data=None):
        return self.get(path, data=data or {}, **self.defaults)

    def delete_json(self, path, data=None):
        return self.delete(
            path,
            data=json.dumps(data or {}),
            content_type="application/json",
            **self.defaults,
        )


# ── 测试数据工厂 ──

def create_user(username="testuser", password="testpass123", role="user", first_name=""):
    """创建用户 + UserProfile"""
    u = User.objects.create_user(
        username=username,
        password=password,
        email=f"{username}@mail.bnu.edu.cn",
        first_name=first_name or username,
    )
    UserProfile.objects.create(user=u, role=role)
    return u


def create_college(name="文学院", slug="wenxy"):
    return College.objects.create(name=name, short_name=name[:2], slug=slug)


def create_course(code="GEN0001", name="大学语文", college=None, course_type="general"):
    return Course.objects.create(
        code=code, name=name, college=college,
        course_type=course_type,
    )


def create_category(name="语文类", parent=None, course=None, course_text=""):
    return CourseCategory.objects.create(
        name=name, parent=parent,
        course=course, course_text=course_text,
    )


def create_material(course, uploader, review_status="pending", assigned_moderator=None):
    """创建测试用的虚拟材料（不生成真实文件）"""
    return Material.objects.create(
        course=course,
        title="测试资料",
        teacher="张老师",
        file_name="test.pdf",
        file_path=f"{course.code}/test.pdf",
        file_size=1024,
        uploader=uploader,
        uploader_name=uploader.first_name or uploader.username,
        review_status=review_status,
        is_approved=review_status == "approved",
        assigned_moderator=assigned_moderator,
    )


# ── 基类 TestCase ──

class BnuTestCase(TestCase):
    """所有测试的基类，提供标准 API 客户端和常用夹具"""

    def setUp(self):
        self.client = AuthClient()
        self.user = create_user("student1", role="user", first_name="学生甲")
        self.sub_mod = create_user("submod1", role="sub_moderator", first_name="小版主甲")
        self.mod = create_user("mod1", role="moderator", first_name="版主甲")
        self.admin = create_user("admin1", role="super_admin", first_name="总管理员")
        self.type_pdf = MaterialType.objects.create(name="PDF", slug="pdf", icon="📄")
