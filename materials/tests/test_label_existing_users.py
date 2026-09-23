"""存量用户学号身份标签自动补齐命令测试。"""

from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from .helpers import create_user
from ..management.commands.label_existing_users import infer_labels


class LabelExistingUsersTest(TestCase):
    def test_infer_known_college_and_education(self):
        self.assertEqual(
            infer_labels("209911030001@mail.bnu.edu.cn")[:3],
            ("本科", "经济与工商管理学院", "其他"),
        )
        self.assertEqual(infer_labels("209922081001@mail.bnu.edu.cn")[0], "硕士")
        self.assertEqual(infer_labels("209933130001@mail.bnu.edu.cn")[0], "博士")
        self.assertEqual(infer_labels("209961998001@mail.bnu.edu.cn")[0], "本科")
        self.assertIsNone(infer_labels("testuser@mail.bnu.edu.cn"))

    def test_command_dry_run_does_not_write(self):
        user = create_user("209911030001@mail.bnu.edu.cn", first_name="本科同学")
        output = StringIO()
        call_command("label_existing_users", stdout=output)
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.identity_education, "")
        self.assertIn("预览模式", output.getvalue())

    def test_command_apply_fills_blanks_but_preserves_existing_fields(self):
        user = create_user("209911030002@mail.bnu.edu.cn", first_name="经管同学")
        user.profile.identity_major = "金融学"
        user.profile.save(update_fields=["identity_major"])
        call_command("label_existing_users", "--apply", stdout=StringIO())
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.identity_education, "本科")
        self.assertEqual(user.profile.identity_college, "经济与工商管理学院")
        self.assertEqual(user.profile.identity_major, "金融学")
