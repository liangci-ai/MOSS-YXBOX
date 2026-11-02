"""MOSS YXBOX —— MOSS-Image 控图排版（单节点）。

一个节点里同时完成：
  1. 画布：在一个画布里画「物体框 / 文字框 / 角色框」三类框，带 16 像素网格与左下角原点坐标系；
  2. 背景：可接入多张背景图（背景图、背景图2、背景图3…），每张都能单独摆放、缩放、隐藏，
     永远位于所有绘制框的最底层，背景图之间的图层顺序单独控制；
  3. 列表：画布下方逐行列出每个框 / 每张背景图，可直接编辑，每个参数都能单独上锁；
  4. 编译：把画布内容编译成 MOSS-Image 的布局提示词
     （与官方 MOSSImageLayoutPrompt 逐字节一致）。

说明：本文件不修改、不依赖任何第三方文件，只在运行时调用 ComfyUI 自带的官方模块
（comfy_extras.nodes_bounding_boxes / comfy_extras.nodes_moss_image）来保证行为一致；
官方模块缺失时退回本地等价实现。
"""

import hashlib
import json
import re
import math

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont

# 画布上的三种框类型 -> 官方元素类型
TYPE_TO_ELEMENT = {"物体框": "obj", "文字框": "text", "角色框": "character"}
TYPE_ALIASES = {
    "obj": "物体框", "object": "物体框", "物体框": "物体框", "物体": "物体框",
    "text": "文字框", "文字框": "文字框", "文字": "文字框",
    "character": "角色框", "char": "角色框", "角色框": "角色框", "角色": "角色框",
}

# 画布尺寸模式（只影响画布，不影响背景图本身的摆放）
MODE_CUSTOM = "自定义尺寸"
MODE_IMAGE = "按图片原始尺寸"
MODE_SCALED = "按缩放规则计算"
# 新的两档（前端按实际存在的原图 / 背景图动态填选项；这里列出来只是为了旧数据也能读）
MODE_SOURCE = "按导入原图的原始尺寸"
MODE_BG1 = "按背景图1的原始尺寸"
MODE_LIST = [MODE_CUSTOM, MODE_IMAGE, MODE_SCALED, MODE_SOURCE, MODE_BG1]

# 画布比例：前端会按「实际接进来的图」动态改写这个下拉的选项，
# 这里把所有可能出现的值都列上，保证把工作流 / API 里的值传给后端时能通过校验。
#   ASPECT_AUTO   —— 一张图都没有时的总默认项（按原图 / 背景图比例的兜底）
#   ASPECT_SOURCE —— 导入了「原图」那一行之后的「按原图」
#   「按背景图N」 —— 接了第 N 张背景图之后的选项
ASPECT_AUTO = "按导入的原图或接入的背景图比例"
ASPECT_SOURCE = "按原图"
ASPECT_LIST = ["保持原图", ASPECT_SOURCE, ASPECT_AUTO, "自定义", "1:1", "5:4", "4:3", "3:2",
               "16:9", "2:1", "21:9", "4:5", "3:4", "2:3", "9:16", "1:2"]
ASPECT_LIST += ["按背景图{}".format(i) for i in range(1, 65)]
ASPECT_RATIOS = {"1:1": (1, 1), "5:4": (5, 4), "4:3": (4, 3), "3:2": (3, 2),
                 "16:9": (16, 9), "2:1": (2, 1), "21:9": (21, 9),
                 "4:5": (4, 5), "3:4": (3, 4), "2:3": (2, 3), "9:16": (9, 16), "1:2": (1, 2)}
BASIS_LIST = ["长边", "短边", "宽度", "高度", "总像素(千像素)", "不缩放"]
FIT_LIST = ["填充", "留白", "裁切", "锁比例"]
MULT_LIST = ["16", "8", "32", "64", "128", "256", "无"]

# 背景图输入口上限：背景图1 … 背景图64
# 前端只会保留「已经接上线的 + 下一个空位」，所以声明得再多也不会把节点撑长；
# 用户接满一个，前端就会自动补出下一个。
BG_MAX = 64
BG_INPUTS = ["背景图{}".format(i) for i in range(1, BG_MAX + 1)]


# ---------------------------------------------------------------------------
# 通用小工具
# ---------------------------------------------------------------------------
def _clamp(value, low, high):
    return max(low, min(high, value))


def _hex_rgb(value):
    text = str(value or "").strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) != 6:
        return None
    try:
        return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


def _multiple(value):
    text = str(value or "").strip()
    if not text or text == "无":
        return 0
    try:
        return max(2, int(text))
    except ValueError:
        return 0


def _round_nearest(value, multiple):
    if not multiple:
        return int(round(value))
    return max(multiple, int(round(value / multiple)) * multiple)


def _round_up(value, multiple):
    if not multiple:
        return int(round(value))
    return max(multiple, int(math.ceil(value / multiple)) * multiple)


_FONT_CACHE = {}


def _font(size: int):
    size = max(8, int(size))
    cached = _FONT_CACHE.get(size)
    if cached is not None:
        return cached
    for name in ("msyh.ttc", "msyhl.ttc", "simhei.ttf", "simsun.ttc", "arial.ttf"):
        try:
            font = ImageFont.truetype(name, size)
            _FONT_CACHE[size] = font
            return font
        except Exception:
            continue
    font = ImageFont.load_default()
    _FONT_CACHE[size] = font
    return font


# ---------------------------------------------------------------------------
# 画布数据的解析
# ---------------------------------------------------------------------------
def _rect_of(item, default_w=0.0, default_h=0.0):
    try:
        x = float(item.get("x", 0))
        y = float(item.get("y", 0))
        w = float(item.get("w", item.get("width", default_w)))
        h = float(item.get("h", item.get("height", default_h)))
    except (TypeError, ValueError):
        return None
    if w < 0:
        x, w = x + w, -w
    if h < 0:
        y, h = y + h, -h
    return x, y, w, h


def _parse_canvas(raw):
    """把隐藏参数「画布数据」解析成 (boxes, bgs, 宽, 高, 前置提示词, 后置提示词)。

    坐标一律是像素、左上角原点（前端负责把它和左下角原点的显示坐标互换）。
    bgs 是背景图列表，顺序与输入顺序一致（背景图、背景图2…）。
    """
    data = {}
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
        except Exception:
            data = {}
    if not isinstance(data, dict):
        data = {}

    boxes = []
    for item in data.get("boxes") or []:
        if not isinstance(item, dict):
            continue
        rect = _rect_of(item)
        if rect is None:
            continue
        x, y, w, h = rect
        palette = [str(c).upper() for c in (item.get("palette") or []) if isinstance(c, str) and c.strip()]
        boxes.append({
            "type": TYPE_ALIASES.get(str(item.get("type") or "").strip(), "物体框"),
            "x": x, "y": y, "w": w, "h": h,
            "text": str(item.get("text") or ""),
            "desc": str(item.get("desc") or ""),
            "palette": palette[:5],
            # 列表里的「眼睛」：隐藏的框不画进预览，也不参与布局提示词编译
            "hidden": bool(item.get("hidden")),
        })

    bgs = []
    raw_bgs = data.get("bgs")
    if isinstance(raw_bgs, list):
        # 保持列表顺序（决定背景图之间的上下层），slot 决定用哪一张接进来的图
        for index, item in enumerate(raw_bgs):
            if not isinstance(item, dict):
                continue
            rect = _rect_of(item, 0.0, 0.0)
            if rect is None:
                continue
            x, y, w, h = rect
            bgs.append({
                # kind == "source"：这一行是「导入原图」接口进来的图，不占背景图 slot
                "kind": "source" if str(item.get("kind") or "").strip() == "source" else "bg",
                "slot": int(item["slot"]) if isinstance(item.get("slot"), int) else index,
                "x": x, "y": y, "w": w, "h": h,
                "hidden": bool(item.get("hidden")),
                # 压暗百分比：1~100，越大越暗；没存过按 45（和以前固定压暗的效果一致）
                "dim": max(1, min(100, int(item.get("dim") or 45))),
                "lockedCanvas": bool(item.get("lockedCanvas")),
            })
    elif isinstance(data.get("bg"), dict):
        # 兼容上一版单张背景图的数据
        rect = _rect_of(data["bg"], 0.0, 0.0)
        bgs = [{"slot": 0, "x": rect[0], "y": rect[1], "w": rect[2], "h": rect[3],
                "hidden": bool(data["bg"].get("hidden"))}] if rect else []

    # 画布宽高：前端「画布数据」里记的就是画布区实际显示的尺寸。
    # 老工作流（1.0.4 之前）没有这两个字段，返回 0 让调用方自己按参数算。
    canvas_w = canvas_h = 0
    for key_w, key_h in (("width", "height"), ("canvas_width", "canvas_height")):
        try:
            cw = int(round(float(data.get(key_w) or 0)))
            ch = int(round(float(data.get(key_h) or 0)))
        except Exception:
            continue
        if 16 <= cw <= 16384 and 16 <= ch <= 16384:
            canvas_w, canvas_h = cw, ch
            break
    # 布局 JSON 之外的前后提示词：拼在最终 layout_prompt 的前后
    prefix = data.get("prefix")
    suffix = data.get("suffix")
    prefix = prefix.strip() if isinstance(prefix, str) else ""
    suffix = suffix.strip() if isinstance(suffix, str) else ""
    return boxes, bgs, canvas_w, canvas_h, prefix, suffix


def _boxes_to_regions(boxes, canvas_w, canvas_h):
    """像素框 -> 归一化 region（0~1），字段与官方 boxes_to_regions 一致。"""
    regions = []
    for box in boxes:
        regions.append({
            "x": box["x"] / canvas_w if canvas_w else 0.0,
            "y": box["y"] / canvas_h if canvas_h else 0.0,
            "w": box["w"] / canvas_w if canvas_w else 0.0,
            "h": box["h"] / canvas_h if canvas_h else 0.0,
            "type": TYPE_TO_ELEMENT[box["type"]],
            "text": box["text"],
            "desc": box["desc"],
            "palette": list(box["palette"]),
        })
    return regions


# ---------------------------------------------------------------------------
# 画布尺寸的计算（只算画布，不动背景图）
# ---------------------------------------------------------------------------
def _aspect_ratio(aspect, pw, ph, bg_w, bg_h):
    # 「按原图」「按背景图N」「按导入的原图或接入的背景图比例」都按当前第一张已接图的比例算。
    # 前端画布数据里已经带了算好的 width/height，运行时一律以那个为准；这里只是没数据时的兜底。
    if aspect == "保持原图" or aspect == ASPECT_SOURCE or aspect == ASPECT_AUTO \
            or str(aspect).startswith("按背景图"):
        if bg_w > 0 and bg_h > 0:
            return bg_w / bg_h
        return 1.0
    if aspect == "自定义":
        pw = max(1.0, float(pw or 1))
        ph = max(1.0, float(ph or 1))
        return pw / ph
    pair = ASPECT_RATIOS.get(aspect)
    if pair:
        return pair[0] / pair[1]
    return 1.0


def _scaled_size(bg_w, bg_h, ratio, basis, length):
    length = max(4.0, float(length or 1024))
    if basis == "宽度":
        width = length
        height = width / ratio
    elif basis == "高度":
        height = length
        width = height * ratio
    elif basis == "总像素(千像素)":
        width = math.sqrt(ratio * length * 1000.0)
        height = width / ratio
    elif basis == "不缩放":
        return bg_w, bg_h
    elif basis == "短边":
        if ratio >= 1:
            height = length
            width = height * ratio
        else:
            width = length
            height = width / ratio
    else:  # 长边
        if ratio >= 1:
            width = length
            height = width / ratio
        else:
            height = length
            width = height * ratio
    return int(round(width)), int(round(height))


def _canvas_size(mode, width, height, bg_w, bg_h, aspect, pw, ph, basis, length, multiple):
    """按模式算出画布尺寸（像素）。"""
    if mode == MODE_IMAGE and bg_w > 0 and bg_h > 0:
        tw, th = _round_nearest(bg_w, multiple), _round_nearest(bg_h, multiple)
    elif mode == MODE_SCALED and bg_w > 0 and bg_h > 0:
        ratio = _aspect_ratio(aspect, pw, ph, bg_w, bg_h)
        tw, th = _scaled_size(bg_w, bg_h, ratio, basis, length)
        tw, th = _round_nearest(tw, multiple), _round_nearest(th, multiple)
    else:
        # 自定义尺寸：尊重用户输入，不再二次取整（前端输入框本身按倍数递增）
        tw, th = int(round(float(width or 1024))), int(round(float(height or 1024)))
    return int(_clamp(tw, 16, 16384)), int(_clamp(th, 16, 16384))


# ---------------------------------------------------------------------------
# 背景图
# ---------------------------------------------------------------------------
def _bg_array(image):
    """把 IMAGE（torch / numpy）转成 0~1 的 HWC numpy。"""
    if image is None:
        return None
    array = None
    if torch.is_tensor(image):
        try:
            array = image.detach().float().cpu().numpy()
        except Exception:
            return None
    else:
        try:
            array = np.asarray(image, dtype=np.float32)
        except Exception:
            return None
    if array.ndim == 4:
        array = array[0]
    if array.ndim == 2:
        array = np.stack([array] * 3, axis=-1)
    if array.ndim != 3:
        return None
    if array.shape[-1] == 4:
        array = array[..., :3]
    if array.shape[-1] != 3:
        return None
    return np.clip(array, 0.0, 1.0)


def _fit_image(image, target_w, target_h, fit):
    iw, ih = image.size
    target_w = max(1, int(target_w))
    target_h = max(1, int(target_h))
    if iw <= 0 or ih <= 0:
        return Image.new("RGB", (target_w, target_h), (0, 0, 0))
    if fit == "填充":
        return image.resize((target_w, target_h), Image.LANCZOS)
    if fit == "裁切":
        scale = max(target_w / iw, target_h / ih)
        nw, nh = max(1, int(round(iw * scale))), max(1, int(round(ih * scale)))
        resized = image.resize((nw, nh), Image.LANCZOS)
        left = (nw - target_w) // 2
        top = (nh - target_h) // 2
        return resized.crop((left, top, left + target_w, top + target_h))
    # 留白 / 锁比例（锁比例时矩形本身已按原图比例缩放，等同留白，不会变形）
    scale = min(target_w / iw, target_h / ih)
    nw, nh = max(1, int(round(iw * scale))), max(1, int(round(ih * scale)))
    resized = image.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (target_w, target_h), (0, 0, 0))
    canvas.paste(resized, ((target_w - nw) // 2, (target_h - nh) // 2))
    return canvas


def _bg_layers(bg_arrays, bg_entries, source_array=None):
    """把「列表顺序 + slot 编号」配成图层列表（列表越靠上 = 越上层）。

    bg_entries 每项形如 {"slot": 0..63, "kind": "bg"/"source", "x","y","w","h","hidden"}；
    slot 决定用哪一张接进来的图，列表顺序决定谁压在谁上面。
    kind == "source" 的那一项是「导入原图」接口进来的图，不占 slot。
    """
    layers = []
    for index, entry in enumerate(bg_entries or []):
        if not isinstance(entry, dict) or entry.get("hidden"):
            continue
        if entry.get("kind") == "source":
            array = source_array
        else:
            slot = entry.get("slot", index)
            if not isinstance(slot, int) or slot < 0 or slot >= len(bg_arrays):
                slot = index
            array = bg_arrays[slot] if 0 <= slot < len(bg_arrays) else None
        if array is None:
            continue
        layers.append((index, array, entry))
    return layers


def _compose_backgrounds(bg_arrays, bg_entries, width, height, fit, source_array=None):
    """把所有背景图按各自矩形合成到画布大小的底图上（列表越靠上 = 越上层）。

    返回 0~1 的 numpy 图；没有任何背景图时返回 None。
    """
    layers = _bg_layers(bg_arrays, bg_entries, source_array)
    if not layers:
        return None

    canvas = Image.new("RGB", (int(width), int(height)), (0, 0, 0))
    # 列表顺序：索引 0 最上层；画布上先贴最底层，所以倒着贴
    for _index, array, rect in reversed(layers):
        if rect.get("w", 0) > 0 and rect.get("h", 0) > 0:
            x, y, w, h = rect["x"], rect["y"], rect["w"], rect["h"]
        else:
            x, y, w, h = 0.0, 0.0, float(width), float(height)
        image = Image.fromarray((array * 255.0).astype(np.uint8)).convert("RGB")
        fitted = _fit_image(image, w, h, fit)
        # 每张背景图自己的「压暗百分比」：1~100，越大越暗（100 就是全黑）
        try:
            dim = max(1, min(100, int(rect.get("dim") or 45)))
        except Exception:
            dim = 45
        if dim > 1:
            shade = Image.new("RGB", fitted.size, (0, 0, 0))
            fitted = Image.blend(fitted, shade, dim / 100.0)
        canvas.paste(fitted, (int(round(x)), int(round(y))))
    return np.asarray(canvas).astype(np.float32) / 255.0


# 画布数据里会变、但改了也不代表「用户动了画布」的字段：
# 每次执行后 run() 都会把背景图另存成一个新的临时拷件，前端顺手把新地址写回存档，
# 于是这串 JSON 每轮都不一样。要是把它一起算进 IS_CHANGED 的指纹，下游所有节点
# （尤其是反推提示词节点）每轮都会因为「缓存签名变了」而重跑，固定种子也拦不住。
_CANVAS_VOLATILE_KEYS = ("url", "background_images", "stamp", "temp")


def _stable_canvas_text(raw):
    """把画布数据里纯显示用的临时地址剔掉，只留真正影响出图的几何与文字。

    返回「标准化后的字符串」：同内容不同临时地址 → 同一个字符串 → 同一个指纹。
    解析不出来就原样返回（宁可多算一次，也不能让指纹退化）。
    """
    if not isinstance(raw, str):
        return raw
    try:
        data = json.loads(raw)
    except Exception:
        return raw
    if not isinstance(data, dict):
        return raw

    def scrub(value):
        if isinstance(value, dict):
            return {
                key: scrub(item)
                for key, item in value.items()
                if key not in _CANVAS_VOLATILE_KEYS
            }
        if isinstance(value, list):
            return [scrub(item) for item in value]
        return value

    try:
        return json.dumps(scrub(data), ensure_ascii=False, sort_keys=True)
    except Exception:
        return raw



def _save_background(image):
    """把背景图存到 ComfyUI 的 temp 目录，供前端画布当底图显示。"""
    if image is None:
        return []
    tensor = image
    if not torch.is_tensor(tensor):
        try:
            tensor = torch.from_numpy(np.asarray(image, dtype=np.float32))
        except Exception:
            return []
    else:
        tensor = tensor.detach().float().cpu()
    if tensor.ndim == 3:
        tensor = tensor[None, ...]
    if tensor.ndim != 4:
        return []
    try:
        import nodes as comfy_nodes

        saved = comfy_nodes.PreviewImage().save_images(tensor[:1], "comfy.bboxes.background")
        images = (saved or {}).get("ui", {}).get("images") or []
        return images
    except Exception:
        return []


# ---------------------------------------------------------------------------
# 元素 / 布局提示词
# ---------------------------------------------------------------------------
def _build_elements(regions):
    """优先用官方实现生成元素列表。"""
    try:
        from comfy_extras import nodes_bounding_boxes as official

        return official.build_elements(regions)
    except Exception:
        pass

    elements = []
    for region in regions:
        etype = "text" if region.get("type") == "text" else "obj"
        element = {}
        element["bbox"] = _norm_bbox(region)
        if etype == "text":
            element["text"] = region.get("text", "")
        element["desc"] = region.get("desc", "")
        palette = [c.upper() for c in region.get("palette") or [] if isinstance(c, str) and c][:5]
        if palette:
            element["color_palette"] = palette
        elements.append(element)
    return elements


def _norm_bbox(region):
    def grid(value):
        return max(0, min(1000, round(float(value) * 1000)))

    x = float(region.get("x", 0))
    y = float(region.get("y", 0))
    w = float(region.get("w", 0))
    h = float(region.get("h", 0))
    y0, x0, y1, x1 = grid(y), grid(x), grid(y + h), grid(x + w)
    return [min(y0, y1), min(x0, x1), max(y0, y1), max(x0, x1)]



# ---------------------------------------------------------------- 上游布局提示词
# 「布局提示词输入」接进来的通常是一段布局 JSON（LLM 直接吐出来的，或别的
# MOSS YXBOX 的「布局提示词」输出）。前端会把它实时导进画布，但 183 这种
# 「上游出文本 → 本节点同一轮执行」的接法里，浏览器来不及在节点执行前把框
# 铺上去，于是这一轮编译用的还是上一轮画布。这里在后端也认这段文本，让本轮
# 输出跟上游同一次运行的内容对齐。
_LAYOUT_LABEL_TYPE = {"text": "文字框", "character": "角色框", "object": "物体框"}
_LAYOUT_CENTER_SPACES = {
    "abs_centralized", "absolute_centralized", "centralized", "center", "centre",
    "abs_center", "canvas_center",
}


def _json_slice_text(text):
    """从可能带说明文字/代码块的整段回答里，截出最早 { 到最晚 } 的部分。"""
    if not isinstance(text, str):
        return ""
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return ""
    return text[start:end + 1]


def _layout_items_of(data):
    items = data.get("items")
    if isinstance(items, list):
        return items
    summary = data.get("summary")
    if isinstance(summary, dict):
        for key in ("items", "elements"):
            value = summary.get(key)
            if isinstance(value, list):
                return value
    for key in ("elements", "boxes"):
        value = data.get(key)
        if isinstance(value, list):
            return value
    return []


def _layout_item_rect(item, centered, src_w, src_h):
    """返回布局坐标下的 (左, 上, 宽, 高)（左上角原点、像素），认不出来返回 None。"""
    numbers = None
    bbox = item.get("bbox")
    if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
        try:
            numbers = [float(value) for value in bbox[:4]]
        except (TypeError, ValueError):
            numbers = None
    if numbers is not None and centered:
        y1, x1, y2, x2 = numbers
        left, right = x1 + src_w / 2.0, x2 + src_w / 2.0
        top, bottom = y1 + src_h / 2.0, y2 + src_h / 2.0
        if right < left:
            left, right = right, left
        if bottom < top:
            top, bottom = bottom, top
        return left, top, right - left, bottom - top
    if numbers is not None:
        x1, y1, x2, y2 = numbers
        left, right = min(x1, x2), max(x1, x2)
        top, bottom = min(y1, y2), max(y1, y2)
        return left, top, right - left, bottom - top
    # 也认 x / y / width / height 直接写开的写法
    try:
        left = float(item.get("x"))
        top = float(item.get("y"))
        width = float(item.get("width", item.get("w")))
        height = float(item.get("height", item.get("h")))
    except (TypeError, ValueError):
        return None
    return left, top, width, height


def _layout_from_text(text, canvas_w, canvas_h):
    """把上游文本解析成 (整体描述, 框列表)；不是布局 JSON 就返回 None。

    框列表与「画布数据」里的结构一致：像素、左上角原点，且列表第一项是
    画面最上层（上传的 items 是从背景到前景，这里倒过来）。
    """
    raw = _json_slice_text(text)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    items = _layout_items_of(data)
    if not items:
        return None
    try:
        src_w = float(data.get("width") or 0)
        src_h = float(data.get("height") or 0)
    except (TypeError, ValueError):
        src_w = src_h = 0.0
    space = str(data.get("bbox_coord_space") or "").strip().lower()
    fmt = str(data.get("bbox_format") or "").strip().lower()
    centered = fmt == "yxyx" or space in _LAYOUT_CENTER_SPACES
    if src_w <= 0 or src_h <= 0:
        # 没写画布尺寸（官方编译格式就不写）：按所有 bbox 的最大范围反推，
        # 规则与前端 `parseLayoutText` 保持一致，两边换算出来的框才对得上。
        max_x = max_y = 0.0
        for item in items:
            if not isinstance(item, dict):
                continue
            values = None
            bbox = item.get("bbox")
            if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                try:
                    values = [float(value) for value in bbox[:4]]
                except (TypeError, ValueError):
                    values = None
            if values is None:
                try:
                    bx = float(item.get("x"))
                    by = float(item.get("y"))
                    bw = float(item.get("width", item.get("w")))
                    bh = float(item.get("height", item.get("h")))
                except (TypeError, ValueError):
                    continue
                values = [bx, by, bx + bw, by + bh]
            if centered:
                max_x = max(max_x, abs(values[1]), abs(values[3]))
                max_y = max(max_y, abs(values[0]), abs(values[2]))
            else:
                max_x = max(max_x, values[0], values[2])
                max_y = max(max_y, values[1], values[3])
        if centered:
            src_w = src_w or max(16.0, round(max_x * 2))
            src_h = src_h or max(16.0, round(max_y * 2))
        else:
            src_w = src_w or max(16.0, round(max_x))
            src_h = src_h or max(16.0, round(max_y))
    src_w = max(16.0, src_w or float(canvas_w))
    src_h = max(16.0, src_h or float(canvas_h))
    sx = float(canvas_w) / src_w
    sy = float(canvas_h) / src_h

    boxes = []
    for item in items:
        if not isinstance(item, dict):
            continue
        rect = _layout_item_rect(item, centered, src_w, src_h)
        if rect is None:
            continue
        left, top, w, h = rect
        x = int(round(left * sx))
        y = int(round(top * sy))
        w = max(8, int(round(w * sx)))
        h = max(8, int(round(h * sy)))
        x = max(0, min(max(0, canvas_w - 8), x))
        y = max(0, min(max(0, canvas_h - 8), y))
        w = max(8, min(w, canvas_w - x))
        h = max(8, min(h, canvas_h - y))
        label = str(item.get("label") or "").strip().lower()
        box_type = _LAYOUT_LABEL_TYPE.get(label)
        if not box_type:
            box_type = TYPE_ALIASES.get(str(item.get("type") or "").strip(), "物体框")
        text_value = item.get("text")
        if isinstance(text_value, list):
            text_value = "\n".join(str(part) for part in text_value if isinstance(part, str))
        elif text_value is None:
            text_value = ""
        palette = item.get("palette") or item.get("color_palette") or []
        boxes.append({
            "type": box_type,
            "x": x, "y": y, "w": w, "h": h,
            "text": str(text_value or ""),
            "desc": str(item.get("caption") or item.get("desc") or ""),
            "palette": [str(color).upper() for color in palette if isinstance(color, str) and color.strip()][:5],
            "hidden": bool(item.get("hidden")),
        })
    if not boxes:
        return None
    boxes.reverse()
    caption = ""
    summary = data.get("summary")
    if isinstance(summary, dict):
        caption = str(summary.get("caption") or "").strip()
    if not caption:
        caption = str(data.get("caption") or "").strip()
    return caption, boxes


def _compile_layout(prompt, elements, boxes, width, height):
    """编译布局提示词：优先调用官方 MOSSImageLayoutPrompt.execute。"""
    prompt = prompt or ""
    if not elements:
        return prompt

    character_indexes = [i + 1 for i, box in enumerate(boxes) if box["type"] == "角色框"]
    character_boxes = ", ".join(str(i) for i in character_indexes)

    try:
        from comfy_extras.nodes_moss_image import MOSSImageLayoutPrompt

        out = MOSSImageLayoutPrompt.execute(
            prompt=prompt,
            element=elements,
            width=width,
            height=height,
            character_boxes=character_boxes,
        )
        args = getattr(out, "args", None)
        if args:
            return args[0]
    except Exception:
        pass
    return _compile_layout_local(prompt, elements, boxes, width, height)


def _compile_layout_local(prompt, elements, boxes, width, height):
    characters = {i + 1 for i, box in enumerate(boxes) if box["type"] == "角色框"}
    items = []
    for index, element in enumerate(elements):
        if not isinstance(element, dict) or "bbox" not in element:
            continue
        bbox = element["bbox"]
        is_text_box = index < len(boxes) and boxes[index]["type"] == "文字框"
        label = "text" if is_text_box else ("character" if index + 1 in characters else "object")
        item = {"label": label, "caption": element.get("desc", "")}
        if label == "text":
            item["text"] = element.get("text", "")
        if element.get("color_palette"):
            item["palette"] = element["color_palette"]
        y0, x0, y1, x1 = bbox
        item["bbox"] = [
            math.floor(round(y0 * height / 1000, 9)) - height // 2,
            math.floor(round(x0 * width / 1000, 9)) - width // 2,
            math.ceil(round(y1 * height / 1000, 9)) - height // 2,
            math.ceil(round(x1 * width / 1000, 9)) - width // 2,
        ]
        items.append(item)
    if not items:
        return prompt
    layout = {
        "summary": {"caption": prompt.strip()},
        "items": items,
        "bbox_coord_space": "abs_centralized",
        "bbox_format": "yxyx",
    }
    return json.dumps(layout, ensure_ascii=False, separators=(",", ":"))


def _layout_draft(caption, regions, width, height):
    """未编译的草稿 JSON：和官方草稿格式一致（画布左上角原点、y 向下、`xyxy`），缩进排版方便人读。"""
    items = []
    for region in regions:
        kind = str(region.get("type") or "obj")
        label = "text" if kind == "text" else ("character" if kind == "character" else "object")
        x = float(region.get("x", 0.0)) * width
        y = float(region.get("y", 0.0)) * height
        w = float(region.get("w", 0.0)) * width
        h = float(region.get("h", 0.0)) * height
        item = {
            "label": label,
            "caption": str(region.get("desc", "") or ""),
        }
        if label == "text":
            item["text"] = str(region.get("text", "") or "")
        item["bbox"] = [
            int(round(x)), int(round(y)), int(round(x + w)), int(round(y + h)),
        ]
        palette = [c.upper() for c in (region.get("palette") or []) if isinstance(c, str) and c][:5]
        if palette:
            item["palette"] = palette
        items.append(item)

    draft = {
        "width": int(width),
        "height": int(height),
        "bbox_coord_space": "abs",
        "bbox_format": "xyxy",
        "summary": {"caption": (caption or "").strip()},
        "items": items,
    }
    text = json.dumps(draft, ensure_ascii=False, indent=2)
    # json 默认会把 [1,2,3,4] / ["#a","#b"] 拆成很多行，读起来反而乱；把这类扁平数组压回一行
    flat = r'(?:"(?:[^"\\]|\\.)*"|[-+\d.eE]+)'
    return re.sub(
        r"\[\s*(" + flat + r"(?:\s*,\s*" + flat + r")*)\s*\]",
        lambda match: "[" + ", ".join(part.strip() for part in match.group(1).split(",")) + "]",
        text,
    )


# ---------------------------------------------------------------------------
# 预览图
# ---------------------------------------------------------------------------
def _preview(regions, width, height, background=None):
    """优先用官方 render_preview，保证预览样式与官方一致。"""
    render_regions = []
    for region in regions:
        item = dict(region)
        item["type"] = "text" if region.get("type") == "text" else "obj"
        render_regions.append(item)

    try:
        from comfy_extras import nodes_bounding_boxes as official

        # 官方预览用 Pillow 默认字体（不含中文），会把中文描述画成方块。
        # 这里只在本次调用期间临时换成中文可用字体，调用结束立刻还原，
        # 不改动任何官方文件。
        original_font = getattr(official, "_font", None)
        try:
            official._font = _font
            return official.render_preview(render_regions, width, height, background)
        finally:
            if original_font is not None:
                official._font = original_font
    except Exception:
        pass
    return _preview_local(render_regions, width, height, background)


def _preview_local(regions, width, height, bg_np=None):
    scale = min(1024 / max(width, 1), 1024 / max(height, 1), 1.0)
    out_w = max(64, int(round(width * scale)))
    out_h = max(64, int(round(height * scale)))

    if bg_np is not None:
        # 压暗已经在 _compose_backgrounds 里按每张背景图自己的百分比做过了，这里不再重复压暗
        image = Image.fromarray((bg_np * 255).astype(np.uint8)).convert("RGB").resize((out_w, out_h))
    else:
        image = Image.new("RGB", (out_w, out_h), (24, 24, 27))

    draw = ImageDraw.Draw(image, "RGBA")
    for index, region in enumerate(regions):
        x0 = region["x"] * out_w
        y0 = region["y"] * out_h
        x1 = (region["x"] + region["w"]) * out_w
        y1 = (region["y"] + region["h"]) * out_h
        color = (255, 209, 102) if region.get("type") == "text" else (78, 161, 255)
        draw.rectangle([x0, y0, x1, y1], outline=color, width=2)
        label = f"{index + 1:02d}"
        font = _font(12)
        draw.rectangle([x0, y0, x0 + 8 + len(label) * 8, y0 + 16], fill=color)
        draw.text((x0 + 4, y0 + 2), label, fill=(20, 20, 24), font=font)
        desc = (region.get("desc") or "").strip()
        if desc:
            draw.text((x0 + 4, y0 + 19), desc[:40], fill=(235, 235, 235), font=_font(11))
        palette = region.get("palette") or []
        if palette:
            bar_w = (x1 - x0) / max(len(palette), 1)
            for i, hex_color in enumerate(palette):
                rgb = _hex_rgb(hex_color)
                if not rgb:
                    continue
                draw.rectangle([x0 + i * bar_w, y0, x0 + (i + 1) * bar_w, y0 + 4], fill=rgb)

    array = np.asarray(image).astype(np.float32) / 255.0
    return torch.from_numpy(array)[None, ...]


def _fractions(regions):
    frame = []
    for region in regions:
        frame.append({
            "x": float(region.get("x", 0)),
            "y": float(region.get("y", 0)),
            "width": float(region.get("w", 0)),
            "height": float(region.get("h", 0)),
            "metadata": {
                "type": "text" if region.get("type") == "text" else "obj",
                "text": region.get("text", ""),
                "desc": region.get("desc", ""),
                "palette": list(region.get("palette") or []),
            },
        })
    return frame


# ---------------------------------------------------------------------------
# 节点
# ---------------------------------------------------------------------------
class MOSS_YXBOX:
    CATEGORY = "MOSS"
    FUNCTION = "run"
    RETURN_TYPES = ("STRING", "IMAGE", "BOUNDING_BOX", "ARRAY", "INT", "INT", "STRING")
    RETURN_NAMES = ("布局提示词", "预览图", "边界框", "元素列表", "宽", "高", "草稿JSON")
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "整体描述": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "tooltip": "整张图的总描述，写进布局的 summary.caption。写清主体、风格、光线即可。",
                }),
                "画布尺寸来源": (MODE_LIST, {
                    "default": MODE_CUSTOM,
                    "tooltip": "画布（最终出图）的尺寸从哪里取：\n"
                               "· 自定义尺寸 —— 用下面的「画布宽 / 画布高」，跟背景图无关。\n"
                               "· 按缩放规则计算 —— 用「画布比例 + 画布缩放基准 + 画布缩放长度」算出一个固定尺寸，"
                               "与你接了几张图无关。\n"
                               "· 按导入原图的原始尺寸 —— 等于「导入原图」那张图的像素尺寸，精确到像素、不取整"
                               "（列表里有「原图」那一行才出现这一档）。\n"
                               "· 按背景图N的原始尺寸 —— 等于第 N 张背景图的原始像素尺寸（按取整倍数取最近值；"
                               "只有真接上并拿到尺寸的那张才会出现在列表里）。",
                }),
                "画布宽": ("INT", {
                    "default": 1536, "min": 16, "max": 16384, "step": 16,
                    "tooltip": "只在「画布尺寸来源＝自定义尺寸」时生效：画布宽度（像素），也就是最终生成图片的宽度。\n"
                               "MOSS-Image 要求画布宽高是 16 的倍数；这里箭头的步长 =「画布宽高取整倍数」"
                               "（默认 16，选「无」时为 1），手输的数会自动吸附到该倍数。",
                }),
                "画布高": ("INT", {
                    "default": 1536, "min": 16, "max": 16384, "step": 16,
                    "tooltip": "只在「画布尺寸来源＝自定义尺寸」时生效：画布高度（像素），也就是最终生成图片的高度。\n"
                               "MOSS-Image 要求画布宽高是 16 的倍数；这里箭头的步长 =「画布宽高取整倍数」"
                               "（默认 16，选「无」时为 1），手输的数会自动吸附到该倍数。",
                }),
                "画布比例": (ASPECT_LIST, {
                    "default": "自定义",
                    "tooltip": "只在「画布尺寸来源＝按缩放规则计算」时生效，决定画布的长宽比。\n"
                               "选项会随你接进来的图变化：\n"
                               "· 一张图都没有时，第一项是「按导入的原图或接入的背景图比例」（比例跟着第一张图走）。\n"
                               "· 接上背景图 / 导入原图之后，这一项变成「按原图」以及每个已接上的「按背景图N」，"
                               "你选哪张，画布就用哪张的原始宽高比；接新图不会自动改你已经选好的那张。\n"
                               "· 导入「原图」时，画布尺寸来源会自动切到「按导入原图的原始尺寸」，"
                               "画布比例自动切到「按原图」，画布＝那张原图的像素尺寸。\n"
                               "· 自定义 —— 用下面的「比例宽 : 比例高」。\n"
                               "· 其余选项 —— 直接用该固定比例。",
                }),
                "比例宽": ("INT", {
                    "default": 1, "min": 1, "max": 10000, "step": 1,
                    "tooltip": "只在「画布尺寸来源＝按缩放规则计算」并且「画布比例＝自定义」时生效：比例的宽边数值，例如 16（表示 16:比例高）。",
                }),
                "比例高": ("INT", {
                    "default": 1, "min": 1, "max": 10000, "step": 1,
                    "tooltip": "只在「画布尺寸来源＝按缩放规则计算」并且「画布比例＝自定义」时生效：比例的高边数值，例如 9（表示 比例宽:9）。",
                }),
                "画布缩放基准": (BASIS_LIST, {
                    "default": "长边",
                    "tooltip": "只在「画布尺寸来源＝按缩放规则计算」时生效：决定把画布的哪一边、"
                               "或总像素缩放到「画布缩放长度」。\n"
                               "· 长边 / 短边 —— 较长或较短的那条边等于该长度。\n"
                               "· 宽度 / 高度 —— 指定那条边等于该长度。\n"
                               "· 总像素(千像素) —— 宽 × 高 ≈ 该数值 × 1000。\n"
                               "· 不缩放 —— 忽略「画布缩放长度」和比例，直接用第一张背景图的原始尺寸"
                               "（仍按取整倍数取整）；没接背景图时退回「画布宽 / 画布高」。",
                }),
                "画布缩放长度": ("INT", {
                    "default": 1536, "min": 4, "max": 16384, "step": 1,
                    "tooltip": "只在「画布尺寸来源＝按缩放规则计算」时生效：上面那个基准边的目标像素值，"
                               "例如长边填 1536 就是「长边压到 1536」。",
                }),
                "背景图填充方式": (FIT_LIST, {
                    "default": "锁比例",
                    "tooltip": "背景图放进它那个矩形时怎么摆：\n"
                               "· 填充 —— 拉伸铺满矩形，可能变形。\n"
                               "· 留白 —— 等比缩到完整放进矩形，四周留空。\n"
                               "· 裁切 —— 等比放大铺满矩形，多出的部分裁掉。\n"
                               "· 锁比例 —— 拖任何控制点缩放矩形时，图片始终保持原长宽比（不变形）。\n"
                               "画布尺寸变化时也会按这一档重新贴背景图：比例没变就整体等比缩放；"
                               "比例变了（换尺寸来源 / 换比例 / 换基准）就重算矩形并居中——锁住的宽/高/x/y 不动。",
                }),
                "画布宽高取整倍数": (MULT_LIST, {
                    "default": "16",
                    "tooltip": "控制画布宽高（＝最终生成图片的宽高）按哪个倍数取整。\n"
                               "· MOSS-Image 要求画布宽高是 16 的倍数，默认 16，除非你有特别理由，否则别改。\n"
                               "· 「按缩放规则计算」「按背景图N的原始尺寸」算出来的画布，也按这个倍数取整。\n"
                               "· 它决定「画布宽 / 画布高 / 画布缩放长度」三个数字框两侧箭头的步长："
                               "选 16 时点一下 ±16，选 32 时 ±32；选「无」时不取整，箭头步长退回 1。\n"
                               "· 这三个框里手输的数也会自动吸附到该倍数。\n"
                               "· 它只管画布尺寸，不管列表里框的宽 / 高 / x / y（框是任意整数像素，箭头永远 ±1）。",
                }),
                "画布数据": ("STRING", {
                    "default": "{}",
                    "multiline": False,
                    "tooltip": "内部数据：所有框和背景图的位置/文字/颜色都存在这里，由画布自动维护，不用手改。",
                }),
            },
            "optional": {
                "导入原图": ("IMAGE", {
                    "tooltip": "接一张 PNG 原图（一般来自「加载图像」节点）。\n"
                               "前端会读这张图里存的工作流信息，把生成它用的布局提示词自动导入到画布，\n"
                               "同时把这张图铺成列表里的「原图」那一行（不占背景图编号、也不抢背景图输入口），\n"
                               "画布尺寸来源切成「按导入原图的原始尺寸」（画布＝这张图的像素宽高，精确到像素、不取整）。\n"
                               "如果生成这张图用的是自然语言提示词（没有 bbox），只把那段提示词放进「整体描述」。\n"
                               "后端只做透传，不影响编译结果。",
                }),
                "布局提示词输入": ("STRING", {
                    "forceInput": True,
                    "tooltip": "接一段布局提示词（文本节点或别处输出的 STRING）。\n"
                               "接上就会像「导入布局提示词」一样，把里面的描述、框、类型、文字、颜色\n"
                               "自动铺到画布上；上游文本一变，画布跟着变。\n"
                               "传进来的是草稿（带宽高）会按当前画布等比缩放，"
                               "是编译格式（0–1000 网格）则按比例换算到当前画布。",
                }),
                "背景图1": ("IMAGE", {
                    "tooltip": "第一张背景图：接上就进列表、永远在所有绘制框下面；只有「画布尺寸来源」选到它时，画布才跟着它的原始尺寸走（按缩放规则计算 + 画布比例选「保持原图」时，用它的宽高比来算画布）。",
                }),
                "背景图2": ("IMAGE", {"tooltip": "第二张背景图，盖在背景图1 上面。"}),
                # 背景图3 … 背景图64：前端用到第几张就自动连出第几张，没接线的会自动被裁掉
                **{
                    name: ("IMAGE", {"tooltip": "第{}张背景图，盖在{} 上面。".format(index, BG_INPUTS[index - 2])})
                    for index, name in enumerate(BG_INPUTS, start=1) if index >= 3
                },
            },
        }

    @classmethod
    def IS_CHANGED(cls, 整体描述="", 画布数据="{}", 布局提示词输入="", 导入原图=None, **kwargs):
        payload = json.dumps([整体描述, _stable_canvas_text(画布数据), 布局提示词输入], ensure_ascii=False, sort_keys=True)
        images = [(name, kwargs.get(name)) for name in BG_INPUTS]
        images.append(("导入原图", 导入原图))
        for name, image in images:
            if image is None:
                continue
            try:
                tensor = image
                payload += "|%s|%.6f" % (tuple(int(v) for v in tensor.shape), float(tensor.float().mean()))
            except Exception:
                payload += "|bg"
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()

    def run(self, 整体描述="", 画布尺寸来源=MODE_CUSTOM, 画布宽=1536, 画布高=1536,
            画布比例="自定义", 比例宽=1, 比例高=1, 画布缩放基准="长边", 画布缩放长度=1536,
            背景图填充方式="锁比例", 画布宽高取整倍数="16", 画布数据="{}",
            布局提示词输入="", 导入原图=None, **kwargs):
        # 背景图输入口最多 64 个，用 kwargs 取，避免签名写到 64 行；
        # 老工作流只接了前几个时，其余自然是 None。
        inputs = [kwargs.get(name) for name in BG_INPUTS]
        inputs.extend([None] * (BG_MAX - len(inputs)))
        bg_arrays = [_bg_array(image) for image in inputs]
        # 「导入原图」接口进来的图也参与出图合成：列表里那一行标着「原图」
        source_array = _bg_array(导入原图)
        boxes, bg_entries, data_w, data_h, prefix_text, suffix_text = _parse_canvas(画布数据)

        first = next((array for array in bg_arrays if array is not None), None)
        bg_w = int(first.shape[1]) if first is not None else 0
        bg_h = int(first.shape[0]) if first is not None else 0

        multiple = _multiple(画布宽高取整倍数)
        width, height = _canvas_size(
            画布尺寸来源, 画布宽, 画布高, bg_w, bg_h,
            画布比例, 比例宽, 比例高, 画布缩放基准, 画布缩放长度, multiple,
        )
        # 画布区实际显示的尺寸说了算：不管尺寸是怎么来的（导入原图、接背景图、
        # 按缩放规则、手填参数），用户看到的那个画布就是出图尺寸。
        # 只有这样，输出宽/高、预览图、布局提示词、草稿 JSON 才和画布上的构图对得上。
        if data_w > 0 and data_h > 0:
            width, height = data_w, data_h

        # 「布局提示词输入」接进来的布局 JSON：这一轮就用它编译，不依赖前端是否
        # 已经把框导进画布（否则同一轮里会慢一拍，180 显示的是上一轮的布局）。
        socket_layout = _layout_from_text(布局提示词输入, width, height)
        if socket_layout:
            socket_caption, socket_boxes = socket_layout
            if socket_boxes:
                boxes = socket_boxes
            if socket_caption:
                整体描述 = socket_caption

        # 列表里点「眼睛」隐藏的框：不画进预览、不参与布局提示词编译
        visible_boxes = [box for box in boxes if not box.get("hidden")]

        # 预览图按列表顺序编号（01 就是列表第一行，方便对照）
        preview_regions = _boxes_to_regions(visible_boxes, width, height)

        # 列表越靠上 = 画布上越在上层；而 MOSS 的 items 是「排后面的画在上层」，
        # 所以编译时把列表倒过来，这样模型画出来的前后关系与画布上看到的一致。
        emit_boxes = list(reversed(visible_boxes))
        regions = _boxes_to_regions(emit_boxes, width, height)
        elements = _build_elements(regions) if regions else []
        layout_prompt = _compile_layout(整体描述, elements, emit_boxes, width, height)
        # 前置 / 后置提示词：布局 JSON 区间之外的文字，原样拼在前后（空段跳过）
        if prefix_text:
            layout_prompt = prefix_text + "\n" + layout_prompt
        if suffix_text:
            layout_prompt = layout_prompt + "\n" + suffix_text

        background = _compose_backgrounds(bg_arrays, bg_entries, width, height, 背景图填充方式, source_array)
        preview = _preview(preview_regions, width, height, background)

        ui = {"dims": [width, height]}
        saved = []
        for image in inputs:
            saved.append(_save_background(image) if image is not None else [])
        if any(saved):
            # 每一项对应一个背景图输入；没有接图的位置是空数组
            ui["background_images"] = saved

        # 草稿 JSON：不编译，保留画布宽高与第一象限（左下角原点）像素坐标
        draft_prompt = _layout_draft(整体描述, regions, width, height)

        return {
            "ui": ui,
            "result": (layout_prompt, preview, _fractions(regions), elements, width, height, draft_prompt),
        }


NODE_CLASS_MAPPINGS = {"MOSS_YXBOX": MOSS_YXBOX}
NODE_DISPLAY_NAME_MAPPINGS = {"MOSS_YXBOX": "MOSS YXBOX 控图排版"}
