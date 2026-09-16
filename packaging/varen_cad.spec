# -*- mode: python ; coding: utf-8 -*-
"""Varen CAD 打包版（onedir）：一个 exe，双模式。

- 无参数：FastAPI 后端 + 浏览器（frontend/dist、prompts 随包）
- --kernel：MechKernel worker（mech_kernel + build123d + OCP 冻结进包）

构建：aicad/.venv/Scripts/pyinstaller packaging/varen_cad.spec --noconfirm
"""
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

APP_ROOT = Path(SPECPATH).resolve().parent          # aicad/
KERNEL_ROOT = APP_ROOT.parents[1] / "mechcad-kernel"  # 与 backend/kernel_worker.py 默认一致
assert KERNEL_ROOT.exists(), f"kernel repo not found: {KERNEL_ROOT}"

# spec 求值期让 collect_* 能找到 mech_kernel
sys.path.insert(0, str(KERNEL_ROOT))

datas, binaries, hiddenimports = [], [], []
for pkg in ("build123d", "OCP", "ocpsvg", "ocp_gordon", "lib3mf", "mech_kernel",
            "scipy", "numpy"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("backend")

# 运行时按 __file__ 相对路径查找：_MEIPASS/frontend/dist、_MEIPASS/prompts、_MEIPASS/cad_worker
datas += [
    (str(APP_ROOT / "VERSION"), "."),
    (str(APP_ROOT / "LICENSE"), "."),
    (str(APP_ROOT / "frontend" / "dist"), "frontend" + os.sep + "dist"),
    (str(APP_ROOT / "prompts"), "prompts"),
    (str(APP_ROOT / "cad_worker" / "freecad_executor.py"), "cad_worker"),
    (str(APP_ROOT / "cad_worker" / "font_guard.py"), "cad_worker"),
    # scipy.stats._distn_infrastructure 源码副本：runtime hook 用它现场编译，
    # 绕开 PyInstaller code.replace() 对该模块 dir()+exec(del) 清理循环的破坏
    (str(Path(sys.executable).parent.parent / "Lib" / "site-packages" / "scipy" / "stats" / "_distn_infrastructure.py"), "scipy_stats_src"),
]

a = Analysis(
    [str(APP_ROOT / "packaging" / "varen_launcher.py")],
    pathex=[str(APP_ROOT), str(KERNEL_ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[str(Path(SPECPATH) / "hooks" / "pyi_rth_scipy_distn_fix.py")],
    excludes=[
        "gradio", "gradio_client", "huggingface_hub",
        "pytest", "tkinter", "pandas", "PyQt5", "PySide6", "cv2",
        "ruff", "pydub", "ffmpy", "imageio_ffmpeg",
    ],  # 注意：build123d 顶层 import IPython，不能排除
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="VarenCAD",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # 启动器立即隐藏控制台；--kernel 子进程需要真实 stdio 管道
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(APP_ROOT / "packaging" / "varen-cad.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="VarenCAD",
)
