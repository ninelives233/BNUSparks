import json

from django.core.management.base import BaseCommand, CommandError

from ...services.course_tree_importer import ImportConflict, import_course_tree


class Command(BaseCommand):
    help = '从声明式 JSON 清单预览或增量导入课程树。'

    def add_arguments(self, parser):
        parser.add_argument('manifest', help='UTF-8 JSON 清单路径')
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument('--apply', action='store_true', help='执行写入；默认只读预览')
        mode.add_argument('--dry-run', action='store_true', help='只读预览')
        parser.add_argument('--json', action='store_true', help='输出结构化 JSON')

    def handle(self, *args, **options):
        try:
            with open(options['manifest'], encoding='utf-8') as source:
                manifest = json.load(source)
            result = import_course_tree(manifest, apply=options['apply'])
        except (OSError, UnicodeError, json.JSONDecodeError, ImportConflict) as exc:
            raise CommandError(str(exc)) from exc
        if options['json']:
            self.stdout.write(json.dumps(result, ensure_ascii=False))
        else:
            for item in result['actions']:
                self.stdout.write(f"{item['action']} {' / '.join(item['path'])} {item['code']}")
            self.stdout.write('汇总: ' + json.dumps(result['summary'], ensure_ascii=False, sort_keys=True))
            self.stdout.write('已写入。' if options['apply'] else '只读预览，未写入。')
