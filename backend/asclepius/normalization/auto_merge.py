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
from asclepius.normalization.knowledge_base import get_knowledge_base

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


def _display_to_id_map(entries: list[dict]) -> dict[str, int]:
    """Build a normalized-display-name → id lookup so the parser can rescue
    LLM responses that reference entries by display name instead of id."""
    out: dict[str, int] = {}
    for e in entries or []:
        eid = e.get("id")
        if not isinstance(eid, int):
            continue
        names: list[str] = []
        if e.get("canonical_display"):
            names.append(e["canonical_display"])
        for a in e.get("aliases") or []:
            if isinstance(a, str):
                names.append(a)
            elif isinstance(a, dict) and a.get("alias"):
                names.append(a["alias"])
        for n in names:
            key = _norm_display(n)
            if key and key not in out:
                out[key] = eid
    return out


def _norm_display(text: str) -> str:
    """Casefold + collapse non-alphanumeric runs. Same spirit as the
    knowledge-base normaliser, kept local so it stays a one-liner."""
    if not text:
        return ""
    return re.sub(r"[^0-9a-z]+", " ", text.casefold()).strip()


def _parse_proposals(text: str, display_to_ids: dict[str, int] | None = None) -> list[dict]:
    """Extract the proposals array from an LLM response.

    Accepts:

    - The documented shape ``{"proposals": [{"target_id", "source_ids",
      "reason"}, ...]}``.
    - The qwen drift ``{"merge_groups": [{"id": [...], "reason"?}, ...]}``.
    - The display-name-keyed dict ``{"Calcium": ["Total Calcium",
      "Ionized Calcium"], ...}`` — keys are target display names, values
      are arrays of source display names. Resolved against
      ``display_to_ids`` when provided.
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
        # Last-resort: treat the dict itself as {target_display: [source_displays]}
        # if its values look like flat lists of strings and at least one
        # key matches a known entry.
        if display_to_ids and _looks_like_display_dict(obj, display_to_ids):
            logger.info(
                "auto_merge parser: recovered display-name-keyed dict response (%d keys)",
                len(obj),
            )
            return _coerce_display_dict(obj, display_to_ids)
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


def _looks_like_display_dict(obj: dict, display_to_ids: dict[str, int]) -> bool:
    """Heuristic: every value is a list of strings AND at least one key
    resolves to a known entry display name."""
    for v in obj.values():
        if not isinstance(v, list):
            return False
        for item in v:
            if not isinstance(item, str):
                return False
    return any(_norm_display(k) in display_to_ids for k in obj.keys())


def _coerce_display_dict(obj: dict, display_to_ids: dict[str, int]) -> list[dict]:
    """Translate ``{"target_display": ["source_display", ...]}`` into proposals."""
    out: list[dict] = []
    for key, values in obj.items():
        if not isinstance(values, list):
            continue
        target_id = display_to_ids.get(_norm_display(key))
        if target_id is None:
            continue
        source_ids: list[int] = []
        for v in values:
            if not isinstance(v, str):
                continue
            sid = display_to_ids.get(_norm_display(v))
            if sid is not None and sid != target_id and sid not in source_ids:
                source_ids.append(sid)
        if not source_ids:
            continue
        out.append({
            "target_id": target_id,
            "source_ids": source_ids,
            "reason": "",
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


def _resolve_with_knowledge_base(
    entries: list[dict], main_table: str
) -> tuple[list[dict], set[int]]:
    """Group entries by external code (ATC / LOINC / ICD-10) when available.

    Returns ``(deterministic_proposals, resolved_entry_ids)``. Entries whose
    id is in ``resolved_entry_ids`` are part of a same-code group and should
    be excluded from the LLM prompt — they're already decided.

    For doctors / facilities / specialties the KB is None and we return
    ``([], set())`` so the existing LLM-only path runs unchanged.
    """
    kb = get_knowledge_base(main_table)
    if kb is None or kb.alias_count == 0:
        return [], set()

    code_to_ids: dict[str, list[int]] = {}
    for e in entries:
        names = [e["canonical_display"], *(e.get("aliases") or [])]
        for n in names:
            code = kb.resolve(n)
            if code:
                code_to_ids.setdefault(code, []).append(e["id"])
                break

    deterministic: list[dict] = []
    resolved: set[int] = set()
    for code, ids in code_to_ids.items():
        if len(ids) < 2:
            continue
        target, *sources = ids
        deterministic.append({
            "target_id": target,
            "source_ids": sources,
            "reason": f"Same {kb.code_label} code ({code})",
            "confidence": "high",
            "source": "knowledge_base",
        })
        resolved.add(target)
        resolved.update(sources)

    if deterministic:
        logger.info(
            "auto_merge[%s]: knowledge base produced %d deterministic proposal(s) "
            "covering %d entries",
            main_table, len(deterministic), len(resolved),
        )
    return deterministic, resolved


async def suggest_merges(
    db: aiosqlite.Connection,
    llm: LLMProvider,
    main_table: str,
    alias_table: str,
    fk_col: str,
    norm_type_label: str,
) -> dict:
    """Ask the LLM to propose merges for entries in a normalization table.

    Two-stage pipeline:

    1. Deterministic resolution against a bundled knowledge base
       (ATC/LOINC/ICD-10). Entries that resolve to the same external code
       are grouped immediately with ``confidence: "high"``.
    2. The LLM is shown only the residual that lookup couldn't decide. Its
       proposals come back with ``confidence: "review"``.

    Returns ``{"proposals": [...], "entries": [...]}`` — entries always
    contains the full set so the frontend can render names without re-fetch.
    """
    entries = await _fetch_entries(db, main_table, alias_table, fk_col)
    if len(entries) < 2:
        return {"proposals": [], "entries": entries}

    deterministic, resolved_ids = _resolve_with_knowledge_base(entries, main_table)
    unresolved = [e for e in entries if e["id"] not in resolved_ids]

    llm_proposals: list[dict] = []
    if len(unresolved) >= 2:
        # Compact payload for the LLM — drop empty alias arrays to save tokens
        payload = []
        for e in unresolved:
            item = {"id": e["id"], "display": e["canonical_display"], "code": e["canonical_code"]}
            if e["aliases"]:
                item["aliases"] = e["aliases"]
            payload.append(item)

        user_prompt = (
            f"Entity type: {norm_type_label}\n"
            f"Candidate entries ({len(payload)}):\n{json.dumps(payload, ensure_ascii=False)}\n\n"
            "Identify merge groups per the instructions."
        )

        # Intentionally does NOT swallow exceptions — let them bubble up as
        # 503 / 500 so the UI can show the actual reason. Previously we
        # returned an empty proposals panel with no explanation, which made
        # auto-merge look silently broken.
        response = await llm.chat(
            [{"role": "user", "content": user_prompt}],
            system_prompt=_SYSTEM_PROMPT,
            json_mode=True,
        )

        raw = _parse_proposals(response, display_to_ids=_display_to_id_map(unresolved))
        valid_ids = {e["id"] for e in unresolved}
        llm_proposals = _validate_proposals(raw, valid_ids)
        for p in llm_proposals:
            p.setdefault("confidence", "review")
            p.setdefault("source", "llm")

    return {"proposals": deterministic + llm_proposals, "entries": entries}
