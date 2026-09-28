"""上传表单选择「课件」类型时的风险提示：前端契约回归。"""
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase


class CoursewareUploadWarningContractTest(SimpleTestCase):
    def test_warning_defined_and_wired_to_all_upload_type_selects(self):
        root = Path(settings.BASE_DIR)
        utils = (root / "public/js/utils.js").read_text(encoding="utf-8")
        html = (root / "public/index.html").read_text(encoding="utf-8")

        # 提示函数由首屏 utils 提供（上传弹窗与新建课程表单共用），按名称识别课件
        self.assertIn("function warnIfCoursewareType(sel)", utils)
        self.assertIn("picked.name !== '课件'", utils)
        self.assertIn("风险较高且效益较低", utils)

        # 三个上传表单（上传弹窗、新建课程通识/专业课）的类型下拉都接入提示
        self.assertEqual(html.count('onchange="warnIfCoursewareType(this)"'), 3)
        for select_id in ("uploadMaterialType", "ncGMaterialType", "ncMMaterialType"):
            self.assertIn(f'id="{select_id}"', html)
