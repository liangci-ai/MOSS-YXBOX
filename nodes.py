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
MODE_LIST = [MODE_CUSTOM, MODE_IMAGE, MODE_SCALED]

ASPECT_LIST = ["保持原图", "自定义", "1:1", "5:4", "4:3", "3:2", "16:9", "2:1", "21:9",
               "4:5", "3:4", "2:3", "9:16", "1:2"]
ASPECT_RATIOS = {"1:1": (1, 1), "5:4": (5, 4), "4:3": (4, 3), "3:2": (3, 2),
                 "16:9": (16, 9), "2:1": (2, 1), "21:9": (21, 9),
                 "4:5": (4, 5), "3:4": (3, 4), "2:3": (2, 3), "9:16": (9, 16), "1:2": (1, 2)}
BASIS_LIST = ["长边", "短边", "宽度", "高度", "总像素(千像素)", "不缩放"]
FIT_LIST = ["填充", "留白", "裁切", "锁比例"]
MULT_LIST = ["16", "8", "32", "64", "128", "256", "无"]

# 背景图最多支持 8 张：背景图、背景图2 … 背景图8
BG_INPUTS = ["背景图1"] + ["背景图{}".format(i) for i in range(2, 9)]


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
    """把隐藏参数「画布数据」解析成 (boxes, bgs)。

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
                "slot": int(item["slot"]) if isinstance(item.get("slot"), int) else index,
                "x": x, "y": y, "w": w, "h": h,
                "hidden": bool(item.get("hidden")),
            })
    elif isinstance(data.get("bg"), dict):
        # 兼容上一版单张背景图的数据
        rect = _rect_of(data["bg"], 0.0, 0.0)
        bgs = [{"slot": 0, "x": rect[0], "y": rect[1], "w": rect[2], "h": rect[3],
                "hidden": bool(data["bg"].get("hidden"))}] if rect else []
    return boxes, bgs


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
    if aspect == "保持原图":
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


def _bg_layers(bg_arrays, bg_entries):
    """把「列表顺序 + slot 编号」配成图层列表（列表越靠上 = 越上层）。

    bg_entries 每项形如 {"slot": 0..7, "x","y","w","h","hidden"}；
    slot 决定用哪一张接进来的图，列表顺序决定谁压在谁上面。
    """
    layers = []
    for index, entry in enumerate(bg_entries or []):
        if not isinstance(entry, dict) or entry.get("hidden"):
            continue
        slot = entry.get("slot", index)
        if not isinstance(slot, int) or slot < 0 or slot >= len(bg_arrays):
            slot = index
        if slot < 0 or slot >= len(bg_arrays):
            continue
        array = bg_arrays[slot]
        if array is None:
            continue
        layers.append((index, array, entry))
    return layers


def _compose_backgrounds(bg_arrays, bg_entries, width, height, fit):
    """把所有背景图按各自矩形合成到画布大小的底图上（列表越靠上 = 越上层）。

    返回 0~1 的 numpy 图；没有任何背景图时返回 None。
    """
    layers = _bg_layers(bg_arrays, bg_entries)
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
        canvas.paste(fitted, (int(round(x)), int(round(y))))
    return np.asarray(canvas).astype(np.float32) / 255.0


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
        image = Image.fromarray((bg_np * 255).astype(np.uint8)).convert("RGB").resize((out_w, out_h))
        shade = Image.new("RGB", (out_w, out_h), (0, 0, 0))
        image = Image.blend(image, shade, 0.45)
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
    RETURN_TYPES = ("STRING", "IMAGE", "BOUNDING_BOX", "ARRAY", "INT", "INT")
    RETURN_NAMES = ("布局提示词", "预览图", "边界框", "元素列表", "宽", "高")
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
                    "tooltip": "画布（最终出图）尺寸从哪来，不影响背景图摆放。",
                }),
                "画布宽": ("INT", {
                    "default": 1024, "min": 16, "max": 16384, "step": 16,
                    "tooltip": "「自定义尺寸」时的画布宽度，建议 16 的倍数。",
                }),
                "画布高": ("INT", {
                    "default": 1024, "min": 16, "max": 16384, "step": 16,
                    "tooltip": "「自定义尺寸」时的画布高度，建议 16 的倍数。",
                }),
                "画布比例": (ASPECT_LIST, {
                    "default": "保持原图",
                    "tooltip": "仅「按缩放规则计算」生效：保持原图＝跟随第一张背景图的宽高比。",
                }),
                "比例宽": ("INT", {
                    "default": 1, "min": 1, "max": 10000, "step": 1,
                    "tooltip": "画布比例选「自定义」时的宽比值，例如 16。",
                }),
                "比例高": ("INT", {
                    "default": 1, "min": 1, "max": 10000, "step": 1,
                    "tooltip": "画布比例选「自定义」时的高比值，例如 9。",
                }),
                "画布缩放基准": (BASIS_LIST, {
                    "default": "长边",
                    "tooltip": "仅「按缩放规则计算」生效：把画布的哪条边缩到下面的长度。",
                }),
                "画布缩放长度": ("INT", {
                    "default": 1024, "min": 4, "max": 16384, "step": 1,
                    "tooltip": "画布缩放基准对应的目标像素值，例如长边 1024。",
                }),
                "背景图填充方式": (FIT_LIST, {
                    "default": "填充",
                    "tooltip": "背景图放进它的矩形时怎么摆：填充拉伸、留白补齐、裁切溢出、锁比例＝缩放时始终不变形。",
                }),
                "宽高取整倍数": (MULT_LIST, {
                    "default": "16",
                    "tooltip": "画布宽高取整到该倍数，MOSS 要求 16。",
                }),
                "画布数据": ("STRING", {
                    "default": "{}",
                    "multiline": False,
                    "tooltip": "内部数据：框与背景图的坐标内容，由画布自动维护，不用手改。",
                }),
            },
            "optional": {
                "背景图1": ("IMAGE", {
                    "tooltip": "第一张背景图，接入后自动铺到画布、列表底部多一行；永远在所有框的下面。",
                }),
                "背景图2": ("IMAGE", {"tooltip": "第二张背景图，盖在背景图1 上面。"}),
                "背景图3": ("IMAGE", {"tooltip": "第三张背景图，盖在背景图2 上面。"}),
                "背景图4": ("IMAGE", {"tooltip": "第四张背景图，盖在背景图3 上面。"}),
                "背景图5": ("IMAGE", {"tooltip": "第五张背景图，盖在背景图4 上面。"}),
                "背景图6": ("IMAGE", {"tooltip": "第六张背景图，盖在背景图5 上面。"}),
                "背景图7": ("IMAGE", {"tooltip": "第七张背景图，盖在背景图6 上面。"}),
                "背景图8": ("IMAGE", {"tooltip": "第八张背景图，盖在背景图7 上面。"}),
            },
        }

    @classmethod
    def IS_CHANGED(cls, 整体描述="", 画布数据="{}", **kwargs):
        payload = json.dumps([整体描述, 画布数据], ensure_ascii=False, sort_keys=True)
        for name in BG_INPUTS:
            image = kwargs.get(name)
            if image is None:
                continue
            try:
                tensor = image
                payload += "|%s|%.6f" % (tuple(int(v) for v in tensor.shape), float(tensor.float().mean()))
            except Exception:
                payload += "|bg"
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()

    def run(self, 整体描述="", 画布尺寸来源=MODE_CUSTOM, 画布宽=1024, 画布高=1024,
            画布比例="保持原图", 比例宽=1, 比例高=1, 画布缩放基准="长边", 画布缩放长度=1024,
            背景图填充方式="填充", 宽高取整倍数="16", 画布数据="{}",
            背景图1=None, 背景图2=None, 背景图3=None, 背景图4=None,
            背景图5=None, 背景图6=None, 背景图7=None, 背景图8=None):
        inputs = [背景图1, 背景图2, 背景图3, 背景图4, 背景图5, 背景图6, 背景图7, 背景图8]
        bg_arrays = [_bg_array(image) for image in inputs]
        boxes, bg_entries = _parse_canvas(画布数据)

        first = next((array for array in bg_arrays if array is not None), None)
        bg_w = int(first.shape[1]) if first is not None else 0
        bg_h = int(first.shape[0]) if first is not None else 0

        multiple = _multiple(宽高取整倍数)
        width, height = _canvas_size(
            画布尺寸来源, 画布宽, 画布高, bg_w, bg_h,
            画布比例, 比例宽, 比例高, 画布缩放基准, 画布缩放长度, multiple,
        )

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

        background = _compose_backgrounds(bg_arrays, bg_entries, width, height, 背景图填充方式)
        preview = _preview(preview_regions, width, height, background)

        ui = {"dims": [width, height]}
        saved = []
        for image in inputs:
            saved.append(_save_background(image) if image is not None else [])
        if any(saved):
            # 每一项对应一个背景图输入；没有接图的位置是空数组
            ui["background_images"] = saved

        return {
            "ui": ui,
            "result": (layout_prompt, preview, _fractions(regions), elements, width, height),
        }


NODE_CLASS_MAPPINGS = {"MOSS_YXBOX": MOSS_YXBOX}
NODE_DISPLAY_NAME_MAPPINGS = {"MOSS_YXBOX": "MOSS YXBOX 控图排版"}
