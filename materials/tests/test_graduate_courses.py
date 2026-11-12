from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile

from .helpers import BnuTestCase, create_category, create_college, create_course, create_user
from ..models import Course, CourseCreationRequest, Material
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

    def test_graduate_tree_defaults_to_plaza_but_respects_saved_preference(self):
        self.assertEqual(self.client.get('/api/auth/me/').json()['data']['material_browse_mode'], 'plaza')
        self.user.profile.material_browse_mode = 'directory'
        self.user.profile.save()
        self.assertEqual(self.client.get('/api/auth/me/').json()['data']['material_browse_mode'], 'directory')

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
