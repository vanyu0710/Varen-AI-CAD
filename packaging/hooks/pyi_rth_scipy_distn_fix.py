"""PyInstaller runtime hook: fix scipy.stats._distn_infrastructure in frozen builds.

PyInstaller 6 normalizes ``co_filename`` recursively via ``code.replace()``
(building/utils.py). On this particular module that transformation flips the
runtime behavior of its ``dir()`` + ``exec('del ' + obj)`` docstring-cleanup
loop (CPython code.replace() interaction), so the frozen import dies with
``NameError: name 'obj' is not defined`` at module import time.

Workaround: bundle the original .py source and recompile it at runtime,
serving it through a meta_path finder that wins over the frozen importer.
"""
import importlib.abc
import importlib.util
import os
import sys

_MODULE = "scipy.stats._distn_infrastructure"


class _FixLoader(importlib.abc.Loader):
    def __init__(self, source_path: str) -> None:
        self._source_path = source_path

    def create_module(self, spec):  # standard module creation
        return None

    def exec_module(self, module) -> None:
        with open(self._source_path, encoding="utf-8") as fh:
            source = fh.read()
        code = compile(source, module.__spec__.origin, "exec")
        exec(code, module.__dict__)


class _FixFinder(importlib.abc.MetaPathFinder):
    def __init__(self, source_path: str) -> None:
        self._source_path = source_path

    def find_spec(self, fullname, path=None, target=None):
        if fullname != _MODULE:
            return None
        return importlib.util.spec_from_loader(
            fullname, _FixLoader(self._source_path), origin=self._source_path
        )


if getattr(sys, "frozen", False):
    _src = os.path.join(getattr(sys, "_MEIPASS", ""), "scipy_stats_src", "_distn_infrastructure.py")
    if os.path.exists(_src):
        sys.meta_path.insert(0, _FixFinder(_src))
