"""LLM-driven merge suggestions for normalization tables.

Given a list of canonical entries (doctors, facilities, lab tests, etc.),
ask the LLM to identify groups that refer to the same concept and propose
which one should be the merge target. Returns proposals — the user reviews,
edits, and approves them before any merge is performed.
"""

import json
import logging
import re

import aiosqlite

from asclepius.llm.base import LLMProvider

logger = logging.getLogger(__name__)


_SYSTEM_PROMPT = """You are a medical data normalization assistant. The user maintains a list of canonical entries (doctors, medical facilities, lab tests, medications, diagnoses, or specialties) and wants you to find duplicates that should be merged.

Identify groups of 2+ entries that clearly refer to the same real-world concept. Examples:
- "Humanitas", "Humanitas Medical Care", "Humanitas Medical Ctr." → same facility
- "CBC", "Complete Blood Count", "Emocromo" → same lab test
- "Dr. Rossi", "Rossi M.", "Dr. M. Rossi" → same doctor (only if supporting context matches)

Be conservative: if you are not confident two entries refer to the same thing, do NOT group them. It is better to return no proposal than a wrong one. Ignore entries that have no clear duplicate.

For each group, pick the most complete / most canonical entry as the target (usually the one with the most aliases, the most formal name, or the clearest canonical_code). Return JSON with this exact shape:

{
  "proposals": [
    {
      "target_id": 42,
      "source_ids": [7, 19],
      "reason": "Short human-readable justification"
    }
  ]
}

Rules:
- target_id and all source_ids MUST be ids that appear in the provided input list
- target_id must not also appear in source_ids
- Each id appears in at most one proposal
- If there are no obvious merges, return {"proposals": []}
- Return ONLY the JSON object, no prose before or after"""


def _parse_proposals(text: str) -> list[dict]:
    """Extract the proposals array from an LLM response.

    Accepts the documented shape ``{"proposals": [{"target_id", "source_ids",
    "reason"}, ...]}`` and the common drift ``{"merge_groups": [{"id":
    [...], "reason"?}, ...]}`` that qwen-class models emit even when asked
    for the documented one. In the drift form the first id is treated as
    the target and the rest as sources.
    """
    candidates = [text]
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fenced:
        candidates.insert(0, fenced.group(1))
    brace = re.search(r"\{.*\}", text, re.DOTALL)
    if brace:
        candidates.append(brace.group(0))

    for c in candidates:
        try:
            obj = json.loads(c)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        props = obj.get("proposals")
        if isinstance(props, list):
            return props
        groups = obj.get("merge_groups") or obj.get("groups") or obj.get("duplicates")
        if isinstance(groups, list):
            return _coerce_groups(groups)
    logger.warning(
        "Failed to parse auto-merge proposals from LLM response (len=%d): %r",
        len(text), text[:500],
    )
    return []


def _coerce_groups(groups: list) -> list[dict]:
    """Translate ``[{"id": [a, b, c], ...}, ...]`` into the proposals shape."""
    out = []
    for g in groups:
        if not isinstance(g, dict):
            continue
        ids = g.get("id") or g.get("ids") or g.get("members")
        if not isinstance(ids, list) or len(ids) < 2:
            continue
        ints: list[int] = []
        for v in ids:
            try:
                ints.append(int(v))
            except (TypeError, ValueError):
                continue
        if len(ints) < 2:
            continue
        out.append({
            "target_id": ints[0],
            "source_ids": ints[1:],
            "reason": str(g.get("reason") or "").strip(),
        })
    return out


def _validate_proposals(proposals: list[dict], valid_ids: set[int]) -> list[dict]:
    """Filter proposals down to ones that reference only known ids and are well-formed."""
    seen_ids: set[int] = set()
    result = []
    for p in proposals:
        if not isinstance(p, dict):
            continue
        target = p.get("target_id")
        sources = p.get("source_ids") or []
        if not isinstance(target, int) or not isinstance(sources, list):
            continue
        if target not in valid_ids:
            continue
        clean_sources = []
        for s in sources:
            if not isinstance(s, int) or s == target or s not in valid_ids:
                continue
            if s in seen_ids or target in seen_ids:
                continue
            clean_sources.append(s)
        if not clean_sources:
            continue
        seen_ids.add(target)
        for s in clean_sources:
            seen_ids.add(s)
        result.append({
            "target_id": target,
            "source_ids": clean_sources,
            "reason": str(p.get("reason") or "").strip()[:300],
        })
    return result


async def _fetch_entries(
    db: aiosqlite.Connection, main_table: str, alias_table: str, fk_col: str
) -> list[dict]:
    """Fetch id/canonical fields + aliases for every row in the norm table."""
    cursor = await db.execute(
        f"SELECT id, canonical_code, canonical_display FROM {main_table} ORDER BY canonical_display"
    )
    rows = [dict(r) for r in await cursor.fetchall()]

    # Load aliases in one pass
    alias_cursor = await db.execute(
        f"SELECT {fk_col} AS parent_id, alias FROM {alias_table}"
    )
    alias_map: dict[int, list[str]] = {}
    for r in await alias_cursor.fetchall():
        alias_map.setdefault(r[0], []).append(r[1])

    for row in rows:
        row["aliases"] = alias_map.get(row["id"], [])
    return rows


async def suggest_merges(
    db: aiosqlite.Connection,
    llm: LLMProvider,
    main_table: str,
    alias_table: str,
    fk_col: str,
    norm_type_label: str,
) -> dict:
    """Ask the LLM to propose merges for entries in a normalization table.

    Returns {"proposals": [...], "entries": [...]} — entries included so the
    frontend can render the proposal with canonical names already resolved.
    """
    entries = await _fetch_entries(db, main_table, alias_table, fk_col)
    if len(entries) < 2:
        return {"proposals": [], "entries": entries}

    # Compact payload for the LLM — drop empty alias arrays to save tokens
    payload = []
    for e in entries:
        item = {"id": e["id"], "display": e["canonical_display"], "code": e["canonical_code"]}
        if e["aliases"]:
            item["aliases"] = e["aliases"]
        payload.append(item)

    user_prompt = (
        f"Entity type: {norm_type_label}\n"
        f"Candidate entries ({len(payload)}):\n{json.dumps(payload, ensure_ascii=False)}\n\n"
        "Identify merge groups per the instructions."
    )

    # Intentionally does NOT swallow exceptions — let them bubble up as 503 /
    # 500 so the UI can show the actual reason. Previously we returned an
    # empty proposals panel with no explanation, which made auto-merge look
    # silently broken.
    response = await llm.chat(
        [{"role": "user", "content": user_prompt}],
        system_prompt=_SYSTEM_PROMPT,
        json_mode=True,
    )

    raw = _parse_proposals(response)
    valid_ids = {e["id"] for e in entries}
    proposals = _validate_proposals(raw, valid_ids)
    return {"proposals": proposals, "entries": entries}
