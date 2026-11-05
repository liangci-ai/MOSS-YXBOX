"""MOSS YXBOX：MOSS-Image 控图排版（单节点，中文界面）。"""

import os
import re

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
