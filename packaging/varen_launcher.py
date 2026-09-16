"""Varen CAD 打包版入口。

两种模式（同一个 exe，靠 argv 区分）：

- 直接双击 / 无参数：启动 FastAPI 后端（backend.main:app），就绪后打开浏览器。
  工作目录切到 exe 所在目录，`work/`、`.env` 都放在 exe 旁边。
- `VarenCAD.exe --kernel`：以 stdio JSON-lines RPC 方式运行 MechKernel worker
  server（由 backend/kernel_worker.py 在冻结模式下自我 spawn）。

开发模式也可以用这个入口：`python packaging/varen_launcher.py`。
"""
from __future__ import annotations

import os
import sys
import threading
import time
import webbrowser
from pathlib import Path

IS_FROZEN = getattr(sys, "frozen", False)


def app_dir() -> Path:
    """exe（或开发模式下仓库根）所在目录。"""
    if IS_FROZEN:
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def kernel_repo_dir() -> Path:
    return app_dir().parents[1] / "mechcad-kernel"


def run_kernel() -> int:
    """MechKernel worker server 模式。stdout 只承载协议行，日志走 stderr。"""
    if not IS_FROZEN:
        repo = kernel_repo_dir()
        if repo.exists() and str(repo) not in sys.path:
            sys.path.insert(0, str(repo))
    from mech_kernel.server import main as kernel_main

    return kernel_main()


def run_cad_worker() -> int:
    """旧通用引擎 worker 模式（cad_worker/freecad_executor.py，build123d 引擎）。"""
    import runpy

    if IS_FROZEN:
        script = Path(getattr(sys, "_MEIPASS", app_dir())) / "cad_worker" / "freecad_executor.py"
    else:
        script = app_dir() / "cad_worker" / "freecad_executor.py"
    sys.argv = [str(script)] + sys.argv[2:]
    runpy.run_path(str(script), run_name="__main__")
    return 0


def _hide_console() -> None:
    if os.name != "nt":
        return
    try:
        import ctypes

        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE
    except Exception:
        pass


def run_app() -> int:
    root = app_dir()
    os.chdir(root)
    (root / "work").mkdir(exist_ok=True)

    # 计算沙箱等纯 stdlib 子进程：打包模式下 sys.executable 是本 exe，
    # 不能当 python 用，改指向随包携带的 embeddable python。
    bundled_py = root / "runtime" / "python" / "python.exe"
    if IS_FROZEN and bundled_py.exists():
        os.environ.setdefault("MECHCAD_SANDBOX_PYTHON", str(bundled_py))

    from dotenv import load_dotenv

    load_dotenv(root / ".env")

    host = os.getenv("MECHCAD_HOST", "127.0.0.1")
    port = int(os.getenv("MECHCAD_PORT", "8001"))
    url = f"http://{host}:{port}"

    log_path = root / "work" / "varen-cad.log"
    import logging

    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    logging.basicConfig(level=logging.INFO, handlers=[file_handler], force=True)

    _hide_console()

    def open_when_ready() -> None:
        import requests

        for _ in range(120):
            try:
                if requests.get(f"{url}/api/health", timeout=1).ok:
                    webbrowser.open(url)
                    return
            except Exception:
                pass
            time.sleep(0.5)

    threading.Thread(target=open_when_ready, daemon=True).start()

    import uvicorn
    from backend.main import app

    print(f"[varen] Varen CAD 已启动：{url}（日志：{log_path}）", file=sys.stderr)
    uvicorn.run(app, host=host, port=port, log_level="info")


def main() -> int:
    if "--kernel" in sys.argv[1:]:
        return run_kernel()
    if "--cad-worker" in sys.argv[1:2]:
        return run_cad_worker()
    return run_app()


if __name__ == "__main__":
    sys.exit(main())
