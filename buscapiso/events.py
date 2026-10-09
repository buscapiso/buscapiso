"""Eventos de progreso del motor.

El motor llama a emit() y nunca a print(). El CLI instala print_sink (el
receptor por defecto); la web app de la fase 1 instalara uno que los envia
al navegador.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Literal

Kind = Literal["stage", "progress", "info", "warning", "captcha", "done", "error"]


@dataclass(frozen=True)
class Event:
    kind: Kind
    message: str
    data: dict = field(default_factory=dict)


Sink = Callable[[Event], None]


def print_sink(event: Event) -> None:
    print(event.message)


_sink: Sink = print_sink


def set_sink(sink: Sink) -> Sink:
    """Instala un receptor y devuelve el anterior, para poder restaurarlo."""
    global _sink
    previous, _sink = _sink, sink
    return previous


def emit(kind: Kind, message: str, **data) -> None:
    _sink(Event(kind, message, data))
