from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0050_major_department"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="userprofile",
            index=models.Index(fields=["identity_education"], name="profile_identity_edu"),
        ),
        migrations.AddIndex(
            model_name="userprofile",
            index=models.Index(
                fields=["identity_college", "identity_major"],
                name="profile_identity_college_major",
            ),
        ),
        migrations.AddIndex(
            model_name="material",
            index=models.Index(fields=["review_status", "created_at"], name="material_review_created"),
        ),
        migrations.AddIndex(
            model_name="downloadrecord",
            index=models.Index(fields=["user", "created_at"], name="download_user_created"),
        ),
        migrations.AddIndex(
            model_name="coursecreationrequest",
            index=models.Index(fields=["status", "created_at"], name="course_req_status_created"),
        ),
        migrations.AddIndex(
            model_name="report",
            index=models.Index(fields=["status", "created_at"], name="report_status_created"),
        ),
        migrations.AddIndex(
            model_name="qaquestion",
            index=models.Index(fields=["status", "created_at"], name="qa_question_status_created"),
        ),
        migrations.AddIndex(
            model_name="qaanswer",
            index=models.Index(fields=["status", "created_at"], name="qa_answer_status_created"),
        ),
        migrations.AddIndex(
            model_name="qadeleterequest",
            index=models.Index(fields=["status", "created_at"], name="qa_delreq_status_created"),
        ),
        migrations.RunSQL(
            sql=(
                "CREATE INDEX IF NOT EXISTS auth_user_date_joined_idx "
                "ON auth_user (date_joined)"
            ),
            reverse_sql="DROP INDEX IF EXISTS auth_user_date_joined_idx",
        ),
    ]
