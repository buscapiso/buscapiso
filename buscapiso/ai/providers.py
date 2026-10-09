"""Proveedores de IA con la clave de cada usuario.

Claude va por el SDK oficial (`anthropic`) con salidas estructuradas. El resto
(Gemini, OpenAI, OpenRouter, Ollama) por su API compatible con OpenAI: piden
JSON en modo objeto, y como algunas capas de compatibilidad no respetan un
esquema, se valida con Pydantic y se reintenta una vez.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable

from pydantic import ValidationError


class AIError(Exception):
    """La IA no ha podido responder o no ha devuelto lo esperado."""


@dataclass
class Usage:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0


# Dolares por millon de tokens (entrada, salida), de la referencia de la API.
PRICES: dict[str, tuple[float, float]] = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
}


def estimate_cost(model: str, usage: Usage) -> float | None:
    precio = PRICES.get(model)
    if precio is None:
        return None
    return (usage.input_tokens * precio[0] + usage.output_tokens * precio[1]) / 1_000_000


class ClaudeProvider:
    name = "anthropic"

    def __init__(self, api_key: str, model: str = "claude-opus-5-5", client=None):
        import anthropic
        self.model = model
        self.client = client or anthropic.Anthropic(api_key=api_key, max_retries=2)
        self.usage = Usage()

    def _cuenta(self, r) -> None:
        self.usage.calls += 1
        self.usage.input_tokens += r.usage.input_tokens
        self.usage.output_tokens += r.usage.output_tokens

    def _llamar(self, metodo, **kw):
        import anthropic
        try:
            return metodo(model=self.model, messages=kw.pop("messages"), **kw)
        except anthropic.APIStatusError as e:
            raise AIError(f"Claude answered HTTP {e.status_code}") from None
        except anthropic.APIConnectionError:
            raise AIError("Could not reach the Claude API") from None

    def json(self, system: str, user: str, schema):
        r = self._llamar(self.client.messages.parse, max_tokens=4096, system=system,
                         messages=[{"role": "user", "content": user}],
                         output_format=schema, output_config={"effort": "low"})
        self._cuenta(r)
        if r.stop_reason == "refusal" or r.parsed_output is None:
            raise AIError("Claude did not return the expected data")
        return r.parsed_output

    def text(self, system: str, user: str, max_tokens: int = 1024) -> str:
        r = self._llamar(self.client.messages.create, max_tokens=max_tokens, system=system,
                         messages=[{"role": "user", "content": user}],
                         output_config={"effort": "low"})
        self._cuenta(r)
        if r.stop_reason == "refusal":
            raise AIError("Claude declined this request")
        texto = next((b.text for b in r.content if b.type == "text"), "")
        if not texto:
            raise AIError("Claude returned no text")
        return texto


def _post_json(url: str, headers: dict, body: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={**headers, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


_VALLA = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.S)


class OpenAICompatProvider:
    name = "openai_compat"

    def __init__(self, api_key: str, base_url: str, model: str,
                 post: Callable[[str, dict, dict], dict] | None = None):
        self.key, self.model = api_key, model
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.post = post or _post_json
        self.usage = Usage()

    def _completar(self, system: str, user: str, max_tokens: int, json_mode: bool) -> str:
        body = {"model": self.model, "max_tokens": max_tokens,
                "messages": [{"role": "system", "content": system},
                             {"role": "user", "content": user}]}
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        headers = {"Authorization": f"Bearer {self.key}"} if self.key else {}
        try:
            r = self.post(self.url, headers, body)
        except urllib.error.HTTPError as e:
            raise AIError(f"The AI provider answered HTTP {e.code}") from None
        except OSError as e:
            raise AIError(f"Could not reach the AI provider: {type(e).__name__}") from None
        self.usage.calls += 1
        uso = r.get("usage") or {}
        self.usage.input_tokens += uso.get("prompt_tokens", 0)
        self.usage.output_tokens += uso.get("completion_tokens", 0)
        try:
            eleccion = r["choices"][0]
            contenido = eleccion["message"].get("content") or ""
        except (KeyError, IndexError, TypeError, AttributeError):
            raise AIError("The AI provider returned an unexpected answer") from None
        if not contenido and eleccion.get("finish_reason") == "length":
            raise AIError("The model ran out of room before answering (it spends tokens "
                          "thinking). Try a lighter model.")
        return contenido

    def json(self, system: str, user: str, schema):
        sistema = (f"{system}\n\nReply with a single JSON object that matches this JSON "
                   f"Schema, and nothing else:\n{json.dumps(schema.model_json_schema())}")
        for _ in range(2):
            texto = self._completar(sistema, user, 4096, json_mode=True)
            m = _VALLA.match(texto)
            try:
                return schema.model_validate_json(m.group(1) if m else texto)
            except (ValidationError, ValueError):
                continue
        raise AIError("The model did not return valid JSON")

    def text(self, system: str, user: str, max_tokens: int = 1024) -> str:
        texto = self._completar(system, user, max_tokens, json_mode=False).strip()
        if not texto:
            raise AIError("The AI provider returned no text")
        return texto
