import json

import pytest
from pydantic import BaseModel

from buscapiso.ai.providers import (AIError, ClaudeProvider, OpenAICompatProvider,
                                    estimate_cost)


class Fact(BaseModel):
    gender: str


class FakeUsage:
    input_tokens, output_tokens = 120, 30


class FakeResponse:
    def __init__(self, parsed=None, text=""):
        self.parsed_output = parsed
        self.content = [type("B", (), {"type": "text", "text": text})()]
        self.usage = FakeUsage()
        self.stop_reason = "end_turn"


class FakeMessages:
    def __init__(self):
        self.calls = []

    def parse(self, **kw):
        self.calls.append(kw)
        return FakeResponse(parsed=kw["output_format"](gender="female_only"))

    def create(self, **kw):
        self.calls.append(kw)
        return FakeResponse(text="Hola, me interesa la habitacion.")


def claude():
    client = type("C", (), {})()
    client.messages = FakeMessages()
    return ClaudeProvider("KEY", client=client), client.messages


def test_claude_json_uses_structured_output_and_counts_usage():
    p, m = claude()
    out = p.json("system rules", "listing text", Fact)
    assert out == Fact(gender="female_only")
    assert m.calls[0]["model"] == "claude-opus-5-5"
    assert m.calls[0]["output_format"] is Fact
    assert m.calls[0]["output_config"] == {"effort": "low"}
    assert (p.usage.calls, p.usage.input_tokens, p.usage.output_tokens) == (1, 120, 30)


def test_claude_text_returns_the_text_block():
    p, m = claude()
    assert p.text("s", "u") == "Hola, me interesa la habitacion."


def test_openai_compat_parses_fenced_json_and_retries_once():
    valla = "`" * 3
    respuestas = ["not json at all", f'{valla}json\n{{"gender": "mixed"}}\n{valla}']
    llamadas = []

    def post(url, headers, body):
        llamadas.append((url, headers, body))
        return {"choices": [{"message": {"content": respuestas.pop(0)}}],
                "usage": {"prompt_tokens": 50, "completion_tokens": 10}}

    p = OpenAICompatProvider("K", "https://generativelanguage.googleapis.com/v1beta/openai/",
                             "some-model", post=post)
    assert p.json("s", "u", Fact) == Fact(gender="mixed")
    assert len(llamadas) == 2
    url, headers, body = llamadas[0]
    assert url == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    assert headers["Authorization"] == "Bearer K"
    assert body["response_format"] == {"type": "json_object"}
    assert '"gender"' in body["messages"][0]["content"]       # el esquema va en el sistema
    assert p.usage.input_tokens == 100


def test_openai_compat_gives_up_after_two_bad_answers():
    post = lambda u, h, b: {"choices": [{"message": {"content": "nope"}}]}
    with pytest.raises(AIError):
        OpenAICompatProvider("K", "http://localhost:11434/v1", "m", post=post).json("s", "u", Fact)


def test_errors_never_carry_the_key():
    import urllib.error

    def post(url, headers, body):
        raise urllib.error.HTTPError(url, 401, "bad key SECRET", {}, None)
    with pytest.raises(AIError) as e:
        OpenAICompatProvider("SECRET", "http://x/v1", "m", post=post).text("s", "u")
    assert "SECRET" not in str(e.value) and "401" in str(e.value)


def test_cost_estimate_for_known_models_only():
    from buscapiso.ai.providers import Usage
    u = Usage(calls=10, input_tokens=1_000_000, output_tokens=100_000)
    assert estimate_cost("claude-haiku-5-5", u) == pytest.approx(0.15)
    assert estimate_cost("some-gemini", u) is None
