"""LLM / OCR / Vision provider and credential endpoints, plus connectivity tests."""

import os
from pathlib import Path

import httpx
import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from asclepius.auth.session import get_current_user, require_role
from asclepius.config import (
    CredentialEntry,
    GeneralLlmConfig,
    LlmProviderEntry,
    OcrProviderEntry,
    VisionLlmProviderEntry,
    _new_credential_id,
    get_config,
)

router = APIRouter()


# --- LLM Providers ---

@router.get("/llm-providers")
async def get_llm_providers(current_user: dict = Depends(get_current_user)):
    """Get the ordered list of LLM providers."""
    config = get_config()
    providers = []
    for p in config.llm.providers:
        entry = p.model_dump()
        if entry.get("api_key"):
            entry["has_api_key"] = True
            entry["api_key"] = ""
        else:
            entry["has_api_key"] = False
        providers.append(entry)
    return providers


@router.put("/llm-providers")
async def update_llm_providers(
    providers: list[dict],
    current_user: dict = Depends(require_role("admin")),
):
    """Replace the full list of LLM providers. API keys sent as empty string are preserved."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")
    path = Path(config_path)
    data = {}
    if path.exists():
        data = yaml.safe_load(path.read_text()) or {}

    config = get_config()

    existing_by_id = {p.id: p for p in config.llm.providers}

    new_providers: list[LlmProviderEntry] = []
    for i, raw in enumerate(providers):
        pid = raw.get("id", f"llm-{i}")
        if not raw.get("api_key") and pid in existing_by_id:
            raw["api_key"] = existing_by_id[pid].api_key
        raw["id"] = pid
        new_providers.append(LlmProviderEntry(**raw))

    config.llm.providers = new_providers

    data["llm"] = data.get("llm", {})
    data["llm"]["providers"] = [p.model_dump() for p in new_providers]

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True))

    return {"status": "saved", "count": len(new_providers)}


# --- OCR Providers ---

@router.get("/ocr-providers")
async def get_ocr_providers(current_user: dict = Depends(get_current_user)):
    """Get the ordered list of OCR providers."""
    config = get_config()
    providers = []
    for p in config.ocr.providers:
        entry = p.model_dump()
        for key_field in ("remote_api_key", "llm_api_key", "google_vision_key"):
            if entry.get(key_field):
                entry[f"has_{key_field}"] = True
                entry[key_field] = ""
            else:
                entry[f"has_{key_field}"] = False
        providers.append(entry)
    return providers


@router.put("/ocr-providers")
async def update_ocr_providers(
    providers: list[dict],
    current_user: dict = Depends(require_role("admin")),
):
    """Replace the full list of OCR providers."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")
    path = Path(config_path)
    data = {}
    if path.exists():
        data = yaml.safe_load(path.read_text()) or {}

    config = get_config()
    existing_by_id = {p.id: p for p in config.ocr.providers}

    new_providers: list[OcrProviderEntry] = []
    for i, raw in enumerate(providers):
        pid = raw.get("id", f"ocr-{i}")
        if pid in existing_by_id:
            existing = existing_by_id[pid]
            for key_field in ("remote_api_key", "llm_api_key", "google_vision_key"):
                if not raw.get(key_field):
                    raw[key_field] = getattr(existing, key_field, "")
        raw["id"] = pid
        new_providers.append(OcrProviderEntry(**raw))

    config.ocr.providers = new_providers

    data["ocr"] = data.get("ocr", {})
    data["ocr"]["providers"] = [p.model_dump() for p in new_providers]

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True))

    return {"status": "saved", "count": len(new_providers)}


# --- Vision-LLM Providers ---

@router.get("/vision-providers")
async def get_vision_providers(current_user: dict = Depends(get_current_user)):
    """Get the ordered list of Vision-LLM providers."""
    config = get_config()
    providers = []
    for p in config.vision.providers:
        entry = p.model_dump()
        if entry.get("api_key"):
            entry["has_api_key"] = True
            entry["api_key"] = ""
        else:
            entry["has_api_key"] = False
        providers.append(entry)
    return providers


@router.put("/vision-providers")
async def update_vision_providers(
    providers: list[dict],
    current_user: dict = Depends(require_role("admin")),
):
    """Replace the full list of Vision-LLM providers. API keys sent as empty string are preserved."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")
    path = Path(config_path)
    data = {}
    if path.exists():
        data = yaml.safe_load(path.read_text()) or {}

    config = get_config()
    existing_by_id = {p.id: p for p in config.vision.providers}

    new_providers: list[VisionLlmProviderEntry] = []
    for i, raw in enumerate(providers):
        pid = raw.get("id", f"vision-{i}")
        if not raw.get("api_key") and pid in existing_by_id:
            raw["api_key"] = existing_by_id[pid].api_key
        raw["id"] = pid
        new_providers.append(VisionLlmProviderEntry(**raw))

    config.vision.providers = new_providers

    data["vision"] = data.get("vision", {})
    data["vision"]["providers"] = [p.model_dump() for p in new_providers]

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True))

    return {"status": "saved", "count": len(new_providers)}


# --- Credentials ---

def _count_credential_references(config, credential_id: str) -> dict:
    """Count how many LLM / Vision / OCR entries reference a credential."""
    llm_n = sum(1 for p in config.llm.providers if p.credential_id == credential_id)
    vision_n = sum(1 for p in config.vision.providers if p.credential_id == credential_id)
    ocr_n = sum(1 for p in config.ocr.providers if p.credential_id == credential_id)
    general_n = 1 if config.llm.general.credential_id == credential_id else 0
    return {"llm": llm_n, "vision": vision_n, "ocr": ocr_n, "general": general_n,
            "total": llm_n + vision_n + ocr_n + general_n}


@router.get("/credentials")
async def get_credentials(current_user: dict = Depends(get_current_user)):
    """Return the shared credentials list with api_key masked + reference counts."""
    config = get_config()
    out = []
    for c in config.credentials:
        entry = c.model_dump()
        if entry.get("api_key"):
            entry["has_api_key"] = True
            entry["api_key"] = ""
        else:
            entry["has_api_key"] = False
        entry["references"] = _count_credential_references(config, c.id)
        if not entry.get("retry_backoff_seconds"):
            entry["retry_backoff_seconds"] = [30, 60, 120]
        out.append(entry)
    return out


@router.put("/credentials")
async def update_credentials(
    credentials: list[dict],
    current_user: dict = Depends(require_role("admin")),
):
    """Replace the full credentials list. Missing ids are generated; missing
    api_key values preserve the stored secret."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")
    path = Path(config_path)
    data = {}
    if path.exists():
        data = yaml.safe_load(path.read_text()) or {}

    config = get_config()
    existing_by_id = {c.id: c for c in config.credentials}

    new_creds: list[CredentialEntry] = []
    new_ids: set[str] = set()
    for raw in credentials:
        cid = raw.get("id") or _new_credential_id()
        if not raw.get("api_key") and cid in existing_by_id:
            raw["api_key"] = existing_by_id[cid].api_key
        raw["id"] = cid
        new_creds.append(CredentialEntry(**raw))
        new_ids.add(cid)

    for cid, existing in existing_by_id.items():
        if cid in new_ids:
            continue
        refs = _count_credential_references(config, cid)
        if refs["total"] > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Credential '{existing.name}' is in use ({refs['total']} references); remove references first.",
            )

    config.credentials = new_creds

    data["credentials"] = [c.model_dump() for c in new_creds]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True))

    return {"status": "saved", "count": len(new_creds)}


# --- General LLM ---

@router.get("/general-llm")
async def get_general_llm(current_user: dict = Depends(get_current_user)):
    """Return the general (non-pipeline) LLM configuration. Concurrency
    comes from the referenced credential."""
    config = get_config()
    g = config.llm.general
    return {
        "credential_id": g.credential_id,
        "type": g.type,
        "model": g.model,
        "timeout": g.timeout,
        "configured": bool(g.credential_id and g.model),
    }


class GeneralLlmUpdate(BaseModel):
    credential_id: str = ""
    type: str = "ollama"
    model: str = ""
    timeout: int = 120


@router.put("/general-llm")
async def update_general_llm(
    body: GeneralLlmUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    """Replace the general LLM settings."""
    config_path = os.environ.get("ASCLEPIUS_CONFIG_PATH", "config/settings.yaml")
    path = Path(config_path)
    data = {}
    if path.exists():
        data = yaml.safe_load(path.read_text()) or {}

    config = get_config()

    if body.credential_id and not any(c.id == body.credential_id for c in config.credentials):
        raise HTTPException(status_code=400, detail="Unknown credential_id")

    config.llm.general = GeneralLlmConfig(**body.model_dump())

    data.setdefault("llm", {})["general"] = config.llm.general.model_dump()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data, default_flow_style=False, allow_unicode=True))

    return {"status": "saved"}


# --- Provider testing ---

class TestProviderRequest(BaseModel):
    """Test-connection request.

    Either pass ``provider_id`` (tests the persisted entry with that id) or
    pass ``provider`` (an inline, possibly-unsaved entry). When both are set
    the inline entry wins — this lets the UI test pending edits before the
    user clicks Save.
    """
    provider_id: str | None = None
    provider: dict | None = None


def _resolve_test_entry(body: TestProviderRequest, saved_providers, entry_cls, *, preserve_secret_fields: tuple[str, ...]) -> object:
    """Resolve which provider entry to test.

    If the request carries an inline ``provider``, build an entry from it,
    merging in secret fields from the matching saved entry when the inline
    value is blank. Otherwise look up the saved entry by id.
    """
    if body.provider is not None:
        raw = dict(body.provider)
        pid = raw.get("id")
        if pid:
            existing = next((p for p in saved_providers if p.id == pid), None)
            if existing is not None:
                for field in preserve_secret_fields:
                    if not raw.get(field):
                        raw[field] = getattr(existing, field, "")
        return entry_cls(**raw)
    if body.provider_id:
        entry = next((p for p in saved_providers if p.id == body.provider_id), None)
        if entry is None:
            raise HTTPException(status_code=404, detail="Provider not found")
        return entry
    raise HTTPException(status_code=400, detail="Either provider_id or provider must be supplied")


@router.post("/test-llm-provider")
async def test_llm_provider(
    body: TestProviderRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """Test connectivity to an LLM provider by sending a tiny prompt."""
    config = get_config()
    entry = _resolve_test_entry(body, config.llm.providers, LlmProviderEntry,
                                preserve_secret_fields=("api_key",))

    try:
        from asclepius.pipeline.processor import _build_llm_provider
        provider = _build_llm_provider(entry)
        response = await provider._generate("Reply with exactly: OK", force_json=False, timeout_override=15)
        return {"ok": True, "response": response.strip()[:200]}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)}"}


@router.post("/test-ocr-provider")
async def test_ocr_provider(
    body: TestProviderRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """Test connectivity to an OCR provider."""
    config = get_config()
    entry = _resolve_test_entry(
        body, config.ocr.providers, OcrProviderEntry,
        preserve_secret_fields=("remote_api_key", "llm_api_key", "google_vision_key"),
    )

    try:
        if entry.type == "tesseract":
            import subprocess
            result = subprocess.run(
                ["tesseract", "--version"],
                capture_output=True, text=True, timeout=10,
            )
            version = result.stdout.split("\n")[0] if result.stdout else result.stderr.split("\n")[0]
            return {"ok": True, "detail": f"Tesseract {version}"}

        elif entry.type == "tesseract_remote":
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(entry.remote_url.rstrip("/") + "/")
                return {"ok": True, "detail": f"Remote OCR reachable (HTTP {resp.status_code})"}

        elif entry.type == "llm_vision":
            from asclepius.config import LlmProviderEntry
            from asclepius.pipeline.processor import _build_llm_provider
            llm_entry = LlmProviderEntry(
                id="test-vision",
                type=entry.llm_provider,
                name="test",
                base_url=entry.llm_base_url,
                model=entry.llm_model,
                api_key=entry.llm_api_key,
                timeout=15,
            )
            provider = _build_llm_provider(llm_entry)
            response = await provider._generate("Reply with exactly: OK", force_json=False, timeout_override=15)
            return {"ok": True, "detail": f"LLM Vision OK: {response.strip()[:100]}"}

        elif entry.type == "google_vision":
            if not entry.google_vision_key:
                return {"ok": False, "error": "No Google Vision API key configured"}
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"https://vision.googleapis.com/v1/images:annotate?key={entry.google_vision_key}",
                    json={"requests": []},
                )
                if resp.status_code in (200, 400):
                    return {"ok": True, "detail": "Google Vision API key is valid"}
                return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}

        else:
            return {"ok": False, "error": f"Unknown provider type: {entry.type}"}

    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)}"}


@router.post("/test-vision-provider")
async def test_vision_provider(
    body: TestProviderRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """Test connectivity to a Vision-LLM provider with a trivial prompt."""
    config = get_config()
    entry = _resolve_test_entry(body, config.vision.providers, VisionLlmProviderEntry,
                                preserve_secret_fields=("api_key",))

    try:
        import base64 as _b64
        import io as _io

        from PIL import Image as _Image
        img = _Image.new("RGB", (280, 280), "white")
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        b64 = _b64.b64encode(buf.getvalue()).decode("utf-8")

        from asclepius.pipeline.vision_extractor import _vision_call
        response = await _vision_call(b64, "Reply with exactly: OK", entry, force_json=False)
        return {"ok": True, "detail": response.strip()[:200]}
    except httpx.HTTPStatusError as e:
        body = ""
        try:
            body = e.response.text[:500]
        except Exception:
            pass
        return {"ok": False, "error": f"HTTP {e.response.status_code}: {body or str(e)}"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)}"}
