"""移动端（≤768px）课程资料列表与文件详情前端契约回归（v=205/340）。

移动布局与桌面共用同一份数据、筛选与批量选择状态：列表改纵向资料行、
筛选排序合并为底部面板、分页移到列表底部而每页条数并入面板；详情页以
面包屑承担返回定位（无独立返回行）、两行文字属性、紧凑上传者与统计、
举报收进「更多」菜单、原始文件名进「文件信息」折叠区、预览紧跟操作区。
桌面表格与既有按钮布局必须原样保留，此处一并守门防止回退。
"""
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
        """详情页移动分支：面包屑定位无返回行、两行文字属性、紧凑统计、更多菜单、文件信息折叠区"""
        for token in (
            "_fdIsMobile",
            # 两行纯文字属性：类型蓝字 + 扩展名/大小，教师/日期缺失省略
            "fdm-attr",
            "fdm-attr-type",
            "fdm-attr-dot",
            "extLabel(file.file_name",
            "' 上传'",
            # 统计行点分隔、无分隔线
            "fdm-stats",
            # 更多菜单/简介/文件信息折叠/预览重试
            "openFdMoreSheet",
            "closeFdMoreSheet",
            "fdToggleDesc",
            "fdAddDesc",
            "原始文件名",
            "retryFdPreview",
        ):
            self.assertIn(token, self.file)
        # 返回定位由面包屑承担：独立返回行与 fdBackToCourse 已删除
        self.assertNotIn("fdBackToCourse", self.file)
        self.assertNotIn("fdBackRow", self.file)
        self.assertNotIn("fdBackRow", self.index)
        # PDF 预览提示移动端简化为「前 3 页」（桌面文案保留）
        self.assertIn("前 3 页", self.file)
        self.assertIn("预览最多显示前三页", self.file)
        # 无简介不再渲染空卡片（占位句仅剩桌面分支使用）
        self.assertIn("fdm-desc-add", self.file)
        # 下载为唯一主按钮 + 收藏次按钮 + 更多菜单
        self.assertIn("fdm-dl-btn", self.file)
        self.assertIn("fd-more-btn", self.file)
        # 上传者行带主页箭头并可键盘触发；移动端不带「上传」文字标签
        self.assertIn("fdu-arrow", self.file)
        self.assertIn("查看主页", self.file)
        self.assertIn("showUserPublic", self.file)

    def test_detail_desktop_layout_preserved(self):
        """桌面详情：竖线元信息行、举报按钮与上传者卡片布局不变"""
        self.assertIn("fd-meta-sep", self.file)
        self.assertIn('id="fdRepBtn"', self.file)
        self.assertIn("上传者", self.file)
        self.assertNotIn("@media (max-width: 480px)", self.files_css)

    def test_detail_mobile_css_compact_layout(self):
        """移动详情样式：info-area 透明化排序（预览紧跟操作）、面包屑触控扩展、轻描边"""
        # 预览通过 order 排到操作按钮之后，简介再其后（桌面 DOM 顺序不变）
        self.assertIn(".fd-info-area { display: contents; }", self.files_css)
        self.assertIn(".fd-preview-area { order: 5;", self.files_css)
        self.assertIn(".fd-desc-area { order: 6;", self.files_css)
        # 面包屑 13px 且触控区无高度代价扩展
        self.assertIn(".fd-top-row .breadcrumb a::after", self.files_css)
        # 收藏/更多 1px 轻描边仅移动端（桌面 2px 品牌态保留）
        fav_1px = ".fd-actions-inner .fd-btn-fav {\n    padding: 8px 12px;\n    min-width: 80px;\n    justify-content: center;\n    white-space: nowrap;\n    border-width: 1px;\n  }"
        self.assertIn(fav_1px, self.files_css)
        self.assertIn(".fd-btn-fav { border-width: 2px; }", self.files_css)
        # 统计行无上下分隔线
        self.assertNotIn("border-top: 1px solid var(--border-light);\n    border-bottom: 1px solid var(--border-light);", self.files_css)

    def test_index_structure_and_icon(self):
        """详情视图包含移动端文件信息折叠区；漏斗图标符号可用；返回行已删除"""
        self.assertNotIn('id="fdBackRow"', self.index)
        self.assertIn('id="fdFileInfo"', self.index)
        self.assertIn('id="ui-icon-filter"', self.index)
        # iconSvg 白名单纳入 filter（漏斗）
        self.assertIn("document edit filter flag", self.utils)
        # 属性行复用共享扩展名取词（徽章与纯文字同源）
        self.assertIn("function extLabel", self.utils)

    def test_sheets_integrated_with_modal_and_popstate(self):
        """底部面板接入统一弹窗 Escape 链与浏览器返回关闭链"""
        self.assertIn(".mf-sheet-close", self.utils)
        self.assertIn(".fdm-sheet-close", self.utils)
        self.assertIn(".mf-sheet-overlay", self.app)
        self.assertIn(".fdm-sheet-overlay", self.app)
        self.assertIn("closeMobileFilterSheet", self.app)
        self.assertIn("closeFdMoreSheet", self.app)

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
