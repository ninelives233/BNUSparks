from pathlib import Path
import shutil
import subprocess
from unittest.mock import patch

from django.conf import settings
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile

from .helpers import BnuTestCase, create_category, create_college, create_course, create_material, create_user
from ..models import Course, CourseCategory, CourseCreationRequest, Material
from ..services.course_codes import is_placeholder, placeholder_code


class GraduateCourseTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.college = create_college("经济与工商管理学院", "econ-grad")
        root = create_category("专业课")
        college_node = create_category(self.college.name, parent=root)
        self.undergrad = create_category("金融学", parent=college_node)
        self.master = create_category("硕士", parent=college_node)
        self.master.education_level = "硕士"
        self.master.save()
        self.doctor = create_category("博士", parent=college_node)
        self.doctor.education_level = "博士"
        self.doctor.save()
        self.major = create_category("理论经济学", parent=self.master)
        self.specialty = create_category("国际商务", parent=self.master)
        self.other_level = create_category("理论经济学", parent=self.doctor)
        self.code = placeholder_code(self.college.id, "测试课程")
        self.course = create_course(self.code, "测试课程", college=self.college, course_type="major")
        self.leaf = create_category("测试课程", parent=self.major, course=self.course)
        self.user = create_user("graduate_course")
        self.user.profile.identity_education = "硕士"
        self.user.profile.identity_college = self.college.name
        self.user.profile.identity_major = self.major.name
        self.user.profile.save()
        self.client.set_token(self.user)

    def test_navigation_filters_other_levels_and_uses_identity(self):
        data = self.client.get('/api/courses/navigation/', {'course_type': 'major'}).json()['data']
        self.assertEqual(data['category_id'], self.major.id)
        level_names = [row['name'] for row in data['path'][2]['siblings']]
        self.assertEqual(level_names, ['硕士'])
        self.assertEqual(self.client.get('/api/courses/navigation/', {'category_id': self.other_level.id}).status_code, 404)
        tree = self.client.get('/api/courses/tree/').json()['data']
        college = tree['专业课']['children'][0]
        self.assertEqual([item['name'] for item in college['children']], ['硕士'])

    def test_file_detail_general_course_navigation_and_visibility(self):
        root = create_category('通识课')
        section = create_category('思想政治理论课', parent=root)
        section.education_level = '研究生'
        section.save()
        course = create_course('MAR2001', '马克思主义理论', course_type='general')
        leaf = create_category(course.name, parent=section, course=course)
        other_leaf = create_category('理论课别名', parent=section, course=course)
        leaf.order = 10
        leaf.save()
        material = create_material(course, self.user, review_status='approved')

        data = self.client.get_json(f'/api/files/{material.id}/').json()['data']
        self.assertEqual(data['course_type'], 'general')
        self.assertEqual(data['category_id'], min(leaf.id, other_leaf.id))

        data = self.client.get_json(f'/api/files/{material.id}/', {'edu': 'undergrad'}).json()['data']
        self.assertEqual(data['course_type'], 'general')
        self.assertIsNone(data['category_id'])

        self.user.profile.delete()
        data = self.client.get_json(f'/api/files/{material.id}/').json()['data']
        self.assertEqual(data['course_type'], 'general')
        self.assertIsNone(data['category_id'])

    def test_file_detail_general_breadcrumb_javascript(self):
        if not shutil.which('node'):
            self.skipTest('Node.js 不可用')
        script = r'''
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('public/js/explorer-file.js', 'utf8');
const core = fs.readFileSync('public/js/explorer-core.js', 'utf8');
const breadcrumb = core.slice(core.indexOf('  function _renderBreadcrumb('), core.indexOf('  // ── 资料区切换条'));
const element = () => ({children: [], classList: {add() {}, remove() {}},
  appendChild(child) { this.children.push(child); }, setAttribute() {}, set innerHTML(value) { this.children = []; }});
const bc = element();
let finishTree;
const context = {
  window: {addEventListener() {}, scrollY: 0},
  document: {getElementById(id) { return id === 'fdBreadcrumb' ? bc : null; },
    querySelector() { return null; }, createElement: element},
  expPath: ['专业课', '跨选课程'], courseTree: null,
  getNode() { return {courseId: 'MAR2001'}; },
  findPathByCourseId() { return ['专业课', '跨选课程']; },
  displayCategoryLabel(name) { return name === '通识课' ? '公共课' : name; },
  _ensureCourseTreeReady() { return new Promise(resolve => { finishTree = resolve; }); },
  console,
};
vm.createContext(context);
vm.runInContext(source + '\n' + breadcrumb, context);
context._renderFdReturnSearch = () => {};
const file = {id: 42, course_code: 'MAR2001', course_name: '马克思主义理论', course_type: 'general', category_id: 9};
assert.strictEqual(context._resolveFileCoursePath(file)[0], '通识课');
context._currentDetailFile = file;
assert.throws(() => context._renderFileDetail(file), /currentUser is not defined/);
assert.strictEqual(context._fdBreadcrumbPath[0], '通识课');
assert(bc.children.some(child => child.textContent === '公共课'));
context.courseTree = {'通识课': {children: [{name: '思想政治理论课', children: [{id: 9, name: file.course_name}]}]}};
finishTree();
Promise.resolve().then(() => {
  assert.deepStrictEqual(Array.from(context._fdBreadcrumbPath), ['通识课', '思想政治理论课', file.course_name]);
  context.courseTree = null;
  context._showFileDetailSkeleton = () => {};
  context.updateSidebar = () => {};
  context.pushViewState = () => 1;
  context._fdLoadIsCurrent = () => true;
  context.api = () => Promise.reject(new Error('network'));
  context.showExplorer = root => { context.destination = root; };
  context.requestAnimationFrame = () => {};
  context.showFileDetail(file);
  return new Promise(resolve => setImmediate(resolve));
}).then(() => {
  assert.strictEqual(context.destination, '通识课');
}).catch(error => { console.error(error); process.exitCode = 1; });
'''
        result = subprocess.run(['node', '-e', script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_graduate_tree_defaults_to_plaza_but_respects_saved_preference(self):
        me = self.client.get('/api/auth/me/').json()['data']
        self.assertEqual(me['material_browse_mode'], 'plaza')
        self.assertEqual(me['course_navigation_education'], '硕士')
        self.user.profile.material_browse_mode = 'directory'
        self.user.profile.save()
        self.assertEqual(self.client.get('/api/auth/me/').json()['data']['material_browse_mode'], 'directory')

    def test_master_without_own_directory_uses_undergraduate_tree_and_search(self):
        root = self.undergrad.parent.parent
        other = create_college("法学院", "grad-fallback-law")
        other_cat = create_category(other.name, parent=root)
        major = create_category("法学", parent=other_cat)
        course = create_course("LAW-FALLBACK", "民法测试", college=other, course_type="major")
        create_category(course.name, parent=major, course=course)
        self.user.profile.identity_college = other.name
        self.user.profile.identity_major = major.name
        self.user.profile.save()
        me = self.client.get('/api/auth/me/').json()['data']
        self.assertEqual(me['identity_education'], '硕士')
        self.assertEqual(me['course_navigation_education'], '本科')
        self.assertEqual(me['material_browse_mode'], 'directory')
        profile = self.client.get('/api/auth/profile/').json()['data']
        self.assertEqual(profile['course_navigation_education'], '本科')
        tree = self.client.get('/api/courses/tree/').json()['data']
        colleges = {item['name']: item for item in tree['专业课']['children']}
        self.assertIn('法学院', colleges)
        self.assertEqual([x['name'] for x in colleges[self.college.name]['children']], ['金融学'])
        nav = self.client.get('/api/courses/navigation/', {'course_type': 'major'}).json()['data']
        self.assertEqual([p['name'] for p in nav['path']][:3], ['专业课', '法学院', '法学'])
        result = self.client.get('/api/search/', {'v': '2', 'type': 'course', 'q': '民法测试'}).json()['data']
        self.assertEqual(result['total'], 1)
        self.assertEqual(self.user.profile.identity_education, '硕士')

    def test_master_with_unknown_college_does_not_auto_enter_another_college(self):
        self.user.profile.identity_college = '尚无目录学院'
        self.user.profile.save()
        response = self.client.get('/api/courses/navigation/', {'course_type': 'major'}).json()['data']
        self.assertEqual([p['name'] for p in response['path']], ['专业课'])
        root = self.undergrad.parent.parent
        explicit = self.client.get('/api/courses/navigation/', {'category_id': root.id}).json()['data']
        self.assertEqual([p['name'] for p in explicit['path']], ['专业课'])

    def test_placeholder_is_college_and_name_stable(self):
        self.assertTrue(is_placeholder(self.code))
        self.assertEqual(self.code, placeholder_code(self.college.id, '测试课程'))
        self.assertNotEqual(self.code, placeholder_code(self.college.id + 1, '测试课程'))
        self.assertEqual(placeholder_code(self.college.id, '高级经济学Ⅰ'),
                         placeholder_code(self.college.id, '高级经济学 I'))

    def test_undergraduate_cannot_see_graduate_navigation_or_search(self):
        graduate_response = self.client.get('/api/courses/tree/')
        graduate_etag = graduate_response['ETag']
        self.user.profile.identity_education = '本科'
        self.user.profile.save()
        self.assertEqual(self.client.get('/api/courses/navigation/', {'category_id': self.major.id}).status_code, 404)
        search = self.client.get('/api/search/', {'v': '2', 'type': 'course', 'q': '测试课程'}).json()['data']
        self.assertEqual(search['total'], 0)
        old_search = self.client.get('/api/search/', {'type': 'course', 'q': '测试课程'}).json()['data']
        self.assertEqual(old_search['courses'], [])
        undergraduate_response = self.client.get('/api/courses/tree/', HTTP_IF_NONE_MATCH=graduate_etag)
        self.assertEqual(undergraduate_response.status_code, 200)
        self.assertIn('private', undergraduate_response['Cache-Control'])
        tree = undergraduate_response.json()['data']
        self.assertEqual([node['name'] for node in tree['专业课']['children'][0]['children']], ['金融学'])

    def test_tree_shards_serve_warm_304_without_rebuilding(self):
        etags = {}
        for level in ('本科', '硕士', '博士'):
            self.user.profile.identity_education = level
            self.user.profile.save()
            response = self.client.get('/api/courses/tree/')
            self.assertEqual(response.status_code, 200)
            etags[level] = response['ETag']
        self.assertEqual(len(set(etags.values())), 3)
        with patch('materials.views.courses._visible_tree_response', side_effect=AssertionError('recomputed')):
            for level in ('本科', '硕士', '博士'):
                self.user.profile.identity_education = level
                self.user.profile.save()
                response = self.client.get('/api/courses/tree/', HTTP_IF_NONE_MATCH=etags[level])
                self.assertEqual(response.status_code, 304)

    def test_tree_shard_invalidated_by_course_and_material_changes(self):
        from ..models import get_course_tree_version
        from ..services.course_codes import adopt_course_code

        original = self.client.get('/api/courses/tree/')['ETag']
        version = get_course_tree_version()
        adopt_course_code(self.course, 'ECON123')
        self.assertNotEqual(version, get_course_tree_version())
        response = self.client.get('/api/courses/tree/', HTTP_IF_NONE_MATCH=original)
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response['ETag'], original)
        version = get_course_tree_version()
        create_material(self.course, self.user, review_status='approved')
        self.assertNotEqual(version, get_course_tree_version())
        self.assertEqual(self.client.get('/api/courses/tree/', HTTP_IF_NONE_MATCH=response['ETag']).status_code, 200)

    def test_adopt_code_preserves_material_alias_and_invalidates_tree(self):
        from ..models import get_course_tree_version

        material = create_material(self.course, self.user, review_status='approved')
        original_path = material.file_path
        original = self.client.get('/api/courses/tree/')
        version = get_course_tree_version()
        response = self.client.post_json('/api/courses/adopt-code/', {
            'placeholder_code': ' ' + self.code.lower() + ' ', 'teaching_code': ' econ123 ',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data'], {
            'code': 'ECON123', 'name': self.course.name,
            'course_id': self.course.id, 'placeholder_code': self.code,
        })
        self.course.refresh_from_db()
        material.refresh_from_db()
        self.assertEqual(self.course.code, 'ECON123')
        self.assertEqual(Course.objects.get(code=self.code).merged_into_id, self.course.id)
        self.assertEqual(material.course_id, self.course.id)
        self.assertEqual(material.file_path, original_path)
        self.assertNotEqual(version, get_course_tree_version())
        tree = self.client.get('/api/courses/tree/', HTTP_IF_NONE_MATCH=original['ETag'])
        self.assertEqual(tree.status_code, 200)
        self.assertContains(tree, 'ECON123')
        self.assertEqual(self.client.post_json('/api/courses/adopt-code/', {
            'placeholder_code': self.code, 'teaching_code': 'ECON123',
        }).status_code, 400)

    def test_adopt_code_conflict_and_invalid_input(self):
        create_course('ECON123', '已有课程', college=self.college)
        response = self.client.post_json('/api/courses/adopt-code/', {
            'course_code': self.code, 'teaching_code': 'econ123',
        })
        self.assertEqual(response.status_code, 409)
        self.course.refresh_from_db()
        self.assertEqual(self.course.code, self.code)
        for placeholder, teaching in [('ECON123', 'ECON456'), (self.code, ''), (self.code, 'BAD-CODE')]:
            response = self.client.post_json('/api/courses/adopt-code/', {
                'placeholder_code': placeholder, 'teaching_code': teaching,
            })
            self.assertEqual(response.status_code, 400)

    def test_adopt_code_rejects_hidden_and_orphan_courses(self):
        hidden = create_course(placeholder_code(self.college.id, '博士课程'), '博士课程', college=self.college)
        create_category(hidden.name, parent=self.other_level, course=hidden)
        orphan = create_course(placeholder_code(self.college.id, '孤儿课程'), '孤儿课程', college=self.college)
        for course in (hidden, orphan):
            response = self.client.post_json('/api/courses/adopt-code/', {
                'placeholder_code': course.code, 'teaching_code': 'ECON456',
            })
            self.assertEqual(response.status_code, 404)
            course.refresh_from_db()
            self.assertTrue(is_placeholder(course.code))

    def test_admin_timetable_reports_viewed_user_navigation_education(self):
        self.client.set_token(self.admin)
        response = self.client.get_json(f'/api/admin/users/{self.user.id}/timetable/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data']['user']['course_navigation_education'], '硕士')
        self.master.delete()
        response = self.client.get_json(f'/api/admin/users/{self.user.id}/timetable/')
        self.assertEqual(response.json()['data']['user']['course_navigation_education'], '本科')

    def test_same_course_name_without_code_reuses_college_course(self):
        response = self.client.post_json('/api/courses/request/', {
            'course_type': 'major', 'course_name': '测试课程', 'course_code': '',
            'college_id': self.college.id, 'target_category_id': self.specialty.id,
        })
        self.assertEqual(response.status_code, 200, response.content)
        request = CourseCreationRequest.objects.get(id=response.json()['data']['id'])
        self.assertEqual(request.course_code, self.code)
        self.assertTrue(response.json()['data']['will_link'])

    def test_request_without_code_uses_internal_code_in_graduate_tree(self):
        response = self.client.post_json('/api/courses/request/', {
            'course_type': 'major', 'course_name': '新课程', 'course_code': '',
            'college_id': self.college.id, 'target_category_id': self.specialty.id,
        })
        self.assertEqual(response.status_code, 200, response.content)
        request = CourseCreationRequest.objects.get(id=response.json()['data']['id'])
        self.assertEqual(request.course_code, placeholder_code(self.college.id, '新课程'))

    def test_code_free_request_with_file_can_be_approved(self):
        response = self.client.post_json('/api/courses/request/', {
            'course_type': 'major', 'course_name': '国际商务实务', 'course_code': '',
            'college_id': self.college.id, 'target_category_id': self.specialty.id,
        })
        request_id = response.json()['data']['id']
        file = SimpleUploadedFile('notes.txt', b'graduate notes', content_type='text/plain')
        attached = self.client.post(f'/api/courses/request/{request_id}/files/',
                                    {'file': file, 'title': '笔记'}, **self.client.defaults)
        self.assertEqual(attached.status_code, 200, attached.content)
        self.client.set_token(self.admin)
        approved = self.client.post_json(f'/api/moderation/course-requests/{request_id}/approve/')
        self.assertEqual(approved.status_code, 200, approved.content)
        material = Material.objects.get(id=attached.json()['data']['id'])
        self.assertTrue(is_placeholder(material.course.code))
        self.assertTrue((Path(settings.MEDIA_ROOT) / material.file_path).is_file())
        self.assertTrue(self.specialty.children.filter(course=material.course).exists())

    def test_teaching_code_preserves_old_links_and_materials(self):
        first = self.client.post_json('/api/files/upload-text/', {
            'course_code': self.code, 'category_id': self.leaf.id,
            'content': '第一份资料', 'teacher': '老师',
        })
        self.assertEqual(first.status_code, 200, first.content)
        material = Material.objects.get(id=first.json()['data']['id'])
        old_path = material.file_path
        second = self.client.post_json('/api/files/upload-text/', {
            'course_code': self.code, 'teaching_code': 'EBA21151041',
            'category_id': self.leaf.id, 'content': '第二份资料', 'teacher': '老师',
        })
        self.assertEqual(second.status_code, 200, second.content)
        self.course.refresh_from_db()
        material.refresh_from_db()
        self.assertEqual(self.course.code, 'EBA21151041')
        self.assertEqual(material.file_path, old_path)
        self.assertTrue((Path(settings.MEDIA_ROOT) / old_path).is_file())
        self.assertEqual(Course.objects.get(code=self.code).merged_into_id, self.course.id)
        response = self.client.get('/api/courses/' + self.code + '/files/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()['data']), 2)

    def test_conflicting_teaching_code_does_not_reassign_course(self):
        create_course('EBA21151041', '另一门课', college=self.college, course_type='major')
        response = self.client.post_json('/api/files/upload-text/', {
            'course_code': self.code, 'teaching_code': 'EBA21151041',
            'category_id': self.leaf.id, 'content': '资料', 'teacher': '老师',
        })
        self.assertEqual(response.status_code, 409)
        self.course.refresh_from_db()
        self.assertEqual(self.course.code, self.code)

    def test_failed_upload_does_not_change_placeholder_code(self):
        before = set(Path(settings.MEDIA_ROOT).rglob('*.txt'))
        with patch('materials.views.files_upload.Material.objects.create', side_effect=RuntimeError('failure')):
            response = self.client.post_json('/api/files/upload-text/', {
                'course_code': self.code, 'teaching_code': 'EBA21151041',
                'category_id': self.leaf.id, 'content': '资料', 'teacher': '老师',
            })
        self.assertEqual(response.status_code, 500)
        self.course.refresh_from_db()
        self.assertEqual(self.course.code, self.code)
        self.assertFalse(Course.objects.filter(code='EBA21151041').exists())
        self.assertEqual(set(Path(settings.MEDIA_ROOT).rglob('*.txt')), before)

    def test_stats_rankings_include_course_type(self):
        from .helpers import create_material
        m1 = create_material(self.course, self.user, review_status="approved")
        m1.title = "硕士资料"
        m1.save(update_fields=["title"])
        general = create_course("GEN1001", "大学英语", course_type="general")
        m2 = create_material(general, self.user, review_status="approved")
        m2.title = "通识资料"
        m2.save(update_fields=["title"])
        data = self.client.get("/api/stats/?limit=10").json()["data"]
        by_title = {item["title"]: item for item in data["top_downloaded"]}
        self.assertEqual(by_title["硕士资料"]["course_type"], "major")
        self.assertEqual(by_title["通识资料"]["course_type"], "general")


class FlattenedGraduateAndPeekTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.college = create_college("文学院", "wenxue")
        self.major_root = create_category("专业课")
        self.col_node = create_category(self.college.name, parent=self.major_root)
        self.ug_major = create_category("汉语言文学", parent=self.col_node)
        self.grad_major = create_category("中国语言文学", parent=self.col_node)
        self.grad_major.education_level = "硕士"
        self.grad_major.save()

        self.gen_root = create_category("通识课")
        self.ug_gen = create_category("大学外语类", parent=self.gen_root)
        self.grad_gen = create_category("思想政治理论课", parent=self.gen_root)
        self.grad_gen.education_level = "研究生"
        self.grad_gen.save()

        self.ug_course = create_course("CHN1001", "古代汉语", college=self.college, course_type="major")
        self.ug_leaf = create_category("古代汉语", parent=self.ug_major, course=self.ug_course)
        self.ug_mat = create_material(self.ug_course, self.admin, review_status="approved")
        self.ug_mat.title = "本科古汉资料"
        self.ug_mat.save(update_fields=["title"])

        self.grad_course = create_course("CHN2001", "文学研究方法", college=self.college, course_type="major")
        self.grad_leaf = create_category("文学研究方法", parent=self.grad_major, course=self.grad_course)
        self.grad_mat = create_material(self.grad_course, self.admin, review_status="approved")
        self.grad_mat.title = "硕士研究方法资料"
        self.grad_mat.save(update_fields=["title"])

        self.shared_course = create_course("CHN1500", "跨选经典导读", college=self.college, course_type="major")
        self.shared_ug_leaf = create_category("经典导读（本科名）", parent=self.ug_major, course=self.shared_course)
        self.shared_grad_leaf = create_category("经典导读（硕士名）", parent=self.grad_major, course=self.shared_course)
        self.shared_mat = create_material(self.shared_course, self.admin, review_status="approved")
        self.shared_mat.title = "共享导读讲义"
        self.shared_mat.save(update_fields=["title"])

        self.grad_user = create_user("grad_flat")
        self.grad_user.profile.identity_education = "硕士"
        self.grad_user.profile.identity_college = self.college.name
        self.grad_user.profile.identity_major = self.grad_major.name
        self.grad_user.profile.save()
        self.client.set_token(self.grad_user)

    def test_flattened_tree_hides_undergrad_and_labels_public_courses(self):
        tree = self.client.get("/api/courses/tree/").json()["data"]
        college_children = tree["专业课"]["children"][0]["children"]
        self.assertEqual([item["name"] for item in college_children], ["中国语言文学"])
        self.assertEqual([item["name"] for item in tree["通识课"]["children"]], ["思想政治理论课"])

        major_nav = self.client.get("/api/courses/navigation/", {"course_type": "major"}).json()["data"]
        self.assertEqual(major_nav["category_id"], self.grad_major.id)

        gen_nav = self.client.get("/api/courses/navigation/", {"course_type": "general"}).json()["data"]
        self.assertEqual(gen_nav["category_id"], self.grad_gen.id)
        self.assertEqual(gen_nav["path"][0]["display_name"], "公共课")

    def test_graduate_can_peek_undergrad_without_changing_identity(self):
        peek_tree = self.client.get("/api/courses/tree/", {"edu": "undergrad"}).json()["data"]
        college_children = peek_tree["专业课"]["children"][0]["children"]
        self.assertEqual([item["name"] for item in college_children], ["汉语言文学"])
        self.assertEqual([item["name"] for item in peek_tree["通识课"]["children"]], ["大学外语类"])

        peek_nav = self.client.get("/api/courses/navigation/", {"course_type": "general", "edu": "undergrad"}).json()["data"]
        self.assertEqual(peek_nav["path"][0]["display_name"], "通识课")

        peek_major_nav = self.client.get("/api/courses/navigation/", {"course_type": "major", "edu": "undergrad"}).json()["data"]
        self.assertEqual(peek_major_nav["category_id"], self.ug_major.id)

        peek_search = self.client.get("/api/search/", {"v": "2", "type": "course", "q": "古代汉语", "edu": "undergrad"}).json()["data"]
        self.assertEqual(peek_search["total"], 1)
        self.grad_user.profile.refresh_from_db()
        self.assertEqual(self.grad_user.profile.identity_education, "硕士")

    def test_recommendations_isolate_undergrad_and_recall_flattened_graduate_major(self):
        data = self.client.get("/api/recommendations/", {"limit": 10}).json()["data"]
        titles = {item["title"]: item for item in data["items"]}
        self.assertNotIn("本科古汉资料", titles)
        self.assertIn("硕士研究方法资料", titles)
        self.assertEqual(titles["硕士研究方法资料"]["reason"], "与你的专业相关。")
        self.assertIn("共享导读讲义", titles)
        self.assertEqual(titles["共享导读讲义"]["course_name"], "经典导读（硕士名）")

    def test_cross_level_course_check_hides_undergrad_paths_but_marks_cross_level(self):
        res = self.client.get("/api/courses/request/check/", {
            "course_code": "CHN1001",
            "target_category_id": self.grad_major.id,
        }).json()["data"]
        self.assertTrue(res["exists"])
        self.assertFalse(res["in_target"])
        self.assertEqual(res["locations"], [])
        self.assertTrue(res["cross_level"])
