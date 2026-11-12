"""打包成可分发 zip：版本号从 manifest.json 读取，排除测试与开发脚本。

用法：python build.py
输出：项目上级目录/table-to-xlsx-v<version>.zip
"""
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
EXCLUDE_DIRS = {"test", "__pycache__", ".git"}
EXCLUDE_FILES = {"make_icons.py", "build.py"}


def read_manifest():
    with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)


def missing_refs(manifest):
    """返回清单里引用了但磁盘上不存在的文件，避免打出一个装不上的包。"""
    refs = []
    background = manifest.get("background", {})
    if background.get("service_worker"):
        refs.append(background["service_worker"])
    action = manifest.get("action", {})
    if action.get("default_popup"):
        refs.append(action["default_popup"])
    for cs in manifest.get("content_scripts", []):
        refs.extend(cs.get("js", []))
        refs.extend(cs.get("css", []))
    refs.extend(manifest.get("icons", {}).values())
    refs.extend(action.get("default_icon", {}).values())
    return [r for r in dict.fromkeys(refs) if not os.path.exists(os.path.join(ROOT, r))]


def main():
    manifest = read_manifest()
    version = manifest["version"]
    out = os.path.join(ROOT, "..", "table-to-xlsx-v%s.zip" % version)

    missing = missing_refs(manifest)
    if missing:
        print("打包中止：manifest.json 引用了不存在的文件")
        for m in missing:
            print("  缺失 -", m)
        return 1

    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
            for name in filenames:
                if name in EXCLUDE_FILES or name.endswith(".xlsx"):
                    continue
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, ROOT)
                z.write(full, os.path.join("table-to-xlsx", rel))
                count += 1

    print("v%s | %d 个文件 | %.1f KB" % (version, count, os.path.getsize(out) / 1024))
    print("->", os.path.abspath(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
