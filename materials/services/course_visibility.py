"""Apply education-level navigation boundaries to the shared course tree."""


def education_for_user(user):
    if user is None:
        return "本科"
    profile = getattr(user, "profile", None)
    level = getattr(profile, "identity_education", "")
    return level if level in ("硕士", "博士") else "本科"


def browse_mode_for_profile(profile):
    """Default a graduate to the plaza once their college has a matching tree."""
    if profile.material_browse_mode:
        return profile.material_browse_mode
    level = profile.identity_education
    if level in ("硕士", "博士") and profile.identity_college:
        from ..models import CourseCategory
        if CourseCategory.objects.filter(
            education_level__in=(level, "研究生"),
            parent__name=profile.identity_college,
            parent__parent__name="专业课", parent__parent__parent__isnull=True,
        ).exists():
            return "plaza"
    return "directory"


def visible_category_ids(categories, education):
    """Legacy unmarked directories at the college/general boundary are undergraduate.

    Marked entry nodes apply to their entire subtree. Other colleges remain visible
    to graduate users only when they have a matching entry.
    """
    categories = list(categories)
    cats = {row["id"]: row for row in categories}
    children = {}
    for row in categories:
        children.setdefault(row["parent_id"], []).append(row["id"])
    visible = set()

    def walk(cid, boundary=False):
        node = cats[cid]
        marked = node.get("education_level") or ""
        if marked:
            if marked != education and not (marked == "研究生" and education in ("硕士", "博士")):
                return False
        elif boundary and education != "本科":
            return False
        visible.add(cid)
        is_general_root = node["parent_id"] is None and node["name"] == "通识课"
        parent = cats.get(node["parent_id"])
        is_college = bool(parent and parent["parent_id"] is None and parent["name"] == "专业课")
        kept = False
        for child_id in children.get(cid, []):
            kept = walk(child_id, boundary=is_general_root or is_college) or kept
        if is_college and education != "本科" and not kept:
            visible.remove(cid)
            return False
        return True

    for root_id in children.get(None, []):
        walk(root_id)
    return visible
