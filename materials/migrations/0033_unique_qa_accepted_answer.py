from django.db import migrations, models
from django.db.models import Q


def normalize_accepted_answers(apps, schema_editor):
    """约束落地前修复历史竞态：每个问题只保留最近的一条最佳回答。"""
    QaAnswer = apps.get_model("materials", "QaAnswer")
    seen_questions = set()
    accepted = QaAnswer.objects.filter(is_accepted=True).order_by(
        "question_id", "-updated_at", "-id",
    )
    for answer in accepted.iterator():
        if answer.question_id in seen_questions:
            QaAnswer.objects.filter(id=answer.id).update(is_accepted=False)
        else:
            seen_questions.add(answer.question_id)


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0032_identity_education_download_activity"),
    ]

    operations = [
        migrations.RunPython(normalize_accepted_answers, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="qaanswer",
            constraint=models.UniqueConstraint(
                fields=("question",),
                condition=Q(is_accepted=True),
                name="uniq_qa_accepted_answer_per_question",
            ),
        ),
    ]
