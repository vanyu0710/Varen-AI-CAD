"""单一版本源：aicad/VERSION 文件。

打包模式（PyInstaller）下 VERSION 通过 spec 的 datas 随包分发，
运行时按相对路径查找。UI、FastAPI、安装包、Release notes 都必须引用
本模块，禁止再出现硬编码版本号（历史上 0.6.0/0.1.0/0.14 三处漂移的教训）。
"""
from __future__ import annotations

import sys
from pathlib import Path

_CANDIDATES = (
    Path(__file__).resolve().parent.parent / "VERSION",            # 源码模式：aicad/VERSION
    Path(getattr(sys, "_MEIPASS", ".")) / "VERSION",               # 冻结模式：随包分发
    Path.cwd() / "VERSION",
)

FALLBACK_VERSION = "unknown"


def _read() -> str:
    for path in _CANDIDATES:
        try:
            text = path.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if text:
            return text
    return FALLBACK_VERSION


APP_VERSION = _read()
