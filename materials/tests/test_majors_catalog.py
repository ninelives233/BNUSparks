"""专业库（Major）建库、/api/majors/ 端点与存量硕博身份标签迁移测试（v259）。"""

from io import StringIO

from django.core.management import call_command
from django.db.models import Q
from django.test import RequestFactory, TestCase

from .helpers import create_user
from ..models import College, CourseCategory, Major, UserProfile
from ..majors_catalog import GRAD_MAJORS, ZHUHAI_COLLEGES, ZHUHAI_MAJORS
from ..views import api_majors

ZHUHAI_NAMES = {e["name"] for e in ZHUHAI_COLLEGES}


def Q_college_zhuhai():
    """排除珠海学院，用于断言北京口径的条目数。"""
    return ~Q(college__name__in=ZHUHAI_NAMES)


def _make_colleges():
    """为目录中出现的全部学院建 College（含站内已有的与 seed 补建的）。"""
    names = set()
    for tracks in GRAD_MAJORS.values():
        for entries in tracks.values():
            for college_name, _majors in entries:
                names.add(college_name)
    for idx, name in enumerate(sorted(names)):
        College.objects.get_or_create(name=name, defaults={"slug": f"tcat{idx:02d}"})


def _make_tree():
    """最小课程树：专业课 → 文学院/数学科学学院 → 各一个有子目录的专业节点。

    与线上「专业课」分支同构，用于本科专业同步口径测试。
    """
    root = CourseCategory.objects.create(name="专业课")
    for college_name, major_name in [("文学院", "汉语言文学"), ("数学科学学院", "数学与应用数学")]:
        college_node = CourseCategory.objects.create(name=college_name, parent=root)
        major_node = CourseCategory.objects.create(name=major_name, parent=college_node)
        CourseCategory.objects.create(name=f"{major_name}导论", parent=major_node)
    return root


def _seed_apply():
    call_command("seed_majors", "--apply", stdout=StringIO())


class SeedCreatesCollegesTest(TestCase):
    """无预置学院：验证 seed 自行补建学位点承载学院（含 slug）。"""

    def test_apply_creates_new_colleges_with_slugs(self):
        call_command("seed_majors", "--apply", stdout=StringIO())
        self.assertTrue(College.objects.filter(name="系统科学学院", slug="sss").exists())
        self.assertTrue(College.objects.filter(name="中华文化研究院（京师书院）", slug="jssy").exists())
        # 珠海学院带校区标注
        self.assertTrue(College.objects.filter(name="文理学院", slug="fas", campus="珠海").exists())
        # 承载了目录专业的学院可建出硕博专业
        self.assertTrue(Major.objects.filter(
            college__name="系统科学学院", name="系统科学", level="硕士").exists())

    def test_dry_run_creates_no_college(self):
        call_command("seed_majors", stdout=StringIO())
        self.assertEqual(College.objects.filter(name__in=["水科学研究院", "文理学院"]).count(), 0)
        self.assertEqual(Major.objects.count(), 0)


class SeedMajorsTest(TestCase):
    def setUp(self):
        _make_colleges()
        _make_tree()

    def test_apply_seeds_catalog_and_tree(self):
        output = StringIO()
        call_command("seed_majors", "--apply", stdout=output)
        beijing = Q_college_zhuhai()  # 已内置排除珠海
        self.assertEqual(
            Major.objects.filter(level="硕士", track="academic").filter(beijing).count(), 34,
            "硕士学硕北京口径应为 34 个一级学科（2025.09 官方表：33 博士一级+信息资源管理）",
        )
        self.assertEqual(Major.objects.filter(level="硕士", track="professional").filter(beijing).count(), 27)
        self.assertEqual(Major.objects.filter(level="博士", track="academic").filter(beijing).count(), 33)
        self.assertEqual(Major.objects.filter(level="博士", track="professional").filter(beijing).count(), 12)
        # 本科专业从课程树同步：文学院/汉语言文学、数学科学学院/数学与应用数学
        self.assertTrue(Major.objects.filter(
            college__name="文学院", name="汉语言文学", level="本科").exists())

    def test_zhuhai_catalog_seeded(self):
        call_command("seed_majors", "--apply", stdout=StringIO())
        # 6 个珠海学院带校区标注入库
        self.assertEqual(College.objects.filter(campus="珠海").count(), len(ZHUHAI_COLLEGES))
        self.assertTrue(College.objects.filter(name="文理学院", slug="fas", campus="珠海").exists())
        # 本科：文理 13（挂系）+ 未来教育 12 + 湾区国商 4 + 未来设计 1
        self.assertEqual(Major.objects.filter(
            level="本科", college__campus="珠海").count(), sum(
            len(majors) for _c, majors in ZHUHAI_MAJORS["本科"]))
        self.assertTrue(Major.objects.filter(
            college__name="文理学院", name="人工智能", level="本科").exists())
        self.assertTrue(Major.objects.filter(
            college__name="未来教育学院", name="汉语国际教育", level="本科").exists())
        # 地理信息科学在珠海仅第二学士学位（开课单位：地理科学学部），不入文理学院目录
        self.assertFalse(Major.objects.filter(
            college__name="文理学院", name="地理信息科学", level="本科").exists())

    def test_fas_undergrad_majors_carry_department(self):
        """文理学院本科专业按学院 13 系建制挂 department；其他学院留空。"""
        _seed_apply()
        fas = Major.objects.filter(college__name="文理学院", level="本科")
        self.assertEqual(fas.count(), 13)
        self.assertEqual(
            fas.filter(department="").count(), 0,
            "文理学院本科专业应全部挂系",
        )
        self.assertEqual(
            fas.get(name="人工智能").department, "数据科学与大数据技术系")
        self.assertEqual(
            fas.get(name="数据科学与大数据技术").department, "数据科学与大数据技术系")
        self.assertEqual(fas.get(name="地理科学").department, "地理系")
        self.assertEqual(fas.get(name="应用统计学").department, "统计系")
        # 13 个专业分布在 12 个系（仅数据科学与大数据技术系含 2 个专业；哲学系无本科专业）
        self.assertEqual(fas.values_list("department", flat=True).distinct().count(), 12)
        # 非文理学院不带系
        self.assertTrue(Major.objects.filter(
            college__name="未来教育学院", level="本科", department="").exists())
        # 硕博按 2026 招生目录口径
        self.assertEqual(
            Major.objects.filter(level="硕士", track="academic", college__campus="珠海").count(), 20)
        self.assertEqual(
            Major.objects.filter(level="硕士", track="professional", college__campus="珠海").count(), 7)
        self.assertEqual(
            Major.objects.filter(level="博士", track="academic", college__campus="珠海").count(), 22)
        self.assertEqual(
            Major.objects.filter(level="博士", track="professional", college__campus="珠海").count(), 1)
        # 抽查：文理学院学硕含核科学与技术（珠海招生归口）、湾区国商学博公共管理学
        self.assertTrue(Major.objects.filter(
            college__name="文理学院", name="核科学与技术", level="硕士").exists())
        self.assertTrue(Major.objects.filter(
            college__name="湾区国际商学院", name="公共管理学", level="博士").exists())
        self.assertTrue(Major.objects.filter(
            college__name="未来教育学院", name="教育", level="博士", track="professional").exists())

    def test_zhuhai_units_without_identity_majors_not_created(self):
        """核科学院（招生归口文理/物天）、一带一路、乡长、未来海洋等不设身份标签学院行。"""
        call_command("seed_majors", "--apply", stdout=StringIO())
        self.assertFalse(College.objects.filter(
            name__in=["核科学与技术学院", "一带一路学院", "乡长学院", "未来海洋学院"]).exists())

    def test_dry_run_writes_nothing(self):
        call_command("seed_majors", stdout=StringIO())
        self.assertEqual(Major.objects.count(), 0)

    def test_idempotent_rerun(self):
        call_command("seed_majors", "--apply", stdout=StringIO())
        total = Major.objects.count()
        output = StringIO()
        call_command("seed_majors", "--apply", stdout=output)
        self.assertEqual(Major.objects.count(), total)
        self.assertIn("硕博专业 +0", output.getvalue())

    def test_stale_undergrad_major_deactivated_not_deleted(self):
        call_command("seed_majors", "--apply", stdout=StringIO())
        stale = Major.objects.get(college__name="文学院", name="汉语言文学", level="本科")
        CourseCategory.objects.filter(name="汉语言文学").first().delete()
        call_command("seed_majors", "--apply", stdout=StringIO())
        stale.refresh_from_db()
        self.assertFalse(stale.is_active, "课程树中消失的本科专业应停用而非删除")

    def test_removed_discipline_not_in_catalog(self):
        _seed_apply()
        # 2023 版的「信息与通信工程」硕士一级点在 2025 版已撤销
        self.assertFalse(Major.objects.filter(name="信息与通信工程").exists())


class ApiMajorsTest(TestCase):
    def setUp(self):
        _make_colleges()
        _make_tree()
        _seed_apply()

    def _get(self, url="/api/majors/"):
        response = api_majors(RequestFactory().get(url))
        import json
        payload = json.loads(response.content)
        return payload.get("data") or payload

    def test_three_levels_with_expected_college_counts(self):
        catalog = self._get()
        self.assertEqual(set(catalog.keys()), {"本科", "硕士", "博士"})
        # 本科 = 课程树 2 个北京学院 + 珠海 4 学院；站内 22 学院仅出现在有专业时
        self.assertEqual(len(catalog["本科"]), 6)
        zhuhai_grad_colleges = {c for tracks in ("硕士", "博士")
                                for t in ZHUHAI_MAJORS[tracks].values()
                                for c, _m in t}
        beijing_grad_colleges = {c for tracks in GRAD_MAJORS.values()
                                 for t in tracks.values()
                                 for c, _m in t}
        self.assertEqual(len(catalog["硕士"]), len(beijing_grad_colleges | zhuhai_grad_colleges))
        self.assertNotIn("系统科学学院", catalog["本科"], "无本科专业的学院不应出现在本科层")

    def test_grad_entries_are_track_tagged_academic_first(self):
        catalog = self._get()
        lit = catalog["硕士"]["文学院"]
        self.assertEqual(lit[0], {"name": "中国语言文学", "track": "academic"})
        self.assertIn("核科学与技术", [e["name"] for e in catalog["硕士"]["文理学院"]])
        tracks = [e["track"] for e in catalog["硕士"]["经济与工商管理学院"]]
        self.assertEqual(tracks, sorted(tracks, key=lambda t: 0 if t == "academic" else 1))

    def test_undergrad_entries_dict_with_department(self):
        """本科条目为 {name, department?}：文理学院带系分组，其余学院平铺不带字段。"""
        catalog = self._get()
        fas = catalog["本科"]["文理学院"]
        ai = next(e for e in fas if e["name"] == "人工智能")
        self.assertEqual(ai, {"name": "人工智能", "department": "数据科学与大数据技术系"})
        # 系组按建库目录顺序出现（中文系在先、统计系收尾）
        depts = list(dict.fromkeys(e["department"] for e in fas))
        self.assertEqual(depts[0], "中文系")
        self.assertEqual(depts[-1], "统计系")
        wen = catalog["本科"]["文学院"]
        self.assertEqual(wen, [{"name": "汉语言文学"}], "无系建制学院不带 department 字段")

    def test_level_filter(self):
        payload = self._get("/api/majors/?level=博士")
        self.assertEqual(list(payload.keys()), ["博士"])

    def test_inactive_majors_hidden(self):
        Major.objects.filter(college__name="文学院", level="硕士").update(is_active=False)
        from django.core.cache import cache
        cache.clear()
        catalog = self._get()
        # 文学院硕博专业全部停用后，该学院从硕士层目录中整体消失
        self.assertNotIn("文学院", catalog["硕士"])


class MigrateGradIdentityMajorsTest(TestCase):
    def setUp(self):
        _make_colleges()
        _make_tree()
        _seed_apply()

    def _make_grad_user(self, sid, education, college, major):
        user = create_user(sid, first_name="硕博同学")
        profile = user.profile
        profile.identity_education = education
        profile.identity_college = college
        profile.identity_major = major
        profile.save()
        return user

    def test_dry_run_writes_nothing(self):
        user = self._make_grad_user(
            "209922001001@mail.bnu.edu.cn", "硕士", "文学院", "汉语言文学（励耘项目）")
        output = StringIO()
        call_command("migrate_grad_identity_majors", stdout=output)
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.identity_major, "汉语言文学（励耘项目）")
        self.assertIn("预览模式", output.getvalue())

    def test_exact_match_kept(self):
        user = self._make_grad_user(
            "209922061001@mail.bnu.edu.cn", "硕士", "心理学部", "心理学")
        call_command("migrate_grad_identity_majors", "--apply", stdout=StringIO())
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.identity_major, "心理学")

    def test_parenthetical_suffix_normalized(self):
        user = self._make_grad_user(
            "209922080001@mail.bnu.edu.cn", "硕士", "文学院", "汉语言文学（励耘项目）")
        call_command("migrate_grad_identity_majors", "--apply", stdout=StringIO())
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.identity_major, "中国语言文学")

    def test_double_degree_label_normalized_to_base(self):
        """双学位长标签的前缀命中目录时也要改写（不能因前缀命中而保留原标签）。"""
        user = self._make_grad_user(
            "209922041001@mail.bnu.edu.cn", "硕士", "社会学院", "社会学+心理学双学士学位")
        call_command("migrate_grad_identity_majors", "--apply", stdout=StringIO())
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.identity_major, "社会学")

    def test_alias_match(self):
        user = self._make_grad_user(
            "209933180001@mail.bnu.edu.cn", "博士", "环境学院", "环境工程")
        call_command("migrate_grad_identity_majors", "--apply", stdout=StringIO())
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.identity_major, "环境科学与工程")

    def test_no_match_falls_back_to_other(self):
        user = self._make_grad_user(
            "209922130001@mail.bnu.edu.cn", "硕士", "数学科学学院", "数据科学与大数据技术")
        call_command("migrate_grad_identity_majors", "--apply", stdout=StringIO())
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.identity_major, "其他")

    def test_match_is_college_scoped(self):
        # 专业名命中目录但属于其他学院：不跨学院猜测，落「其他」
        user = self._make_grad_user(
            "209922080002@mail.bnu.edu.cn", "硕士", "文学院", "心理学")
        call_command("migrate_grad_identity_majors", "--apply", stdout=StringIO())
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.identity_major, "其他")
        self.assertEqual(user.profile.identity_college, "文学院", "迁移不应改动学院标签")

    def test_undergrad_and_other_users_untouched(self):
        user = create_user("209961030003@mail.bnu.edu.cn", first_name="本科同学")
        profile = user.profile
        profile.identity_education = "本科"
        profile.identity_college = "文学院"
        profile.identity_major = "汉语言文学"
        profile.save()
        grad_other = self._make_grad_user(
            "209922080003@mail.bnu.edu.cn", "硕士", "心理学部", "其他")
        blank = create_user("209922080004@mail.bnu.edu.cn", first_name="未填同学")
        call_command("migrate_grad_identity_majors", "--apply", stdout=StringIO())
        profile.refresh_from_db()
        self.assertEqual(profile.identity_major, "汉语言文学", "本科用户不参与迁移")
        grad_other.profile.refresh_from_db()
        self.assertEqual(grad_other.profile.identity_major, "其他", "已是「其他」的不动")
        blank.profile.refresh_from_db()
        self.assertEqual(blank.profile.identity_major, "", "空标签不动")

    def test_doctor_users_match_doctor_catalog(self):
        user = self._make_grad_user(
            "209933120001@mail.bnu.edu.cn", "博士", "政府管理学院", "公共事业管理")
        call_command("migrate_grad_identity_majors", "--apply", stdout=StringIO())
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.identity_major, "公共管理学")

    def test_discipline_level_aliases(self):
        """学科级别名：英语→外国语言文学、数学与应用数学→数学；
        与专硕类别同名近名的优先专硕：金融学→金融、会计学→会计。"""
        user_en = self._make_grad_user(
            "209922100001@mail.bnu.edu.cn", "硕士", "外国语言文学学院", "英语")
        user_fin = self._make_grad_user(
            "209922030001@mail.bnu.edu.cn", "硕士", "经济与工商管理学院", "金融学")
        user_acc = self._make_grad_user(
            "209922030002@mail.bnu.edu.cn", "硕士", "经济与工商管理学院", "会计学")
        user_math = self._make_grad_user(
            "209933130001@mail.bnu.edu.cn", "博士", "数学科学学院", "数学与应用数学")
        call_command("migrate_grad_identity_majors", "--apply", stdout=StringIO())
        user_en.profile.refresh_from_db()
        user_fin.profile.refresh_from_db()
        user_acc.profile.refresh_from_db()
        user_math.profile.refresh_from_db()
        self.assertEqual(user_en.profile.identity_major, "外国语言文学")
        self.assertEqual(user_fin.profile.identity_major, "金融")
        self.assertEqual(user_acc.profile.identity_major, "会计")
        self.assertEqual(user_math.profile.identity_major, "数学")
