"""MOSS YXBOX：MOSS-Image 控图排版（单节点，中文界面）。"""

import base64
import io
import os
import re
import shutil
import tempfile

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY", "PLUGIN_VERSION"]


def _read_version() -> str:
    """当前实际安装的插件版本：优先 pyproject.toml，其次包元数据，最后未知。"""
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        with open(os.path.join(here, "pyproject.toml"), "r", encoding="utf-8") as fh:
            text = fh.read()
        m = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
        if m:
            return m.group(1).strip()
    except Exception:
        pass
    try:
        from importlib.metadata import version as _pkg_version

        return str(_pkg_version("moss-yxbox")).strip()
    except Exception:
        return ""


PLUGIN_VERSION = _read_version()

# ---------------------------------------------------------------- 用户数据存档
# 预设、编辑库偏好、自定义 tag、AI 配置都落在 ComfyUI 的 user/default/moss_yxbox 下：
# 升级插件、换端口、换浏览器、清浏览器缓存都不会丢；写文件走「临时文件 + 原子替换」，
# 中途断电也不会读到半截 JSON。
_STORE_FILES = {
    "presets": "presets.json",
    "editor": "editor.json",
    "tags_custom": "tags_custom.json",
    "preview_index": "preview_index.json",
    "config": "config.json",
}
_STORE_MAX_BYTES = 16 * 1024 * 1024


def _store_root() -> str:
    """存档根目录：<ComfyUI>/user/default/moss_yxbox（优先用官方 user 目录）。"""
    base = ""
    try:
        import folder_paths

        getter = getattr(folder_paths, "get_user_directory", None)
        if callable(getter):
            base = str(getter() or "")
    except Exception:
        base = ""
    if not base:
        here = os.path.dirname(os.path.abspath(__file__))
        base = os.path.join(os.path.dirname(os.path.dirname(here)), "user")
    path = os.path.join(base, "default", "moss_yxbox")
    os.makedirs(path, exist_ok=True)
    return path


def _store_config() -> dict:
    """根目录下的 config.json（自定义存档路径等基础设置）。"""
    import json

    path = os.path.join(_store_root(), "config.json")
    if not os.path.isfile(path):
        return {}
    try:
        with io.open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _store_dir() -> str:
    """实际存档目录：默认根目录；config.json 里设了 dir 就用它（坏路径自动退回）。"""
    root = _store_root()
    cfg = _store_config()
    custom = str(cfg.get("dir") or "").strip()
    if custom:
        try:
            os.makedirs(custom, exist_ok=True)
            probe = os.path.join(custom, ".w")
            with io.open(probe, "w", encoding="utf-8") as fh:
                fh.write("ok")
            os.remove(probe)
            return custom
        except Exception:
            pass
    return root


def _store_read(name: str):
    """读一个存档；文件不存在时返回 None（前端据此走首次迁移）。"""
    import json

    filename = _STORE_FILES.get(name)
    if not filename:
        raise KeyError(name)
    path = os.path.join(_store_dir(), filename)
    if not os.path.isfile(path):
        return None
    with io.open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _store_write(name: str, data):
    """原子写一个存档：先写 .tmp，再 os.replace 顶掉旧文件。"""
    import json
    import tempfile

    filename = _STORE_FILES.get(name)
    if not filename:
        raise KeyError(name)
    folder = _store_root() if name == "config" else _store_dir()
    path = os.path.join(folder, filename)
    text = json.dumps(data, ensure_ascii=False)
    raw = text.encode("utf-8")
    if len(raw) > _STORE_MAX_BYTES:
        raise ValueError("内容太大")
    tmp_fd, tmp_path = tempfile.mkstemp(prefix=filename + ".", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(tmp_fd, "wb") as fh:
            fh.write(raw)
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
    return len(raw)


# 给前端一个只读接口，状态栏据此显示「实际安装版本」（改 pyproject 后刷新页面即生效，不用改 JS）
try:
    from aiohttp import web
    from server import PromptServer

    _routes = getattr(getattr(PromptServer, "instance", None), "routes", None)
    if _routes is not None:

        @_routes.get("/moss_yxbox/version")
        async def _moss_yxbox_version(_request):
            # 每次请求都重新读一遍 pyproject.toml：改了版本号刷新页面即可，不必重启
            headers = {"Cache-Control": "no-store, max-age=0"}
            return web.json_response({"version": _read_version() or PLUGIN_VERSION}, headers=headers)

except Exception:
    pass


# 用户数据存档接口（前端读写上面那几个 JSON；只认白名单里的名字）
try:
    from aiohttp import web
    from server import PromptServer

    _store_routes = getattr(getattr(PromptServer, "instance", None), "routes", None)
    if _store_routes is not None:

        @_store_routes.get("/moss_yxbox/store/{name}")
        async def _moss_yxbox_store_get(request):
            name = str(request.match_info.get("name") or "")
            headers = {"Cache-Control": "no-store, max-age=0"}
            if name not in _STORE_FILES:
                return web.json_response({"ok": False, "error": "unknown"}, status=404, headers=headers)
            try:
                data = _store_read(name)
            except Exception as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=500, headers=headers)
            return web.json_response({"ok": True, "data": data, "dir": _store_dir()}, headers=headers)

        @_store_routes.post("/moss_yxbox/store/{name}")
        async def _moss_yxbox_store_post(request):
            name = str(request.match_info.get("name") or "")
            headers = {"Cache-Control": "no-store, max-age=0"}
            if name not in _STORE_FILES:
                return web.json_response({"ok": False, "error": "unknown"}, status=404, headers=headers)
            try:
                body = await request.json()
                if not isinstance(body, dict) or "data" not in body:
                    return web.json_response({"ok": False, "error": "bad body"}, status=400, headers=headers)
                size = _store_write(name, body.get("data"))
            except Exception as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=500, headers=headers)
            return web.json_response({"ok": True, "bytes": size}, headers=headers)

        # Tag 预览图（用户自己的图片，存在 user 目录下的 previews/ 里；与工作流无关）
        _PREVIEW_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}\.(?:png|webp|jpe?g)$")
        _PREVIEW_MAX = 8 * 1024 * 1024
        _PREVIEW_TYPES = {
            ".png": "image/png",
            ".webp": "image/webp",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
        }

        def _preview_type(name):
            return _PREVIEW_TYPES.get(os.path.splitext(str(name))[1].lower(), "image/png")


        def _preview_dir():
            folder = os.path.join(_store_dir(), "previews")
            os.makedirs(folder, exist_ok=True)
            return folder

        @_store_routes.get("/moss_yxbox/preview/{name}")
        async def _moss_yxbox_preview_get(request):
            name = str(request.match_info.get("name") or "")
            headers = {"Cache-Control": "no-store, max-age=0"}
            if not _PREVIEW_RE.match(name):
                return web.Response(status=404, headers=headers)
            path = os.path.join(_preview_dir(), name)
            if not os.path.isfile(path):
                return web.Response(status=404, headers=headers)
            try:
                with io.open(path, "rb") as handle:
                    payload = handle.read()
            except Exception as exc:
                return web.Response(status=500, headers=headers)
            return web.Response(
                body=payload,
                headers={"Content-Type": _preview_type(name), "Cache-Control": "no-cache"},
            )

        @_store_routes.post("/moss_yxbox/preview/{name}")
        async def _moss_yxbox_preview_post(request):
            name = str(request.match_info.get("name") or "")
            headers = {"Cache-Control": "no-store, max-age=0"}
            if not _PREVIEW_RE.match(name):
                return web.json_response({"ok": False, "error": "bad name"}, status=404, headers=headers)
            try:
                body = await request.json()
                raw = body.get("data") if isinstance(body, dict) else None
                if not isinstance(raw, str):
                    return web.json_response({"ok": False, "error": "bad body"}, status=400, headers=headers)
                if "," in raw[:64]:
                    raw = raw.split(",", 1)[1]
                payload = base64.b64decode(raw)
                if (not payload) or len(payload) > _PREVIEW_MAX:
                    return web.json_response({"ok": False, "error": "bad size"}, status=400, headers=headers)
                path = os.path.join(_preview_dir(), name)
                fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
                with os.fdopen(fd, "wb") as handle:
                    handle.write(payload)
                os.replace(tmp_path, path)
            except Exception as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=500, headers=headers)
            return web.json_response({"ok": True, "bytes": len(payload)}, headers=headers)

        @_store_routes.delete("/moss_yxbox/preview/{name}")
        async def _moss_yxbox_preview_delete(request):
            name = str(request.match_info.get("name") or "")
            headers = {"Cache-Control": "no-store, max-age=0"}
            if not _PREVIEW_RE.match(name):
                return web.json_response({"ok": False, "error": "bad name"}, status=404, headers=headers)
            try:
                path = os.path.join(_preview_dir(), name)
                if os.path.isfile(path):
                    os.remove(path)
            except Exception as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=500, headers=headers)
            return web.json_response({"ok": True}, headers=headers)

except Exception:
    pass

# 内置数据文件（tag 库、角色库等放在 web/data/ 下；只读，只认这个目录里的普通文件）
try:
    from aiohttp import web
    from server import PromptServer

    _DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "data")
    _DATA_TYPES = {
        ".json": "application/json; charset=utf-8",
        ".gz": "application/gzip",
        ".txt": "text/plain; charset=utf-8",
    }
    _data_routes = getattr(getattr(PromptServer, "instance", None), "routes", None)
    if _data_routes is not None:


        _BK_NAME_LOCAL = re.compile(r"^[A-Za-z0-9_\-. ]{1,120}$")

        def _bk_path(raw, create=False):
            """备份目录：必须是完整绝对路径（相对路径一律拒绝）。"""
            text = str(raw or "").strip()
            if (not text) or (text in (".", "..")):
                return ""
            try:
                path = os.path.normpath(os.path.expanduser(text))
            except Exception:
                return ""
            if not os.path.isabs(path):
                return ""
            if create:
                try:
                    os.makedirs(path, exist_ok=True)
                except Exception:
                    return ""
            return path

        def _preview_names(raw):
            names = []
            for item in raw if isinstance(raw, list) else []:
                text = str(item or "").strip()
                if text and _PREVIEW_RE.match(text) and text not in names:
                    names.append(text)
            return names

        @_store_routes.post("/moss_yxbox/backup/previews")
        async def _moss_yxbox_backup_previews(request):
            """把 previews/ 里的指定图片拷进备份目录（备份可选包含预览图，走文件拷贝不走 base64）。"""
            headers = {"Cache-Control": "no-store, max-age=0"}
            try:
                body = await request.json()
                if not isinstance(body, dict):
                    return web.json_response({"ok": False, "error": "bad body"}, status=400, headers=headers)
                folder = _bk_path(body.get("dir"), create=True)
                name = str(body.get("name") or "").strip()
                if not _BK_NAME_LOCAL.match(name):
                    return web.json_response({"ok": False, "error": "bad name"}, status=400, headers=headers)
                names = _preview_names(body.get("names"))
                target = os.path.join(folder, name + ".previews")
                os.makedirs(target, exist_ok=True)
                copied = 0
                for item in names:
                    source = os.path.join(_preview_dir(), item)
                    if os.path.isfile(source):
                        shutil.copy2(source, os.path.join(target, item))
                        copied += 1
            except Exception as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=500, headers=headers)
            return web.json_response({"ok": True, "count": copied, "dir": target}, headers=headers)

        @_store_routes.post("/moss_yxbox/preview/restore")
        async def _moss_yxbox_preview_restore(request):
            """把备份目录里的 *.previews 文件拷回 previews/（恢复备份时用）。"""
            headers = {"Cache-Control": "no-store, max-age=0"}
            try:
                body = await request.json()
                if not isinstance(body, dict):
                    return web.json_response({"ok": False, "error": "bad body"}, status=400, headers=headers)
                folder = _bk_path(body.get("dir"), create=False)
                names = _preview_names(body.get("names"))
                target = _preview_dir()
                copied = 0
                for item in names:
                    source = os.path.join(folder, item)
                    if os.path.isfile(source):
                        shutil.copy2(source, os.path.join(target, item))
                        copied += 1
            except Exception as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=500, headers=headers)
            return web.json_response({"ok": True, "count": copied}, headers=headers)

        @_data_routes.get("/moss_yxbox/data/{name}")
        async def _moss_yxbox_data(request):
            name = str(request.match_info.get("name") or "")
            if (not name) or ("/" in name) or ("\\" in name) or (".." in name):
                return web.json_response({"ok": False, "error": "bad name"}, status=404)
            path = os.path.join(_DATA_DIR, name)
            if not os.path.isfile(path):
                return web.json_response({"ok": False, "error": "missing"}, status=404)
            ext = os.path.splitext(name)[1].lower()
            with io.open(path, "rb") as fh:
                payload = fh.read()
            return web.Response(
                body=payload,
                headers={
                    "Content-Type": _DATA_TYPES.get(ext, "application/octet-stream"),
                    "Cache-Control": "public, max-age=3600",
                },
            )

except Exception:
    pass


# ---- yx_extra_routes_block ----
try:
    _file_routes = getattr(getattr(PromptServer, "instance", None), "routes", None)
    if _file_routes is not None:
        import base64 as _b64
        import glob as _glob
        import json as _json
        import sqlite3 as _sqlite3
        import time as _time

        _BK_NAME = re.compile(r"^[A-Za-z0-9_\-. ]{1,120}$")
        _BK_MAX = 64 * 1024 * 1024

        def _bk_dir(raw, create=False):
            text = str(raw or "").strip()
            if (not text) or (text in (".", "..")):
                return ""
            try:
                path = os.path.normpath(os.path.expanduser(text))
            except Exception:
                return ""
            if not os.path.isabs(path):
                return ""
            if create:
                try:
                    os.makedirs(path, exist_ok=True)
                except Exception:
                    return ""
            return path

        @_file_routes.post("/moss_yxbox/backup")
        async def _moss_yxbox_backup_save(request):
            headers = {"Cache-Control": "no-store, max-age=0"}
            try:
                body = await request.json()
            except Exception:
                return web.json_response({"ok": False, "error": "bad body"}, status=400, headers=headers)
            if not isinstance(body, dict):
                return web.json_response({"ok": False, "error": "bad body"}, status=400, headers=headers)
            folder = _bk_path(body.get("dir"), create=True)
            if not folder:
                return web.json_response({"ok": False, "error": "备份目录无效（需要完整绝对路径）"}, status=400, headers=headers)
            name = str(body.get("name") or "").strip()
            if not _BK_NAME.match(name):
                return web.json_response({"ok": False, "error": "文件名无效"}, status=400, headers=headers)
            data = body.get("data")
            try:
                if isinstance(data, str):
                    payload = data.encode("utf-8")
                else:
                    payload = _json.dumps(data, ensure_ascii=False, indent=1).encode("utf-8")
            except Exception as exc:
                return web.json_response({"ok": False, "error": "内容无法序列化：%s" % exc}, status=400, headers=headers)
            if len(payload) > _BK_MAX:
                return web.json_response({"ok": False, "error": "备份内容超过 64MB"}, status=400, headers=headers)
            target = os.path.join(folder, name)
            try:
                fd, tmp = tempfile.mkstemp(prefix=".yxbk_", dir=folder)
                with os.fdopen(fd, "wb") as handle:
                    handle.write(payload)
                os.replace(tmp, target)
            except Exception as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=500, headers=headers)
            return web.json_response({"ok": True, "path": target, "bytes": len(payload)}, headers=headers)

        @_file_routes.get("/moss_yxbox/backup")
        async def _moss_yxbox_backup_list(request):
            headers = {"Cache-Control": "no-store, max-age=0"}
            folder = _bk_dir(request.query.get("dir"))
            if not folder:
                return web.json_response({"ok": False, "error": "备份目录无效"}, status=400, headers=headers)
            files = []
            try:
                for name in sorted(_glob.glob(os.path.join(folder, "*"))):
                    if not os.path.isfile(name):
                        continue
                    base = os.path.basename(name)
                    if not _BK_NAME.match(base):
                        continue
                    stat = os.stat(name)
                    files.append({"name": base, "size": stat.st_size, "mtime": int(stat.st_mtime)})
            except Exception as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=500, headers=headers)
            files.reverse()
            return web.json_response({"ok": True, "dir": folder, "files": files[:200]}, headers=headers)

        @_file_routes.get("/moss_yxbox/backup/file")
        async def _moss_yxbox_backup_read(request):
            headers = {"Cache-Control": "no-store, max-age=0"}
            folder = _bk_dir(request.query.get("dir"))
            name = str(request.query.get("name") or "").strip()
            if not folder or not _BK_NAME.match(name):
                return web.json_response({"ok": False, "error": "目录或文件名无效"}, status=400, headers=headers)
            target = os.path.join(folder, name)
            if not os.path.isfile(target):
                return web.json_response({"ok": False, "error": "文件不存在"}, status=404, headers=headers)
            try:
                with open(target, "r", encoding="utf-8") as handle:
                    text = handle.read()
            except Exception as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=500, headers=headers)
            return web.json_response({"ok": True, "name": name, "data": text}, headers=headers)

        @_file_routes.delete("/moss_yxbox/backup/file")
        async def _moss_yxbox_backup_delete(request):
            headers = {"Cache-Control": "no-store, max-age=0"}
            folder = _bk_dir(request.query.get("dir"))
            name = str(request.query.get("name") or "").strip()
            if not folder or not _BK_NAME.match(name):
                return web.json_response({"ok": False, "error": "目录或文件名无效"}, status=400, headers=headers)
            target = os.path.join(folder, name)
            if not os.path.isfile(target):
                return web.json_response({"ok": False, "error": "文件不存在"}, status=404, headers=headers)
            try:
                os.remove(target)
            except Exception as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=500, headers=headers)
            return web.json_response({"ok": True}, headers=headers)

        @_file_routes.post("/moss_yxbox/taglib/import")
        async def _moss_yxbox_taglib_import(request):
            headers = {"Cache-Control": "no-store, max-age=0"}
            try:
                body = await request.json()
            except Exception:
                return web.json_response({"ok": False, "error": "bad body"}, status=400, headers=headers)
            if not isinstance(body, dict):
                return web.json_response({"ok": False, "error": "bad body"}, status=400, headers=headers)
            raw = str(body.get("data") or "")
            if raw.startswith("data:"):
                raw = raw.split(",", 1)[-1]
            try:
                blob = _b64.b64decode(raw, validate=False)
            except Exception:
                return web.json_response({"ok": False, "error": "文件内容无法解码"}, status=400, headers=headers)
            if not blob:
                return web.json_response({"ok": False, "error": "文件为空"}, status=400, headers=headers)
            if len(blob) > _BK_MAX:
                return web.json_response({"ok": False, "error": "文件超过 64MB"}, status=400, headers=headers)
            tmpdir = tempfile.mkdtemp(prefix="yx_import_")
            path = os.path.join(tmpdir, "tags.db")
            with open(path, "wb") as handle:
                handle.write(blob)
            try:
                conn = _sqlite3.connect(path)
                try:
                    groups = []
                    rows = list(conn.execute("SELECT id_index, name FROM tag_groups ORDER BY id_index"))
                    sub_rows = list(conn.execute("SELECT id_index, group_id, name FROM tag_subgroups ORDER BY id_index"))
                    tag_rows = list(conn.execute("SELECT subgroup_id, text, desc FROM tag_tags ORDER BY id_index"))
                finally:
                    conn.close()
            except Exception as exc:
                return web.json_response({"ok": False, "error": "不是可识别的标签库文件：%s" % exc}, status=400, headers=headers)
            finally:
                try:
                    os.remove(path)
                    os.rmdir(tmpdir)
                except Exception:
                    pass
            by_sub = {}
            for sub_id, text, desc in tag_rows:
                text = str(text or "").strip()
                if not text:
                    continue
                by_sub.setdefault(int(sub_id or 0), []).append([text, str(desc or "").strip()])
            subs_by_group = {}
            for sub_id, group_id, name in sub_rows:
                subs_by_group.setdefault(int(group_id or 0), []).append(
                    {"name": str(name or "").strip(), "tags": by_sub.get(int(sub_id or 0), [])}
                )
            for group_id, name in rows:
                groups.append(
                    {"name": str(name or "").strip(), "subs": subs_by_group.get(int(group_id or 0), [])}
                )
            total = sum(len(s["tags"]) for g in groups for s in g["subs"])
            return web.json_response({"ok": True, "groups": groups, "total": total}, headers=headers)

except Exception:
    pass
