"""
BNU Sparks — Git 存储集成

每个上传的文件自动 git add + commit，让 GitHub 仓库成为真正的文件存储后端。
"""

import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def commit_file(relative_path):
    """
    git add + commit 一个文件。
    relative_path: 相对 data/materials/ 的路径，如 "LAW11002/abc_笔记.pdf"
    """
    try:
        from git import Repo, InvalidGitRepositoryError

        repo_dir = Path(__file__).resolve().parent
        repo = Repo(repo_dir)

        abs_path = repo_dir / "data" / "materials" / relative_path
        rel_to_repo = os.path.relpath(abs_path, repo_dir)

        repo.index.add([rel_to_repo])
        repo.index.commit(f"📁 新增资料: {relative_path}")

        # 可选自动推送
        from django.conf import settings
        if getattr(settings, "GIT_AUTO_PUSH", False):
            try:
                origin = repo.remote(name="origin")
                origin.push()
            except Exception as e:
                logger.warning(f"Git push 失败: {e}")

        logger.info(f"Git 已提交: {relative_path}")
    except InvalidGitRepositoryError:
        logger.warning("当前目录不是 Git 仓库，跳过 commit")
    except ImportError:
        logger.warning("GitPython 未安装，跳过 git 操作")
    except Exception as e:
        logger.warning(f"Git 操作失败: {e}")
