"""LLM provider factory and connectivity helpers."""

from asclepius.config import AppConfig


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


def _build_llm_provider(entry):
    """Instantiate an LLM provider from a LlmProviderEntry."""
    label = f"{entry.name} / {entry.model}" if entry.name else f"{entry.type} / {entry.model}"

    if entry.type == "claude":
        from asclepius.llm.claude import ClaudeProvider
        provider = ClaudeProvider(
            api_key=entry.api_key,
            model=entry.model,
            timeout=entry.timeout,
        )
    elif entry.type in ("openai", "vllm"):
        from asclepius.llm.openai_provider import OpenAIProvider
        base_url = entry.base_url if entry.type == "vllm" else "https://api.openai.com/v1"
        if entry.base_url and entry.type == "openai":
            base_url = entry.base_url
        provider = OpenAIProvider(
            api_key=entry.api_key,
            model=entry.model,
            base_url=base_url,
            timeout=entry.timeout,
        )
    else:  # ollama
        from asclepius.llm.ollama import OllamaProvider
        provider = OllamaProvider(
            base_url=entry.base_url,
            model=entry.model,
            timeout=entry.timeout,
        )

    provider.provider_label = label
    return provider


def get_llm_provider_count(config: AppConfig) -> int:
    """Return the number of enabled LLM providers."""
    return len([p for p in config.llm.providers if p.enabled])
