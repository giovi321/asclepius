"""LLM provider factory and connectivity helpers."""

import logging
from typing import Any

from asclepius.config import AppConfig, LlmProviderEntry, resolve_credential
from asclepius.llm.gate import credential_slot, register_credential

logger = logging.getLogger(__name__)


class ProviderUnreachableError(Exception):
    """Raised when LLM/OCR providers are unreachable (connectivity failures)."""
    pass


# Connectivity exception types that indicate provider is unreachable
_CONNECTIVITY_ERRORS = (
    "ConnectError", "ConnectTimeout", "ReadTimeout",
    "APIConnectionError", "APITimeoutError",
    "ConnectionRefusedError", "TimeoutError",
)


def is_provider_unreachable(exc: Exception) -> bool:
    """Check if an exception indicates provider connectivity failure."""
    exc_type = type(exc).__name__
    if exc_type in _CONNECTIVITY_ERRORS:
        return True
    # Check cause chain
    cause = exc.__cause__ or exc.__context__
    if cause and type(cause).__name__ in _CONNECTIVITY_ERRORS:
        return True
    # Check for HTTP 5xx status errors
    if hasattr(exc, "response") and hasattr(exc.response, "status_code"):
        if exc.response.status_code >= 500:
            return True
    return False


def get_llm_provider(config: AppConfig, priority: int = 1):
    """Factory function to get an LLM provider by priority rank.

    priority=1 returns the highest-priority enabled provider. Raises
    ProviderUnreachableError if no enabled provider is configured.
    """
    from asclepius.config import get_active_llm_provider_config

    entry = get_active_llm_provider_config(config, priority)
    if entry:
        return _build_llm_provider(entry)

    raise ProviderUnreachableError(
        f"No enabled LLM provider at priority rank {priority}. "
        "Configure at least one provider under Settings → Document Analysis → LLM Providers.",
    )


def _resolve_entry_connection(entry) -> tuple[str, str, str, str, int, int, list[int]]:
    """Return ``(type, base_url, api_key, credential_name, max_concurrent,
    max_retries, retry_backoff_seconds)``.

    If ``entry.credential_id`` points at a known credential, its fields win;
    otherwise the entry's inline fields are used (legacy pre-credentials
    config, or new entries that haven't been pointed at a credential yet).
    """
    cred = None
    cred_id = getattr(entry, "credential_id", "") or ""
    if cred_id:
        try:
            from asclepius.config import get_config
            cred = resolve_credential(get_config(), cred_id)
        except Exception:
            cred = None
    if cred is not None:
        backoff = list(cred.retry_backoff_seconds) if cred.retry_backoff_seconds else [30, 60, 120]
        return (
            cred.type, cred.base_url, cred.api_key, cred.name,
            max(1, int(cred.max_concurrent or 2)),
            max(0, int(cred.max_retries or 0)),
            backoff,
        )
    # Fall back to legacy inline fields. Retry defaults mirror LlmConfig.
    return entry.type, entry.base_url, entry.api_key, "", 2, 3, [30, 60, 120]


def _build_llm_provider(entry):
    """Instantiate an LLM provider from a LlmProviderEntry.

    When ``entry.credential_id`` is set, base_url / api_key / type are
    resolved from the referenced credential. Inline fields still work for
    entries that haven't been migrated yet. The concurrency cap is read
    from the credential.
    """
    (
        eff_type, eff_base_url, eff_api_key, cred_name,
        eff_cap, eff_max_retries, eff_backoff,
    ) = _resolve_entry_connection(entry)
    label = f"{entry.name} / {entry.model}" if entry.name else f"{eff_type} / {entry.model}"

    if eff_type == "claude":
        from asclepius.llm.claude import ClaudeProvider
        provider = ClaudeProvider(
            api_key=eff_api_key,
            model=entry.model,
            timeout=entry.timeout,
        )
    elif eff_type in ("openai", "vllm"):
        from asclepius.llm.openai_provider import OpenAIProvider
        base_url = eff_base_url if eff_type == "vllm" else "https://api.openai.com/v1"
        if eff_base_url and eff_type == "openai":
            base_url = eff_base_url
        provider = OpenAIProvider(
            api_key=eff_api_key,
            model=entry.model,
            base_url=base_url,
            timeout=entry.timeout,
        )
    else:  # ollama
        from asclepius.llm.ollama import OllamaProvider
        provider = OllamaProvider(
            base_url=eff_base_url,
            model=entry.model,
            timeout=entry.timeout,
        )

    provider.provider_label = label
    # Gate state. Key by credential_id (one queue per physical connection).
    provider._gate_credential_id = getattr(entry, "credential_id", "") or eff_type
    provider._gate_credential_name = cred_name or entry.name or eff_type
    provider._gate_model = entry.model
    provider._gate_cap = eff_cap
    # Retry policy — consumed by provider methods (e.g. ollama._generate).
    provider._retry_max = eff_max_retries
    provider._retry_backoff = list(eff_backoff)

    # Register this credential with the gate up-front so the UI can see
    # cap=N even when no call is currently in flight.
    register_credential(
        provider._gate_credential_id, provider._gate_cap,
        kind="llm", credential_name=provider._gate_credential_name,
    )

    # Wrap every LLM-facing async method so each call acquires the
    # credential's semaphore automatically.
    for method_name in ("chat", "extract", "_generate"):
        orig = getattr(provider, method_name, None)
        if orig is None:
            continue
        setattr(provider, method_name, _wrap_method_with_gate(provider, orig))

    return provider


def _wrap_method_with_gate(provider, orig):
    """Return an async wrapper that acquires the credential slot before
    delegating to the original method."""
    async def wrapper(*args, **kwargs):
        async with credential_slot(
            provider._gate_credential_id, provider._gate_cap,
            model=provider._gate_model,
            kind="llm", credential_name=provider._gate_credential_name,
        ):
            return await orig(*args, **kwargs)
    return wrapper


def get_llm_provider_count(config: AppConfig) -> int:
    """Return the number of enabled LLM providers."""
    return len([p for p in config.llm.providers if p.enabled])


def _build_general_llm_provider(config: AppConfig):
    """Build the LLM provider for the General (non-pipeline) slot.

    Returns None when general is not configured; callers should then raise
    a 503 instead of silently falling back to the pipeline.
    """
    g = config.llm.general
    if not g.credential_id or not g.model:
        return None

    # Synthesise an LlmProviderEntry so we can reuse _build_llm_provider.
    # Concurrency cap comes from the credential, not from the general slot.
    entry = LlmProviderEntry(
        id="general",
        type=g.type,
        name="General",
        enabled=True,
        priority=1,
        credential_id=g.credential_id,
        model=g.model,
        timeout=g.timeout or 120,
    )
    return _build_llm_provider(entry)


async def llm_chat_with_failover(
    config: AppConfig,
    messages: list[dict],
    *,
    system_prompt: str | None = None,
    role: str = "pipeline",
) -> str:
    """Send a chat request through the traffic light.

    ``role="pipeline"`` walks the LLM priority list and fails over on
    connectivity errors to the next enabled provider. ``role="general"``
    uses the single general-LLM slot and does NOT fail over (there's only
    one model to try).

    Gating is applied automatically at ``_build_llm_provider`` time — every
    provider call (chat / extract / _generate) acquires its (credential,
    model) semaphore before issuing a request.
    """
    if role == "general":
        provider = _build_general_llm_provider(config)
        if provider is None:
            raise ProviderUnreachableError(
                "General LLM is not configured. Set it under Settings → Document Analysis → General.",
            )
        return await provider.chat(messages, system_prompt or "")

    # role == "pipeline": iterate priority ranks.
    total = get_llm_provider_count(config)
    if total == 0:
        raise ProviderUnreachableError(
            "No enabled LLM provider. Configure one under Settings → Document Analysis → LLM Providers.",
        )

    last_exc: Any = None
    for rank in range(1, total + 1):
        try:
            provider = get_llm_provider(config, priority=rank)
        except ProviderUnreachableError as e:
            last_exc = e
            continue
        try:
            return await provider.chat(messages, system_prompt or "")
        except Exception as e:
            last_exc = e
            if is_provider_unreachable(e) and rank < total:
                logger.warning(
                    "LLM rank %d (%s) unreachable — failing over to rank %d",
                    rank, getattr(provider, "provider_label", "?"), rank + 1,
                )
                continue
            raise
    raise ProviderUnreachableError("All LLM providers exhausted") from last_exc
