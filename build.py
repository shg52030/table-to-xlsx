"""打包成可分发 zip（排除测试与开发脚本）。"""
import os
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "..", "table-to-xlsx-v1.0.0.zip")

EXCLUDE_DIRS = {"test", "__pycache__", ".git"}
EXCLUDE_FILES = {"make_icons.py", "build.py"}

count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for name in filenames:
            if name in EXCLUDE_FILES or name.endswith(".xlsx"):
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, ROOT)
            z.write(full, os.path.join("table-to-xlsx", rel))
            count += 1

print("packed %d files -> %s (%.1f KB)" % (count, os.path.abspath(OUT), os.path.getsize(OUT) / 1024))
