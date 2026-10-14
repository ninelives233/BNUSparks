"""移动端列表与详情的结构契约；实际排版与交互见 test_file_detail_browser。"""
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase


class MobileFileListContractTest(SimpleTestCase):
    def setUp(self):
        root = Path(settings.BASE_DIR)
        self.render = (root / "public/js/explorer-render.js").read_text(encoding="utf-8")
        self.file = (root / "public/js/explorer-file.js").read_text(encoding="utf-8")
        self.utils = (root / "public/js/utils.js").read_text(encoding="utf-8")
        self.app = (root / "public/js/app.js").read_text(encoding="utf-8")
        self.index = (root / "public/index.html").read_text(encoding="utf-8")
        self.files_css = (root / "public/css/files.css").read_text(encoding="utf-8")
        self.loader = (root / "public/js/feature-loader.js").read_text(encoding="utf-8")

    def test_mobile_shell_and_rows(self):
        """移动端标题行/工具栏/纵向资料行/批量工具与底部分页的关键结构"""
        for token in (
            "_mfHeaderHtml",
            "mf-course-name",
            "_mfBodyHtml",
            'id="mfFileList"',
            'id="mfBatchTools"',
            'id="mfBatchFooter"',
            'id="mfListEnd"',
            'id="mfBottom"',
            'id="mobileFilterBtn"',
            'id="mfSelectAllChk"',
            "_mfRowHtml",
            "mf-glyph",
            "mf-title",
            "mf-meta",
            'class="mf-dl"',
        ):
            self.assertIn(token, self.render)
        # 资料数量放在课程名下方（移动端单位为「份资料」）
        self.assertIn("' 份资料'", self.render)
        # 标题最多两行：CSS 行数钳制
        self.assertIn("-webkit-line-clamp: 2", self.files_css)
        self.assertIn(".mf-title", self.files_css)

    def test_desktop_table_preserved(self):
        """桌面保留表格与「— 资料列表」标题、原批量工具条"""
        self.assertIn("fileTableBody", self.render)
        self.assertIn(" — 资料列表", self.render)
        self.assertIn('id="batchDlBar"', self.render)
        # 桌面表头全量列仍在
        self.assertIn('class="th-uploader"', self.render)

    def test_filter_sheet_and_labels(self):
        """筛选与排序合并为一个入口；底部面板含类型/排序/每页条数/重置/应用"""
        for token in (
            "openMobileFilterSheet",
            "closeMobileFilterSheet",
            "mfSheetApply",
            "mfSheetReset",
            "_mfSheetOptionsHtml",
            "data-mf-type",
            "data-mf-sort",
            "每页条数",
            "data-mf-perpage",
            "mfSheetPerPageOpts",
            "_mfSheetPerPage",
            "_filterSortPageSize = _mfSheetPerPage",
            "重置",
            "应用",
        ):
            self.assertIn(token, self.render)
        # 资料不超过最小每页条数时，每页设置随面板省略
        self.assertIn("_allFilesCache.length > 10", self.render)
        # 按钮显示当前条件
        self.assertIn("mf-filter-label", self.render)
        self.assertIn("_MF_SORT_LABELS[_sortBy] || '上传时间'", self.file)

    def test_batch_mode_shared_state(self):
        """移动批量模式复用 _selectedIds/batchDownloadSelected，计数与全选同步"""
        self.assertIn("mfToggleSelectAll", self.render)
        self.assertIn("onDlChkChange(chk)", self.render)
        self.assertIn("mfBatchDlBtn", self.utils)
        self.assertIn("mfSelectedCount", self.utils)
        self.assertIn("'下载所选'", self.utils)
        self.assertIn("下载所选（' + count + '）", self.utils)
        # 删除资料后移动端行与计数同步移除
        self.assertIn('mf-row[data-file-id="', self.utils)

    def test_pagination_bottom_and_page_size_in_sheet(self):
        """移动端分页挂到底部容器；每页条数只存在于面板，底部不再有独立下拉"""
        self.assertIn("insertBefore(pag, mfBottom.firstChild)", self.render)
        # 移动端外壳的底部容器不再嵌每页条数下拉（桌面外壳仍保留原控件）
        self.assertIn('<div class="mf-bottom" id="mfBottom"></div>', self.render)
        # 分页显隐逻辑不再操作每页控件
        self.assertNotIn("ppcHide", self.render)
        self.assertNotIn("ppcShow", self.render)

    def test_detail_mobile_layout(self):
        """标题下完整简介、两列属性、并排统计和直接图标操作。"""
        for token in ('fdm-attrs', 'fdm-attr-label', 'fdm-stat', 'fdm-filename',
                      'fdm-icon-btn', 'aria-pressed', 'retryFdPreview', 'showUserPublic'):
            self.assertIn(token, self.file)
        self.assertIn("document.querySelector('.fd-title-area').appendChild(descEl)", self.file)
        self.assertIn("descEl.hidden = !hasDescription", self.file)
        for token in ('fdBackRow', 'fd-more-btn', 'openFdMoreSheet', 'fdToggleDesc', 'fdFileInfo'):
            self.assertNotIn(token, self.file)
        self.assertNotIn("hint.textContent = extType === 'pdf'", self.file)

    def test_detail_desktop_layout_preserved(self):
        """桌面详情：竖线元信息行、举报按钮与上传者卡片布局不变"""
        self.assertIn("fd-meta-sep", self.file)
        self.assertIn('id="fdRepBtn"', self.file)
        self.assertIn("上传者", self.file)
        self.assertNotIn("@media (max-width: 480px)", self.files_css)

    def test_detail_mobile_css_compact_layout(self):
        self.assertIn('grid-template-columns: repeat(2, minmax(0, 1fr))', self.files_css)
        self.assertIn('.fd-social-area { display: flex;', self.files_css)
        self.assertIn('flex: 0 0 44px; width: 44px;', self.files_css)
        self.assertIn('.fd-btn-fav { border-width: 2px; }', self.files_css)
        self.assertIn('.fd-top-row .breadcrumb a::after', self.files_css)
        self.assertNotIn('fd-fileinfo', self.files_css)
        self.assertNotIn('fd-more-btn', self.files_css)

    def test_index_structure_and_icon(self):
        """详情包含上传者/统计容器，无文件信息折叠；保留共享图标"""
        self.assertNotIn('id="fdBackRow"', self.index)
        self.assertNotIn('id="fdFileInfo"', self.index)
        self.assertIn('class="fd-social-area"', self.index)
        self.assertIn('id="ui-icon-filter"', self.index)
        # iconSvg 白名单纳入 filter（漏斗）
        self.assertIn("document edit filter flag", self.utils)
        # 属性行复用共享扩展名取词（徽章与纯文字同源）
        self.assertIn("function extLabel", self.utils)

    def test_sheets_integrated_with_modal_and_popstate(self):
        """底部面板接入统一弹窗 Escape 链与浏览器返回关闭链"""
        self.assertIn(".mf-sheet-close", self.utils)
        self.assertIn(".mf-sheet-overlay", self.app)
        self.assertIn("closeMobileFilterSheet", self.app)

    def test_lazy_loader_version_matches_index(self):
        """feature-loader 的 VERSION 与 index.html 引用的缓存键一致（懒加载资源 30 天缓存链）"""
        import re
        m = re.search(r"var VERSION = '(\d+)'", self.loader)
        self.assertTrue(m, "feature-loader 缺少 VERSION")
        v_ref = 'feature-loader.js?v=' + m.group(1)
        self.assertIn(v_ref, self.index)

    def test_breakpoint_rerender_keeps_state(self):
        """断点跨越用缓存数据重渲染并保留筛选/页码/多选状态"""
        self.assertIn("keepState", self.render)
        self.assertIn("_rerenderFilesForLayout", self.render)
        self.assertIn("matchMedia('(max-width: 768px)')", self.render)
        self.assertIn("matchMedia('(max-width: 768px)')", self.file)
