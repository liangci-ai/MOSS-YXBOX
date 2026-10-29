import { app } from "../../../scripts/app.js";

const NODE_ID = "MOSS_YXBOX";

const TYPE_OBJ = "物体框";
const TYPE_TEXT = "文字框";
const TYPE_CHAR = "角色框";
const TYPES = [TYPE_OBJ, TYPE_TEXT, TYPE_CHAR];
const TYPE_COLOR = { [TYPE_OBJ]: "#4ea1ff", [TYPE_TEXT]: "#ffd166", [TYPE_CHAR]: "#3ddc97" };
const BG_COLOR = "#ffb454";

const GRID = 16;
const HANDLE_TOL = 7;
const HANDLE_SIZE = 7;
// 8 个缩放控制点：四个角 + 四条边的中点
const HANDLES = [
  { dir: "nw", fx: 0, fy: 0 }, { dir: "n", fx: 0.5, fy: 0 }, { dir: "ne", fx: 1, fy: 0 },
  { dir: "e", fx: 1, fy: 0.5 }, { dir: "se", fx: 1, fy: 1 }, { dir: "s", fx: 0.5, fy: 1 },
  { dir: "sw", fx: 0, fy: 1 }, { dir: "w", fx: 0, fy: 0.5 },
];
const WEST_DIRS = new Set(["nw", "w", "sw"]);
const EAST_DIRS = new Set(["ne", "e", "se"]);
const NORTH_DIRS = new Set(["nw", "n", "ne"]);
const SOUTH_DIRS = new Set(["sw", "s", "se"]);
const HANDLE_CURSOR = {
  nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize",
  se: "nwse-resize", s: "ns-resize", sw: "nesw-resize", w: "ew-resize",
};
const DRAG_THRESHOLD = 3;
const MIN_BOX = 16;
const MAX_SIZE = 16384;
const MAX_BG = 8;

const HIDDEN_WIDGETS = new Set(["画布数据"]);

// 背景图输入口的名字：背景图1 … 背景图8（旧版第一个叫「背景图」，仍兼容读回）
const bgSlotName = (index) => `背景图${index + 1}`;
const bgSlotIndex = (name) => {
  const text = String(name || "");
  if (text === "背景图") return 0;
  const match = /^背景图(\d+)$/.exec(text);
  return match ? Math.max(0, parseInt(match[1], 10) - 1) : -1;
};

// 每个参数一个锁：锁上以后，画布上和列表里都不能再改
const FIELDS = ["type", "text", "desc", "w", "h", "color", "x", "y"];
const emptyLocks = (fields = FIELDS) => {
  const out = {};
  for (const key of fields) out[key] = false;
  return out;
};

const CSS = `
.yx-root{position:relative;display:flex;flex-direction:column;gap:6px;width:100%;height:100%;box-sizing:border-box;
  overflow:hidden;padding:7px;background:linear-gradient(180deg,#191a21,#15161b 60%);border:1px solid #23252e;
  border-radius:8px;color:#e7e7ea;font-family:inherit;}
.yx-prose{display:flex;flex-direction:column;gap:4px;flex:0 0 auto;}
.yx-prose-label{font-size:11px;color:#8d90a0;letter-spacing:.3px;}
.yx-prose-area{width:100%;box-sizing:border-box;resize:vertical;overflow:auto;min-height:48px;height:64px;
  padding:6px 8px;border:1px solid #34363f;border-radius:7px;background:#141519;color:#e7e7ea;
  font:inherit;font-size:12px;line-height:1.5;outline:none;}
.yx-prose-area:focus{border-color:#3f78ff;background:#12131a;}
.yx-prose-area::placeholder{color:#5d6070;}
.yx-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:#c9c9d1;}
.yx-head-label{font-size:12px;opacity:.8;}
.yx-chip{appearance:none;border:1px solid #34363f;background:#1e1f26;color:#c9c9d1;border-radius:7px;
  padding:3px 10px;font-size:12px;line-height:18px;cursor:pointer;transition:background .12s,border-color .12s,color .12s;}
.yx-chip:hover{background:#262832;}
.yx-chip.yx-active{background:#2b5fd9;border-color:#3f78ff;color:#fff;}
.yx-chip.yx-on{background:#262832;color:#fff;border-color:#4a4d5a;}
.yx-chip.yx-drawon{background:#2b5fd9;border-color:#3f78ff;color:#fff;box-shadow:0 0 0 1px rgba(63,120,255,.55);}
.yx-chip.yx-undo{border-color:#ff9f43;color:#ffd8a8;box-shadow:0 0 0 1px rgba(255,159,67,.45),inset 0 0 8px rgba(255,159,67,.12);}
.yx-chip.yx-undo:hover{background:#2a2216;border-color:#ffb85c;}
.yx-chip:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;}
.yx-menu{position:absolute;z-index:40;min-width:172px;padding:5px;background:#1b1d24;border:1px solid #3d4150;
  border-radius:9px;box-shadow:0 14px 34px rgba(0,0,0,.6);font-size:12px;color:#d9dce4;user-select:none;}
.yx-menu-title{padding:3px 8px 5px;font-size:11px;color:#8d90a0;border-bottom:1px solid #2c2f3a;margin-bottom:4px;}
.yx-menu-item{padding:6px 9px;border-radius:6px;cursor:pointer;white-space:nowrap;}
.yx-menu-item:hover{background:#282b36;}
.yx-menu-danger{color:#ff8d8d;}
.yx-menu-armed{background:#4a1f1f;color:#ffc9c9;}
.yx-menu-sep{height:1px;background:#2c2f3a;margin:5px 2px;}
.yx-menu-label{padding:4px 8px 2px;font-size:11px;color:#8d90a0;}
.yx-menu-colors{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:2px 7px 5px;}
.yx-menu-swatch{width:18px;height:18px;border-radius:5px;border:1px solid rgba(255,255,255,.25);cursor:pointer;padding:0;}
.yx-menu-swatch:hover{transform:scale(1.08);}
.yx-menu-type{appearance:none;background:#20222b;color:#d9dce4;border:1px solid #3a3d4a;border-radius:6px;
  padding:3px 8px;font-size:12px;cursor:pointer;}
.yx-menu-type:hover{background:#2a2d38;}
.yx-item-wrap{padding:0;margin:0;border:0;background:transparent;}
.yx-dragging{opacity:.55;}
.yx-drop-line{position:absolute;left:0;right:0;height:2px;border-radius:2px;background:#4cc2ff;
  box-shadow:0 0 6px rgba(76,194,255,.85);pointer-events:none;z-index:9;}
.yx-row-moving{position:relative;z-index:6;opacity:.96;background:#20222b;border-radius:6px;
  box-shadow:0 10px 26px rgba(0,0,0,.55);outline:1px dashed #5b6070;}
.yx-drag{cursor:grab;touch-action:none;}
.yx-drag:active{cursor:grabbing;}
.yx-info{font-size:11px;color:#8d90a0;border:1px dashed #34363f;border-radius:6px;padding:2px 7px;}
.yx-info b{color:#cfd3dd;font-weight:600;}
.yx-topbar{display:flex;gap:6px;align-items:center;padding:0 2px 4px;}
.yx-tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.yx-form{display:flex;gap:8px;align-items:center;}
.yx-form-label{font-size:12px;color:#9aa0b0;min-width:64px;}
.yx-input{flex:1 1 auto;min-width:120px;height:26px;background:#0f1015;color:#dfe2ea;border:1px solid #34363f;
  border-radius:7px;padding:0 8px;font-size:12px;box-sizing:border-box;}
.yx-input:focus{outline:none;border-color:#4a90ff;}
.yx-select{height:26px;background:#14151b;color:#dfe2ea;border:1px solid #34363f;border-radius:7px;
  font-size:12px;padding:0 6px;}
.yx-check-row{display:flex;gap:8px;align-items:flex-start;width:100%;font-size:12px;color:#9aa0b0;
  line-height:1.55;cursor:pointer;}
.yx-check-row span{flex:1 1 auto;min-width:0;}
.yx-check-row input{margin:2px 0 0;}
.yx-crumb{display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:12px;color:#8d90a0;}
.yx-crumb-btn{appearance:none;background:transparent;border:0;color:#9fc2ff;cursor:pointer;font-size:12px;
  padding:2px 4px;border-radius:5px;}
.yx-crumb-btn:hover{background:#22242c;}
.yx-crumb-sep{opacity:.6;}
.yx-body{max-height:min(52vh,520px);overflow:auto;display:flex;flex-direction:column;gap:8px;
  border:1px solid #262932;border-radius:9px;padding:8px;background:#12131a;}
.yx-folder-list{display:flex;flex-direction:column;gap:4px;}
.yx-folder-row{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:7px;}
.yx-folder-row:hover{background:#1b1d25;}
.yx-folder-name{flex:1 1 auto;text-align:left;appearance:none;background:transparent;border:0;color:#dfe2ea;
  font-size:12px;cursor:pointer;padding:3px 4px;border-radius:6px;}
.yx-folder-name:hover{color:#9fc2ff;}
.yx-mini{appearance:none;background:#1d1f27;border:1px solid #34363f;color:#b9bcc7;border-radius:6px;
  font-size:11px;padding:2px 7px;cursor:pointer;}
.yx-mini:hover{background:#262932;}
.yx-mini-danger{color:#ff9d9d;border-color:#4a2b2b;}
.yx-grid{display:grid;grid-template-columns:repeat(var(--yx-cols,3),minmax(0,1fr));gap:7px;}
.yx-preset{position:relative;display:flex;flex-direction:column;gap:3px;padding:7px 8px;border-radius:8px;
  background:#171922;border:1px solid #2a2d38;cursor:pointer;}
.yx-preset:hover{border-color:#3f475c;background:#1b1e28;}
.yx-preset.yx-picked{border-color:#3f78ff;box-shadow:0 0 0 1px rgba(63,120,255,.5);background:#1a2336;}
.yx-preset input{margin:0;}
.yx-preset-name{font-size:12px;color:#e6e8ef;word-break:break-all;padding-right:2px;}
.yx-preset-meta{font-size:11px;color:#8d90a0;word-break:break-all;}
.yx-empty{font-size:12px;color:#8d90a0;margin:2px 0;}
.yx-modal{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.62);
  display:flex;align-items:center;justify-content:center;}
.yx-card{width:min(760px,88vw);background:#15161d;border:1px solid #333745;border-radius:10px;
  padding:14px;display:flex;flex-direction:column;gap:8px;box-shadow:0 18px 48px rgba(0,0,0,.6);}
.yx-card h3{margin:0;font-size:14px;color:#e6e8ef;font-weight:600;}
.yx-card p{margin:0;font-size:12px;color:#9aa0b0;line-height:1.55;}
.yx-card textarea{width:100%;min-height:260px;resize:vertical;box-sizing:border-box;
  font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.5;
  background:#0f1015;color:#dfe2ea;border:1px solid #34363f;border-radius:8px;padding:8px;}
.yx-card textarea:focus{outline:none;border-color:#4a90ff;}
.yx-card .yx-status{font-size:12px;min-height:16px;color:#ffb86b;}
.yx-card .yx-actions{display:flex;gap:8px;justify-content:flex-end;}
.yx-stage{position:relative;width:100%;background:#111218;border-radius:6px;overflow:hidden;
  border:1px solid #262833;box-shadow:inset 0 0 18px rgba(0,0,0,.35);
  flex:0 0 auto;touch-action:none;user-select:none;}
.yx-canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none;cursor:crosshair;}
.yx-zoombadge{position:absolute;right:8px;bottom:8px;z-index:6;padding:2px 8px;border-radius:5px;
  border:1px solid #3a3d4a;background:rgba(20,22,28,.88);color:#cfd3dc;font-size:11px;line-height:16px;
  font-family:inherit;cursor:pointer;user-select:none;}
.yx-zoombadge:hover{border-color:#5f7fd6;color:#fff;}
.yx-num-in{width:38px;height:22px;background:#1a1b22;color:#dfe2ea;border:1px solid #34363f;border-radius:6px;
  padding:0 3px;font-size:11px;text-align:center;box-sizing:border-box;-moz-appearance:textfield;}
.yx-num-in::-webkit-outer-spin-button,.yx-num-in::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
.yx-color-in{width:22px;height:22px;padding:0;border:1px solid #34363f;border-radius:5px;background:#1a1b22;
  cursor:pointer;box-sizing:border-box;}
.yx-color-in::-webkit-color-swatch-wrapper{padding:2px;}
.yx-color-in::-webkit-color-swatch{border:none;border-radius:3px;}
.yx-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:2px 0 4px;}
.yx-edit{position:absolute;margin:0;padding:2px 4px;resize:none;outline:none;z-index:5;
  background:rgba(10,11,15,.86);color:#fff;border:2px solid #3f78ff;border-radius:2px;overflow:hidden;
  font-family:inherit;line-height:1.25;box-sizing:border-box;}
.yx-scroll{overflow:auto;padding-bottom:2px;min-height:72px;flex:0 0 auto;max-height:none;}
.yx-table{min-width:0;width:100%;display:flex;flex-direction:column;gap:3px;position:relative;}
.yx-row{display:grid;align-items:center;gap:3px;box-sizing:border-box;
  grid-template-columns:12px 26px 30px 12px minmax(62px,.7fr) 12px minmax(0,1.6fr) 12px minmax(0,2fr) 12px
    minmax(40px,.38fr) 12px minmax(40px,.38fr) 12px 28px 12px minmax(40px,.38fr) 12px minmax(40px,.38fr)
    26px 34px 54px 14px 26px;}
.yx-row.yx-header{font-size:11px;color:#9a9ca6;padding:3px 4px;border:1px solid transparent;
  position:sticky;top:0;z-index:3;background:#15161d;}
.yx-row.yx-header span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;}
.yx-item{background:#1c1d24;border:1px solid #262833;border-radius:6px;padding:3px 4px;transition:background .12s,border-color .12s;}
.yx-item:hover{background:#23252f;border-color:#343848;}
.yx-item.yx-sel{border-color:#3f78ff;background:#1f2330;}
.yx-item.yx-sel:hover{background:#242a3c;}
.yx-item.yx-hidden-row{opacity:.55;}
.yx-item.yx-bg{background:#201d16;border-color:#38301f;}
.yx-item.yx-bg.yx-sel{border-color:#ffb454;background:#2a2418;}
.yx-item.yx-bg.yx-canvas-row{box-shadow:inset 0 0 0 1px #ffb454;}
.yx-chip.yx-danger{color:#ff6b6b;border-color:#ff6b6b;}
.yx-num{font-size:11px;color:#8d90a0;text-align:center;cursor:pointer;user-select:none;}
.yx-item.yx-sel .yx-num{color:#8fb4ff;}
.yx-item.yx-bg .yx-num{color:#ffb454;}
.yx-drag{cursor:grab;color:#7c7f8d;font-size:11px;text-align:center;user-select:none;touch-action:none;}
.yx-drag:active{cursor:grabbing;}
.yx-in,.yx-sel-type{width:100%;box-sizing:border-box;background:#12131a;border:1px solid #2a2c37;border-radius:4px;
  color:#e7e7ea;font-size:12px;height:22px;padding:0 3px;font-family:inherit;min-width:0;}
.yx-in:focus,.yx-sel-type:focus{outline:1px solid #3f78ff;border-color:#3f78ff;}
.yx-in[disabled],.yx-sel-type[disabled],.yx-color[disabled]{opacity:.4;cursor:not-allowed;}
.yx-field{position:relative;min-width:0;display:flex;}
.yx-field .yx-in{padding-right:14px;}
.yx-fold{position:absolute;right:0;top:1px;width:13px;height:20px;line-height:18px;text-align:center;
  border:none;background:transparent;color:#8d90a0;cursor:pointer;font-size:9px;padding:0;}
.yx-fold:hover{color:#fff;}
.yx-fold.yx-open{color:#8fb4ff;}
.yx-big{width:100%;box-sizing:border-box;background:#12131a;border:1px solid #3f78ff;border-radius:4px;
  color:#e7e7ea;font-size:12px;line-height:1.45;padding:5px 7px;margin-top:3px;resize:vertical;
  min-height:84px;font-family:inherit;}
.yx-big[disabled]{opacity:.45;}
.yx-color{width:100%;height:20px;padding:0;border:1px solid #2a2c37;background:#12131a;border-radius:4px;cursor:pointer;}
.yx-icon{background:transparent;border:none;color:#8d90a0;cursor:pointer;font-size:12px;padding:0;
  line-height:20px;text-align:center;}
.yx-icon:hover{color:#fff;}
.yx-icon.yx-off{color:#4b4d59;}
.yx-icon.yx-danger{color:#ff6b6b;font-size:11px;}
.yx-lock{background:transparent;border:none;cursor:pointer;color:#5c7086;font-size:10px;padding:0;
  line-height:20px;text-align:center;}
.yx-lock.yx-on{color:#ffcf5c;}
.yx-check{width:14px;height:14px;margin:0;accent-color:#3f78ff;cursor:pointer;}
.yx-check[disabled]{opacity:.4;cursor:not-allowed;}
.yx-empty{font-size:11px;color:#7c7f8d;padding:2px 1px;}
`;

function css3(value) {
  const text = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(text)) {
    return "#" + text.split("").map((ch) => ch + ch).join("");
  }
  if (/^[0-9a-f]{6}$/i.test(text)) return "#" + text.toLowerCase();
  return null;
}

function itemColor(item) {
  if (!item) return TYPE_COLOR[TYPE_OBJ];
  if (item.isBg) return BG_COLOR;
  const palette = Array.isArray(item.palette) ? item.palette : [];
  for (const color of palette) {
    const fixed = css3(color);
    if (fixed) return fixed;
  }
  return TYPE_COLOR[item.type] || TYPE_COLOR[TYPE_OBJ];
}

function rgba(hex, alpha) {
  const text = (css3(hex) || "#4ea1ff").slice(1);
  const r = parseInt(text.slice(0, 2), 16);
  const g = parseInt(text.slice(2, 4), 16);
  const b = parseInt(text.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function clamp(value, low, high) {
  if (high < low) return low;
  return Math.max(low, Math.min(high, value));
}

function snap(value) {
  return Math.max(0, Math.round(value / GRID) * GRID);
}

function clampSize(value) {
  return clamp(Math.round(value), 16, MAX_SIZE);
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function newBox(type, x, y, w = GRID * 8, h = GRID * 5) {
  return {
    type,
    x, y, w, h,
    text: "",
    desc: "",
    palette: [],
    hidden: false,
    lock: emptyLocks(),
    isBg: false,
  };
}

function setup(node) {
  if (node.__yxbox) return;
  const state = (node.__yxbox = {
    ready: false,
    multi: false,
    modal: null,
    // 描述框高度：由你拖右下角手柄决定，读不到就按 64 起
    proseH: clamp(Math.round(Number(node.properties?.yxProseH) || 64), 48, 1200),
  });

  // ---------------------------------------------------------------- widgets
  const widget = (name) => (node.widgets || []).find((w) => w.name === name);

  const wData = widget("画布数据");
  const wWidth = widget("画布宽");
  const wHeight = widget("画布高");
  const wMode = widget("画布尺寸来源");
  const wAspect = widget("画布比例");
  const wPropW = widget("比例宽");
  const wPropH = widget("比例高");
  const wBasis = widget("画布缩放基准");
  const wLength = widget("画布缩放长度");
  const wFit = widget("背景图填充方式");
  const wMult = widget("宽高取整倍数");

  // 背景图填充方式 = 锁比例 时，拖动/手改尺寸都要求背景图保持原图长宽比
  const ratioLockEnabled = (item) => !!item?.isBg && String(wFit?.value ?? "") === "锁比例";
  const bgRatio = (item) => {
    const w0 = Number(item?.natW) || Number(item?.image?.naturalWidth) || 1;
    const h0 = Number(item?.natH) || Number(item?.image?.naturalHeight) || 1;
    return w0 > 0 && h0 > 0 ? w0 / h0 : 1;
  };

  for (const item of node.widgets || []) {
    if (!HIDDEN_WIDGETS.has(item.name)) continue;
    item.hidden = true;
    if (item.options) item.options.hidden = true;
    item.computeSize = () => [0, -4];
    item.draw = () => {};
    if (item.element) item.element.style.display = "none";
  }

  // 顶部「整体描述」照 ComfyUI 自带多行文本框（CLIP 文本编码器）的做法：
  //  · 高度固定（PROSE_FIXED），文字多了就在框内部滚动，绝不因为文字多少去改高度
  //  · 也绝不因为文本框去改节点高度——节点尺寸 100% 由你自己拖，所以随时都能缩回去
  const PROSE_FIXED = 64;
  const PROSE_MAX_GROW = 1200;   // 拉高节点时描述框最多长到这么高
  const PROSE_MIN = PROSE_FIXED;
  const PROSE_MAX = PROSE_FIXED;
  const PROSE_LINE = 20;
  const PROSE_PAD = 18;
  let proseWidget = null;
  let proseAutoPx = PROSE_FIXED;   // 固定高度（保留变量只为兼容老调用）
  try {
    proseWidget = (node.widgets || []).find((item) => item && (item.name === "整体描述" || item.name === "画面描述")) || null;
    if (proseWidget) {
      proseWidget.computeSize = function (width) {
        return [Math.max(160, (width || node.size?.[0] || 400) - 24), proseHeight()];
      };
      proseWidget.options = proseWidget.options || {};
      proseWidget.options.minHeight = PROSE_FIXED;
      proseWidget.options.maxHeight = PROSE_MAX_GROW;
    }
  } catch (_error) {
    proseWidget = null;
  }

  // 估算「整段文字按当前宽度排下来要多高」——只读文本 + measureText，不碰布局，不会引起节点高度反复
  let proseMeasureCtx = null;
  try {
    proseMeasureCtx = document.createElement("canvas").getContext("2d");
  } catch (_error) {
    proseMeasureCtx = null;
  }
  // 量文本高度的「尺子」：一个隐藏的 textarea，宽度和字体跟真的输入框一致。
  // 为什么不用输入框自己的 scrollHeight：输入框被拉高后，scrollHeight 会跟着变成
  // 元素高度，于是「高度变高 → 量出来更高 → 再变高」形成正反馈（就是无限伸长）。
  let proseRuler = null;
  let proseRulerKey = "";
  let proseRulerValue = 0;
  const proseRulerHeight = (text, widthPx) => {
    try {
      const area = proseWidget?.inputEl || proseWidget?.element || null;
      if (!area || typeof document === "undefined" || !document.createElement) return 0;
      const key = `${Math.round(widthPx)}|${text}`;
      if (key === proseRulerKey) return proseRulerValue;
      if (!proseRuler) {
        proseRuler = document.createElement("textarea");
        proseRuler.style.position = "absolute";
        proseRuler.style.visibility = "hidden";
        proseRuler.style.left = "-9999px";
        proseRuler.style.top = "0";
        proseRuler.style.resize = "none";
        proseRuler.style.overflow = "hidden";
        proseRuler.style.boxSizing = "border-box";
        proseRuler.style.whiteSpace = "pre-wrap";
        proseRuler.style.wordBreak = "break-word";
        document.body?.appendChild?.(proseRuler);
      }
      const cs = (typeof window !== "undefined" && window.getComputedStyle) ? window.getComputedStyle(area) : null;
      const font = cs?.font || cs?.fontFamily || "";
      if (font) proseRuler.style.font = font;
      if (cs?.lineHeight && cs.lineHeight !== "normal") proseRuler.style.lineHeight = cs.lineHeight;
      if (cs?.padding) proseRuler.style.padding = cs.padding;
      proseRuler.style.width = `${Math.max(60, Math.round(widthPx))}px`;
      proseRuler.value = text;
      proseRulerKey = key;
      proseRulerValue = Number(proseRuler.scrollHeight) || 0;
      return proseRulerValue;
    } catch (_error) {
      return 0;
    }
  };
  const proseTextHeight = () => {
    if (!proseWidget) return PROSE_MIN;
    const text = String(proseWidget.value ?? "");
    if (!text) return PROSE_MIN;
    const availW = Math.max(120, Math.round(node.size?.[0] || 400) - 44);
    // 首选：用隐藏尺子量纯文本高度（跟输入框当前高度无关，不会正反馈）
    const ruled = proseRulerHeight(text, availW);
    if (ruled > 0) {
      const pad = 14;
      return clamp(Math.round(ruled + pad), PROSE_MIN, PROSE_MAX);
    }
    // 次选：直接读原生 textarea 的内容高度（scrollHeight）——按真实换行算到像素，
    // 不会像「行数×行高」那样一级一级跳，输入/删除时高度是连续变化的
    const area = proseWidget.inputEl || proseWidget.element || null;
    const scroll = Number(area?.scrollHeight) || 0;
    if (scroll > 0 && area?.tagName === "TEXTAREA") {
      const pad = 14;
      return clamp(Math.round(scroll + pad), PROSE_MIN, PROSE_MAX);
    }
    if (!proseMeasureCtx) {
      // 没有 measureText 时按「中文 1 字 ≈ 14px」保守估
      const lines = text.split("\n").reduce((acc, line) => acc + Math.max(1, Math.ceil((line.length * 14) / availW)), 0);
      return clamp(Math.round(lines * PROSE_LINE + PROSE_PAD), PROSE_MIN, PROSE_MAX);
    }
    proseMeasureCtx.font = '14px system-ui, "Microsoft YaHei", sans-serif';
    let lines = 0;
    for (const para of text.split("\n")) {
      if (!para) {
        lines += 1;
        continue;
      }
      let cur = 0;
      let count = 1;
      for (const ch of para) {
        const width = proseMeasureCtx.measureText(ch).width;
        if (cur + width > availW && cur > 0) {
          count += 1;
          cur = width;
        } else {
          cur += width;
        }
      }
      lines += count;
    }
    return clamp(Math.round(lines * PROSE_LINE + PROSE_PAD), PROSE_MIN, PROSE_MAX);
  };
  // 描述框高度完全由你自己拖（textarea 右下角手柄），插件只读取、绝不自动改
  const PROSE_MIN_H = 48;
  const proseTextPx = () => PROSE_FIXED;
  const proseHeight = () => clamp(Math.round(state.proseH || PROSE_FIXED), PROSE_MIN_H, PROSE_MAX_GROW);
  const applyProseHeight = () => applyProseBoxHeight();
  const syncProseAuto = () => false;
  void proseTextHeight;

  const S = {
    width: clampSize(wWidth?.value ?? 1536),
    height: clampSize(wHeight?.value ?? 1536),
    boxes: [],
    bgs: [],          // 按列表顺序（越靠前越上层），每项带 slot = 对应哪个背景图输入口
    selected: new Set(),
    drag: null,
    editing: null,
    rows: new Map(),
    suppress: false,
  };
  // 调试用：控制台里 node.__yxbox.S 就能看到画布状态
  state.S = S;

  // ---------------------------------------------------------------- dom
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = el("div", "yx-root");

  // 鼠标是否停在这个节点上：键盘 Delete / Ctrl+C / Ctrl+V 只在这个节点“热”的时候接管，
  // 免得抢掉 ComfyUI 自己在画布上按 Delete 删节点的操作。
  root.addEventListener("pointerenter", () => {
    state.nodeHot = true;
    state.markHot?.(true);
  });
  root.addEventListener("pointerleave", () => {
    state.nodeHot = false;
    state.markHot?.(false);
  });
  root.addEventListener("pointerdown", () => {
    state.nodeHot = true;
    state.markHot?.(true);
  });

  // 整体描述：照 VMNodes 海报工作台的做法，放在自己的 DOM 里用原生 textarea + resize:vertical，
  // 右下角那两条小斜杠就是浏览器自带的拖拽手柄，往上/往下拖只改这个框自己的高度。
  const proseBox = el("div", "yx-prose");
  const proseLabel = el("div", "yx-prose-label", "整体描述（要点就用一句话说清整张画面）");
  const proseArea = el("textarea", "yx-prose-area");
  proseArea.placeholder = "一句话描述整张画面：主体 / 风格 / 光线 / 氛围";
  proseArea.spellcheck = false;
  proseBox.appendChild(proseLabel);
  proseBox.appendChild(proseArea);
  root.appendChild(proseBox);
  // 原生「整体描述」控件完全隐藏，只留作存值与序列化（老工作流里的文字照常读出来）
  try {
    if (proseWidget) {
      proseWidget.hidden = true;
      proseWidget.computeSize = () => [0, -4];
      proseWidget.draw = () => {};
      if (proseWidget.options) proseWidget.options.hidden = true;
      if (proseWidget.element) proseWidget.element.style.display = "none";
    }
  } catch (_error) {
    // 忽略
  }
  proseArea.value = String(proseWidget?.value ?? "");
  proseArea.addEventListener("input", () => {
    if (!proseWidget) return;
    proseWidget.value = proseArea.value;
    try {
      proseWidget.callback?.(proseArea.value);
    } catch (_error) {
      // 忽略
    }
  });
  for (const type of ["pointerdown", "mousedown", "wheel", "keydown"]) {
    proseArea.addEventListener(type, (event) => event.stopPropagation());
  }
  // 用户拖完手柄 → 记住高度（写进 node.properties，重开工作流还在），并按新高度重排
  const applyProseBoxHeight = () => {
    const height = clamp(Math.round(state.proseH || 64), 48, 1200);
    const px = `${height}px`;
    if (proseArea.style.height !== px) proseArea.style.height = px;
    return height;
  };
  // 只有「真的从输入框上按下、再松开」才量高度：避免普通单击也进来量
  let prosePointerDown = false;
  const syncProseBoxHeight = () => {
    if (!prosePointerDown) return;
    prosePointerDown = false;
    let measured = 0;
    try {
      // 必须用 offsetHeight（CSS 布局像素）：getBoundingClientRect 会带上画布缩放的倍率，
      // 缩到 130% 就每次单击都乘 1.3，缩到 70% 就每次乘 0.7——这就是高度自己一直涨/一直掉的原因
      measured = Math.round(proseArea.offsetHeight || 0);
    } catch (_error) {
      measured = 0;
    }
    if (!measured || measured < 24) return;
    if (Math.abs(measured - (state.proseH || 0)) < 1) return;
    state.proseH = measured;
    node.properties = node.properties || {};
    node.properties.yxProseH = measured;
    layout();
    // 你把输入框拖高了，节点不够高就把节点补到刚够（只会补高，绝不自动压矮）
    try {
      const needed = Math.round(nativeTop() + domDesiredHeight() + 12);
      if (needed > (node.size?.[1] || 0) + 1 && typeof node.setSize === "function") {
        node.setSize([Math.round(node.size?.[0] || 980), needed]);
      }
    } catch (_error) {
      // 忽略
    }
    node.graph?.setDirtyCanvas?.(true, true);
  };
  proseArea.addEventListener("pointerdown", () => {
    prosePointerDown = true;
  });
  try {
    window.addEventListener("pointerup", syncProseBoxHeight, true);
    window.addEventListener("pointercancel", syncProseBoxHeight, true);
  } catch (_error) {
    // 忽略
  }
  applyProseBoxHeight();

  // 节点最上方：布局提示词的导入 / 导出
  const topBar = el("div", "yx-topbar");
  const exportBtn = el("button", "yx-chip", "导出布局提示词");
  exportBtn.type = "button";
  exportBtn.title = "显示节点最终输出的布局提示词（与后端编译结果一致），可一键复制";
  exportBtn.addEventListener("click", () => openExport());
  const importBtn = el("button", "yx-chip", "导入布局提示词");
  importBtn.type = "button";
  importBtn.title = "粘贴草稿 JSON、编译后的 JSON 或纯描述，自动还原画布尺寸、框、文字与颜色";
  importBtn.addEventListener("click", () => openImport());
  topBar.appendChild(exportBtn);
  topBar.appendChild(importBtn);
  const savePresetBtn = el("button", "yx-chip", "保存预设");
  savePresetBtn.type = "button";
  savePresetBtn.title = "把当前节点的全部参数、画布上的框和背景图信息保存成一个预设，下次一键还原";
  savePresetBtn.addEventListener("click", () => openSavePreset());
  const managePresetBtn = el("button", "yx-chip", "管理预设");
  managePresetBtn.type = "button";
  managePresetBtn.title = "查看、整理（文件夹）、改名、排序、搜索、加载或删除已保存的预设";
  managePresetBtn.addEventListener("click", () => openPresetManager());
  topBar.appendChild(savePresetBtn);
  topBar.appendChild(managePresetBtn);

  const head = el("div", "yx-head");
  // 只画框：打开后在画布上只能画新框，不能选中/拖动/缩放/删除已有内容
  const drawOnlyBtn = el("button", "yx-chip", "只画框");
  drawOnlyBtn.type = "button";
  drawOnlyBtn.title = "打开后：在画布上只能按当前类型画新框，不能选中 / 拖动 / 缩放 / 删除已有内容，"
    + "方便在已有框内部再画一个框；按住 Shift 或 Alt 拖拽也能临时强制画新框（开关关闭时同样有效）";
  drawOnlyBtn.addEventListener("click", () => {
    setDrawOnly(!state.drawOnly);
  });
  head.appendChild(drawOnlyBtn);
  head.appendChild(el("span", "yx-head-label", "当前绘制框类型"));
  const chips = new Map();
  for (const type of TYPES) {
    const chip = el("button", "yx-chip", type);
    chip.type = "button";
    chip.addEventListener("click", () => {
      state.activeType = type;
      for (const [key, value] of chips) value.classList.toggle("yx-active", key === type);
      paint();
      root.dispatchEvent(new Event("yx-type"));
    });
    chips.set(type, chip);
    head.appendChild(chip);
  }

  const canvasInfo = el("span", "yx-info");
  const bgInfo = el("span", "yx-info");
  const gridBtn = el("button", "yx-chip yx-on", "网格");
  gridBtn.type = "button";
  gridBtn.title = "显示 / 隐藏 16 像素网格";
  gridBtn.addEventListener("click", () => {
    state.grid = state.grid === false;
    gridBtn.classList.toggle("yx-on", state.grid !== false);
    paint();
  });
  const axesBtn = el("button", "yx-chip yx-on", "坐标");
  axesBtn.type = "button";
  axesBtn.title = "显示 / 隐藏 左下角原点的坐标系刻度";
  axesBtn.addEventListener("click", () => {
    state.axes = state.axes === false;
    axesBtn.classList.toggle("yx-on", state.axes !== false);
    paint();
  });
  const multiBtn = el("button", "yx-chip", "多选");
  multiBtn.type = "button";
  multiBtn.title = "打开后，画布与列表里才可以同时选中多个框；关闭时点一下只会选中一个框";
  multiBtn.addEventListener("click", () => {
    state.multi = !state.multi;
    multiBtn.classList.toggle("yx-on", state.multi);
    if (!state.multi && S.selected.size > 1) {
      // 关闭多选：只保留最后选中的那一个
      const keep = [...S.selected].pop();
      S.selected.clear();
      S.selected.add(keep);
      syncRows();
    }
    paint();
  });
  const hDivBtn = el("button", "yx-chip", "横等分");
  hDivBtn.type = "button";
  hDivBtn.title = "打开后按右侧数字画横向等分线（线的条数＝等分数-1）";
  const hDivNum = el("input", "yx-num-in");
  hDivNum.type = "number";
  hDivNum.min = "2";
  hDivNum.max = "20";
  hDivNum.step = "1";
  hDivNum.value = "3";
  hDivNum.title = "横向几等分（2–20）";
  hDivNum.addEventListener("change", () => {
    state.hDiv = Math.max(2, Math.min(20, Math.round(Number(hDivNum.value) || 2)));
    hDivNum.value = String(state.hDiv);
    paint();
  });
  const hDivColor = el("input", "yx-color-in");
  hDivColor.type = "color";
  hDivColor.value = "#ff8a8a";
  hDivColor.title = "横向等分线的颜色（默认淡红色）";
  hDivColor.addEventListener("input", () => {
    state.hDivColor = hDivColor.value;
    paint();
  });
  hDivBtn.addEventListener("click", () => {
    state.hDivOn = !state.hDivOn;
    hDivBtn.classList.toggle("yx-on", state.hDivOn);
    paint();
  });
  const vDivBtn = el("button", "yx-chip", "竖等分");
  vDivBtn.type = "button";
  vDivBtn.title = "打开后按右侧数字画竖向等分线（线的条数＝等分数-1）";
  const vDivNum = el("input", "yx-num-in");
  vDivNum.type = "number";
  vDivNum.min = "2";
  vDivNum.max = "20";
  vDivNum.step = "1";
  vDivNum.value = "3";
  vDivNum.title = "竖向几等分（2–20）";
  vDivNum.addEventListener("change", () => {
    state.vDiv = Math.max(2, Math.min(20, Math.round(Number(vDivNum.value) || 2)));
    vDivNum.value = String(state.vDiv);
    paint();
  });
  const vDivColor = el("input", "yx-color-in");
  vDivColor.type = "color";
  vDivColor.value = "#ff8a8a";
  vDivColor.title = "竖向等分线的颜色（默认淡红色）";
  vDivColor.addEventListener("input", () => {
    state.vDivColor = vDivColor.value;
    paint();
  });
  vDivBtn.addEventListener("click", () => {
    state.vDivOn = !state.vDivOn;
    vDivBtn.classList.toggle("yx-on", state.vDivOn);
    paint();
  });

  head.appendChild(canvasInfo);
  head.appendChild(bgInfo);
  head.appendChild(multiBtn);
  head.appendChild(gridBtn);
  head.appendChild(axesBtn);
  head.appendChild(hDivBtn);
  head.appendChild(hDivNum);
  head.appendChild(hDivColor);
  head.appendChild(vDivBtn);
  head.appendChild(vDivNum);
  head.appendChild(vDivColor);

  const stage = el("div", "yx-stage");
  const canvas = el("canvas", "yx-canvas");
  stage.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  // 「只画框」开关：打开后画布上只认「拉新框」，选中/拖动/缩放/双击/右键/删除全部让路
  const setDrawOnly = (on) => {
    state.drawOnly = !!on;
    drawOnlyBtn.classList.toggle("yx-drawon", state.drawOnly);
    if (state.drawOnly) {
      if (state.editing) commitEdit();
      if (S.selected.size) {
        S.selected.clear();
        syncRows();
      }
      canvas.style.cursor = "crosshair";
    } else {
      canvas.style.cursor = "default";
    }
    paint();
  };

  const scroll = el("div", "yx-scroll");
  const table = el("div", "yx-table");
  const tableHead = el("div", "yx-row yx-header");
  // 列：移动 选中 编号 | 锁 类型 | 锁 文字 | 锁 描述 | 锁 宽 | 锁 高 | 锁 颜色 | 锁 x | 锁 y | 显示 重置 作画布 整体锁 删除
  const LABELS = ["", "选中", "编号", "", "类型", "", "文字", "", "描述", "", "宽", "", "高", "",
    "颜色", "", "x", "", "y", "显示", "重置", "作画布", "锁", "删除"];
  const HEAD_HINT = {
    选中: "勾上＝选中这一行（可多选）",
    编号: "图层序号，数字越小越靠上层",
    类型: "绘制框类型：文字框 / 角色框 / 物体框",
    文字: "框内写的文字（双击画布上的框也能编辑）",
    描述: "给模型看的这段画面的描述",
    宽: "宽度，单位像素",
    高: "高度，单位像素",
    颜色: "主色，只有绘制框有，背景图没有",
    x: "左下角的 x 坐标，原点在画布左下角",
    y: "左下角的 y 坐标，原点在画布左下角",
    显示: "眼睛：显示 / 隐藏这一行",
    重置: "背景图：恢复成原始尺寸",
    作画布: "把画布尺寸设成这张背景图的尺寸",
    锁: "整体锁定：位置与尺寸都不能改",
    删除: "删除这一行（点两次才生效）",
  };
  for (const label of LABELS) {
    const span = el("span", null, label);
    if (label && HEAD_HINT[label]) span.title = HEAD_HINT[label];
    tableHead.appendChild(span);
  }
  const rows = el("div", "yx-table");
  rows.style.gap = "3px";
  rows.style.display = "flex";
  rows.style.flexDirection = "column";
  table.appendChild(tableHead);
  table.appendChild(rows);
  scroll.appendChild(table);

  root.appendChild(topBar);
  root.appendChild(head);
  root.appendChild(stage);

  // 绘图区与列表之间的一排操作键
  const tableBar = el("div", "yx-bar");
  const allBoxesBtn = el("button", "yx-chip", "全选框");
  allBoxesBtn.type = "button";
  allBoxesBtn.title = "点一下选中所有绘制框（不含背景图），再点一下取消全选";
  const allBgBtn = el("button", "yx-chip", "全选背景");
  allBgBtn.type = "button";
  allBgBtn.title = "点一下选中所有背景图，再点一下取消全选";
  const delSelBtn = el("button", "yx-chip", "删除选中");
  delSelBtn.type = "button";
  delSelBtn.title = "删除所有选中的框和背景图（点两次才生效）";
  const hideSelBtn = el("button", "yx-chip", "隐藏选中");
  hideSelBtn.type = "button";
  hideSelBtn.title = "把选中的对象一键隐藏，再点一下把它们恢复显示";

  // 隐藏选中：记住这一批被隐藏的对象，第二次点击就把它们恢复
  let hiddenBatch = [];
  const syncBarButtons = () => {
    const allBoxesOn = S.boxes.length > 0 && S.boxes.every((box) => S.selected.has(box));
    allBoxesBtn.classList.toggle("yx-on", allBoxesOn);
    allBoxesBtn.textContent = allBoxesOn ? "取消全选框" : "全选框";
    const bgs = S.bgs.filter(Boolean);
    const allBgOn = bgs.length > 0 && bgs.every((bg) => S.selected.has(bg));
    allBgBtn.classList.toggle("yx-on", allBgOn);
    allBgBtn.textContent = allBgOn ? "取消全选背景" : "全选背景";
    hideSelBtn.classList.toggle("yx-on", hiddenBatch.length > 0);
    hideSelBtn.textContent = hiddenBatch.length > 0 ? "取消隐藏选中" : "隐藏选中";
  };
  state.syncBar = syncBarButtons;
  state.setDrawOnly = setDrawOnly;

  allBoxesBtn.addEventListener("click", () => {
    const allOn = S.boxes.length > 0 && S.boxes.every((box) => S.selected.has(box));
    if (allOn) {
      for (const box of S.boxes) S.selected.delete(box);
    } else {
      for (const box of S.boxes) S.selected.add(box);
    }
    hiddenBatch = [];
    syncBarButtons();
    refreshRows();
    paint();
  });
  allBgBtn.addEventListener("click", () => {
    const bgs = S.bgs.filter(Boolean);
    const allOn = bgs.length > 0 && bgs.every((bg) => S.selected.has(bg));
    if (allOn) {
      for (const bg of bgs) S.selected.delete(bg);
    } else {
      for (const bg of bgs) S.selected.add(bg);
    }
    hiddenBatch = [];
    syncBarButtons();
    refreshRows();
    paint();
  });
  // ---- 复制 / 粘贴（Ctrl+C / Ctrl+V，右键菜单里也有一份，剪贴板是节点内部的）
  const boxClipboard = [];
  const copySelection = () => {
    const boxes = [...S.selected].filter((item) => item && !item.isBg);
    if (!boxes.length) return false;
    boxClipboard.length = 0;
    for (const box of boxes) {
      boxClipboard.push({
        type: box.type,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        text: box.text || "",
        desc: box.desc || "",
        palette: [...(box.palette || [])],
      });
    }
    return true;
  };

  const pasteClipboard = () => {
    if (!boxClipboard.length) return false;
    const made = [];
    for (const src of boxClipboard) {
      const box = {
        type: src.type,
        x: src.x + 16,
        y: src.y + 16,
        w: src.w,
        h: src.h,
        text: src.text,
        desc: src.desc,
        palette: [...src.palette],
        hidden: false,
        lock: {},
      };
      // 贴进来如果压出画布，就往回挪到刚好落在画布里
      box.x = Math.max(0, Math.min(box.x, S.width - box.w));
      box.y = Math.max(0, Math.min(box.y, S.height - box.h));
      made.push(box);
    }
    S.boxes.unshift(...made);   // 新框放在最上层，和列表第一行对应
    S.selected.clear();
    for (const box of made) S.selected.add(box);
    refreshRows();
    layout();
    commit();
    paint();
    return true;
  };

  // ---- 删除（画布右键菜单、键盘 Delete、工具条按钮三处共用一套二次确认）
  const deleteSelected = () => {
    const boxes = [...S.selected].filter((item) => !item.isBg);
    const bgs = [...S.selected].filter((item) => item.isBg);
    if (!boxes.length && !bgs.length) return false;
    S.boxes = S.boxes.filter((box) => !boxes.includes(box));
    for (const bg of bgs) {
      const slot = (node.inputs || []).find((s) => bgSlotIndex(s.name) === bg.slot);
      if (slot && slot.link != null && node.disconnectInput) node.disconnectInput(slot);
      S.bgs = S.bgs.filter((item) => item !== bg);
      S.rows.delete(bg);
    }
    S.selected.clear();
    refreshRows();
    layout();
    commit();
    paint();
    return true;
  };
  let deleteArmed = false;
  let deleteTimer = null;
  const resetDeleteArm = () => {
    deleteArmed = false;
    clearTimeout(deleteTimer);
    delSelBtn.dataset.confirm = "0";
    delSelBtn.textContent = "删除选中";
    delSelBtn.classList.remove("yx-danger");
  };
  // 返回 true 表示这一次点击真的删掉了
  const requestDelete = () => {
    if (!S.selected.size) {
      resetDeleteArm();
      return false;
    }
    if (deleteArmed) {
      resetDeleteArm();
      return deleteSelected();
    }
    deleteArmed = true;
    delSelBtn.dataset.confirm = "1";
    delSelBtn.textContent = "确认删除?";
    delSelBtn.classList.add("yx-danger");
    clearTimeout(deleteTimer);
    deleteTimer = setTimeout(resetDeleteArm, 3000);
    return false;
  };
  delSelBtn.addEventListener("click", () => {
    requestDelete();
  });
  hideSelBtn.addEventListener("click", () => {
    if (hiddenBatch.length) {
      // 第二次点击：把上一批隐藏的全部恢复
      for (const item of hiddenBatch) item.hidden = false;
      hiddenBatch = [];
    } else {
      if (!S.selected.size) return;
      hiddenBatch = [...S.selected];
      for (const item of hiddenBatch) item.hidden = true;
      S.selected.clear();
    }
    syncBarButtons();
    refreshRows();
    commit();
    paint();
  });
  tableBar.appendChild(allBoxesBtn);
  tableBar.appendChild(allBgBtn);
  tableBar.appendChild(delSelBtn);
  tableBar.appendChild(hideSelBtn);

  const undoBtn = el("button", "yx-chip yx-undo", "撤销");
  undoBtn.type = "button";
  undoBtn.title = "撤销上一步操作（只影响这个节点，最多保留 60 步）";
  undoBtn.addEventListener("click", () => {
    undoStep();
  });
  state.undoBtn = undoBtn;
  tableBar.appendChild(undoBtn);

  const redoBtn = el("button", "yx-chip yx-undo", "重做");
  redoBtn.type = "button";
  redoBtn.title = "重做刚才撤销的那一步（最多 60 步）";
  redoBtn.addEventListener("click", () => {
    redoStep();
  });
  state.redoBtn = redoBtn;
  tableBar.appendChild(redoBtn);

  root.appendChild(tableBar);

  root.appendChild(scroll);

  // ---------------------------------------------------------------- 右键菜单
  const menu = el("div", "yx-menu");
  menu.style.display = "none";
  root.appendChild(menu);

  const closeMenu = () => {
    menu.style.display = "none";
    menu.textContent = "";
  };

  const menuItem = (label, handler, options = {}) => {
    const item = el("div", `yx-menu-item${options.danger ? " yx-menu-danger" : ""}`, label);
    item.addEventListener("pointerdown", (event) => event.stopPropagation());
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      handler(item);
    });
    menu.appendChild(item);
    return item;
  };

  const selectedBoxes = () => [...S.selected].filter((item) => item && !item.isBg);
  const selectedBgs = () => [...S.selected].filter((item) => item && item.isBg);

  const applyColorToSelection = (hex) => {
    const fixed = css3(hex) || String(hex).toUpperCase();
    let changed = false;
    for (const box of selectedBoxes()) {
      if (box.lock?.color) continue;
      box.palette = [fixed.toUpperCase()];
      changed = true;
    }
    if (changed) {
      syncRows();
      commit();
      paint();
    }
    closeMenu();
  };

  const applyTypeToSelection = (type) => {
    let changed = false;
    for (const box of selectedBoxes()) {
      if (box.lock?.type) continue;
      box.type = type;
      changed = true;
    }
    if (changed) {
      syncRows();
      commit();
      paint();
    }
    closeMenu();
  };

  const buildMenu = () => {
    menu.textContent = "";
    const boxes = selectedBoxes();
    const bgs = selectedBgs();
    const title = el("div", "yx-menu-title");
    title.textContent = S.selected.size === 1
      ? (bgs.length ? "背景图" : "绘制框")
      : `已选中 ${S.selected.size} 个对象`;
    menu.appendChild(title);

    menuItem("删除选中（点两次）", (item) => {
      if (item.dataset.armed === "1") {
        closeMenu();
        deleteSelected();
        return;
      }
      item.dataset.armed = "1";
      item.textContent = `确认删除 ${S.selected.size} 个?`;
      item.classList.add("yx-menu-armed");
    }, { danger: true });

    menuItem("复制选中框（Ctrl+C）", () => {
      if (!boxes.length) return;
      copySelection();
      closeMenu();
    });

    menuItem(boxClipboard.length ? "粘贴框（Ctrl+V）" : "粘贴框（剪贴板是空的）", () => {
      if (pasteClipboard()) closeMenu();
    });

    if (boxes.length) {
      menu.appendChild(el("div", "yx-menu-sep", ""));
      const label = el("div", "yx-menu-label", "自定义颜色");
      menu.appendChild(label);
      const wrap = el("div", "yx-menu-colors");
      for (const hex of ["#4EA1FF", "#FFD166", "#3DDC97", "#FF6B6B", "#B18CFF", "#FF9F43", "#22CC88", "#FFFFFF"]) {
        const dot = el("button", "yx-menu-swatch");
        dot.type = "button";
        dot.style.background = hex;
        dot.title = hex;
        dot.addEventListener("click", (event) => {
          event.stopPropagation();
          applyColorToSelection(hex);
        });
        wrap.appendChild(dot);
      }
      const pick = el("input", "yx-color-in");
      pick.type = "color";
      pick.title = "自定义颜色";
      pick.value = itemColor(boxes[0]);
      pick.addEventListener("input", () => applyColorToSelection(pick.value));
      wrap.appendChild(pick);
      menu.appendChild(wrap);

      menu.appendChild(el("div", "yx-menu-label", "修改框类型"));
      const types = el("div", "yx-menu-colors");
      for (const name of TYPES) {
        const button = el("button", "yx-menu-type", name);
        button.type = "button";
        button.style.borderColor = TYPE_COLOR[name] || "#3a3d4a";
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          applyTypeToSelection(name);
        });
        types.appendChild(button);
      }
      menu.appendChild(types);
    }
  };

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.skipMenu) {
      // 刚才用右键拖动平移过画布：这次不弹菜单
      state.skipMenu = false;
      return;
    }
    if (state.drawOnly) return; // 只画框模式：右键不弹菜单
    if (state.editing) commitEdit();
    const hit = hitTest(eventPoint(event));
    if (hit && !S.selected.has(hit)) {
      if (!state.multi) S.selected.clear();
      S.selected.add(hit);
      syncRows();
      paint();
    }
    if (!S.selected.size) {
      closeMenu();
      return;
    }
    buildMenu();
    const rect = root.getBoundingClientRect();
    menu.style.display = "block";
    const mw = menu.offsetWidth || 180;
    const mh = menu.offsetHeight || 140;
    let left = event.clientX - rect.left;
    let top = event.clientY - rect.top;
    if (left + mw > rect.width - 6) left = Math.max(6, rect.width - mw - 6);
    if (top + mh > rect.height - 6) top = Math.max(6, rect.height - mh - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  });

  document.addEventListener("pointerdown", (event) => {
    if (menu.style.display === "none") return;
    if (event.target && menu.contains && menu.contains(event.target)) return;
    closeMenu();
  }, true);

  // 键盘：Delete / Backspace 删选中（两次确认），Ctrl+C / Ctrl+V 复制粘贴
  // 用 capture 阶段抢在 ComfyUI 自己处理之前，免得 Delete 被当成「删除整个节点」
  let nodeHot = false;
  const inTypingField = () => {
    const active = document.activeElement;
    const tag = String(active?.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || !!active?.isContentEditable;
  };
  const onNodeKeyDown = (event) => {
    if (event.altKey) return;
    if (inTypingField()) return;   // 输入框里：交给浏览器/输入框自己处理
    const key = String(event.key || "");
    if (event.ctrlKey || event.metaKey) {
      if (!nodeHot) return;
      if (key.toLowerCase() === "c") {
        if (copySelection()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (key.toLowerCase() === "v") {
        if (pasteClipboard()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
      return;
    }
    if (key !== "Delete" && key !== "Backspace") return;
    if (!nodeHot) return;          // 鼠标不在这个节点上：Delete 仍然交回 ComfyUI（删节点）
    if (state.drawOnly) return;    // 只画框模式：Delete 不删东西
    if (!S.selected.size) return;
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    requestDelete();
  };
  window.addEventListener("keydown", onNodeKeyDown, true);
  state.nodeHot = false;
  state.markHot = (on) => {
    nodeHot = !!on;
    state.nodeHot = nodeHot;
  };

  state.activeType = TYPE_OBJ;
  state.grid = true;
  state.axes = true;
  state.hDivOn = false;
  state.hDiv = 3;
  state.hDivColor = "#ff8a8a";
  state.vDivOn = false;
  state.vDiv = 3;
  state.vDivColor = "#ff8a8a";
  state.S = S;
  chips.get(TYPE_OBJ)?.classList.add("yx-active");

  // ---------------------------------------------------------------- geometry
  // 缩放/平移只影响「显示」，不改变画布尺寸与任何坐标值
  const geo = () => {
    const rect = canvas.getBoundingClientRect();
    const cw = Math.max(1, rect.width);
    const ch = Math.max(1, rect.height);
    const fit = Math.min(cw / S.width, ch / S.height) || 1;
    const scale = fit * (state.zoom || 1);
    return {
      rect, cw, ch, fit, scale,
      ox: (cw - S.width * scale) / 2 + (state.panX || 0),
      oy: (ch - S.height * scale) / 2 + (state.panY || 0),
    };
  };

  const eventPoint = (event) => {
    const g = geo();
    return {
      x: (event.clientX - g.rect.left - g.ox) / g.scale,
      y: (event.clientY - g.rect.top - g.oy) / g.scale,
    };
  };

  const numeric = (w, fallback) => {
    const value = Number(w?.value);
    return Number.isFinite(value) ? value : fallback;
  };

  const multiple = () => {
    const text = String(wMult?.value ?? "16");
    const value = parseInt(text, 10);
    return Number.isFinite(value) && value >= 2 ? value : 0;
  };

  const roundUp = (value, mult) => (mult ? Math.max(mult, Math.ceil(value / mult) * mult) : Math.round(value));
  const roundNear = (value, mult) => (mult ? Math.max(mult, Math.round(value / mult) * mult) : Math.round(value));

  const activeBg = () => S.bgs.find((bg) => bg && bg.image) || null;

  const aspectRatio = () => {
    const aspect = String(wAspect?.value ?? "保持原图");
    if (aspect === "保持原图") {
      const bg = activeBg();
      const iw = bg?.natW || 0;
      const ih = bg?.natH || 0;
      return iw > 0 && ih > 0 ? iw / ih : S.width / Math.max(1, S.height);
    }
    if (aspect === "自定义") {
      return Math.max(1, numeric(wPropW, 1)) / Math.max(1, numeric(wPropH, 1));
    }
    const parts = String(aspect).split(":");
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    return a > 0 && b > 0 ? a / b : 1;
  };

  const scaledSize = (iw, ih) => {
    const ratio = aspectRatio();
    const basis = String(wBasis?.value ?? "长边");
    const length = Math.max(4, numeric(wLength, 1024));
    if (basis === "不缩放") return [iw, ih];
    let width = 0;
    let height = 0;
    if (basis === "宽度") {
      width = length;
      height = width / ratio;
    } else if (basis === "高度") {
      height = length;
      width = height * ratio;
    } else if (basis === "总像素(千像素)") {
      width = Math.sqrt(ratio * length * 1000);
      height = width / ratio;
    } else if (basis === "短边") {
      if (ratio >= 1) {
        height = length;
        width = height * ratio;
      } else {
        width = length;
        height = width / ratio;
      }
    } else {
      if (ratio >= 1) {
        width = length;
        height = width / ratio;
      } else {
        height = length;
        width = height * ratio;
      }
    }
    return [Math.round(width), Math.round(height)];
  };

  // ---------------------------------------------------------------- state io
  const serialize = () => {
    const payload = {
      boxes: S.boxes.map((box) => ({
        type: box.type,
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.w),
        h: Math.round(box.h),
        text: box.text,
        desc: box.desc,
        palette: [...(box.palette || [])],
        hidden: !!box.hidden,
        lock: { ...box.lock },
      })),
      bgs: S.bgs.filter(Boolean).map((bg) => ({
        slot: bg.slot,
        x: Math.round(bg.x),
        y: Math.round(bg.y),
        w: Math.round(bg.w),
        h: Math.round(bg.h),
        hidden: !!bg.hidden,
        desc: bg.desc || "",
        url: bg.url || "",
        lockedCanvas: !!bg.lockedCanvas,
        lock: { ...bg.lock },
      })),
    };
    return JSON.stringify(payload);
  };

  const commit = () => {
    if (state.suppress) return;
    if (wData) wData.value = serialize();
    node.graph?.setDirtyCanvas?.(true, true);
    rememberStep();
  };

  // ---------------------------------------------------------------- undo
  // 每次真正改动画布都留一份快照；快照只是几 KB 的 JSON，只在“提交”时生成，
  // 不做逐帧记录，所以对性能与显存基本没有影响。
  const UNDO_LIMIT = 60;
  const undoStack = [];
  const redoStack = [];          // 撤销掉的那些步，可以按「重做」再走回来
  let lastSnap = null;
  let lastKey = null;

  const snapshotKey = () => JSON.stringify({ w: S.width, h: S.height, d: serialize() });
  const captureSnapshot = () => ({ width: S.width, height: S.height, data: serialize() });

  const rememberStep = () => {
    let key;
    try {
      key = snapshotKey();
    } catch {
      return;
    }
    if (state.restoring) {
      lastKey = key;
      lastSnap = captureSnapshot();
      return;
    }
    if (key === lastKey) return;
    if (lastKey !== null && lastSnap) {
      undoStack.push(lastSnap);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack.length = 0;      // 重新动手之后，之前撤销掉的分支就作废了
    }
    lastKey = key;
    lastSnap = captureSnapshot();
    refreshUndoButton();
  };

  const resetUndo = () => {
    undoStack.length = 0;
    redoStack.length = 0;
    try {
      lastKey = snapshotKey();
      lastSnap = captureSnapshot();
    } catch {
      lastKey = null;
      lastSnap = null;
    }
    refreshUndoButton();
  };

  const refreshUndoButton = () => {
    if (state.undoBtn) {
      const count = undoStack.length;
      state.undoBtn.textContent = count ? `撤销 ${count}` : "撤销";
      state.undoBtn.classList.toggle("yx-on", count > 0);
      state.undoBtn.disabled = count === 0;
      state.undoBtn.title = count
        ? `撤销上一步操作（还能撤销 ${count} 步）`
        : "没有可以撤销的操作了";
    }
    if (state.redoBtn) {
      const count = redoStack.length;
      state.redoBtn.textContent = count ? `重做 ${count}` : "重做";
      state.redoBtn.classList.toggle("yx-on", count > 0);
      state.redoBtn.disabled = count === 0;
      state.redoBtn.title = count
        ? `重做刚才撤销的那一步（还能重做 ${count} 步）`
        : "没有可以重做的操作了";
    }
  };

  const restoreSnapshot = (snap) => {
    let payload;
    try {
      payload = JSON.parse(snap.data || "{}");
    } catch {
      return;
    }
    const prevBgs = S.bgs.filter(Boolean);
    state.restoring = true;
    state.suppress = true;
    try {
      S.width = clampSize(snap.width);
      S.height = clampSize(snap.height);
      S.boxes = (payload.boxes || []).map((box) => ({
        type: box.type,
        x: Number(box.x) || 0,
        y: Number(box.y) || 0,
        w: Number(box.w) || 16,
        h: Number(box.h) || 16,
        text: box.text || "",
        desc: box.desc || "",
        palette: [...(box.palette || [])],
        hidden: !!box.hidden,
        lock: { ...(box.lock || {}) },
      }));
      S.bgs = (payload.bgs || []).map((bg) => {
        const old = prevBgs.find((item) => item.slot === bg.slot) ||
          prevBgs.find((item) => bg.url && item.url === bg.url);
        return {
          isBg: true,
          slot: bg.slot,
          x: Number(bg.x) || 0,
          y: Number(bg.y) || 0,
          w: Number(bg.w) || 16,
          h: Number(bg.h) || 16,
          hidden: !!bg.hidden,
          desc: bg.desc || "",
          url: bg.url || "",
          lockedCanvas: !!bg.lockedCanvas,
          lock: { ...(bg.lock || {}) },
          image: old?.image || null,
          natW: old?.natW,
          natH: old?.natH,
        };
      });
      S.selected.clear();
    } finally {
      state.suppress = false;
    }
    syncSizeWidgets();
    refreshRows();
    layout();
    commit();
    state.restoring = false;
    lastKey = snapshotKey();
    lastSnap = captureSnapshot();
    // 快照里只存 URL，图片本体从上游重新挂一次
    for (const bg of S.bgs) {
      if (bg.image || !bg.url) continue;
      try {
        state.attachBackgroundByURL?.(bg, bg.url);
      } catch {
        /* 忽略 */
      }
    }
    refreshUndoButton();
    paint();
  };

  const undoStep = () => {
    if (!undoStack.length) return false;
    const snap = undoStack.pop();
    let now = null;
    try {
      now = captureSnapshot();
    } catch {
      now = null;
    }
    restoreSnapshot(snap);
    // 把「撤销之前的样子」放进重做栈，重做就能一步走回来
    if (now) {
      redoStack.push(now);
      if (redoStack.length > UNDO_LIMIT) redoStack.shift();
    }
    refreshUndoButton();
    return true;
  };

  const redoStep = () => {
    if (!redoStack.length) return false;
    const snap = redoStack.pop();
    let now = null;
    try {
      now = captureSnapshot();
    } catch {
      now = null;
    }
    restoreSnapshot(snap);
    if (now) {
      undoStack.push(now);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }
    refreshUndoButton();
    return true;
  };

  const syncSizeWidgets = () => {
    state.suppress = true;
    try {
      if (wWidth) wWidth.value = S.width;
      if (wHeight) wHeight.value = S.height;
    } finally {
      state.suppress = false;
    }
  };

  const refreshInfo = () => {
    canvasInfo.innerHTML = `画布 <b>${Math.round(S.width)}×${Math.round(S.height)}</b>`;
    const count = S.bgs.filter(Boolean).length;
    bgInfo.innerHTML = `背景图 <b>${count}</b> 张`;
  };

  const applyCanvasSize = (width, height, rescale) => {
    const w = clampSize(width);
    const h = clampSize(height);
    if (w === S.width && h === S.height) return false;
    if (rescale && S.width > 0 && S.height > 0) {
      const rx = w / S.width;
      const ry = h / S.height;
      for (const box of S.boxes) {
        box.x *= rx;
        box.y *= ry;
        box.w *= rx;
        box.h *= ry;
      }
      for (const bg of S.bgs) {
        if (!bg) continue;
        if (bg.lockedCanvas) {
          // 已经当画布用的那张：始终铺满新画布
          bg.x = 0;
          bg.y = 0;
          bg.w = w;
          bg.h = h;
          continue;
        }
        bg.x *= rx;
        bg.y *= ry;
        bg.w *= rx;
        bg.h *= ry;
      }
    }
    S.width = w;
    S.height = h;
    syncSizeWidgets();
    refreshInfo();
    refreshRows();
    layout();
    return true;
  };

  // 画布尺寸模式：只决定画布大小，不重新摆放背景图
  const applyModeSize = () => {
    const mode = String(wMode?.value ?? "自定义尺寸");
    if (mode === "自定义尺寸") {
      applyCanvasSize(numeric(wWidth, S.width), numeric(wHeight, S.height), true);
      return;
    }
    const bg = activeBg();
    if (!bg || !bg.natW || !bg.natH) return;
    const mult = multiple();
    if (mode === "按图片原始尺寸") {
      applyCanvasSize(roundNear(bg.natW, mult), roundNear(bg.natH, mult), true);
    } else {
      const [w, h] = scaledSize(bg.natW, bg.natH);
      applyCanvasSize(roundUp(w, mult), roundUp(h, mult), true);
    }
  };

  // ---------------------------------------------------------------- clamping
  // 框：必须完整待在画布里（x/w 不能超出画布）
  const clampBox = (box) => {
    box.w = clamp(box.w, MIN_BOX, MAX_SIZE);
    box.h = clamp(box.h, MIN_BOX, MAX_SIZE);
    box.x = clamp(box.x, 0, Math.max(0, S.width - box.w));
    box.y = clamp(box.y, 0, Math.max(0, S.height - box.h));
  };

  // 背景图：比画布小的，完整待在画布里；比画布大的，只能在「盖住画布」的范围内挪
  const clampBgAxis = (value, size, canvas) => {
    if (size <= canvas) return clamp(value, 0, canvas - size);
    return clamp(value, canvas - size, 0);
  };
  const clampBg = (bg) => {
    bg.w = clamp(bg.w, MIN_BOX, MAX_SIZE);
    bg.h = clamp(bg.h, MIN_BOX, MAX_SIZE);
    bg.x = clampBgAxis(bg.x, bg.w, S.width);
    bg.y = clampBgAxis(bg.y, bg.h, S.height);
  };

  const clampItem = (item) => (item.isBg ? clampBg(item) : clampBox(item));

  // ---------------------------------------------------------------- rows
  const lockButton = (item, field, title) => {
    const button = el("button", "yx-lock");
    button.type = "button";
    button.title = `${title}：点击上锁 / 解锁`;
    const sync = () => {
      const locked = !!item.lock?.[field];
      button.textContent = locked ? "🔒" : "🔓";
      button.classList.toggle("yx-on", locked);
    };
    button.addEventListener("click", () => {
      item.lock = item.lock || {};
      item.lock[field] = !item.lock[field];
      sync();
      syncRows();
      paint();
      commit();
    });
    sync();
    button.__sync = sync;
    return button;
  };

  const foldToggle = (button, area) => {
    const open = area.style.display === "none";
    area.style.display = open ? "block" : "none";
    button.classList.toggle("yx-open", open);
    button.textContent = open ? "▴" : "▾";
    layout();
  };

  const rowForBox = (box) => {
    const row = el("div", "yx-table yx-item-wrap");
    row.__item = box;
    row.__isBg = false;
    row.style.display = "flex";
    row.style.flexDirection = "column";
    const line = el("div", "yx-row yx-item");

    const drag = el("div", "yx-drag", "☰");
    drag.title = "拖动排序：越靠上 = 画面里越上层";
    const check = el("input", "yx-check");
    check.type = "checkbox";
    check.title = "选中这个框（和画布上点击同步）";
    const num = el("div", "yx-num", "01");
    num.title = "点击只选中这一个框";

    const lockType = lockButton(box, "type", "类型");
    const type = el("select", "yx-sel-type");
    for (const name of TYPES) {
      const option = el("option", null, name);
      option.value = name;
      type.appendChild(option);
    }

    const lockText = lockButton(box, "text", "文字");
    const textWrap = el("div", "yx-field");
    const text = el("input", "yx-in");
    text.placeholder = "框内文字";
    const foldText = el("button", "yx-fold", "▾");
    foldText.type = "button";
    foldText.title = "展开大输入框";
    textWrap.appendChild(text);
    textWrap.appendChild(foldText);

    const lockDesc = lockButton(box, "desc", "描述");
    const descWrap = el("div", "yx-field");
    const desc = el("input", "yx-in");
    desc.placeholder = "描述";
    const foldDesc = el("button", "yx-fold", "▾");
    foldDesc.type = "button";
    foldDesc.title = "展开大输入框";
    descWrap.appendChild(desc);
    descWrap.appendChild(foldDesc);

    const lockW = lockButton(box, "w", "宽");
    const wInput = el("input", "yx-in");
    wInput.type = "number";
    wInput.step = String(GRID);
    const lockH = lockButton(box, "h", "高");
    const hInput = el("input", "yx-in");
    hInput.type = "number";
    hInput.step = String(GRID);

    const lockColor = lockButton(box, "color", "颜色");
    const color = el("input", "yx-color");
    color.type = "color";
    color.title = "主色（会写进布局提示词的 palette）";

    const lockX = lockButton(box, "x", "x 坐标");
    const xInput = el("input", "yx-in");
    xInput.type = "number";
    xInput.step = String(GRID);
    xInput.title = "框左下角在画布里的 x 坐标（左下角为原点）";
    const lockY = lockButton(box, "y", "y 坐标");
    const yInput = el("input", "yx-in");
    yInput.type = "number";
    yInput.step = String(GRID);
    yInput.title = "框左下角在画布里的 y 坐标（左下角为原点，向上为正）";

    const eye = el("button", "yx-icon", "👁");
    eye.type = "button";
    eye.title = "隐藏 / 显示这个框（隐藏后不参与提示词编译）";
    const spacer = el("div", null, "");
    const del = el("button", "yx-icon", "✕");
    del.type = "button";
    del.title = "删除这个框";

    line.append(drag, check, num, lockType, type, lockText, textWrap, lockDesc, descWrap,
      lockW, wInput, lockH, hInput, lockColor, color, lockX, xInput, lockY, yInput,
      eye, spacer, el("div", null, ""), el("div", null, ""), del);
    row.appendChild(line);

    const bigWrap = el("div", "yx-table");
    bigWrap.style.display = "flex";
    bigWrap.style.flexDirection = "column";
    bigWrap.style.gap = "3px";
    const expandText = el("textarea", "yx-big");
    const expandDesc = el("textarea", "yx-big");
    expandText.placeholder = "框内文字（大输入区）";
    expandDesc.placeholder = "这个框的画面描述（大输入区）";
    expandText.style.display = "none";
    expandDesc.style.display = "none";
    bigWrap.appendChild(expandText);
    bigWrap.appendChild(expandDesc);
    row.appendChild(bigWrap);

    const locked = (field) => !!box.lock?.[field];
    const edit = () => {
      paint();
      commit();
    };

    const syncRow = () => {
      const selected = S.selected.has(box);
      line.classList.toggle("yx-sel", selected);
      line.classList.toggle("yx-hidden-row", !!box.hidden);
      check.checked = selected;
      eye.classList.toggle("yx-off", !!box.hidden);
      eye.textContent = box.hidden ? "🚫" : "👁";
      type.value = box.type;
      color.value = itemColor(box);
      wInput.value = Math.round(box.w);
      hInput.value = Math.round(box.h);
      xInput.value = Math.round(box.x);
      yInput.value = Math.round(S.height - (box.y + box.h));
      if (document.activeElement !== text) text.value = box.text || "";
      if (document.activeElement !== desc) desc.value = box.desc || "";
      if (document.activeElement !== expandText) expandText.value = box.text || "";
      if (document.activeElement !== expandDesc) expandDesc.value = box.desc || "";
      const index = S.boxes.indexOf(box);
      num.textContent = index >= 0 ? String(index + 1).padStart(2, "0") : "";

      type.disabled = locked("type");
      text.disabled = locked("text");
      desc.disabled = locked("desc");
      expandText.disabled = locked("text");
      expandDesc.disabled = locked("desc");
      wInput.disabled = locked("w");
      hInput.disabled = locked("h");
      color.disabled = locked("color");
      xInput.disabled = locked("x");
      yInput.disabled = locked("y");
      for (const button of line.querySelectorAll(".yx-lock")) button.__sync?.();
    };

    check.addEventListener("change", () => {
      if (check.checked) {
        if (!state.multi) S.selected.clear(); // 没开多选：勾一个就只选这一个
        S.selected.add(box);
      } else {
        S.selected.delete(box);
      }
      syncRows();
      paint();
    });

    num.addEventListener("click", () => {
      S.selected.clear();
      S.selected.add(box);
      syncRows();
      paint();
    });

    type.addEventListener("change", () => {
      if (locked("type")) return;
      box.type = type.value;
      syncRow();
      edit();
    });

    const bind = (input, field, expand) => {
      input.addEventListener("input", () => {
        if (locked(field)) return;
        box[field] = input.value;
        if (expand && document.activeElement !== expand) expand.value = input.value;
        commit();
        paint();
      });
    };
    bind(text, "text", expandText);
    bind(desc, "desc", expandDesc);
    bind(expandText, "text", text);
    bind(expandDesc, "desc", desc);

    foldText.addEventListener("click", () => foldToggle(foldText, expandText));
    foldDesc.addEventListener("click", () => foldToggle(foldDesc, expandDesc));

    const applySize = (input, field) => {
      if (locked(field)) return;
      const value = clampSize(Number(input.value) || MIN_BOX);
      if (field === "w") box.w = clamp(value, MIN_BOX, S.width - box.x);
      else box.h = clamp(value, MIN_BOX, S.height - box.y);
      clampBox(box);
      syncRow();
      edit();
    };
    wInput.addEventListener("change", () => applySize(wInput, "w"));
    hInput.addEventListener("change", () => applySize(hInput, "h"));

    // 左下角原点坐标：x 向右、y 向上，输入后换算回内部左上角坐标
    xInput.addEventListener("change", () => {
      if (locked("x")) return;
      const value = Number(xInput.value);
      if (Number.isFinite(value)) box.x = clamp(value, 0, S.width - box.w);
      clampBox(box);
      syncRow();
      edit();
    });
    yInput.addEventListener("change", () => {
      if (locked("y")) return;
      const value = Number(yInput.value);
      if (Number.isFinite(value)) box.y = S.height - value - box.h;
      clampBox(box);
      syncRow();
      edit();
    });

    color.addEventListener("input", () => {
      if (locked("color")) return;
      box.palette = [String(color.value).toUpperCase()];
      edit();
    });

    eye.addEventListener("click", () => {
      box.hidden = !box.hidden;
      syncRow();
      edit();
    });

    del.addEventListener("click", () => {
      if (state.confirm !== box) {
        state.confirm = box;
        del.textContent = "确认?";
        del.classList.add("yx-danger");
        clearTimeout(state.confirmTimer);
        state.confirmTimer = setTimeout(() => {
          if (state.confirm === box) {
            state.confirm = null;
            del.textContent = "✕";
            del.classList.remove("yx-danger");
          }
        }, 3000);
        return;
      }
      state.confirm = null;
      clearTimeout(state.confirmTimer);
      const index = S.boxes.indexOf(box);
      if (index >= 0) S.boxes.splice(index, 1);
      S.selected.delete(box);
      S.rows.delete(box);
      refreshRows();
      edit();
    });

    bindReorder(drag, box, false);

    row.__item = box;
    row.__sync = syncRow;
    syncRow();
    return row;
  };

  const rowForBg = (bg) => {
    const row = el("div", "yx-table yx-item-wrap");
    row.__item = bg;
    row.__isBg = true;
    row.style.display = "flex";
    row.style.flexDirection = "column";
    const line = el("div", "yx-row yx-item yx-bg");

    const drag = el("div", "yx-drag", "☰");
    drag.title = "拖动排序：背景图之间的前后关系（永远在所有绘制框下面）";
    const check = el("input", "yx-check");
    check.type = "checkbox";
    const num = el("div", "yx-num", "B1");

    const lockType = el("div", null, "");
    const type = el("div", null, "背景图");
    type.style.fontSize = "12px";
    type.style.color = BG_COLOR;

    const lockText = el("div", null, "");
    const textCell = el("div", null, "—");
    textCell.style.fontSize = "11px";
    textCell.style.color = "#7c7f8d";
    textCell.style.textAlign = "center";

    const lockDesc = lockButton(bg, "desc", "备注");
    const descWrap = el("div", "yx-field");
    const desc = el("input", "yx-in");
    desc.placeholder = "备注（不参与提示词）";
    const foldDesc = el("button", "yx-fold", "▾");
    foldDesc.type = "button";
    descWrap.appendChild(desc);
    descWrap.appendChild(foldDesc);

    const lockW = lockButton(bg, "w", "宽");
    const wInput = el("input", "yx-in");
    wInput.type = "number";
    wInput.step = String(GRID);
    const lockH = lockButton(bg, "h", "高");
    const hInput = el("input", "yx-in");
    hInput.type = "number";
    hInput.step = String(GRID);

    const lockColor = el("div", null, "");
    const colorCell = el("div", null, "");
    colorCell.style.height = "14px";
    colorCell.style.borderRadius = "3px";
    colorCell.style.background = BG_COLOR;

    const lockX = lockButton(bg, "x", "x 坐标");
    const xInput = el("input", "yx-in");
    xInput.type = "number";
    xInput.title = "背景图左下角在画布里的 x 坐标";
    const lockY = lockButton(bg, "y", "y 坐标");
    const yInput = el("input", "yx-in");
    yInput.type = "number";
    yInput.title = "背景图左下角在画布里的 y 坐标（向上为正）";

    const eye = el("button", "yx-icon", "👁");
    eye.type = "button";
    eye.title = "隐藏 / 显示这张背景图";
    const reset = el("button", "yx-chip", "重置");
    reset.type = "button";
    reset.style.padding = "0 2px";
    reset.style.fontSize = "10px";
    reset.style.lineHeight = "16px";
    reset.title = "按图片原始尺寸放回画布左下角（超出画布的部分会显示在画布外并被裁掉）";
    const del = el("button", "yx-icon", "✕");
    del.type = "button";
    del.title = "移除这张背景图";

    // 直接作为画布（二次确认）＋ 整体锁
    const canvasBtn = el("button", "yx-chip", "作画布");
    canvasBtn.type = "button";
    canvasBtn.style.padding = "0 2px";
    canvasBtn.style.fontSize = "10px";
    canvasBtn.style.lineHeight = "16px";
    canvasBtn.title = "直接作为画布：画布尺寸＝这张图的原始尺寸，图片铺满画布并整体锁定（点右侧「锁」列解锁）";
    const lockAll = el("button", "yx-icon", "🔓");
    lockAll.type = "button";

    line.append(drag, check, num, lockType, type, lockText, textCell, lockDesc, descWrap,
      lockW, wInput, lockH, hInput, lockColor, colorCell, lockX, xInput, lockY, yInput,
      eye, reset, canvasBtn, lockAll, del);
    row.appendChild(line);

    const bigWrap = el("div", "yx-table");
    const expandDesc = el("textarea", "yx-big");
    expandDesc.style.display = "none";
    expandDesc.placeholder = "备注";
    bigWrap.appendChild(expandDesc);
    row.appendChild(bigWrap);

    const locked = (field) => !!bg.lock?.[field] || (!!bg.lockedCanvas && field !== "desc");
    const edit = () => {
      paint();
      commit();
    };

    let confirmTimer = null;
    const resetConfirm = () => {
      canvasBtn.textContent = "作画布";
      canvasBtn.classList.remove("yx-danger");
    };
    canvasBtn.addEventListener("click", () => {
      if (canvasBtn.dataset.confirm === "1") {
        canvasBtn.dataset.confirm = "0";
        clearTimeout(confirmTimer);
        resetConfirm();
        useAsCanvas(bg);
        return;
      }
      canvasBtn.dataset.confirm = "1";
      canvasBtn.textContent = "确认?";
      canvasBtn.classList.add("yx-danger");
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => {
        canvasBtn.dataset.confirm = "0";
        resetConfirm();
      }, 3000);
    });

    lockAll.addEventListener("click", () => {
      bg.lockedCanvas = !bg.lockedCanvas;
      if (bg.lockedCanvas) {
        // 锁上时把这张图重新对齐成「铺满画布」
        bg.x = 0;
        bg.y = 0;
        bg.w = S.width;
        bg.h = S.height;
        S.selected.delete(bg);
      }
      syncRow();
      edit();
    });

    const syncRow = () => {
      const selected = S.selected.has(bg);
      line.classList.toggle("yx-sel", selected);
      line.classList.toggle("yx-hidden-row", !!bg.hidden);
      check.checked = selected;
      eye.classList.toggle("yx-off", !!bg.hidden);
      eye.textContent = bg.hidden ? "🚫" : "👁";
      num.textContent = bg.label || "B";
      wInput.value = Math.round(bg.w);
      hInput.value = Math.round(bg.h);
      xInput.value = Math.round(bg.x);
      yInput.value = Math.round(S.height - (bg.y + bg.h));
      lockAll.textContent = bg.lockedCanvas ? "🔒" : "🔓";
      lockAll.title = bg.lockedCanvas
        ? "已作为画布：整张图被锁死（不能拖动 / 缩放），点这里解锁"
        : "整体解锁状态：可以拖动 / 缩放这张背景图";
      line.classList.toggle("yx-canvas-row", !!bg.lockedCanvas);
      if (document.activeElement !== desc) desc.value = bg.desc || "";
      if (document.activeElement !== expandDesc) expandDesc.value = bg.desc || "";
      wInput.disabled = locked("w");
      hInput.disabled = locked("h");
      xInput.disabled = locked("x");
      yInput.disabled = locked("y");
      desc.disabled = locked("desc");
      expandDesc.disabled = locked("desc");
      for (const button of line.querySelectorAll(".yx-lock")) button.__sync?.();
    };

    check.addEventListener("change", () => {
      if (check.checked) {
        if (!state.multi) S.selected.clear(); // 没开多选：勾一个就只选这一个
        S.selected.add(bg);
      } else {
        S.selected.delete(bg);
      }
      syncRows();
      paint();
    });
    num.addEventListener("click", () => {
      S.selected.clear();
      S.selected.add(bg);
      syncRows();
      paint();
    });

    const applySize = (input, field) => {
      if (locked(field)) return;
      bg[field] = clamp(Number(input.value) || MIN_BOX, MIN_BOX, MAX_SIZE);
      // 适配方式 = 锁比例 时，手工改宽/高也让另一个方向跟着等比变化
      if (ratioLockEnabled(bg)) {
        const ratio = bgRatio(bg);
        if (field === "w" && !locked("h")) bg.h = clamp(Math.round(bg.w / ratio), MIN_BOX, MAX_SIZE);
        if (field === "h" && !locked("w")) bg.w = clamp(Math.round(bg.h * ratio), MIN_BOX, MAX_SIZE);
      }
      clampBg(bg);
      syncRow();
      edit();
    };
    wInput.addEventListener("change", () => applySize(wInput, "w"));
    hInput.addEventListener("change", () => applySize(hInput, "h"));

    xInput.addEventListener("change", () => {
      if (locked("x")) return;
      const value = Number(xInput.value);
      if (Number.isFinite(value)) bg.x = value;
      clampBg(bg);
      syncRow();
      edit();
    });
    yInput.addEventListener("change", () => {
      if (locked("y")) return;
      const value = Number(yInput.value);
      if (Number.isFinite(value)) bg.y = S.height - value - bg.h;
      clampBg(bg);
      syncRow();
      edit();
    });

    desc.addEventListener("input", () => {
      if (locked("desc")) return;
      bg.desc = desc.value;
      if (document.activeElement !== expandDesc) expandDesc.value = desc.value;
      commit();
    });
    expandDesc.addEventListener("input", () => {
      if (locked("desc")) return;
      bg.desc = expandDesc.value;
      if (document.activeElement !== desc) desc.value = expandDesc.value;
      commit();
    });
    foldDesc.addEventListener("click", () => foldToggle(foldDesc, expandDesc));

    eye.addEventListener("click", () => {
      bg.hidden = !bg.hidden;
      syncRow();
      edit();
    });

    reset.addEventListener("click", () => {
      if (!bg.natW || !bg.natH) return;
      if (!locked("w")) bg.w = bg.natW;
      if (!locked("h")) bg.h = bg.natH;
      if (!locked("x")) bg.x = 0;
      if (!locked("y")) bg.y = S.height - bg.h;
      clampBg(bg);
      syncRow();
      edit();
    });

    del.addEventListener("click", () => {
      if (state.confirm !== bg) {
        state.confirm = bg;
        del.textContent = "确认?";
        del.classList.add("yx-danger");
        clearTimeout(state.confirmTimer);
        state.confirmTimer = setTimeout(() => {
          if (state.confirm === bg) {
            state.confirm = null;
            del.textContent = "✕";
            del.classList.remove("yx-danger");
          }
        }, 3000);
        return;
      }
      state.confirm = null;
      clearTimeout(state.confirmTimer);
      S.selected.delete(bg);
      S.rows.delete(bg);
      S.bgs = S.bgs.filter((item) => item !== bg);
      refreshRows();
      paint();
      commit();
    });

    bindReorder(drag, bg, true);

    row.__item = bg;
    row.__sync = syncRow;
    syncRow();
    return row;
  };

  // 拖拽排序：借鉴 VMNodes 的做法——拖动过程中只移动一条插入指示线，
  // 行本身不动（所以不需要每帧测量/重排 DOM），松手时才重排一次。
  function bindReorder(handle, item, isBg) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const row = handle.closest(".yx-item-wrap");
      if (!row || row.parentNode !== rows) return;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      let dragging = false;

      // 起手时只量一次几何：拖动期间行不动，这份数据一直有效
      const group = Array.from(rows.children)
        .filter((child) => child.classList
          && child.classList.contains("yx-item-wrap")
          && !!child.__isBg === isBg
          && child.__item);
      const metas = group.map((child) => {
        const rect = child.getBoundingClientRect();
        return {
          item: child.__item,
          top: child.offsetTop,
          bottom: child.offsetTop + child.offsetHeight,
          mid: rect.top + rect.height / 2,
        };
      });
      const startIndex = metas.findIndex((meta) => meta.item === item);
      let target = startIndex;

      const line = el("div", "yx-drop-line");
      const place = (index) => {
        let top = 0;
        if (metas.length === 0) top = 0;
        else if (index <= 0) top = metas[0].top - 2;
        else if (index >= metas.length) top = metas[metas.length - 1].bottom;
        else top = metas[index].top - 2;
        line.style.top = `${Math.max(0, Math.round(top))}px`;
      };
      const indexAt = (clientY) => {
        let index = 0;
        for (const meta of metas) if (clientY > meta.mid) index += 1;
        return index;
      };

      const onMove = (moveEvent) => {
        if (!dragging) {
          if (Math.abs(moveEvent.clientY - startY) < 3) return;
          dragging = true;
          state.reorderActive = true;
          row.classList.add("yx-dragging");
          rows.appendChild(line);
          place(target);
        }
        const index = indexAt(moveEvent.clientY);
        if (index !== target) {
          target = index;
          place(index);
        }
      };

      const onUp = (upEvent) => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        try { handle.releasePointerCapture?.(pointerId); } catch (err) { /* 忽略 */ }
        if (upEvent && upEvent.type !== "pointercancel" && dragging) {
          target = indexAt(upEvent.clientY);
        }
        line.remove();
        row.classList.remove("yx-dragging");
        state.reorderActive = false;
        if (!dragging) return;
        dragging = false;
        if (target === startIndex || target === startIndex + 1) return;
        const list = isBg ? S.bgs.filter(Boolean) : S.boxes.slice();
        const [moved] = list.splice(startIndex, 1);
        if (!moved) return;
        list.splice(target > startIndex ? target - 1 : target, 0, moved);
        if (isBg) S.bgs = list.concat(S.bgs.filter((entry) => !entry));
        else S.boxes = list;
        refreshRows();
        layout();
        commit();
        paint();
      };

      try { handle.setPointerCapture(pointerId); } catch (err) { /* 忽略 */ }
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }

  function refreshRows() {
    // 删除/撤销/换工作流之后，选中集合里可能残留已经不存在的对象，这里顺手清掉
    if (S.selected.size) {
      const alive = new Set([...S.boxes, ...S.bgs.filter(Boolean)]);
      for (const item of [...S.selected]) {
        if (!item || !alive.has(item)) S.selected.delete(item);
      }
    }
    rows.textContent = "";
    S.rows.clear();
    S.bgs.filter(Boolean).forEach((bg, index) => {
      bg.label = `B${index + 1}`;
    });
    if (S.boxes.length === 0 && S.bgs.filter(Boolean).length === 0) {
      rows.appendChild(el("div", "yx-empty", "在画布空白处按住拖动即可画框；接入图片后会自动出现在最下面"));
    }
    for (const box of S.boxes) {
      const row = rowForBox(box);
      S.rows.set(box, row);
      rows.appendChild(row);
    }
    for (const bg of S.bgs.filter(Boolean)) {
      const row = rowForBg(bg);
      S.rows.set(bg, row);
      rows.appendChild(row);
    }
    refreshInfo();
    state.syncBar?.();
    // 行数变了：重新量一遍列表高度，多了就出滚动条（layout 还没就绪时跳过）
    if (state.layoutReady) layout();
  }

  const syncRows = () => {
    for (const row of S.rows.values()) row.__sync?.();
    state.syncBar?.();
  };

  // ---------------------------------------------------------------- layout
  // 这里的每个数字都必须是「算出来的、定的」，绝不去量容器的实时高度：
  // 一旦测量结果反过来影响高度，就会和 flex / 前端布局互相拉扯（抽搐、行被裁）。
  const layoutWidth = () => Math.max(240, stage.clientWidth || 480);

  const LIST_ROW_H = 32; // 单行高度（含行间距）
  const LIST_HEAD_H = 30; // 表头
  const LIST_MIN_ROWS = 10; // 最多显示 10 行，超过 10 行才出滚动条
  const LIST_BASE_H = LIST_ROW_H * LIST_MIN_ROWS + LIST_HEAD_H + 8; // 10 行 + 表头 + 余量（上限）
  const LIST_FLOOR_H = LIST_ROW_H * 3 + LIST_HEAD_H + 8; // 少于 3 行时也留出 3 行的位置，别来回跳

  // 列表高度 = 行数 × 行高 + 表头；最多显示到 10 行，超过就滚动
  // （不是「无论如何都占 10 行」，空列表时只占很小一块，节点初始高度才不会虚长）
  const listNeeded = () => (rows.children.length || 0) * LIST_ROW_H + LIST_HEAD_H + 8;
  const listCap = () => Math.max(LIST_BASE_H, Math.round((window.innerHeight || 900) * 0.42));
  const listHeight = () => Math.round(clamp(listNeeded(), LIST_FLOOR_H, listCap()));

  // 画布高度：先给列表留够，再按窗口预算分配，最后才受画布长宽比约束
  const stageHeight = () => {
    const budget = clamp(Math.round((window.innerHeight || 900) * 0.34), 220, 460);
    const natural = Math.round((layoutWidth() * S.height) / Math.max(1, S.width));
    return Math.round(clamp(Math.min(natural, budget), 180, 520));
  };

  // 整块 DOM 界面需要的高度 = 顶部按钮行 + 工具条 + 画布 + 列表（全部是定值，杜绝互相拉扯）
  // chrome 只量顶部两条小按钮行（它们的高度只由文字决定，跟画布/列表无关，量了也不会回路）
  const chromeHeight = () => {
    const heights = [];
    try {
      for (const item of [topBar, head, tableBar]) heights.push(Number(item?.offsetHeight) || 0);
    } catch (_error) {
      // 忽略
    }
    const measured = heights.reduce((sum, value) => sum + value, 0);
    // 量不到（还没挂到 DOM）时按经验值；量到就把间距/内边距一并加足
    return Math.round(measured > 20 ? measured + 38 : 92);
  };
  const domDesiredHeight = () => Math.round(stageHeight() + listHeight() + chromeHeight() + proseHeight() + 8);

  // ComfyUI 两套前端（经典画布 / Nodes 2.0）都读这个高度：
  // 2.0 走 computeLayoutSize / --comfy-widget-min-height，经典画布走 computeSize 与元素自身高度
  // 前端计算这块 DOM 控件高度时会读它自己元素上的 --comfy-widget-* 变量，
  // 而那个容器是 root 的父节点，所以变量要同时写到父节点上才生效
  const domHosts = () => {
    const hosts = [root];
    try {
      if (root.parentElement) hosts.push(root.parentElement);
      const element = state.domWidget?.element;
      if (element && element.style) hosts.push(element);
    } catch (_error) {
      // 忽略
    }
    return hosts;
  };

  const applyDomLayoutSize = () => {
    const height = domDesiredHeight() + "px";
    if (root.style.height !== height) root.style.height = height;
    if (root.style.minHeight !== height) root.style.minHeight = height;
    for (const host of domHosts()) {
      try {
        if (host.style.getPropertyValue("--comfy-widget-min-height") !== height) {
          host.style.setProperty("--comfy-widget-min-height", height);
        }
        if (host.style.getPropertyValue("--comfy-widget-max-height") !== height) {
          host.style.setProperty("--comfy-widget-max-height", height);
        }
      } catch (_error) {
        // 极老的浏览器没有 CSS 变量，忽略
      }
    }
  };

  // 上方那些原生参数控件大约占多高（兜底估算，测不到 offsetTop 时用）
  // proseMode：'actual' 用当前描述框高度；'auto' 用文字需要的高度；'min' 用最小高度
  const widgetStackHeight = (proseMode = "actual") => {
    let sum = 0;
    for (const item of node.widgets || []) {
      if (state.domWidget && item === state.domWidget) continue;
      if (item.hidden) continue;
      // 「整体描述」的高度单独控制
      if (proseWidget && item === proseWidget) {
        sum += proseMode === "min" ? PROSE_MIN : proseMode === "auto" ? proseAutoPx : proseHeight();
        continue;
      }
      let height = 24;
      if (typeof item.computeSize === "function") {
        try {
          const size = item.computeSize();
          const value = Array.isArray(size) ? Number(size[1]) : NaN;
          if (Number.isFinite(value) && value > 0) height = value;
        } catch (_error) {
          // 忽略个别控件算不出尺寸的情况
        }
      }
      // 上限 96：多行文本框在某些前端会被拉成几百像素，绝不能让它反过来把节点撑长
      sum += clamp(height, 18, 96);
    }
    return sum;
  };

  // DOM 控件在整个节点里的起始高度。
  // 一律用「各控件自然高度之和」估算：直接量 offsetTop 会被挤压后的布局带偏，
  // 反而形成「量到得越矮→节点越矮→挤得越狠」的死循环。
  const nativeTop = () => widgetStackHeight() + 46;
  // 「刚好够用」的节点高度：描述框只按文字需要的高度算，不含你额外拉出来的空间
  const baseNodeHeight = () => Math.round(widgetStackHeight("auto") + 46 + domDesiredHeight() + 14);
  const neededNodeHeight = () => baseNodeHeight();

  let fitPending = false;
  // 节点高度完全交给你：插件只在「工作流里还没存过尺寸」时撑一次，之后永不自动改节点高度。
  // 拉高、压回、贴长文、删长文都只影响文本框内部的滚动条，不会再有「拉长了缩不回去」。
  const syncNodeHeight = () => {};
  const fitNode = () => {};

  // 首次加载：如果工作流里没存过尺寸（还是默认的小方块），一次性撑到「刚好够用」；
  // 已经存过自定义尺寸就保持原样——你调过的尺寸下次打开还在
  const fitNodeInitial = () => {
    if (!node.setSize) return;
    const need = Math.round(neededNodeHeight());
    const current = node.size || [980, need];
    const width0 = Math.round(current[0] || 0);
    const height0 = Math.round(current[1] || 0);
    const isDefault = !width0 || !height0 || width0 < 480 || height0 < 320;
    if (!isDefault) return;
    const width = Math.max(980, width0 || 980);
    const height = Math.max(need, 560);
    if (width !== width0 || height !== height0) {
      node.setSize([width, height]);
    }
  };

  const layout = () => {
    // 先按当前文本估一下描述框该多高（MIN~MAX），再排全景
    syncProseAuto();
    // 描述框高度：只跟节点高度走（拉高节点就变高，压回就变矮）
    applyProseHeight();
    // 画布高度：定值，不依赖容器
    const height = stageHeight() + "px";
    if (stage.style.height !== height) stage.style.height = height;
    // 列表：至少 10 行；行多了在列表内部滚动，表头固定
    const minH = listHeight() + "px";
    if (scroll.style.minHeight !== minH) scroll.style.minHeight = minH;
    if (scroll.style.maxHeight !== minH) scroll.style.maxHeight = minH;
    applyDomLayoutSize();
    fitNode();
    state.layoutReady = true;
    paint();
  };

  // ---------------------------------------------------------------- drawing
  function paint() {
    if (!ctx) return;
    const g = geo();
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(g.cw * dpr));
    const bh = Math.max(1, Math.round(g.ch * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.cw, g.ch);

    ctx.fillStyle = "#111218";
    ctx.fillRect(0, 0, g.cw, g.ch);

    const left = g.ox;
    const top = g.oy;
    const cw = S.width * g.scale;
    const chh = S.height * g.scale;

    // 画布区域
    ctx.fillStyle = "#0b0c10";
    ctx.fillRect(left, top, cw, chh);

    // 背景图：列表越靠上越上层，所以倒着画
    const bgs = S.bgs.filter(Boolean);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, cw, chh);
    ctx.clip();
    for (let i = bgs.length - 1; i >= 0; i -= 1) {
      const bg = bgs[i];
      if (!bg.image || bg.hidden) continue;
      drawBackground(ctx, bg, g, left, top, String(wFit?.value ?? "锁比例"), false);
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, cw, chh);
    ctx.clip();

    if (state.axes !== false) drawThirds(ctx, g, left, top, cw, chh);
    if (state.hDivOn) drawDivisors(ctx, "h", state.hDiv, left, top, cw, chh, state.hDivColor);
    if (state.vDivOn) drawDivisors(ctx, "v", state.vDiv, left, top, cw, chh, state.vDivColor);
    if (state.grid !== false) drawGrid(ctx, g, left, top, cw, chh);
    if (state.axes !== false) drawAxes(ctx, g, left, top, cw, chh);
    

    // 框：列表越靠上 = 越上层，所以从后往前画
    for (let i = S.boxes.length - 1; i >= 0; i -= 1) {
      drawBox(ctx, S.boxes[i], i, g, left, top);
    }

    // 选中的背景图描边（背景图在框下面，选中框仍然画在最上面）
    for (const bg of bgs) {
      if (!S.selected.has(bg) || bg.hidden) continue;
      const bx = left + bg.x * g.scale;
      const by = top + bg.y * g.scale;
      const bwid = bg.w * g.scale;
      const bhei = bg.h * g.scale;
      ctx.save();
      ctx.strokeStyle = BG_COLOR;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(bx + 1, by + 1, Math.max(1, bwid - 2), Math.max(1, bhei - 2));
      ctx.restore();
      drawHandles(ctx, bg, g, left, top);
    }

    ctx.restore();

    // 画布边框
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, cw - 1, chh - 1);
  }

  function drawBackground(c, bg, g, left, top, fit, dim = true) {
    const bx = left + bg.x * g.scale;
    const by = top + bg.y * g.scale;
    const bwid = bg.w * g.scale;
    const bhei = bg.h * g.scale;
    c.save();
    c.beginPath();
    c.rect(bx, by, bwid, bhei);
    c.clip();
    drawFitted(c, bg.image, bx, by, bwid, bhei, fit);
    c.restore();
    if (dim) {
      c.fillStyle = "rgba(0,0,0,0.38)";
      c.fillRect(bx, by, bwid, bhei);
    }
  }

  function drawFitted(c, image, x, y, w, h, fit) {
    const iw = image.naturalWidth || image.width || 1;
    const ih = image.naturalHeight || image.height || 1;
    if (fit === "填充") {
      c.drawImage(image, x, y, w, h);
      return;
    }
    if (fit === "锁比例") {
      // 矩形本身已按原图比例缩放，这里按 contain 绘制，任何情况下都不拉变形
      const scale0 = Math.min(w / iw, h / ih);
      c.drawImage(image, x + (w - iw * scale0) / 2, y + (h - ih * scale0) / 2, iw * scale0, ih * scale0);
      return;
    }
    if (fit === "裁切") {
      const scale = Math.max(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      c.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      return;
    }
    const scale = Math.min(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    c.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function drawGrid(c, g, left, top, cw, chh) {
    // 网格：先按 16 画线；画得太密就自动抽稀，保证任何缩放级别都能看清
    let lineStep = GRID;
    while (lineStep * g.scale < 7) lineStep *= 2;
    // 点阵：点间距至少 6 个屏幕像素，否则抽稀（永远是 16 的整数倍）
    let dotStep = GRID;
    while (dotStep * g.scale < 6) dotStep *= 2;

    c.save();
    c.beginPath();
    c.rect(left, top, cw, chh);
    c.clip();

    c.strokeStyle = "rgba(255,255,255,0.08)";
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= S.width; x += lineStep) {
      const px = Math.round(left + x * g.scale) + 0.5;
      c.moveTo(px, top);
      c.lineTo(px, top + chh);
    }
    for (let y = 0; y <= S.height; y += lineStep) {
      const py = Math.round(top + y * g.scale) + 0.5;
      c.moveTo(left, py);
      c.lineTo(left + cw, py);
    }
    c.stroke();

    // 16 像素点阵
    c.fillStyle = "rgba(255,255,255,0.3)";
    for (let x = 0; x <= S.width; x += dotStep) {
      const px = Math.round(left + x * g.scale);
      for (let y = 0; y <= S.height; y += dotStep) {
        c.fillRect(px, Math.round(top + y * g.scale), 1, 1);
      }
    }
    c.restore();
  }

  // 三分线：构图参考，不影响提示词
  function drawThirds(c, g, left, top, cw, chh) {
    c.save();
    c.beginPath();
    c.rect(left, top, cw, chh);
    c.clip();
    c.strokeStyle = "rgba(255,214,102,0.22)";
    c.lineWidth = 1;
    c.setLineDash([6, 5]);
    c.beginPath();
    for (const ratio of [1 / 3, 2 / 3]) {
      const px = Math.round(left + cw * ratio) + 0.5;
      const py = Math.round(top + chh * ratio) + 0.5;
      c.moveTo(px, top);
      c.lineTo(px, top + chh);
      c.moveTo(left, py);
      c.lineTo(left + cw, py);
    }
    c.stroke();
    c.restore();
  }

  // 自定义等分线：dir="h" 画横向线（把高度等分），dir="v" 画竖向线
  function drawDivisors(c, dir, count, left, top, cw, chh, color) {
    const n = Math.max(2, Math.round(Number(count) || 2));
    c.save();
    c.beginPath();
    c.rect(left, top, cw, chh);
    c.clip();
    c.strokeStyle = color || "#ff8a8a";
    c.lineWidth = 1;
    c.setLineDash([]);
    c.beginPath();
    for (let i = 1; i < n; i += 1) {
      const ratio = i / n;
      if (dir === "h") {
        const py = Math.round(top + chh * ratio) + 0.5;
        c.moveTo(left, py);
        c.lineTo(left + cw, py);
      } else {
        const px = Math.round(left + cw * ratio) + 0.5;
        c.moveTo(px, top);
        c.lineTo(px, top + chh);
      }
    }
    c.stroke();
    c.restore();
  }

  function niceStep(total) {
    const steps = [16, 32, 64, 128, 256, 512, 1024, 2048];
    const g = geo();
    for (const step of steps) {
      if (step * g.scale >= 44) return step;
    }
    return steps[steps.length - 1];
  }

  function drawAxes(c, g, left, top, cw, chh) {
    // 左下角为原点：x 向右、y 向上
    const step = niceStep(Math.max(S.width, S.height));
    c.save();
    c.beginPath();
    c.rect(left, top, cw, chh);
    c.clip();
    c.strokeStyle = "rgba(120,190,255,0.5)";
    c.fillStyle = "rgba(150,200,255,0.85)";
    c.lineWidth = 1;
    c.font = "10px ui-monospace, monospace";
    c.textBaseline = "bottom";
    c.beginPath();
    c.moveTo(left + 0.5, top);
    c.lineTo(left + 0.5, top + chh - 0.5);
    c.lineTo(left + cw, top + chh - 0.5);
    c.stroke();
    c.textAlign = "center";
    for (let x = 0; x <= S.width; x += step) {
      const px = left + x * g.scale;
      c.beginPath();
      c.moveTo(Math.round(px) + 0.5, top + chh - 1);
      c.lineTo(Math.round(px) + 0.5, top + chh - 5);
      c.stroke();
      c.fillText(String(x), clamp(px, left + 12, left + cw - 12), top + chh - 6);
    }
    c.textAlign = "left";
    c.textBaseline = "middle";
    for (let y = 0; y <= S.height; y += step) {
      const py = top + chh - y * g.scale;
      c.beginPath();
      c.moveTo(left + 1, Math.round(py) + 0.5);
      c.lineTo(left + 5, Math.round(py) + 0.5);
      c.stroke();
      // 原点只留 x 轴那一个 0，避免左下角出现两个 0
      if (y !== 0) c.fillText(String(y), left + 6, clamp(py, top + 8, top + chh - 8));
    }
    c.restore();
  }

  function drawBox(c, box, index, g, left, top) {
    const x = left + box.x * g.scale;
    const y = top + box.y * g.scale;
    const w = Math.max(1, box.w * g.scale);
    const h = Math.max(1, box.h * g.scale);
    const color = itemColor(box);
    const selected = S.selected.has(box);

    if (box.hidden) {
      c.save();
      c.setLineDash([4, 3]);
      c.strokeStyle = "rgba(160,160,170,0.5)";
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      c.restore();
      return;
    }

    c.fillStyle = rgba(color, selected ? 0.2 : 0.12);
    c.fillRect(x, y, w, h);
    c.strokeStyle = color;
    c.lineWidth = selected ? 2 : 1;
    c.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));

    // 编号标签
    const label = String(index + 1).padStart(2, "0");
    c.font = "600 10px ui-monospace, monospace";
    const lw = c.measureText(label).width + 8;
    c.fillStyle = color;
    c.fillRect(x, y, lw, 14);
    c.fillStyle = "#0d0e12";
    c.textBaseline = "middle";
    c.fillText(label, x + 4, y + 7.5);

    // 框内文字 / 描述：字号跟着框在屏幕上的大小走，缩放节点时不会挤成一团
    const lines = [];
    if (box.type === TYPE_TEXT && box.text) lines.push(box.text);
    if (box.desc) lines.push(box.desc);
    if (lines.length) {
      const fontSize = Math.round(clamp(Math.min(w, h) * 0.32, 9, 14));
      const lineHeight = fontSize + 3;
      c.save();
      c.beginPath();
      c.rect(x + 2, y + 16, Math.max(1, w - 4), Math.max(1, h - 18));
      c.clip();
      c.fillStyle = "rgba(240,240,245,0.92)";
      c.font = `${fontSize}px system-ui, sans-serif`;
      c.textBaseline = "top";
      let ty = y + 18;
      for (const line of lines) {
        const text = String(line);
        let rest = text;
        while (rest && ty < y + h - 2) {
          let cut = rest.length;
          while (cut > 1 && c.measureText(rest.slice(0, cut)).width > w - 8) cut -= 1;
          c.fillText(rest.slice(0, cut), x + 4, ty);
          rest = rest.slice(cut);
          ty += lineHeight;
        }
      }
      c.restore();
    }

    // 主色条
    const palette = Array.isArray(box.palette) ? box.palette.filter((v) => css3(v)) : [];
    if (palette.length) {
      const bar = w / palette.length;
      palette.forEach((hex, i) => {
        c.fillStyle = css3(hex);
        c.fillRect(x + i * bar, y, Math.ceil(bar), 3);
      });
    }

    if (selected) drawHandles(c, box, g, left, top);
  }

  function drawHandles(c, item, g, left, top) {
    const x = left + item.x * g.scale;
    const y = top + item.y * g.scale;
    const w = Math.max(1, item.w * g.scale);
    const h = Math.max(1, item.h * g.scale);
    c.save();
    c.fillStyle = "#ffffff";
    c.strokeStyle = "#3f78ff";
    c.lineWidth = 1;
    const size = HANDLE_SIZE;
    for (const handle of HANDLES) {
      const hx = x + w * handle.fx - size / 2;
      const hy = y + h * handle.fy - size / 2;
      c.fillRect(hx, hy, size, size);
      c.strokeRect(hx + 0.5, hy + 0.5, size - 1, size - 1);
    }
    c.restore();
  }

  // ---------------------------------------------------------------- hit test
  const itemsInZOrder = () => [...S.boxes, ...S.bgs.filter(Boolean)];

  const hitTest = (point) => {
    for (const item of itemsInZOrder()) {
      if (item.hidden) continue;
      if (point.x >= item.x && point.x <= item.x + item.w
        && point.y >= item.y && point.y <= item.y + item.h) {
        return item;
      }
    }
    return null;
  };

  const handleHit = (item, point) => {
    const tol = Math.min(HANDLE_TOL / geo().scale, Math.max(3, Math.min(item.w, item.h) * 0.25));
    const right = item.x + item.w;
    const bottom = item.y + item.h;
    // 角优先于边，避免小框上「角」被「边」抢走
    for (const handle of HANDLES) {
      const hx = item.x + item.w * handle.fx;
      const hy = item.y + item.h * handle.fy;
      if (Math.abs(point.x - hx) <= tol && Math.abs(point.y - hy) <= tol) return handle.dir;
    }
    // 框太小时退化为「贴着某条边就算」，但必须落在该边的线段范围内，
    // 否则在框外很远的地方（同一水平/垂直线上）也会被误判成点到了手柄
    const insideX = point.x >= item.x - tol && point.x <= right + tol;
    const insideY = point.y >= item.y - tol && point.y <= bottom + tol;
    if (insideX && Math.abs(point.y - item.y) <= tol) return "n";
    if (insideX && Math.abs(point.y - bottom) <= tol) return "s";
    if (insideY && Math.abs(point.x - item.x) <= tol) return "w";
    if (insideY && Math.abs(point.x - right) <= tol) return "e";
    return null;
  };

  // ---------------------------------------------------------------- editing
  const beginEdit = (item) => {
    commitEdit();
    const box = item;
    const g = geo();
    const theCanvas = canvas.getBoundingClientRect();
    const theStage = stage.getBoundingClientRect();
    const ta = el("textarea", "yx-edit");
    ta.value = box.type === TYPE_TEXT ? (box.text || "") : (box.desc || "");
    ta.placeholder = box.type === TYPE_TEXT ? "框内文字…" : "描述…";
    ta.style.fontSize = "11px";
    // 用「画布矩形 + 居中留白」算绝对位置，输入框就会正好压在框上
    ta.style.left = (theCanvas.left - theStage.left) + g.ox + box.x * g.scale + "px";
    ta.style.top = (theCanvas.top - theStage.top) + g.oy + box.y * g.scale + "px";
    ta.style.width = Math.max(24, box.w * g.scale) + "px";
    ta.style.height = Math.max(20, box.h * g.scale) + "px";
    ta.style.borderColor = itemColor(box);
    stage.appendChild(ta);
    state.editing = { item: box, ta };
    S.selected.clear();
    S.selected.add(box);
    syncRows();
    paint();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener("pointerdown", (event) => event.stopPropagation());
    ta.addEventListener("input", () => {
      if (box.type === TYPE_TEXT) box.text = ta.value;
      else box.desc = ta.value;
      syncRows();
      commit();
      paint();
    });
    ta.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        commitEdit();
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        commitEdit();
      }
      event.stopPropagation();
    });
  };

  const commitEdit = () => {
    const editing = state.editing;
    if (!editing) return;
    state.editing = null;
    editing.ta.remove();
    syncRows();
    commit();
  };

  // ---------------------------------------------------------------- pointer
  const startCreate = (point) => {
    const start = { x: snap(point.x), y: snap(point.y) };
    const box = newBox(state.activeType, clamp(start.x, 0, S.width - MIN_BOX), clamp(start.y, 0, S.height - MIN_BOX), 0, 0);
    box.x = clamp(start.x, 0, S.width - MIN_BOX);
    box.y = clamp(start.y, 0, S.height - MIN_BOX);
    box.w = 0;
    box.h = 0;
    state.pending = box;
    state.drag = { kind: "create", item: box, start: point, created: false };
    paint();
  };

  const pointerDown = (event) => {
    if (event.button === 2) {
      // 右键按下：先记下来，拖动超过 4px 才算「平移画布」；没拖动就是普通右键菜单
      state.panDrag = {
        sx: event.clientX,
        sy: event.clientY,
        px: state.panX || 0,
        py: state.panY || 0,
        moved: false,
      };
      canvas.setPointerCapture?.(event.pointerId);
      state.panPointer = event.pointerId;
      return;
    }
    if (event.button !== 0) return;
    if (state.editing) commitEdit();
    const point = eventPoint(event);
    const g = geo();

    // 「只画框」打开，或按住 Shift / Alt：跳过所有选中与拖动，直接在按下处开一个新框
    if (state.drawOnly || event.shiftKey || event.altKey) {
      startCreate(point);
      capture(event);
      return;
    }

    // 1) 手柄：只对「已选中」的对象生效（未选中的对象不参与，避免点到附近就被选中）
    for (const item of itemsInZOrder()) {
      if (item.hidden) continue;
      if (item.lockedCanvas) continue;
      if (!S.selected.has(item)) continue;
      const handle = handleHit(item, point);
      if (handle) {
        state.drag = { kind: "resize", item, handle, start: point, rect: { ...item } };
        capture(event);
        return;
      }
    }

    // 2) 命中某个框 / 背景图
    let hit = hitTest(point);
    if (hit && hit.isBg) {
      if (hit.lockedCanvas) {
        // 已经当画布用的背景图：整块让给画框，不能被选中 / 拖动
        hit = null;
      } else if (!S.selected.has(hit)) {
        // 普通背景图：只有贴着边缘的一圈算「选中它」，内部让给画框
        const band = Math.max(4, 10 / g.scale);
        const inBand = point.x <= hit.x + band
          || point.x >= hit.x + hit.w - band
          || point.y <= hit.y + band
          || point.y >= hit.y + hit.h - band;
        if (!inBand) hit = null;
      }
    }
    if (hit) {
      const wasSelected = S.selected.has(hit);
      if (!wasSelected) {
        if (!state.multi) S.selected.clear(); // 没开多选：只留这一个
        S.selected.add(hit);
        syncRows();
        paint();
      }
      const moving = [...S.selected].filter((item) => !item.hidden && !item.lockedCanvas);
      state.drag = {
        kind: "move",
        item: hit,
        start: point,
        origin: new Map(moving.map((item) => [item, { x: item.x, y: item.y }])),
        // 再点一下（不拖动）＝取消选中，与多选开关无关
        clickCandidate: wasSelected ? hit : null,
        moved: false,
      };
      capture(event);
      return;
    }

    // 3) 空白处：画新框
    startCreate(point);
    capture(event);
  };

  const capture = (event) => {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (_error) {
      /* 忽略：不支持指针捕获时退化为 document 监听 */
    }
  };

  const pointerMove = (event) => {
    const drag = state.drag;
    if (!drag) return;
    const point = eventPoint(event);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;

    if (drag.kind === "create") {
      const sx0 = clamp(snap(drag.start.x), 0, S.width);
      const sy0 = clamp(snap(drag.start.y), 0, S.height);
      const ex = clamp(snap(point.x), 0, S.width);
      const ey = clamp(snap(point.y), 0, S.height);
      const left = Math.min(sx0, ex);
      const top = Math.min(sy0, ey);
      const rect = {
        x: left,
        y: top,
        w: Math.max(0, Math.max(sx0, ex) - left),
        h: Math.max(0, Math.max(sy0, ey) - top),
      };
      if (!drag.created && (rect.w >= MIN_BOX || rect.h >= MIN_BOX)) {
        const candidate = newBox(state.activeType, rect.x, rect.y,
          Math.max(MIN_BOX, rect.w), Math.max(MIN_BOX, rect.h));
        clampBox(candidate);
        S.boxes.unshift(candidate);
        S.selected.clear();
        S.selected.add(candidate);
        state.pending = null;
        drag.created = true;
        drag.item = candidate;
        refreshRows();
      } else if (drag.created) {
        const item = drag.item;
        item.x = rect.x;
        item.y = rect.y;
        item.w = Math.max(MIN_BOX, rect.w);
        item.h = Math.max(MIN_BOX, rect.h);
        clampBox(item);
        syncRows();
      }
      paint();
      return;
    }

    if (drag.kind === "move") {
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) drag.moved = true;
      for (const [item, origin] of drag.origin) {
        if (!item.lock?.x) item.x = origin.x + dx;
        if (!item.lock?.y) item.y = origin.y + dy;
        clampItem(item);
      }
      syncRows();
      paint();
      return;
    }

    if (drag.kind === "resize") {
      const item = drag.item;
      const rect = drag.rect;
      const dir = drag.handle || "se";
      const lock = item.lock || {};
      // 允许负坐标（背景图可以伸出画布），所以不能直接用 snap()
      const snapEdge = (value) => Math.round(value / GRID) * GRID;
      let left = rect.x;
      let top = rect.y;
      let right = rect.x + rect.w;
      let bottom = rect.y + rect.h;

      if (!lock.w) {
        if (WEST_DIRS.has(dir) && !lock.x) left = snapEdge(rect.x + dx);
        if (EAST_DIRS.has(dir)) right = snapEdge(rect.x + rect.w + dx);
      }
      if (!lock.h) {
        if (NORTH_DIRS.has(dir) && !lock.y) top = snapEdge(rect.y + dy);
        if (SOUTH_DIRS.has(dir)) bottom = snapEdge(rect.y + rect.h + dy);
      }

      let w = right - left;
      let h = bottom - top;

      // 背景图填充方式 = 锁比例：拖任意控制点都保持原图长宽比。
      // 拖动过程中用未吸附的原始位移（跟手），松手时再吸到 16 的整数倍。
      if (ratioLockEnabled(item)) {
        const ratio = bgRatio(item);
        const horizontal = WEST_DIRS.has(dir) || EAST_DIRS.has(dir);
        const vertical = NORTH_DIRS.has(dir) || SOUTH_DIRS.has(dir);
        // 方向在第一次移动时定死，避免拖动中途两个方向来回抢导致「卡顿、不跟手」
        if (!drag.axis) {
          const relX = Math.abs(dx) / Math.max(1, rect.w);
          const relY = Math.abs(dy) / Math.max(1, rect.h);
          drag.axis = horizontal && (!vertical || relX >= relY) ? "w" : "h";
        }
        const dw = EAST_DIRS.has(dir) ? dx : -dx; // 正数＝变宽
        const dh = SOUTH_DIRS.has(dir) ? dy : -dy; // 正数＝变高
        let nw;
        let nh;
        if (lock.w && lock.h) {
          nw = rect.w;
          nh = rect.h;
        } else if (lock.w) {
          nw = rect.w;
          nh = nw / ratio;
        } else if (lock.h) {
          nh = rect.h;
          nw = nh * ratio;
        } else if (drag.axis === "h") {
          nh = clamp(rect.h + dh, MIN_BOX, MAX_SIZE);
          nw = nh * ratio;
        } else {
          nw = clamp(rect.w + dw, MIN_BOX, MAX_SIZE);
          nh = nw / ratio;
        }
        nw = Math.round(clamp(nw, MIN_BOX, MAX_SIZE));
        nh = Math.round(clamp(nh, MIN_BOX, MAX_SIZE));
        // 固定对面那条边（角/边都是），另一方向保持原位
        const nx = WEST_DIRS.has(dir) ? (rect.x + rect.w) - nw
          : EAST_DIRS.has(dir) ? rect.x
            : rect.x + (rect.w - nw) / 2;
        const ny = NORTH_DIRS.has(dir) ? (rect.y + rect.h) - nh
          : SOUTH_DIRS.has(dir) ? rect.y
            : rect.y + (rect.h - nh) / 2;
        item.w = nw;
        item.h = nh;
        if (!lock.x) item.x = nx;
        if (!lock.y) item.y = ny;
        clampItem(item);
        syncRows();
        paint();
        return;
      }

      if (w < MIN_BOX) {
        w = MIN_BOX;
        if (WEST_DIRS.has(dir)) left = right - w;
        else right = left + w;
      }
      if (h < MIN_BOX) {
        h = MIN_BOX;
        if (NORTH_DIRS.has(dir)) top = bottom - h;
        else bottom = top + h;
      }

      if (!lock.w) item.w = clamp(w, MIN_BOX, MAX_SIZE);
      if (!lock.h) item.h = clamp(h, MIN_BOX, MAX_SIZE);
      if (!lock.x) item.x = WEST_DIRS.has(dir) ? left : rect.x;
      if (!lock.y) item.y = NORTH_DIRS.has(dir) ? top : rect.y;

      clampItem(item);
      syncRows();
      paint();
      return;
    }
  };

  const pointerUp = () => {
    if (state.panDrag) {
      const moved = state.panDrag.moved;
      state.panDrag = null;
      try { canvas.releasePointerCapture?.(state.panPointer); } catch (error) { /* 忽略 */ }
      state.panPointer = null;
      // 拖动过就在紧接着的 contextmenu 事件里吃掉菜单；没拖动照常弹菜单
      state.skipMenu = moved;
      canvas.style.cursor = "crosshair";
      if (moved) paint();
      return;
    }
    const drag = state.drag;
    if (!drag) return;
    state.drag = null;
    if (drag.kind === "create") {
      const box = drag.item;
      if (!drag.created || box.w < MIN_BOX || box.h < MIN_BOX) {
        // 只是点了一下空白：理解为「取消所有选中」，方便随后在背景图上直接画框
        if (!drag.created) {
          S.selected.clear();
          syncRows();
        }
        if (drag.created) {
          S.boxes = S.boxes.filter((item) => item !== box);
          S.selected.delete(box);
          refreshRows();
        }
      } else {
        clampBox(box);
        S.selected.clear();
        S.selected.add(box);
        refreshRows();
        commit();
      }
      paint();
      return;
    }
    if (drag.kind === "move" && drag.clickCandidate && !drag.moved) {
      S.selected.delete(drag.clickCandidate);
      syncRows();
      paint();
      return;
    }
    if (drag.kind === "resize" && ratioLockEnabled(drag.item)) {
      // 松手时把尺寸吸到 16 的整数倍（拖动过程中不吸，才跟手），长宽比保持不变
      const item = drag.item;
      const dir = drag.handle || "";
      if (!item.lock?.w && !item.lock?.h) {
        const ratio = bgRatio(item);
        const wSnap = Math.max(GRID, Math.round(item.w / GRID) * GRID);
        const hSnap = Math.max(1, Math.round(wSnap / ratio));
        if (WEST_DIRS.has(dir)) item.x += item.w - wSnap;
        if (NORTH_DIRS.has(dir)) item.y += item.h - hSnap;
        item.w = wSnap;
        item.h = hSnap;
        clampItem(item);
        syncRows();
        paint();
      }
    }
    commit();
  };

  const pointerCancel = () => {
    state.drag = null;
    state.pending = null;
    paint();
  };

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pointerDown(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (state.panDrag) {
      const pan = state.panDrag;
      const dx = event.clientX - pan.sx;
      const dy = event.clientY - pan.sy;
      if (!pan.moved && Math.hypot(dx, dy) < 4) return;
      pan.moved = true;
      if ((state.zoom || 1) <= 1.0005) {
        // 100% 时画布正好铺满，没有可平移的空间
        canvas.style.cursor = "crosshair";
        return;
      }
      state.panX = pan.px + dx;
      state.panY = pan.py + dy;
      canvas.style.cursor = "grabbing";
      paint();
      syncZoomBadge();
      return;
    }
    if (!state.drag) {
      if (state.drawOnly) {
        // 只画框：画布上一律十字，不给选中/缩放光标
        canvas.style.cursor = "crosshair";
        return;
      }
      // 悬停反馈：未选中任何东西时是画框十字；选中对象的控制点显示缩放光标，
      // 选中对象内部显示移动箭头
      const point = eventPoint(event);
      let cursor = "crosshair";
      for (const item of itemsInZOrder()) {
        if (item.hidden) continue;
        if (S.selected.has(item)) {
          const dir = handleHit(item, point);
          if (dir) {
            cursor = HANDLE_CURSOR[dir] || "crosshair";
            break;
          }
        }
        if (point.x >= item.x && point.x <= item.x + item.w
          && point.y >= item.y && point.y <= item.y + item.h) {
          if (S.selected.has(item) && !item.lockedCanvas) cursor = "move";
          break;
        }
      }
      canvas.style.cursor = cursor;
      return;
    }
    // 拖动中：画框保持十字，移动/缩放用对应光标
    const drag = state.drag;
    if (drag.kind === "create") canvas.style.cursor = "crosshair";
    else if (drag.kind === "move") canvas.style.cursor = "move";
    else if (drag.kind === "resize") canvas.style.cursor = HANDLE_CURSOR[drag.handle] || "crosshair";
    event.preventDefault();
    pointerMove(event);
  });
  canvas.addEventListener("pointerup", (event) => {
    event.preventDefault();
    pointerUp(event);
  });
  canvas.addEventListener("pointercancel", pointerCancel);
  canvas.addEventListener("lostpointercapture", () => {
    if (state.drag) pointerUp();
    if (state.panDrag) pointerUp();
  });

  // 画布缩放角标（只有缩放/平移过才出现，点一下复位）
  const zoomBadge = el("button", "yx-zoombadge", "缩放 100%");
  zoomBadge.type = "button";
  zoomBadge.style.display = "none";
  zoomBadge.title = "点击复原：100%、回到居中";
  zoomBadge.addEventListener("pointerdown", (event) => event.stopPropagation());
  zoomBadge.addEventListener("click", (event) => {
    event.stopPropagation();
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    paint();
  });
  if (stage.appendChild) stage.appendChild(zoomBadge);

  const syncZoomBadge = () => {
    const zoom = state.zoom || 1;
    const offset = Math.abs(state.panX || 0) > 1 || Math.abs(state.panY || 0) > 1;
    const active = Math.abs(zoom - 1) > 0.001 || offset;
    if (zoomBadge.style) {
      zoomBadge.style.display = active ? "block" : "none";
      zoomBadge.textContent = `缩放 ${Math.round(zoom * 100)}%`;
    }
  };

  // 滚轮缩放：以鼠标位置为中心，只改显示不动数据
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.editing) commitEdit();
    const g = geo();
    const px = event.clientX - g.rect.left;
    const py = event.clientY - g.rect.top;
    const cx = (px - g.ox) / g.scale;
    const cy = (py - g.oy) / g.scale;
    const factor = Math.exp(-event.deltaY * 0.0018);
    const zoom = clamp((state.zoom || 1) * factor, 1, 8);
    if (Math.abs(zoom - (state.zoom || 1)) < 0.0005) return;
    state.zoom = zoom;
    if (zoom <= 1.0005) {
      // 最小就是 100%（居中）：不再缩小，也不再保留平移
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      paint();
      syncZoomBadge();
      return;
    }
    const scale = g.fit * zoom;
    const limit = Math.max(g.cw, g.ch) * 2;
    state.panX = clamp(px - cx * scale - (g.cw - S.width * scale) / 2, -limit, limit);
    state.panY = clamp(py - cy * scale - (g.ch - S.height * scale) / 2, -limit, limit);
    paint();
    syncZoomBadge();
  }, { passive: false });
  canvas.addEventListener("dblclick", (event) => {
    event.preventDefault();
    if (state.drawOnly) return; // 只画框模式：双击不进入文字编辑
    const point = eventPoint(event);
    for (const item of itemsInZOrder()) {
      if (item.hidden) continue;
      if (point.x >= item.x && point.x <= item.x + item.w
        && point.y >= item.y && point.y <= item.y + item.h) {
        if (item.isBg) {
          // 双击背景图（没有被别的框 / 背景图盖住的地方）＝选中它
          if (!item.lockedCanvas) {
            if (!state.multi) S.selected.clear();
            S.selected.add(item);
            syncRows();
            paint();
          }
        } else {
          beginEdit(item);
        }
        return;
      }
    }
  });

  // 点画布外任何位置都退出框内输入
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!state.editing) return;
      if (event.target === state.editing.ta) return;
      commitEdit();
    },
    true,
  );

  // ---------------------------------------------------------------- background inputs
  const ensureBgInputs = () => {
    const inputs = node.inputs || [];
    const bgInputs = inputs.filter((slot) => bgSlotIndex(slot.name) >= 0);
    let connected = 0;
    while (connected < MAX_BG) {
      const name = bgSlotName(connected);
      const slot = bgInputs.find((item) => item.name === name);
      if (!slot || slot.link == null) break;
      connected += 1;
    }
    if (connected < MAX_BG) {
      const name = bgSlotName(connected);
      if (!bgInputs.some((item) => item.name === name)) {
        node.addInput(name, "IMAGE");
      }
    }
    // 删掉多出来的空位（只保留一个空位）
    for (const slot of node.inputs || []) {
      const index = bgSlotIndex(slot.name);
      if (index < 0) continue;
      if (index > connected && slot.link == null) {
        const at = node.inputs.indexOf(slot);
        if (at >= 0) node.removeInput(at);
      }
    }
  };

  const imageURL = (info) => {
    if (!info) return null;
    if (typeof info === "string") return info;
    if (!info.filename) return null;
    const params = new URLSearchParams({
      filename: info.filename,
      subfolder: info.subfolder || "",
      type: info.type || "temp",
    });
    return `/view?${params.toString()}`;
  };

  // LiteGraph 里 input.link 是「连线 id（数字）」，连线对象在 graph.links[id]；
  // 某些新版前端直接把连线对象挂在 input.link 上，所以两种都兼容
  const linkOriginId = (slot) => {
    const link = slot?.link;
    if (link == null) return null;
    if (typeof link === "object") {
      const id = Number(link.origin_id);
      return Number.isFinite(id) ? id : null;
    }
    const graph = node.graph || app.graph;
    const table = graph?.links || graph?._links;
    let record = null;
    if (Array.isArray(table)) record = table[link] ?? null;
    else if (table && typeof table.get === "function") record = table.get(link) || null;
    else if (table && typeof table === "object") record = table[link] || null;
    if (!record) record = graph?.getLink?.(link) || null;
    const id = Number(record?.origin_id);
    return Number.isFinite(id) ? id : null;
  };

  const upstreamImageURL = (slotIndex) => {
    const slot = (node.inputs || []).find((item) => bgSlotIndex(item.name) === slotIndex);
    if (!slot || slot.link == null) return null;
    const originId = linkOriginId(slot);
    // 1) 上游执行结果（ComfyUI 把上一次执行的可视化结果挂在 app.nodeOutputs）
    const output = originId == null ? null : app.nodeOutputs?.[originId];
    const pool = output?.images || output?.gifs || [];
    if (Array.isArray(pool)) {
      for (const info of pool) {
        const url = imageURL(info);
        if (url) return url;
      }
    }
    // 2) 上游节点的缩略图（LoadImage 之类会把图挂到 node.imgs）
    const origin = originId == null ? null : (node.graph || app.graph)?.getNodeById?.(originId);
    const imgs = origin?.imgs || origin?.images || [];
    for (const info of imgs) {
      const url = imageURL(info);
      if (url) return url;
    }
    // 3) 上游是「加载图像 / LoadImage」这类节点：直接读它的图像参数拼地址，
    //    不用等执行一次也能立刻显示
    const widgets = origin?.widgets || [];
    for (const widget of widgets) {
      const name = String(widget?.name || "").toLowerCase();
      if (!["image", "图像", "图片", "filename"].includes(name)) continue;
      const value = typeof widget.value === "string" ? widget.value.trim() : "";
      if (!value) continue;
      const match = value.match(/^(.*?)\s*\[([^\]]+)\]$/);
      const filename = match ? match[1] : value;
      const type = match ? match[2] : "input";
      return imageURL({ filename, subfolder: widget.subfolder || "", type });
    }
    return null;
  };

  const loadImage = (url) => new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });

  const ensureBgEntry = (slotIndex) => {
    let bg = S.bgs.find((item) => item && item.slot === slotIndex);
    if (!bg) {
      bg = {
        slot: slotIndex,
        image: null,
        natW: 0,
        natH: 0,
        x: 0, y: 0,
        w: S.width, h: S.height,
        hidden: false,
        desc: "",
        lock: emptyLocks(["w", "h", "x", "y", "desc"]),
        isBg: true,
        label: `B${slotIndex + 1}`,
      };
      S.bgs.push(bg);
    }
    return bg;
  };

  // 第一次接上图片时的初始矩形：保持原图长宽比，缩到刚好填满画布的一条边，
  // 不超出画布，并让左下角对齐画布原点（x=0、左下角 y=0）
  const placeInitial = (bg) => {
    const natW = Number(bg.natW) || 0;
    const natH = Number(bg.natH) || 0;
    if (natW <= 0 || natH <= 0) {
      bg.x = 0;
      bg.y = 0;
      bg.w = S.width;
      bg.h = S.height;
      return;
    }
    const s = Math.min(S.width / natW, S.height / natH) || 1;
    let w = Math.max(1, Math.round(natW * s));
    let h = Math.max(1, Math.round(natH * s));
    // 取整后可能各多出 1 像素，夹回画布内
    w = Math.min(S.width, w);
    h = Math.min(S.height, h);
    bg.w = w;
    bg.h = h;
    bg.x = 0;
    bg.y = S.height - h; // 内部坐标以画布顶部为 0，对齐左下角
  };

  const attachBackground = async (slotIndex, force = false) => {
    const url = upstreamImageURL(slotIndex);
    if (!url) return;
    const bg = ensureBgEntry(slotIndex);
    if (!force && bg.url === url && bg.image) return;
    const image = await loadImage(url);
    if (!image) return;
    const first = !bg.image;
    bg.image = image;
    bg.url = url;
    bg.natW = image.naturalWidth || image.width || 0;
    bg.natH = image.naturalHeight || image.height || 0;
    if (first) placeInitial(bg);
    refreshRows();
    layout();
    commit();
  };

  const syncBackgrounds = async () => {
    ensureBgInputs();
    const slots = new Set();
    for (const slot of node.inputs || []) {
      const index = bgSlotIndex(slot.name);
      if (index >= 0 && slot.link != null) slots.add(index);
    }
    for (const index of slots) await attachBackground(index);
    refreshRows();
    layout();
    commit();
  };

  // 上游换图 / 刚连上线时，不执行也能立刻把背景图挂上去：
  // 轻量轮询（只比字符串，300ms 一次），比依赖各种回调更可靠
  let bgWatchTimer = 0;
  let bgWatchKey = "";
  const backgroundKey = () => {
    const parts = [];
    for (const slot of node.inputs || []) {
      const index = bgSlotIndex(slot.name);
      if (index < 0) continue;
      const url = slot.link == null ? "" : String(upstreamImageURL(index) || "");
      parts.push(index + ":" + url);
    }
    return parts.join("|");
  };
  const startBackgroundWatch = () => {
    if (bgWatchTimer) return;
    bgWatchKey = backgroundKey();
    bgWatchTimer = setInterval(() => {
      if (!state.ready) return;
      const key = backgroundKey();
      if (key === bgWatchKey) return;
      bgWatchKey = key;
      syncBackgrounds().catch(() => {});
    }, 300);
  };
  const stopBackgroundWatch = () => {
    if (!bgWatchTimer) return;
    clearInterval(bgWatchTimer);
    bgWatchTimer = 0;
  };

  // 把某张背景图直接变成画布：画布尺寸＝图片原始尺寸，图片铺满并整体锁定
  const useAsCanvas = (bg) => {
    const natW = Number(bg?.natW) || 0;
    const natH = Number(bg?.natH) || 0;
    if (!natW || !natH) return;
    const mult = multiple();
    S.width = clampSize(roundNear(natW, mult) || natW);
    S.height = clampSize(roundNear(natH, mult) || natH);
    syncSizeWidgets();
    bg.x = 0;
    bg.y = 0;
    bg.w = S.width;
    bg.h = S.height;
    bg.lockedCanvas = true;
    bg.hidden = false;
    S.selected.delete(bg);
    refreshInfo();
    refreshRows();
    layout();
    commit();
  };

  // 某个背景图输入口被断开：把这一张从列表里撤掉
  const dropBackground = (slotIndex) => {
    const bg = S.bgs.find((item) => item && item.slot === slotIndex);
    if (!bg) return;
    S.selected.delete(bg);
    S.rows.delete(bg);
    S.bgs = S.bgs.filter((item) => item !== bg);
    refreshRows();
    layout();
    commit();
  };

  // ---------------------------------------------------------------- restore
  // 把一份 {boxes, bgs} 数据灌进画布（打开工作流 / 载入预设都走这里）
  const restoreCanvas = (data) => {
    S.boxes = [];
    S.bgs = [];
    S.selected.clear();
    if (data && Array.isArray(data.boxes)) {
      for (const item of data.boxes) {
        if (!item || typeof item !== "object") continue;
        const box = newBox(TYPES.includes(item.type) ? item.type : TYPE_OBJ,
          Number(item.x) || 0, Number(item.y) || 0);
        box.w = Math.max(MIN_BOX, Number(item.w) || MIN_BOX);
        box.h = Math.max(MIN_BOX, Number(item.h) || MIN_BOX);
        box.text = String(item.text || "");
        box.desc = String(item.desc || "");
        box.palette = Array.isArray(item.palette) ? item.palette.slice(0, 5) : [];
        box.hidden = !!item.hidden;
        for (const field of FIELDS) box.lock[field] = !!item.lock?.[field];
        S.boxes.push(box);
      }
    }
    if (data && Array.isArray(data.bgs)) {
      for (const item of data.bgs) {
        if (!item || typeof item !== "object") continue;
        const slot = Number.isFinite(Number(item.slot)) ? Number(item.slot) : S.bgs.length;
        const bg = ensureBgEntry(slot);
        bg.x = Number(item.x) || 0;
        bg.y = Number(item.y) || 0;
        bg.w = Math.max(MIN_BOX, Number(item.w) || S.width);
        bg.h = Math.max(MIN_BOX, Number(item.h) || S.height);
        bg.hidden = !!item.hidden;
        bg.desc = String(item.desc || "");
        bg.lockedCanvas = !!item.lockedCanvas;
        for (const field of ["w", "h", "x", "y", "desc"]) bg.lock[field] = !!item.lock?.[field];
        // 打开工作流时先用上次记住的地址把图显示出来，不必等执行
        const url = typeof item.url === "string" ? item.url : "";
        if (url && !bg.image) {
          bg.url = url;
          loadImage(url).then((image) => {
            if (!image) return;
            bg.image = image;
            bg.natW = bg.natW || image.naturalWidth || image.width || 0;
            bg.natH = bg.natH || image.naturalHeight || image.height || 0;
            refreshRows();
            layout();
            paint();
          });
        }
      }
    }
    S.width = clampSize(numeric(wWidth, S.width));
    S.height = clampSize(numeric(wHeight, S.height));
    refreshRows();
    layout();
  };

  const configure = (info) => {
    if (!info) return;
    const raw = Array.isArray(info.widgets_values) ? info.widgets_values : [];
    const index = (node.widgets || []).indexOf(wData);
    const value = index >= 0 ? raw[index] : undefined;
    let data = null;
    if (typeof value === "string" && value.trim()) {
      try {
        data = JSON.parse(value);
      } catch (_error) {
        data = null;
      }
    }
    restoreCanvas(data);
    // 恢复描述框高度与文字（高度存在 node.properties 里，跨会话生效）
    try {
      state.proseH = clamp(Math.round(Number(node.properties?.yxProseH) || 64), 48, 1200);
      applyProseBoxHeight();
      if (proseWidget && proseArea.value !== String(proseWidget.value ?? "")) {
        proseArea.value = String(proseWidget.value ?? "");
      }
    } catch (_error) {
      // 忽略
    }
    // 刚载入工作流时清空撤销记录，让“撤销”从这之后的第一步算起
    state.restoring = true;
    try {
      resetUndo();
    } finally {
      state.restoring = false;
    }
  };

  const applyOutputs = (message) => {
    const images = message?.background_images;
    if (Array.isArray(images)) {
      images.forEach((group, slotIndex) => {
        const info = Array.isArray(group) ? group[0] : group;
        const url = imageURL(info);
        if (!url) return;
        attachBackgroundByURL(slotIndex, url);
      });
    }
  };

  const attachBackgroundByURL = async (slotIndex, url) => {
    const bg = ensureBgEntry(slotIndex);
    const image = await loadImage(url);
    if (!image) return;
    const first = !bg.image;
    bg.image = image;
    bg.url = url;
    bg.natW = image.naturalWidth || image.width || 0;
    bg.natH = image.naturalHeight || image.height || 0;
    if (first) placeInitial(bg);
    refreshRows();
    layout();
    commit();
  };

  const originalExecuted = node.onExecuted;

  node.onExecuted = function (message) {
    try {
      applyOutputs(message);
      if (message?.dims) {
        const [w, h] = message.dims;
        if (Number.isFinite(w) && Number.isFinite(h) && (w !== S.width || h !== S.height)) {
          applyCanvasSize(w, h, false);
        }
      }
    } catch (error) {
      console.error("[MOSS YXBOX] 处理执行结果失败", error);
    }
    originalExecuted?.call?.(this, message);
  };

  const originalConfigure = node.onConfigure;
  node.onConfigure = function (info) {
    const result = originalConfigure?.call?.(this, info);
    try {
      configure(info);
    } catch (error) {
      console.error("[MOSS YXBOX] 恢复画布数据失败", error);
    }
    return result;
  };

  const originalRemoved = node.onRemoved;
  node.onRemoved = function () {
    stopBackgroundWatch();
    // 撤掉挂在 window 上的「松手结算」监听，避免节点删掉后还留着
    try {
      window.removeEventListener?.("pointerdown", state.proseDownHandler, true);
      window.removeEventListener?.("pointerup", state.proseUpHandler, true);
    } catch (_error) {
      // 忽略
    }
    return originalRemoved?.apply?.(this, arguments);
  };

  const originalConnections = node.onConnectionsChange;
  node.onConnectionsChange = function (type, index, connected, link_info, ioSlot) {
    const result = originalConnections?.call?.(this, type, index, connected, link_info, ioSlot);
    const slotIndex = ioSlot ? bgSlotIndex(ioSlot.name) : -1;
    try {
      if (slotIndex >= 0 && connected === false) dropBackground(slotIndex);
      syncBackgrounds();
      // 有些上游节点要过一会儿才把图挂出来，补两次重试
      if (connected) {
        setTimeout(() => { syncBackgrounds().catch(() => {}); }, 400);
        setTimeout(() => { syncBackgrounds().catch(() => {}); }, 1500);
      }
    } catch (error) {
      console.error("[MOSS YXBOX] 同步背景图失败", error);
    }
    return result;
  };

  const onWidget = (w, handler) => {
    if (!w) return;
    const original = w.callback;
    w.callback = function (...args) {
      const result = original?.apply(this, args);
      try {
        handler();
      } catch (error) {
        console.error("[MOSS YXBOX] 参数回调出错", error);
      }
      return result;
    };
  };

  onWidget(wWidth, () => applyModeSize());
  onWidget(wHeight, () => applyModeSize());
  onWidget(wMode, () => applyModeSize());
  onWidget(wAspect, () => applyModeSize());
  onWidget(wPropW, () => applyModeSize());
  onWidget(wPropH, () => applyModeSize());
  onWidget(wBasis, () => applyModeSize());
  onWidget(wLength, () => applyModeSize());
  onWidget(wMult, () => applyModeSize());
  onWidget(wFit, () => paint());

  // 节点缩放 / 尺寸变化时先重算舞台高度，再按新的显示尺寸重画
  let lastWidth = -1;
  let lastAvail = -1;
  let lastTickKey = "";
  let lastProseText = null;
  let lastNodeH = -1;
  let lastAppliedProse = -1;
  const tick = () => {
    if (!canvas.isConnected) return;
    // 「布局提示词输入」接上文本后实时导入（文本没变就什么都不做）
    try {
      syncLayoutSocket();
    } catch (error) {
      console.error("[MOSS YXBOX] 布局提示词输入同步失败", error);
    }
    // 正在拖拽排序时跳过测量：避免和拖拽抢着触发布局计算
    if (state.reorderActive) {
      requestAnimationFrame(tick);
      return;
    }
    const width = Math.round(stage.clientWidth || 0);
    const rect = canvas.getBoundingClientRect();
    const key = `${Math.round(rect.width)}x${Math.round(rect.height)}@${window.devicePixelRatio || 1}`;
    // 节点高度被你拖动了 / 文字高度变了 → 同步（描述框吃掉多出来的空间、删文本时节点缩回）
    syncNodeHeight();
    // 「整体描述」对外只从我自己的 textarea 读，这里只做「外部改了原生值」时的回灌
    if (proseWidget) {
      const text = String(proseWidget.value ?? "");
      if (text !== lastProseText) {
        lastProseText = text;
        if (proseArea.value !== text) proseArea.value = text;
        if (syncProseAuto()) {
          layout();
          requestAnimationFrame(tick);
          return;
        }
      }
    }
    // 只用「宽度」变化触发重排；不再看容器高度，否则改高度会反过来又触发重排，
    // 每帧在两个高度之间来回跳（表现就是整个节点上下抽搐）
    if (width !== lastWidth) {
      lastWidth = width;
      lastTickKey = key;
      if (width > 0) layout();
    } else if (key !== lastTickKey) {
      lastTickKey = key;
      paint();
    }
    requestAnimationFrame(tick);
  };

  // ---------------------------------------------------------------- 导入 / 导出布局提示词
  const captionWidget = () => widget("整体描述");
  const readCaption = () => String(captionWidget()?.value ?? "");

  // 与 nodes.py 的 _boxes_to_regions / _norm_bbox / _compile_layout_local 逐行对应
  const compileLayoutText = () => {
    const caption = readCaption();
    const visible = S.boxes.filter((box) => !box.hidden);
    if (!visible.length) return caption; // 没有框：后端就是原样输出描述
    const W = Math.max(1, S.width);
    const H = Math.max(1, S.height);
    const grid = (value) => Math.max(0, Math.min(1000, Math.round(value * 1000)));
    // items 是「排后面的画在上层」，列表越靠上越上层，所以编译时倒序
    const items = [...visible].reverse().map((box) => {
      const y0 = grid(box.y / H);
      const x0 = grid(box.x / W);
      const y1 = grid((box.y + box.h) / H);
      const x1 = grid((box.x + box.w) / W);
      const label = box.type === "文字框" ? "text"
        : (box.type === "角色框" ? "character" : "object");
      const item = { label, caption: box.desc || "" };
      if (label === "text") item.text = box.text || "";
      const palette = (box.palette || [])
        .filter((color) => typeof color === "string" && color)
        .slice(0, 5)
        .map((color) => color.toUpperCase());
      if (palette.length) item.palette = palette;
      item.bbox = [
        Math.floor((y0 * H) / 1000) - Math.floor(H / 2),
        Math.floor((x0 * W) / 1000) - Math.floor(W / 2),
        Math.ceil((y1 * H) / 1000) - Math.floor(H / 2),
        Math.ceil((x1 * W) / 1000) - Math.floor(W / 2),
      ];
      return item;
    });
    return JSON.stringify({
      summary: { caption: caption.trim() },
      items,
      bbox_coord_space: "abs_centralized",
      bbox_format: "yxyx",
    });
  };

  const closeModal = () => {
    if (!state.modal) return;
    try {
      state.modal.remove();
    } catch {
      /* ignore */
    }
    state.modal = null;
  };

  const openModal = ({ title, hint, value, readonly, buttons }) => {
    closeModal();
    const overlay = el("div", "yx-modal");
    const card = el("div", "yx-card");
    const stop = (event) => event.stopPropagation();
    for (const type of ["pointerdown", "mousedown", "wheel", "dblclick", "contextmenu", "keydown"]) {
      overlay.addEventListener(type, stop, type === "wheel" ? { passive: true } : undefined);
    }
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) closeModal();
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeModal();
      }
    });
    const heading = el("h3", null, title);
    const paragraph = el("p", null, hint);
    const area = el("textarea");
    area.value = value || "";
    area.readOnly = !!readonly;
    area.spellcheck = false;
    const status = el("div", "yx-status");
    const actions = el("div", "yx-actions");
    for (const button of buttons) {
      const btn = el("button", `yx-chip${button.on ? " yx-on" : ""}`, button.label);
      btn.type = "button";
      btn.addEventListener("click", () => button.run(area, status, closeModal));
      actions.appendChild(btn);
    }
    card.appendChild(heading);
    card.appendChild(paragraph);
    card.appendChild(area);
    card.appendChild(status);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    state.modal = overlay;
    area.focus();
    area.select?.();
  };

  const copyToClipboard = async (text, status) => {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "已复制到剪贴板";
    } catch {
      status.textContent = "浏览器不允许访问剪贴板，请手动全选后 Ctrl+C 复制";
    }
  };

  const openExport = () => {
    const text = compileLayoutText();
    const hasBoxes = S.boxes.some((box) => !box.hidden);
    openModal({
      title: "导出布局提示词",
      hint: hasBoxes
        ? "下面是节点将要输出的布局提示词（与后端编译结果逐字一致），可复制给模型或 LLM。"
        : "当前没有可导出的框，导出的就是「整体描述」原文（与节点输出一致）。",
      value: text,
      readonly: true,
      buttons: [
        { label: "复制", on: true, run: (area, status) => copyToClipboard(area.value, status) },
        { label: "关闭", run: (area, status, close) => close() },
      ],
    });
  };

  const stripCodeFence = (raw) => {
    const text = String(raw || "");
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return (fence ? fence[1] : text).trim();
  };

  const jsonSlice = (text) => {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  };

  const LABEL_TO_TYPE = { text: "文字框", character: "角色框", object: "物体框", obj: "物体框" };

  const parseLayoutText = (raw) => {
    const text = stripCodeFence(raw);
    if (!text) return { error: "内容是空的，先粘贴一段布局内容" };
    const data = jsonSlice(text);
    if (!data) {
      if (text.startsWith("{") || text.startsWith("[")) {
        return { error: "这段 JSON 解析不了，检查一下引号、逗号或括号" };
      }
      return { kind: "caption", caption: text };
    }
    if (!Array.isArray(data.items)) {
      // 也认别的写法：compositional_deconstruction.elements / elements / boxes
      const alt = data.compositional_deconstruction?.elements || data.elements || data.boxes;
      if (!Array.isArray(alt)) {
        const caption = String(
          data.caption ?? data.summary?.caption ?? data.high_level_description ?? data.description ?? ""
        ).trim();
        if (!caption) return { error: "没找到 items 列表，也没找到 caption 描述" };
        return { kind: "caption", caption };
      }
      data.items = alt;
    }
    const space = String(data.bbox_coord_space || "abs").toLowerCase();
    const fmt = String(data.bbox_format || "xyxy").toLowerCase();
    // 编译后的格式：原点在画布中心、yxyx；其它一律当草稿的左上原点 xyxy 处理
    const compiled = space.indexOf("centralized") >= 0 || fmt === "yxyx";
    // 来源尺寸：显式 width/height 优先；没有的话（比如只给 elements 的草稿）按所有 bbox 的最大范围推断
    let srcW = Math.round(Number(data.width) || Number(data.canvas?.width) || 0);
    let srcH = Math.round(Number(data.height) || Number(data.canvas?.height) || 0);
    if (!srcW || !srcH) {
      let maxX = 0;
      let maxY = 0;
      for (const item of data.items) {
        if (!item) continue;
        const values = Array.isArray(item.bbox) && item.bbox.length === 4
          ? item.bbox.map((value) => Number(value) || 0)
          : [item.x, item.y,
            Number(item.x) + Number(item.width ?? item.w ?? 0),
            Number(item.y) + Number(item.height ?? item.h ?? 0)].map((value) => Number(value) || 0);
        if (compiled) {
          maxX = Math.max(maxX, Math.abs(values[1]), Math.abs(values[3]));
          maxY = Math.max(maxY, Math.abs(values[0]), Math.abs(values[2]));
        } else {
          maxX = Math.max(maxX, values[0], values[2]);
          maxY = Math.max(maxY, values[1], values[3]);
        }
      }
      if (compiled) {
        srcW = srcW || Math.max(16, Math.round(maxX * 2));
        srcH = srcH || Math.max(16, Math.round(maxY * 2));
      } else {
        srcW = srcW || Math.max(16, Math.round(maxX));
        srcH = srcH || Math.max(16, Math.round(maxY));
      }
    }
    srcW = Math.max(16, srcW || S.width);
    srcH = Math.max(16, srcH || S.height);
    const boxes = [];
    for (const item of data.items) {
      if (!item) continue;
      let values = null;
      if (Array.isArray(item.bbox) && item.bbox.length === 4) {
        values = item.bbox.map((value) => Number(value) || 0);
      } else if ([item.x, item.y, item.width ?? item.w, item.height ?? item.h]
        .every((value) => Number.isFinite(Number(value)))) {
        // 草稿写法：左上角 + 宽高
        const x = Number(item.x);
        const y = Number(item.y);
        values = [x, y, x + Number(item.width ?? item.w), y + Number(item.height ?? item.h)];
      }
      if (!values) continue;
      let x1;
      let y1;
      let x2;
      let y2;
      if (compiled) {
        const [ymin, xmin, ymax, xmax] = values;
        x1 = xmin + srcW / 2;
        x2 = xmax + srcW / 2;
        y1 = ymin + srcH / 2;
        y2 = ymax + srcH / 2;
        // 反向量化会差 ±1 像素：贴回离它最近的、能还原出同一个 bbox 的像素值
        const snap = (value, size, target, upper) => {
          const base = Math.round(value);
          for (const delta of [0, -1, 1, -2, 2]) {
            const pixel = base + delta;
            const grid = Math.max(0, Math.min(1000, Math.round((pixel / size) * 1000)));
            const scaled = (grid * size) / 1000;
            const mapped = (upper ? Math.ceil(scaled) : Math.floor(scaled)) - Math.floor(size / 2);
            if (mapped === target) return pixel;
          }
          return base;
        };
        x1 = snap(x1, srcW, xmin, false);
        x2 = snap(x2, srcW, xmax, true);
        y1 = snap(y1, srcH, ymin, false);
        y2 = snap(y2, srcH, ymax, true);
      } else {
        [x1, y1, x2, y2] = values;
      }
      if (x1 > x2) [x1, x2] = [x2, x1];
      if (y1 > y2) [y1, y2] = [y2, y1];
      const w = Math.round(x2 - x1);
      const h = Math.round(y2 - y1);
      if (w < 8 || h < 8) continue;
      const label = String(item.label || item.type || "").trim().toLowerCase();
      const palette = (Array.isArray(item.palette) ? item.palette
        : (Array.isArray(item.color_palette) ? item.color_palette : []))
        .filter((color) => typeof color === "string" && color.trim())
        .slice(0, 5);
      boxes.push({
        type: LABEL_TO_TYPE[label] || "物体框",
        x: Math.round(x1),
        y: Math.round(y1),
        w,
        h,
        text: String(item.text ?? ""),
        desc: String(item.caption ?? item.desc ?? ""),
        palette,
      });
    }
    if (!boxes.length) return { error: "items 里没有可用的框（bbox 缺失或宽高为 0）" };
    return {
      kind: "layout",
      width: srcW,
      height: srcH,
      caption: String(
        data.summary?.caption ?? data.caption ?? data.high_level_description ?? data.description ?? ""
      ),
      boxes,
    };
  };

  const applyLayoutImport = (parsed, expand) => {
    const mult = 16;
    let boxes = parsed.boxes.map((box) => ({ ...box }));
    let width = parsed.width;
    let height = parsed.height;
    if (expand) {
      const minX = Math.min(0, ...boxes.map((box) => box.x));
      const minY = Math.min(0, ...boxes.map((box) => box.y));
      const maxX = Math.max(width, ...boxes.map((box) => box.x + box.w));
      const maxY = Math.max(height, ...boxes.map((box) => box.y + box.h));
      const dx = minX < 0 ? Math.ceil(-minX / mult) * mult : 0;
      const dy = minY < 0 ? Math.ceil(-minY / mult) * mult : 0;
      if (dx || dy) {
        boxes = boxes.map((box) => ({ ...box, x: box.x + dx, y: box.y + dy }));
      }
      width = Math.max(width, Math.ceil((maxX + dx) / mult) * mult);
      height = Math.max(height, Math.ceil((maxY + dy) / mult) * mult);
    }
    if (wMode) wMode.value = "自定义尺寸";
    if (wWidth) wWidth.value = clampSize(width);
    if (wHeight) wHeight.value = clampSize(height);
    applyCanvasSize(width, height, false);
    if (parsed.caption && captionWidget()) {
      captionWidget().value = parsed.caption;
    }
    // items 是「从背景到前景」，列表越靠上越上层，所以倒过来放
    S.boxes = boxes.reverse().map((box) => ({
      type: box.type,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      text: box.text,
      desc: box.desc,
      palette: box.palette.slice(),
      hidden: false,
      lock: emptyLocks(),
    }));
    S.selected.clear();
    refreshRows();
    layout();
    commit();
    paint();
    node.graph?.setDirtyCanvas?.(true, true);
  };

  const openImport = () => {
    openModal({
      title: "导入布局提示词",
      hint: "可以粘贴：草稿 JSON（abs + xyxy + 宽高）、编译后的 JSON（abs_centralized + yxyx），或纯描述文字。带 ```json 代码块、带前后说明的整段回答也能识别。",
      value: "",
      readonly: false,
      buttons: [
        {
          label: "导入",
          on: true,
          run: (area, status, close) => {
            const parsed = parseLayoutText(area.value);
            if (parsed.error) {
              status.textContent = parsed.error;
              return;
            }
            if (parsed.kind === "caption") {
              if (captionWidget()) captionWidget().value = parsed.caption;
              commit();
              close();
              return;
            }
            const overflow = parsed.boxes.filter((box) => box.x < 0 || box.y < 0
              || box.x + box.w > parsed.width || box.y + box.h > parsed.height);
            let expand = false;
            if (overflow.length) {
              const ask = typeof window.confirm === "function"
                ? `导入后有 ${overflow.length} 个框超出画布（当前 ${parsed.width}×${parsed.height}）。\n\n`
                  + "点「确定」＝按内容扩展画布（放大到刚好装下所有框，并对齐 16 的倍数）；\n"
                  + "点「取消」＝保持当前画布（超出画布的部分会被裁掉）。"
                : "";
              expand = !!ask && window.confirm(ask);
            }
            applyLayoutImport(parsed, expand);
            close();
          },
        },
        { label: "关闭", run: (area, status, close) => close() },
      ],
    });
  };

  // ---------------------------------------------------------------- 布局提示词输入口（实时导入）
  const LAYOUT_INPUT_NAME = "布局提示词输入";
  const layoutSlot = () => (node.inputs || []).find((item) => String(item?.name) === LAYOUT_INPUT_NAME);

  // 取上游文本：优先读上游节点自己的文本控件（边打字边变，最实时），
  // 读不到再退到执行结果里的 STRING 输出（比如某个节点算出来的文本）
  const upstreamLayoutText = () => {
    const slot = layoutSlot();
    if (!slot || slot.link == null) return null;
    const originId = linkOriginId(slot);
    if (originId == null) return null;
    const origin = (node.graph || app.graph)?.getNodeById?.(originId);
    const isTextWidget = (item) => {
      const type = String(item?.type || "").toLowerCase();
      if (["number", "toggle", "combo", "button", "slider"].includes(type)) return false;
      if (typeof item?.value !== "string") return false;
      return !item.name?.match(/^(image|图像|图片|filename|mask|遮罩)$/i);
    };
    const widgetsOfOrigin = (origin?.widgets || []).filter(isTextWidget);
    // 优先认名字像文本的那些（文本框 / 提示词 / 描述），避免抓到别的字符串参数
    const preferred = widgetsOfOrigin.find((item) =>
      /^(text|string|prompt|value|文本|文字|描述|提示词)$/i.test(String(item.name || "").trim()));
    if (preferred) return preferred.value;
    if (widgetsOfOrigin.length) {
      // 没有明确名字就取最长的那条（空字符串也照原样返回：清空＝没有内容）
      return widgetsOfOrigin.reduce((best, item) =>
        (String(item.value).length > String(best.value).length ? item : best)).value;
    }
    const output = app.nodeOutputs?.[originId];
    if (output) {
      const raw = output.text ?? output.string ?? output.STRING;
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (typeof value === "string") return value;
    }
    return null;
  };

  // 和 openImport 走同一个解析器；区别是这里按「当前画布」等比缩放，不反过来改画布尺寸
  const applyLayoutText = (text) => {
    const parsed = parseLayoutText(text);
    if (parsed.error) return false;
    if (parsed.kind === "caption") {
      const target = captionWidget();
      if (target && String(target.value ?? "") !== parsed.caption) {
        target.value = parsed.caption;
        commit();
      }
      return true;
    }
    const srcW = Math.max(1, Number(parsed.width) || S.width);
    const srcH = Math.max(1, Number(parsed.height) || S.height);
    const sx = S.width / srcW;
    const sy = S.height / srcH;
    const boxes = parsed.boxes.map((box) => {
      let x = Math.round(box.x * sx);
      let y = Math.round(box.y * sy);
      let w = Math.max(8, Math.round(box.w * sx));
      let h = Math.max(8, Math.round(box.h * sy));
      x = Math.max(0, Math.min(Math.max(0, S.width - 8), x));
      y = Math.max(0, Math.min(Math.max(0, S.height - 8), y));
      w = Math.max(8, Math.min(w, S.width - x));
      h = Math.max(8, Math.min(h, S.height - y));
      return { ...box, x, y, w, h };
    });
    if (!boxes.length) return false;
    if (parsed.caption && captionWidget()) {
      captionWidget().value = parsed.caption;
    }
    // items 是「从背景到前景」，列表越靠上越上层，所以倒过来放
    S.boxes = boxes.reverse().map((box) => ({
      type: box.type,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      text: box.text,
      desc: box.desc,
      palette: box.palette.slice(),
      hidden: false,
      lock: emptyLocks(),
    }));
    S.selected.clear();
    refreshRows();
    layout();
    commit();
    paint();
    node.graph?.setDirtyCanvas?.(true, true);
    return true;
  };

  // 上游文本被清空 → 画布回到「什么都没画」的初始状态（框、选择、描述一起清掉）
  const clearFromSocket = () => {
    if (!S.boxes.length && !String(captionWidget()?.value ?? "").trim()) return;
    S.boxes = [];
    S.selected.clear();
    const target = captionWidget();
    if (target) target.value = "";
    refreshRows();
    layout();
    commit();
    paint();
    node.graph?.setDirtyCanvas?.(true, true);
  };

  let lastLayoutText = null;
  const syncLayoutSocket = () => {
    const slot = layoutSlot();
    if (!slot || slot.link == null) {
      lastLayoutText = null;
      return;
    }
    const text = upstreamLayoutText();
    if (text == null) return;
    if (text === lastLayoutText) return;
    lastLayoutText = text;
    if (!text.trim()) {
      clearFromSocket();
      return;
    }
    applyLayoutText(text);
  };

  // ---------------------------------------------------------------- 预设（保存 / 管理 / 加载）
  const PRESET_KEY = "moss-yxbox-presets-v1";
  const presetUID = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const readStore = () => {
    try {
      const raw = window.localStorage?.getItem(PRESET_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (data && Array.isArray(data.folders) && Array.isArray(data.items)) {
        return { version: 1, folders: data.folders, items: data.items };
      }
    } catch (_error) {
      // 存储坏了就当没有
    }
    return { version: 1, folders: [], items: [] };
  };
  const writeStore = (store) => {
    try {
      window.localStorage?.setItem(PRESET_KEY, JSON.stringify(store));
      return true;
    } catch (error) {
      console.error("[MOSS YXBOX] 保存预设失败", error);
      return false;
    }
  };
  const nextPresetName = (store) => {
    const used = new Set((store.items || []).map((item) => String(item.name)));
    let index = 1;
    while (used.has(String(index))) index += 1;
    return String(index);
  };
  // 抓一份当前节点的完整状态（参数 + 画布 + 背景图信息 + 整体描述）
  const capturePreset = (withImages) => {
    const widgets = {};
    for (const item of node.widgets || []) {
      if (!item || item.name === "画布数据") continue;
      const value = item.value;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        widgets[item.name] = value;
      }
    }
    let canvas = { boxes: [], bgs: [] };
    try {
      canvas = JSON.parse(serialize());
    } catch (_error) {
      canvas = { boxes: [], bgs: [] };
    }
    if (!withImages) {
      for (const bg of canvas.bgs || []) delete bg.url;
    }
    return { widgets, canvas, desc: readCaption() };
  };
  const applyPreset = async (preset, status) => {
    if (!preset) return;
    const data = preset.data || {};
    for (const [name, value] of Object.entries(data.widgets || {})) {
      const target = widget(name);
      if (!target) continue;
      target.value = value;
      try {
        target.callback?.(value, target, null, true);
      } catch (error) {
        console.error("[MOSS YXBOX] 应用预设参数出错", name, error);
      }
    }
    restoreCanvas(data.canvas || { boxes: [], bgs: [] });
    let failed = 0;
    if (preset.withImages && Array.isArray(data.canvas?.bgs)) {
      for (const info of data.canvas.bgs) {
        const url = typeof info?.url === "string" ? info.url : "";
        if (!url) continue;
        const slot = Number.isFinite(Number(info.slot)) ? Number(info.slot) : 0;
        const bg = ensureBgEntry(slot);
        const image = await loadImage(url);
        if (!image) {
          failed += 1;
          continue;
        }
        bg.image = image;
        bg.url = url;
        bg.natW = image.naturalWidth || image.width || 0;
        bg.natH = image.naturalHeight || image.height || 0;
      }
    }
    S.width = clampSize(numeric(wWidth, S.width));
    S.height = clampSize(numeric(wHeight, S.height));
    refreshRows();
    refreshInfo();
    layout();
    commit();
    fitNode();
    if (status) {
      status.textContent = failed
        ? `已载入预设，但有 ${failed} 张背景图加载失败（文件可能已移动或改名），其余设置不受影响`
        : "已载入预设";
    }
  };
  const askText = (message, fallback) => {
    try {
      const value = window.prompt(message, fallback ?? "");
      if (value == null) return null;
      return String(value).trim();
    } catch (_error) {
      return null;
    }
  };

  // 通用弹窗：内容自己往里塞
  const openDialog = ({ title, hint, build }) => {
    closeModal();
    const overlay = el("div", "yx-modal");
    const card = el("div", "yx-card");
    const stop = (event) => event.stopPropagation();
    for (const type of ["pointerdown", "mousedown", "wheel", "dblclick", "contextmenu", "keydown"]) {
      overlay.addEventListener(type, stop, type === "wheel" ? { passive: true } : undefined);
    }
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) closeModal();
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeModal();
      }
    });
    card.appendChild(el("h3", null, title));
    if (hint) card.appendChild(el("p", null, hint));
    const status = el("div", "yx-status");
    const api = { card, status, close: closeModal };
    build(card, api);
    card.appendChild(status);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    state.modal = overlay;
    return api;
  };

  const openSavePreset = () => {
    const store = readStore();
    const autoName = nextPresetName(store);
    openDialog({
      title: "保存节点预设",
      hint: "会保存这个节点的全部参数、画布尺寸、所有框（含文字、描述、颜色、锁）、背景图的位置尺寸与整体描述。"
        + `名称留空就自动命名为 ${autoName}。`,
      build: (card, api) => {
        const row = el("div", "yx-form");
        row.appendChild(el("span", "yx-form-label", "预设名称"));
        const input = el("input", "yx-input");
        input.type = "text";
        input.placeholder = `留空 = ${autoName}`;
        row.appendChild(input);
        card.appendChild(row);

        const checkRow = el("label", "yx-check-row");
        const check = el("input", "yx-check");
        check.type = "checkbox";
        check.checked = false;
        checkRow.appendChild(check);
        checkRow.appendChild(el("span", null, "同时保存背景图的文件名与路径（下次加载会自动找回图片，文件被移动则只提示加载失败）"));
        card.appendChild(checkRow);

        const folderRow = el("div", "yx-form");
        folderRow.appendChild(el("span", "yx-form-label", "存到文件夹"));
        const select = el("select", "yx-select");
        const rootOption = el("option", null, "根目录");
        rootOption.value = "";
        select.appendChild(rootOption);
        for (const folder of store.folders) {
          const option = el("option", null, presetPathName(store, folder.id));
          option.value = folder.id;
          select.appendChild(option);
        }
        folderRow.appendChild(select);
        card.appendChild(folderRow);

        const actions = el("div", "yx-actions");
        const ok = el("button", "yx-chip yx-on", "保存");
        ok.type = "button";
        ok.addEventListener("click", () => {
          const name = input.value.trim() || nextPresetName(store);
          const duplicate = store.items.some((item) => item.name === name && (item.folder || null) === (select.value || null));
          if (duplicate) {
            api.status.textContent = "同名预设已存在，请换个名字";
            return;
          }
          const maxOrder = store.items.reduce((acc, item) => Math.max(acc, Number(item.order) || 0), 0);
          store.items.push({
            id: presetUID(),
            name,
            folder: select.value || null,
            created: Date.now(),
            updated: Date.now(),
            order: maxOrder + 1,
            withImages: check.checked,
            data: capturePreset(check.checked),
          });
          if (!writeStore(store)) {
            api.status.textContent = "浏览器拒绝写入本地存储，保存失败";
            return;
          }
          api.close();
        });
        const cancel = el("button", "yx-chip", "取消");
        cancel.type = "button";
        cancel.addEventListener("click", () => api.close());
        actions.appendChild(cancel);
        actions.appendChild(ok);
        card.appendChild(actions);
        input.focus();
      },
    });
  };

  const presetPathName = (store, folderId) => {
    const chain = [];
    let current = folderId;
    let guard = 0;
    while (current && guard < 6) {
      const folder = store.folders.find((item) => item.id === current);
      if (!folder) break;
      chain.unshift(folder.name);
      current = folder.parent || null;
      guard += 1;
    }
    return chain.join(" / ") || "根目录";
  };

  const openPresetManager = () => {
    const store = readStore();
    const view = {
      folder: null,
      selected: new Set(),
      multi: false,
      sort: "custom",
      desc: false,
      cols: 3,
      query: "",
    };
    const foldersOf = (parent) => store.folders.filter((folder) => (folder.parent || null) === parent);
    const itemsOf = (folder) => store.items.filter((item) => (item.folder || null) === folder);
    const chainOf = (folderId) => {
      const chain = [];
      let current = folderId;
      let guard = 0;
      while (current && guard < 6) {
        const folder = store.folders.find((item) => item.id === current);
        if (!folder) break;
        chain.unshift(folder);
        current = folder.parent || null;
        guard += 1;
      }
      return chain;
    };
    const sorted = (list) => {
      const items = [...list];
      if (view.sort === "name") items.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hans-CN"));
      else if (view.sort === "created") items.sort((a, b) => (Number(a.created) || 0) - (Number(b.created) || 0));
      else items.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      if (view.desc) items.reverse();
      return items;
    };
    const visibleItems = () => {
      const keyword = view.query.trim().toLowerCase();
      const list = itemsOf(view.folder);
      if (!keyword) return sorted(list);
      return sorted(list.filter((item) => String(item.name).toLowerCase().includes(keyword)));
    };

    openDialog({
      title: "管理与加载节点预设",
      hint: "文件夹最多 3 级；预设可单选 / 多选，可改名、移动、排序、搜索、删除（删除需二次确认）。",
      build: (card, api) => {
        // ---- 工具条
        const tools = el("div", "yx-tools");
        const search = el("input", "yx-input");
        search.type = "search";
        search.placeholder = "搜索预设名称";
        search.value = view.query;
        search.addEventListener("input", () => {
          view.query = search.value;
          render();
        });
        tools.appendChild(search);

        const sortSelect = el("select", "yx-select");
        for (const [value, label] of [["custom", "自定义顺序"], ["name", "按名称"], ["created", "按创建时间"]]) {
          const option = el("option", null, label);
          option.value = value;
          if (view.sort === value) option.selected = true;
          sortSelect.appendChild(option);
        }
        sortSelect.addEventListener("change", () => {
          view.sort = sortSelect.value;
          render();
        });
        tools.appendChild(sortSelect);

        const orderBtn = el("button", "yx-chip", "升序");
        orderBtn.type = "button";
        orderBtn.addEventListener("click", () => {
          view.desc = !view.desc;
          orderBtn.textContent = view.desc ? "降序" : "升序";
          render();
        });
        tools.appendChild(orderBtn);

        const colsSelect = el("select", "yx-select");
        for (const value of [2, 3, 4, 5]) {
          const option = el("option", null, `每行 ${value} 个`);
          option.value = String(value);
          if (view.cols === value) option.selected = true;
          colsSelect.appendChild(option);
        }
        colsSelect.addEventListener("change", () => {
          view.cols = Number(colsSelect.value) || 3;
          render();
        });
        tools.appendChild(colsSelect);

        card.appendChild(tools);

        const tools2 = el("div", "yx-tools");
        const multiBtn = el("button", "yx-chip", "多选：关");
        multiBtn.type = "button";
        multiBtn.addEventListener("click", () => {
          view.multi = !view.multi;
          if (!view.multi && view.selected.size > 1) view.selected.clear();
          multiBtn.textContent = `多选：${view.multi ? "开" : "关"}`;
          multiBtn.classList.toggle("yx-on", view.multi);
          render();
        });
        tools2.appendChild(multiBtn);

        const allBtn = el("button", "yx-chip", "全选");
        allBtn.type = "button";
        allBtn.addEventListener("click", () => {
          const items = visibleItems();
          const all = items.every((item) => view.selected.has(item.id));
          if (all) view.selected.clear();
          else items.forEach((item) => view.selected.add(item.id));
          render();
        });
        tools2.appendChild(allBtn);

        const newFolderBtn = el("button", "yx-chip", "新建文件夹");
        newFolderBtn.type = "button";
        newFolderBtn.addEventListener("click", () => {
          const depth = chainOf(view.folder).length;
          if (depth >= 3) {
            api.status.textContent = "最多只能建 3 级文件夹";
            return;
          }
          const name = askText("新文件夹名称", "新文件夹");
          if (!name) return;
          store.folders.push({ id: presetUID(), name, parent: view.folder || null });
          writeStore(store);
          render();
        });
        tools2.appendChild(newFolderBtn);

        const loadBtn = el("button", "yx-chip yx-on", "加载选中");
        loadBtn.type = "button";
        loadBtn.addEventListener("click", async () => {
          const chosen = store.items.filter((item) => view.selected.has(item.id));
          if (!chosen.length) {
            api.status.textContent = "先在下面选中一个预设";
            return;
          }
          if (chosen.length > 1) {
            api.status.textContent = "一次只能加载一个预设";
            return;
          }
          await applyPreset(chosen[0], api.status);
          api.close();
        });
        tools2.appendChild(loadBtn);

        const renameBtn = el("button", "yx-chip", "重命名");
        renameBtn.type = "button";
        renameBtn.addEventListener("click", () => {
          const chosen = store.items.filter((item) => view.selected.has(item.id));
          if (chosen.length !== 1) {
            api.status.textContent = "重命名请只选一个预设";
            return;
          }
          const name = askText("预设新名称", chosen[0].name);
          if (!name) return;
          chosen[0].name = name;
          chosen[0].updated = Date.now();
          writeStore(store);
          render();
        });
        tools2.appendChild(renameBtn);

        const moveBtn = el("button", "yx-chip", "移动到");
        moveBtn.type = "button";
        moveBtn.addEventListener("click", () => {
          const chosen = store.items.filter((item) => view.selected.has(item.id));
          if (!chosen.length) {
            api.status.textContent = "先选中要移动的预设";
            return;
          }
          const options = store.folders.map((folder, index) => `${index + 1} = ${presetPathName(store, folder.id)}`);
          const answer = askText(`输入目标文件夹序号（0 = 根目录）\n${options.join("\n")}`, "0");
          if (answer == null) return;
          const number = Number(answer);
          if (!Number.isFinite(number) || number < 0 || number > store.folders.length) {
            api.status.textContent = "序号不对";
            return;
          }
          const folderId = number === 0 ? null : store.folders[number - 1].id;
          for (const item of chosen) {
            item.folder = folderId;
            item.updated = Date.now();
          }
          writeStore(store);
          render();
        });
        tools2.appendChild(moveBtn);

        const moveStep = (delta) => {
          if (view.sort !== "custom") {
            api.status.textContent = "先切到「自定义顺序」才能手动调整顺序";
            return;
          }
          const chosen = store.items.filter((item) => view.selected.has(item.id));
          if (chosen.length !== 1) {
            api.status.textContent = "排序请只选一个预设";
            return;
          }
          const list = sorted(itemsOf(view.folder));
          const index = list.indexOf(chosen[0]);
          const target = index + delta;
          if (index < 0 || target < 0 || target >= list.length) return;
          const other = list[target];
          const a = Number(chosen[0].order) || 0;
          const b = Number(other.order) || 0;
          chosen[0].order = b;
          other.order = a;
          writeStore(store);
          render();
        };
        const upBtn = el("button", "yx-chip", "上移");
        upBtn.type = "button";
        upBtn.addEventListener("click", () => moveStep(-1));
        tools2.appendChild(upBtn);
        const downBtn = el("button", "yx-chip", "下移");
        downBtn.type = "button";
        downBtn.addEventListener("click", () => moveStep(1));
        tools2.appendChild(downBtn);

        const deleteBtn = el("button", "yx-chip", "删除");
        deleteBtn.type = "button";
        deleteBtn.addEventListener("click", () => {
          const chosen = store.items.filter((item) => view.selected.has(item.id));
          if (!chosen.length) {
            api.status.textContent = "先选中要删除的预设";
            return;
          }
          const ask = `确定删除 ${chosen.length} 个预设？此操作不可撤销。`;
          if (typeof window.confirm === "function" && !window.confirm(ask)) return;
          if (typeof window.confirm === "function" && !window.confirm("再确认一次：真的要删除吗？")) return;
          const ids = new Set(chosen.map((item) => item.id));
          store.items = store.items.filter((item) => !ids.has(item.id));
          view.selected.clear();
          writeStore(store);
          render();
        });
        tools2.appendChild(deleteBtn);
        card.appendChild(tools2);

        // ---- 面包屑
        const crumb = el("div", "yx-crumb");
        card.appendChild(crumb);

        // ---- 内容区
        const body = el("div", "yx-body");
        card.appendChild(body);

        const closeRow = el("div", "yx-actions");
        const closeBtn = el("button", "yx-chip", "关闭");
        closeBtn.type = "button";
        closeBtn.addEventListener("click", () => api.close());
        closeRow.appendChild(closeBtn);
        card.appendChild(closeRow);

        function render() {
          crumb.replaceChildren();
          const rootChip = el("button", "yx-crumb-btn", "根目录");
          rootChip.type = "button";
          rootChip.addEventListener("click", () => {
            view.folder = null;
            view.selected.clear();
            render();
          });
          crumb.appendChild(rootChip);
          for (const folder of chainOf(view.folder)) {
            crumb.appendChild(el("span", "yx-crumb-sep", "›"));
            const chip = el("button", "yx-crumb-btn", folder.name);
            chip.type = "button";
            chip.addEventListener("click", () => {
              view.folder = folder.id;
              view.selected.clear();
              render();
            });
            crumb.appendChild(chip);
          }

          body.replaceChildren();
          body.style.setProperty("--yx-cols", String(view.cols || 3));

          const folders = foldersOf(view.folder);
          if (folders.length) {
            const folderBox = el("div", "yx-folder-list");
            for (const folder of folders) {
              const row = el("div", "yx-folder-row");
              const open = el("button", "yx-folder-name", `📁 ${folder.name}`);
              open.type = "button";
              open.addEventListener("click", () => {
                view.folder = folder.id;
                view.selected.clear();
                render();
              });
              row.appendChild(open);
              const rename = el("button", "yx-mini", "改名");
              rename.type = "button";
              rename.addEventListener("click", () => {
                const name = askText("文件夹新名称", folder.name);
                if (!name) return;
                folder.name = name;
                writeStore(store);
                render();
              });
              row.appendChild(rename);
              const remove = el("button", "yx-mini yx-mini-danger", "删除");
              remove.type = "button";
              remove.addEventListener("click", () => {
                const inside = store.folders.filter((item) => item.parent === folder.id);
                const presets = store.items.filter((item) => item.folder === folder.id);
                const warn = `确定删除文件夹「${folder.name}」？`
                  + `\n里面有 ${presets.length} 个预设、${inside.length} 个子文件夹（会一起删除）。`;
                if (typeof window.confirm === "function" && !window.confirm(warn)) return;
                if (typeof window.confirm === "function" && !window.confirm("再确认一次：文件夹和里面的预设都会被删除。")) return;
                const doomed = new Set([folder.id]);
                let grew = true;
                while (grew) {
                  grew = false;
                  for (const item of store.folders) {
                    if (item.parent && doomed.has(item.parent) && !doomed.has(item.id)) {
                      doomed.add(item.id);
                      grew = true;
                    }
                  }
                }
                store.folders = store.folders.filter((item) => !doomed.has(item.id));
                store.items = store.items.filter((item) => !doomed.has(item.folder));
                if (doomed.has(view.folder)) view.folder = null;
                view.selected.clear();
                writeStore(store);
                render();
              });
              row.appendChild(remove);
              folderBox.appendChild(row);
            }
            body.appendChild(folderBox);
          }

          const items = visibleItems();
          if (!items.length) {
            body.appendChild(el("p", "yx-empty", view.query ? "没有匹配的预设" : "这个文件夹里还没有预设，点上方「保存预设」开始保存"));
          } else {
            const grid = el("div", "yx-grid");
            for (const item of items) {
              const cardItem = el("div", `yx-preset${view.selected.has(item.id) ? " yx-picked" : ""}`);
              const check = el("input");
              check.type = "checkbox";
              check.checked = view.selected.has(item.id);
              check.addEventListener("click", (event) => event.stopPropagation());
              check.addEventListener("change", () => {
                if (check.checked) {
                  if (!view.multi) view.selected.clear();
                  view.selected.add(item.id);
                } else {
                  view.selected.delete(item.id);
                }
                render();
              });
              cardItem.appendChild(check);
              const nameRow = el("div", "yx-preset-name", item.name);
              cardItem.appendChild(nameRow);
              const meta = el("div", "yx-preset-meta",
                `${presetPathName(store, item.folder || null)} · ${new Date(Number(item.created) || Date.now()).toLocaleDateString("zh-CN")}`);
              cardItem.appendChild(meta);
              cardItem.addEventListener("click", () => {
                if (!view.multi) view.selected.clear();
                if (view.selected.has(item.id)) view.selected.delete(item.id);
                else view.selected.add(item.id);
                render();
              });
              cardItem.addEventListener("dblclick", async () => {
                await applyPreset(item, api.status);
                api.close();
              });
              grid.appendChild(cardItem);
            }
            body.appendChild(grid);
          }
          syncButtons();
        }

        function syncButtons() {
          const count = view.selected.size;
          loadBtn.disabled = count !== 1;
          renameBtn.disabled = count !== 1;
          upBtn.disabled = count !== 1 || view.sort !== "custom";
          downBtn.disabled = count !== 1 || view.sort !== "custom";
          moveBtn.disabled = count === 0;
          deleteBtn.disabled = count === 0;
        }

        render();
      },
    });
  };

  // ---------------------------------------------------------------- dom widget
  const domWidget = node.addDOMWidget("yxbox_ui", "PREVIEW", root, {
    serialize: false,
    hideOnZoom: false,
    // 2.0 前端会优先读这三个，拿不到才回落到 CSS 变量
    // 最小值给得很小：允许你把节点拖小（拖小后这块区自己出现滚动条，而不是把节点顶回去）
    getMinHeight: () => 120,
    getMaxHeight: () => 4000,
    getHeight: () => domDesiredHeight(),
    getValue: () => "",
    setValue: () => {},
  });
  state.domWidget = domWidget;
  domWidget.serialize = false;
  if (domWidget.options) domWidget.options.serialize = false;
  domWidget.computeLayoutSize = () => ({
    minHeight: 120,
    maxHeight: 4000,
    minWidth: 0,
  });
  domWidget.computeSize = function (width) {
    return [Math.max(360, width || 520), Math.min(domDesiredHeight(), 1600)];
  };

  ensureBgInputs();
  refreshRows();
  refreshInfo();
  layout();
  state.ready = true;
  // 等一帧：等原生控件挂好、DOM 控件量到宽度，再把节点一次性撑到合适尺寸
  requestAnimationFrame(() => {
    try {
      fitNodeInitial();
      // 记下我们自己的高度：之后只有「和这个值差很多」才算你手动拖过节点
      state.appliedH = Math.round(node.size?.[1] || 0);
      state.lastTextNeed = clamp(proseTextPx(), PROSE_MIN, PROSE_MAX);
      layout();
    } catch (error) {
      console.error("[MOSS YXBOX] 初始化尺寸失败", error);
    }
  });
  requestAnimationFrame(tick);
  setTimeout(() => {
    syncBackgrounds().catch(() => {});
  }, 60);
  // 上游换了图（或刚连上线）时不用执行也能立刻把背景图挂上去
  startBackgroundWatch();

  state.refreshRows = refreshRows;
  state.applyModeSize = applyModeSize;
  state.applyCanvasSize = applyCanvasSize;
  state.serialize = serialize;
  state.commit = commit;
  state.paint = paint;
  state.layout = layout;
  state.beginEdit = beginEdit;
  state.commitEdit = commitEdit;
  state.syncBackgrounds = syncBackgrounds;
  state.attachBackgroundByURL = attachBackgroundByURL;
  state.compileLayoutText = compileLayoutText;
  state.parseLayoutText = parseLayoutText;
  state.openExport = openExport;
  state.openImport = openImport;
  state.syncLayoutSocket = syncLayoutSocket;
  state.openSavePreset = openSavePreset;
  state.openPresetManager = openPresetManager;
  state.applyPreset = applyPreset;
  state.fitNode = fitNode;
  state.fitNodeInitial = fitNodeInitial;
  state.neededNodeHeight = neededNodeHeight;
  state.domDesiredHeight = domDesiredHeight;
  state.closeModal = closeModal;
  state.scrollEl = scroll;
  state.rowsEl = rows;
  state.ensureBgInputs = ensureBgInputs;
  state.geo = geo;
  state.undo = undoStep;
  state.redo = redoStep;
  state.copyBoxes = copySelection;
  state.pasteBoxes = pasteClipboard;
  state.resetUndo = resetUndo;
  syncBarButtons();
  resetUndo();
}

app.registerExtension({
  name: "MOSS.YXBOX",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;
    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalCreated?.apply(this, arguments);
      try {
        setup(this);
      } catch (error) {
        console.error("[MOSS YXBOX] 初始化失败", error);
      }
      return result;
    };
  },
});
