"""Report-lifecycle helpers for imaging studies (no FastAPI routing).

The attach (link-existing), attach (duplicate-hash) and detach handlers all
performed the same three-step dance: repoint ``imaging_studies.document_id``,
migrate ``document_links`` off the old parent, then drop the old parent *iff*
it was a placeholder. That dance is consolidated here in
:func:`swap_study_document`.
"""

import aiosqlite
from asclepius.documents.service import migrate_document_links


async def swap_study_document(
    db: aiosqlite.Connection,
    study_id: int,
    old_doc_id: int | None,
    new_doc_id: int | None,
    report_status: str,
) -> None:
    """Repoint a study at ``new_doc_id``, migrate links, drop old placeholder.

    Verbatim consolidation of the placeholder-swap / migrate-links / delete
    sequence that appeared identically in three handlers:

      1. ``UPDATE imaging_studies SET document_id = new, report_status = ?``
      2. ``migrate_document_links(old → new)`` so links follow the study
         (otherwise the placeholder delete below would cascade-wipe them).
      3. Delete the OLD parent only when it was genuinely a placeholder
         (empty ``file_path`` and ``doc_type == 'imaging_report'``). Real PDF
         documents are intentionally left alive.

    The caller is responsible for committing — kept out of this helper so the
    transaction boundary stays exactly where each handler had it.
    """
    await db.execute(
        "UPDATE imaging_studies SET document_id = ?, report_status = ? WHERE id = ?",
        (new_doc_id, report_status, study_id),
    )
    # Repoint any document_links anchored on the OLD parent so the imaging
    # study's linked documents survive the swap. Without this the placeholder
    # delete below would cascade-wipe them.
    await migrate_document_links(db, old_doc_id, new_doc_id)
    if old_doc_id and old_doc_id != new_doc_id:
        cursor = await db.execute(
            "SELECT file_path, doc_type FROM documents WHERE id = ?",
            (old_doc_id,),
        )
        old = await cursor.fetchone()
        # Only drop the OLD row if it really was a placeholder (empty
        # file_path and doc_type imaging_report). Refusing silently for
        # non-placeholders prevents accidental data loss.
        if old and not (old["file_path"] or "") and old["doc_type"] == "imaging_report":
            await db.execute("DELETE FROM documents WHERE id = ?", (old_doc_id,))
