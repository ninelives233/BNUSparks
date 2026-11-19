"""课表导入解析回归（纯前端解析，可选 Playwright）。

教务「学生选课课程表」被 WPS/Excel 打开再保存后：<thead>/<tbody> 消失、
「总<br>学时」等表头拆成 rowspan 两行、display:none 隐藏列变成无表头空列、
学号/姓名行可能被用户清空。旧解析器只在 thead 里找表头，这类文件解析出 0 门课。
本测试用脱敏的合成文件锁定：原始导出结果不变；重存文件解析出同一组课程；
另存为真 Excel（含/不含合并单元格信息）同样可解析；噪声行不成为课程。

BNU_BROWSER_TESTS=1 python3 manage.py test --settings=bnusparks.settings_test \\
    materials.tests.test_timetable_import_browser
"""
import importlib.util
import json
import os
import re
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from django.conf import settings
from django.contrib.staticfiles.testing import StaticLiveServerTestCase
from django.core.cache import cache
from django.db import connections
from django.test import SimpleTestCase

from materials.models import Course
from materials.services.course_codes import placeholder_code
from .helpers import AuthClient, _make_jwt, create_category, create_college, create_course, create_material, create_user

ROOT = Path(settings.BASE_DIR)

# 三门课的公共数据行：课程名 | 总学时 | 学分 | 上课班号 | 任课教师 | 上课时间、地点 | 修读性质 | 辅修标志 | 是否免听
COURSE_ROWS = (
    ('[ECO12004]中级微观经济学', '48', '3.0', '04', '教师甲', '1-16周 三[5-7] 八402(60)', '初修', '主修', '否'),
    ('[GEN01242]武术与强身避险', '32', '1.0', '01', '教师乙',
     '1-16周(单) 五[7-8] 邱季端体武馆-109(30),1-16周(双) 六[11-12] 网上自学(400)', '初修', '主修', '否'),
    ('[GEN01103]马克思主义基本原理', '64', '2.0', '16', '教师丙;教师丁',
     '1-8周 二[7-8] 九304(102),9-16周 二[7-8] 九304(102)', '初修', '主修', '否'),
)


def _cells(values, **attrs):
    extra = ''.join(' %s="%s"' % kv for kv in attrs.items())
    return ''.join('<td%s>%s</td>' % (extra, v) for v in values)


def original_export_html():
    """教务原始导出：表格外的个人信息文字 + 单行 thead（<br> 换行表头）+ display:none 隐藏列。
    元素之间保留真实文件里的换行缩进（textContent 里靠它们分隔相邻文字）。"""
    rows = []
    for i, row in enumerate(COURSE_ROWS):
        hidden = _cells(('202500000000', '03', row[0][1:9], row[0][1:9] + '-' + row[3]), style='display: none')
        rows.append('\n\t\t<tr>%s%s%s</tr>' % (_cells(row), _cells(('2026-06-10 20:01:33', '示例同学')), hidden))
    return (
        '\r\n\r\n<!DOCTYPE html>\n<html>\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=GBK" />\n'
        '<style>td { vnd.ms-excel.numberformat:@ }</style>\n</head>\n<body>\n'
        '<div>北京师范大学学生选课课程表</div>\n<div>（2026-2027学年秋季学期）</div>\n'
        '<div>学号：202500000000&ensp;姓名：示例同学&ensp;所在班级：示例专业2025</div>\n'
        '<div>选课课程门数：3&ensp; 总学分：6.0&ensp;</div>\n'
        '<table>\n\t<thead>\n\t\t<tr>\n'
        '\t\t\t<td>[课程号]课程名</td>\n\t\t\t<td>总<br>学时</td>\n\t\t\t<td>学分</td>\n\t\t\t<td>上课<br>班号</td>\n\t\t\t<td>任课教师</td>\n'
        '\t\t\t<td>上课时间、地点</td>\n\t\t\t<td>修读<br>性质</td>\n\t\t\t<td>辅修<br>标志</td>\n\t\t\t<td>是否<br>免听</td>\n'
        '\t\t\t<td>选课时间</td>\n\t\t\t<td>提交人</td>\n\t\t</tr>\n\t</thead>\n'
        '\t<tbody>%s\n\t</tbody>\n</table>\n</body>\n</html>' % ''.join(rows)
    )


def wps_resaved_html(identity=False):
    """WPS 另存：无 thead/tbody，表头 rowspan 两行，隐藏列变成无表头空列，末尾空行。
    identity=False 对应用户删掉学号/姓名后留下的空行。"""
    blank14 = '<td colspan="14"></td>'
    sid = '<td x:str>学号：202500000000</td>' if identity else '<td>\n</td>'
    name = '<td x:str>姓名：示例同学</td>' if identity else '<td>\n</td>'
    rows = []
    for row in COURSE_ROWS:
        tail = (('2026-06-10 20:01:33', '示例同学', '202500000000', '03', row[0][1:9], row[0][1:9] + '-' + row[3])
                if identity else ('',) * 6)
        rows.append('<tr>%s%s</tr>' % (_cells(row, **{'x:str': ''}), _cells(tail)))
    head_tail = _cells(('选课时间', '提交人'), rowspan='2') if identity else '<td rowspan="2"></td><td rowspan="2"></td>'
    return (
        '<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" '
        'xmlns:x="urn:schemas-microsoft-com:office:excel"><head>'
        '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>'
        '<table border="0" cellpadding="0" cellspacing="0">'
        '<tr><td colspan="3" x:str>北京师范大学学生选课课程表</td>' + '<td></td>' * 12 + '</tr>'
        '<tr><td x:str>（2026-2027学年秋季学期）</td>' + blank14 + '</tr>'
        '<tr>' + sid + blank14 + '</tr>'
        '<tr>' + name + blank14 + '</tr>'
        '<tr><td x:str>所在班级：示例专业2025</td>' + blank14 + '</tr>'
        '<tr><td x:str>选课课程门数：3  总学分：6.0 </td>' + blank14 + '</tr>'
        '<tr><td rowspan="2" x:str>[课程号]课程名</td><td x:str>总</td><td rowspan="2" x:str>学分</td>'
        '<td x:str>上课</td><td rowspan="2" x:str>任课教师</td><td rowspan="2" x:str>上课时间、地点</td>'
        '<td x:str>修读</td><td x:str>辅修</td><td x:str>是否</td>' + head_tail +
        '<td colspan="3"></td><td></td></tr>'
        '<tr><td x:str>学时</td><td x:str>班号</td><td x:str>性质</td><td x:str>标志</td><td x:str>免听</td>'
        '<td colspan="3"></td><td></td></tr>'
        + ''.join(rows) +
        '<tr>' + '<td></td>' * 15 + '</tr>'
        '</table></body></html>'
    )


def week_grid_html():
    """「按周方式显示」网格导出经 WPS 重存后的样子：xkinfo 类名已丢失，只剩星期表头。"""
    return (
        '<html><body><table><tr><td></td>' + _cells(('星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日')) +
        '</tr><tr><td>上午</td><td>一</td><td></td><td>线性代数教师甲 1-16[1-2]二208</td>' + '<td></td>' * 5 +
        '</tr></table></body></html>'
    )


class TimetableParserSourceContractTest(SimpleTestCase):
    """默认套件可跑的结构守门：表头定位不得退回只认 <thead> 的实现。"""

    def test_grid_based_header_detection(self):
        src = (ROOT / 'public/js/timetable.js').read_text(encoding='utf-8')
        for token in ('function ttTableGrid(', 'function ttSheetGrid(', 'function ttGridCourses(',
                      'function ttReadMetaText(', 'TT_NOISE_NAME', "'rowspan'", "'!merges'"):
            self.assertIn(token, src)
        self.assertNotIn("'thead td, thead th'", src)
        self.assertNotIn("'tbody tr'", src)

    def test_graduate_linkage_symbols_and_asset_version(self):
        src = (ROOT / 'public/js/timetable.js').read_text(encoding='utf-8')
        for token in ('function ttShowAdoptPlaceholderModal(', 'function ttPlaceholderForCourse(',
                      'function ttOpenNewCourse(', '/api/courses/adopt-code/',
                      'if (parsed.noLink) { importWithoutDirectory(); return; }',
                      '<header><h3>确认关联并补码</h3></header><div class="tt-mbody">'):
            self.assertIn(token, src)
        loader = (ROOT / 'public/js/feature-loader.js').read_text(encoding='utf-8')
        index = (ROOT / 'public/index.html').read_text(encoding='utf-8')
        version = re.search(r"var VERSION = '([^']+)'", loader).group(1)
        self.assertIn('feature-loader.js?v=' + version, index)
        self.assertIn("'timetable.js'", loader)
        self.assertIn("'newcourse.js'", loader)


@unittest.skipUnless(os.environ.get('BNU_BROWSER_TESTS') == '1' and importlib.util.find_spec('playwright'),
                     '设置 BNU_BROWSER_TESTS=1 并安装 Playwright 后运行浏览器验收')
class GraduateTimetableLinkageBrowserTest(StaticLiveServerTestCase):
    def setUp(self):
        from playwright.sync_api import sync_playwright

        cache.clear()
        self.college = create_college('经济与工商管理学院', 'econ-browser')
        root = create_category('专业课')
        college_node = create_category(self.college.name, parent=root)
        master = create_category('硕士', parent=college_node)
        master.education_level = '硕士'
        master.save(update_fields=['education_level'])
        self.major = create_category('理论经济学', parent=master)
        self.exact = create_course('ECON2001', '高级微观经济学', self.college, 'major')
        self.exact_leaf = create_category(self.exact.name, parent=self.major, course=self.exact)
        self.old_code = placeholder_code(self.college.id, '高级宏观经济学')
        self.placeholder = create_course(self.old_code, '高级宏观经济学', self.college, 'major')
        create_category(self.placeholder.name, parent=self.major, course=self.placeholder)
        self.user = create_user('graduate_browser')
        self.user.profile.identity_education = '硕士'
        self.user.profile.identity_college = self.college.name
        self.user.profile.identity_major = self.major.name
        self.user.profile.save()
        create_material(self.placeholder, self.user, review_status='approved')
        client = AuthClient()
        client.set_token(self.user)
        self.assertEqual(client.post_json('/api/auth/tutorial/', {'action': 'dismiss_offer'}).status_code, 200)
        self.pw = sync_playwright().start()
        self.addCleanup(self.pw.stop)
        self.browser = getattr(self.pw, os.environ.get('BNU_BROWSER_ENGINE', 'chromium')).launch()
        self.addCleanup(self.browser.close)
        self.context = self.browser.new_context(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce')
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.add_init_script("""(() => {
          const s = %s;
          sessionStorage.setItem('token', s.token);
          localStorage.setItem('bnusparks_user_id', String(s.uid));
          localStorage.setItem('bnusparks_timetable_view_u' + s.uid, 'list');
        })();""" % json.dumps({'uid': self.user.id, 'token': _make_jwt(self.user.id)}))
        self.page.goto(self.live_server_url + '/timetable')
        self.page.wait_for_function('typeof ttSetView === "function" && currentUser && document.getElementById("ttFileInput")')

    def tearDown(self):
        self.assertEqual(self.errors, [])

    @staticmethod
    def db_call(func, **kwargs):
        def call():
            try:
                return func(**kwargs)
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(call).result()

    @staticmethod
    def graduate_html():
        html = original_export_html()
        for old, new in zip(
            ('[ECO12004]中级微观经济学', '[GEN01242]武术与强身避险', '[GEN01103]马克思主义基本原理'),
            ('[ECON2001]高级微观经济学', '[ECON2002]高级宏观经济学', '[ECON2999]计量经济学'),
        ):
            html = html.replace(old, new)
        return html

    def import_graduate(self):
        self.page.locator('#ttFileInput').set_input_files({
            'name': 'graduate.html', 'mimeType': 'text/html', 'buffer': self.graduate_html().encode('utf-8'),
        })
        self.page.locator('[aria-label="确认导入课表"]').wait_for()
        self.page.locator('#ttConfirmImport').click()
        self.page.wait_for_function('ttState.data && ttState.data.courses.length === 3')
        self.page.locator('.tt-lrow[data-code="ECON2001"]').wait_for()

    def test_graduate_import_and_exact_code_opens_materials(self):
        self.import_graduate()
        self.page.wait_for_function("ttState.links['ECON2001'] && ttState.links['ECON2001'].state === 'linked'")
        self.page.locator('.tt-lrow[data-code="ECON2001"]').click()
        self.page.wait_for_selector('#explorerView.active, #plazaView.active')
        self.page.wait_for_function("(typeof expPath !== 'undefined' && expPath.includes('高级微观经济学')) || location.search.includes('category_id=%s')" % self.exact_leaf.id)

    def test_adopt_placeholder_code_preserves_material_and_alias(self):
        self.import_graduate()
        self.page.wait_for_function("ttState.links['ECON2002'] && ttState.links['ECON2002'].placeholder")
        self.page.locator('.tt-lrow[data-code="ECON2002"]').click()
        dialog = self.page.locator('[aria-label="确认关联课程"]')
        dialog.wait_for()
        self.assertEqual(dialog.locator('.tt-mbody').count(), 1)
        with self.page.expect_response(lambda response: '/api/courses/adopt-code/' in response.url and response.request.method == 'POST') as response:
            dialog.locator('[data-adopt]').click()
        self.assertEqual(response.value.status, 200)
        self.page.wait_for_function("ttState.links['ECON2002'] && ttState.links['ECON2002'].state === 'linked' && ttState.links['ECON2002'].fileCount === 1")
        self.assertIn('1 份资料', self.page.locator('.tt-lrow[data-code="ECON2002"]').inner_text())
        self.db_call(self.placeholder.refresh_from_db)
        self.assertEqual(self.placeholder.code, 'ECON2002')
        alias = self.db_call(Course.objects.get, code=self.old_code)
        self.assertEqual(alias.merged_into_id, self.placeholder.id)
        self.assertEqual(self.db_call(self.placeholder.materials.count), 1)

    def test_missing_code_prefills_graduate_new_course(self):
        self.import_graduate()
        self.page.wait_for_function("ttState.links['ECON2999'] && ttState.links['ECON2999'].state === 'missing' && !ttState.links['ECON2999'].quick")
        self.page.locator('.tt-lrow[data-code="ECON2999"]').click()
        self.page.wait_for_selector('#newCourseView.active')
        self.page.wait_for_function("document.getElementById('ncMCollegeSearch').value === '经济与工商管理学院' && document.getElementById('ncMMajor').selectedOptions[0]?.textContent.trim() === '理论经济学'")
        self.assertEqual(self.page.locator('#ncMName').input_value(), '计量经济学')
        self.assertEqual(self.page.locator('#ncMCode').input_value(), 'ECON2999')

    def test_binary_excel_no_link_stays_local(self):
        self.page.add_script_tag(path=str(ROOT / 'public/js/xlsx.full.min.js'))
        payload = self.page.evaluate("""html => {
          const book = XLSX.read(html, {type: 'string', raw: true});
          return Array.from(new Uint8Array(XLSX.write(book, {type: 'array', bookType: 'xlsx'})));
        }""", self.graduate_html())
        self.page.locator('#ttFileInput').set_input_files({
            'name': 'zhuhai.xlsx', 'mimeType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'buffer': bytes(payload),
        })
        self.page.get_by_text('珠海校区资料跳转功能暂未上线', exact=False).wait_for()
        self.page.wait_for_function('ttState.data && ttState.data.noLink && ttState.data.courses.length === 3')
        self.assertEqual(self.page.locator('[aria-label="确认导入课表"]').count(), 0)
        row = self.page.locator('.tt-lrow[data-code="ECON2001"]')
        row.wait_for()
        self.assertEqual(self.page.locator('[data-tt-action="adopt"], [data-tt-action="newcourse"]').count(), 0)
        row.click()
        self.page.locator('.tt-detail').wait_for()
        self.assertEqual(self.page.locator('#explorerView.active, #plazaView.active, #newCourseView.active').count(), 0)
        self.assertEqual(self.page.get_by_text('关联补码').count(), 0)
        self.assertEqual(self.page.get_by_text('去建课').count(), 0)


@unittest.skipUnless(os.environ.get('BNU_BROWSER_TESTS') == '1' and importlib.util.find_spec('playwright'),
                     '设置 BNU_BROWSER_TESTS=1 并安装 Playwright 后运行浏览器验收')
class TimetableImportParserBrowserTest(SimpleTestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from playwright.sync_api import sync_playwright
        cls.pw = sync_playwright().start()
        cls.browser = getattr(cls.pw, os.environ.get('BNU_BROWSER_ENGINE', 'chromium')).launch()
        cls.page = cls.browser.new_page()
        cls.errors = []
        cls.page.on('pageerror', lambda err: cls.errors.append(str(err)))
        cls.page.set_content('<html><body></body></html>')
        # timetable.js 的解析函数只在调用时引用这些全局符号
        cls.page.evaluate("window.currentUser = {id: 1}; window.esc = String; window.api = function () { return Promise.resolve({}); };")
        cls.page.add_script_tag(path=str(ROOT / 'public/js/xlsx.full.min.js'))
        cls.page.add_script_tag(path=str(ROOT / 'public/js/timetable.js'))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        super().tearDownClass()

    def tearDown(self):
        self.assertEqual(self.errors, [])

    # ── 助手 ──
    def parse_html(self, html):
        return json.loads(self.page.evaluate('(t) => JSON.stringify(ttParseImport(t))', html))

    def parse_as_excel(self, html, book_type='xlsx', drop_merges=False):
        """在页面内用 SheetJS 把 HTML 表转成真 Excel（文本原样保留），再走二进制解析路径。"""
        return json.loads(self.page.evaluate(
            """async ([html, bookType, dropMerges]) => {
                const wb = XLSX.read(html, { type: 'string', raw: true });
                if (dropMerges) wb.SheetNames.forEach((n) => { delete wb.Sheets[n]['!merges']; });
                const buf = XLSX.write(wb, { type: 'array', bookType });
                if (!ttIsBinaryExcel(buf)) throw new Error('not binary');
                return JSON.stringify(await ttParseBinaryExcel(buf));
            }""", [html, book_type, drop_merges]))

    @staticmethod
    def course_rows(parsed):
        keys = ('code', 'name', 'hours', 'credits', 'classNo', 'nature', 'teachers', 'timeRaw', 'meetings')
        return [{k: c.get(k) for k in keys} for c in parsed['courses']]

    def assert_three_courses(self, parsed):
        rows = self.course_rows(parsed)
        self.assertEqual([r['code'] for r in rows], ['ECO12004', 'GEN01242', 'GEN01103'])
        self.assertEqual([r['name'] for r in rows], ['中级微观经济学', '武术与强身避险', '马克思主义基本原理'])
        # 拆成两行的表头「总/学时」「上课/班号」「修读/性质」必须拼回并映射到列
        self.assertEqual([r['hours'] for r in rows], ['48', '32', '64'])
        self.assertEqual([r['classNo'] for r in rows], ['04', '01', '16'])
        self.assertEqual([r['nature'] for r in rows], ['初修'] * 3)
        self.assertEqual([r['credits'] for r in rows], ['3.0', '1.0', '2.0'])
        self.assertEqual(rows[2]['teachers'], ['教师丙', '教师丁'])
        first = rows[0]['meetings']
        self.assertEqual(len(first), 1)
        self.assertEqual({k: first[0][k] for k in ('day', 'ps', 'pe', 'ws', 'we', 'room')},
                         {'day': 3, 'ps': 5, 'pe': 7, 'ws': 1, 'we': 16, 'room': '八402'})
        self.assertEqual(len(rows[1]['meetings']), 2)
        self.assertEqual(len(rows[2]['meetings']), 1, '分周同格的两段应合并为 1-16 周')
        return rows

    # ── 用例 ──
    def test_original_export_baseline(self):
        parsed = self.parse_html(original_export_html())
        self.assert_three_courses(parsed)
        self.assertIsNone(parsed.get('rejected'))
        self.assertNotIn('noLink', parsed)
        self.assertEqual(parsed['meta'], {
            'semester': '2026-2027学年秋季学期', 'studentName': '示例同学', 'studentId': '202500000000',
            'className': '示例专业2025', 'courseCount': 3, 'credits': '6.0', 'sourceFormat': 'detail-table'})

    def test_wps_resave_without_thead_and_blank_identity_rows(self):
        baseline = self.course_rows(self.parse_html(original_export_html()))
        parsed = self.parse_html(wps_resaved_html(identity=False))
        self.assertEqual(self.course_rows(parsed), baseline)
        self.assertIsNone(parsed.get('rejected'))
        self.assertEqual(parsed['meta']['studentId'], '')
        self.assertEqual(parsed['meta']['studentName'], '')
        self.assertEqual(parsed['meta']['className'], '示例专业2025')
        self.assertEqual(parsed['meta']['courseCount'], 3)
        self.assertEqual(parsed['meta']['credits'], '6.0')
        self.assertEqual(parsed['meta']['sourceFormat'], 'detail-table')

    def test_wps_resave_with_identity_and_exposed_hidden_columns(self):
        baseline = self.course_rows(self.parse_html(original_export_html()))
        parsed = self.parse_html(wps_resaved_html(identity=True))
        self.assertEqual(self.course_rows(parsed), baseline)
        self.assertEqual(parsed['meta']['studentId'], '202500000000')
        self.assertEqual(parsed['meta']['studentName'], '示例同学')

    def test_identity_text_without_whitespace_between_cells(self):
        squeezed = re.sub(r'>\s+<', '><', wps_resaved_html(identity=True))
        parsed = self.parse_html(squeezed)
        self.assertEqual(len(parsed['courses']), 3)
        self.assertEqual(parsed['meta']['studentId'], '202500000000')
        self.assertEqual(parsed['meta']['studentName'], '示例同学')
        self.assertEqual(parsed['meta']['className'], '示例专业2025')

    def test_noise_rows_below_table_are_not_courses(self):
        tail = ('<tr><td>合计</td><td></td><td>6.0</td>' + '<td></td>' * 12 + '</tr>'
                '<tr><td>学号：202500000000</td></tr><tr><td>姓名：示例同学</td></tr><tr><td>备注：仅供参考</td></tr>')
        html = wps_resaved_html().replace('</table>', tail + '</table>')
        parsed = self.parse_html(html)
        self.assertEqual([c['code'] for c in parsed['courses']], ['ECO12004', 'GEN01242', 'GEN01103'])

    def test_course_table_nested_in_layout_table(self):
        inner = re.search(r'<table.*</table>', wps_resaved_html(), re.S).group(0)
        parsed = self.parse_html('<html><body><table><tr><td>页眉</td></tr><tr><td>%s</td></tr></table></body></html>' % inner)
        self.assertEqual(len(parsed['courses']), 3)

    def test_week_grid_resave_without_xkinfo_is_rejected(self):
        parsed = self.parse_html(week_grid_html())
        self.assertEqual(parsed.get('rejected'), 'grid')
        self.assertEqual(parsed['courses'], [])

    def test_binary_excel_resave_keeps_two_row_header(self):
        baseline = self.course_rows(self.parse_html(original_export_html()))
        for book_type in ('xlsx', 'biff8'):
            parsed = self.parse_as_excel(wps_resaved_html(), book_type=book_type)
            self.assertEqual(self.course_rows(parsed), baseline, book_type)
            self.assertTrue(parsed.get('noLink'))
            self.assertEqual(parsed['meta']['sourceFormat'], 'detail-table-xls')
            self.assertEqual(parsed['meta']['className'], '示例专业2025')

    def test_binary_excel_without_merge_info_still_joins_header_rows(self):
        baseline = self.course_rows(self.parse_html(original_export_html()))
        parsed = self.parse_as_excel(wps_resaved_html(), drop_merges=True)
        self.assertEqual(self.course_rows(parsed), baseline)

    def test_degenerate_inputs(self):
        for html in ('', 'hello', '<table><tr><td>a</td><td>b</td></tr></table>'):
            parsed = self.parse_html(html)
            self.assertEqual(parsed['courses'], [])
            self.assertIsNone(parsed.get('rejected'))
