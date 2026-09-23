"""
举报功能测试

覆盖：
  - 每日 15 次限额（直测 _check_report_quota + API 429「今日举报次数过多」）
  - 防重复（同人同料 400 不白扣限额；连带 user-kind 重复静默；report-status）
  - 分配矩阵（_report_candidates 复现上传路由：L1 小版主 → L3 版主 → L4 超管；course=None 兜底超管）
  - 处理通知矩阵（删除/保留/恶意/升级/超管收尾）
  - 删除联动（未删→建 DeletionRecord+Material 消失；已删→file_already_deleted=True）
  - 聚合（同料多人→1 组；处理一次全清）
  - 作用域与权限（辖区过滤 / 越权 404 / 普通用户 403）
  - 举报记录分页
"""

from datetime import date, timedelta

from .helpers import (
    BnuTestCase, create_user, create_college, create_course,
    create_category, create_material,
)
from ..models import UserProfile, Material, DeletionRecord, Notification, Report


class ReportQuotaTest(BnuTestCase):
    """每日 15 次举报限额（直测 _check_report_quota，仿 test_download_quota）"""

    def _quota(self):
        from ..views import _check_report_quota
        return _check_report_quota(self.user)

    def test_first_ok(self):
        allowed, remaining, msg = self._quota()
        self.assertTrue(allowed)
        self.assertEqual(remaining, 14)
        profile = UserProfile.objects.get(user=self.user)
        self.assertEqual(profile.daily_report_count, 1)
        self.assertEqual(profile.last_report_date, date.today())

    def test_exceeded(self):
        self.user.profile.daily_report_count = 15
        self.user.profile.last_report_date = date.today()
        self.user.profile.save()
        allowed, remaining, msg = self._quota()
        self.assertFalse(allowed)
        self.assertEqual(remaining, 0)
        self.assertEqual(msg, "今日举报次数过多")

    def test_exactly_15th_ok(self):
        self.user.profile.daily_report_count = 14
        self.user.profile.last_report_date = date.today()
        self.user.profile.save()
        allowed, remaining, _ = self._quota()
        self.assertTrue(allowed)
        self.assertEqual(remaining, 0)

    def test_admin_not_limited(self):
        from ..views import _check_report_quota
        self.admin.profile.daily_report_count = 999
        self.admin.profile.save()
        allowed, remaining, _ = _check_report_quota(self.admin)
        self.assertTrue(allowed)
        self.assertEqual(remaining, -1)  # 管理员 -1 = 不限量

    def test_resets_next_day(self):
        self.user.profile.daily_report_count = 15
        self.user.profile.last_report_date = date.today() - timedelta(days=1)
        self.user.profile.save()
        allowed, remaining, _ = self._quota()
        self.assertTrue(allowed)
        self.assertEqual(remaining, 14)


class ReportSubmitTest(BnuTestCase):
    """提交举报 API：建 Report + 分配广播 + 防重复 + 限额 + 校验"""

    def setUp(self):
        super().setUp()
        self.uploader = create_user("uploader1", role="user", first_name="上传者")
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(code="MATH101", name="数学分析", college=self.college, course_type="major")
        self.cat_math = create_category(name="数学类")
        self.cat_math.course = self.major_course
        self.cat_math.save()
        self.mat = create_material(self.major_course, self.uploader)

    def _submit(self, user, reasons=None, detail="", report_user=False):
        self.client.set_token(user)
        return self.client.post_json(f"/api/files/{self.mat.id}/report/", {
            "reasons": reasons or ["political"], "detail": detail, "report_user": report_user,
        })

    def test_submit_creates_report_and_alert(self):
        self.sub_mod.profile.moderated_sections.add(self.cat_math)
        resp = self._submit(self.user)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["data"]["reported"])
        rep = Report.objects.get(kind=Report.Kind.MATERIAL, material_pk=self.mat.id, reporter=self.user)
        self.assertEqual(list(rep.candidates.all()), [self.sub_mod])
        self.assertTrue(Notification.objects.filter(
            recipient=self.sub_mod, type=Notification.Type.REPORT_ALERT).exists())

    def test_duplicate_rejected_not_charging_quota(self):
        self._submit(self.user)
        resp = self._submit(self.user)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("已举报", resp.json()["error"])
        # 重复提交不白扣限额
        self.assertEqual(UserProfile.objects.get(user=self.user).daily_report_count, 1)

    def test_cannot_report_own_upload(self):
        resp = self._submit(self.uploader)
        self.assertEqual(resp.status_code, 400)

    def test_quota_429(self):
        self.user.profile.daily_report_count = 15
        self.user.profile.last_report_date = date.today()
        self.user.profile.save()
        resp = self._submit(self.user)
        self.assertEqual(resp.status_code, 429)
        self.assertEqual(resp.json()["error"], "今日举报次数过多")

    def test_other_reason_requires_detail(self):
        resp = self._submit(self.user, reasons=["other"], detail="")
        self.assertEqual(resp.status_code, 400)

    def test_report_status(self):
        self._submit(self.user)
        self.client.set_token(self.user)
        resp = self.client.get_json(f"/api/files/{self.mat.id}/report-status/")
        data = resp.json()["data"]
        self.assertTrue(data["reported"])
        self.assertFalse(data["can_report"])

    def test_join_report_user(self):
        self._submit(self.user, report_user=True)
        self.assertTrue(Report.objects.filter(kind=Report.Kind.USER, target_user=self.uploader, reporter=self.user).exists())
        # 连带重复 → 静默（material 报第二次先被拒，走另一分支）
        self._submit(self.user, report_user=True)
        self.assertEqual(Report.objects.filter(kind=Report.Kind.USER, target_user=self.uploader, reporter=self.user).count(), 1)


class ReportAssignmentTest(BnuTestCase):
    """举报分配矩阵（_report_candidates 与上传审核路由完全一致，含小版主）"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(code="MATH101", name="数学分析", college=self.college, course_type="major")
        self.cat_math = create_category(name="数学类")
        self.cat_math.course = self.major_course
        self.cat_math.save()
        self.uploader = create_user("uploader1", role="user", first_name="上传者")

    def _candidates(self, mat):
        from ..views import _report_candidates
        return _report_candidates(mat)

    def test_major_with_sub_mod(self):
        self.sub_mod.profile.moderated_sections.add(self.cat_math)
        mat = create_material(self.major_course, self.uploader)
        self.assertEqual(self._candidates(mat), [self.sub_mod])

    def test_major_falls_to_moderator(self):
        self.mod.profile.managed_majors.add(self.college)
        mat = create_material(self.major_course, self.uploader)
        self.assertEqual(self._candidates(mat), [self.mod])

    def test_major_no_one_super(self):
        mat = create_material(self.major_course, self.uploader)
        self.assertEqual(self._candidates(mat), [self.admin])

    def test_multi_moderator_broadcast(self):
        self.mod.profile.managed_majors.add(self.college)
        mod2 = create_user("mod2", role="moderator", first_name="版主乙")
        mod2.profile.managed_majors.add(self.college)
        mat = create_material(self.major_course, self.uploader)
        self.assertEqual(set(self._candidates(mat)), {self.mod, mod2})

    def test_course_none_super_fallback(self):
        mat = Material.objects.create(course=None, title="悬空资料", file_name="x.pdf",
                                      file_path="x.pdf", file_size=1, uploader=self.uploader)
        self.assertEqual(self._candidates(mat), [self.admin])


class ReportHandleTest(BnuTestCase):
    """处理举报：通知矩阵 + 删除联动 + 聚合"""

    def setUp(self):
        super().setUp()
        self.uploader = create_user("uploader1", role="user", first_name="上传者")
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(code="MATH101", name="数学分析", college=self.college, course_type="major")
        self.cat_math = create_category(name="数学类")
        self.cat_math.course = self.major_course
        self.cat_math.save()
        self.sub_mod.profile.moderated_sections.add(self.cat_math)
        self.mat = create_material(self.major_course, self.uploader)
        self.reporter_a = create_user("rep_a", role="user", first_name="举报者甲")
        self.reporter_b = create_user("rep_b", role="user", first_name="举报者乙")

    def _submit(self, user, report_user=False):
        self.client.set_token(user)
        return self.client.post_json(f"/api/files/{self.mat.id}/report/", {
            "reasons": ["political"], "detail": "违规内容", "report_user": report_user,
        })

    def _handle_material(self, body, as_user=None):
        rep = Report.objects.filter(kind=Report.Kind.MATERIAL, material_pk=self.mat.id).first()
        self.client.set_token(as_user or self.sub_mod)
        return self.client.post_json(f"/api/moderation/reports/{rep.id}/handle/", body)

    def _handle_user(self, body, as_user=None):
        rep = Report.objects.filter(kind=Report.Kind.USER, target_user=self.uploader).first()
        self.client.set_token(as_user or self.sub_mod)
        return self.client.post_json(f"/api/moderation/reports/{rep.id}/handle/", body)

    def test_handle_delete_notifies_and_deletes(self):
        self._submit(self.reporter_a)
        resp = self._handle_material({"is_true": True, "action": "delete", "allow_retry": True})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["data"]["file_already_deleted"])
        # 软删除：Material 消失、DeletionRecord 建立
        self.assertFalse(Material.objects.filter(id=self.mat.id).exists())
        self.assertTrue(DeletionRecord.objects.filter(material_id=self.mat.id).exists())
        # 举报人 + 上传者各收到结果通知；allow_retry=True → 上传者消息含「重新上传」
        self.assertTrue(Notification.objects.filter(recipient=self.reporter_a, type="report_result").exists())
        up = Notification.objects.filter(recipient=self.uploader, type="report_result").first()
        self.assertIsNotNone(up)
        self.assertIn("删除原因", up.message)
        self.assertIn("重新上传", up.message)

    def test_handle_delete_no_retry(self):
        self._submit(self.reporter_a)
        self._handle_material({"is_true": True, "action": "delete", "allow_retry": False})
        up = Notification.objects.filter(recipient=self.uploader, type="report_result").first()
        self.assertIsNotNone(up)
        self.assertNotIn("重新上传", up.message)

    def test_handle_delete_already_deleted(self):
        self._submit(self.reporter_a)
        rep = Report.objects.filter(kind=Report.Kind.MATERIAL, material_pk=self.mat.id).first()
        self.mat.delete()  # 管理员先在文件详情页删除 → FK 置空，material_pk 保留
        self.client.set_token(self.sub_mod)
        resp = self.client.post_json(f"/api/moderation/reports/{rep.id}/handle/",
            {"is_true": True, "action": "delete", "allow_retry": False})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["data"]["file_already_deleted"])
        # 不再重复建 DeletionRecord
        self.assertFalse(DeletionRecord.objects.filter(material_id=self.mat.id).exists())

    def test_handle_keep_with_actual_situation(self):
        self._submit(self.reporter_a)
        resp = self._handle_material({"is_true": False, "action": "keep", "actual_situation": "资料为教材扫描件，无误"})
        self.assertEqual(resp.status_code, 200)
        notif = Notification.objects.filter(recipient=self.reporter_a, type="report_result").first()
        self.assertIsNotNone(notif)
        self.assertIn("保留原因", notif.message)
        self.assertIn("资料为教材扫描件", notif.message)
        # 保留 → 材料仍在
        self.assertTrue(Material.objects.filter(id=self.mat.id).exists())

    def test_handle_keep_malicious_alerts_super(self):
        self._submit(self.reporter_a)
        self._handle_material({"is_true": False, "action": "keep", "actual_situation": "无误",
                              "is_malicious": True})
        self.assertTrue(Notification.objects.filter(
            recipient=self.admin, type=Notification.Type.REPORT_MALICIOUS).exists())

    def test_handle_requires_actual_when_not_true(self):
        self._submit(self.reporter_a)
        resp = self._handle_material({"is_true": False, "action": "keep"})
        self.assertEqual(resp.status_code, 400)

    def test_aggregation_single_group_and_bulk(self):
        self._submit(self.reporter_a)
        self._submit(self.reporter_b)
        third = create_user("rep_c", role="user", first_name="举报者丙")
        self._submit(third)
        # 受理列表：1 个材料组，3 人
        self.client.set_token(self.sub_mod)
        resp = self.client.get_json("/api/moderation/reports/pending/")
        data = resp.json()["data"]
        self.assertEqual(len(data["material_groups"]), 1)
        group = data["material_groups"][0]
        self.assertEqual(group["reporter_count"], 3)
        # 处理一次 → 全部 handled
        self._handle_material({"is_true": True, "action": "keep"})
        self.assertEqual(Report.objects.filter(kind=Report.Kind.MATERIAL, material_pk=self.mat.id).count(), 3)
        self.assertFalse(Report.objects.filter(kind=Report.Kind.MATERIAL, material_pk=self.mat.id, status=Report.Status.PENDING).exists())
        # 全部举报人都收到结果通知
        for u in (self.reporter_a, self.reporter_b, third):
            self.assertTrue(Notification.objects.filter(recipient=u, type="report_result").exists())

    def test_user_report_escalate_and_finish(self):
        self._submit(self.reporter_a, report_user=True)
        # 管理员（小版主）处理连带举报：属实 → 升级
        resp = self._handle_user({"is_true": True, "is_malicious": False})
        self.assertEqual(resp.status_code, 200)
        urep = Report.objects.get(kind=Report.Kind.USER, target_user=self.uploader)
        self.assertEqual(urep.status, Report.Status.ESCALATED)
        # 全部超管收到升级通知
        self.assertTrue(Notification.objects.filter(
            recipient=self.admin, type=Notification.Type.REPORT_ESCALATED).exists())
        # 超管在受理界面看到（can_finish=True）
        self.client.set_token(self.admin)
        resp = self.client.get_json("/api/moderation/reports/pending/")
        ugroups = resp.json()["data"]["user_groups"]
        self.assertEqual(len(ugroups), 1)
        self.assertTrue(ugroups[0]["can_finish"])
        # 超管收尾
        resp = self.client.post_json(f"/api/moderation/reports/{urep.id}/finish/", {})
        self.assertEqual(resp.status_code, 200)
        urep.refresh_from_db()
        self.assertEqual(urep.status, Report.Status.HANDLED)
        self.assertTrue(Notification.objects.filter(recipient=self.reporter_a, type="report_result").exists())

    def test_user_report_not_true_feedback(self):
        self._submit(self.reporter_a, report_user=True)
        self._handle_user({"is_true": False, "is_malicious": False})
        urep = Report.objects.get(kind=Report.Kind.USER, target_user=self.uploader)
        self.assertEqual(urep.status, Report.Status.HANDLED)
        notif = Notification.objects.filter(recipient=self.reporter_a, type="report_result").first()
        self.assertIsNotNone(notif)
        self.assertIn("不存在所述问题", notif.message)

    def test_user_report_malicious_alerts_super(self):
        self._submit(self.reporter_a, report_user=True)
        self._handle_user({"is_true": True, "is_malicious": True})
        self.assertTrue(Notification.objects.filter(
            recipient=self.admin, type=Notification.Type.REPORT_MALICIOUS).exists())


class ReportScopePermissionTest(BnuTestCase):
    """作用域过滤与权限"""

    def setUp(self):
        super().setUp()
        self.uploader = create_user("uploader1", role="user", first_name="上传者")
        self.college_a = create_college("文学院", "wen")
        self.college_b = create_college("物理学院", "phy")
        self.course_a = create_course(code="CHIN101", name="现代汉语", college=self.college_a, course_type="major")
        self.course_b = create_course(code="PHY101", name="大学物理", college=self.college_b, course_type="major")
        self.mod.profile.managed_majors.add(self.college_a)  # mod 只管文学院

    def _report_on(self, course, reporter):
        mat = create_material(course, self.uploader)
        self.client.set_token(reporter)
        self.client.post_json(f"/api/files/{mat.id}/report/", {"reasons": ["political"]})
        return mat

    def test_pending_scoped_by_candidate(self):
        # B 学院无人覆盖 → 候选为超管；版主 A 的受理列表看不到
        self._report_on(self.course_b, self.user)
        self.client.set_token(self.mod)
        resp = self.client.get_json("/api/moderation/reports/pending/")
        self.assertEqual(resp.json()["data"]["material_groups"], [])

    def test_regular_user_403(self):
        self.client.set_token(self.user)
        self.assertEqual(self.client.get_json("/api/moderation/reports/pending/").status_code, 403)
        self.assertEqual(self.client.post_json("/api/moderation/reports/1/handle/", {}).status_code, 403)

    def test_cross_scope_handle_404(self):
        mat = self._report_on(self.course_b, self.user)
        rep = Report.objects.get(kind=Report.Kind.MATERIAL, material_pk=mat.id)
        # 版主 A 越权处理 B 学院举报 → 404（防探测）
        self.client.set_token(self.mod)
        resp = self.client.post_json(f"/api/moderation/reports/{rep.id}/handle/",
            {"is_true": True, "action": "keep"})
        self.assertEqual(resp.status_code, 404)

    def test_cross_scope_handle_stays_404_after_material_deleted(self):
        """目标 FK 失效后也必须按 Report.candidates 鉴权，不能因无 Material 而放行。"""
        mat = self._report_on(self.course_b, self.user)
        rep = Report.objects.get(kind=Report.Kind.MATERIAL, material_pk=mat.id)
        mat.delete()

        self.client.set_token(self.mod)
        resp = self.client.post_json(
            f"/api/moderation/reports/{rep.id}/handle/",
            {"is_true": False, "actual_situation": "无问题", "action": "keep"},
        )
        self.assertEqual(resp.status_code, 404)
        rep.refresh_from_db()
        self.assertEqual(rep.status, Report.Status.PENDING)

    def test_history_is_scoped_to_candidates_for_non_super_admin(self):
        own_mat = self._report_on(self.course_a, self.user)
        other_reporter = create_user("scope_reporter", role="user")
        other_mat = self._report_on(self.course_b, other_reporter)
        own_report = Report.objects.get(kind=Report.Kind.MATERIAL, material_pk=own_mat.id)
        other_report = Report.objects.get(kind=Report.Kind.MATERIAL, material_pk=other_mat.id)
        self.assertTrue(own_report.candidates.filter(id=self.mod.id).exists())
        self.assertFalse(other_report.candidates.filter(id=self.mod.id).exists())

        self.client.set_token(self.mod)
        resp = self.client.get_json("/api/moderation/reports/history/?page=1&per_page=100")
        ids = {item["report_id"] for item in resp.json()["data"]["items"]}
        self.assertIn(own_report.id, ids)
        self.assertNotIn(other_report.id, ids)


class ReportHistoryTest(BnuTestCase):
    """举报记录：全部状态、分页、管理员可见"""

    def setUp(self):
        super().setUp()
        self.uploader = create_user("uploader1", role="user", first_name="上传者")
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(code="MATH101", name="数学分析", college=self.college, course_type="major")
        self.mat = create_material(self.major_course, self.uploader)

    def test_history_pagination(self):
        self.client.set_token(self.user)
        self.client.post_json(f"/api/files/{self.mat.id}/report/", {"reasons": ["political"]})
        self.client.set_token(self.admin)
        resp = self.client.get_json("/api/moderation/reports/history/?page=1&per_page=20")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["data"]
        self.assertGreaterEqual(data["total"], 1)
        self.assertGreaterEqual(data["total_pages"], 1)
        item = data["items"][0]
        self.assertEqual(item["kind"], "material")
        self.assertEqual(item["status"], "pending")
        self.assertEqual(item["material_title"], "测试资料")
