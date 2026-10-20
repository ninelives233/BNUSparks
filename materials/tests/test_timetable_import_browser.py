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
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

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
