"""
BNU Sparks · 木铎星火 — 举报 API

report, report-status, reports/pending, reports/<id>/handle, reports/<id>/finish, reports/history

举报分配：与上传审核路由完全一致（含小版主，L1→L4），创建时写入 Report.candidates M2M，
「举报受理」按 candidates 过滤（先审先得）；连带举报（kind=user）属实=是升级后
candidates 重设为全部总管理员，显式出现在超管的举报受理界面。
"""

import json

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.db import IntegrityError
from django.utils import timezone
from django.http import Http404

from .utils import (
    _err, _ok, _get_or_create_profile, _create_notification,
    _report_candidates, _all_super_admins, _check_report_quota,
    _perform_soft_delete, _check_moderator_access, require_login, require_role,
    _safe_int, DAILY_REPORT_LIMIT,
    UserProfile, Material, Notification, DeletionRecord,
)
from ..models import Report

# 举报原因 code → 中文标签（与前端 report_form.html 选项一致，用于通知文案）
REPORT_REASON_LABELS = {
    "political": "内容违规",
    "privacy": "隐私泄露",
    "malware": "恶意文件",
    "cheating": "作弊风险",
    "impersonation": "冒充身份",
    "suspicious": "来源可疑",
    "duplicate": "重复低质",
    "incomplete": "资料不完整",
    "error": "内容错误",
    "irrelevant": "与课程无关",
    "outdated": "版本过时",
    "scan-quality": "扫描/排版极差",
    "copyright": "版权侵权",
    "ads": "含有广告",
    "watermark": "商业水印",
    "other": "其他原因",
}
VALID_REASONS = set(REPORT_REASON_LABELS.keys())


def _display_name(user):
    return (user.first_name or user.username) if user else "匿名"


def _reason_label(code):
    return REPORT_REASON_LABELS.get(code, code)


@csrf_exempt
@require_login
def api_file_report(request, file_id):
    """POST /api/files/<id>/report/ — 提交资料举报（可选连带举报上传者）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    material = get_object_or_404(Material, id=file_id)
    if material.uploader_id == request.user.id:
        return _err("不能举报自己上传的资料", 400)

    # 防重复（先查，避免重复提交白扣限额；并发兜底由 UniqueConstraint 承担）
    if Report.objects.filter(
        kind=Report.Kind.MATERIAL, material_id=material.id, reporter=request.user
    ).exists():
        return _err("你已举报过该资料", 400)

    # 每日举报限额（普通用户 15 次/天，管理员豁免，隐性计数）
    allowed, _, qmsg = _check_report_quota(request.user)
    if not allowed:
        return _err(qmsg, 429)

    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    reasons = body.get("reasons") or []
    if not isinstance(reasons, list) or not reasons:
        return _err("请至少选择一个举报原因", 400)
    reasons = [str(r) for r in reasons]
    if any(r not in VALID_REASONS for r in reasons):
        return _err("举报原因不合法", 400)
    detail = str(body.get("detail") or "").strip()
    if "other" in reasons and not detail:
        return _err('选择"其他原因"时，必须填写详细说明', 400)
    report_user = bool(body.get("report_user"))

    reporter_name = _display_name(request.user)
    m_title = material.title
    m_course_code = material.course.code if material.course else ""
    m_course_name = material.course.name if material.course else ""

    # 审核路由（与上传完全一致，含小版主），排除举报人自己
    candidates = [c for c in _report_candidates(material) if c.id != request.user.id]

    try:
        rep = Report.objects.create(
            kind=Report.Kind.MATERIAL,
            material=material,
            material_pk=material.id,
            reporter=request.user,
            reporter_name=reporter_name,
            material_title=m_title,
            course_code=m_course_code,
            course_name=m_course_name,
            reasons=reasons,
            detail=detail,
        )
    except IntegrityError:
        return _err("你已举报过该资料", 400)
    if candidates:
        rep.candidates.set(candidates)

    # 连带举报用户（可选；同人同 target 只报一次，重复静默不报错）
    user_reported = False
    if report_user and material.uploader_id and material.uploader_id != request.user.id:
        try:
            urep = Report.objects.create(
                kind=Report.Kind.USER,
                target_user=material.uploader,
                reporter=request.user,
                reporter_name=reporter_name,
                material_title=m_title,
                course_code=m_course_code,
                course_name=m_course_name,
                target_user_name=_display_name(material.uploader),
                reasons=reasons,
                detail=detail,
            )
            if candidates:
                urep.candidates.set(candidates)
            user_reported = True
        except IntegrityError:
            pass  # 该用户已被举报过，静默

    # 广播通知候选管理员「有新的举报待处理」
    for u in candidates:
        _create_notification(
            recipient=u,
            type=Notification.Type.REPORT_ALERT,
            title="有新的举报待处理",
            message=f"资料「{m_title}」被举报，请前往『举报受理』处理。",
            material=material,
            course_code=m_course_code,
            course_name=m_course_name,
            triggered_by=request.user,
        )

    return _ok({"reported": True, "user_reported": user_reported})


@require_login
def api_file_report_status(request, file_id):
    """GET /api/files/<id>/report-status/ — 当前用户对该资料的举报状态"""
    get_object_or_404(Material, id=file_id)
    reported = Report.objects.filter(
        kind=Report.Kind.MATERIAL, material_id=file_id, reporter=request.user
    ).exists()
    profile = _get_or_create_profile(request.user)
    if profile.role != UserProfile.Role.USER:
        quota_left = -1  # 管理员不限量
    else:
        from datetime import date
        today = date.today()
        if profile.last_report_date != today:
            quota_left = DAILY_REPORT_LIMIT
        else:
            quota_left = max(0, DAILY_REPORT_LIMIT - profile.daily_report_count)
    can_report = not reported and (quota_left == -1 or quota_left > 0)
    return _ok({
        "reported": reported,
        "can_report": can_report,
        "quota_left": quota_left,
    })


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_report_pending(request):
    """GET /api/moderation/reports/pending/ — 举报受理（聚合卡片）

    作用域：candidates 包含当前用户（创建时按审核路由计算；升级后重设为全部超管）。
    材料举报按 material_id 聚合、连带举报按 target_user_id 聚合。
    """
    user = request.user
    qs = list(Report.objects.filter(
        candidates__id=user.id,
        status__in=[Report.Status.PENDING, Report.Status.ESCALATED],
    ).select_related("material", "material__course", "material__uploader",
                     "target_user", "reporter"))

    # ── 材料举报聚合（pending）──
    mat_rows = [r for r in qs if r.kind == Report.Kind.MATERIAL]
    groups = {}
    for r in mat_rows:
        key = r.material_pk if r.material_pk is not None else f"row:{r.id}"
        groups.setdefault(key, []).append(r)
    alive_ids = set(Material.objects.filter(
        id__in=[k for k in groups if isinstance(k, int)]
    ).values_list("id", flat=True))

    material_groups = []
    for _key, rows in groups.items():
        rows.sort(key=lambda r: r.created_at, reverse=True)
        latest = rows[0]
        reasons, reporter_names = [], []
        for r in rows:
            for rc in (r.reasons or []):
                if rc not in reasons:
                    reasons.append(rc)
            nm = r.reporter_name or "匿名"
            if nm not in reporter_names:
                reporter_names.append(nm)
        mat = latest.material
        material_groups.append({
            "group_key": f"m:{latest.material_pk}",
            "kind": "material",
            "report_id": latest.id,
            "material_id": latest.material_pk,
            "material_title": latest.material_title or (mat.title if mat else ""),
            "course_code": latest.course_code,
            "course_name": latest.course_name,
            "uploader_name": (mat.uploader_name or _display_name(mat.uploader)) if mat else "匿名",
            "uploader_id": mat.uploader_id if mat else None,
            "material_exists": latest.material_pk in alive_ids if latest.material_pk else False,
            "reporter_count": len(rows),
            "reasons": reasons,
            "reason_labels": [_reason_label(rc) for rc in reasons],
            "reporter_names": reporter_names,
            "latest_detail": latest.detail,
            "latest_reported_at": latest.created_at.strftime("%Y-%m-%d %H:%M") if latest.created_at else "",
        })
    material_groups.sort(key=lambda g: g["latest_reported_at"], reverse=True)

    # ── 连带举报聚合（pending + escalated）──
    user_rows = [r for r in qs if r.kind == Report.Kind.USER]
    ugroups = {}
    for r in user_rows:
        key = r.target_user_id if r.target_user_id is not None else f"row:{r.id}"
        ugroups.setdefault(key, []).append(r)

    user_groups = []
    is_super = _get_or_create_profile(user).role == UserProfile.Role.SUPER_ADMIN
    for _key, rows in ugroups.items():
        rows.sort(key=lambda r: r.created_at, reverse=True)
        latest = rows[0]
        reasons, reporter_names = [], []
        for r in rows:
            for rc in (r.reasons or []):
                if rc not in reasons:
                    reasons.append(rc)
            nm = r.reporter_name or "匿名"
            if nm not in reporter_names:
                reporter_names.append(nm)
        st = latest.status
        user_groups.append({
            "group_key": f"u:{latest.target_user_id}",
            "kind": "user",
            "report_id": latest.id,
            "target_user_id": latest.target_user_id,
            "target_user_name": latest.target_user_name or "匿名",
            "reporter_count": len(rows),
            "reasons": reasons,
            "reason_labels": [_reason_label(rc) for rc in reasons],
            "reporter_names": reporter_names,
            "latest_detail": latest.detail,
            "latest_reported_at": latest.created_at.strftime("%Y-%m-%d %H:%M") if latest.created_at else "",
            "status": st,
            "can_finish": st == Report.Status.ESCALATED and is_super,
        })
    user_groups.sort(key=lambda g: g["latest_reported_at"], reverse=True)

    return _ok({"material_groups": material_groups, "user_groups": user_groups})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_report_handle(request, report_id):
    """POST /api/moderation/reports/<id>/handle/ — 处理举报（聚合组内全部 pending 一次清）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    report = get_object_or_404(Report, id=report_id)
    if report.status != Report.Status.PENDING:
        return _err("该举报已处理", 400)

    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    is_true = body.get("is_true")
    if not isinstance(is_true, bool):
        return _err("请选择是否属实", 400)
    actual_situation = str(body.get("actual_situation") or "").strip()
    action = body.get("action")
    allow_retry = body.get("allow_retry")
    is_malicious = body.get("is_malicious")

    if report.kind == Report.Kind.MATERIAL:
        return _handle_material(request, report, is_true, actual_situation, action, allow_retry, is_malicious)
    return _handle_user(request, report, is_true, actual_situation, is_malicious)


def _handle_material(request, report, is_true, actual_situation, action, allow_retry, is_malicious):
    """材料举报处理：四问（属实/处理/允许重传[删除时]/恶意[保留时]）→ 删除联动 + 通知矩阵"""
    pk = report.material_pk or report.material_id
    mat = None
    if pk:
        mat = Material.objects.select_related("course", "uploader").filter(id=pk).first()
    if mat is not None:
        try:
            _check_moderator_access(request.user, mat, allow_uploader=False)
        except Http404:
            return _err("无权操作该举报", 404)
    if action not in (Report.Action.DELETE, Report.Action.KEEP):
        return _err("请选择处理方式", 400)
    if is_true is False and not actual_situation:
        return _err("选择不属实时，必须填写实际情况", 400)

    # 聚合组（该 material_pk 的全部 pending 举报行，材料删除后 FK 置空仍可定位）
    group_rows = list(Report.objects.filter(
        kind=Report.Kind.MATERIAL, material_pk=pk, status=Report.Status.PENDING,
    ))
    reporters = [r.reporter for r in group_rows if r.reporter]
    all_reasons, merged_detail = [], ""
    for r in group_rows:
        for rc in (r.reasons or []):
            if rc not in all_reasons:
                all_reasons.append(rc)
        if r.detail and r.detail not in merged_detail:
            merged_detail = (merged_detail + "；" if merged_detail else "") + r.detail
    merged_reasons = "；".join(_reason_label(rc) for rc in all_reasons)

    # 冗余信息（材料可能随后被删除，course 信息先取好）
    title = report.material_title or (mat.title if mat else "")
    cc, cn = report.course_code, report.course_name
    uploader = mat.uploader if (mat and mat.uploader_id) else None

    # 落库（批量）
    Report.objects.filter(id__in=[r.id for r in group_rows]).update(
        status=Report.Status.HANDLED,
        is_true=is_true,
        actual_situation=actual_situation,
        action=action,
        allow_retry=allow_retry if action == Report.Action.DELETE else None,
        is_malicious=is_malicious if action == Report.Action.KEEP else None,
        handled_by=request.user,
        handled_at=timezone.now(),
    )

    file_already_deleted = False
    if action == Report.Action.DELETE:
        # 判定已删：Material 不存在 或 已存在 DeletionRecord
        already = mat is None or DeletionRecord.objects.filter(material_id=pk).exists()
        delete_reason_text = merged_reasons + (("：" + merged_detail) if merged_detail else "")
        # 通知先于删除（material FK 删除后失效，course 信息走冗余字段）
        for rep in reporters:
            _create_notification(
                recipient=rep, type=Notification.Type.REPORT_RESULT,
                title="举报已处理",
                message=f"你举报的资料「{title}」已删除，感谢反馈。",
                material=mat, course_code=cc, course_name=cn, triggered_by=request.user,
            )
        if uploader and uploader.id != request.user.id:
            msg = f"你的资料「{title}」被举报并删除。\n删除原因：{delete_reason_text}"
            if allow_retry:
                msg += "\n你可修改后重新上传。"
            _create_notification(
                recipient=uploader, type=Notification.Type.REPORT_RESULT,
                title="你的资料被举报并删除",
                message=msg, material=mat, course_code=cc, course_name=cn, triggered_by=request.user,
            )
        if not already:
            _perform_soft_delete(mat, request.user, delete_reason=delete_reason_text)
        else:
            file_already_deleted = True
    else:
        # 保留 = 驳回举报
        if is_true is False:
            msg = f"经核实，你举报的资料「{title}」不存在所述问题，已保留。\n保留原因：{actual_situation}"
        else:
            msg = f"经核实，你举报的资料「{title}」经审核后暂予保留。"
        for rep in reporters:
            _create_notification(
                recipient=rep, type=Notification.Type.REPORT_RESULT,
                title="举报已处理", message=msg,
                material=mat, course_code=cc, course_name=cn, triggered_by=request.user,
            )
        if is_malicious:
            for u in _all_super_admins():
                if u.id == request.user.id:
                    continue
                _create_notification(
                    recipient=u, type=Notification.Type.REPORT_MALICIOUS,
                    title="恶意举报提醒",
                    message=f"举报人「{report.reporter_name or '匿名'}」的举报被判定为恶意，请留意其后续举报行为。",
                    course_code=cc, course_name=cn, triggered_by=request.user,
                )

    return _ok({"message": "已处理", "file_already_deleted": file_already_deleted})


def _handle_user(request, report, is_true, actual_situation, is_malicious):
    """连带举报处理：属实=是 → 升级转发全部总管理（显式出现在其举报受理）；否 → 反馈举报人"""
    target_name = report.target_user_name or "匿名"
    cc, cn = report.course_code, report.course_name
    group_rows = list(Report.objects.filter(
        kind=Report.Kind.USER, target_user_id=report.target_user_id, status=Report.Status.PENDING,
    ))
    reporters = [r.reporter for r in group_rows if r.reporter]
    is_malicious = bool(is_malicious)

    if is_true:
        # 升级：全部置 escalated，候选重设为全部超管（非超管不再可见，超管显式看到）
        Report.objects.filter(id__in=[r.id for r in group_rows]).update(
            status=Report.Status.ESCALATED,
            is_true=True,
            actual_situation=actual_situation,
            is_malicious=is_malicious,
            handled_by=request.user,
            handled_at=timezone.now(),
        )
        for r in group_rows:
            r.candidates.set(_all_super_admins())
        supers = [u for u in _all_super_admins() if u.id != request.user.id]
        for u in supers:
            _create_notification(
                recipient=u, type=Notification.Type.REPORT_ESCALATED,
                title="举报已升级至总管理",
                message=f"用户「{target_name}」的连带举报已被管理员核实属实，请前往『举报受理』处理。",
                course_code=cc, course_name=cn, triggered_by=request.user,
            )
        if is_malicious:
            for u in supers:
                _create_notification(
                    recipient=u, type=Notification.Type.REPORT_MALICIOUS,
                    title="恶意举报提醒",
                    message=f"举报人「{report.reporter_name or '匿名'}」对用户「{target_name}」的连带举报被判定为恶意，请留意其后续举报行为。",
                    course_code=cc, course_name=cn, triggered_by=request.user,
                )
    else:
        Report.objects.filter(id__in=[r.id for r in group_rows]).update(
            status=Report.Status.HANDLED,
            is_true=False,
            actual_situation=actual_situation,
            is_malicious=None,
            handled_by=request.user,
            handled_at=timezone.now(),
        )
        for rep in reporters:
            _create_notification(
                recipient=rep, type=Notification.Type.REPORT_RESULT,
                title="连带举报已驳回",
                message=f"经核实，你举报的用户「{target_name}」不存在所述问题。",
                course_code=cc, course_name=cn, triggered_by=request.user,
            )

    return _ok({"message": "已处理", "file_already_deleted": False})


@csrf_exempt
@require_role(UserProfile.Role.SUPER_ADMIN)
def api_report_finish(request, report_id):
    """POST /api/moderation/reports/<id>/finish/ — 超管收尾 escalated 连带举报"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    report = get_object_or_404(Report, id=report_id)
    if report.status != Report.Status.ESCALATED:
        return _err("该举报无需收尾", 400)

    group_rows = list(Report.objects.filter(
        kind=Report.Kind.USER, target_user_id=report.target_user_id, status=Report.Status.ESCALATED,
    ))
    reporters = [r.reporter for r in group_rows if r.reporter]
    target_name = report.target_user_name or "匿名"
    Report.objects.filter(id__in=[r.id for r in group_rows]).update(
        status=Report.Status.HANDLED,
        handled_by=request.user,
        handled_at=timezone.now(),
    )
    for rep in reporters:
        _create_notification(
            recipient=rep, type=Notification.Type.REPORT_RESULT,
            title="连带举报已处理",
            message=f"你举报的用户「{target_name}」已由总管理员处理完毕。",
            course_code=report.course_code, course_name=report.course_name,
            triggered_by=request.user,
        )
    return _ok({"message": "已处理"})


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_report_history(request):
    """GET /api/moderation/reports/history/?page=&per_page= — 举报记录（全部状态，全量可见）"""
    page = _safe_int(request.GET.get("page"), 1, 1)
    per_page = _safe_int(request.GET.get("per_page"), 20, 1, 100)
    qs = Report.objects.select_related("reporter", "handled_by").order_by("-created_at")
    total = qs.count()
    total_pages = (total + per_page - 1) // per_page if total else 1
    page = min(page, total_pages)
    items = qs[(page - 1) * per_page: page * per_page]

    def _serialize(r):
        status_label = dict(Report.Status.choices).get(r.status, r.status)
        return {
            "report_id": r.id,
            "kind": r.kind,
            "kind_label": r.get_kind_display(),
            "material_title": r.material_title or "",
            "target_user_name": r.target_user_name or "",
            "course_code": r.course_code,
            "course_name": r.course_name,
            "reporter_name": r.reporter_name or "匿名",
            "reasons": r.reasons or [],
            "reason_labels": [_reason_label(rc) for rc in (r.reasons or [])],
            "detail": r.detail,
            "status": r.status,
            "status_label": status_label,
            "action": r.action,
            "is_true": r.is_true,
            "is_malicious": r.is_malicious,
            "handled_by_name": _display_name(r.handled_by),
            "handled_at": r.handled_at.strftime("%Y-%m-%d %H:%M") if r.handled_at else "",
            "created_at": r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else "",
        }

    return _ok({
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
        "items": [_serialize(r) for r in items],
    })
