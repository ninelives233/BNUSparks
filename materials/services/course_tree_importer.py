"""Declarative, incremental course-tree imports with a write-free preview."""
from collections import Counter

from django.db import transaction
from django.db.models import F

from ..models import College, Course, CourseCategory, invalidate_course_tree_cache
from .course_codes import adopt_course_code, is_placeholder, normalized_course_name, placeholder_code


LEVELS = {'', '本科', '硕士', '博士', '研究生'}


class ImportConflict(ValueError):
    pass


def _path(value, label):
    if not isinstance(value, list) or not value or any(
        not isinstance(part, str) or not part.strip() or len(part) > 200 for part in value
    ):
        raise ImportConflict(f'{label}: path 必须是非空字符串数组')
    return tuple(value)


def _validate(manifest):
    if not isinstance(manifest, dict) or not isinstance(manifest.get('courses'), list):
        raise ImportConflict('清单必须是对象且 courses 必须是数组')
    for key in ('colleges', 'folders', 'cross_level_allowlist'):
        if not isinstance(manifest.get(key, []), list):
            raise ImportConflict(f'{key} 必须是数组')
    for key in ('colleges', 'folders', 'courses', 'cross_level_allowlist'):
        for entry in manifest.get(key, []):
            if not isinstance(entry, dict):
                raise ImportConflict(f'{key} 条目必须是对象')
            for field in ('order',):
                if field in entry and (not isinstance(entry[field], int) or isinstance(entry[field], bool)):
                    raise ImportConflict(f'{key}: {field} 必须是整数')
            for field in ('is_divider', 'is_third_row', 'allow_placeholder', 'adopt_placeholder'):
                if field in entry and not isinstance(entry[field], bool):
                    raise ImportConflict(f'{key}: {field} 必须是布尔值')
            if 'education_level' in entry and (not isinstance(entry['education_level'], str) or entry['education_level'] not in LEVELS):
                raise ImportConflict(f'{key}: 无效的 education_level')
            if key in ('folders', 'courses'):
                _path(entry.get('path'), key)
            if key == 'colleges':
                for field, limit in (('name', 100), ('slug', 100)):
                    if not isinstance(entry.get(field), str) or not entry[field].strip() or len(entry[field]) > limit:
                        raise ImportConflict(f'colleges: 无效的 {field}')
                if 'short_name' in entry and (not isinstance(entry['short_name'], str) or len(entry['short_name']) > 20):
                    raise ImportConflict('colleges: 无效的 short_name')
            if key == 'courses':
                for field in ('name', 'course_name'):
                    if field in entry and (not isinstance(entry[field], str) or not entry[field].strip() or len(entry[field]) > 200):
                        raise ImportConflict(f'courses: 无效的 {field}')
                if 'name' not in entry or entry.get('course_type') not in ('major', 'general'):
                    raise ImportConflict(f"courses: 名称或类型无效 {entry.get('path')}")
                if 'college' in entry and (not isinstance(entry['college'], str) or not entry['college'].strip()):
                    raise ImportConflict('courses: 无效的 college')
                if 'code' in entry and (not isinstance(entry['code'], str) or len(entry['code'].strip()) > 50):
                    raise ImportConflict('courses: 无效的 code')
            if key == 'cross_level_allowlist':
                if not isinstance(entry.get('code'), str) or not entry['code'].strip():
                    raise ImportConflict('cross_level_allowlist: 缺少 code')
                if 'expected_name' in entry and (not isinstance(entry['expected_name'], str) or not entry['expected_name'].strip()):
                    raise ImportConflict('cross_level_allowlist: expected_name 无效')
                if 'allowed_levels' not in entry and 'allowed_paths' not in entry:
                    raise ImportConflict('cross_level_allowlist: 需要 allowed_levels 或 allowed_paths')
                if 'allowed_levels' in entry and (not isinstance(entry['allowed_levels'], list) or not entry['allowed_levels'] or any(not isinstance(level, str) or level not in LEVELS - {''} for level in entry['allowed_levels'])):
                    raise ImportConflict('cross_level_allowlist: allowed_levels 无效')
                if 'allowed_paths' in entry:
                    if not isinstance(entry['allowed_paths'], list) or not entry['allowed_paths']:
                        raise ImportConflict('cross_level_allowlist: allowed_paths 无效')
                    for path in entry['allowed_paths']:
                        _path(path, 'allowed_paths')


class CourseTreeImporter:
    def __init__(self, manifest, apply=False):
        _validate(manifest)
        self.manifest = manifest
        self.apply = apply
        self.actions = []
        self.next_id = -1
        self.colleges = list(College.objects.all())
        self.courses = list(Course.objects.all())
        self.nodes = list(CourseCategory.objects.all())
        self.targets = {}
        for row in manifest['courses']:
            code = row.get('code', '').strip().upper()
            if code:
                self.targets.setdefault(code, set()).add(tuple(row['path']) + (row['name'],))

    def record(self, action, path, code='', detail=''):
        self.actions.append({'action': action, 'path': list(path), 'code': code, 'detail': detail})

    def fail(self, path, message, code=''):
        self.record('CONFLICT', path, code, message)
        raise ImportConflict(f"{' / '.join(path)} {code}: {message}")

    def create(self, model, collection, **fields):
        obj = model(**fields)
        if self.apply:
            obj.save(force_insert=True)
        else:
            obj.pk = self.next_id
            self.next_id -= 1
        collection.append(obj)
        return obj

    def update(self, obj, fields):
        changed = [key for key, value in fields.items() if getattr(obj, key) != value]
        for key in changed:
            setattr(obj, key, fields[key])
        if changed and self.apply:
            obj.save(update_fields=changed)
        return bool(changed)

    def find_child(self, parent_id, name, path):
        found = [node for node in self.nodes if node.parent_id == parent_id and node.name == name]
        if len(found) > 1:
            self.fail(path, '同父目录存在多个同名节点')
        return found[0] if found else None

    def node_path(self, node):
        nodes = {item.pk: item for item in self.nodes}
        result, seen = [], set()
        while node:
            if node.pk in seen:
                raise ImportConflict('目录存在循环')
            seen.add(node.pk)
            result.append(node.name)
            node = nodes.get(node.parent_id)
        return tuple(reversed(result))

    def level(self, node):
        nodes = {item.pk: item for item in self.nodes}
        seen = set()
        while node:
            if node.pk in seen:
                raise ImportConflict('目录存在循环')
            seen.add(node.pk)
            if node.education_level:
                return node.education_level
            node = nodes.get(node.parent_id)
        return '本科'

    def next_order(self, parent_id):
        return max((node.order for node in self.nodes if node.parent_id == parent_id), default=-1) + 1

    def folder(self, path, fields=None):
        parent = None
        for index, name in enumerate(path):
            current = path[:index + 1]
            parent_id = parent.pk if parent else None
            node = self.find_child(parent_id, name, current)
            attrs = fields if index == len(path) - 1 and fields else {}
            if node:
                if node.course_id or node.course_text or (node.is_divider and not attrs.get('is_divider', False)):
                    self.fail(current, '目录与课程叶子或分隔线冲突')
                changed = self.update(node, attrs)
                action = 'UPDATE_FOLDER' if changed else 'KEEP_FOLDER'
            else:
                values = dict(attrs)
                values.setdefault('order', self.next_order(parent_id))
                node = self.create(CourseCategory, self.nodes, parent_id=parent_id, name=name, **values)
                action = 'CREATE_FOLDER'
            self.record(action, current)
            parent = node
        return parent

    def college(self, reference, path):
        found = [college for college in self.colleges if college.name == reference or college.slug == reference]
        if len(found) != 1:
            self.fail(path, f'学院不存在或不唯一: {reference}')
        return found[0]

    def ensure_colleges(self):
        for row in self.manifest.get('colleges', []):
            path = ('专业课', row['name'])
            hits = [item for item in self.colleges if item.name == row['name'] or item.slug == row['slug']]
            if len(hits) > 1 or (hits and (hits[0].name != row['name'] or hits[0].slug != row['slug'])):
                self.fail(path, '学院名称或 slug 冲突')
            fields = {key: row[key] for key in ('short_name', 'order') if key in row}
            if hits:
                self.record('UPDATE_COLLEGE' if self.update(hits[0], fields) else 'KEEP_COLLEGE', path)
            else:
                self.create(College, self.colleges, name=row['name'], slug=row['slug'], **fields)
                self.record('CREATE_COLLEGE', path)
            self.folder(path)

    def allow(self, code, course, new_paths, levels):
        for rule in self.manifest.get('cross_level_allowlist', []):
            if rule['code'].strip().upper() != code:
                continue
            if 'expected_name' in rule and normalized_course_name(rule['expected_name']) != normalized_course_name(course.name):
                continue
            if 'allowed_levels' in rule and not levels.issubset(set(rule['allowed_levels'])):
                continue
            allowed = {tuple(path) for path in rule.get('allowed_paths', [])}
            if 'allowed_paths' in rule and not all(any(path[:len(prefix)] == prefix for prefix in allowed) for path in new_paths):
                continue
            return rule
        return None

    def course(self, row):
        parent_path = tuple(row['path'])
        path = parent_path + (row['name'],)
        parent = self.folder(parent_path)
        leaf = self.find_child(parent.pk, row['name'], path)
        if leaf and (not leaf.course_id or leaf.course_text or leaf.is_divider or any(node.parent_id == leaf.pk for node in self.nodes)):
            self.fail(path, '叶子与目录或通配节点冲突')
        college = self.college(row['college'], path) if row.get('college') else None
        name = row.get('course_name', row['name'])
        code = row.get('code', '').strip().upper()
        level = row.get('education_level') or self.level(parent)
        if not code:
            if not (row.get('allow_placeholder') and row['course_type'] == 'major' and college and parent_path[0] == '专业课' and level in ('硕士', '博士', '研究生')):
                self.fail(path, '无代码课程仅允许在研究生专业课范围内生成占位码')
            code = placeholder_code(college.pk, name, education=level)
        hits = [course for course in self.courses if course.code.upper() == code]
        if len(hits) > 1:
            self.fail(path, '课程代码不唯一', code)
        course = hits[0] if hits else None
        same_name = [item for item in self.courses if not item.merged_into_id and item.college_id == (college.pk if college else None) and normalized_course_name(item.name) == normalized_course_name(name)]
        if course and row.get('adopt_placeholder') and any(is_placeholder(item.code) and item.pk != course.pk for item in same_name):
            self.fail(path, '目标代码已被其他课程占用', code)
        if not course and row.get('adopt_placeholder'):
            candidates = [item for item in same_name if is_placeholder(item.code)]
            if len(candidates) > 1:
                self.fail(path, '占位课程不唯一', code)
            if candidates:
                course = candidates[0]
                if is_placeholder(code):
                    self.fail(path, '补码必须使用真实代码', code)
                if self.apply:
                    try:
                        adopted = adopt_course_code(course, code)
                    except ValueError as exc:
                        self.fail(path, str(exc), code)
                    course.code = adopted.code
                else:
                    course.code = code
                self.record('ADOPT_CODE', path, code)
        if course:
            if course.merged_into_id or course.course_type != row['course_type'] or (college and course.college_id != college.pk):
                self.fail(path, '课程类型、学院或别名冲突', code)
            refs = [node for node in self.nodes if node.course_id == course.pk]
            levels = {self.level(node) for node in refs} | {level}
            rule = self.allow(code, course, self.targets.get(code, {path}), levels)
            if normalized_course_name(course.name) != normalized_course_name(name) and not (rule and rule.get('expected_name')):
                self.fail(path, '课程名称冲突', code)
            if len(levels) > 1 and not rule:
                self.fail(path, '未声明或不符合白名单的跨范围/跨层次共挂', code)
            self.record('CROSS_LEVEL_LINK' if len(levels) > 1 and not leaf else 'REUSE_COURSE', path, code)
        else:
            if row['course_type'] == 'major' and not college:
                self.fail(path, '新建专业课程必须声明学院', code)
            if same_name:
                self.fail(path, '同院同名课程已存在其他代码', code)
            course = self.create(Course, self.courses, name=name, code=code, course_type=row['course_type'], college_id=college.pk if college else None)
            self.record('CREATE_COURSE', path, code)
        if leaf and leaf.course_id != course.pk:
            self.fail(path, '已有叶子关联其他课程', code)
        fields = {key: row[key] for key in ('order', 'education_level') if key in row}
        if leaf:
            self.record('UPDATE_LEAF' if self.update(leaf, fields) else 'KEEP_LEAF', path, code)
        else:
            fields.setdefault('order', self.next_order(parent.pk))
            self.create(CourseCategory, self.nodes, name=row['name'], parent_id=parent.pk, course_id=course.pk, **fields)
            self.record('CREATE_LEAF', path, code)

    def run(self):
        self.ensure_colleges()
        for row in self.manifest.get('folders', []):
            self.folder(tuple(row['path']), {key: row[key] for key in ('order', 'education_level', 'is_third_row', 'is_divider') if key in row})
        for row in self.manifest['courses']:
            self.course(row)
        return {'mode': 'apply' if self.apply else 'dry-run', 'actions': self.actions,
                'summary': dict(Counter(item['action'] for item in self.actions))}


def import_course_tree(manifest, apply=False):
    if not apply:
        return CourseTreeImporter(manifest).run()
    with transaction.atomic():
        CourseCategory.objects.filter(parent__isnull=True).update(order=F('order'))
        result = CourseTreeImporter(manifest, apply=True).run()
        transaction.on_commit(invalidate_course_tree_cache)
        invalidate_course_tree_cache()
        return result
