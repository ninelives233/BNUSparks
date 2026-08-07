from django.apps import AppConfig
from django.db.backends.signals import connection_created


def _enable_sqlite_wal(sender, connection, **kwargs):
    """连接建立时启用 SQLite WAL + busy_timeout，缓解 2 worker 并发写锁（P2.4）。"""
    if connection.vendor != "sqlite":
        return
    cursor = connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA busy_timeout=5000;")
    cursor.close()


class MaterialsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "materials"
    verbose_name = "资料管理"

    def ready(self):
        connection_created.connect(_enable_sqlite_wal, dispatch_uid="bnusparks_enable_sqlite_wal")
