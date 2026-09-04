"""安全清理收到异步退信的未验证注册记录。"""

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.db import transaction

from materials.views.auth import _verification_resend_cache_key


class Command(BaseCommand):
    help = "检查并清理因目标邮箱不存在而退信的未验证账号；默认仅预览"

    def add_arguments(self, parser):
        parser.add_argument("email", help="退信中的目标校园邮箱")
        parser.add_argument(
            "--confirm",
            action="store_true",
            help="确认删除对应的未验证账号；不传时仅预览",
        )

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        try:
            validate_email(email)
        except ValidationError as exc:
            raise CommandError("邮箱格式无效") from exc
        if not email.endswith(("@bnu.edu.cn", "@mail.bnu.edu.cn")):
            raise CommandError("仅允许处理北师大校园邮箱")

        with transaction.atomic():
            user = User.objects.select_for_update().filter(username=email).first()
            if user is None:
                self.stdout.write(self.style.WARNING("未找到对应注册记录，无需处理"))
                return
            if user.is_active:
                raise CommandError("账号已经激活，禁止通过退信清理命令删除")
            if not options["confirm"]:
                self.stdout.write(
                    self.style.WARNING(
                        f"将删除未验证账号 id={user.pk}；确认退信地址无误后追加 --confirm"
                    )
                )
                return
            user_id = user.pk
            user.delete()

        cache.delete(_verification_resend_cache_key(email))
        self.stdout.write(self.style.SUCCESS(f"已清理退信对应的未验证账号 id={user_id}"))
