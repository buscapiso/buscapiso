import pytest

from buscapiso import navegador


def test_tests_cannot_start_the_crawler_browser():
    with pytest.raises(RuntimeError, match="must not start the crawler"):
        navegador.playwright()
