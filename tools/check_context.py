#!/usr/bin/env python3
"""Validate the small, long-lived collaboration context.

This checker deliberately computes volatile repository facts instead of asking
humans to copy them into Markdown. It has no third-party dependencies.
"""

from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOC_BUDGETS = {
    "AGENTS.md": (90, 9_000),
    "project-map.md": (70, 8_000),
    "docs/PROJECT_MAP.md": (190, 24_000),
    "docs/BUG_TROUBLESHOOTING.md": (160, 16_000),
    "docs/OPERATIONS.md": (120, 12_000),
}
FORBIDDEN = {
    "工作区待提交": "temporary worktree state belongs in a PR, not long-lived context",
    "工作区未提交": "temporary worktree state belongs in a PR, not long-lived context",
    "尚未 git 提交": "temporary worktree state belongs in a PR, not long-lived context",
    ".deploy-backups/": "deployment snapshot paths belong in release records",
    "checksum": "live checksums belong in release records",
}
MARKDOWN_LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
WIKI_LINK = re.compile(r"\[\[[^\]]+\]\]")
POTENTIAL_REAL_BNU_ACCOUNT = re.compile(
    r"\b(?!2099)\d{8,12}@(mail\.)?bnu\.edu\.cn\b",
    re.IGNORECASE,
)


def line_count(path: Path) -> int:
    return len(path.read_text(encoding="utf-8").splitlines())


def python_lines(paths: list[Path]) -> int:
    return sum(line_count(path) for path in paths)


def model_count() -> int:
    tree = ast.parse((ROOT / "materials/models.py").read_text(encoding="utf-8"))
    count = 0
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        for base in node.bases:
            if isinstance(base, ast.Attribute) and base.attr == "Model":
                count += 1
                break
    return count


def route_count() -> int:
    text = (ROOT / "materials/urls.py").read_text(encoding="utf-8")
    return len(re.findall(r"^\s*(?:path|re_path)\(", text, re.MULTILINE))


def test_count() -> int | None:
    test_dir = ROOT / "materials/tests"
    if not test_dir.is_dir():
        return None
    total = 0
    for path in test_dir.glob("test_*.py"):
        total += len(re.findall(r"^\s+(?:async\s+)?def\s+test_", path.read_text(encoding="utf-8"), re.MULTILINE))
    return total


def resolve_link(source: Path, raw_target: str) -> Path | None:
    target = raw_target.strip().strip("<>").split("#", 1)[0]
    if not target or target.startswith(("http://", "https://", "mailto:")):
        return None
    return (source.parent / target).resolve()


def validate_docs() -> list[str]:
    errors: list[str] = []
    for relative, (max_lines, max_bytes) in DOC_BUDGETS.items():
        path = ROOT / relative
        if not path.is_file():
            errors.append(f"missing required context file: {relative}")
            continue
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        lines = len(text.splitlines())
        if lines > max_lines:
            errors.append(f"{relative}: {lines} lines exceeds budget {max_lines}")
        if len(raw) > max_bytes:
            errors.append(f"{relative}: {len(raw)} bytes exceeds budget {max_bytes}")
        if WIKI_LINK.search(text):
            errors.append(f"{relative}: wiki-style links are not portable; use Markdown paths")
        for phrase, reason in FORBIDDEN.items():
            if phrase in text:
                errors.append(f"{relative}: forbidden phrase {phrase!r}: {reason}")
        for target in MARKDOWN_LINK.findall(text):
            resolved = resolve_link(path, target)
            if resolved is not None and not resolved.exists():
                errors.append(f"{relative}: broken relative link {target!r}")
    return errors


def validate_test_fixtures() -> list[str]:
    errors: list[str] = []
    test_dir = ROOT / "materials/tests"
    if not test_dir.is_dir():
        return ["missing public test suite: materials/tests"]
    for path in sorted(test_dir.glob("*")):
        if path.suffix not in {".py", ".sh", ".md"}:
            continue
        text = path.read_text(encoding="utf-8")
        relative = path.relative_to(ROOT)
        if POTENTIAL_REAL_BNU_ACCOUNT.search(text):
            errors.append(
                f"{relative}: numeric BNU test accounts must use the synthetic 2099 prefix"
            )
        if "bnusparks-tests" in text or "git@github.com:ninelives233" in text:
            errors.append(f"{relative}: stale private test repository reference")
        if "/Users/" in text:
            errors.append(f"{relative}: local absolute user path is not portable")
    return errors


def current_facts() -> dict[str, object]:
    js = sorted((ROOT / "public/js").glob("*.js"))
    css = sorted((ROOT / "public/css").glob("*.css"))
    views = sorted((ROOT / "materials/views").glob("*.py"))
    return {
        "models": model_count(),
        "api_routes": route_count(),
        "view_files": len(views),
        "view_lines": python_lines(views),
        "javascript_files": len(js),
        "javascript_lines": python_lines(js),
        "css_files": len(css),
        "css_lines": python_lines(css),
        "tests_available": test_count() is not None,
        "tests": test_count(),
    }


def main() -> int:
    errors = validate_docs() + validate_test_fixtures()
    print(json.dumps(current_facts(), ensure_ascii=False, indent=2))
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("Context documentation checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
