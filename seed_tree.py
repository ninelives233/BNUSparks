#!/usr/bin/env python3
"""
Seed: 课程导航树 — 写入 CourseCategory DB

这是导航树的唯一真实来源。改课程分类只需改下面的 TREE 字典，然后：
  python3 seed_tree.py

API /api/courses/tree 从 CourseCategory 表返回完整树，前端纯渲染。
"""

import os, sys
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "bnusparks.settings")
import django
django.setup()

from materials.models import Course, CourseCategory


# ═══════════════════════════════════════════════════════════════
# 课程导航树定义（与前端渲染逻辑完全同步）
# ═══════════════════════════════════════════════════════════════

def C(name, code, has_files=False):
    """叶子节点：课程"""
    return {"name": name, "courseId": code, "hasFiles": has_files}

TREE = {
    "通识课": {
        "children": [
            {"name": "思想政治理论类", "iconClass": "book", "children": [
                C("思想道德与法治", "GEN01101"),
                C("中国近现代史纲要", "GEN01102"),
                C("马克思主义基本原理", "GEN01103"),
                C("毛泽东思想和中国特色社会主义理论体系概论", "GEN01112"),
                C("习近平新时代中国特色社会主义思想概论", "GEN01113"),
                C("形势与政策", "GEN09001-GEN09008"),
            ]},
            {"name": "体育与健康类", "iconClass": "runner", "children": [
                C("女子形体 / 男子健身健美", "GEN01201"),
                C("三自选项课程（3门）", "GEN01203"),
            ]},
            {"name": "军事理论与军事技能", "iconClass": "shield", "children": [
                C("军事理论", "GEN01108", True),
                C("军事技能", "GEN01109"),
            ]},
            {"name": "大学外语类", "iconClass": "globe", "children": [
                C("通用英语进阶", "GEN02122", True),
                C("博雅英语听说", "GEN02123", True),
                C("思辨英语读写", "GEN02124"),
                {"name": "学术英语 / 人文通识课程群", "courseId": "GEN02***"},
            ]},
            {"name": "教师素养类", "iconClass": "board", "children": [
                C("教育学", "GEN06120", True),
                C("教育心理学", "GEN06121", True),
                C("现代教育技术", "GEN06122"),
                C("中国教育改革与发展", "GEN06123"),
            ]},
            {"name": "家国情怀与价值理想", "iconClass": "star", "children": [
                C("中国共产党历史", "GEN01114"),
                C("社会主义发展史", "GEN01115"),
                C("新中国史", "GEN01116"),
                C("改革开放史", "GEN01117"),
            ]},
            {"name": "艺术鉴赏与审美体验", "iconClass": "diamond", "children": [
                C("经典影视作品分析", ""),
                C("艺术作品中的国家形象", ""),
            ]},
            {"name": "数理基础与科学素养", "iconClass": "graph", "children": [
                C("信息处理技术", "GEN04221"),
                C("算法与程序设计（Python）", "GEN04237"),
                {"name": "算法与程序设计（C）", "courseId": "GEN04238"},
                C("人工智能导论", "GEN04251"),
                C("数据科学导论", "GEN04252"),
                C("计算思维导论", "GEN04222"),
                {"name": "深度学习技术与应用", "courseId": "GEN04254"},
                {"name": "大数据技术及应用", "courseId": "GEN04255"},
            ]},
            {"name": "社会发展与公民责任", "iconClass": "hands", "children": [
                C("大学心理Ⅰ", "GEN06124"),
                C("大学心理Ⅱ", "GEN06125"),
                C("国家安全导论", "GEN06706"),
            ]},
            {"name": "经典研读与文化传承", "iconClass": "scroll", "children": [
                C("经典研读与文化传承（模块课程）", "GEN02***"),
            ]},
            {"name": "数学类", "iconClass": "graph", "isMathCard": True, "children": [
                C("微积分I", "MAT01006"),
                C("微积分II", "MAT01007", True),
                C("线性代数", "MAT02008"),
                C("概率论与数理统计", "STA02001"),
                C("数学分析I", "MAT11001"),
                C("数学分析II", "MAT11002"),
                C("数学分析III", "MAT12005"),
                C("高等代数I", "MAT01004"),
                C("高等代数II", "MAT01005"),
            ]},
        ]
    },
    "专业课": {
        "children": [
            {"name": "经济与工商管理学院", "iconClass": "columns", "children": [
                # 金融学
                {"name": "金融学", "iconClass": "folder", "children": [
                    {"name": "专业必修课", "iconClass": "folder", "children": [
                        {"name": "专业基础课", "iconClass": "folder", "children": [
                            C("微积分I", "MAT01006"),
                            C("微积分II", "MAT01007"),
                            C("线性代数", "MAT02008"),
                            C("概率论与数理统计", "STA02001"),
                            C("统计学", "ECO12032"),
                            C("计量经济学", "ECO12031"),
                        ]},
                        {"name": "专业核心课", "iconClass": "folder", "children": [
                            C("社会主义经济理论", "ECO11001"),
                            C("微观经济学原理", "ECO01001"),
                            C("宏观经济学原理", "ECO01002"),
                            C("会计学", "ECO12002"),
                            C("金融学", "ECO12009"),
                            C("国际金融", "ECO12011"),
                            C("金融市场学", "ECO12033"),
                            C("保险学", "ECO12034"),
                            C("投资学", "ECO23037"),
                            C("公司金融", "ECO12035"),
                            C("财政学", "ECO23063"),
                        ]},
                    ]},
                    {"name": "专业选修课Ⅰ", "iconClass": "folder", "children": [
                        {"name": "专业方向课", "iconClass": "folder", "children": [
                            C("世界金融史", "ECO21001", True),
                            C("管理学", "ECO11003"),
                            C("政治经济学", "ECO12003"),
                            C("国际贸易学", "ECO12008"),
                            C("中级微观经济学", "ECO12004"),
                            C("中级宏观经济学", "ECO12005"),
                            C("商业银行学", "ECO23036"),
                            C("财务分析", "ECO23006"),
                            C("金融衍生工具", "ECO23080"),
                            C("博弈论与信息经济学", "ECO23025"),
                            C("行为金融学", "ECO23074"),
                            C("投资银行学", "ECO23038"),
                            C("固定收益证券", "ECO23081"),
                            C("金融风险管理", "ECO23082"),
                            C("基金管理与证券投资分析", "ECO23083"),
                            C("金融经济学", "ECO23084"),
                        ]},
                    ]},
                    {"name": "自由选修", "iconClass": "folder", "children": [
                        C("个性化发展选修", "GEN****"),
                    ]},
                    {"name": "实践环节", "iconClass": "folder", "children": [
                        C("学术训练与实践", "ECO33003"),
                        C("专业实习与社会调查", "ECO31003"),
                        C("毕业论文（设计）", "ECO41001"),
                    ]},
                ]},
                # 经济学（励耘）
                {"name": "经济学（励耘）", "iconClass": "folder", "children": [
                    {"name": "专业必修课", "iconClass": "folder", "children": [
                        {"name": "专业基础课", "iconClass": "folder", "children": [
                            C("数学分析I", "MAT11001"),
                            C("数学分析II", "MAT11002"),
                            C("数学分析III", "MAT12005"),
                            C("高等代数I", "MAT01004"),
                            C("高等代数II", "MAT01005"),
                            C("概率论与数理统计", "STA02001"),
                            C("微观经济学原理", "ECO01001"),
                            C("宏观经济学原理", "ECO01002"),
                            C("政治经济学", "ECO12003"),
                            C("中级微观经济学", "ECO12004"),
                            C("中级宏观经济学", "ECO12005"),
                            C("计量经济学", "ECO12031"),
                            C("时间序列分析", "ECO13005"),
                            C("经济思想史", "ECO12027"),
                            C("社会主义经济理论", "ECO11001"),
                        ]},
                        {"name": "专业核心课", "iconClass": "folder", "children": [
                            C("数字经济导论", "ECO12030"),
                            C("金融学", "ECO12009"),
                            C("会计学", "ECO11002"),
                            C("财政学", "ECO23063"),
                            C("实验经济学", "ECO22002"),
                            C("博弈论与信息经济学", "ECO23025"),
                            C("管理学", "ECO11003"),
                            C("国际贸易学", "ECO12008"),
                            C("国际金融", "ECO12011"),
                            C("经济史", "ECO22026"),
                        ]},
                    ]},
                    {"name": "专业选修课Ⅰ", "iconClass": "folder", "children": [
                        {"name": "专业方向课", "iconClass": "folder", "children": [
                            C("经济增长", "ECO22001"),
                            C("产业组织理论", "ECO23024"),
                            C("劳动经济学", "ECO23027"),
                            C("经济计量方法与应用", "ECO23030"),
                        ]},
                    ]},
                    {"name": "自由选修", "iconClass": "folder", "children": [
                        C("个性化发展选修", "GEN****"),
                    ]},
                    {"name": "实践环节", "iconClass": "folder", "children": [
                        C("大学生劳动教育", "EDU30001"),
                        C("劳动教育实践活动", "TLO30801"),
                        C("学术训练与实践", "ECO33003"),
                        C("专业实习与社会调查", "ECO31003"),
                        C("毕业论文（设计）", "ECO32003"),
                    ]},
                    {"name": "创新拔尖人才模块", "iconClass": "folder", "children": [
                        {"name": "专业选修课Ⅱ", "iconClass": "folder", "children": [
                            {"name": "专业拓展课", "iconClass": "folder", "children": [
                                C("行为经济学（英文）", "ECO23076"),
                                C("发展经济学（英文）", "ECO23077"),
                                C("创新经济学（英文）", "ECO23078"),
                                C("动态经济学方法", "ECO12029"),
                                C("环境与资源经济学", "ECO23020"),
                                C("国民经济核算", "ECO23079"),
                                C("《资本论》研读", "MAR20020"),
                                C("常微分方程", "MAT12003"),
                                C("实变函数", "MAT02002"),
                                C("泛函分析", "MAT23001"),
                                C("随机过程初步", "MAT23004"),
                                C("数据结构与算法", "ECO22018"),
                                C("数据库原理与应用", "ECO22017"),
                                C("机器学习", "ECO23071"),
                            ]},
                        ]},
                    ]},
                ]},
                # 金融科技
                {"name": "金融科技", "iconClass": "folder", "children": [
                    {"name": "专业必修课", "iconClass": "folder", "children": [
                        {"name": "专业基础课", "iconClass": "folder", "children": [
                            C("微积分I", "MAT01006"),
                            C("微积分II", "MAT01007"),
                            C("线性代数", "MAT02008"),
                            C("概率论与数理统计", "STA02001"),
                            C("统计学", "ECO12032"),
                            C("计量经济学", "ECO12031"),
                            C("数据结构与算法", "ECO22018"),
                        ]},
                        {"name": "专业核心课", "iconClass": "folder", "children": [
                            C("社会主义经济理论", "ECO11001"),
                            C("微观经济学原理", "ECO01001"),
                            C("宏观经济学原理", "ECO01002"),
                            C("会计学", "ECO12002"),
                            C("金融学", "ECO12009"),
                            C("国际金融", "ECO12011"),
                            C("金融市场学", "ECO12033"),
                            C("数字金融", "ECO12036"),
                            C("保险学", "ECO12034"),
                            C("金融大数据分析", "ECO23069"),
                            C("数据库原理与应用", "ECO22017"),
                            C("区块链与数字资产", "ECO23066"),
                        ]},
                    ]},
                    {"name": "专业选修课Ⅰ", "iconClass": "folder", "children": [
                        {"name": "专业方向课", "iconClass": "folder", "children": [
                            C("世界金融史", "ECO21001"),
                            C("管理学", "ECO11003"),
                            C("国际贸易学", "ECO12008"),
                            C("中级微观经济学", "ECO12004"),
                            C("中级宏观经济学", "ECO12005"),
                            C("商业银行学", "ECO23036"),
                            C("财务分析", "ECO23006"),
                            C("投资学", "ECO23037"),
                            C("公司金融", "ECO12035"),
                            C("金融衍生工具", "ECO23080"),
                            C("财政学", "ECO23063"),
                            C("行为金融学", "ECO23074"),
                            C("投资银行学", "ECO23038"),
                            C("固定收益证券", "ECO23081"),
                            C("金融风险管理", "ECO23082"),
                            C("机器学习", "ECO23071"),
                            C("金融经济学", "ECO23084"),
                        ]},
                    ]},
                    {"name": "自由选修", "iconClass": "folder", "children": [
                        C("个性化发展选修", "GEN****"),
                    ]},
                    {"name": "实践环节", "iconClass": "folder", "children": [
                        C("大学生劳动教育", "EDU30001"),
                        C("劳动教育实践活动", "TLO30801"),
                        C("学术训练与实践", "ECO33003"),
                        C("专业实习与社会调查", "ECO31003"),
                        C("毕业论文（设计）", "ECO41001"),
                    ]},
                ]},
                # 工商管理
                {"name": "工商管理", "iconClass": "folder", "children": [
                    {"name": "专业必修课", "iconClass": "folder", "children": [
                        {"name": "专业基础课", "iconClass": "folder", "children": [
                            C("微积分I", "MAT01006"),
                            C("微积分II", "MAT01007"),
                            C("线性代数", "MAT02008"),
                            C("概率论与数理统计", "STA02001"),
                            C("计量经济学", "ECO12031"),
                            C("统计学", "ECO12032"),
                            C("微观经济学原理", "ECO01001"),
                            C("管理学", "ECO11003"),
                        ]},
                        {"name": "专业核心课", "iconClass": "folder", "children": [
                            C("数字企业管理原理", "ECO22022"),
                            C("大数据原理和应用", "ECO12037"),
                            C("会计学", "ECO11002"),
                            C("市场营销", "ECO12038"),
                            C("组织行为学", "ECO12039"),
                            C("人力资源管理", "ECO12040"),
                            C("战略管理", "ECO12041"),
                            C("财务管理", "ECO12042"),
                            C("公司治理", "ECO13004"),
                            C("管理思想史", "ECO12043"),
                        ]},
                    ]},
                    {"name": "专业选修课Ⅰ", "iconClass": "folder", "children": [
                        {"name": "专业方向课", "iconClass": "folder", "children": [
                            C("供应链管理", "ECO23048"),
                            C("数字商务", "ECO23106"),
                            C("数字营销", "ECO23055"),
                            C("数字化运营管理", "ECO22023"),
                            C("管理信息系统", "ECO22009"),
                            C("数字品牌战略", "ECO23107"),
                            C("商业模式概论", "ECO22015"),
                            C("项目管理", "ECO22011"),
                            C("服务管理", "ECO22010"),
                            C("跨文化管理", "ECO22008"),
                            C("管理沟通", "ECO23041"),
                            C("职业生涯规划", "ECO23108"),
                            C("公共关系学", "ECO23047"),
                        ]},
                    ]},
                    {"name": "自由选修", "iconClass": "folder", "children": [
                        C("个性化发展选修", "GEN****"),
                    ]},
                    {"name": "实践环节", "iconClass": "folder", "children": [
                        C("大学生劳动教育", "EDU30001"),
                        C("劳动教育实践活动", "TLO30801"),
                        C("学术训练与实践", "ECO33003"),
                        C("专业实习与社会调查", "ECO31003"),
                        C("毕业论文（设计）", "ECO41001"),
                    ]},
                ]},
                # 会计学
                {"name": "会计学", "iconClass": "folder", "children": [
                    {"name": "专业必修课", "iconClass": "folder", "children": [
                        {"name": "专业基础课", "iconClass": "folder", "children": [
                            C("微积分I", "MAT01006"),
                            C("微积分II", "MAT01007"),
                            C("线性代数", "MAT02008"),
                            C("概率论与数理统计", "STA02001"),
                            C("计量经济学", "ECO12031"),
                            C("统计学", "ECO12032"),
                            C("微观经济学原理", "ECO01001"),
                            C("管理学", "ECO11003"),
                            C("宏观经济学原理", "ECO01002"),
                        ]},
                        {"name": "专业核心课", "iconClass": "folder", "children": [
                            C("会计学原理", "ECO12001"),
                            C("财务会计", "ECO12016"),
                            C("财务管理", "ECO13003"),
                            C("管理会计", "ECO12015"),
                            C("会计信息系统", "ECO13001"),
                            C("审计学", "ECO23001"),
                            C("税法", "ECO12014"),
                            C("商业伦理与企业社会责任", "ECO23009"),
                        ]},
                    ]},
                    {"name": "专业选修课Ⅰ", "iconClass": "folder", "children": [
                        {"name": "专业方向课", "iconClass": "folder", "children": [
                            C("成本会计", "ECO23114"),
                            C("政府与非营利组织会计", "ECO23005"),
                            C("高级财务会计", "ECO23115"),
                            C("财务分析", "ECO23006"),
                            C("国际财务管理", "ECO23008"),
                            C("战略管理", "ECO12041"),
                            C("公司治理", "ECO13004"),
                            C("组织行为学", "ECO12039"),
                            C("人力资源管理", "ECO12040"),
                            C("供应链管理", "ECO23048"),
                            C("金融学", "ECO12009"),
                            C("基金管理与证券投资分析", "ECO23083"),
                            C("金融风险管理", "ECO23082"),
                            C("财政学", "ECO23063"),
                            C("国际贸易学", "ECO12008"),
                            C("国际会计（英文）", "ECO23116"),
                            C("国际商务（英文）", "ECO23117"),
                            C("行为会计学", "ECO23118"),
                            C("大数据审计", "ECO23119"),
                            C("会计前沿专题", "ECO23120"),
                        ]},
                    ]},
                    {"name": "自由选修", "iconClass": "folder", "children": [
                        C("个性化发展选修", "GEN****"),
                    ]},
                    {"name": "实践环节", "iconClass": "folder", "children": [
                        C("大学生劳动教育", "EDU30001"),
                        C("劳动教育实践活动", "TLO30801"),
                        C("学术训练与实践", "ECO33003"),
                        C("专业实习与社会调查", "ECO31003"),
                        C("毕业论文（设计）", "ECO41001"),
                    ]},
                ]},
            ]},
            # 法学院
            {"name": "法学院", "iconClass": "scales", "children": [
                {"name": "法学", "iconClass": "folder", "children": [
                    {"name": "专业基础课", "iconClass": "folder", "children": [
                        C("法理学导论", "LAW01001", True),
                        C("宪法学", "LAW02002"),
                        C("习近平法治思想概论", "LAW01003", True),
                    ]},
                    {"name": "专业核心课", "iconClass": "folder", "children": [
                        C("法理学专论", "LAW13001"),
                        C("中国法律史", "LAW11001"),
                        C("民法总论", "LAW11002", True),
                        C("债与合同法学", "LAW11003", True),
                        C("刑法总论", "LAW11004"),
                        C("刑法分论", "LAW12001"),
                        C("行政法与行政诉讼法学", "LAW12002"),
                        C("民事诉讼法学", "LAW12003"),
                        C("刑事诉讼法学", "LAW12004"),
                        C("国际公法学", "LAW12005"),
                        C("经济法学", "LAW12006"),
                        C("公司法学", "LAW12007"),
                        C("知识产权法学", "LAW13002"),
                        C("环境资源法学", "LAW13003"),
                    ]},
                    {"name": "专业选修课", "iconClass": "folder", "children": [
                        {"name": "专业方向课", "iconClass": "folder", "children": [
                            C("物权法学", "LAW22001"),
                            C("亲属法与继承法", "LAW22002"),
                            C("商法学通论", "LAW22003"),
                            C("劳动与社会保障法学", "LAW22004"),
                            C("国际私法学", "LAW22005"),
                            C("法律职业伦理", "LAW22006"),
                            C("法律写作与研究方法", "LAW22007"),
                            C("合同起草与审查", "LAW22008"),
                            C("法律谈判", "LAW22009"),
                            C("模拟法庭", "LAW22010"),
                            C("法律辩论", "LAW22011"),
                            C("立法学", "LAW22012"),
                            C("西方法律思想史", "LAW22013"),
                            C("中国法律思想史", "LAW22014"),
                            C("犯罪学", "LAW22015"),
                            C("法社会学", "LAW22016"),
                            C("证据法学", "LAW22017"),
                            C("强制执行法学", "LAW22018"),
                            C("仲裁法学", "LAW22019"),
                            C("学校法律实务", "LAW23027"),
                            C("未成年人司法", "LAW23028"),
                        ]},
                    ]},
                    {"name": "微专业", "iconClass": "folder", "children": [
                        {"name": "微专业 — 教育法治", "iconClass": "folder", "children": [
                            C("教育法治专题研究", "LAW23022"),
                            C("学校伤害事故的法律规制", "LAW23023"),
                            C("依法治教", "LAW23024"),
                            C("校园欺凌法律问题研究", "LAW23025"),
                            C("未成年人保护实务", "LAW23026"),
                        ]},
                        {"name": "微专业 — 网络法治", "iconClass": "folder", "children": [
                            C("大数据法治", "LAW22020"),
                            C("网络与人工智能法", "LAW23029"),
                            C("比较电子商务法", "LAW23030"),
                            C("互联网平台治理", "LAW23031"),
                            C("信息刑法", "LAW22021"),
                            C("网络知识产权前沿与案例", "LAW23032"),
                        ]},
                        {"name": "微专业 — 涉外法治", "iconClass": "folder", "children": [
                            C("比较法律文化", "LAW22022"),
                            C("海商法", "LAW23033"),
                            C("国际贸易法", "LAW23034"),
                            C("国际民事诉讼与商事仲裁法", "LAW23035"),
                            C("国际刑事司法前沿", "LAW23036"),
                        ]},
                        {"name": "微专业 — 反腐败法治", "iconClass": "folder", "children": [
                            C("反腐败法治专题研究", "LAW22023"),
                            C("国家监察法学", "LAW22024"),
                            C("反腐败追逃追赃的理论与实务", "LAW23037"),
                            C("世界反腐法制比较研究", "LAW23038"),
                            C("《联合国反腐败公约》与中国刑事法的协调", "LAW22025"),
                        ]},
                    ]},
                    {"name": "实践环节", "iconClass": "folder", "children": [
                        C("学术训练与实践", "LAW33004"),
                        C("专业实习与社会调查", "LAW31002"),
                        C("毕业论文（设计）", "LAW32003"),
                    ]},
                ]},
            ]},
        ]
    },
}


# ═══════════════════════════════════════════════════════════════
# 写入 DB
# ═══════════════════════════════════════════════════════════════

def build_tree(tree_dict, parent=None):
    """递归创建 CourseCategory 记录"""
    count = 0

    if isinstance(tree_dict, list):
        for i, item in enumerate(tree_dict):
            if isinstance(item, dict):
                item["order"] = i
                count += build_tree(item, parent)
        return count

    if isinstance(tree_dict, dict):
        name = tree_dict.get("name", "")

        # 顶层对象（如 {"通识课": {...}, "专业课": {...}}）→ 遍历每个 key
        if not name and not tree_dict.get("courseId") and not tree_dict.get("children"):
            for k, v in tree_dict.items():
                if isinstance(v, dict):
                    v["name"] = k
                    count += build_tree(v, parent)
            return count

        # 创建节点
        cat = CourseCategory.objects.create(
            parent=parent,
            name=name,
            icon_class=tree_dict.get("iconClass", ""),
            order=tree_dict.get("order", 0),
            is_math_card=tree_dict.get("isMathCard", False),
        )
        count += 1

        # 叶子节点：关联课程
        if "courseId" in tree_dict:
            code = tree_dict["courseId"]
            if code and "*" not in code and "-" not in code:
                try:
                    cat.course = Course.objects.get(code=code)
                    cat.save()
                except Course.DoesNotExist:
                    cat.course_text = code
                    cat.save()
            else:
                cat.course_text = code
                cat.save()

        # 递归子节点
        if "children" in tree_dict:
            count += build_tree(tree_dict["children"], cat)

        return count

    return 0


def main():
    print("🌳 重建课程导航树...")

    CourseCategory.objects.all().delete()
    print("  已清空旧树")

    total = build_tree(TREE)

    print(f"\n✅ 课程导航树重建完成！共 {total} 个节点")
    print(f"   数据库: CourseCategory 表共 {CourseCategory.objects.count()} 条记录")


if __name__ == "__main__":
    main()
