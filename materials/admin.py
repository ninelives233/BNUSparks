from django.contrib import admin
from django.utils.html import format_html
from .models import College, Course, MaterialType, Material


@admin.register(College)
class CollegeAdmin(admin.ModelAdmin):
    list_display = ["name", "short_name", "order"]
    prepopulated_fields = {"slug": ["name"]}
    search_fields = ["name"]


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ["name", "college", "course_type", "material_count", "created_at"]
    list_filter = ["course_type", "college"]
    search_fields = ["name", "code"]
    list_editable = ["material_count"]
    autocomplete_fields = ["college"]


@admin.register(MaterialType)
class MaterialTypeAdmin(admin.ModelAdmin):
    list_display = ["name", "slug"]
    prepopulated_fields = {"slug": ["name"]}


@admin.register(Material)
class MaterialAdmin(admin.ModelAdmin):
    list_display = ["title", "course", "material_type", "file_size_display",
                    "download_count", "is_approved", "created_at"]
    list_filter = ["is_approved", "material_type", "course__course_type"]
    search_fields = ["title", "description"]
    list_editable = ["is_approved"]
    autocomplete_fields = ["course"]
    date_hierarchy = "created_at"

    def file_size_display(self, obj):
        if obj.file_size < 1024:
            return f"{obj.file_size} B"
        elif obj.file_size < 1024 * 1024:
            return f"{obj.file_size / 1024:.1f} KB"
        return f"{obj.file_size / 1024 / 1024:.1f} MB"
    file_size_display.short_description = "大小"
