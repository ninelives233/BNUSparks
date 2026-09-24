"""
v176 文字录入回归：JSON 整数 category_id 不再 500

真实浏览器前端把 course.id（JS 数字）当 category_id 发 JSON 整数
（如 {"category_id": 2247}），而视图此前默认它是字符串再 .strip()，
直接 AttributeError: 'int' object has no attribute 'strip' → 500。
（curl 复现全过是因为测试把 category_id 写成字符串，掩盖了此缺陷。）

修复：json 字段统一 str(...) 兜底。本测试用真·int 直打端点。
"""

import json

from .helpers import (
    BnuTestCase, create_user, create_college, create_course, create_category,
)
from ..models import Material


class UploadTextIntCategoryTest(BnuTestCase):
    """文字录入在 category_id/material_type_id 为 JSON 整数时正常落库"""

    def setUp(self):
        super().setUp()
        self.college = create_college("文学院", "wen")
        self.course = create_course(
            "CHI22008", "中国古典文献学", college=self.college, course_type="major",
        )
        root = create_category("专业课")
        cat = create_category("文学院", parent=root)
        self.node = create_category("汉语言文学", parent=cat, course=self.course)
        self.uploader = create_user("text_up", role="user", first_name="文字录入员")
        self.client.set_token(self.uploader)

    def _payload(self, **overrides):
        body = {
            "course_code": self.course.code,
            "category_id": self.node.id,           # ← int（浏览器真实行为）
            "title": "文字录入标题",
            "content": "这是一段文字录入的内容。",
            "description": "",
            "teacher": "张三",
            "material_type_id": self.type_pdf.id,  # ← int
        }
        body.update(overrides)
        return body

    def test_int_category_and_material_type_ok(self):
        """category_id 与 material_type_id 都是 int → 200 成功落库"""
        resp = self.client.post_json(
            "/api/files/upload-text/", self._payload(),
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertTrue(data.get("ok"))
        mat = Material.objects.get(id=data["data"]["id"])
        self.assertEqual(mat.course_id, self.course.id)
        self.assertEqual(mat.title, "文字录入标题")
        # 审核路由上下文被识别（v170：上下文节点小版主，此处无 → 无影响，落库即可）
        self.assertTrue(mat.file_name.endswith(".txt"))

    def test_int_category_with_missing_optional(self):
        """category_id 为 int 且 description 缺省 → 仍成功（防 `or ""` 边缘）"""
        payload = self._payload()
        del payload["description"]
        resp = self.client.post_json("/api/files/upload-text/", payload)
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_int_category_route_context_respected(self):
        """int category_id 正确锚定路由上下文：上下文节点小版主收到 NEW_PENDING"""
        sub = create_user("sub_text", role="sub_moderator", first_name="小版主")
        sub.profile.moderated_sections.add(self.node)
        resp = self.client.post_json(
            "/api/files/upload-text/", self._payload(),
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        mat = Material.objects.get(id=resp.json()["data"]["id"])
        self.assertEqual(mat.review_status, "pending")
        from ..models import Notification
        self.assertTrue(
            Notification.objects.filter(
                recipient=sub, material=mat, type=Notification.Type.NEW_PENDING,
            ).exists(),
            "int category_id 应触发 L1 上下文节点小版主广播通知",
        )
