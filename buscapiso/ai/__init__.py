"""IA opcional con la clave de cada usuario."""
from __future__ import annotations


def ai_from_settings(con, get_key=None):
    """(proveedor, aviso) segun los ajustes. Sin proveedor configurado: (None, None)."""
    from buscapiso import almacen, keys
    from buscapiso.ai.providers import ClaudeProvider, OpenAICompatProvider
    a = almacen.leer_ajustes(con)
    cual = a.get("ai_provider", "none")
    if cual == "none":
        return None, None
    clave = (get_key or keys.get_key)(cual)
    if cual == "anthropic":
        if not clave:
            return None, "AI: Claude needs an API key in the settings"
        return ClaudeProvider(clave, model=a.get("ai_model") or "claude-opus-5-5"), None
    if cual == "openai_compat":
        url, modelo = a.get("ai_base_url", "").strip(), a.get("ai_model", "").strip()
        if not url or not modelo:
            return None, "AI: set the server address and the model name in the settings"
        local = url.startswith(("http://localhost", "http://127.0.0.1"))
        if not clave and not local:
            return None, "AI: this provider needs an API key in the settings"
        return OpenAICompatProvider(clave or "", url, modelo), None
    return None, f"AI: unknown provider {cual}"
