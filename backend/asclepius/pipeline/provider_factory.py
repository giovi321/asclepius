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

    Uses the new provider list if available, falls back to legacy flat config.
    priority=1 returns the highest-priority enabled provider.
    """
    from asclepius.config import get_active_llm_provider_config

    entry = get_active_llm_provider_config(config, priority)
    if entry:
        return _build_llm_provider(entry)

    # Fallback to legacy config
    if config.llm.provider == "claude" and config.llm.claude_api_key:
        from asclepius.llm.claude import ClaudeProvider
        return ClaudeProvider(
            api_key=config.llm.claude_api_key,
            model=config.llm.claude_model,
            timeout=config.llm.extraction_timeout,
        )
    else:
        from asclepius.llm.ollama import OllamaProvider
        return OllamaProvider(
            base_url=config.llm.ollama_base_url,
            model=config.llm.ollama_model,
            timeout=config.llm.extraction_timeout,
        )


def _build_llm_provider(entry):
    """Instantiate an LLM provider from a LlmProviderEntry."""
    if entry.type == "claude":
        from asclepius.llm.claude import ClaudeProvider
        return ClaudeProvider(
            api_key=entry.api_key,
            model=entry.model,
            timeout=entry.timeout,
        )
    elif entry.type in ("openai", "vllm"):
        from asclepius.llm.openai_provider import OpenAIProvider
        base_url = entry.base_url if entry.type == "vllm" else "https://api.openai.com/v1"
        if entry.base_url and entry.type == "openai":
            base_url = entry.base_url
        return OpenAIProvider(
            api_key=entry.api_key,
            model=entry.model,
            base_url=base_url,
            timeout=entry.timeout,
        )
    else:  # ollama
        from asclepius.llm.ollama import OllamaProvider
        return OllamaProvider(
            base_url=entry.base_url,
            model=entry.model,
            timeout=entry.timeout,
        )


def get_llm_provider_count(config: AppConfig) -> int:
    """Return the number of enabled LLM providers."""
    return len([p for p in config.llm.providers if p.enabled])
