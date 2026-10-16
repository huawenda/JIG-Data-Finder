"""
生产分发包打包 (一次性工具)

把构建好的 exe 组装成可直接分发的绿色版:
  JIG-Data-Finder-2.0.0-win64/
    jig-data-finder.exe
    使用说明.md
    版本信息.txt
    SHA256SUMS.txt

并生成一个 zip 便于拷贝。

运行: python tools/package-release.py
"""

import hashlib
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = "2.0.0"
EXE_SRC = os.path.join(ROOT, "src-tauri", "target", "release", "jig-data-finder.exe")
# thin-lto 与 fat-lto 的产物都落在 release/, dist/ 是 cargo 的 dist profile 输出
EXE_CANDIDATES = [
    os.path.join(ROOT, "src-tauri", "target", "dist", "jig-data-finder.exe"),
    EXE_SRC,
]

OUT_ROOT = os.path.join(ROOT, "dist-package")
PKG_NAME = f"JIG-Data-Finder-{VERSION}-win64"
PKG_DIR = os.path.join(OUT_ROOT, PKG_NAME)
ZIP_PATH = os.path.join(OUT_ROOT, f"{PKG_NAME}.zip")

DOC_SRC = os.path.join(ROOT, "dist-package", "使用说明.md")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    # 选 exe: 优先 dist profile 产物
    exe = next((p for p in EXE_CANDIDATES if os.path.exists(p)), None)
    if not exe:
        print("[FAIL] 找不到构建产物, 请先 npm run tauri:build")
        sys.exit(1)

    size_mb = os.path.getsize(exe) / 1024 / 1024
    profile = "dist (fat LTO)" if "target\\dist" in exe else "release (thin LTO)"
    print(f"使用产物: {exe}")
    print(f"  profile : {profile}")
    print(f"  体积    : {size_mb:.2f} MB")

    # 清理旧包
    if os.path.isdir(PKG_DIR):
        shutil.rmtree(PKG_DIR)
    if os.path.exists(ZIP_PATH):
        os.remove(ZIP_PATH)
    os.makedirs(PKG_DIR, exist_ok=True)

    # 1. exe
    dst_exe = os.path.join(PKG_DIR, "jig-data-finder.exe")
    shutil.copy2(exe, dst_exe)

    # 2. 使用说明
    if os.path.exists(DOC_SRC):
        shutil.copy2(DOC_SRC, os.path.join(PKG_DIR, "使用说明.md"))

    # 3. 版本信息
    digest = sha256(dst_exe)
    info = f"""JIG Data Finder {VERSION} (win64)
{'=' * 46}

构建时间   : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
文件大小   : {size_mb:.2f} MB
构建 profile: {profile}
SHA256     : {digest}

运行环境
  操作系统 : Windows 10 1803+ / Windows 11 (x64)
  额外依赖 : 无 (使用系统自带 WebView2)
  安装方式 : 绿色版, 复制 exe 到任意目录即可运行

SHA256 校验 (PowerShell):
  Get-FileHash -Algorithm SHA256 .\\jig-data-finder.exe

与旧版关系
  1.x 为 Python + PySide2 版, 配置路径与键名保持一致, 可平滑升级。
"""
    with open(os.path.join(PKG_DIR, "版本信息.txt"), "w", encoding="utf-8") as f:
        f.write(info)

    # 4. SHA256SUMS
    with open(os.path.join(PKG_DIR, "SHA256SUMS.txt"), "w", encoding="utf-8") as f:
        f.write(f"{digest}  jig-data-finder.exe\n")

    # 5. zip
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for fn in sorted(os.listdir(PKG_DIR)):
            z.write(os.path.join(PKG_DIR, fn), arcname=f"{PKG_NAME}/{fn}")

    zip_mb = os.path.getsize(ZIP_PATH) / 1024 / 1024

    print()
    print("=== 分发包已生成 ===")
    print(f"目录: {PKG_DIR}")
    for fn in sorted(os.listdir(PKG_DIR)):
        p = os.path.join(PKG_DIR, fn)
        print(f"  {fn:24s} {os.path.getsize(p)/1024:>10.1f} KB")
    print()
    print(f"ZIP : {ZIP_PATH}  ({zip_mb:.2f} MB)")
    print(f"SHA256: {digest}")
    print()
    print("注意: zip 内文件名是 UTF-8, 部分老版本 WinRAR 解压可能乱码,")
    print("      建议用 Windows 自带解压或 7-Zip。")


if __name__ == "__main__":
    main()