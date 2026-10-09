from buscapiso import events


def test_emit_reaches_the_installed_sink():
    seen = []
    previous = events.set_sink(seen.append)
    try:
        events.emit("stage", "1/5 crawling", step=1, total=5)
    finally:
        events.set_sink(previous)
    assert seen == [events.Event("stage", "1/5 crawling", {"step": 1, "total": 5})]


def test_default_sink_prints(capsys):
    events.emit("info", "hola")
    assert capsys.readouterr().out == "hola\n"
