"""清理幽灵 Material 行的管理命令（v=182）。

幽灵行 = 已存在 DeletionRecord（删除流程已建记录、物理文件已移入暂存），但
Material 行本身仍残留（删除中途非原子失败的产物）。这类行会让公开主页/排行榜
误显示「已删除」的资料，点击后文件不存在直接回退。

v=182.1：新增第二类死行 —— 无删除记录但物理文件已丢失的孤立行
（历史遗留测试上传 / 外部清理残留）。文件在磁盘上不存在 → 下载必 404，
属纯死数据。默认不检查（create_material 测试数据无真实文件），
需显式加 --check-files 才纳入扫描。

安全依据：
- 删除流程正常会把物理文件移入 data/trash（48h 后由 purge_trash 硬删），
  幽灵行是纯死数据，删行不会误删任何现存文件。
- DeletionRecord.material_id 是 IntegerField（非 FK），删 Material 行不会
  级联删掉 DeletionRecord——「恢复」仍可从暂存文件重建新行，不受影响。
- 逐条 .delete() 触发 post_delete 信号，自动失效课程树/统计缓存并 bump 上传者
  公开页代际。

用法：python manage.py clean_ghost_materials [--dry-run] [--check-files]
"""

from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from ...models import DeletionRecord, Material


class Command(BaseCommand):
    help = "删除「已有 DeletionRecord 但 Material 行残留」的幽灵行（可选扫文件缺失孤立行）"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true",
            help="只统计不删除",
        )
        parser.add_argument(
            "--check-files", action="store_true",
            help="额外扫描「文件缺失且无删除记录」的孤立死行（approved/rejected）",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        check_files = options["check_files"]

        # 第一类：有删除记录但行残留
        ghost_ids = set(DeletionRecord.objects.values_list("material_id", flat=True).distinct())
        ghost_qs = Material.objects.filter(id__in=ghost_ids)
        ghost_count = ghost_qs.count()

        # 第二类（可选）：无删除记录、物理文件已丢失的孤立死行
        orphan_ids = set()
        if check_files:
            base = Material.objects.filter(
                review_status__in=["approved", "rejected"]
            ).exclude(id__in=ghost_ids).only("id", "file_path")
            for m in base.iterator():
                if m.file_path and not (Path(settings.MEDIA_ROOT) / m.file_path).is_file():
                    orphan_ids.add(m.id)

        all_ids = ghost_ids | orphan_ids
        qs = Material.objects.filter(id__in=all_ids).select_related("uploader")
        total = qs.count()

        self.stdout.write(
            f"发现死 Material 行：{total} 条 "
            f"（删除记录残留 {ghost_count} + 文件缺失孤立 {len(orphan_ids)}）"
        )

        if dry_run:
            self.stdout.write("--dry-run：未执行删除")
            return

        n = 0
        for m in qs.iterator():
            uploader = (m.uploader.first_name or m.uploader.username) if m.uploader else "匿名"
            m.delete()  # 触发 post_delete 信号（缓存失效 + 公开页代际 bump）
            n += 1
        self.stdout.write(self.style.SUCCESS(f"已清理死行：{n} 条"))
