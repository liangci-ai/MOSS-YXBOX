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
const MAX_BG = 64;

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
const FIELDS = ["type", "text", "desc", "w", "h", "color", "x", "y", "num"];
// 「导入原图」进来的那张图也住在背景图区，但它是独立身份：
// 不占「背景图N」输入口（伪槽位），不参与 B 编号，尺寸来源里单独有一项。
const SOURCE_KIND = "source";
const SOURCE_LABEL = "原图";
const SOURCE_COLOR = "#c9a6ff";
const MODE_CUSTOM = "自定义尺寸";
const MODE_SCALED = "按缩放规则计算";
const MODE_SOURCE = "按导入原图的原始尺寸";
const MODE_IMAGE_OLD = "按图片原始尺寸";
const MODE_BG_RE = /^按背景图(\d+)的原始尺寸$/;

// 画布比例：一张图都没有时的兜底项 / 「按原图」/ 「按背景图N」（N = 输入口序号）
const ASPECT_AUTO = "按导入的原图或接入的背景图比例";
const ASPECT_SOURCE = "按原图";
const ASPECT_LEGACY = "保持原图";
const ASPECT_BG_RE = /^按背景图(\d+)$/;
const ASPECT_FIXED = ["自定义", "1:1", "5:4", "4:3", "3:2", "16:9", "2:1", "21:9",
  "4:5", "3:4", "2:3", "9:16", "1:2"];

const emptyLocks = (fields = FIELDS) => {
  const out = {};
  for (const key of fields) out[key] = false;
  return out;
};

const CSS = `
.yx-root{position:relative;display:flex;flex-direction:column;gap:6px;width:100%;height:100%;box-sizing:border-box;
  overflow:hidden;padding:7px 7px 21px;background:linear-gradient(180deg,#191a21,#15161b 60%);border:1px solid #23252e;
  border-radius:8px;color:#e7e7ea;font-family:inherit;
  /* 画布容器会给整块 DOM 继承一个「小手」，这里统一改回普通箭头；
     需要 pointer / text / move 的控件各自单独声明，不受影响 */
  cursor:default;}
/* 文本输入仍然要 I 形文本光标（色块 / 复选框保持自己的 pointer） */
.yx-root input:not([type="color"]):not([type="checkbox"]),.yx-root textarea{cursor:text;}
.yx-root select{cursor:pointer;}
.yx-prose{display:flex;flex-direction:column;gap:4px;flex:0 0 auto;}
.yx-prose-label{font-size:11px;color:#8d90a0;letter-spacing:.3px;}
.yx-prose-area{width:100%;box-sizing:border-box;resize:vertical;overflow:auto;min-height:48px;height:64px;
  padding:6px 8px;border:1px solid #34363f;border-radius:7px;background:#141519;color:#e7e7ea;
  font:inherit;font-size:12px;line-height:1.5;outline:none;cursor:text;overscroll-behavior:contain;}
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
.yx-toast{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);max-width:82%;padding:6px 12px;border-radius:6px;background:#262a36;border:1px solid #3b4154;color:#dfe3ee;font-size:12px;line-height:1.5;z-index:60;pointer-events:none;opacity:0;transition:opacity .16s ease;}
.yx-toast.yx-toast-on{opacity:1;}
.yx-menu-item{padding:6px 9px;border-radius:6px;cursor:pointer;white-space:nowrap;}
.yx-menu-item:hover{background:#282b36;}
.yx-menu-danger{color:#ff8d8d;}
.yx-menu-armed{background:#4a1f1f;color:#ffc9c9;}
.yx-menu-sep{height:1px;background:#2c2f3a;margin:5px 2px;}
.yx-menu-label{padding:4px 8px 2px;font-size:11px;color:#8d90a0;}
.yx-menu-colors{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:2px 7px 5px;}
.yx-ic-swap::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 5.2h8.2'/%3E%3Cpath d='M9.9 3.1 12.2 5.2l-2.3 2.1'/%3E%3Cpath d='M12 10.8H3.8'/%3E%3Cpath d='M6.1 8.7 3.8 10.8l2.3 2.1'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 5.2h8.2'/%3E%3Cpath d='M9.9 3.1 12.2 5.2l-2.3 2.1'/%3E%3Cpath d='M12 10.8H3.8'/%3E%3Cpath d='M6.1 8.7 3.8 10.8l2.3 2.1'/%3E%3C/svg%3E");}
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
/* 画布上方的第二行工具条：网格 / 坐标 / 等分线 / 画布区高度（高度输入框仍在最右，字大一点） */
.yx-tools{row-gap:4px;}
.yx-tools .yx-rows-cap{font-size:13px;font-weight:600;color:#c9c9d1;}
.yx-tools .yx-rows-input{width:62px;height:24px;font-size:13px;}
.yx-edit{position:absolute;margin:0;padding:2px 4px;resize:none;outline:none;z-index:5;
  background:rgba(10,11,15,.86);color:#fff;border:2px solid #3f78ff;border-radius:2px;overflow:hidden;
  font-family:inherit;line-height:1.25;box-sizing:border-box;}
.yx-scroll{overflow:auto;box-sizing:border-box;flex:0 0 auto;max-height:none;cursor:default;overscroll-behavior:contain;
  padding-bottom:10px;scrollbar-width:thin;}
.yx-scroll::-webkit-scrollbar{width:10px;height:10px;}
.yx-scroll::-webkit-scrollbar-track{background:transparent;}
.yx-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.22);border-radius:5px;}
.yx-scroll::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.34);}
.yx-scroll::-webkit-scrollbar-corner{background:transparent;}
.yx-scroll:focus{outline:none;}
/* 「显示行数」输入框：钉在操作按钮那一行的最右侧，只统计带编号的行 */
.yx-rows-field{display:flex;align-items:center;gap:4px;margin-left:auto;padding:0 2px;user-select:none;}
.yx-rows-field .yx-rows-cap{font-size:11px;color:#9a9ca6;white-space:nowrap;}
.yx-rows-input{width:52px;height:22px;box-sizing:border-box;background:#12131a;border:1px solid #2a2c37;
  border-radius:4px;color:#e7e7ea;font-size:12px;text-align:center;padding:0 3px;font-family:inherit;}
.yx-rows-input:focus{outline:1px solid #3f78ff;border-color:#3f78ff;}
.yx-table{min-width:0;width:100%;display:flex;flex-direction:column;gap:3px;position:relative;}
.yx-row{display:grid;align-items:center;gap:4px;box-sizing:border-box;
  grid-template-columns:__BG_COLUMNS__;}
.yx-row.yx-header{font-size:11px;color:#9a9ca6;padding:3px 4px;border:1px solid transparent;
  position:sticky;top:0;z-index:3;background:#15161d;}
/* 绘框区没有「重置 / 画布」两列（那是背景图专属），所以它自己的列宽表少两列；
   顺序：拖拽 整体锁 勾选 编号 | 锁类型 类型 | 锁文字 文字 | 锁描述 描述 |
   锁宽 宽 锁高 高 锁颜色 颜色 锁x x 锁y y 显示 删除（共 22 列） */
.yx-row.yx-box-grid{grid-template-columns:__BOX_COLUMNS__;}
/* 竖分隔线：数据行里是一条 1px 的实心小列，表头里是同宽的透明占位（保证列位对齐） */
.yx-sep{align-self:stretch;width:1px;background:rgba(255,255,255,.18);border-radius:1px;}
.yx-sep.yx-sep-h{background:transparent;}
/* 锁图标往它右边的输入框靠近一点（只影响自己的格子，不推挤后面的列） */
.yx-row > .yx-lock{margin-right:-3px;}
/* 背景图区、绘框区各自一个滚动容器，各自吸顶表头 */
.yx-list{display:flex;flex-direction:column;gap:3px;}
.yx-scroll-bg{border-radius:5px;}
.yx-scroll-box{border-radius:5px;}
.yx-group-note{font-size:11px;opacity:.72;white-space:nowrap;}
.yx-row.yx-header span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;}
/* 表头里的「反选」按钮：贴在「选中」列左边（那一带在表头里本来就空着），
   做成小按钮的样子——有边框、有底、悬停变蓝——一眼能和旁边的小标题文字区分开 */
.yx-head-btn{position:absolute;left:5px;top:50%;transform:translateY(-50%);
  height:16px;padding:0 5px;font-size:10px;line-height:14px;font-family:inherit;
  border:1px solid #3a3f52;border-radius:4px;background:#1d2030;color:#b6bacb;
  cursor:pointer;z-index:4;white-space:nowrap;}
.yx-head-btn:hover{background:#262b3f;border-color:#4d6cff;color:#e8ecff;}
.yx-head-btn:active{background:#2f3757;}
.yx-head-btn:focus-visible{outline:1px solid #4d6cff;}
.yx-item{background:#1c1d24;border:1px solid #262833;border-radius:6px;padding:3px 4px;transition:background .12s,border-color .12s;}
.yx-item:hover{background:#23252f;border-color:#343848;}
.yx-item.yx-sel{border-color:#3f78ff;background:#1f2330;}
.yx-item.yx-sel:hover{background:#242a3c;}
.yx-item.yx-hidden-row{opacity:.55;}
.yx-item.yx-bg{background:#201d16;border-color:#38301f;}
.yx-item.yx-bg.yx-sel{border-color:#ffb454;background:#2a2418;}
.yx-item.yx-bg.yx-canvas-row{box-shadow:inset 0 0 0 1px #ffb454;}
.yx-item.yx-item-src{background:#1d1a24;border-color:#43385c;}
.yx-item.yx-item-src.yx-sel{border-color:#c9a6ff;background:#25202f;}
.yx-num-src{color:#c9a6ff;}
.yx-chip.yx-danger{color:#ff6b6b;border-color:#ff6b6b;}
.yx-num{font-size:11px;color:#8d90a0;text-align:center;cursor:pointer;user-select:none;}
.yx-item.yx-sel .yx-num{color:#8fb4ff;}
.yx-item.yx-bg .yx-num{color:#ffb454;}
/* 编号表头格：左边「编号」、右边一颗「重命名」小按钮（编号列 64px，放得下） */
.yx-row.yx-header .yx-num-head{display:flex;align-items:center;justify-content:center;gap:1px;
  overflow:visible;white-space:nowrap;}
.yx-num-head-btn{height:14px;padding:0 1px;font-size:9px;line-height:12px;font-family:inherit;
  border:1px solid #3a3f52;border-radius:3px;background:#1d2030;color:#b6bacb;cursor:pointer;
  white-space:nowrap;flex:0 0 auto;}
.yx-num-head-btn:hover{background:#262b3f;border-color:#4d6cff;color:#e8ecff;}
.yx-num-head-btn:active{background:#2f3757;}
.yx-num-head-btn:focus-visible{outline:1px solid #4d6cff;}
/* 编号格：小锁 +（背景图才有 B 前缀）+ 数字框。平时只读（单击选行），双击才进编辑 */
.yx-num-cell{display:flex;align-items:center;justify-content:center;gap:0;min-width:0;overflow:hidden;}
.yx-num-head-btn-arm{background:#3b2f14;border-color:#c9a227;color:#ffe08a;}
.yx-no-input{flex:1 1 auto;width:0;min-width:0;height:18px;box-sizing:border-box;padding:0 2px;
  font-size:11px;font-family:inherit;text-align:center;color:#8d90a0;background:transparent;
  border:1px solid transparent;border-radius:3px;outline:none;}
.yx-item.yx-sel .yx-no-input{color:#8fb4ff;}
.yx-item.yx-bg .yx-no-input{color:#ffb454;}
.yx-no-input:hover{border-color:#343848;}
.yx-no-input:focus{cursor:text;background:#15161d;border-color:#4d6cff;color:#e8ecff;}
.yx-drag{cursor:grab;color:#7c7f8d;font-size:11px;text-align:center;user-select:none;touch-action:none;}
.yx-drag:active{cursor:grabbing;}
.yx-in,.yx-sel-type{width:100%;box-sizing:border-box;background:#12131a;border:1px solid #2a2c37;border-radius:4px;
  color:#e7e7ea;font-size:12px;height:22px;padding:0 3px;font-family:inherit;min-width:0;}
/* 列表行里的宽 / 高 / x / y：保留数字框自带的上下箭头（点箭头可以微调），
   列宽给到 64px 并预留箭头占位，保证箭头和四位数同时放得下 */
.yx-row .yx-in[type=number]{text-align:center;padding:0 1px 0 2px;}
/* 类型下拉框的文字居中，和表头「类型」两个字对齐 */
.yx-sel-type{text-align:center;text-align-last:center;}
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
.yx-empty{font-size:11px;color:#7c7f8d;padding:2px 1px;min-height:30px;box-sizing:border-box;}
/* ---- 按键分组配色：主操作(青蓝) / 工具开关(灰→选中偏蓝) / 危险(平时灰,悬停红) ---- */
.yx-chip.yx-act{background:#16233a;border-color:#2f5f9e;color:#a9c4f2;}
.yx-chip.yx-act:hover{background:#1b2c48;border-color:#3f78ff;color:#e2ecff;}
.yx-chip.yx-act.yx-on{background:#22355a;border-color:#4d8fe8;color:#eaf2ff;}
/* 三组按钮各用一种颜色：布局提示词＝蓝、原图＝绿、预设＝琥珀 */
.yx-chip.yx-act-layout{background:#16233a;border-color:#2f5f9e;color:#a9c4f2;}
.yx-chip.yx-act-layout:hover{background:#1b2c48;border-color:#3f78ff;color:#e2ecff;}
.yx-chip.yx-act-image{background:#142c20;border-color:#2f7a4e;color:#a4dcb6;}
.yx-chip.yx-act-image:hover{background:#183826;border-color:#3fa168;color:#dcf7e5;}
.yx-chip.yx-act-preset{background:#2f240f;border-color:#87652a;color:#f0d8a6;}
.yx-chip.yx-act-preset:hover{background:#3b2e13;border-color:#b3873c;color:#ffedcd;}
.yx-chip.yx-act-image:disabled{background:#191c1a;border-color:#2c3a31;color:#7d8e83;opacity:.75;cursor:not-allowed;}
.yx-chip.yx-tool{color:#b9bcc7;}
.yx-chip.yx-tool.yx-on{background:#243049;border-color:#3d5c8a;color:#dbe7ff;}
.yx-chip.yx-soft-danger{color:#c0c2cb;}
.yx-chip.yx-soft-danger:hover{color:#ff9d9d;border-color:#5a3232;background:#241a1a;}
/* ---- 绘制框类型：永远带一个本类型的小色块，不选中也能一眼分清 ---- */
.yx-chip.yx-type{position:relative;padding-left:21px;}
.yx-chip.yx-type::before{content:"";position:absolute;left:8px;top:50%;width:7px;height:7px;margin-top:-3.5px;
  border-radius:2px;background:#9aa0b0;}
.yx-chip.yx-t-obj::before{background:#4ea1ff;}
.yx-chip.yx-t-text::before{background:#ffd166;}
.yx-chip.yx-t-char::before{background:#3ddc97;}
/* ---- 小图标：用 currentColor 遮罩，不引入外部资源，也不改按钮里的文字 ---- */
.yx-chip.yx-ic{position:relative;padding-left:22px;}
.yx-chip.yx-ic::before{content:"";position:absolute;left:7px;top:50%;width:12px;height:12px;margin-top:-6px;
  background-color:currentColor;opacity:.85;
  -webkit-mask-repeat:no-repeat;-webkit-mask-position:center;-webkit-mask-size:12px 12px;
  mask-repeat:no-repeat;mask-position:center;mask-size:12px 12px;}
.yx-ic-export::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 10.5V2.6'/%3E%3Cpath d='M5 5.6 8 2.6l3 3'/%3E%3Cpath d='M2.6 10.4v2A1.6 1.6 0 0 0 4.2 14h7.6a1.6 1.6 0 0 0 1.6-1.6v-2'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 10.5V2.6'/%3E%3Cpath d='M5 5.6 8 2.6l3 3'/%3E%3Cpath d='M2.6 10.4v2A1.6 1.6 0 0 0 4.2 14h7.6a1.6 1.6 0 0 0 1.6-1.6v-2'/%3E%3C/svg%3E");}
.yx-ic-import::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 2.6v8'/%3E%3Cpath d='M5 7.6 8 10.6l3-3'/%3E%3Cpath d='M2.6 10.4v2A1.6 1.6 0 0 0 4.2 14h7.6a1.6 1.6 0 0 0 1.6-1.6v-2'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 2.6v8'/%3E%3Cpath d='M5 7.6 8 10.6l3-3'/%3E%3Cpath d='M2.6 10.4v2A1.6 1.6 0 0 0 4.2 14h7.6a1.6 1.6 0 0 0 1.6-1.6v-2'/%3E%3C/svg%3E");}
.yx-ic-save::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linejoin='round'%3E%3Cpath d='M3.6 2.6h8.8v10.8L8 10.4l-4.4 3z'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linejoin='round'%3E%3Cpath d='M3.6 2.6h8.8v10.8L8 10.4l-4.4 3z'/%3E%3C/svg%3E");}
.yx-ic-folder::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linejoin='round'%3E%3Cpath d='M2.4 4.6A1.4 1.4 0 0 1 3.8 3.2h2.9l1.5 1.6h4A1.4 1.4 0 0 1 13.6 6.2v6A1.4 1.4 0 0 1 12.2 13.6H3.8a1.4 1.4 0 0 1-1.4-1.4z'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linejoin='round'%3E%3Cpath d='M2.4 4.6A1.4 1.4 0 0 1 3.8 3.2h2.9l1.5 1.6h4A1.4 1.4 0 0 1 13.6 6.2v6A1.4 1.4 0 0 1 12.2 13.6H3.8a1.4 1.4 0 0 1-1.4-1.4z'/%3E%3C/svg%3E");}
.yx-ic-pencil::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linejoin='round'%3E%3Cpath d='M3 13l.9-2.9 6.4-6.4a1.5 1.5 0 0 1 2.1 2.1l-6.4 6.4z'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linejoin='round'%3E%3Cpath d='M3 13l.9-2.9 6.4-6.4a1.5 1.5 0 0 1 2.1 2.1l-6.4 6.4z'/%3E%3C/svg%3E");}
.yx-ic-layers::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linejoin='round'%3E%3Cpath d='M8 2.4 2.4 5.4 8 8.4l5.6-3z'/%3E%3Cpath d='M2.4 9.2 8 12.2l5.6-3'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linejoin='round'%3E%3Cpath d='M8 2.4 2.4 5.4 8 8.4l5.6-3z'/%3E%3Cpath d='M2.4 9.2 8 12.2l5.6-3'/%3E%3C/svg%3E");}
.yx-ic-grid::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4'%3E%3Cpath d='M5.6 2.6v10.8M10.4 2.6v10.8M2.6 5.6h10.8M2.6 10.4h10.8'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4'%3E%3Cpath d='M5.6 2.6v10.8M10.4 2.6v10.8M2.6 5.6h10.8M2.6 10.4h10.8'/%3E%3C/svg%3E");}
.yx-ic-axes::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.2 13.2V3.4M3.2 13.2h9.8'/%3E%3Cpath d='M1.9 4.9 3.2 3l1.3 1.9'/%3E%3Cpath d='M11.5 14.5l1.9-1.3-1.9-1.3'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.2 13.2V3.4M3.2 13.2h9.8'/%3E%3Cpath d='M1.9 4.9 3.2 3l1.3 1.9'/%3E%3Cpath d='M11.5 14.5l1.9-1.3-1.9-1.3'/%3E%3C/svg%3E");}
.yx-ic-select::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linejoin='round' stroke-linecap='round'%3E%3Cpath d='M2.8 4.6h8.4v8.4H2.8z' stroke-dasharray='2 1.6'/%3E%3Cpath d='M5.4 8.2 7 9.8l3.4-3.6'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linejoin='round' stroke-linecap='round'%3E%3Cpath d='M2.8 4.6h8.4v8.4H2.8z' stroke-dasharray='2 1.6'/%3E%3Cpath d='M5.4 8.2 7 9.8l3.4-3.6'/%3E%3C/svg%3E");}
.yx-ic-images::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linejoin='round'%3E%3Cpath d='M5.6 3.4h7v7'/%3E%3Cpath d='M3.4 5.4h7v7h-7z'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linejoin='round'%3E%3Cpath d='M5.6 3.4h7v7'/%3E%3Cpath d='M3.4 5.4h7v7h-7z'/%3E%3C/svg%3E");}
.yx-ic-eye::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round'%3E%3Cpath d='M2.4 8S4.6 4.2 8 4.2 13.6 8 13.6 8 11.4 11.8 8 11.8 2.4 8 2.4 8z'/%3E%3Cpath d='M2.8 13.2 13.2 2.8'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round'%3E%3Cpath d='M2.4 8S4.6 4.2 8 4.2 13.6 8 13.6 8 11.4 11.8 8 11.8 2.4 8 2.4 8z'/%3E%3Cpath d='M2.8 13.2 13.2 2.8'/%3E%3C/svg%3E");}
.yx-ic-trash::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.2 4.8h9.6'/%3E%3Cpath d='M5.6 4.8V3.2h4.8v1.6'/%3E%3Cpath d='M4.4 4.8 5 13.2h6l.6-8.4'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.2 4.8h9.6'/%3E%3Cpath d='M5.6 4.8V3.2h4.8v1.6'/%3E%3Cpath d='M4.4 4.8 5 13.2h6l.6-8.4'/%3E%3C/svg%3E");}
.yx-ic-undo::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 4.6 3 7.6l3 3'/%3E%3Cpath d='M3 7.6h6.2a3.1 3.1 0 0 1 0 6.2H7.4'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 4.6 3 7.6l3 3'/%3E%3Cpath d='M3 7.6h6.2a3.1 3.1 0 0 1 0 6.2H7.4'/%3E%3C/svg%3E");}
.yx-ic-redo::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 4.6 13 7.6l-3 3'/%3E%3Cpath d='M13 7.6H6.8a3.1 3.1 0 0 0 0 6.2h1.8'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 4.6 13 7.6l-3 3'/%3E%3Cpath d='M13 7.6H6.8a3.1 3.1 0 0 0 0 6.2h1.8'/%3E%3C/svg%3E");}
/* ---- 列表底部收口 + 底部状态栏 ---- */
.yx-scroll{border-radius:5px;}
.yx-statusbar{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;
  margin-top:1px;padding:4px 5px 1px;border-top:1px solid #262932;font-size:11px;line-height:14px;
  color:#8b8e9c;white-space:nowrap;overflow:hidden;user-select:none;}
.yx-sb-group{display:flex;align-items:center;gap:7px;min-width:0;overflow:hidden;text-overflow:ellipsis;}
.yx-statusbar b{color:#cfd3dd;font-weight:600;}
.yx-statusbar .yx-sb-sep{color:#494c58;}
.yx-statusbar .yx-sb-ver{color:#9fc2ff;}
/* ---- 列表分区：背景图区（上） / 绘框区（下），两块各自有标题与表头 ---- */
.yx-table.yx-rows{gap:3px;}
.yx-group{display:flex;align-items:center;gap:6px;height:22px;padding:0 5px;border-radius:5px;
  font-size:11px;line-height:22px;user-select:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.yx-group b{font-weight:600;}
.yx-group-bg{background:rgba(255,180,84,.10);border:1px solid rgba(255,180,84,.30);color:#ffcf8a;}
.yx-group-box{background:rgba(78,161,255,.10);border:1px solid rgba(78,161,255,.28);color:#a9c8ff;}
.yx-row.yx-bg-head{color:#c9a06a;background:#1a1712;border-color:#2a2318;z-index:2;}
.yx-row.yx-bg-head span{text-align:center;}
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

// 按「列位」往行里塞格子：遇到要竖线分隔的列位就先插一条 1px 的小列。
// 表头用同一个函数（hiddenSeps=true）插透明占位，这样表头和数据行的列位严格对齐。
function appendCells(parent, cells, seps, hiddenSeps = false) {
  cells.forEach((cell, index) => {
    if (seps && seps.has(index)) {
      const sep = el("div", hiddenSeps ? "yx-sep yx-sep-h" : "yx-sep");
      sep.setAttribute("aria-hidden", "true");
      parent.appendChild(sep);
    }
    parent.appendChild(cell);
  });
  return parent;
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

// 编号规则：框 01、02…；背景图 B1、B2…
// 新对象永远取「同类里现有最大编号 + 1」，中间删掉的号不回收——否则新画一个框会把
// 剪贴板里记着的「框01」顶掉，粘贴菜单上写的名字就和实际内容对不上了。
function nextLabelNo(list) {
  // 先把老数据里还没编号的对象补上号，否则这里算出来的「最大号」是 0，
  // 新对象就会拿到 01，把已有对象的编号顶下去
  fillMissingNos(list);
  let max = 0;
  for (const item of list || []) {
    const n = Number(item && item.__no) || 0;
    if (n > max) max = n;
  }
  return max + 1;
}

// 老工作流里没有编号：按「最老的先编号」补 1、2、3…
// 列表是「最新的在最上面」（S.boxes[0] 最新），所以要从末尾往前补，
// 保证最下面那个最早的对象拿到 01，新画的永远往后排。
function fillMissingNos(list) {
  const items = (list || []).filter(Boolean);
  const used = new Set();
  for (const item of items) {
    const n = Number(item.__no) || 0;
    if (n > 0) used.add(n);
  }
  let next = 1;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (Number(item.__no) > 0 || item.kind === SOURCE_KIND) continue;
    while (used.has(next)) next += 1;
    item.__no = next;
    used.add(next);
    next += 1;
  }
}

function setup(node) {
  if (node.__yxbox) return;
  // 显示行数的取值规则：只收非负整数；没存过 / 存坏了都按默认 20
  function readRows(raw) {
    const n = Number(raw);
    const blank = raw === undefined || raw === null || raw === "" || !Number.isFinite(n);
    return blank ? 20 : Math.max(0, Math.min(999, Math.round(n)));
  }

  const state = (node.__yxbox = {
    ready: false,
    multi: false,
    modal: null,
    // 描述框高度：由你拖右下角手柄决定，读不到就按 64 起
    proseH: clamp(Math.round(Number(node.properties?.yxProseH) || 64), 48, 1200),
    // 前置 / 后置提示词：JSON 区间之外的文字，跟着「画布数据」一起存
    prefix: "",
    suffix: "",
    prefixH: clamp(Math.round(Number(node.properties?.yxPrefixH) || 48), 40, 1200),
    suffixH: clamp(Math.round(Number(node.properties?.yxSuffixH) || 48), 40, 1200),
    // 两个分区各自的显示行数：只数自己下面带编号的行，默认各 20
    // （旧版存在 yxShowRows 里的那个统一值已经不用了）
    bgShowRows: readRows(node.properties?.yxBgRows),
    boxShowRows: readRows(node.properties?.yxBoxRows),
    // 画布区显示高度：0 = 自动（老算法），>0 = 用这个固定值
    // v1.0.4 起默认 600：没存过这个值（老工作流 / 新节点）也按 600 显示，存了 0 才是「要自动」
    stageH: clamp(Math.round(Number(node.properties?.yxStageH ?? 600) || 0), 0, 2600),
    // 「导入原图」接口上次导入过的图地址，用来避免每帧重复导入
    imageImportSource: "",
    imageImportOk: false,
    imageStamp: "",
    imageStampUrl: "",
    imageStampAt: 0,
    imageBytes: 0,
    imageImportAgain: false,
    imageImportSeq: 0,
    imageImportBusy: false,
    // 这次导入的原图里有几份排版可挑（「切换排版」按钮用）
    pngCandidates: [],
    pngImageUrl: "",
    // 坐标体系：canvas = 左下角原点、y 向上（老规矩）；draft = 左上角原点、y 向下（和官方草稿 JSON 一致）
    // 只影响「坐标轴怎么画」和「列表里 y 怎么显示/怎么填」，导出与导入识别一律按官方草稿
    coordMode: String(node.properties?.yxCoordMode || "canvas") === "draft" ? "draft" : "canvas",
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
  // 参数改名后旧工作流 / 未重启的后端里还叫旧名，两个名字都认
  const wMult = widget("画布宽高取整倍数") || widget("宽高取整倍数");

  // 参数「显示名」只写 widget.label：界面文字变了，真名不动 ——
  // 工作流存档、API 格式、PNG 信息、预设、连线都不受影响。
  const WIDGET_LABELS = {
    "画布宽": "画布宽（画布尺寸来源选自定义尺寸时生效）",
    "画布高": "画布高（画布尺寸来源选自定义尺寸时生效）",
    "画布比例": "画布比例（画布尺寸来源选按缩放规则计算时生效）",
    "比例宽": "比例宽（选按缩放规则计算且画布比例＝自定义时生效）",
    "比例高": "比例高（选按缩放规则计算且画布比例＝自定义时生效）",
    "画布缩放基准": "画布缩放基准（画布尺寸来源选按缩放规则计算时生效）",
    "画布缩放长度": "画布缩放长度（画布尺寸来源选按缩放规则计算时生效）",
    "画布宽高取整倍数": "画布宽高取整倍数（决定画布取整倍数，以及宽高/缩放长度输入框的吸附步长）",
    "宽高取整倍数": "画布宽高取整倍数（决定画布取整倍数，以及宽高/缩放长度输入框的吸附步长）",
  };
  Object.keys(WIDGET_LABELS).forEach((name) => {
    const w = widget(name);
    if (w) w.label = WIDGET_LABELS[name];
  });

  // 背景图填充方式 = 锁比例 时，拖动/手改尺寸都要求背景图保持原图长宽比
  const ratioLockEnabled = (item) => !!item?.isBg && String(wFit?.value ?? "") === "锁比例";
  const bgRatio = (item) => {
    const w0 = Number(item?.natW) || Number(item?.image?.naturalWidth) || 1;
    const h0 = Number(item?.natH) || Number(item?.image?.naturalHeight) || 1;
    return w0 > 0 && h0 > 0 ? w0 / h0 : 1;
  };

  // ------------------------------------------------------- 坐标体系（左下原点 / 左上原点）
  // 内部存的一直是「左上角原点、y 向下」的画布坐标（和导出、编译一致），
  // 这里只是在显示和输入时做一次换算，两种体系看的是同一份数据。
  const coordIsDraft = () => state.coordMode === "draft";
  const yShown = (item) => {
    const h = Math.max(0, Number(item?.h) || 0);
    return Math.round(coordIsDraft() ? Number(item?.y) || 0 : S.height - ((Number(item?.y) || 0) + h));
  };
  const yFromShown = (item, value) => {
    const h = Math.max(1, Number(item?.h) || 1);
    const v = clamp(Number(value) || 0, 0, Math.max(0, S.height - h));
    return coordIsDraft() ? v : S.height - v - h;
  };
  const coordXTips = () => (coordIsDraft()
    ? "框左上角在画布里的 x 坐标（左上角为原点，向右为正）"
    : "框左下角在画布里的 x 坐标（左下角为原点，向右为正）");
  const coordYTips = () => (coordIsDraft()
    ? "框左上角在画布里的 y 坐标（左上角为原点，向下为正，和导入导出的草稿 JSON 一致）"
    : "框左下角在画布里的 y 坐标（左下角为原点，向上为正）");
  const coordBgXTips = () => (coordIsDraft()
    ? "背景图左上角在画布里的 x 坐标（左上角为原点，向右为正）"
    : "背景图左下角在画布里的 x 坐标（左下角为原点，向右为正）");
  const coordBgYTips = () => (coordIsDraft()
    ? "背景图左上角在画布里的 y 坐标（左上角为原点，向下为正，和导入导出的草稿 JSON 一致）"
    : "背景图左下角在画布里的 y 坐标（左下角为原点，向上为正）");
  let draftCoordBtn = null;
  let axesBtnRef = null;
  const syncCoordButtons = () => {
    const draft = coordIsDraft();
    if (axesBtnRef) {
      axesBtnRef.classList.toggle("yx-on", state.axes !== false && !draft);
      axesBtnRef.title = draft
        ? "坐标轴显示（现在是草稿 JSON 坐标，左下角原点这一套暂时不显示；点「草稿坐标」切回来）"
        : "显示 / 隐藏 左下角原点的坐标系刻度";
    }
    if (draftCoordBtn) {
      draftCoordBtn.classList.toggle("yx-on", state.axes !== false && draft);
      draftCoordBtn.title = "草稿 JSON 坐标：左上角为原点、y 向下，和官方草稿 JSON 一致。"
        + "\n打开它会把「坐标」那一套自动关掉（两套刻度不能同时画）。"
        + "\n只影响画布上的坐标轴和列表里 y 的显示/输入，导出草稿 JSON、导入识别都不受影响。";
    }
  };
  const setCoordMode = (mode) => {
    state.coordMode = mode === "draft" ? "draft" : "canvas";
    node.properties = node.properties || {};
    node.properties.yxCoordMode = state.coordMode;
    syncCoordButtons();
    refreshRows();
    paint();
  };

  for (const item of node.widgets || []) {
    if (!HIDDEN_WIDGETS.has(item.name)) continue;
    item.hidden = true;
    if (item.options) item.options.hidden = true;
    item.computeSize = () => [0, -4];
    item.draw = () => {};
    if (item.element) item.element.style.display = "none";
  }

  // 关掉 Nodes 2.0 时，被隐藏掉的原生控件在旧渲染里还会被画成一个没有名字的灰色小圆点，
  // 位置正好压在「布局提示词输入」下面，看起来就是「两个半重叠的接口」。
  // 这两个参数只给节点内部用（值照常保存、照常提交给后端），不需要接入点，直接摘掉。
  const HIDDEN_INPUT_NAMES = new Set(["整体描述", "画布数据"]);
  // 只在「关掉 Nodes 2.0」的旧渲染下去摘接入点：新渲染里那两个控件不会画点，
  // 而且新渲染的控件是跟着输入走的，乱删输入反而有把控件弄没的风险。
  const vueNodesEnabled = () => {
    try {
      if (window.LiteGraph?.vueNodesMode === true) return true;
      const value = app.ui?.settings?.getSettingValue?.("Comfy.VueNodes.Enabled");
      return value === true || value === "true";
    } catch (_error) {
      return false;
    }
  };
  let stripTries = 0;
  const stripHiddenInputs = () => {
    if (stripTries >= 8 || vueNodesEnabled()) return;
    let removed = false;
    for (const slot of [...(node.inputs || [])]) {
      if (!HIDDEN_INPUT_NAMES.has(String(slot?.name || ""))) continue;
      if (slot.link != null) continue;   // 真被接了线就保留，不跟用户抢
      const at = (node.inputs || []).indexOf(slot);
      if (at < 0) continue;
      try {
        if (typeof node.removeInput === "function") node.removeInput(at);
        else node.inputs.splice(at, 1);
        removed = true;
      } catch (error) {
        console.warn("[MOSS YXBOX] 清理隐藏参数的接入点失败", error);
      }
    }
    if (removed) {
      stripTries += 1;
      node.setDirtyCanvas?.(true, true);
      node.graph?.setDirtyCanvas?.(true, true);
    }
  };
  stripHiddenInputs();
  setTimeout(stripHiddenInputs, 300);
  setTimeout(stripHiddenInputs, 1500);

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
  // 三个描述框加起来占的高度：整体描述 + 前置 + 后置（各带一行小标题）
  function proseTotalHeight() {
    const side = clamp(Math.round(state.prefixH || 48), 40, 1200)
      + clamp(Math.round(state.suffixH || 48), 40, 1200);
    return proseHeight() + side + 2 * (16 + 4) + 2 * 6;
  }

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
  // 列宽表 + 竖分隔线的列位（1px 的独立小列，画在数据行里；表头用同宽透明占位保持对齐）
  const BG_COLS = ["12px", "14px", "26px", "64px", "12px", "minmax(56px,.7fr)", "12px", "minmax(0,2fr)",
    "14px", "minmax(62px,.5fr)", "14px", "minmax(62px,.5fr)", "14px", "54px", "14px", "minmax(62px,.5fr)",
    "14px", "minmax(62px,.5fr)", "24px", "32px", "50px", "24px"];
  const BOX_COLS = ["12px", "14px", "26px", "64px", "12px", "minmax(56px,.7fr)", "12px", "minmax(0,1.1fr)",
    "12px", "minmax(0,1.3fr)", "14px", "minmax(62px,.5fr)", "14px", "minmax(62px,.5fr)", "14px", "28px",
    "14px", "minmax(62px,.5fr)", "14px", "minmax(62px,.5fr)", "24px", "24px"];
  // 列表整行完整显示所需的最小宽度：固定列宽 + 竖线(1px) + 列间距(4px) + 行内左右 padding(8px)
  const colPx = (col) => {
    const found = /(\d+(?:\.\d+)?)px/.exec(String(col));
    return found ? Number(found[1]) : 0;
  };
  const tableMinWidth = (cols, seps) => {
    let sum = 0;
    for (let i = 0; i < cols.length; i += 1) sum += colPx(cols[i]) + (seps.has(i) ? 1 : 0);
    const cells = cols.length + seps.size;
    return sum + Math.max(0, cells - 1) * 4 + 8;
  };
  // 节点宽度里还要装下节点自身的边距 / 边框 / 插件根容器的 padding，统一留 64px
  const requiredNodeWidth = () => Math.ceil(
    Math.max(tableMinWidth(BG_COLS, BG_SEP), tableMinWidth(BOX_COLS, BOX_SEP)) + 64);

  // 这些列前面要竖线：整体锁 / 选中 / 编号 / 每把锁 / 显示 / 重置 / 画布 / 删除
  const BG_SEP = new Set([1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 19, 20, 21]);
  const BOX_SEP = new Set([1, 2, 3, 4, 7, 9, 11, 13, 15, 17, 19, 21]);
  const columnsOf = (cols, seps) => cols
    .flatMap((col, index) => (seps.has(index) ? ["1px", col] : [col]))
    .join(" ");
  style.textContent = CSS
    .replace("__BG_COLUMNS__", columnsOf(BG_COLS, BG_SEP))
    .replace("__BOX_COLUMNS__", columnsOf(BOX_COLS, BOX_SEP));
  document.head.appendChild(style);

  const root = el("div", "yx-root");
  // Nodes 2.0：前端只对「带 data-capture-wheel="true" 且焦点在其中的元素」放行滚轮，
  // 否则节点里的滚轮会被转发给画布（变成缩放工作流视图）。这是前端自己留的开关。
  root.setAttribute("data-capture-wheel", "true");

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
  const proseLabel = el("div", "yx-prose-label", "整体描述（对整张画面的整体描述）");
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

  // ------------------------------------------------ 前置 / 后置提示词
  // 布局提示词 = 「前置文字 + 布局 JSON + 后置文字」。这两段不参与布局，
  // 所以单独放输入框，存在「画布数据」里（老工作流没有这两个字段，读出来就是空）。
  const SIDE_MIN_H = 40;
  const makeSideBox = (labelText, placeholder) => {
    const box = el("div", "yx-prose");
    box.appendChild(el("div", "yx-prose-label", labelText));
    const area = el("textarea", "yx-prose-area");
    area.placeholder = placeholder;
    area.spellcheck = false;
    box.appendChild(area);
    for (const type of ["pointerdown", "mousedown", "wheel", "keydown"]) {
      area.addEventListener(type, (event) => event.stopPropagation());
    }
    return { box, area };
  };
  const prefixSide = makeSideBox(
    "前置提示词（JSON 之外，放在最终提示词最前面）",
    "风格 / 画质 / 光照等写在布局 JSON 外面的文字；只有纯 JSON 时留空",
  );
  const suffixSide = makeSideBox(
    "后置提示词（JSON 之外，放在最终提示词最后面）",
    "要跟在布局 JSON 后面的文字；只有纯 JSON 时留空",
  );
  const prefixArea = prefixSide.area;
  const suffixArea = suffixSide.area;
  root.insertBefore(prefixSide.box, proseBox);
  root.insertBefore(suffixSide.box, proseBox.nextSibling);

  const applySideHeights = () => {
    const set = (area, value) => {
      const px = `${clamp(Math.round(value || 48), SIDE_MIN_H, 1200)}px`;
      if (area.style.height !== px) area.style.height = px;
    };
    set(prefixArea, state.prefixH);
    set(suffixArea, state.suffixH);
  };
  const syncSideValues = () => {
    const p = String(state.prefix || "");
    const s = String(state.suffix || "");
    if (prefixArea.value !== p) prefixArea.value = p;
    if (suffixArea.value !== s) suffixArea.value = s;
  };
  // 导入时整组替换（解析出来的前置/后置一起换），避免出现「新 JSON + 旧前后缀」的假组合
  const setSideProse = (nextPrefix, nextSuffix) => {
    let changed = false;
    if (nextPrefix != null && String(nextPrefix) !== String(state.prefix || "")) {
      state.prefix = String(nextPrefix);
      changed = true;
    }
    if (nextSuffix != null && String(nextSuffix) !== String(state.suffix || "")) {
      state.suffix = String(nextSuffix);
      changed = true;
    }
    if (changed) syncSideValues();
    return changed;
  };
  let sideCommitTimer = null;
  const scheduleSideCommit = () => {
    try { clearTimeout(sideCommitTimer); } catch (_error) { /* 忽略 */ }
    sideCommitTimer = setTimeout(() => {
      sideCommitTimer = null;
      commit();
    }, 400);
  };
  prefixArea.addEventListener("input", () => {
    state.prefix = prefixArea.value;
    scheduleSideCommit();
  });
  suffixArea.addEventListener("input", () => {
    state.suffix = suffixArea.value;
    scheduleSideCommit();
  });
  // 拖右下角手柄调高度：只量 offsetHeight（getBoundingClientRect 会带上画布缩放倍率）
  let sidePointerDown = false;
  prefixArea.addEventListener("pointerdown", () => { sidePointerDown = true; });
  suffixArea.addEventListener("pointerdown", () => { sidePointerDown = true; });
  const syncSideHeights = () => {
    if (!sidePointerDown) return;
    sidePointerDown = false;
    let changed = false;
    for (const item of [
      { area: prefixArea, key: "prefixH", prop: "yxPrefixH" },
      { area: suffixArea, key: "suffixH", prop: "yxSuffixH" },
    ]) {
      let measured = 0;
      try {
        measured = Math.round(item.area.offsetHeight || 0);
      } catch (_error) {
        measured = 0;
      }
      if (!measured || measured < 24) continue;
      if (Math.abs(measured - (state[item.key] || 0)) < 1) continue;
      state[item.key] = measured;
      node.properties = node.properties || {};
      node.properties[item.prop] = measured;
      changed = true;
    }
    if (!changed) return;
    layout();
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
  try {
    window.addEventListener("pointerup", syncSideHeights, true);
    window.addEventListener("pointercancel", syncSideHeights, true);
  } catch (_error) {
    // 忽略
  }
  applySideHeights();

  // 节点最上方：三组按钮，每组一种颜色（布局提示词 = 蓝、原图 = 绿、预设 = 琥珀）
  const topBar = el("div", "yx-topbar");
  const exportBtn = el("button", "yx-chip yx-act yx-act-layout yx-ic yx-ic-export", "导出布局提示词");
  exportBtn.type = "button";
  exportBtn.title = "显示节点最终输出的布局提示词（与后端编译结果一致），可一键复制";
  exportBtn.addEventListener("click", () => openExport());
  const importBtn = el("button", "yx-chip yx-act yx-act-layout yx-ic yx-ic-import", "导入布局提示词");
  importBtn.type = "button";
  importBtn.title = "粘贴草稿 JSON、编译后的 JSON 或纯描述，自动还原画布尺寸、框、文字与颜色";
  importBtn.addEventListener("click", () => openImport());
  topBar.appendChild(exportBtn);
  topBar.appendChild(importBtn);
  // 「导入原图」：从一张 PNG 的文件信息里找回生成它用的布局提示词，并把这张图当背景图放进来
  const pngBtn = el("button", "yx-chip yx-act yx-act-image yx-ic yx-ic-import", "导入原图");
  pngBtn.type = "button";
  pngBtn.title = "选一张 PNG 原图：从它的文件信息里找回「生成这张图用的布局提示词」（框、类型、编号、文字、描述、整体描述），同时把这张图按原图尺寸铺成背景图1、画布尺寸来源自动切到「按图片原始尺寸」。\n"
    + "不管这张图是哪个节点、哪个工作流生成的，只要工作流里某个节点的文本参数带着带 bbox 的布局 JSON，就能导入；只有接在出图链路上的那份会被优先采用。\n"
    + "如果生成这张图用的是自然语言提示词（没有 bbox），会把那段提示词放进「整体描述」，不生成框。\n"
    + "图片被压缩/转存工具抹掉文件信息时读不到。";
  pngBtn.addEventListener("click", () => startPngImport());
  topBar.appendChild(pngBtn);
  // 「切换排版」：这张图里有多份排版时，直接换一份重新导入，不用再选文件
  const switchBtn = el("button", "yx-chip yx-act yx-act-image yx-ic yx-ic-swap", "切换排版");
  switchBtn.type = "button";
  switchBtn.title = "当导入的这张原图里有多份排版、而刚才选的那份不对时，点这里直接换一份（会再弹一次排版列表），不用重新选文件。\n"
    + "对左上角「导入原图」输入口接进来的图同样有效：那张图有多份排版时，这个键也可以直接切换。\n"
    + "图里只有一份排版（或没有布局 JSON）时，这个键是灰的。";
  switchBtn.disabled = true;
  switchBtn.addEventListener("click", () => {
    if (!state.pngCandidates.length) {
      showToast("这张图里没有多份排版可选");
      return;
    }
    openPngChooser(state.pngCandidates, switchBtn, state.pngImageUrl);
  });
  topBar.appendChild(switchBtn);
  // 只有「这次导入的图确实有多份排版」时才让切换键可用
  const syncLayoutSwitch = () => {
    const usable = state.pngCandidates.length > 1;
    switchBtn.disabled = !usable;
    switchBtn.title = usable
      ? `这张图里有 ${state.pngCandidates.length} 份排版，点这里换一份（不用重新选文件）`
      : "这张图里没有多份排版可选（图里只有一份排版，或没有布局 JSON）";
  };
  const savePresetBtn = el("button", "yx-chip yx-act yx-act-preset yx-ic yx-ic-save", "保存预设");
  savePresetBtn.type = "button";
  savePresetBtn.title = "把当前节点的全部参数、画布上的框和背景图信息保存成一个预设，下次一键还原";
  savePresetBtn.addEventListener("click", () => openSavePreset());
  const managePresetBtn = el("button", "yx-chip yx-act yx-act-preset yx-ic yx-ic-folder", "管理预设");
  managePresetBtn.type = "button";
  managePresetBtn.title = "查看、整理（文件夹）、改名、排序、搜索、加载或删除已保存的预设";
  managePresetBtn.addEventListener("click", () => openPresetManager());
  topBar.appendChild(savePresetBtn);
  topBar.appendChild(managePresetBtn);

  const head = el("div", "yx-head");
  // 第二行工具条：网格 / 坐标 / 等分线 / 画布区高度（原来都挤在「只画框」那一行里）
  const toolsRow = el("div", "yx-bar yx-tools");
  // 只画框：打开后在画布上只能画新框，不能选中/拖动/缩放/删除已有内容
  const drawOnlyBtn = el("button", "yx-chip yx-tool yx-ic yx-ic-pencil", "只画框");
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
    const typeClass = type === TYPE_TEXT ? "yx-t-text" : (type === TYPE_CHAR ? "yx-t-char" : "yx-t-obj");
    const chip = el("button", `yx-chip yx-type ${typeClass}`, type);
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
  const gridBtn = el("button", "yx-chip yx-tool yx-on yx-ic yx-ic-grid", "网格");
  gridBtn.type = "button";
  gridBtn.title = "显示 / 隐藏 16 像素网格";
  gridBtn.addEventListener("click", () => {
    state.grid = state.grid === false;
    gridBtn.classList.toggle("yx-on", state.grid !== false);
    paint();
  });
  const axesBtn = el("button", "yx-chip yx-tool yx-on yx-ic yx-ic-axes", "坐标");
  axesBtn.type = "button";
  axesBtn.title = "显示 / 隐藏 左下角原点的坐标系刻度";
  axesBtnRef = axesBtn;
  axesBtn.addEventListener("click", () => {
    // 现在画的是草稿 JSON 那一套：点「坐标」就切回左下角原点
    if (coordIsDraft()) {
      state.axes = true;
      setCoordMode("canvas");
      return;
    }
    state.axes = state.axes === false;
    syncCoordButtons();
    paint();
  });
  // 草稿 JSON 坐标：左上角原点、y 向下。和「坐标」互斥，同一时刻只画一套刻度
  draftCoordBtn = el("button", "yx-chip yx-tool yx-ic yx-ic-axes", "草稿坐标");
  draftCoordBtn.type = "button";
  draftCoordBtn.addEventListener("click", () => {
    if (!coordIsDraft()) {
      state.axes = true;
      setCoordMode("draft");
      return;
    }
    state.axes = state.axes === false;
    syncCoordButtons();
    paint();
  });
  syncCoordButtons();
  const multiBtn = el("button", "yx-chip yx-tool yx-ic yx-ic-layers", "多选");
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
  // 对角线：两条一起显示，颜色单独可调（默认和等分线一样）
  const diagBtn = el("button", "yx-chip", "对角线");
  diagBtn.type = "button";
  diagBtn.title = "打开后画两条对角线（左上→右下、右上→左下），用来对齐构图的对角线节奏；颜色用右边的色块调";
  const diagColor = el("input", "yx-color-in");
  diagColor.type = "color";
  diagColor.value = "#ff8a8a";
  diagColor.title = "对角线的颜色（默认和等分线一样是淡红色）";
  diagColor.addEventListener("input", () => {
    state.diagColor = diagColor.value;
    paint();
  });
  diagBtn.addEventListener("click", () => {
    state.diagOn = !state.diagOn;
    diagBtn.classList.toggle("yx-on", state.diagOn);
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
  // 网格往后的一串工具换到第二行（toolsRow），最右边仍是「画布区高度」
  toolsRow.appendChild(gridBtn);
  toolsRow.appendChild(axesBtn);
  toolsRow.appendChild(draftCoordBtn);
  toolsRow.appendChild(diagBtn);
  toolsRow.appendChild(diagColor);
  toolsRow.appendChild(hDivBtn);
  toolsRow.appendChild(hDivNum);
  toolsRow.appendChild(hDivColor);
  toolsRow.appendChild(vDivBtn);
  toolsRow.appendChild(vDivNum);
  toolsRow.appendChild(vDivColor);

  // 画布区高度（方案 A）：填了就按这个高度显示画布区，留空则按窗口预算 + 画布长宽比自动算。
  // 默认留空，所以初始高度和以前完全一样；值存在节点里，跨会话保留。
  const stageHField = el("label", "yx-rows-field");
  stageHField.title = "画布区（绘图区）的显示高度，单位像素。留空 = 自动（按窗口高度预算和画布长宽比算，180–520px）;\n"
    + "填数字 = 固定成这个高度（140–2600px）。拉宽节点画布区变宽、拉长节点不会改它——高度只由这里决定。";
  stageHField.appendChild(el("span", "yx-rows-cap", "画布区高度"));
  const stageHInput = el("input", "yx-rows-input");
  stageHInput.type = "text";
  stageHInput.inputMode = "numeric";
  stageHInput.maxLength = "4";
  stageHInput.placeholder = "自动";
  stageHInput.title = stageHField.title;
  stageHField.appendChild(stageHInput);
  toolsRow.appendChild(stageHField);
  state.stageHInput = stageHInput;
  stageHInput.value = state.stageH ? String(state.stageH) : "";
  stageHInput.addEventListener("input", () => {
    stageHInput.value = String(stageHInput.value || "").replace(/[^0-9]/g, "").slice(0, 4);
  });
  stageHInput.addEventListener("change", () => applyStageHeightInput());
  stageHInput.addEventListener("blur", () => applyStageHeightInput());
  stageHInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyStageHeightInput();
    }
  });

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

  // 列表拆成两块完全独立的区域：背景图区、绘框区。
  // 各自有自己的标题行、表头、滚动条和「显示行数」，一块再多也不会挤掉另一块。
  const makePanelScroll = (extraClass) => {
    const panel = el("div", `yx-scroll ${extraClass}`);
    // 列表要能拿焦点：2.0 只对「焦点就在 data-capture-wheel 元素里」的情况放行滚轮，
    // 所以按下列表时把焦点收到列表容器上（按在输入框/按钮上时不抢）
    panel.tabIndex = 0;
    panel.setAttribute("data-capture-wheel", "true");
    panel.addEventListener("pointerdown", (event) => {
      const hit = event.target;
      if (hit && typeof hit.closest === "function"
        && hit.closest("input, textarea, select, button")) return;
      try {
        panel.focus({ preventScroll: true });
      } catch (_error) {
        // 忽略
      }
    });
    return panel;
  };
  const list = el("div", "yx-list");
  // —— 背景图区（列表最上面）——
  const bgScroll = makePanelScroll("yx-scroll-bg");
  const bgTitle = el("div", "yx-group yx-group-bg");
  const bgTitleNote = el("span", "yx-group-note", "");
  const bgHead = el("div", "yx-row yx-header yx-bg-head");
  const bgRows = el("div", "yx-table yx-rows");
  bgTitle.appendChild(el("b", null, "背景图区"));
  bgTitle.appendChild(bgTitleNote);
  bgTitle.appendChild(makeRowsInput("bg"));
  bgScroll.appendChild(bgHead);
  bgScroll.appendChild(bgRows);
  // —— 绘框区（在背景图区下方，与它完全独立）——
  const boxScroll = makePanelScroll("yx-scroll-box");
  const boxTitle = el("div", "yx-group yx-group-box");
  const boxTitleNote = el("span", "yx-group-note", "");
  const tableHead = el("div", "yx-row yx-header");
  boxTitle.appendChild(el("b", null, "绘框区"));
  boxTitle.appendChild(boxTitleNote);
  boxTitle.appendChild(makeRowsInput("box"));
  // 列：移动 整体锁 | 选中 编号 | 锁 类型 | 锁 备注 | 锁 宽 | 锁 高 | 锁 压暗 | 锁 x | 锁 y | 显示 重置 画布 删除
  // 背景图区没有「文字」这一列，所以两套列宽表不同（见 CSS 的 .yx-row / .yx-row.yx-box-grid）
  const LABELS = ["", "", "选中", "编号", "", "类型", "", "备注", "", "宽", "", "高", "",
    "压暗%", "", "x", "", "y", "显示", "重置", "作画布", "删除"];
  // 绘框区少「重置 / 画布」两列，其余与背景图区一致（每个字段前面那一格就是它的锁）
  const BOX_LABELS = ["", "", "选中", "编号", "", "类型", "", "文字", "", "描述", "", "宽", "",
    "高", "", "颜色", "", "x", "", "y", "显示", "删除"];
  const HEAD_HINT = {
    选中: "勾上＝选中这一行（可多选）",
    编号: "只是图层名字，不影响上下叠放（层序只看列表上下顺序）。重排时列表最下面是 01、越往上号越大；点表头右边「重命名」（点两次确认），双击数字可以手改",
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
  const boxHeadCells = [];
  for (let i = 0; i < BOX_LABELS.length; i += 1) {
    const label = BOX_LABELS[i];
    const span = el("span", null, label);
    if (label && HEAD_HINT[label]) span.title = HEAD_HINT[label];
    else if (i === 1) span.title = "整体锁：锁上后这一行的类型 / 文字 / 描述 / 宽 / 高 / 颜色 / x / y 都不能改";
    // 「锁」这几个字从表头去掉了，但那一格仍然是锁的列：悬停仍能看到说明
    else if (i > 1 && label === "") span.title = "锁：锁上 / 解开它右边那个参数（图标在每一行的那一格）";
    boxHeadCells.push(span);
  }
  // 表头也用同一套竖线占位（透明），保证和数据行逐列对齐
  appendCells(tableHead, boxHeadCells, BOX_SEP, true);
  tableHead.classList.add("yx-box-grid");
  // 背景图区表头：直接用 LABELS（已经没有「文字」那一列，备注只有一格）
  const bgHeadCells = [];
  for (let i = 0; i < LABELS.length; i += 1) {
    const label = LABELS[i];
    const span = el("span", null, label);
    if (label && HEAD_HINT[label]) {
      span.title = HEAD_HINT[label];
    } else if (i === 1) {
      span.title = "整体锁：锁上后这张图的宽 / 高 / x / y / 备注 / 压暗都不能改";
    } else if (i > 1 && label === "") {
      span.title = "锁：锁上 / 解开它右边那个参数（图标在每一行的那一格）";
    }
    bgHeadCells.push(span);
  }
  appendCells(bgHead, bgHeadCells, BG_SEP, true);
  // 「编号」表头格：右边贴一颗「重命名」按钮＝按当前列表顺序重排编号。
  // 编号列从 30px 加宽到 64px 就是为了放下它（以及行里的编号锁 + 数字框）。
  // 重排方向：列表最下面那行（最早画的、画面最下层）＝01 / B1，往上依次 02、03…
  // 按钮要点两次：第一次变成「确认？」，6 秒内再点一次才真的重排（点了别的就取消）。
  const numHeadButtons = {};
  const clearNumArm = (which) => {
    const arm = state.numRenameArm;
    if (!arm || (which && arm.which !== which)) return;
    if (arm.timer) clearTimeout(arm.timer);
    const btn = numHeadButtons[arm.which];
    if (btn) {
      btn.textContent = "重命名";
      btn.classList.remove("yx-num-head-btn-arm");
    }
    state.numRenameArm = null;
  };
  const decorateNumHead = (span, which) => {
    if (!span) return;
    span.classList.add("yx-num-head");
    const btn = el("button", "yx-num-head-btn", "重命名");
    btn.type = "button";
    btn.title = which === "bg"
      ? "按背景图区当前顺序重排编号：列表最下面是 B1、往上依次 B2、B3…（编号被锁住的行不动，原图不参与）；点两次才执行"
      : "按绘框区当前顺序重排编号：列表最下面是 01、往上依次 02、03…（编号被锁住的行不动）；点两次才执行";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const arm = state.numRenameArm;
      if (arm && arm.which === which) {
        clearNumArm(which);
        renumberZone(which);
        return;
      }
      clearNumArm();
      btn.textContent = "确认？";
      btn.classList.add("yx-num-head-btn-arm");
      const timer = setTimeout(() => clearNumArm(which), 6000);
      // Node（自测环境）里别让这个定时器拖住进程退出；浏览器里是数字，跳过
      if (timer && typeof timer.unref === "function") timer.unref();
      state.numRenameArm = { which, timer };
    });
    numHeadButtons[which] = btn;
    span.appendChild(btn);
  };
  decorateNumHead(boxHeadCells[3], "box");
  decorateNumHead(bgHeadCells[3], "bg");

  // 表头里的「反选」：背景图区、绘框区各一个，只反选自己那一区的对象。
  // 它是个真按钮（能点、有悬停反馈），所以用按钮样式跟旁边的表头文字区分开。
  function makeHeadInvert(which) {
    const btn = el("button", "yx-head-btn", "反选");
    btn.type = "button";
    btn.title = which === "bg"
      ? "反选背景图：选中的取消、没选中的全部选中（只作用于背景图区，不动绘制框）"
      : "反选绘制框：选中的取消、没选中的全部选中（只作用于绘框区，不动背景图）";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const items = which === "bg" ? S.bgs.filter(Boolean) : S.boxes.slice();
      if (!items.length) return;
      for (const item of items) {
        if (S.selected.has(item)) S.selected.delete(item);
        else S.selected.add(item);
      }
      if (S.selected.size > 1 && !state.multi) {
        state.multi = true;
        multiBtn.classList.add("yx-on");
      }
      syncBarButtons();
      refreshRows();
      paint();
    });
    return btn;
  }
  const bgInvertBtn = makeHeadInvert("bg");
  const boxInvertBtn = makeHeadInvert("box");
  bgHead.appendChild(bgInvertBtn);
  tableHead.appendChild(boxInvertBtn);

  const rows = el("div", "yx-table yx-rows");
  boxScroll.appendChild(tableHead);
  boxScroll.appendChild(rows);
  // 背景图区在上、绘框区在下，两块各有自己的滚动条
  list.appendChild(bgTitle);
  list.appendChild(bgScroll);
  list.appendChild(boxTitle);
  list.appendChild(boxScroll);

  // 在「列表」和「描述框」里滚轮只滚它们自己：
  // 事件在 document 的捕获阶段就被拦下，不再冒泡到画布，所以不会把整个工作流视图缩放掉。
  // 挂在 document 而不是 root：Nodes 2.0 有时会把节点里的 DOM 内容挡在指针命中之外，
  // 这时事件目标是画布，只能靠坐标判断指针是否落在列表上（否则滚轮会变成缩放）。
  const scrollListByWheel = (list, event) => {
    // 先拦住：画布收到滚轮会把整个工作流视图缩放掉
    event.preventDefault();
    event.stopPropagation();
    const unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? Math.max(80, list.clientHeight) : 1;
    list.scrollTop += event.deltaY * unit;
  };
  const pointInPanel = (panel, event) => {
    try {
      const rect = panel.getBoundingClientRect();
      if (!rect || !(rect.width > 0 && rect.height > 0)) return false;
      const x = Number(event.clientX) || 0;
      const y = Number(event.clientY) || 0;
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    } catch (_error) {
      return false;
    }
  };
  // 两个分区各自滚动：按指针位置判断落在哪一个区里
  const panelAtPoint = (event) => {
    for (const panel of [bgScroll, boxScroll]) {
      if (pointInPanel(panel, event)) return panel;
    }
    return null;
  };
  // 输入框（包括点开三角后弹出的大输入框）里滚轮只滚这个输入框自己：
  // 只拦住冒泡（不让画布缩放），绝不 preventDefault，也不把它当成「在列表上滚动」。
  const isEditable = (target) => {
    if (!target || typeof target.closest !== "function") return null;
    return target.closest("textarea, input, select, [contenteditable='true'], .yx-prose-area");
  };
  const onWheelCapture = (event) => {
    const target = event.target;
    const canClosest = target && typeof target.closest === "function";
    const editable = isEditable(target);
    if (editable) {
      event.stopPropagation();
      return;
    }
    const panel = canClosest ? target.closest(".yx-scroll") : null;
    if (panel) {
      scrollListByWheel(panel, event);
      return;
    }
    if (canClosest && target.closest(".yx-root")) return;
    // 目标不在这个节点里（2.0 挡在命中之外时的表现）：按坐标兜底
    const fallback = panelAtPoint(event);
    if (fallback) scrollListByWheel(fallback, event);
  };
  state.wheelListHandler = onWheelCapture;
  document.addEventListener("wheel", onWheelCapture, { capture: true, passive: false });

  root.appendChild(topBar);
  root.appendChild(head);
  root.appendChild(toolsRow);
  root.appendChild(stage);

  // 绘图区与列表之间的一排操作键
  const tableBar = el("div", "yx-bar");
  const allBoxesBtn = el("button", "yx-chip yx-tool yx-ic yx-ic-select", "全选框");
  allBoxesBtn.type = "button";
  allBoxesBtn.title = "点一下选中所有绘制框（不含背景图），再点一下取消全选";
  const allBgBtn = el("button", "yx-chip yx-tool yx-ic yx-ic-images", "全选背景");
  allBgBtn.type = "button";
  allBgBtn.title = "点一下选中所有背景图，再点一下取消全选";
  const delSelBtn = el("button", "yx-chip yx-soft-danger yx-ic yx-ic-trash", "删除选中");
  delSelBtn.type = "button";
  delSelBtn.title = "删除所有选中的框和背景图（点两次才生效）";
  const hideSelBtn = el("button", "yx-chip yx-tool yx-ic yx-ic-eye", "隐藏选中");
  hideSelBtn.type = "button";
  hideSelBtn.title = "把选中的框 / 背景图隐藏（隐藏后不画在预览里、也不参与提示词编译）。\n"
    + "隐藏和取消隐藏是两个独立按键，藏完可以直接去选别的对象继续藏，不用先恢复。";
  const showSelBtn = el("button", "yx-chip yx-tool yx-ic yx-ic-eye", "取消隐藏选中");
  showSelBtn.type = "button";
  showSelBtn.title = "把选中的对象恢复显示（只要它现在是隐藏状态）。和「隐藏选中」互不影响，随时可点。";

  const syncBarButtons = () => {
    const allBoxesOn = S.boxes.length > 0 && S.boxes.every((box) => S.selected.has(box));
    allBoxesBtn.classList.toggle("yx-on", allBoxesOn);
    allBoxesBtn.textContent = allBoxesOn ? "取消全选框" : "全选框";
    const bgs = S.bgs.filter(Boolean);
    const allBgOn = bgs.length > 0 && bgs.every((bg) => S.selected.has(bg));
    allBgBtn.classList.toggle("yx-on", allBgOn);
    allBgBtn.textContent = allBgOn ? "取消全选背景" : "全选背景";
    // 选中里有没有隐藏的：有就把「取消隐藏选中」点亮，方便一眼看出能恢复
    const anyHidden = [...S.selected].some((item) => item && item.hidden);
    showSelBtn.classList.toggle("yx-on", anyHidden);
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
    syncBarButtons();
    refreshRows();
    paint();
  });
  // ---- 复制 / 粘贴（Ctrl+C / Ctrl+V，右键菜单里也有一份）
  // 剪贴板里永远只有一个对象：复制框会覆盖之前复制的图，复制图也会覆盖之前复制的框。
  let clipboardItem = null;
  const boxLabel = (box) => {
    const no = Number(box?.__no) || 0;
    const fallback = Math.max(1, S.boxes.indexOf(box) + 1);
    return `框${String(no > 0 ? no : fallback).padStart(2, "0")}`;
  };
  const bgLabel = (bg) => (isSourceBg(bg) ? SOURCE_LABEL : `背景图B${Number(bg?.__no) || (Number(bg?.slot) || 0) + 1}`);
  const itemLabel = (item) => (item && item.isBg ? bgLabel(item) : boxLabel(item));
  const clipboardLabel = () => (clipboardItem ? clipboardItem.label : "");

  const copySelection = () => {
    const items = [...S.selected].filter(Boolean);
    if (!items.length) return false;
    // 多选时只复制排在最上面的那个（和画面层级一致）
    const src = items[0];
    if (src.isBg) {
      // 原图那一行绑定的是「导入原图」接口的图，复制出来没有来源，直接不复制
      if (isSourceBg(src)) return false;
      if (src.lockedCanvas) return false;
      clipboardItem = {
        kind: "bg",
        label: bgLabel(src),
        slot: src.slot,
        url: src.url || "",
        x: src.x,
        y: src.y,
        w: src.w,
        h: src.h,
        desc: src.desc || "",
        dim: clamp(Number(src.dim) || 45, 1, 100),
        natW: src.natW,
        natH: src.natH,
        image: src.image || null,
        lock: { ...(src.lock || {}) },
      };
    } else {
      clipboardItem = {
        kind: "box",
        label: boxLabel(src),
        type: src.type,
        x: src.x,
        y: src.y,
        w: src.w,
        h: src.h,
        text: src.text || "",
        desc: src.desc || "",
        palette: [...(src.palette || [])],
      };
    }
    return true;
  };

  const pasteClipboard = () => {
    const src = clipboardItem;
    if (!src) return false;
    const made = [];
    if (src.kind === "bg") {
      const bg = {
        isBg: true,
        // 副本沿用原来那张图的 slot：后端还是拿同一张图，只是换个位置/尺寸再画一遍
        slot: src.slot,
        x: Math.max(0, Math.min(src.x + 16, S.width - Math.min(src.w, S.width))),
        y: Math.max(0, Math.min(src.y + 16, S.height - Math.min(src.h, S.height))),
        w: src.w,
        h: src.h,
        hidden: false,
        desc: src.desc,
        url: src.url,
        dim: clamp(Number(src.dim) || 45, 1, 100),
        lockedCanvas: false,
        lockAll: false,
        lock: { ...src.lock },
        image: src.image || null,
        natW: src.natW,
        natH: src.natH,
      };
      bg.__no = nextLabelNo(S.bgs);
      S.bgs.unshift(bg);
      made.push(bg);
    } else {
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
      box.__no = nextLabelNo(S.boxes);
      S.boxes.unshift(box);   // 新框放在最上层，和列表第一行对应
      made.push(box);
    }
    S.selected.clear();
    for (const item of made) S.selected.add(item);
    refreshRows();
    layout();
    commit();
    paint();
    return true;
  };

  // 复制并粘贴：先复制当前选中，再立刻贴一份
  const copyAndPaste = () => {
    if (!copySelection()) return false;
    return pasteClipboard();
  };
  state.copyAndPaste = copyAndPaste;

  // ---- 删除（画布右键菜单、键盘 Delete、工具条按钮三处共用一套二次确认）
  const deleteSelected = () => {
    const boxes = [...S.selected].filter((item) => !item.isBg);
    const bgs = [...S.selected].filter((item) => item.isBg);
    if (!boxes.length && !bgs.length) return false;
    S.boxes = S.boxes.filter((box) => !boxes.includes(box));
    for (const bg of bgs) {
      // 原图那一行没有输入口，直接撤掉
      if (isSourceBg(bg)) {
        S.bgs = S.bgs.filter((item) => item !== bg);
        S.rows.delete(bg);
        continue;
      }
      // 同一个输入口可能被复制出好几份：只有最后一份也删掉时才断线
      const stillUsed = S.bgs.some((item) => item !== bg && item.slot === bg.slot);
      const slot = stillUsed ? null : (node.inputs || []).find((s) => bgSlotIndex(s.name) === bg.slot);
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

  // ---- 隐藏 / 取消隐藏（工具条两个按键 + 画布右键菜单共用）
  const hideSelected = () => {
    const items = [...S.selected].filter(Boolean);
    if (!items.length) return false;
    for (const item of items) item.hidden = true;
    // 藏完就清空选中：可以直接接着选别的对象继续藏，不用先恢复
    S.selected.clear();
    syncBarButtons();
    refreshRows();
    commit();
    paint();
    return true;
  };
  const showSelected = () => {
    const items = [...S.selected].filter((item) => item && item.hidden);
    if (!items.length) return false;
    for (const item of items) item.hidden = false;
    syncBarButtons();
    refreshRows();
    commit();
    paint();
    return true;
  };
  state.hideSelected = hideSelected;
  state.showSelected = showSelected;
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
    hideSelected();
  });
  showSelBtn.addEventListener("click", () => {
    showSelected();
  });
  tableBar.appendChild(multiBtn);
  tableBar.appendChild(allBoxesBtn);
  tableBar.appendChild(allBgBtn);
  tableBar.appendChild(delSelBtn);
  tableBar.appendChild(hideSelBtn);
  tableBar.appendChild(showSelBtn);

  const undoBtn = el("button", "yx-chip yx-undo yx-ic yx-ic-undo", "撤销");
  undoBtn.type = "button";
  undoBtn.title = "撤销上一步操作（只影响这个节点，最多保留 60 步）";
  undoBtn.addEventListener("click", () => {
    undoStep();
  });
  state.undoBtn = undoBtn;
  tableBar.appendChild(undoBtn);

  const redoBtn = el("button", "yx-chip yx-undo yx-ic yx-ic-redo", "重做");
  redoBtn.type = "button";
  redoBtn.title = "重做刚才撤销的那一步（最多 60 步）";
  redoBtn.addEventListener("click", () => {
    redoStep();
  });
  state.redoBtn = redoBtn;
  tableBar.appendChild(redoBtn);

  root.appendChild(tableBar);

  root.appendChild(list);

  // ---------------------------------------------------------------- 显示行数
  // 背景图区、绘框区各有一个「显示行数」，各管各的：只统计自己下面带编号的行，
  // 区块标题行和表头永远显示、永远不算在行数里。
  // 这个数字优先级最高：填几行就最多露几行，超出的用滚轮看；填的数 ≥ 实际行数就是全部显示。
  function makeRowsInput(which) {
    const isBg = which === "bg";
    const field = el("label", "yx-rows-field");
    field.title = (isBg ? "背景图区的显示行数" : "绘框区的显示行数")
      + "：只数这一区下面带编号的行（本区标题行和表头不算，永远显示）。"
      + "填 0 就只剩标题行和表头；填的数大于等于实际行数时显示全部行；超出的部分在本区里滚轮查看。默认 20。";
    const cap = el("span", "yx-rows-cap", "显示行数");
    const input = el("input", "yx-rows-input");
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.maxLength = 3;
    input.title = field.title;
    input.value = String(isBg ? state.bgShowRows : state.boxShowRows);
    field.appendChild(cap);
    field.appendChild(input);
    if (isBg) state.bgRowsInput = input;
    else state.boxRowsInput = input;

    const apply = () => {
      const digits = String(input.value || "").replace(/[^0-9]/g, "");
      const next = Math.min(LIST_ROW_LIMIT, digits ? parseInt(digits, 10) : 0);
      input.value = String(next);
      const key = isBg ? "bgShowRows" : "boxShowRows";
      if (next === state[key]) return;
      state[key] = next;
      try {
        node.properties = node.properties || {};
        node.properties[isBg ? "yxBgRows" : "yxBoxRows"] = next;
      } catch (_error) {
        // 忽略
      }
      layout();
      growNodeToFit();
      node.graph?.setDirtyCanvas?.(true, true);
    };
    // 输入过程中只把非数字清掉，失焦 / 回车 / 内容变化时才真正套用，免得每敲一位就重排一次
    input.addEventListener("input", () => {
      input.value = String(input.value || "").replace(/[^0-9]/g, "").slice(0, 3);
    });
    input.addEventListener("change", apply);
    input.addEventListener("blur", apply);
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      apply();
      input.blur();
    });
    return field;
  }

  // 行数调大后界面会跟着变高：节点高度不够就撑到刚好够用（只加不减，不动你自己拉的尺寸）
  const growNodeToFit = () => {
    try {
      const need = Math.round(neededNodeHeight());
      const current = Math.round(Number(node?.size?.[1]) || 0);
      if (node?.setSize && need > current) node.setSize([node.size[0], need]);
    } catch (_error) {
      // 忽略
    }
  };

  // ---------------------------------------------------------------- 底部状态栏
  // 只做只读信息展示：版本号 / 框与背景数量 / 画布尺寸 / 缩放 / 网格。
  // 给它一个固定的收口，列表区滚到底时不再是「突然被切断」的样子。
  const STATUS_VERSION = "1.0.4";
  const statusBar = el("div", "yx-statusbar");
  const sbLeft = el("div", "yx-sb-group");
  const sbRight = el("div", "yx-sb-group");
  const sbVer = el("span", "yx-sb-ver", `MOSS YXBOX v${STATUS_VERSION}`);
  const sbCounts = el("span", null, "框 0 / 背景 0");
  const sbCanvas = el("span", null, "");
  const sbZoom = el("span", null, "");
  const sbGrid = el("span", null, "");
  sbLeft.appendChild(sbVer);
  sbLeft.appendChild(el("span", "yx-sb-sep", "·"));
  sbLeft.appendChild(sbCounts);
  sbRight.appendChild(sbCanvas);
  sbRight.appendChild(el("span", "yx-sb-sep", "·"));
  sbRight.appendChild(sbZoom);
  sbRight.appendChild(el("span", "yx-sb-sep", "·"));
  sbRight.appendChild(sbGrid);
  statusBar.appendChild(sbLeft);
  statusBar.appendChild(sbRight);
  root.appendChild(statusBar);

  // 只在内容真的变了才写 DOM（paint 会频繁调用，这里做了字符串比较）
  let statusCache = "";
  const updateStatus = () => {
    const boxCount = S.boxes.length;
    const bgCount = S.bgs.filter(Boolean).length;
    const zoom = Math.round((state.zoom || 1) * 100);
    const gridOff = state.grid === false;
    const key = `${boxCount}|${bgCount}|${S.width}|${S.height}|${zoom}|${gridOff}`;
    if (statusCache === key) return;
    statusCache = key;
    sbCounts.textContent = `框 ${boxCount} / 背景 ${bgCount}`;
    sbCanvas.textContent = `画布 ${S.width}×${S.height}`;
    sbZoom.textContent = `缩放 ${zoom}%`;
    sbGrid.textContent = gridOff ? "网格 关" : "网格 16";
  };
  state.updateStatus = updateStatus;
  updateStatus();

  // ---------------------------------------------------------------- 右键菜单
  const menu = el("div", "yx-menu");
  menu.style.display = "none";
  root.appendChild(menu);

  const closeMenu = () => {
    menu.style.display = "none";
    menu.textContent = "";
    state.menuSticky = false;
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

  const buildMenu = (emptyOnly = false) => {
    menu.textContent = "";
    const boxes = selectedBoxes();
    const bgs = selectedBgs();
    const head = el("div", "yx-menu-title");
    if (emptyOnly || !S.selected.size) {
      // 没选中任何对象：只给一个「粘贴」入口，贴的是剪贴板里最后复制的那一个
      head.textContent = "未选中对象";
      menu.appendChild(head);
      menuItem(clipboardItem ? `粘贴“${clipboardLabel()}”（Ctrl+V）` : "粘贴（剪贴板是空的）", () => {
        if (pasteClipboard()) closeMenu();
      });
      return;
    }
    head.textContent = S.selected.size === 1
      ? (bgs.length ? "背景图" : "绘制框")
      : `已选中 ${S.selected.size} 个对象`;
    menu.appendChild(head);
    // 菜单里显示的“对象名”，复制 / 复制并粘贴都用它
    const first = [...S.selected][0];
    const selLabel = itemLabel(first) + (S.selected.size > 1 ? ` 等 ${S.selected.size} 个` : "");

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

    // 隐藏选中：同样是两次确认，避免误点把画好的框藏起来；框和背景图都支持
    menuItem("隐藏选中（点两次）", (item) => {
      if (item.dataset.armed === "1") {
        closeMenu();
        hideSelected();
        return;
      }
      item.dataset.armed = "1";
      item.textContent = `确认隐藏 ${S.selected.size} 个?`;
      item.classList.add("yx-menu-armed");
    });

    const hasClipboard = !!clipboardItem;
    menuItem(`复制“${selLabel}”（Ctrl+C）`, () => {
      if (!copySelection()) return;
      closeMenu();
    });

    menuItem(`复制并粘贴“${selLabel}”`, () => {
      if (!copyAndPaste()) return;
      closeMenu();
    });

    menuItem(hasClipboard ? `粘贴“${clipboardLabel()}”（Ctrl+V）` : "粘贴（剪贴板是空的）", () => {
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
    if (bgs.length) {
      menu.appendChild(el("div", "yx-menu-sep", ""));
      menu.appendChild(el("div", "yx-menu-label", "背景图"));
      menuItem("填满画布（等比撑满，超出的裁掉）", () => {
        let changed = false;
        for (const bg of selectedBgs()) {
          if (fillBgIntoCanvas(bg)) changed = true;
        }
        if (changed) {
          syncRows();
          layout();
          commit();
          paint();
        }
        closeMenu();
      });
      menuItem("按原比例放进画布（左下角对齐）", () => {
        let changed = false;
        for (const bg of selectedBgs()) {
          if (!bg.natW || !bg.natH) continue;
          bg.lockedCanvas = false;
          bg.hidden = false;
          placeInitial(bg);
          changed = true;
        }
        if (changed) {
          syncRows();
          layout();
          commit();
          paint();
        }
        closeMenu();
      });
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
    // 右键不再顺手选中对象：必须先左键选中，右键才作用在已选中的对象上。
    // 没选中任何东西时，右键只给「粘贴」——位置随便点都行。
    const emptyOnly = S.selected.size === 0;
    buildMenu(emptyOnly);
    const rect = root.getBoundingClientRect();
    const k = viewScale(root);
    menu.style.display = "block";
    const mw = menu.offsetWidth || 180;
    const mh = menu.offsetHeight || 140;
    const boxW = root.clientWidth || rect.width;
    const boxH = root.clientHeight || rect.height;
    let left = (event.clientX - rect.left) / k;
    let top = (event.clientY - rect.top) / k;
    if (left + mw > boxW - 6) left = Math.max(6, boxW - mw - 6);
    if (top + mh > boxH - 6) top = Math.max(6, boxH - mh - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  });

  document.addEventListener("pointerdown", (event) => {
    if (menu.style.display === "none") return;
    if (event.target && menu.contains && menu.contains(event.target)) return;
    // 「选排版」的弹窗是粘住的：点到别的节点里也不关，几个节点可以同时弹着各选各的
    if (state.menuSticky && !(state.root && state.root.contains(event.target))) return;
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
  state.diagOn = false;
  state.diagColor = "#ff8a8a";
  state.vDivOn = false;
  state.vDiv = 3;
  state.vDivColor = "#ff8a8a";
  state.S = S;
  chips.get(TYPE_OBJ)?.classList.add("yx-active");

  // ---------------------------------------------------------------- geometry
  // 缩放/平移只影响「显示」，不改变画布尺寸与任何坐标值
  // 工作流整体缩放（ComfyUI 缩放视图）会给节点套 CSS transform：此时
  // getBoundingClientRect() 给的是「视觉像素」，clientWidth/Height 才是「布局像素」。
  // 画布内的一切坐标都必须用布局像素，否则一缩放视图，画布内容就会整体位移。
  const viewScale = (el) => {
    if (!el) return 1;
    const w = el.clientWidth || 0;
    if (!w) return 1;
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const rw = rect?.width || 0;
    if (!rw) return 1;
    const k = rw / w;
    return Number.isFinite(k) && k > 0 ? k : 1;
  };

  const geo = () => {
    const rect = canvas.getBoundingClientRect();
    // 布局像素尺寸（不受工作流缩放影响）
    const cw = Math.max(1, canvas.clientWidth || rect.width || 1);
    const ch = Math.max(1, canvas.clientHeight || rect.height || 1);
    const k = viewScale(canvas);
    const fit = Math.min(cw / S.width, ch / S.height) || 1;
    const scale = fit * (state.zoom || 1);
    return {
      rect, cw, ch, k, fit, scale,
      ox: (cw - S.width * scale) / 2 + (state.panX || 0),
      oy: (ch - S.height * scale) / 2 + (state.panY || 0),
    };
  };

  const eventPoint = (event) => {
    const g = geo();
    // 先把鼠标的视觉坐标换算回布局像素，再减去画布内偏移
    const k = g.k || 1;
    return {
      x: ((event.clientX - g.rect.left) / k - g.ox) / g.scale,
      y: ((event.clientY - g.rect.top) / k - g.oy) / g.scale,
    };
  };

  // 调试/自测钩子：控制台里可直接调用换算与重绘
  state.eventPointForTest = eventPoint;
  state.paint = () => paint();
  state.geo = geo;
  state.viewScale = viewScale;

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

  // 画布宽高 / 画布缩放长度受「画布宽高取整倍数」约束：箭头一次走一个倍数，手输值吸附到倍数；
  // 倍数选「无」时两者都退回 1。列表里的框宽高 / x / y 不受这个参数管，箭头永远 ±1。
  const canvasStep = () => {
    const mult = multiple();
    return mult >= 2 ? mult : 1;
  };
  const snapCanvasValue = (value, minValue = 16) => {
    const raw = Math.round(Number(value));
    if (!Number.isFinite(raw)) return null;
    const step = canvasStep();
    const snapped = step >= 2 ? Math.round(raw / step) * step : raw;
    return clamp(snapped, minValue, MAX_SIZE);
  };
  // 原生数字控件：能拿到 DOM 输入框就把 step 写进去（上下箭头按 step 走），拿不到就退回 options.step
  const canvasInput = (w) => w?.inputEl || w?.element?.querySelector?.("input") || null;
  let lastCanvasStep = -1;
  // 把步长同时写到 widget.options.step（经典画布的上下箭头）、widget.step、以及真实 input 的 step
  // （Nodes 2.0 的「+ / −」按钮与浏览器数字框都读这几个），少写一处就会出现「改了倍数但还是按 16 走」
  const applyStep = (w, step) => {
    if (!w) return;
    try {
      if (w.options && w.options.step !== step) w.options.step = step;
      if (w.step !== step) w.step = step;
      const input = canvasInput(w);
      if (input && input.step !== String(step)) input.step = String(step);
    } catch (_error) {
      // 忽略
    }
  };
  const syncCanvasStep = (force = false) => {
    const step = canvasStep();
    if (!force && step === lastCanvasStep) return;
    lastCanvasStep = step;
    for (const w of [wWidth, wHeight, wLength]) applyStep(w, step);
  };
  // 手输的值吸附到倍数后再回填控件与输入框
  const snapCanvasWidget = (w, minValue = 16) => {
    if (!w) return false;
    const snapped = snapCanvasValue(w.value, minValue);
    if (snapped == null) return false;
    const changed = Math.round(Number(w.value)) !== snapped;
    if (changed) {
      w.value = snapped;
      const input = canvasInput(w);
      if (input) input.value = String(snapped);
    }
    return changed;
  };

  // ComfyUI 后端给 INT 控件写死的默认步长（画布宽 / 画布高是 16，画布缩放长度是 1）。
  // 前端 2.0 的「+ / −」和经典画布的上下箭头都可能按这个默认值走，改 options.step 不一定生效，
  // 所以这里再兜一层：把点出来的值重新归一到「画布宽高取整倍数」上。
  const CANVAS_ARROW_STEP = 16;
  const canvasPrev = new Map();
  const rememberCanvasValue = (w) => {
    if (w) canvasPrev.set(w, Number(w.value));
  };
  const normalizeCanvasValue = (w, minValue = 16) => {
    if (!w) return false;
    const raw = Number(w.value);
    if (!Number.isFinite(raw)) return false;
    const step = canvasStep();
    const prev = canvasPrev.get(w);
    const diff = prev == null ? 0 : raw - prev;
    const dir = Math.sign(diff);
    const abs = Math.abs(diff);
    let value = raw;
    if (step >= 2 && dir && (abs === CANVAS_ARROW_STEP || abs < step)) {
      // 箭头 / 加减号只走了后端默认的那一小步（或走不到我们的步长）：按我们的步长走一格
      value = prev + dir * step;
    } else if (step >= 2) {
      // 手输：吸附到最近的倍数
      value = Math.round(raw / step) * step;
    }
    value = clamp(Math.round(value), minValue, MAX_SIZE);
    canvasPrev.set(w, value);
    if (value !== raw) {
      w.value = value;
      const input = canvasInput(w);
      if (input && input.value !== String(value)) input.value = String(value);
    }
    return value !== raw;
  };
  const normalizeCanvasWidget = (w, minValue = 16) => normalizeCanvasValue(w, minValue);

  // 「第一张背景图」只算真正的背景图，原图那一行不算（它有自己的尺寸来源开关）
  const activeBg = () => S.bgs.find((bg) => bg && bg.image && !isSourceBg(bg)) || null;

  // 当前画布比例指向的那张图（按原图 / 按背景图N / 自动项）；固定比例返回 null
  function aspectBgOf(aspect) {
    const text = String(aspect ?? "");
    const sized = (item) => !!item && Number(item.natW) > 0 && Number(item.natH) > 0;
    if (text === ASPECT_SOURCE) {
      return sized(sourceBg()) ? sourceBg() : null;
    }
    const hit = ASPECT_BG_RE.exec(text);
    if (hit) {
      const slot = Number(hit[1]) - 1;
      const bg = S.bgs.find((item) => item && item.kind !== SOURCE_KIND && Number(item.slot) === slot);
      return sized(bg) ? bg : null;
    }
    if (text === ASPECT_AUTO || text === ASPECT_LEGACY) {
      const source = sourceBg();
      if (sized(source)) return source;
      return activeBg();
    }
    return null;
  }

  // 画布比例下拉的可选项：原图 + 每个已接上的背景图；一张图都没有时只留「自动项」
  function aspectOptions() {
    const list = [];
    const known = (item) => !!item && (Number(item.natW) > 0 || Number(item.natH) > 0
      || !!item.url || !!item.image);
    const source = sourceBg();
    if (known(source)) list.push(ASPECT_SOURCE);
    const entries = S.bgs
      .filter((bg) => bg && bg.kind !== SOURCE_KIND && Number(bg.slot) >= 0 && known(bg))
      .slice()
      .sort((a, b) => Number(a.slot) - Number(b.slot));
    for (const bg of entries) list.push(`按背景图${Number(bg.slot) + 1}`);
    if (!list.length) list.push(ASPECT_AUTO);
    for (const fixed of ASPECT_FIXED) list.push(fixed);
    return list;
  }

  // 选项跟着图变：
  //   没有图 → 只有「按导入的原图或接入的背景图比例」
  //   接上第一张图 / 导入原图 → 自动项换成「按背景图1」「按原图」等
  //   已经选了某一张 → 接新图不改它，只是下拉里多出「按背景图N」
  //   选中的那张图断线了 → 退到第一张还能用的图，都没有就退回自动项
  function syncAspectOptions() {
    if (!wAspect) return;
    const list = aspectOptions();
    const key = list.join("|");
    const imageOptions = list.filter((v) => v === ASPECT_SOURCE || ASPECT_BG_RE.test(v));
    const current = String(wAspect.value ?? "");
    if (key !== state.aspectKey) {
      state.aspectKey = key;
      try {
        if (wAspect.options) {
          wAspect.options.values = list;
          wAspect.options.max = Math.max(0, list.length - 1);
        }
      } catch (_error) {
        // 框架偶尔不允许改 options，忽略（下一张图接入时还会再试一次）
      }
    }
    if (!list.includes(String(wAspect.value ?? ""))) {
      wAspect.value = imageOptions[0] || ASPECT_AUTO;
    }
    try {
      node.setDirtyCanvas?.(true, true);
      node.graph?.setDirtyCanvas?.(true, true);
      app?.canvas?.setDirty?.((true), true);
    } catch (_error) {
      // 忽略
    }
  }

  const aspectRatio = () => {
    const aspect = String(wAspect?.value ?? ASPECT_AUTO);
    if (aspect === "自定义") {
      return Math.max(1, numeric(wPropW, 1)) / Math.max(1, numeric(wPropH, 1));
    }
    const bg = aspectBgOf(aspect);
    const iw = Number(bg?.natW) || 0;
    const ih = Number(bg?.natH) || 0;
    if (iw > 0 && ih > 0) return iw / ih;
    // 还没有图（或那张图断开了）：先沿用画布当前比例，等图接上来再按它重算
    if (ASPECT_BG_RE.test(aspect) || aspect === ASPECT_SOURCE
      || aspect === ASPECT_AUTO || aspect === ASPECT_LEGACY) {
      return S.width / Math.max(1, S.height);
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
      // 画布宽高：后端出图/预览/提示词一律按这个尺寸算，
      // 这样「画布上看到的几乘几」就是生成图的几乘几，不管尺寸是从哪里来的。
      width: Math.round(S.width),
      height: Math.round(S.height),
      // 布局 JSON 之外的前后提示词（空字符串表示没有）
      prefix: String(state.prefix || ""),
      suffix: String(state.suffix || ""),
      boxes: S.boxes.map((box) => ({
        no: Number(box.__no) || 0,
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
        no: Number(bg.__no) || 0,
        kind: bg.kind === SOURCE_KIND ? SOURCE_KIND : "bg",
        slot: bg.slot,
        x: Math.round(bg.x),
        y: Math.round(bg.y),
        w: Math.round(bg.w),
        h: Math.round(bg.h),
        hidden: !!bg.hidden,
        desc: bg.desc || "",
        url: bg.url || "",
        dim: clamp(Number(bg.dim) || 45, 1, 100),
        lockedCanvas: !!bg.lockedCanvas,
        lockAll: !!bg.lockAll,
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
      // 撤销 / 重做也要把前置、后置提示词一起回到那一步（它们同样存在画布数据里）
      setSideProse(
        typeof payload.prefix === "string" ? payload.prefix : "",
        typeof payload.suffix === "string" ? payload.suffix : "",
      );
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
        __no: Number(box.no) || 0,
      }));
      S.bgs = (payload.bgs || []).map((bg) => {
        const old = prevBgs.find((item) => item.slot === bg.slot) ||
          prevBgs.find((item) => bg.url && item.url === bg.url);
        return {
          isBg: true,
          kind: bg.kind === SOURCE_KIND ? SOURCE_KIND : "bg",
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
          dim: clamp(Number(bg.dim) || 45, 1, 100),
          lockAll: !!bg.lockAll,
          __no: Number(bg.no) || 0,
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
      if (!bg || bg.kind === SOURCE_KIND) continue;
      if (bg.image || !bg.url || !(Number(bg.slot) >= 0)) continue;
      try {
        state.attachBackgroundByURL?.(Number(bg.slot), bg.url);
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
    // 画布宽 / 画布高 只在「自定义尺寸」模式下才等于画布实际尺寸；
    // 按图片原始尺寸 / 按缩放规则 时，这两个数字是用户自己的设定值，
    // 换图时不能跟着图片变（否则显示和实际就打架了）。
    if (String(wMode?.value ?? "自定义尺寸") !== "自定义尺寸") return;
    state.suppress = true;
    try {
      if (wWidth) wWidth.value = S.width;
      if (wHeight) wHeight.value = S.height;
    } finally {
      state.suppress = false;
    }
  };

  const refreshInfo = () => {
    syncAspectOptions();
    canvasInfo.innerHTML = `画布 <b>${Math.round(S.width)}×${Math.round(S.height)}</b>`;
    const rows = S.bgs.filter(Boolean);
    const count = rows.filter((bg) => bg.kind !== SOURCE_KIND).length;
    const hasSource = rows.some((bg) => bg.kind === SOURCE_KIND);
    bgInfo.innerHTML = `背景图 <b>${count}</b> 张${hasSource ? "（另有原图）" : ""}`;
  };

  const applyCanvasSize = (width, height, rescale) => {
    const w = clampSize(width);
    const h = clampSize(height);
    if (w === S.width && h === S.height) return false;
    const oldW = S.width;
    const oldH = S.height;
    const rx = oldW > 0 ? w / oldW : 1;
    const ry = oldH > 0 ? h / oldH : 1;
    // 画布长宽比没变：整组内容按同一个比例缩放（背景图也不会被拉变形）
    const sameRatio = Math.abs(rx - ry) <= Math.max(Math.abs(rx), 1e-9) * 1e-6;
    // 先写画布尺寸：下面按填充方式重贴背景图时要用新画布算矩形
    S.width = w;
    S.height = h;
    if (rescale && oldW > 0 && oldH > 0) {
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
        } else if (sameRatio) {
          // 比例没变：位置和尺寸一起等比缩放，画面内容不变形
          bg.x *= rx;
          bg.y *= ry;
          bg.w *= rx;
          bg.h *= ry;
        } else {
          // 比例变了：旧矩形已经不匹配新画布，按「背景图填充方式」重新贴一次
          fitBgToCanvas(bg);
        }
      }
    }
    // 立刻把新尺寸写进「画布数据」，别等下一次编辑：
    // 用户可能改完尺寸直接点运行，队列表里拿的是控件当前值。
    if (wData) wData.value = serialize();
    syncSizeWidgets();
    refreshInfo();
    refreshRows();
    layout();
    return true;
  };

  // 画布尺寸模式：只决定画布大小，不重新摆放背景图
  const applyModeSize = (rescale = true) => {
    const mode = String(wMode?.value ?? MODE_CUSTOM);
    if (mode === MODE_CUSTOM) {
      applyCanvasSize(numeric(wWidth, S.width), numeric(wHeight, S.height), true);
      return;
    }
    const picked = modeBgNat(mode);
    if (picked) {
      // 按原图尺寸：这一档不取整，画布精确等于原图像素（导出尺寸必须和原图一致）
      if (picked.exact) {
        applyCanvasSize(Math.round(picked.natW), Math.round(picked.natH), rescale);
      } else {
        const mult = multiple();
        applyCanvasSize(roundNear(picked.natW, mult), roundNear(picked.natH, mult), rescale);
      }
      return;
    }
    // 按缩放规则：拿列表最上面那张已接上的背景图作为基准
    const bg = activeBg();
    if (!bg || !bg.natW || !bg.natH) return;
    const mult = multiple();
    const [w, h] = scaledSize(bg.natW, bg.natH);
    applyCanvasSize(roundUp(w, mult), roundUp(h, mult), rescale);
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

  // 背景图按「背景图填充方式」算出的目标矩形：
  //   填充 = 画布本身（拉伸铺满）、裁切 = 等比放大到盖住画布、锁比例 / 留白 = 等比缩小到放进画布
  const bgFitRect = (bg) => {
    const natW = Number(bg?.natW) || 0;
    const natH = Number(bg?.natH) || 0;
    if (!natW || !natH) return { w: S.width, h: S.height };
    const fit = String(wFit?.value ?? "锁比例");
    if (fit === "填充") return { w: S.width, h: S.height };
    const scale = fit === "裁切"
      ? Math.max(S.width / natW, S.height / natH)
      : Math.min(S.width / natW, S.height / natH);
    return { w: Math.max(1, Math.round(natW * scale)), h: Math.max(1, Math.round(natH * scale)) };
  };

  // 把一张背景图重新贴到当前画布上：按填充方式给矩形、居中，锁住的字段不动
  const fitBgToCanvas = (bg) => {
    if (!bg) return false;
    const rect = bgFitRect(bg);
    const natW = Number(bg.natW) || 0;
    const natH = Number(bg.natH) || 0;
    if (!bg.lock?.w) bg.w = rect.w;
    if (!bg.lock?.h) bg.h = rect.h;
    // 只锁住一边时，另一边跟着这一边走，别把图片比例弄坏
    if (natW > 0 && natH > 0) {
      if (bg.lock?.w && !bg.lock?.h) bg.h = Math.max(1, Math.round(bg.w * natH / natW));
      else if (bg.lock?.h && !bg.lock?.w) bg.w = Math.max(1, Math.round(bg.h * natW / natH));
    }
    if (!bg.lock?.x) bg.x = Math.round((S.width - bg.w) / 2);
    if (!bg.lock?.y) bg.y = Math.round((S.height - bg.h) / 2);
    bg.lockedCanvas = false;
    clampBg(bg);
    return true;
  };

  // ---------------------------------------------------------------- rows
  // 整体锁：一次把这一行所有字段全部锁上 / 全部解开（任何一项还锁着就显示成锁住）
  const lockAllButton = (item, fields, title) => {
    const button = el("button", "yx-lock yx-lock-all");
    button.type = "button";
    button.title = `${title}：点一下全锁 / 再点全解锁`;
    const sync = () => {
      const lockedCount = fields.filter((field) => !!item.lock?.[field]).length;
      const all = lockedCount === fields.length;
      button.textContent = lockedCount ? "🔒" : "🔓";
      button.classList.toggle("yx-on", lockedCount > 0);
      button.title = all
        ? `${title}：已全部锁定，点这里全部解锁`
        : `${title}：点一下把这一行所有字段都锁上`;
    };
    button.addEventListener("click", () => {
      const all = fields.every((field) => !!item.lock?.[field]);
      item.lock = item.lock || {};
      for (const field of fields) item.lock[field] = !all;
      syncRows();
      paint();
      commit();
    });
    sync();
    button.__sync = sync;
    return button;
  };

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

  // 编号格 = 小锁 +（背景图才有 B 前缀）+ 数字框。
  // 单击这一格仍然是「选中这一行」（多选开着就是加选/减选），双击才进编辑；
  // 平时数字框 readonly，点一下连焦点都不给，免得和选行抢点击。
  const makeNumEditor = (item, which) => {
    const cell = el("div", "yx-num yx-num-cell");
    const input = el("input", "yx-no-input");
    input.type = "text";
    input.inputMode = "numeric";
    input.readOnly = true;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.title = which === "bg"
      ? "背景图编号（B1、B2…）：单击这一格是选中这张图；双击可以改编号（1–999，不能和其他背景图重复）"
      : "框编号（01、02…）：单击这一格是选中这个框；双击可以改编号（1–999，不能和其他框重复）";
    const lock = lockButton(item, "num", "编号");
    cell.appendChild(lock);
    cell.appendChild(input);
    const shown = () => {
      const n = Number(item.__no) || 0;
      if (n <= 0) return "";
      // 两个区都是「字母 + 数字」全在框里：背景图 B1、B2…，框 01、02…
      return which === "bg" ? "B" + n : String(n).padStart(2, "0");
    };
    const sync = (force) => {
      // 正在打字时别把用户输入刷回去（列表有定时刷新）；
      // force=true 用在「编辑结束」时——这时焦点可能还在框里，但必须把值刷回真正的编号
      if (!force && document.activeElement === input) return;
      input.readOnly = true;
      input.value = shown();
    };
    // 平时只读：按下不聚焦、不选中文本，让点击继续往上传给「选行」
    input.addEventListener("mousedown", (event) => {
      if (input.readOnly) event.preventDefault();
    });
    const sameZone = () => (which === "bg" ? S.bgs : S.boxes);
    const beginEdit = () => {
      if (isSourceBg(item) || item.lock?.num) return;
      // 双击 = 两次单击，第一次选中、第二次会取消选中；进编辑时把这一行重新选中，
      // 免得「正在改编号的那一行反而是没选中的」
      if (!S.selected.has(item)) {
        if (!state.multi) S.selected.clear();
        S.selected.add(item);
        syncRows();
        paint();
      }
      input.readOnly = false;
      input.focus();
      input.select();
    };
    const endEdit = (restore) => {
      if (input.readOnly) return;
      input.readOnly = true;
      if (restore) {
        sync(true);
        return;
      }
      // 背景图的框里显示的是「B1」，手改时带不带 B 都认（B7 / b7 / 7 都行）
      const text = String(input.value || "").trim().replace(/^[Bb]\s*/, "");
      const n = /^\d{1,3}$/.test(text) ? Number(text) : NaN;
      if (!(n >= 1 && n <= 999)) {
        showToast("编号只接受 1–999 的整数");
        sync(true);
        return;
      }
      const dup = sameZone().some((other) => other && other !== item
        && !isSourceBg(other) && (Number(other.__no) || 0) === n);
      if (dup) {
        showToast("编号 " + n + " 已经有别的图层在用了");
        sync(true);
        return;
      }
      if ((Number(item.__no) || 0) !== n) {
        item.__no = n;
        if (which === "bg") item.label = "B" + n;
        refreshRows();
        paint();
        commit();
      }
      sync(true);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        endEdit(false);
      } else if (event.key === "Escape") {
        event.preventDefault();
        endEdit(true);
      }
    });
    input.addEventListener("blur", () => endEdit(false));
    cell.addEventListener("dblclick", (event) => {
      if (event.target && event.target.closest && event.target.closest("button")) return;
      event.preventDefault();
      event.stopPropagation();
      beginEdit();
    });
    sync();
    return { cell, input, sync, beginEdit, endEdit };
  };

  const foldToggle = (button, area) => {
    const open = area.style.display === "none";
    area.style.display = open ? "block" : "none";
    button.classList.toggle("yx-open", open);
    button.textContent = open ? "▴" : "▾";
    layout();
  };

  // 行里的「宽松选中带」：从勾选框到 stopAt 这一格之前，点中间任何非控件的地方都算选中这一行
  // （绘框区到「编号」为止，背景图区到「备注」之前为止）
  const pickZone = (line, stopAt, item) => {
    line.addEventListener("click", (event) => {
      const target = event.target;
      if (!target || target.closest("input, textarea, select, button, .yx-drag")) return;
      // 「编号」格子有自己的点击处理（点一下切换选中），这里再走一遍会一开一关、等于没反应
      if (target.closest(".yx-num")) return;
      if (!stopAt || !stopAt.getBoundingClientRect) return;
      const edge = Number(stopAt.getBoundingClientRect().left) || 0;
      if (!(edge > 0) || event.clientX >= edge) return;
      // 勾选框那格是 <label>：不拦掉浏览器自带的勾选动作，会和这里的切换互相抵消
      if (target.closest("label")) event.preventDefault();
      // 已经选中的再点一次 = 取消选中（和画布上「再点一下取消」保持一致）
      if (S.selected.has(item)) {
        S.selected.delete(item);
      } else {
        if (!state.multi) S.selected.clear();
        S.selected.add(item);
      }
      syncRows();
      paint();
    });
  };

  const rowForBox = (box) => {
    const row = el("div", "yx-table yx-item-wrap");
    row.__item = box;
    row.__isBg = false;
    row.style.display = "flex";
    row.style.flexDirection = "column";
    const line = el("div", "yx-row yx-item yx-box-grid");
    const drag = el("div", "yx-drag", "☰");
    drag.title = "拖动排序：越靠上 = 画面里越上层";
    const check = el("input", "yx-check");
    check.type = "checkbox";
    check.title = "选中这个框（和画布上点击同步）";
    const numEditor = makeNumEditor(box, "box");
    const num = numEditor.cell;

    const lockType = lockButton(box, "type", "类型");
    // 选中带：勾选框 → 编号，这一段的空白处点一下也能选中
    pickZone(line, lockType, box);
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
    wInput.step = "1";
    const lockH = lockButton(box, "h", "高");
    const hInput = el("input", "yx-in");
    hInput.type = "number";
    hInput.step = "1";

    const lockColor = lockButton(box, "color", "颜色");
    const color = el("input", "yx-color");
    color.type = "color";
    color.title = "主色（会写进布局提示词的 palette）";

    const lockX = lockButton(box, "x", "x 坐标");
    const xInput = el("input", "yx-in");
    xInput.type = "number";
    xInput.step = "1";
    xInput.title = "框左下角在画布里的 x 坐标（左下角为原点）";
    const lockY = lockButton(box, "y", "y 坐标");
    const yInput = el("input", "yx-in");
    yInput.type = "number";
    yInput.step = "1";
    yInput.title = "框左下角在画布里的 y 坐标（左下角为原点，向上为正）";

    const eye = el("button", "yx-icon", "👁");
    eye.type = "button";
    eye.title = "隐藏 / 显示这个框（隐藏后不参与提示词编译）";
    const lockAll = lockAllButton(box, ["type", "text", "desc", "w", "h", "color", "x", "y"], "整体锁");
    const del = el("button", "yx-icon", "✕");
    del.type = "button";
    del.title = "删除这个框";

    // 整体锁放在拖拽手柄右边第二格（和背景图区一致）；列间竖线按 BOX_SEP 的列位插入
    appendCells(line, [drag, lockAll, check, num, lockType, type, lockText, textWrap, lockDesc, descWrap,
      lockW, wInput, lockH, hInput, lockColor, color, lockX, xInput, lockY, yInput,
      eye, del], BOX_SEP);
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
      xInput.title = coordXTips();
      yInput.value = yShown(box);
      yInput.title = coordYTips();
      if (document.activeElement !== text) text.value = box.text || "";
      if (document.activeElement !== desc) desc.value = box.desc || "";
      if (document.activeElement !== expandText) expandText.value = box.text || "";
      if (document.activeElement !== expandDesc) expandDesc.value = box.desc || "";
      numEditor.sync();

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

    num.addEventListener("click", (event) => {
      // 点编号格：没选中就选中，已经选中就取消。
      // 多选开着时是加选 / 减选，不再把其它已选对象清掉（以前这里会清成单选）
      if (event.target && event.target.closest && event.target.closest("button")) return;
      event.stopPropagation();
      if (S.selected.has(box)) {
        S.selected.delete(box);
      } else {
        if (!state.multi) S.selected.clear();
        S.selected.add(box);
      }
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
    // 坐标按当前体系换算：左下原点（y 向上）或草稿 JSON（左上原点、y 向下），内部一律存左上原点的画布坐标
    yInput.addEventListener("change", () => {
      if (locked("y")) return;
      const value = Number(yInput.value);
      if (Number.isFinite(value)) box.y = yFromShown(box, value);
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
    // 这一行是不是「导入原图」进来的原图（原图有独立身份：伪槽位、不占 B 编号）
    const source = isSourceBg(bg);
    row.style.display = "flex";
    row.style.flexDirection = "column";
    const line = el("div", source ? "yx-row yx-item yx-bg yx-item-src" : "yx-row yx-item yx-bg");

    const drag = el("div", "yx-drag", "☰");
    drag.title = source
      ? "拖动排序：原图在列表里的位置（列表越靠上越上层；原图默认排在最后＝最底层）"
      : "拖动排序：背景图之间的前后关系（永远在所有绘制框下面）";
    const check = el("input", "yx-check");
    check.type = "checkbox";
    let numEditor = null;
    let num = null;
    if (source) {
      // 原图没有 B 编号：只显示「原图」，不能编辑、也没有编号锁
      num = el("div", "yx-num yx-num-src", "原图");
      num.title = "这张是「导入原图」进来的原图：不占背景图编号，也不占背景图输入口";
    } else {
      numEditor = makeNumEditor(bg, "bg");
      num = numEditor.cell;
    }

    const lockType = el("div", null, "");
    const type = el("div", null, source ? "原图" : "背景图");
    type.style.fontSize = "12px";
    type.style.color = source ? SOURCE_COLOR : BG_COLOR;

    const lockDesc = lockButton(bg, "desc", "备注");
    // 选中带：勾选框 → 备注之前，这一段的空白处点一下也能选中这张背景图
    pickZone(line, lockDesc, bg);
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
    wInput.step = "1";
    const lockH = lockButton(bg, "h", "高");
    const hInput = el("input", "yx-in");
    hInput.type = "number";
    hInput.step = "1";

    // 背景图没有「颜色」，这一格改成「压暗百分比」：1~100，越大越暗（100 = 全黑）
    const lockDim = el("div", null, "");
    const dimInput = el("input", "yx-in yx-dim-in");
    dimInput.type = "number";
    dimInput.step = "1";
    dimInput.min = "1";
    dimInput.max = "100";
    dimInput.title = "压暗百分比：1~100，越大越暗（100 就是全黑）。只影响这张背景图在画布和生成预览里的明暗";

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
    reset.title = source
      ? "按原图像素尺寸放回画布左下角（超出画布的部分会显示在画布外并被裁掉）"
      : "按图片原始尺寸放回画布左下角（超出画布的部分会显示在画布外并被裁掉）";
    const del = el("button", "yx-icon", "✕");
    del.type = "button";
    del.title = source
      ? "删掉这一行，同时把这张原图从画布上撤掉（框和其它参数都不动）"
      : "移除这张背景图";

    // 直接作为画布（二次确认）＋ 整体锁
    const canvasBtn = el("button", "yx-chip", "作画布");
    canvasBtn.type = "button";
    canvasBtn.style.padding = "0 2px";
    canvasBtn.style.fontSize = "10px";
    canvasBtn.style.lineHeight = "16px";
    canvasBtn.title = source
      ? "直接作为画布：画布尺寸＝这张原图的原始尺寸（不取整），图片铺满画布并整体锁定"
      : "直接作为画布：画布尺寸＝这张图的原始尺寸，图片铺满画布并整体锁定（点右侧「锁」列解锁）";
    const lockAll = el("button", "yx-icon yx-lock-all", "🔓");
    lockAll.type = "button";

    // 整体锁放在拖拽手柄右边第二格；列间竖线按 BG_SEP 的列位插入
    appendCells(line, [drag, lockAll, check, num, lockType, type, lockDesc, descWrap,
      lockW, wInput, lockH, hInput, lockDim, dimInput, lockX, xInput, lockY, yInput,
      eye, reset, canvasBtn, del], BG_SEP);
    row.appendChild(line);

    const bigWrap = el("div", "yx-table");
    const expandDesc = el("textarea", "yx-big");
    expandDesc.style.display = "none";
    expandDesc.placeholder = "备注";
    bigWrap.appendChild(expandDesc);
    row.appendChild(bigWrap);

    const locked = (field) => !!bg.lock?.[field] || !!bg.lockAll || (!!bg.lockedCanvas && field !== "desc");
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
      // 整体锁：只锁「能不能改」，绝不动这张图的位置和尺寸
      bg.lockAll = !bg.lockAll;
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
      if (numEditor) numEditor.sync();
      else num.textContent = bg.label || "B";
      wInput.value = Math.round(bg.w);
      hInput.value = Math.round(bg.h);
      xInput.value = Math.round(bg.x);
      xInput.title = coordBgXTips();
      yInput.value = yShown(bg);
      yInput.title = coordBgYTips();
      if (document.activeElement !== dimInput) dimInput.value = String(Math.round(Number(bg.dim) || 45));
      lockAll.textContent = bg.lockAll ? "🔒" : "🔓";
      lockAll.title = bg.lockAll
        ? "整体已锁：宽 / 高 / x / y / 备注 / 压暗都不能改，也不能在画布上拖动缩放；点这里解锁"
        : "整体锁：一键锁住这张图的宽 / 高 / x / y / 备注 / 压暗";
      line.classList.toggle("yx-canvas-row", !!bg.lockedCanvas);
      if (document.activeElement !== desc) desc.value = bg.desc || "";
      if (document.activeElement !== expandDesc) expandDesc.value = bg.desc || "";
      wInput.disabled = locked("w");
      hInput.disabled = locked("h");
      xInput.disabled = locked("x");
      yInput.disabled = locked("y");
      dimInput.disabled = locked("dim");
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
    num.addEventListener("click", (event) => {
      // 点编号格切换选中：已选中就取消（和绘框区保持一致）；
      // 多选开着时是加选 / 减选，不再清掉其它已选对象
      if (event.target && event.target.closest && event.target.closest("button")) return;
      event.stopPropagation();
      if (S.selected.has(bg)) {
        S.selected.delete(bg);
      } else {
        if (!state.multi) S.selected.clear();
        S.selected.add(bg);
      }
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
      if (Number.isFinite(value)) bg.y = yFromShown(bg, value);
      clampBg(bg);
      syncRow();
      edit();
    });

    // 压暗百分比：1~100 的整数，步长 1（箭头一次改 1）
    const applyDim = () => {
      if (locked("dim")) {
        dimInput.value = String(Math.round(Number(bg.dim) || 45));
        return;
      }
      const raw = Number(dimInput.value);
      bg.dim = clamp(Number.isFinite(raw) ? Math.round(raw) : 45, 1, 100);
      dimInput.value = String(bg.dim);
      syncRow();
      edit();
    };
    dimInput.addEventListener("change", applyDim);
    dimInput.addEventListener("blur", applyDim);

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
      if (isSourceBg(bg)) {
        dropSourceBg();
        return;
      }
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
      const container = isBg ? bgRows : rows;
      if (!row || row.parentNode !== container) return;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      let dragging = false;

      // 起手时只量一次几何：拖动期间行不动，这份数据一直有效
      const group = Array.from(container.children)
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
          container.appendChild(line);
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
    // 背景图 / 原图有没有变动，决定「画布尺寸来源」下拉里有哪些选项
    syncSizeModeOptions();
    // 任何时候画列表，都先确认每个对象都有编号：一旦编上就跟着对象走，永不改号
    fillMissingNos(S.boxes);
    fillMissingNos(S.bgs);
    // 行变了就允许重新量一次行高（行的内容不同高度可能略有差别）
    state.rowMeasureRetry = 0;
    // 删除/撤销/换工作流之后，选中集合里可能残留已经不存在的对象，这里顺手清掉
    if (S.selected.size) {
      const alive = new Set([...S.boxes, ...S.bgs.filter(Boolean)]);
      for (const item of [...S.selected]) {
        if (!item || !alive.has(item)) S.selected.delete(item);
      }
    }
    const bgs = S.bgs.filter(Boolean);
    bgs.forEach((bg) => {
      // 编号用对象自己的号（新加的往后排），不再跟着列表顺序走；原图那行不编号
      bg.label = isSourceBg(bg) ? SOURCE_LABEL : `B${Number(bg.__no) || 0}`;
    });
    // 两个分区各自一行标题：背景图区在上、绘框区在下，颜色也不同
    // （标题行里除了文字还有本区的「显示行数」，所以只改文字，不重建整行）
    const realBgCount = bgs.filter((bg) => bg.kind !== SOURCE_KIND).length;
    bgTitleNote.textContent = realBgCount
      ? `${realBgCount} 张 · 不写进提示词`
      : (bgs.length ? "只有「原图」一行 · 不写进提示词" : "暂未接入背景图");
    boxTitleNote.textContent = S.boxes.length ? `${S.boxes.length} 个框` : "还没有画框";
    // 没有背景图时整块收起，不白占高度
    const showBg = bgs.length > 0;
    for (const item of [bgTitle, bgScroll]) item.style.display = showBg ? "" : "none";
    // 行集合和顺序都没变（只是选中/数值/编号变了）时，不重建 DOM，只同步现有行的值。
    // 每行里有下拉框 + 多个输入框，重建一次的开销远大于同步，框一多差别很明显。
    const sameRows = (container, list) => {
      if (container.children.length !== list.length) return false;
      for (let i = 0; i < list.length; i += 1) {
        const row = S.rows.get(list[i]);
        if (!row || container.children[i] !== row) return false;
      }
      return true;
    };
    const emptyPlaceholder = () => rows.children.length === 1
      && rows.children[0]?.classList?.contains("yx-empty");
    const sameBoxRows = S.boxes.length === 0
      ? (emptyPlaceholder() || rows.children.length === 0)
      : sameRows(rows, S.boxes);
    if (sameBoxRows && sameRows(bgRows, bgs)) {
      // 直接同步，不调 syncRows()：后者声明在下面，初始化早期还没赋值（TDZ）
      for (const row of S.rows.values()) row.__sync?.();
      refreshInfo();
      state.syncBar?.();
      paint();
      return;
    }
    rows.textContent = "";
    bgRows.textContent = "";
    S.rows.clear();
    if (S.boxes.length === 0 && bgs.length === 0) {
      rows.appendChild(el("div", "yx-empty", "在画布空白处按住拖动即可画框；接入图片后会自动出现在背景图区"));
    }
    for (const box of S.boxes) {
      const row = rowForBox(box);
      S.rows.set(box, row);
      rows.appendChild(row);
    }
    for (const bg of bgs) {
      const row = rowForBg(bg);
      S.rows.set(bg, row);
      bgRows.appendChild(row);
    }
    refreshInfo();
    state.syncBar?.();
    // 行数变了：重新量一遍列表高度，多了就出滚动条（layout 还没就绪时跳过）
    if (state.layoutReady) layout();
  }

  // 编号重排：按当前列表顺序重排成 01…/B1…
  // 方向＝列表最下面那行（最早画的、画面最下层）拿 01，往上依次 02、03…；
  // 原图不参与；编号被锁住的行保留原来的号，其余行按顺序取「没被占用的最小号」，
  // 这样既不会两行同号，也不会把锁住的那一行顶掉。
  function renumberZone(which) {
    const isBg = which === "bg";
    const items = (isBg ? S.bgs : S.boxes).filter(Boolean).filter((item) => !isSourceBg(item));
    if (!items.length) {
      showToast(isBg ? "背景图区还没有背景图，没什么可重排的" : "绘框区还没有框，没什么可重排的");
      return;
    }
    const locked = new Set();
    for (const item of items) {
      const n = Number(item.__no) || 0;
      if (item.lock?.num && n > 0) locked.add(n);
    }
    // 从列表最下面往上走：最下面那行拿 1，越往上号越大
    let cursor = 1;
    let changed = 0;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.lock?.num) continue; // 锁住编号的行不动
      while (locked.has(cursor)) cursor += 1;
      if ((Number(item.__no) || 0) !== cursor) {
        item.__no = cursor;
        if (isBg) item.label = "B" + cursor;
        changed += 1;
      }
      cursor += 1;
    }
    if (!changed) {
      showToast("编号已经是按顺序排好的");
      return;
    }
    refreshRows();
    paint();
    commit();
    showToast(isBg
      ? "已重排 " + changed + " 个背景图编号：列表最下面＝B1，往上递增（可 Ctrl+Z 撤销）"
      : "已重排 " + changed + " 个框编号：列表最下面＝01，往上递增（可 Ctrl+Z 撤销）");
  }

  const syncRows = () => {
    for (const row of S.rows.values()) row.__sync?.();
    state.syncBar?.();
  };

  // ---------------------------------------------------------------- layout
  // 这里的每个数字都必须是「算出来的、定的」，绝不去量容器的实时高度：
  // 一旦测量结果反过来影响高度，就会和 flex / 前端布局互相拉扯（抽搐、行被裁）。
  const layoutWidth = () => Math.max(240, stage.clientWidth || 480);

  const LIST_GAP = 3; // 列表里的行间距（.yx-table 的 gap）
  // 两个分区底部留出来的横向滚动条带：节点压窄时内容会溢出，横滚条会盖住最后一行，
  // 所以面板高度里固定把这 10px 算进去（CSS 里 .yx-scroll 的 padding-bottom 同值）。
  const PANEL_SCROLL_PAD = 10;
  const LIST_DEFAULT_ROWS = 20; // 默认显示行数（只数带编号的行）
  const LIST_ROW_LIMIT = 999; // 「显示行数」输入框允许的最大值
  // 行高不写死：行里有 26px 的下拉框，一行其实是 34px 左右，写死 32px 就会少露两行。
  // 这里的值只作首帧的估值，真正的高度由 measureRowHeights() 量出来。
  const FALLBACK_ROW_H = 34;

  // 只数「带编号的行」：空的提示行也算一行（它也占高度），拖拽指示线不算
  const countRows = (container) => {
    if (!container || !container.children) return 0;
    let count = 0;
    for (const child of container.children) {
      if (!child || !child.classList) continue;
      if (child.classList.contains("yx-item-wrap") || child.classList.contains("yx-empty")) count += 1;
    }
    return count;
  };
  const firstRow = (container) => {
    if (!container || !container.children) return null;
    for (const child of container.children) {
      if (!child || !child.classList) continue;
      if (child.classList.contains("yx-item-wrap") || child.classList.contains("yx-empty")) return child;
    }
    return null;
  };

  const bgRowCount = () => countRows(bgRows);
  const boxRowCount = () => countRows(rows);
  const bgRowHeight = () => state.bgRowH || FALLBACK_ROW_H;
  const boxRowHeight = () => state.boxRowH || FALLBACK_ROW_H;
  const bgShowRows = () => readRows(state.bgShowRows);
  const boxShowRows = () => readRows(state.boxShowRows);

  // 量一遍真实行高：行是固定结构（下拉框 26px + 上下 padding + 边框），量一次就够
  const measureRowHeights = () => {
    let changed = false;
    try {
      const bgH = Number(firstRow(bgRows)?.offsetHeight) || 0;
      if (bgH > 0 && Math.abs(bgH - (state.bgRowH || 0)) > 0.5) {
        state.bgRowH = bgH;
        changed = true;
      }
      const boxH = Number(firstRow(rows)?.offsetHeight) || 0;
      if (boxH > 0 && Math.abs(boxH - (state.boxRowH || 0)) > 0.5) {
        state.boxRowH = boxH;
        changed = true;
      }
    } catch (_error) {
      // 忽略
    }
    return changed;
  };

  const headHeight = (head) => (Number(head?.offsetHeight) || 0) || 26;
  const groupHeight = (group) => (Number(group?.offsetHeight) || 0) || 22;

  // n 行内容需要的高度（行与行之间有 3px 间距）
  const rowsHeight = (count, rowH) => (count <= 0 ? 0 : count * rowH + (count - 1) * LIST_GAP);
  // 一块分区的高度：表头 + 露出来的那几行；行数超过「显示行数」就只算到上限
  const panelHeight = (head, count, show, rowH) => {
    const headH = headHeight(head);
    if (count <= 0) return Math.round(headH);
    const visible = Math.min(count, Math.max(0, Math.round(show)));
    if (visible <= 0) return Math.round(headH);
    // 末尾那 10px 是横滚条的位置：不加的话横滚条会把最后一行压掉一截
    return Math.round(headH + LIST_GAP + rowsHeight(visible, rowH) + PANEL_SCROLL_PAD);
  };

  // 列表总高度 = 背景图区标题 + 背景图区面板 + 绘框区标题 + 绘框区面板
  const listSections = () => {
    const parts = [];
    if (bgRowCount() > 0) {
      parts.push(groupHeight(bgTitle), panelHeight(bgHead, bgRowCount(), bgShowRows(), bgRowHeight()));
    }
    parts.push(groupHeight(boxTitle), panelHeight(tableHead, boxRowCount(), boxShowRows(), boxRowHeight()));
    const sum = parts.reduce((total, value) => total + value, 0);
    return Math.round(8 + sum + (parts.length - 1) * LIST_GAP);
  };
  // 把两个分区的行全部露出来需要的高度
  const listNeeded = () => {
    const parts = [];
    if (bgRowCount() > 0) {
      parts.push(groupHeight(bgTitle), headHeight(bgHead) + LIST_GAP + rowsHeight(bgRowCount(), bgRowHeight()) + PANEL_SCROLL_PAD);
    }
    parts.push(groupHeight(boxTitle), headHeight(tableHead) + LIST_GAP + rowsHeight(boxRowCount(), boxRowHeight()) + PANEL_SCROLL_PAD);
    const sum = parts.reduce((total, value) => total + value, 0);
    return Math.round(8 + sum + (parts.length - 1) * LIST_GAP);
  };
  // 按两个「显示行数」算出来的列表高度
  const listBaseline = () => listSections();
  // 列表能显示的最大高度 —— 只由两个显示行数决定，节点拉长拉短都不参与
  const listCap = () => listBaseline();

  // 画布区高度（v1.0.3 之前的老算法，已按要求还原）：
  // 只按「画布长宽比 + 窗口预算」算出一个固定值，不跟节点高度联动，拉长压短都不影响它。
  // 例外：「只画框」那一行最右边的「画布区高度」填了数字，就按那个数字显示（留空 = 老算法）。
  const stageHeight = () => {
    const fixed = Math.round(Number(state.stageH) || 0);
    if (fixed > 0) return Math.round(clamp(fixed, 140, 2600));
    const budget = clamp(Math.round((window.innerHeight || 900) * 0.34), 220, 460);
    const natural = Math.round((layoutWidth() * S.height) / Math.max(1, S.width));
    return Math.round(clamp(Math.min(natural, budget), 180, 520));
  };
  // 兼容旧探针：老算法没有「基础 + 额外」两段
  const stageBaseHeight = () => stageHeight();
  const stageExtraHeight = () => 0;

  // 整块 DOM 界面在节点内部的实际起始高度（各控件自然高度之和；量 offsetTop 会被挤压后的布局带偏）
  const domWidgetTop = () => Math.round(nativeTop());

  // 画布区以外被固定占用的高度：列表 + 顶部按钮行/工具条 + 描述框 + 内边距与留白
  const stageReservedHeight = () => Math.round(listBaseline() + chromeHeight() + proseTotalHeight() + 38 + 12);

  // 整块 DOM 界面需要的高度 = 顶部按钮行 + 工具条 + 画布 + 列表（全部是定值，杜绝互相拉扯）
  // chrome 只量顶部两条小按钮行（它们的高度只由文字决定，跟画布/列表无关，量了也不会回路）
  const chromeHeight = () => {
    const heights = [];
    try {
      for (const item of [topBar, head, toolsRow, tableBar, statusBar]) heights.push(Number(item?.offsetHeight) || 0);
    } catch (_error) {
      // 忽略
    }
    const measured = heights.reduce((sum, value) => sum + value, 0);
    // 量不到（还没挂到 DOM）时按经验值；量到就把间距/内边距一并加足
    return Math.round(measured > 20 ? measured + 38 : 92);
  };

  // 「显示行数」档时整块界面的高度 —— 也是节点能缩到的最小高度
  // 注意用「理想高度」而不是 stageHeight()：这个值要写进 --comfy-widget-min-height，
  // 一旦把「拉长节点多出来的画布高度」也算进来，节点就再也缩不回去了。
  // +38 = 上下内边距 + 状态栏下面留出的空白（旧渲染会裁掉最底部十几个像素）
  const baseTotalHeight = () => Math.round(stageBaseHeight() + listBaseline() + chromeHeight() + proseTotalHeight() + 38);

  // 节点能缩到的最小高度（与 baseTotalHeight 一致）
  const minTotalHeight = () => baseTotalHeight();

  // 整个节点在「刚好够用」时的高度（只作显示用，不参与行数计算）
  const nodeBaseline = () => Math.round(nativeTop() + baseTotalHeight() + 12);

  // 列表高度：只由「显示行数」决定。拉长 / 缩短节点都不再影响它。
  const listHeight = () => Math.round(listBaseline());

  // 整块 DOM 界面的实际高度（列表按当前显示上限算，画布按理想高度 + 拉长多出来的空间）
  const domDesiredHeight = () => Math.round(stageHeight() + listHeight() + chromeHeight() + proseTotalHeight() + 38);

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

  // 「画布区高度」输入框：留空 = 自动；填数字 = 固定高度（140–2600），
  // 填得比节点剩下的空间还高时，一次性把节点撑高到刚好装下（只加不减，之后不再碰节点尺寸）
  function applyStageHeightInput() {
    const input = state.stageHInput;
    if (!input) return;
    const digits = String(input.value || "").replace(/[^0-9]/g, "").slice(0, 4);
    const parsed = digits ? parseInt(digits, 10) || 0 : 0;
    const value = parsed > 0 ? Math.round(clamp(parsed, 140, 2600)) : 0;
    state.stageH = value;
    input.value = value ? String(value) : "";
    node.properties = node.properties || {};
    // 0 也要存下来：存过 0 才是「明确要自动」，没存过按默认 600
    node.properties.yxStageH = value;
    layout();
    try {
      const need = Math.round(neededNodeHeight());
      const current = Math.round(Number(node?.size?.[1]) || 0);
      if (need > current && node?.setSize) node.setSize([node.size[0], need]);
    } catch (_error) {
      // 忽略
    }
    commit();
  }
  state.applyStageHeightInput = applyStageHeightInput;

  const applyPanelSizes = () => {
    try {
      const bgPx = panelHeight(bgHead, bgRowCount(), bgShowRows(), bgRowHeight()) + "px";
      const boxPx = panelHeight(tableHead, boxRowCount(), boxShowRows(), boxRowHeight()) + "px";
      if (bgScroll.style.height !== bgPx) bgScroll.style.height = bgPx;
      if (boxScroll.style.height !== boxPx) boxScroll.style.height = boxPx;
    } catch (_error) {
      // 忽略
    }
  };

  const applyDomLayoutSize = () => {
    applyPanelSizes();
    const height = domDesiredHeight() + "px";
    // 最小高度按「画布区压到 140」算：节点被拉高时它不跟着长，所以能再缩回来，
    // 也不会出现「拉长 → 最小高度变大 → 再也缩不动」的死循环。
    const minHeight = minTotalHeight() + "px";
    if (root.style.height !== height) root.style.height = height;
    if (root.style.minHeight !== minHeight) root.style.minHeight = minHeight;
    for (const host of domHosts()) {
      try {
        if (host.style.getPropertyValue("--comfy-widget-min-height") !== minHeight) {
          host.style.setProperty("--comfy-widget-min-height", minHeight);
        }
        if (host.style.getPropertyValue("--comfy-widget-max-height") !== "4000px") {
          host.style.setProperty("--comfy-widget-max-height", "4000px");
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
  // 「刚好够用」的节点高度：只算基础高度（不含拉长节点多给画布的那部分），
  // 否则每次载入都会把节点又撑高一点点
  const baseNodeHeight = () => Math.round(widgetStackHeight("auto") + 46 + baseTotalHeight() + 14);
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
    // 宽度：初次加载就保证列表整行能完整露出来（列多、窄了会把右边的按钮挤掉），
    // 用户此前存过更窄的尺寸也先撑到最小可视宽度，之后再自己拉宽/压窄都随你
    const width = Math.max(980, requiredNodeWidth(), width0 || 980);
    const height = isDefault ? Math.max(need, 560) : height0;
    if (width !== width0 || height !== height0) {
      node.setSize([width, height]);
    }
  };

  const layout = () => {
    // 画布宽高的数字控件可能晚于这里才挂到 DOM 上（2.0 还会重建输入框），
    // 每次布局都强制重写一遍箭头步长，保证「倍数改了箭头立刻按新步长走」
    syncCanvasStep(true);
    // 先按当前文本估一下描述框该多高（MIN~MAX），再排全景
    syncProseAuto();
    // 描述框高度：只跟节点高度走（拉高节点就变高，压回就变矮）
    applyProseHeight();
    // 画布高度：定值，不依赖容器
    const height = stageHeight() + "px";
    if (stage.style.height !== height) stage.style.height = height;
    // 行高是量出来的：第一帧可能还没量到，量到真实行高后再补一次布局，
    // 保证「显示行数」算出来的高度刚好装下那么多行（不会出现最后一行只露半截）
    if (measureRowHeights() && (state.rowMeasureRetry || 0) < 3) {
      state.rowMeasureRetry = (state.rowMeasureRetry || 0) + 1;
      const token = state.rowMeasureRetry;
      setTimeout(() => {
        if (state.rowMeasureRetry !== token) return;
        try {
          layout();
        } catch (_error) {
          // 忽略
        }
      }, 60);
    }
    applyDomLayoutSize();
    // 载入工作流后第一次布局：节点如果比「当前显示行数」需要的高度还矮，
    // 一次性撑到刚好够用（只做一次；之后你拉长压短都不再碰节点尺寸）
    if (state.pendingGrow && node?.setSize) {
      state.pendingGrow = false;
      try {
        const need = Math.round(neededNodeHeight());
        const current = Math.round(Number(node.size?.[1]) || 0);
        if (need > current) node.setSize([node.size[0], need]);
      } catch (_error) {
        // 忽略
      }
    }
    fitNode();
    state.layoutReady = true;
    state.updateStatus?.();
    paint();
  };

  // 节点被拉宽 / 压窄时，画布盒子跟着变，但 canvas 的背板尺寸只在 paint() 里才更新。
  // 不重绘就会出现「旧位图被 CSS 100% 拉伸铺满新盒子」——看起来就是画布比例变了、
  // 背景图被横向拉宽。这里在盒子尺寸真的变化时补一次布局+重绘（同一帧内合并）。
  const relayoutSoon = () => {
    if (state.relayoutPending) return;
    state.relayoutPending = true;
    const run = () => {
      state.relayoutPending = false;
      try {
        layout();
      } catch (_error) {
        // 忽略
      }
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
  };
  if (typeof ResizeObserver === "function") {
    try {
      state.stageObserver = new ResizeObserver(() => {
        const width = Math.round(stage.clientWidth);
        const height = Math.round(stage.offsetHeight);
        const last = state.lastStageBox;
        if (last && last[0] === width && last[1] === height) return;
        state.lastStageBox = [width, height];
        relayoutSoon();
      });
      state.stageObserver.observe(stage);
    } catch (_error) {
      // 极老浏览器没有 ResizeObserver，靠下面的 node.onResize 兜底
    }
  }
  const originalNodeOnResize = node.onResize;
  node.onResize = function (...args) {
    if (typeof originalNodeOnResize === "function") {
      try {
        originalNodeOnResize.apply(this, args);
      } catch (_error) {
        // 忽略
      }
    }
    relayoutSoon();
  };

  // ---------------------------------------------------------------- drawing
  function paint() {
    if (!ctx) return;
    const g = geo();
    const dpr = window.devicePixelRatio || 1;
    // 背板分辨率按「视觉像素」给足（工作流放大时也清晰），但绘制坐标系统一用布局像素，
    // 于是 q = 背板像素 / 布局像素；上限 4096 防止放大过头把显存打爆。
    const k = g.k || 1;
    const rawW = g.cw * k * dpr;
    const rawH = g.ch * k * dpr;
    const cap = 4096;
    const shrink = Math.min(1, cap / Math.max(rawW, rawH));
    const bw = Math.max(1, Math.round(rawW * shrink));
    const bh = Math.max(1, Math.round(rawH * shrink));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const q = bw / g.cw || dpr;
    ctx.setTransform(q, 0, 0, q, 0, 0);
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
      drawBackground(ctx, bg, g, left, top, String(wFit?.value ?? "锁比例"), true);
    }
    // 背景图自己的编号也画在图上左上角（B1、B2…），字号规则和框的编号一样
    for (let i = bgs.length - 1; i >= 0; i -= 1) {
      const bg = bgs[i];
      if (!bg.image || bg.hidden) continue;
      const no = Number(bg.__no) || (Number(bg.slot) || 0) + 1;
      const tag = isSourceBg(bg) ? SOURCE_LABEL : `B${no}`;
      drawTag(ctx, tag, left + bg.x * g.scale, top + bg.y * g.scale, itemColor(bg));
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, cw, chh);
    ctx.clip();

    if (state.axes !== false) drawThirds(ctx, g, left, top, cw, chh);
    if (state.hDivOn) drawDivisors(ctx, "h", state.hDiv, left, top, cw, chh, state.hDivColor);
    if (state.diagOn) drawDiagonals(ctx, left, top, cw, chh, state.diagColor);
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

    // 底部状态栏跟着画布一起刷新（内部有字符串比较，重复调用不写 DOM）
    state.updateStatus?.();
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
      // 每张背景图自己的「压暗百分比」：1~100，数字越大越暗（100 就是全黑）
      const alpha = clamp(Number(bg.dim) || 45, 0, 100) / 100;
      if (alpha > 0) {
        c.fillStyle = `rgba(0,0,0,${alpha})`;
        c.fillRect(bx, by, bwid, bhei);
      }
    }
  }

  // 画布上的编号小牌子（框用 01、02…，背景图用 B1、B2…）。
  // 字号只跟「画布缩放」走：滚轮放大画布时牌子跟着变大；工作流整体缩放不影响它（那样会越小越糊）。
  function drawTag(c, text, px, py, color) {
    const zoom = Math.max(1, Number(state.zoom) || 1);
    const fs = Math.round(clamp(14 * zoom, 14, 64));
    const pad = Math.round(fs * 0.38);
    c.save();
    c.font = `600 ${fs}px ui-monospace, monospace`;
    c.textAlign = "left";
    c.textBaseline = "middle";
    const lw = c.measureText(text).width + pad * 2;
    const lh = Math.round(fs * 1.45);
    c.fillStyle = color;
    c.fillRect(px, py, lw, lh);
    c.fillStyle = "#0d0e12";
    c.fillText(text, px + pad, py + lh / 2 + 0.5);
    c.restore();
    return lh;
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

  function drawDiagonals(c, left, top, cw, chh, color) {
    c.save();
    c.beginPath();
    c.rect(left, top, cw, chh);
    c.clip();
    c.strokeStyle = color || "#ff8a8a";
    c.lineWidth = 1;
    c.setLineDash([]);
    c.beginPath();
    c.moveTo(left + 0.5, top + 0.5);
    c.lineTo(left + cw - 0.5, top + chh - 0.5);
    c.moveTo(left + cw - 0.5, top + 0.5);
    c.lineTo(left + 0.5, top + chh - 0.5);
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
    if (coordIsDraft()) {
      // 草稿 JSON 坐标：左上角为原点，x 向右、y 向下（和导入/导出的草稿 JSON 完全一致）
      // 横轴在上边、纵轴在左边：分成两条独立的线画。
      // 千万别连成一条折线——那样会从底边左端斜拉到顶边右端，多出一条对角线。
      c.beginPath();
      c.moveTo(left + 0.5, top + 0.5);
      c.lineTo(left + cw, top + 0.5);
      c.stroke();
      c.beginPath();
      c.moveTo(left + 0.5, top + 0.5);
      c.lineTo(left + 0.5, top + chh - 0.5);
      c.stroke();
      c.textAlign = "center";
      c.textBaseline = "top";
      for (let x = 0; x <= S.width; x += step) {
        const px = left + x * g.scale;
        c.beginPath();
        c.moveTo(Math.round(px) + 0.5, top + 1);
        c.lineTo(Math.round(px) + 0.5, top + 5);
        c.stroke();
        c.fillText(String(x), clamp(px, left + 12, left + cw - 12), top + 6);
      }
      c.textAlign = "left";
      c.textBaseline = "middle";
      for (let y = 0; y <= S.height; y += step) {
        const py = top + y * g.scale;
        c.beginPath();
        c.moveTo(left + 1, Math.round(py) + 0.5);
        c.lineTo(left + 5, Math.round(py) + 0.5);
        c.stroke();
        if (y !== 0) c.fillText(String(y), left + 6, clamp(py, top + 8, top + chh - 8));
      }
      c.restore();
      return;
    }
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

    // 编号标签（用自己的编号：新画的往后排，不受列表顺序影响）
    const label = String(Number(box.__no) || index + 1).padStart(2, "0");
    const tagH = drawTag(c, label, x, y, color);

    // 框内文字 / 描述：字号跟着框在屏幕上的大小走，缩放节点时不会挤成一团
    const lines = [];
    // 文字里的换行也当成多行排，不然画布上会多出一个「空小方块」（换行符的占位字形）
    if (box.type === TYPE_TEXT && box.text) lines.push(...String(box.text).split("\n"));
    if (box.desc) lines.push(box.desc);
    if (lines.length) {
      const fontSize = Math.round(clamp(Math.min(w, h) * 0.32, 9, 14));
      const lineHeight = fontSize + 3;
      c.save();
      c.beginPath();
      c.rect(x + 2, y + tagH + 2, Math.max(1, w - 4), Math.max(1, h - tagH - 6));
      c.clip();
      c.fillStyle = "rgba(240,240,245,0.92)";
      c.font = `${fontSize}px system-ui, sans-serif`;
      c.textBaseline = "top";
      // 从编号牌子下沿再留 4px 开始排，避免牌子变大后把第一行文字的上半截裁掉
      let ty = Math.round(y + tagH + 4);
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
    const start = {
      x: snap(clamp(point.x, 0, S.width)),
      y: snap(clamp(point.y, 0, S.height)),
    };
    const box = newBox(state.activeType, clamp(start.x, 0, S.width - MIN_BOX), clamp(start.y, 0, S.height - MIN_BOX), 0, 0);
    box.x = clamp(start.x, 0, S.width - MIN_BOX);
    box.y = clamp(start.y, 0, S.height - MIN_BOX);
    box.w = 0;
    box.h = 0;
    state.pending = box;
    // 起点也一起夹进画布：否则从留白处落笔时，横向拖到画布内才会有反应
    state.drag = { kind: "create", item: box, start: start, created: false };
    paint();
  };
  // 点是否落在画布（那张图片）范围里；画布区两侧 / 上下的黑色留白不算
  const insideCanvas = (point) => point.x >= 0 && point.y >= 0 && point.x <= S.width && point.y <= S.height;

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
    state.bgTap = null;
    const point = eventPoint(event);
    const g = geo();

    // 「只画框」打开，或按住 Shift / Alt：跳过所有选中与拖动，直接在按下处开一个新框
    if (state.drawOnly || event.shiftKey || event.altKey) {
      // 画布两侧 / 上下的黑色留白不算画布：在那里落笔不画框（否则会出现「只能纵向拉、横向没反应」）
      if (!insideCanvas(point)) return;
      startCreate(point);
      capture(event);
      return;
    }

    // 1) 手柄：只对「已选中」的对象生效（未选中的对象不参与，避免点到附近就被选中）
    for (const item of itemsInZOrder()) {
      if (item.hidden) continue;
      if (item.lockedCanvas || item.lockAll) continue;
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
        // 普通背景图：单击即可选中。但按下去就拖动时仍然算「画新框」，
        // 所以先不急着选中——记下它，松手时如果没拖出框就选中这张图。
        state.bgTap = hit;
        hit = null;
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
      const moving = [...S.selected].filter((item) => !item.hidden && !item.lockedCanvas && !item.lockAll);
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

    // 3) 空白处：画新框（只认画布范围内的空白，画布外的留白不算）
    if (!insideCanvas(point)) {
      // 画布外的黑色留白：单击一下 = 取消所有选中
      state.deselectTap = true;
      return;
    }
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
        candidate.__no = nextLabelNo(S.boxes);
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
    if (state.deselectTap) {
      // 在画布外的黑色留白里单击：取消选中（不画框、不动任何对象）
      state.deselectTap = false;
      if (!state.drag && S.selected.size) {
        S.selected.clear();
        syncRows();
        paint();
      }
    }
    const drag = state.drag;
    if (!drag) return;
    state.drag = null;
    if (drag.kind === "create") {
      const box = drag.item;
      if (!drag.created || box.w < MIN_BOX || box.h < MIN_BOX) {
        // 只是点了一下空白：理解为「取消所有选中」，方便随后在背景图上直接画框；
        // 如果按下的位置正好在没选中的背景图上，这一下就是「单击选中那张图」
        if (!drag.created) {
          const tapBg = state.bgTap;
          S.selected.clear();
          if (tapBg) S.selected.add(tapBg);
          syncRows();
          paint();
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
        state.bgTap = null;
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
    state.deselectTap = false;
    paint();
  };

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pointerDown(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (state.panDrag) {
      const pan = state.panDrag;
      const k = viewScale(canvas) || 1;
      // 鼠标位移是视觉像素，平移量是布局像素 → 除以工作流缩放倍率
      const dx = (event.clientX - pan.sx) / k;
      const dy = (event.clientY - pan.sy) / k;
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
          if (S.selected.has(item) && !item.lockedCanvas && !item.lockAll) cursor = "move";
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
    state.updateStatus?.();
  };

  // 滚轮缩放：以鼠标位置为中心，只改显示不动数据
  const zoomByWheel = (event) => {
    const g = geo();
    const k = g.k || 1;
    const px = (event.clientX - g.rect.left) / k;
    const py = (event.clientY - g.rect.top) / k;
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
  };

  // 挂在 window 的捕获阶段：ComfyUI 自己的滚轮处理（图缩放）会比画布冒泡更早拿到事件，
  // 只有抢在捕获阶段处理，滚轮缩放才不会被前端吞掉。
  const onWheelZoom = (event) => {
    if (event.__yxZoomed) return;
    if (state.modal) return;
    const target = event.target;
    if (target && target.closest && target.closest(".yx-list,.yx-modal,textarea,input,select")) return;
    const rect = stage.getBoundingClientRect ? stage.getBoundingClientRect() : null;
    if (!rect) return;
    if (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) return;
    event.__yxZoomed = true;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (state.editing) commitEdit();
    zoomByWheel(event);
  };
  state.wheelZoomHandler = onWheelZoom;
  window.addEventListener?.("wheel", onWheelZoom, { capture: true, passive: false });
  // 画布自己再挂一份：万一前端把 window 上的事件拦掉了，鼠标直接落在画布上时仍然能缩放
  canvas.addEventListener("wheel", onWheelZoom, { passive: false });
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
    const graphs = [node.graph, app?.graph].filter(Boolean);
    let record = null;
    for (const graph of graphs) {
      const table = graph?.links || graph?._links;
      if (Array.isArray(table)) record = record || table[link] || null;
      else if (table && typeof table.get === "function") record = record || table.get(link) || null;
      else if (table && typeof table === "object") record = record || table[link] || null;
      if (!record) record = graph?.getLink?.(link) || null;
      if (record) break;
    }
    const id = Number(record?.origin_id);
    return Number.isFinite(id) ? id : null;
  };

  // ------------------------------------------------- 外部接入的画布尺寸
  // 「画布宽 / 画布高 / 画布缩放长度」一旦被转成输入接了上游，ComfyUI 只把上游的值送进后端，
  // 前端控件里留的还是接上那一刻的旧值 —— 表现就是「手动输入、点箭头都能实时变，接了线画布就不动了」。
  // 这里每帧（限流）去上游节点读它当前的参数，等价于「把上游的值当成你自己填的值」。
  const LINK_WIDTH_NAMES = ["画布宽", "宽", "宽度", "w", "width", "分辨率宽", "宽(px)", "宽 px", "宽px", "canvas_width"];
  const LINK_HEIGHT_NAMES = ["画布高", "高", "高度", "h", "height", "分辨率高", "高(px)", "高 px", "高px", "canvas_height"];
  const LINK_LENGTH_NAMES = ["画布缩放长度", "缩放长度", "长度", "长", "长边", "基准长度", "size", "length", "总长"];
  const inputSlot = (name) => (node.inputs || []).find((item) => String(item?.name || "") === name) || null;
  const widgetInt = (w) => {
    const raw = w?.value;
    if (raw == null || typeof raw === "boolean") return null;
    if (typeof raw === "string" && !raw.trim()) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  // 「预设分辨率」这类节点（例如 ZML_PresetResolution）或者顺手接个文本框时，参数就是一串文字，
  // 宽高并不单独占参数 —— 这里把字符串里的两个数字解出来，兼容常见写法：
  // 2048x1024 / 2048×1024 / 2048*1024 / 2048:1024 / 2048,1024 / 2048 1024
  const parseSizeText = (text) => {
    const raw = String(text || "");
    const patterns = [
      /(\d{2,5})\s*[x×*]\s*(\d{2,5})/i,
      /(\d{2,5})\s*[:：]\s*(\d{2,5})/,
      /(\d{2,5})\s*[,，/|]\s*(\d{2,5})/,
      /(\d{2,5})\s+(\d{2,5})/,
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (!match) continue;
      const first = Number(match[1]);
      const second = Number(match[2]);
      if (first > 0 && second > 0) return [first, second];
    }
    return null;
  };
  // position：上游没有能识别的参数名时，按「宽在前、高在后」的顺序兜底
  // （大多数「预设分辨率」节点就是这么摆的）
  const linkedInt = (slot, names, position) => {
    if (!slot || slot.link == null) return null;
    const originId = linkOriginId(slot);
    if (originId == null) return null;
    const origin = (node.graph || app.graph)?.getNodeById?.(originId);
    if (!origin || origin === node) return null;
    const widgets = (origin.widgets || []).filter(Boolean);
    // 1) 参数名直接对得上（宽 / 宽度 / 高 / 高度 / 长度 …）
    for (const w of widgets) {
      const name = String(w.name || "").trim().toLowerCase();
      if (!names.includes(name)) continue;
      const value = widgetInt(w);
      if (value != null) return value;
    }
    // 2) 「2048x1024」这种分辨率字符串：宽高取对应的一半，长度取长边
    for (const w of widgets) {
      if (typeof w.value !== "string") continue;
      const size = parseSizeText(w.value);
      if (!size) continue;
      const swapped = widgets.some((item) => /互换|交换|swap/i.test(String(item?.name || "")) && !!item.value);
      const pair = swapped ? [size[1], size[0]] : size;
      if (position === 0) return pair[0];
      if (position === 1) return pair[1];
      return Math.max(pair[0], pair[1]);
    }
    // 3) 顺序兜底：只有一 / 两个数字参数时按先后取（布尔开关不算数字参数）
    const values = widgets.map(widgetInt).filter((value) => value != null);
    if (position != null && values.length === 2) return values[position];
    if (values.length === 1) return values[0];
    return null;
  };
  // 返回 true 表示画布确实被改了（控件值、画布尺寸都算）
  const syncLinkedCanvas = () => {
    const width = linkedInt(inputSlot("画布宽"), LINK_WIDTH_NAMES, 0);
    const height = linkedInt(inputSlot("画布高"), LINK_HEIGHT_NAMES, 1);
    const length = linkedInt(inputSlot("画布缩放长度"), LINK_LENGTH_NAMES, null);
    if (width == null && height == null && length == null) return false;
    const mode = String(wMode?.value ?? "自定义尺寸");
    if (mode === "自定义尺寸") {
      const nextW = width == null ? S.width : clampSize(width);
      const nextH = height == null ? S.height : clampSize(height);
      if (nextW === S.width && nextH === S.height) return false;
      applyCanvasSize(nextW, nextH, true);
      return true;
    }
    if (length == null) return false;
    const nextLength = Math.round(clamp(length, 4, MAX_SIZE));
    if (Math.round(Number(wLength?.value)) === nextLength) return false;
    if (wLength) wLength.value = nextLength;
    applyModeSize();
    return true;
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

  // fresh = true 时总是新建一条（同一个输入口可以被复制出多份），否则按 slot 复用
  // atTop = true：新接进来的图放到最前面（列表最上方 + 画布最上层）；恢复工作流时按存档顺序 push
  const ensureBgEntry = (slotIndex, fresh = false, atTop = true) => {
    let bg = fresh ? null : S.bgs.find((item) => item && item.slot === slotIndex);
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
        dim: 45,
        lockAll: false,
        lock: emptyLocks(["w", "h", "x", "y", "desc", "dim", "num"]),
        isBg: true,
        kind: "bg",
        label: "",
      };
      bg.__no = nextLabelNo(S.bgs);
      bg.label = `B${bg.__no}`;
      if (atTop) S.bgs.unshift(bg);
      else S.bgs.push(bg);
    }
    return bg;
  };

  // ---------------------------------------------------------------- 原图
  // 用 function 声明（会提升），这样初始化早期的 refreshRows 也能安全调用。
  function sourceBg() {
    return S.bgs.find((bg) => bg && bg.kind === SOURCE_KIND) || null;
  }

  function isSourceBg(item) {
    return !!item && item.kind === SOURCE_KIND;
  }

  function ensureSourceBg(atTop = true) {
    let bg = sourceBg();
    if (bg) return bg;
    bg = {
      slot: -1,
      kind: SOURCE_KIND,
      image: null,
      natW: 0,
      natH: 0,
      x: 0, y: 0,
      w: S.width, h: S.height,
      hidden: false,
      desc: "",
      dim: 45,
      lockAll: false,
      lock: emptyLocks(["w", "h", "x", "y", "desc", "dim", "num"]),
      isBg: true,
      label: SOURCE_LABEL,
      __no: 0,
    };
    // 默认和新接进来的背景图一样放在列表最上面（画布最上层）：
    // 之后接的背景图会再叠在它上面；恢复工作流时按存档顺序 push，位置照旧
    if (atTop) S.bgs.unshift(bg);
    else S.bgs.push(bg);
    return bg;
  }

  // 原图那一行的删除：撤掉这一行、把图从画布上拿掉，框和其它参数都不动
  function dropSourceBg() {
    const bg = sourceBg();
    if (!bg) return false;
    S.selected.delete(bg);
    S.rows.delete(bg);
    S.bgs = S.bgs.filter((item) => item !== bg);
    // 尺寸来源正指着这张原图时，退到「自定义尺寸」（画布本身保持不变）
    if (wMode && String(wMode.value ?? "") === MODE_SOURCE) {
      wMode.value = MODE_CUSTOM;
      syncSizeWidgets();
    }
    refreshRows();
    layout();
    commit();
    paint();
    showToast("已移除原图那一行（画布尺寸保持不变）");
    return true;
  }

  // 画布尺寸来源可选项：只列真实存在的来源（原图 / 已接上且拿到尺寸的背景图）
  function sizeModeOptions() {
    const list = [MODE_CUSTOM, MODE_SCALED];
    const source = sourceBg();
    if (source && Number(source.natW) > 0 && Number(source.natH) > 0) list.push(MODE_SOURCE);
    const entries = S.bgs
      .filter((bg) => bg && bg.kind !== SOURCE_KIND && Number(bg.slot) >= 0
        && Number(bg.natW) > 0 && Number(bg.natH) > 0)
      .slice()
      .sort((a, b) => Number(a.slot) - Number(b.slot));
    for (const bg of entries) list.push(`按背景图${Number(bg.slot) + 1}的原始尺寸`);
    return list;
  }

  function syncSizeModeOptions() {
    if (!wMode) return;
    const list = sizeModeOptions();
    const key = list.join("|");
    if (key === state.sizeModeKey) return;
    state.sizeModeKey = key;
    try {
      if (wMode.options) {
        wMode.options.values = list;
        wMode.options.max = Math.max(0, list.length - 1);
      }
      const current = String(wMode.value ?? "");
      if (current && !list.includes(current)) {
        wMode.value = list[0] || MODE_CUSTOM;
        // 回落时画布尺寸保持不变，但「画布宽/高」控件必须跟着画布走，
        // 否则界面显示「自定义尺寸 + 旧数字」，和画布对不上。
        syncSizeWidgets();
      }
    } catch (_error) {
      // 框架偶尔不允许改 options，忽略（改下一张图时还会再试一次）
    }
    try {
      node.setDirtyCanvas?.(true, true);
      node.graph?.setDirtyCanvas?.(true, true);
      app?.canvas?.setDirty?.(true, true);
    } catch (_error) {
      // 忽略
    }
  }

  // 当前尺寸来源指向的那张图（原图 / 按背景图N）：拿不到就返回 null
  function modeBgNat(mode) {
    const text = String(mode || "");
    if (text === MODE_SOURCE) {
      const source = sourceBg();
      if (!source || !Number(source.natW) || !Number(source.natH)) return null;
      return { bg: source, natW: Number(source.natW), natH: Number(source.natH), exact: true };
    }
    const hit = MODE_BG_RE.exec(text);
    if (!hit) return null;
    const slot = Number(hit[1]) - 1;
    const bg = S.bgs.find((item) => item && item.kind !== SOURCE_KIND && Number(item.slot) === slot);
    if (!bg || !Number(bg.natW) || !Number(bg.natH)) return null;
    return { bg, natW: Number(bg.natW), natH: Number(bg.natH), exact: false };
  }

  function setSizeMode(mode) {
    if (!wMode) return false;
    syncSizeModeOptions();
    syncAspectOptions();
    wMode.value = String(mode || MODE_CUSTOM);
    applyModeSize(false);
    refreshInfo();
    refreshRows();
    layout();
    commit();
    return true;
  }

  // 老工作流里存的是「按图片原始尺寸」：迁移成「按背景图1的原始尺寸」（没有就退原图档 / 自定义）
  function normalizeSizeMode() {
    if (!wMode) return;
    const current = String(wMode.value ?? "");
    if (!current) {
      wMode.value = MODE_CUSTOM;
      return;
    }
    if (current === MODE_IMAGE_OLD) {
      const firstBg = S.bgs.find((bg) => bg && bg.kind !== SOURCE_KIND && Number(bg.slot) === 0 && Number(bg.natW) > 0);
      if (firstBg) wMode.value = "按背景图1的原始尺寸";
      else if (sourceBg()) wMode.value = MODE_SOURCE;
      else wMode.value = MODE_CUSTOM;
      return;
    }
    const list = sizeModeOptions();
    if (current !== MODE_SOURCE && !MODE_BG_RE.test(current) && !list.includes(current)) {
      wMode.value = MODE_CUSTOM;
    }
  }

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

  // 填满画布（cover）：保持原图长宽比，以画布中心对齐，缩放到刚好盖住画布，
  // 哪一边超出画布就把超出部分裁掉（画布外不显示）。
  const fillBgIntoCanvas = (bg) => {
    const natW = Number(bg?.natW) || 0;
    const natH = Number(bg?.natH) || 0;
    if (!natW || !natH) return false;
    const scale = Math.max(S.width / natW, S.height / natH);
    if (!bg.lock?.w) bg.w = Math.max(1, Math.round(natW * scale));
    if (!bg.lock?.h) bg.h = Math.max(1, Math.round(natH * scale));
    if (!bg.lock?.x) bg.x = Math.round((S.width - bg.w) / 2);
    if (!bg.lock?.y) bg.y = Math.round((S.height - bg.h) / 2);
    bg.lockedCanvas = false;
    bg.hidden = false;
    clampBg(bg);
    return true;
  };

  // 换图之后：按图片原始尺寸 / 按缩放规则 时，画布要立刻跟着这张新图变；
  // 自定义尺寸时画布不动（那两个数字本来就是用户自己填的值）。
  // 接图 / 换图只负责把这张图等比放进「当前画布」：画布尺寸只由「画布尺寸来源」决定，
  // 只有当前来源正好选中这张图时画布才跟着它走（别的图接入不改画布）。
  const followImageCanvas = (bg, first) => {
    if (!bg || !bg.natW || !bg.natH) return;
    const mode = String(wMode?.value ?? MODE_CUSTOM);
    const picked = modeBgNat(mode);
    if (picked && picked.bg === bg) {
      // 尺寸来源正指着这张图：画布先按它重算，再把图放进新画布（顺序反了图就会停在旧尺寸）
      applyModeSize(false);
    } else if (mode === MODE_SCALED && aspectBgOf(wAspect?.value) === bg) {
      // 画布比例正指着这张图（自动项＝第一张接上的图 / 按背景图N / 按原图）：
      // 这张图一到，画布就按它的比例重算一次，否则会一直停在接入前的比例上
      applyModeSize(false);
    }
    placeInitial(bg);
    refreshInfo();
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
    followImageCanvas(bg, first);
    refreshRows();
    layout();
    commit();
  };

  const syncBackgrounds = async () => {
    // 载入工作流时连线会一条一条恢复，原来每恢复一条就整轮重算一遍（ensureBgInputs + 逐张加载图 + 重建列表 + layout + commit），
    // 节点越多、连的输入越多就越卡，还会互相打断。这里加一把锁 + 末尾补跑一次，保证同一时刻只有一轮在跑。
    if (state.bgSyncBusy) {
      state.bgSyncAgain = true;
      return;
    }
    state.bgSyncBusy = true;
    state.bgSyncAgain = false;
    try {
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
    } finally {
      state.bgSyncBusy = false;
    }
    if (state.bgSyncAgain) {
      state.bgSyncAgain = false;
      return syncBackgrounds();
    }
  };

  // 连线变化很密（载入工作流时一次几十个），统一压成一次：80ms 内多次变化只跑最后一轮
  let syncBgTimer = 0;
  const scheduleSyncBackgrounds = (delay = 80) => {
    clearTimeout(syncBgTimer);
    syncBgTimer = setTimeout(() => {
      syncBgTimer = 0;
      syncBackgrounds().catch(() => {});
    }, delay);
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
    const mult = isSourceBg(bg) ? 0 : multiple();
    S.width = clampSize(mult ? (roundNear(natW, mult) || natW) : Math.round(natW));
    S.height = clampSize(mult ? (roundNear(natH, mult) || natH) : Math.round(natH));
    syncSizeWidgets();
    bg.x = 0;
    bg.y = 0;
    bg.w = S.width;
    bg.h = S.height;
    bg.lockedCanvas = true;
    bg.hidden = false;
    S.selected.delete(bg);
    // 把「画布尺寸来源」也切到这张图上：否则下拉显示的还是别的档，
    // 之后任何“按来源重算”的动作（换图 / 改来源 / 重新导入）都会把画布改回去。
    syncSizeModeOptions();
    if (isSourceBg(bg)) {
      // 原图当画布：切到「按导入原图的原始尺寸」，之后换原图也和它保持一致
      if (wMode) wMode.value = MODE_SOURCE;
    } else {
      const want = `按背景图${Number(bg.slot) + 1}的原始尺寸`;
      if (wMode) wMode.value = sizeModeOptions().includes(want) ? want : MODE_CUSTOM;
      // 落到「自定义尺寸」时把算好的画布数字写进控件，界面和画布保持一致
      syncSizeWidgets();
    }
    refreshInfo();
    refreshRows();
    layout();
    commit();
  };

  // 某个背景图输入口被断开：把这一张从列表里撤掉
  const dropBackground = (slotIndex) => {
    // 粘贴出来的副本会沿用同一个 slot（后端拿同一张图画两遍），
    // 所以断线时要把这个 slot 的行全撤掉：留一条只会显示旧图，后端却拿不到图。
    const victims = S.bgs.filter((item) => item && item.slot === slotIndex);
    if (!victims.length) return;
    for (const bg of victims) {
      S.selected.delete(bg);
      S.rows.delete(bg);
    }
    S.bgs = S.bgs.filter((item) => !victims.includes(item));
    // 来源指着这张图时，选项会少一档；顺便把「画布宽/高」控件跟画布对齐
    syncSizeModeOptions();
    refreshRows();
    layout();
    commit();
    paint();
  };

  // ---------------------------------------------------------------- restore
  // 打开工作流时几张背景图会同时加载完；原来每张图各自重排 + 重绘一次，图多就是一轮接一轮的强制重排。
  // 这里把同一批压成一次（60ms 内多次请求只跑最后一遍）。
  let restoredImgTimer = 0;
  const scheduleRestoredImageRefresh = () => {
    clearTimeout(restoredImgTimer);
    restoredImgTimer = setTimeout(() => {
      restoredImgTimer = 0;
      try {
        refreshRows();
        layout();
        paint();
      } catch (_error) {
        // 忽略
      }
    }, 60);
  };
  // 把一份 {boxes, bgs} 数据灌进画布（打开工作流 / 载入预设都走这里）
  const restoreCanvas = (data) => {
    S.boxes = [];
    S.bgs = [];
    S.selected.clear();
    // 前置 / 后置跟着画布数据走（老工作流没有这两个字段 → 清空，不会留上一份的残渣）
    setSideProse(
      typeof data?.prefix === "string" ? data.prefix : "",
      typeof data?.suffix === "string" ? data.suffix : "",
    );
    if (data && Array.isArray(data.boxes)) {
      for (const item of data.boxes) {
        if (!item || typeof item !== "object") continue;
        const box = newBox(TYPES.includes(item.type) ? item.type : TYPE_OBJ,
          Number(item.x) || 0, Number(item.y) || 0);
        box.w = Math.max(MIN_BOX, Number(item.w) || MIN_BOX);
        box.h = Math.max(MIN_BOX, Number(item.h) || MIN_BOX);
        box.text = textValue(item.text);
        box.desc = String(item.desc || "");
        box.palette = Array.isArray(item.palette) ? item.palette.slice(0, 5) : [];
        box.hidden = !!item.hidden;
        for (const field of FIELDS) box.lock[field] = !!item.lock?.[field];
        box.__no = Number(item.no) || 0;
        S.boxes.push(box);
      }
    }
    if (data && Array.isArray(data.bgs)) {
      const usedSlots = new Set();
      for (const item of data.bgs) {
        if (!item || typeof item !== "object") continue;
        const slot = Number.isFinite(Number(item.slot)) ? Number(item.slot) : S.bgs.length;
        // 原图那一行是独立身份：不占背景图编号，也不占「背景图N」输入口
        const isSource = item.kind === SOURCE_KIND;
        const bg = isSource ? ensureSourceBg(false) : ensureBgEntry(slot, usedSlots.has(slot), false);
        if (!isSource) usedSlots.add(slot);
        bg.x = Number(item.x) || 0;
        bg.y = Number(item.y) || 0;
        bg.w = Math.max(MIN_BOX, Number(item.w) || S.width);
        bg.h = Math.max(MIN_BOX, Number(item.h) || S.height);
        bg.hidden = !!item.hidden;
        bg.desc = String(item.desc || "");
        bg.lockedCanvas = !!item.lockedCanvas;
        if (!isSource) bg.__no = Number(item.no) || 0;
        bg.dim = clamp(Number(item.dim) || 45, 1, 100);
        bg.lockAll = !!item.lockAll;
        for (const field of ["w", "h", "x", "y", "desc", "dim"]) bg.lock[field] = !!item.lock?.[field];
        // 打开工作流时先用上次记住的地址把图显示出来，不必等执行
        const url = typeof item.url === "string" ? item.url : "";
        if (url && !bg.image) {
          bg.url = url;
          loadImage(url).then((image) => {
            if (!image) return;
            bg.image = image;
            bg.natW = bg.natW || image.naturalWidth || image.width || 0;
            bg.natH = bg.natH || image.naturalHeight || image.height || 0;
            scheduleRestoredImageRefresh();
          });
        }
      }
    }
    // 画布数据里的宽高才是画布真正的尺寸（后端出图也按它算）：非「自定义尺寸」档时，
    // 画布宽/高 控件只是用户自己填的参数，不能拿来当画布尺寸，否则重开工作流画布会跳。
    const storedW = Number(data && data.width);
    const storedH = Number(data && data.height);
    S.width = clampSize(storedW > 0 ? storedW : numeric(wWidth, S.width));
    S.height = clampSize(storedH > 0 ? storedH : numeric(wHeight, S.height));
    // 老工作流没有编号：按列表顺序补 01、02…（新画的接着往后排）
    fillMissingNos(S.boxes);
    fillMissingNos(S.bgs);
    normalizeSizeMode();
    syncSizeModeOptions();
    syncAspectOptions();
    refreshRows();
    layout();
  };

  const configure = (info) => {
    if (!info) return;
    // 这次布局会检查节点是否矮到装不下当前显示行数，装不下就一次性撑高
    state.pendingGrow = true;
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
    // 坐标体系跟着工作流走：存过 draft 就按草稿 JSON 显示（老工作流没有这个值 → 维持左下原点）
    try {
      state.coordMode = String(node.properties?.yxCoordMode || "canvas") === "draft" ? "draft" : "canvas";
      syncCoordButtons();
    } catch (_error) {
      // 忽略
    }
    // 恢复两个分区的「显示行数」与描述框高度（都存在 node.properties 里，跨会话生效）
    try {
      state.bgShowRows = readRows(node.properties?.yxBgRows);
      state.boxShowRows = readRows(node.properties?.yxBoxRows);
      if (state.bgRowsInput) state.bgRowsInput.value = String(state.bgShowRows);
      if (state.boxRowsInput) state.boxRowsInput.value = String(state.boxShowRows);
      // 画布区高度：存过就回填；老工作流没存过按默认 600；存了 0 才是「自动」
      state.stageH = clamp(Math.round(Number(node.properties?.yxStageH ?? 600) || 0), 0, 2600);
      if (state.stageHInput) {
        state.stageHInput.value = state.stageH ? String(state.stageH) : "";
      }
    } catch (_error) {
      // 忽略
    }
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
    followImageCanvas(bg, first);
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
        // 只有「自定义尺寸」这档才让后端的尺寸结果改画布。
        // 其它档（按图片原始尺寸 / 按缩放规则）画布由图片和规则算，
        // 而后端在没有接背景图时会退回用「画布宽 / 画布高」两个参数算 ——
        // 一旦照它改，刚「导入原图」进来的画布就会被那两个旧数字顶掉（点一下运行就变）。
        const custom = String(wMode?.value ?? "自定义尺寸") === "自定义尺寸";
        if (custom && Number.isFinite(w) && Number.isFinite(h) && (w !== S.width || h !== S.height)) {
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
      // 工作流里存下来的尺寸可能比列表需要的还窄（编号列加宽过，老档更容易窄）：
      // 载入完再撑一次宽度，保证「编号 / 重命名 / 各把锁 / 画布 / 删除」这些按钮全露出来。
      // 高度不动——你调过的高度下次打开还在。
      fitNodeInitial();
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
      window.removeEventListener?.("wheel", state.wheelZoomHandler, true);
      if (state.wheelListHandler) document.removeEventListener("wheel", state.wheelListHandler, true);
      state.stageObserver?.disconnect?.();
    } catch (_error) {
      // 忽略
    }
    return originalRemoved?.apply?.(this, arguments);
  };

  const originalConnections = node.onConnectionsChange;
  node.onConnectionsChange = function (type, index, connected, link_info, ioSlot) {
    const result = originalConnections?.call?.(this, type, index, connected, link_info, ioSlot);
    const slotIndex = ioSlot ? bgSlotIndex(ioSlot.name) : -1;
    const isLayoutSlot = String(ioSlot?.name || "") === LAYOUT_INPUT_NAME;
    try {
      if (slotIndex >= 0 && connected === false) dropBackground(slotIndex);
      // 只有背景图线的增删才需要重新挂背景图；其它参数（画布宽高、布局提示词、导入原图…）的连线变化
      // 一律跳过。载入工作流时连线是一条条恢复的，原来每恢复一条就整轮重算，切换工作流会卡很久。
      if (slotIndex >= 0) {
        scheduleSyncBackgrounds(connected ? 120 : 0);
      }
      if (String(ioSlot?.name || "") === "导入原图") {
        // 接上/断开这张图：立刻按当前那张图导一次，不用等下一帧轮询
        setTimeout(() => {
          try {
            state.bgHintShown = false;
  state.imageImportSource = "";
            state.imageImportOk = false;
            if (connected === false) {
              state.imageImportSeq = (state.imageImportSeq || 0) + 1;
              state.pngCandidates = [];
              state.pngImageUrl = "";
              syncLayoutSwitch();
              return;
            }
            syncImageImport();
          } catch (error) {
            console.error("[MOSS YXBOX] 导入原图接口同步失败", error);
          }
        }, 0);
      }
      if (isLayoutSlot) {
        // 换了一个上游文本框：等这一轮连接结算完，立刻按新接入的内容重来一遍
        setTimeout(() => {
          try {
            lastLayoutText = null;
            lastLayoutOk = false;
            normalizeLayoutInputs();
            syncLayoutSocket();
          } catch (error) {
            console.error("[MOSS YXBOX] 重新导入布局提示词失败", error);
          }
        }, 0);
      }
      // 有些上游节点要过一会儿才把图挂出来，补两次重试
      if (connected && slotIndex >= 0) {
        setTimeout(() => { scheduleSyncBackgrounds(200); }, 400);
        setTimeout(() => { scheduleSyncBackgrounds(200); }, 1500);
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

  // 画布宽高 / 缩放长度：点出来的值按「画布宽高取整倍数」归一（手输吸附、箭头按倍数走一格），
  // 再交给尺寸逻辑；改倍数时同步这几个控件的箭头步长并重新归一。
  [wWidth, wHeight, wLength].forEach(rememberCanvasValue);
  onWidget(wWidth, () => {
    syncCanvasStep();
    normalizeCanvasWidget(wWidth);
    applyModeSize();
  });
  onWidget(wHeight, () => {
    syncCanvasStep();
    normalizeCanvasWidget(wHeight);
    applyModeSize();
  });
  onWidget(wMode, () => applyModeSize());
  onWidget(wAspect, () => applyModeSize());
  onWidget(wPropW, () => applyModeSize());
  onWidget(wPropH, () => applyModeSize());
  onWidget(wBasis, () => applyModeSize());
  onWidget(wLength, () => {
    syncCanvasStep(true);
    normalizeCanvasWidget(wLength, 4);
    applyModeSize();
  });
  onWidget(wMult, () => {
    // 改倍数必须强制重写一遍步长：2.0 会重建数字框的 DOM，光靠「步长没变就跳过」会漏掉新元素
    syncCanvasStep(true);
    normalizeCanvasWidget(wWidth);
    normalizeCanvasWidget(wHeight);
    normalizeCanvasWidget(wLength, 4);
    applyModeSize();
  });
  onWidget(wFit, () => paint());

  // 节点缩放 / 尺寸变化时先重算舞台高度，再按新的显示尺寸重画
  let lastWidth = -1;
  let lastAvail = -1;
  let lastTickKey = "";
  let lastProseText = null;
  let lastNodeH = -1;
  let lastAppliedProse = -1;
  // 节点高度变化 → 列表显示上限变化 → 防抖重排（拖节点时不想每帧都重排）
  let lastListCap = -1;
  // 外部接入的画布尺寸：限流同步用（每 120ms 最多读一次上游）
  let lastLinkedSyncAt = 0;
  let listRelayoutTimer = 0;
  let listRelayoutWindow = 0;
  let listRelayoutCount = 0;
  const scheduleListRelayout = () => {
    // 简单的限流：同一秒内最多重排 6 次，防止和前端的高度计算互相推着走
    const now = Date.now();
    if (now - listRelayoutWindow > 1200) {
      listRelayoutWindow = now;
      listRelayoutCount = 0;
    }
    if (listRelayoutCount >= 6) return false;
    listRelayoutCount += 1;
    if (listRelayoutTimer) clearTimeout(listRelayoutTimer);
    listRelayoutTimer = setTimeout(() => {
      listRelayoutTimer = 0;
      layout();
    }, 120);
    return true;
  };
  const tick = () => {
    if (!canvas.isConnected) return;
    // 下面这几项都是「每帧去问一次外部有没有变化」的轮询，本身不产生画面变化，
    // 合并成 120ms 一次：肉眼无差别，但省掉了每帧的多次 DOM 查询与字符串比较。
    if (Date.now() - lastLinkedSyncAt > 120) {
      lastLinkedSyncAt = Date.now();
      // 「布局提示词输入」接上文本后实时导入（文本没变就什么都不做）
      try {
        syncLayoutSocket();
      } catch (error) {
        console.error("[MOSS YXBOX] 布局提示词输入同步失败", error);
      }
      // 旧渲染把隐藏控件画成的小圆点：工作流加载完再补几次清理
      try {
        stripHiddenInputs();
      } catch (error) {
        console.error("[MOSS YXBOX] 清理隐藏参数的接入点失败", error);
      }
      // 画布宽 / 画布高 / 画布缩放长度接了上游：上游一改，画布立刻跟着变
      try {
        syncLinkedCanvas();
      } catch (error) {
        console.error("[MOSS YXBOX] 同步上游画布尺寸失败", error);
      }
      // 「导入原图」输入口接上 / 换了一张图：自动把图里存的布局提示词导入，并把图铺成背景图1
      try {
        syncImageImport();
      } catch (error) {
        console.error("[MOSS YXBOX] 同步导入原图失败", error);
      }
      // 节点高度被你拖动了 / 文字高度变了 → 同步（描述框吃掉多出来的空间、删文本时节点缩回）
      try {
        syncNodeHeight();
      } catch (error) {
        console.error("[MOSS YXBOX] 同步节点高度失败", error);
      }
    }
    // 正在拖拽排序时跳过测量：避免和拖拽抢着触发布局计算
    if (state.reorderActive) {
      requestAnimationFrame(tick);
      return;
    }
    const width = Math.round(stage.clientWidth || 0);
    const rect = canvas.getBoundingClientRect();
    const key = `${Math.round(rect.width)}x${Math.round(rect.height)}@${window.devicePixelRatio || 1}`;
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
    // 节点被拉高 / 压回：列表的显示上限跟着变（只读取节点高度，不反推节点高度）
    try {
      const cap = listCap();
      if (lastListCap < 0) {
        lastListCap = cap;
      } else if (cap !== lastListCap && scheduleListRelayout()) {
        lastListCap = cap;
      }
    } catch (error) {
      console.error("[MOSS YXBOX] 列表高度重排失败", error);
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

  // ---------------------------------------------------------------- 从 PNG 原图里提取画布数据
  // ComfyUI 存出来的 PNG 里带两段文本：prompt（API 格式）与 workflow（界面格式）。
  // 里面就有这个节点当时存下的「画布数据」，所以能把整份排版从原图搬回来。
  const toast = el("div", "yx-toast");
  root.appendChild(toast);
  let toastTimer = 0;
  const showToast = (text) => {
    toast.textContent = String(text || "");
    toast.classList.add("yx-toast-on");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = 0;
      toast.classList.remove("yx-toast-on");
    }, 2800);
  };
  state.showToast = showToast;

  const pngPicker = el("input", "yx-png-picker");
  pngPicker.type = "file";
  pngPicker.accept = "image/png,image/*";
  pngPicker.style.display = "none";
  root.appendChild(pngPicker);

  const utf8Text = (bytes) => {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch (error) {
      return "";
    }
  };

  // PNG 文本块（tEXt / zTXt / iTXt）→ key/value；zTXt 与压缩的 iTXt 用浏览器自带的 zlib 解压
  const pngMetaTexts = async (buffer) => {
    const out = new Map();
    if (!buffer || buffer.byteLength < 16) return out;
    const all = new Uint8Array(buffer);
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i += 1) {
      if (all[i] !== signature[i]) return out;
    }
    const view = new DataView(buffer);
    const inflate = async (bytes) => {
      if (typeof DecompressionStream !== "function") return null;
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (error) {
        console.warn("[MOSS YXBOX] 解压图片文本失败", error);
        return null;
      }
    };
    const nulAt = (bytes, from) => {
      let at = from;
      while (at < bytes.length && bytes[at] !== 0) at += 1;
      return at;
    };
    let at = 8;
    while (at + 8 <= buffer.byteLength) {
      const length = view.getUint32(at);
      const type = utf8Text(all.subarray(at + 4, at + 8));
      const start = at + 8;
      const end = start + length;
      if (end > buffer.byteLength) break;
      const data = all.subarray(start, end);
      if (type === "tEXt") {
        const split = nulAt(data, 0);
        out.set(utf8Text(data.subarray(0, split)), utf8Text(data.subarray(split + 1)));
      } else if (type === "zTXt") {
        const split = nulAt(data, 0);
        const inflated = await inflate(data.subarray(split + 2));
        if (inflated) out.set(utf8Text(data.subarray(0, split)), utf8Text(inflated));
      } else if (type === "iTXt") {
        const split = nulAt(data, 0);
        const compressed = data[split + 1] === 1;
        // 跳过 compressionMethod(1) + languageTag + translatedKeyword，剩下才是正文
        let rest = split + 3;
        rest = nulAt(data, rest) + 1;
        rest = nulAt(data, rest) + 1;
        const payload = data.subarray(rest);
        const text = compressed ? utf8Text((await inflate(payload)) || new Uint8Array()) : utf8Text(payload);
        if (text) out.set(utf8Text(data.subarray(0, split)), text);
      } else if (type === "IEND") {
        break;
      }
      at = end + 4;
    }
    return out;
  };

  // 一段文本里是不是布局 JSON（含 bbox 的数字数组）
  const canvasDataText = (value) => {
    const text = typeof value === "string" ? value : "";
    if (text.length < 20) return null;
    // 允许外面裹着说明文字 / 代码块：只要真的出现 "bbox": [数字 就交给解析器去捞
    return /"bbox"\s*:\s*\[\s*-?\d/.test(text) ? text : null;
  };

  // 把一个对象里所有字符串摊平（ComfyUI 的 prompt / workflow 都是嵌套结构）
  const flattenStrings = (value, out, depth = 0) => {
    if (depth > 8 || out.length > 400) return;
    if (typeof value === "string") {
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) flattenStrings(item, out, depth + 1);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) flattenStrings(item, out, depth + 1);
    }
  };

  // 不管图是哪个节点、哪个工作流生成的：把所有文本里带 bbox 的布局 JSON 都当候选。
  // 一类节点名是不是「出图 / 预览 / 保存」这种终点节点
  const OUTPUT_NODE_RE = /(save|preview|display|write|export|video|combine|final|output)/i;

  // 从终点节点往回走，算出「真正参与了出图」的节点（API 格式）
  const activeNodesOfPrompt = (api) => {
    const nodes = api && typeof api === "object" && !Array.isArray(api) ? api : {};
    const edges = new Map(); // 节点 id → 上游节点 id 集合
    const usedBy = new Set(); // 被别人当上游用的节点
    for (const [id, item] of Object.entries(nodes)) {
      for (const value of Object.values(item?.inputs || {})) {
        if (!Array.isArray(value) || value.length !== 2) continue;
        const src = String(value[0] ?? "");
        if (!src || !nodes[src]) continue;
        usedBy.add(src);
        if (!edges.has(id)) edges.set(id, new Set());
        edges.get(id).add(src);
      }
    }
    const ids = Object.keys(nodes);
    let roots = ids.filter((id) => OUTPUT_NODE_RE.test(String(nodes[id]?.class_type || "")));
    if (!roots.length) roots = ids.filter((id) => !usedBy.has(id));
    const active = new Set();
    const stack = [...roots];
    while (stack.length) {
      const id = stack.pop();
      if (!id || active.has(id)) continue;
      active.add(id);
      for (const src of edges.get(id) || []) stack.push(src);
    }
    return active;
  };

  // 同上（界面格式的 workflow：靠 links 表往回走，静音节点不参与）
  const activeNodesOfWorkflow = (flow) => {
    const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
    const links = Array.isArray(flow?.links) ? flow.links : [];
    const byId = new Map();
    for (const item of nodes) byId.set(String(item?.id ?? ""), item);
    const edges = new Map();
    const hasOut = new Set();
    for (const row of links) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const src = String(row[1] ?? "");
      const dst = String(row[3] ?? "");
      if (!byId.has(src) || !byId.has(dst)) continue;
      hasOut.add(src);
      if (!edges.has(dst)) edges.set(dst, new Set());
      edges.get(dst).add(src);
    }
    const ids = [...byId.keys()];
    let roots = ids.filter((id) => OUTPUT_NODE_RE.test(String(byId.get(id)?.type || "")));
    if (!roots.length) roots = ids.filter((id) => !hasOut.has(id));
    const active = new Set();
    const stack = [...roots];
    while (stack.length) {
      const id = stack.pop();
      if (!id || active.has(id)) continue;
      const item = byId.get(id);
      // 被静音（mode 2）的节点不执行，也不往上游传
      if (Number(item?.mode) === 2) continue;
      active.add(id);
      for (const src of edges.get(id) || []) stack.push(src);
    }
    return active;
  };

  // 不管图是哪个节点、哪个工作流生成的：把所有文本里带 bbox 的布局 JSON 都当候选，
  // 并标出它所在节点有没有真正参与出图（接在出图链路上 → 就是生成这张图用的那段提示词）。
  // PNG 的 IHDR 里存着原始宽高：用来给「多份排版」排序 —— 越接近原图比例的越可能是这一张用的
  const pngSizeOf = (buffer) => {
    try {
      const all = new Uint8Array(buffer);
      if (all.length < 24) return null;
      if (!(all[0] === 0x89 && all[1] === 0x50 && all[2] === 0x4e && all[3] === 0x47)) return null;
      const view = new DataView(buffer);
      const width = view.getUint32(16);
      const height = view.getUint32(20);
      return width > 0 && height > 0 ? { width, height } : null;
    } catch (error) {
      return null;
    }
  };

  const mossCandidates = (meta, imageSize = null) => {
    const list = [];
    const seen = new Set();
    const push = (label, value, active) => {
      const text = canvasDataText(value);
      if (!text) return;
      const key = text.trim();
      if (seen.has(key)) return;
      seen.add(key);
      let parsed = null;
      try {
        parsed = parseLayoutText(text);
      } catch (error) {
        parsed = null;
      }
      const count = parsed?.boxes?.length || 0;
      if (!count) return;
      const width = Number(parsed?.width) || 0;
      const height = Number(parsed?.height) || 0;
      const size = width >= 8 && height >= 8 ? ` · ${width}×${height}` : "";
      const caption = String(parsed?.caption || "").trim() ? " · 带整体描述" : "";
      const badge = active === true ? "✔ 参与出图 · " : (active === false ? "未参与出图 · " : "");
      list.push({
        label: `${badge}${label} · ${count} 个框${size}${caption}`,
        json: text,
        width,
        height,
        count,
        hasCaption: !!caption,
        active: active === true,
        knownActive: active === true || active === false,
      });
    };
    // ① ComfyUI 存的 API 格式（真正跑的那条图）：逐节点、逐输入扫
    if (meta?.prompt) {
      try {
        const api = JSON.parse(meta.prompt);
        const active = activeNodesOfPrompt(api);
        for (const [id, item] of Object.entries(api || {})) {
          const cls = String(item?.class_type || "未知节点");
          const texts = [];
          flattenStrings(item?.inputs, texts);
          const hit = active.has(String(id));
          for (const text of texts) push(`生成节点 ${id}（${cls}）`, text, hit);
        }
      } catch (error) {
        // 不是 API 格式就算了，下面还会试界面格式
      }
    }
    // ② 界面格式的 workflow：逐节点把 widgets_values / inputs 里的字符串扫一遍
    if (meta?.workflow) {
      try {
        const flow = JSON.parse(meta.workflow);
        const active = activeNodesOfWorkflow(flow);
        for (const item of flow?.nodes || []) {
          const cls = String(item?.type || "未知节点");
          const texts = [];
          flattenStrings(item?.widgets_values, texts);
          flattenStrings(item?.inputs, texts);
          const hit = active.has(String(item?.id ?? ""));
          for (const text of texts) push(`工作流节点 ${item?.id}（${cls}）`, text, hit);
        }
      } catch (error) {
        // 同上
      }
    }
    // ③ 其它文本块（有的工具把提示词存在自己的 key 里）：判断不了是否参与出图
    for (const [key, value] of meta?.texts || []) {
      if (key === "prompt" || key === "workflow") continue;
      push(`图片信息 ${key}`, value, null);
    }
    // 真正参与出图的排最前；其次「画布比例最接近这张原图」的（同一张图往往存了好几份排版，
    // 尺寸比例对得上的那份才是这张图真正用的）；再其次带整体描述的、框多的
    const target = imageSize && imageSize.width > 0 && imageSize.height > 0
      ? imageSize.width / imageSize.height
      : 0;
    const gap = (item) => {
      if (!target || !(item.width > 0) || !(item.height > 0)) return 1;
      const ratio = item.width / item.height;
      return Math.abs(Math.log(ratio / target));
    };
    list.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0)
      || gap(a) - gap(b)
      || (b.hasCaption ? 1 : 0) - (a.hasCaption ? 1 : 0)
      || b.count - a.count);
    return list;
  };

  // 一段文本像不像「人写的提示词」（用来在只有自然语言提示词时兜底放进整体描述）
  const PROMPT_NODE_RE = /(clip|text|prompt|t5|llm|string|concat)/i;
  const looksLikePrompt = (text) => {
    const s = String(text || "").trim();
    // 太短的（"best quality, highres" 这种质量词）不是画面描述，别拿它当整体描述
    if (s.length < 30) return false;
    if (!s.includes(" ")) return false;
    if (/^[[{]/.test(s)) return false;
    if (/^(https?:|\/|[A-Za-z]:\\)/.test(s)) return false;
    if (/\.(png|jpe?g|webp|gif|safetensors|ckpt|pt|bin|json|txt)$/i.test(s)) return false;
    if (s.includes("\"bbox\"")) return false;
    return true;
  };

  // 找「生成这张图用的那段自然语言提示词」：只看出图链路上的节点，文本节点优先、越长的越像
  // 负面提示词（nsfw, worst quality, bad anatomy…）不能当整体描述用，直接排除
  const NEGATIVE_PROMPT_RE = /(^|[\s,;])(nsfw|worst quality|low quality|normal quality|bad anatomy|bad hands|extra fingers|watermark|jpeg artifact|signature|blurry|负面提示词|反向提示词)/i;
  const bestPromptText = (meta) => {
    const hits = [];
    const collect = (texts, weight) => {
      for (const text of texts) {
        if (!looksLikePrompt(text)) continue;
        const body = String(text).trim();
        if (NEGATIVE_PROMPT_RE.test(body)) continue;
        hits.push({ text: body, weight: weight * 10000 + Math.min(body.length, 9000) });
      }
    };
    if (meta?.prompt) {
      try {
        const api = JSON.parse(meta.prompt);
        const active = activeNodesOfPrompt(api);
        for (const [id, item] of Object.entries(api || {})) {
          if (!active.has(String(id))) continue;
          const cls = String(item?.class_type || "");
          const texts = [];
          flattenStrings(item?.inputs, texts);
          collect(texts, PROMPT_NODE_RE.test(cls) ? 2 : 1);
        }
      } catch (error) {
        // 不是 API 格式就试界面格式
      }
    }
    if (meta?.workflow && !hits.length) {
      try {
        const flow = JSON.parse(meta.workflow);
        const active = activeNodesOfWorkflow(flow);
        for (const item of flow?.nodes || []) {
          if (!active.has(String(item?.id ?? ""))) continue;
          const cls = String(item?.type || "");
          const texts = [];
          flattenStrings(item?.widgets_values, texts);
          flattenStrings(item?.inputs, texts);
          collect(texts, PROMPT_NODE_RE.test(cls) ? 2 : 1);
        }
      } catch (error) {
        // 同上
      }
    }
    hits.sort((a, b) => b.weight - a.weight);
    return hits[0]?.text || "";
  };

  // blob:/data: 这种只在当前页面有效的地址，不进「画布数据」（否则重开工作流时是个死地址，
  // 表现就是「莫名其妙还留着上一张图」）
  const persistableImageUrl = (url) => (/^(blob|data):/i.test(String(url || "")) ? "" : String(url || ""));

  // 应用一份候选：先把这张图铺成背景图列表里「原图」那一行（默认叠在最上层）、
  // 画布切到「按导入原图的原始尺寸」（画布＝原图像素、不取整），再导入框/描述
  const applyPngCandidate = async (cand, imageUrl = "") => {
    if (imageUrl) {
      state.pngImageUrl = imageUrl;
      // 原图有一行自己的位置（背景图区里标着「原图」的那行），不占背景图编号
      const bg = ensureSourceBg();
      const image = await loadImage(imageUrl);
      if (!image) {
        // 这张图打不开就别把上一张图留在画布上，免得看着像「导进来的是一张别的图」
        bg.image = null;
        bg.url = "";
        bg.natW = 0;
        bg.natH = 0;
        bg.hidden = true;
        showToast("导入原图：这张图打不开，先把原图那一行清空了");
        paint();
        return false;
      }
      bg.image = image;
      bg.url = persistableImageUrl(imageUrl);
      bg.natW = image.naturalWidth || image.width || 0;
      bg.natH = image.naturalHeight || image.height || 0;
      bg.hidden = false;
      // 画布尺寸来源切成「按导入原图的原始尺寸」：画布＝原图像素尺寸（这一档不取整）
      syncSizeModeOptions();
      if (wMode) wMode.value = MODE_SOURCE;
      syncAspectOptions();
      if (wAspect) wAspect.value = ASPECT_SOURCE;
      if (bg.natW >= 8 && bg.natH >= 8) applyCanvasSize(Math.round(bg.natW), Math.round(bg.natH), true);
      // 原图铺满画布：画布与原图等大，所以就是 1:1 全画布
      fillBgIntoCanvas(bg);
      syncSizeModeOptions();
    }
    const custom = String(wMode?.value ?? "自定义尺寸") === "自定义尺寸";
    if (!imageUrl && custom && cand?.width >= 8 && cand?.height >= 8) {
      // 没有配图时（理论上不会走到）：按 JSON 里的画布尺寸写回
      if (wWidth) wWidth.value = String(cand.width);
      if (wHeight) wHeight.value = String(cand.height);
      applyCanvasSize(cand.width, cand.height, true);
    }
    const text = String(cand?.json || "");
    const ok = text ? applyLayoutText(text) : false;
    if (!ok) {
      showToast(cand?.captionOnly ? "这段提示词读不出来" : "原图里的画布数据读不出来（可能被截断了）");
      return false;
    }
    refreshInfo();
    commit();
    paint();
    showToast(cand?.captionOnly
      ? "这张图用的是自然语言提示词，已放进「整体描述」"
      : `已从原图恢复 ${S.boxes.length} 个框`);
    return true;
  };

  const openPngChooser = (cands, anchorEl, imageUrl = "") => {
    closeMenu();
    state.menuSticky = true;
    menu.textContent = "";
    menu.appendChild(el("div", "yx-menu-title", `原图里有 ${cands.length} 份排版，选一份导入`));
    for (const cand of cands) {
      menuItem(cand.label, () => {
        closeMenu();
        applyPngCandidate(cand, imageUrl);
      });
    }
    const rect = (anchorEl || root).getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const k = viewScale(root) || 1;
    const boxW = root.clientWidth || rootRect.width;
    const boxH = root.clientHeight || rootRect.height;
    menu.style.display = "block";
    const mw = menu.offsetWidth || 220;
    const mh = menu.offsetHeight || 160;
    let left = (rect.left - rootRect.left) / k;
    let top = (rect.bottom - rootRect.top) / k + 4;
    if (left + mw > boxW - 6) left = Math.max(6, boxW - mw - 6);
    if (top + mh > boxH - 6) top = Math.max(6, boxH - mh - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };

  // 一份 PNG（来自文件选择或上游导入原图接口）→ 找回布局提示词 + 把图铺成背景图
  const rememberCandidates = (pool, imageUrl) => {
    state.pngCandidates = pool.length > 1 ? pool.slice() : [];
    state.pngImageUrl = imageUrl || "";
    syncLayoutSwitch();
  };

  const runImageImport = async (buffer, imageUrl, anchorEl) => {
    state.pngCandidates = [];
    state.pngImageUrl = "";
    syncLayoutSwitch();
    let meta = new Map();
    try {
      meta = await pngMetaTexts(buffer);
    } catch (error) {
      console.warn("[MOSS YXBOX] 读取原图信息失败", error);
      showToast("这个文件读不出来，换一张试试");
      return;
    }
    const payload = {
      prompt: meta.get("prompt") || meta.get("Prompt") || "",
      workflow: meta.get("workflow") || meta.get("Workflow") || "",
      texts: meta,
    };
    const imageSize = pngSizeOf(buffer);
    const cands = mossCandidates(payload, imageSize);
    const activeCands = cands.filter((cand) => cand.active);
    const pool = activeCands.length ? activeCands : cands;
    if (pool.length === 1) {
      rememberCandidates(pool, imageUrl);
      await applyPngCandidate(pool[0], imageUrl);
      return;
    }
    if (pool.length > 1) {
      rememberCandidates(pool, imageUrl);
      openPngChooser(pool, anchorEl, imageUrl);
      return;
    }
    rememberCandidates([], imageUrl);
    // 没有布局 JSON：生成这张图用的是自然语言提示词 → 放进「整体描述」，不生成框
    const prompt = bestPromptText(payload);
    if (prompt) {
      await applyPngCandidate({ json: prompt, captionOnly: true }, imageUrl);
      return;
    }
    // 连提示词都没有：至少把图当背景图放进来，让用户自己画框
    if (imageUrl) await applyPngCandidate(null, imageUrl);
    showToast(meta.size
      ? "这张图里没找到生成用的提示词，已只把图片放进背景图1（当前画布按原图尺寸）"
      : "这张图没有文件信息（被压缩工具抹掉了），只把图片放进背景图1");
  };

  // 「导入原图」输入口接的上游节点里选的那张图 → /view 地址候选（拿不到就返回空）
  // 上游不一定是 LoadImage：任何节点，只要某个参数是图片文件名，都认；
  // 关键：要读「控件当前值」（node.widgets[i].value），不能只读 widgets_values ——
  // 在 LoadImage 里换图时，新版前端不一定同步写回 widgets_values，读它就会永远是接上那一刻的旧图。
  const IMAGE_WIDGET_RE = /^(image|file|filename|image_path|图片|图像|文件名|图像路径)$/i;
  const upstreamImageFilesOf = (slotName) => {
    const empty = { keys: [], urls: [] };
    const slot = inputSlot(slotName);
    const originId = linkOriginId(slot);
    if (originId == null) return empty;
    const graphs = [app?.graph, node.graph].filter(Boolean);
    let origin = null;
    for (const graph of graphs) {
      origin = graph?.getNodeById?.(originId) || null;
      if (origin) break;
    }
    if (!origin) return empty;

    const widgets = Array.isArray(origin.widgets) ? origin.widgets : [];
    const values = Array.isArray(origin.widgets_values) ? origin.widgets_values : [];
    const raw = [];
    // 1) 名字对得上的参数：先读控件当前值，读不到再按位置回退 widgets_values
    widgets.forEach((w, index) => {
      if (!IMAGE_WIDGET_RE.test(String(w?.name || ""))) return;
      if (typeof w?.value === "string" && w.value) raw.push(w.value);
      if (typeof values[index] === "string" && values[index]) raw.push(values[index]);
    });
    // 2) LoadImage 上刚换的预览图（新版前端会挂在 node.images / node.imgs 上）
    for (const key of ["images", "imgs"]) {
      const list = origin[key];
      if (!Array.isArray(list)) continue;
      list.forEach((item) => {
        const name = item?.filename || item?.name || item?.image;
        if (typeof name === "string" && name) raw.push(item?.subfolder ? `${item.subfolder}/${name}` : name);
      });
    }
    // 3) 兜底：扫这个节点上所有字符串（含 widgets_values）
    widgets.forEach((w) => {
      if (typeof w?.value === "string" && w.value) raw.push(w.value);
    });
    values.forEach((value) => {
      if (typeof value === "string") raw.push(value);
    });

    const files = new Map();
    raw.forEach((entry) => {
      const text = String(entry ?? "").trim();
      if (!text || !/\.(png|jpe?g|webp|gif|bmp)$/i.test(text)) return;
      // 完整的本地磁盘路径（D:\…）在浏览器里取不到，直接跳过
      if (/^[a-z]:[\\/]/i.test(text) || /^\\\\/.test(text)) return;
      const cut = text.lastIndexOf("/");
      const subfolder = cut >= 0 ? text.slice(0, cut) : "";
      const name = cut >= 0 ? text.slice(cut + 1) : text;
      const key = `${subfolder}|${name}`;
      if (files.has(key)) return;
      const urls = [];
      for (const type of ["input", "temp", "output"]) {
        urls.push(`/view?filename=${encodeURIComponent(name)}&type=${type}&subfolder=${encodeURIComponent(subfolder)}`);
      }
      files.set(key, urls);
    });
    const keys = [...files.keys()];
    const urls = keys.flatMap((key) => files.get(key));
    return { keys, urls };
  };

  // 逐个地址试，第一次拿到的、真的像图片的字节就用它
  const fetchPngBuffer = async (urls) => {
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res?.ok) continue;
        const buffer = await res.arrayBuffer();
        const head = new Uint8Array(buffer.slice(0, 8));
        const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
        const jpg = head[0] === 0xff && head[1] === 0xd8;
        if (!png && !jpg) continue;
        return { url, buffer };
      } catch (error) {
        // 换下一个 type / 下一个地址继续试
      }
    }
    return null;
  };

  // 同名文件被覆盖时（文件名没变、内容变了）也要能发现：每 5 秒打一次 Range 探针，
  // 比「总字节数 / Last-Modified / 文件头」这三样，任一变就当作换了图。
  // 只读前 64 字节（服务端支持 Range 时），不会把整张大图重新拉一遍。
  const IMAGE_STAMP_INTERVAL = 5000;
  const stampOfUrl = async (url) => {
    if (!url) return "";
    try {
      const res = await fetch(url, { headers: { Range: "bytes=0-63" }, cache: "no-store" });
      if (!res) return "";
      const status = Number(res.status || 0);
      if (status !== 206 && !(status === 200 || res.ok)) return "";
      const header = (name) => {
        try {
          return String(res.headers?.get?.(name) || "");
        } catch (error) {
          return "";
        }
      };
      const range = header("content-range");
      const total = Number(String(range).split("/")[1]) || Number(header("content-length")) || 0;
      const modified = header("last-modified");
      let head = "";
      if (status === 206) {
        // 只有真的是分段响应时才读这点正文，避免服务端不支持 Range 时把整张图拉下来
        try {
          const bytes = new Uint8Array(await res.arrayBuffer()).slice(0, 64);
          head = [...bytes].join(",");
        } catch (error) {
          head = "";
        }
      }
      return `${total}|${modified}|${head}`;
    } catch (error) {
      return "";
    }
  };

  // 接口上的图变了就重新导入一次。
  // 用「文件名+子目录」当指纹（不用 /view 地址，地址随 type 变化会误判）；
  // 读失败时把指纹清掉，下一帧还会再试，不会卡在「试过一次就永远不试」；
  // 每次请求带序号，上游又换图时旧请求的结果直接丢弃，避免把上一张图的数据贴上来。
  const syncImageImport = async () => {
    const files = upstreamImageFilesOf("导入原图");
    if (!files.keys.length) {
      if (state.imageImportSource) {
        state.imageImportSource = "";
        state.imageImportOk = false;
        state.imageStamp = "";
        state.imageStampUrl = "";
        state.imageStampAt = 0;
        state.imageImportSeq = (state.imageImportSeq || 0) + 1;
        state.pngCandidates = [];
        state.pngImageUrl = "";
        syncLayoutSwitch();
      }
      return;
    }
    const fingerprint = files.keys.join("|");
    if (fingerprint === state.imageImportSource && state.imageImportOk) {
      // 同名文件被覆盖：定期用「大小 / 修改时间 / 文件头」探一下，变了就重新导入
      if (state.imageImportBusy) return;
      if (Date.now() - (state.imageStampAt || 0) < IMAGE_STAMP_INTERVAL) return;
      state.imageImportBusy = true;
      try {
        const stamp = await stampOfUrl(state.imageStampUrl);
        state.imageStampAt = Date.now();
        if (stamp && state.imageStamp && stamp !== state.imageStamp) {
          state.imageImportOk = false;
          state.imageImportSource = "";
          state.imageImportBusy = false;
          // 交给下一帧按「新图」走正常导入流程
          return;
        }
        if (stamp && !state.imageStamp) state.imageStamp = stamp;
      } finally {
        state.imageImportBusy = false;
      }
      return;
    }
    if (state.imageImportBusy) {
      // 正在读上一张：记下新指纹，等它读完再补一次
      state.imageImportAgain = true;
      return;
    }
    const seq = (state.imageImportSeq || 0) + 1;
    state.imageImportSeq = seq;
    state.imageImportSource = fingerprint;
    state.imageImportOk = false;
    state.imageImportBusy = true;
    state.imageImportAgain = false;
    try {
      const got = await fetchPngBuffer(files.urls);
      if (seq !== state.imageImportSeq) return;
      if (!got) {
        state.imageImportSource = "";
        showToast("导入原图：接进来的这张图读不出来（上游可能不是图像节点，或图片不在 input 目录）");
        return;
      }
      state.imageImportOk = true;
      state.imageStampUrl = got.url;
      state.imageBytes = Number(got.buffer?.byteLength) || 0;
      state.imageStamp = await stampOfUrl(got.url);
      state.imageStampAt = Date.now();
      await runImageImport(got.buffer, got.url, pngBtn);
    } catch (error) {
      if (seq === state.imageImportSeq) state.imageImportSource = "";
      console.warn("[MOSS YXBOX] 导入原图接口读取失败", error);
      showToast("导入原图：这张图读不出来");
    } finally {
      if (seq === state.imageImportSeq) {
        state.imageImportBusy = false;
        if (state.imageImportAgain) {
          state.imageImportAgain = false;
          state.imageImportSource = "";
          state.imageImportOk = false;
        }
      }
    }
  };

  const startPngImport = () => {
    pngPicker.value = "";
    pngPicker.click();
  };

  pngPicker.addEventListener("change", async () => {
    const file = pngPicker.files && pngPicker.files[0];
    pngPicker.value = "";
    if (!file) return;
    let buffer = null;
    try {
      buffer = await file.arrayBuffer();
    } catch (error) {
      showToast("这个文件读不出来，换一张试试");
      return;
    }
    const url = URL.createObjectURL(file);
    await runImageImport(buffer, url, pngBtn);
  });

  // ---------------------------------------------------------------- 导入 / 导出布局提示词
  const captionWidget = () => widget("整体描述");
  const readCaption = () => String(captionWidget()?.value ?? "");

  // 与 nodes.py 的 _boxes_to_regions / _norm_bbox / _compile_layout_local 逐行对应
  // 最终提示词 = 前置文字 + 布局 JSON + 后置文字（都为空时就是原来的样子）
  const composeFinalPrompt = (layout) => {
    const parts = [
      String(state.prefix || "").trim(),
      String(layout || "").trim(),
      String(state.suffix || "").trim(),
    ].filter(Boolean);
    return parts.join("\n");
  };

  const compileLayoutText = () => {
    const caption = readCaption();
    const visible = S.boxes.filter((box) => !box.hidden);
    if (!visible.length) return composeFinalPrompt(caption); // 没有框：后端就是原样输出描述
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
    return composeFinalPrompt(JSON.stringify({
      summary: { caption: caption.trim() },
      items,
      bbox_coord_space: "abs_centralized",
      bbox_format: "yxyx",
    }));
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

  // 从聊天窗口 / 网页里复制出来的 JSON 经常带伤，按顺序分步修补，第一步能解析成功就用：
  // 字符串里的真换行 / 制表符 → 转义；末尾多余逗号 → 删掉；全角引号 → 半角（只在前面都失败时才动，
  // 免得把正文里本来就有的弯引号改成引号、反而把 JSON 弄坏）。
  const escapeControlChar = (ch) => {
    const code = ch.charCodeAt(0);
    if (ch === "\n") return "\\n";
    if (ch === "\r") return "\\r";
    if (ch === "\t") return "\\t";
    if (ch === "\b") return "\\b";
    if (ch === "\f") return "\\f";
    const hex = code.toString(16).padStart(4, "0");
    return `\\u${hex}`;
  };
  const escapeJsonStrings = (text) => {
    const src = String(text || "");
    let out = "";
    let inString = false;
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (!inString) {
        out += ch;
        if (ch === '"') inString = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === "\\") {
        const next = src[i + 1];
        if (next === undefined) {
          out += "\\\\";
          continue;
        }
        // \ 后面跟着真换行/控制字符：多半是 「\n」被编辑器折行了，按换行处理
        if (next.charCodeAt(0) < 0x20) {
          out += escapeControlChar(next);
          i += 1;
          continue;
        }
        out += ch + next;
        i += 1;
        continue;
      }
      // 字符串里的任何裸控制字符（换行、制表符、垂直制表符…）都要转义，否则 JSON.parse 一定失败
      if (ch.charCodeAt(0) < 0x20) {
        out += escapeControlChar(ch);
        continue;
      }
      out += ch;
    }
    return out;
  };
  const stripTrailingCommas = (text) => String(text || "").replace(/,(\s*[}\]])/g, "$1");
  const straightenQuotes = (text) => String(text || "")
    .replace(/[\u201c\u201d\uff02]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  let lastJsonError = "";
  const jsonSlice = (text) => {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      lastJsonError = "";
      return null;
    }
    const body = text.slice(start, end + 1);
    const candidates = [
      body,
      escapeJsonStrings(body),
      stripTrailingCommas(escapeJsonStrings(body)),
      straightenQuotes(stripTrailingCommas(escapeJsonStrings(body))),
      stripTrailingCommas(body),
      straightenQuotes(stripTrailingCommas(body)),
      straightenQuotes(body),
    ];
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed) {
          lastJsonError = "";
          return parsed;
        }
      } catch (error) {
        lastJsonError = String(error?.message || error || "");
      }
    }
    // 把出错位置附近的一小段原文留着，方便定位
    const position = Number((lastJsonError.match(/position (\d+)/) || [])[1]);
    if (Number.isFinite(position) && position > 0) {
      const from = Math.max(0, position - 24);
      const snippet = body.slice(from, position + 24).replace(/\n/g, "⏎");
      lastJsonError = `${lastJsonError}；出错位置附近的原文：${snippet}`;
    }
    return null;
  };

  // 框内文字统一折成「带换行的字符串」：既吃得下字符串（含 \n 转义/真换行），
  // 也吃得下行数组 ["ZERO","REPLICATION"]（有的反推规则为了不踩 JSON 转义，把多行文字写成数组）。
  const textValue = (raw) => {
    if (Array.isArray(raw)) {
      return raw
        .map((line) => (line === null || line === undefined ? "" : String(line)))
        .join("\n");
    }
    if (raw === null || raw === undefined) return "";
    return String(raw).replace(/\r\n?/g, "\n");
  };

  // 标签 → 中文框类型。英文（layout 提示词里的 character/object/text）和中文
  // （画布数据里的角色框/物体框/文字框）都要认，否则整份都会退化成物体框。
  const LABEL_TO_TYPE = {
    text: "文字框", 文字框: "文字框", 文字: "文字框", 文案: "文字框", title: "文字框",
    character: "角色框", char: "角色框", person: "角色框", people: "角色框", figure: "角色框",
    角色框: "角色框", 角色: "角色框", 人物: "角色框",
    object: "物体框", obj: "物体框", thing: "物体框", item: "物体框", prop: "物体框",
    物体框: "物体框", 物体: "物体框",
  };

  // 最后兜底：整段 JSON 怎么修都解析不了时，直接按文本扫描 `"bbox":[...]` 捞框，
  // 至少不会白粘一段。宁可少几个字段，也不要一个框都不建。
  const decodeJsonString = (raw) => {
    if (!raw) return "";
    try {
      return JSON.parse('"' + raw + '"');
    } catch (_error) {
      return String(raw).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  };
  const collectStrings = (fragment, name) => {
    const found = [];
    if (!fragment) return found;
    const re = new RegExp('"' + name + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', "g");
    let match;
    while ((match = re.exec(fragment))) found.push(decodeJsonString(match[1]));
    return found;
  };
  // 从 src 的 quoteIndex 处引号开始读一个 JSON 字符串（认转义、也认字符串里的真换行）
  const unescapeJsonText = (raw) => String(raw).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_all, ch) => {
    if (ch[0] === "u") return String.fromCharCode(parseInt(ch.slice(1), 16));
    const map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };
    return Object.prototype.hasOwnProperty.call(map, ch) ? map[ch] : ch;
  });

  const jsonStringAt = (src, quoteIndex) => {
    if (src[quoteIndex] !== '"') return "";
    let out = "";
    for (let i = quoteIndex + 1; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === "\\") {
        const next = src[i + 1];
        if (next === undefined) break;
        out += ch + next;
        i += 1;
        continue;
      }
      if (ch === '"') return unescapeJsonText(out);
      out += ch;
    }
    // 收尾引号被截掉了：把已有的内容解出来，总比整段整体描述丢掉强
    return unescapeJsonText(out);
  };

  // 在 fragment 里找最后一个 name 字段的字符串值（caption 可能有几千字符、还带真换行）
  const lastJsonText = (fragment, name) => {
    const re = new RegExp('"' + name + '"\\s*:\\s*"', "g");
    let match;
    let last = null;
    while ((match = re.exec(fragment))) last = match;
    if (!last) return "";
    return jsonStringAt(fragment, last.index + last[0].length - 1);
  };

  const salvageData = (text) => {
    const src = String(text || "");
    const bboxes = [];
    const re = /"bbox"\s*:\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g;
    let match;
    while ((match = re.exec(src))) {
      bboxes.push({
        index: match.index,
        values: [match[1], match[2], match[3], match[4]].map((value) => Number(value)),
      });
    }
    if (!bboxes.length) return null;
    const items = bboxes.map((entry, i) => {
      const head = src.slice(Math.max(0, entry.index - 4000), entry.index);
      const tailEnd = i + 1 < bboxes.length
        ? bboxes[i + 1].index
        : Math.min(src.length, entry.index + 400);
      const tail = src.slice(entry.index, tailEnd);
      const pick = (name) => {
        const headValue = lastJsonText(head, name);
        if (headValue) return headValue;
        const tailValues = collectStrings(tail, name);
        return tailValues.length ? tailValues[0] : "";
      };
      return {
        label: pick("label") || pick("type"),
        caption: pick("caption") || pick("desc"),
        text: pick("text"),
        bbox: entry.values,
      };
    });
    let summaryCaption = "";
    // 整体描述在 summary.caption 里，往往几千字符、可能带真换行：
    // 不能用「切 1500 字符窗口 + 正则」的老办法（窗口一刀切就把 caption 截没了）
    const summary = src.match(/"summary"\s*:\s*\{/);
    if (summary) {
      const after = src.slice(summary.index);
      const captionField = /"caption"\s*:\s*"/.exec(after);
      if (captionField) {
        summaryCaption = jsonStringAt(after, captionField.index + captionField[0].length - 1);
      }
    }
    let widthMatch = src.match(/"width"\s*:\s*(\d+)/);
    let heightMatch = src.match(/"height"\s*:\s*(\d+)/);
    // bbox_coord_space / bbox_format 这些声明都写在 JSON 末尾，文本被截断时就一起没了。
    // 这时不能瞎猜成「左上原点像素」：官方编译格式（abs_centralized + yxyx）的值是
    // 相对画布中心的偏移，必然出现负数；草稿（左上原点 xyxy）不会。所以只要看到负数，
    // 就按居中格式处理，画布尺寸用 2×最大绝对偏移倒推 —— 否则按「最大正坐标」估算会把
    // 整张图的框按两个方向不同倍率拉伸（这正是上游文本截断后框全乱的原因）。
    const declared = /abs_centralized/.test(src) || /"bbox_format"\s*:\s*"yxyx"/.test(src);
    const hasNegative = bboxes.some((entry) => entry.values.some((value) => value < 0));
    const centered = declared || hasNegative;
    if (centered && (!widthMatch || !heightMatch)) {
      let maxAbsX = 0;
      let maxAbsY = 0;
      for (const entry of bboxes) {
        const values = entry.values;
        maxAbsX = Math.max(maxAbsX, Math.abs(values[1]), Math.abs(values[3]));
        maxAbsY = Math.max(maxAbsY, Math.abs(values[0]), Math.abs(values[2]));
      }
      // 画布宽高必须是 16 的倍数，倒推值对齐到最近的 16 的倍数
      const snap16 = (value) => Math.max(16, Math.round(value / 16) * 16);
      if (!widthMatch) widthMatch = maxAbsX > 0 ? [null, String(snap16(maxAbsX * 2))] : null;
      if (!heightMatch) heightMatch = maxAbsY > 0 ? [null, String(snap16(maxAbsY * 2))] : null;
    }
    return {
      items,
      width: widthMatch ? Number(widthMatch[1]) : 0,
      height: heightMatch ? Number(heightMatch[1]) : 0,
      bbox_coord_space: centered ? "abs_centralized" : "abs",
      bbox_format: centered ? "yxyx" : "xyxy",
      summary: { caption: summaryCaption },
    };
  };

  // 把整段文本切成「JSON 区间前 / JSON 区间 / JSON 区间后」。
  // 只按位置判定（第一个 { 到最后一个 }），不去猜标点——参不参与布局，就是区间内外的区别。
  const splitJsonOutside = (raw) => {
    const whole = String(raw || "");
    const start = whole.indexOf("{");
    if (start < 0) return { prefix: "", json: "", suffix: "", whole };
    const close = whole.lastIndexOf("}");
    const end = close > start ? close : whole.length - 1;
    return {
      prefix: whole.slice(0, start).trim(),
      json: whole.slice(start, end + 1),
      suffix: whole.slice(end + 1).trim(),
      whole,
    };
  };

  const parseLayoutText = (raw) => {
    const text = stripCodeFence(raw);
    if (!text) return { error: "内容是空的，先粘贴一段布局内容" };
    const split = splitJsonOutside(text);
    let salvaged = false;
    let data = jsonSlice(split.json || text);
    if (!data && /"bbox"\s*:/.test(text)) {
      data = salvageData(text);
      salvaged = !!data;
    }
    if (!data) {
      if (text.startsWith("{") || text.startsWith("[")) {
        const detail = lastJsonError ? `\n解析器原话：${lastJsonError}` : "";
        return { error: `这段 JSON 解析不了（字符串里带真换行、末尾多逗号、全角引号都会这样）。插件已经自动修过一遍仍失败，请检查引号、逗号或括号${detail}` };
      }
      return { kind: "caption", caption: text, prefix: "", suffix: "" };
    }
    if (salvaged) {
      console.warn("[MOSS YXBOX] 这段 JSON 解析不了，已按 bbox 兜底提取出框；建议检查引号与括号");
    }
    if (!Array.isArray(data.items)) {
      // 也认别的写法：summary.items（有些模型把 items 塞在 summary 里）/
      // compositional_deconstruction.elements / elements / boxes
      const alt = data.summary?.items || data.summary?.elements
        || data.compositional_deconstruction?.elements || data.elements || data.boxes;
      if (!Array.isArray(alt)) {
        const caption = String(
          data.caption ?? data.summary?.caption ?? data.high_level_description ?? data.description ?? ""
        ).trim();
        if (!caption) return { error: "没找到 items 列表，也没找到 caption 描述" };
        return { kind: "caption", caption, prefix: "", suffix: "" };
      }
      data.items = alt;
    }
    const space = String(data.bbox_coord_space || "abs").toLowerCase();
    const fmt = String(data.bbox_format || "xyxy").toLowerCase();
    // 草稿如果声明了左下角原点（第一象限），导入时把 y 翻成画布内部的左上原点。
    // 例外：本插件 1.0.3 及更早版本导出的草稿写着 `bbox_origin: bottom-left`，但里面的数字其实是左上原点
    // （当时只有这个标签写错了，数值一直是左上向下）。这种带 `canvas` 包装的老草稿照左上原点读，才不会上下镜像。
    const legacyOwnDraft = !!(data.canvas && data.bbox_origin);
    const bottomLeft = !legacyOwnDraft && /bottom|下/.test(String(data.bbox_origin || "").toLowerCase());
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
        if (bottomLeft) {
          // 左下角原点 → 左上角原点
          y1 = srcH - y1;
          y2 = srcH - y2;
        }
      }
      if (x1 > x2) [x1, x2] = [x2, x1];
      if (y1 > y2) [y1, y2] = [y2, y1];
      const w = Math.round(x2 - x1);
      const h = Math.round(y2 - y1);
      if (w < 8 || h < 8) continue;
      // 画布数据里 label 是显示用的编号（"01" / "B1"），真正的类型在 type 里；
      // 模型输出的布局 JSON 反过来是 label 放类型。先认能对上类型的那个。
      const typeRaw = String(item.type || "").trim().toLowerCase();
      const labelRaw = String(item.label || "").trim().toLowerCase();
      const typeKey = LABEL_TO_TYPE[typeRaw] ? typeRaw : labelRaw;
      const palette = (Array.isArray(item.palette) ? item.palette
        : (Array.isArray(item.color_palette) ? item.color_palette : []))
        .filter((color) => typeof color === "string" && color.trim())
        .slice(0, 5);
      boxes.push({
        type: LABEL_TO_TYPE[typeKey] || "物体框",
        x: Math.round(x1),
        y: Math.round(y1),
        w,
        h,
        text: textValue(item.text),
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
      prefix: split.prefix,
      suffix: split.suffix,
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
    // 前置 / 后置跟这份排版一起换（弹窗整段导入时同样按 JSON 区间切出来的那两段）
    setSideProse(parsed.prefix ?? "", parsed.suffix ?? "");
    applySideHeights();
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

  // 纯自然语言（没有 items）= 只要整体描述：把上一次 JSON 带进来的框和选择一起清掉，
  // 否则从「JSON 提示词」换成「普通提示词」时，画布上会残留上一份的框。
  const clearBoxesForCaption = (caption) => {
    const changed = S.boxes.length > 0 || S.selected.size > 0;
    if (S.boxes.length) S.boxes = [];
    S.selected.clear();
    const target = captionWidget();
    if (target) target.value = caption ?? "";
    if (changed || target) {
      refreshRows();
      layout();
      commit();
      paint();
      node.graph?.setDirtyCanvas?.(true, true);
    }
    return true;
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
              clearBoxesForCaption(parsed.caption);
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
  const layoutSlots = () => (node.inputs || []).filter((item) => String(item?.name) === LAYOUT_INPUT_NAME);

  // 旧工作流里这个输入曾经是「控件→自动派生接入点」，新版改成纯接入点后，
  // 加载时可能同时留下「派生的空槽」和「真正的接入点」两个槽位。
  // 优先取已连线的那一个，其次取真正的 socket（派生槽带 widget 标记），最后才退回第一个。
  const layoutSlot = () => {
    const slots = layoutSlots();
    if (!slots.length) return null;
    const linked = slots.find((item) => item.link != null);
    if (linked) return linked;
    return slots.find((item) => !item.widget) || slots[0];
  };

  // 把多余的重复槽位删掉，只留一个有效接入点。
  // 只动「没连线」的重复项；ComfyUI 的 removeInput 会保持其它输入的连线索引不变。
  let layoutSlotCount = -1;
  const normalizeLayoutInputs = () => {
    const slots = layoutSlots();
    if (slots.length === layoutSlotCount) return;
    layoutSlotCount = slots.length;
    if (slots.length < 2) return;
    const keep = layoutSlot();
    let guard = slots.length;
    for (const slot of slots) {
      if (guard-- <= 0) break;
      if (slot === keep || slot.link != null) continue;
      const at = (node.inputs || []).indexOf(slot);
      if (at < 0) continue;
      try {
        if (typeof node.removeInput === "function") node.removeInput(at);
        else node.inputs.splice(at, 1);
      } catch (error) {
        console.warn("[MOSS YXBOX] 清理重复的接入点失败", error);
      }
    }
    layoutSlotCount = layoutSlots().length;
    node.setDirtyCanvas?.(true, true);
    node.graph?.setDirtyCanvas?.(true, true);
  };

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
      if (HIDDEN_WIDGETS.has(String(item.name || ""))) return false; // 内部数据（画布数据）不能当提示词读
      return !item.name?.match(/^(image|图像|图片|filename|mask|遮罩)$/i);
    };
    const readOutputValue = (keys) => {
      const pools = [];
      const live = app.nodeOutputs?.[originId];
      if (live && typeof live === "object") pools.push(live);
      if (origin?.outputs && typeof origin.outputs === "object") pools.push(origin.outputs);
      for (const pool of pools) {
        for (const key of keys) {
          const raw = pool[key];
          const value = Array.isArray(raw) ? raw[0] : raw;
          if (typeof value === "string" && value.trim()) return value;
        }
      }
      return null;
    };
    // 0) 上游是本插件节点：它的「画布数据」里就有带类型的框，比读文本更准
    //    （A 的 布局提示词 输出在执行时才出现在 nodeOutputs 里，点运行时读不到也不该丢框）
    const canvasWidget = (origin?.widgets || []).find((item) =>
      String(item?.name || "") === "画布数据" && typeof item?.value === "string" && item.value.trim());
    if (canvasWidget) {
      const canvasData = jsonSlice(canvasWidget.value);
      if (canvasData && Array.isArray(canvasData.boxes) && canvasData.boxes.length) {
        const captionOfOrigin = (origin?.widgets || []).find((item) =>
          String(item?.name || "") === "整体描述" && typeof item?.value === "string");
        if (captionOfOrigin && captionOfOrigin.value.trim() && !canvasData.caption) {
          canvasData.caption = captionOfOrigin.value;
        }
        // 画布数据里不存画布尺寸，就从上游的「画布宽 / 画布高」参数补；
        // 都读不到才退回自己画布的尺寸（这时坐标按等比缩放换算）
        const originNum = (names) => {
          for (const name of names) {
            const widget = (origin?.widgets || []).find((item) => String(item?.name || "") === name);
            const value = Number(widget?.value);
            if (Number.isFinite(value) && value > 0) return Math.round(value);
          }
          return 0;
        };
        canvasData.width = Math.round(Number(canvasData.width) || originNum(["画布宽"]) || S.width);
        canvasData.height = Math.round(Number(canvasData.height) || originNum(["画布高"]) || S.height);
        canvasData.bbox_coord_space = "abs";
        canvasData.bbox_format = "xyxy";
        delete canvasData.bgs; // 背景图属于各自节点，不搬过来
        return JSON.stringify(canvasData);
      }
    }
    // 1) 上游真正的「布局提示词」输出（本插件节点之间串联走的就是这条，
    //    拿到的就是编译好、类型完整的布局 JSON）
    const layoutOut = readOutputValue(
      ["布局提示词", "布局提示词输出", "layout_prompt", "layoutPrompt", "layout"]);
    if (layoutOut != null) return layoutOut;

    const widgetsOfOrigin = (origin?.widgets || []).filter(isTextWidget);
    // 2) 像布局 JSON 的文本优先（本插件节点自己那个「布局提示词输入」里可能是上一手的 JSON）
    const looksLayout = (item) => {
      const text = String(item.value || "");
      return text.includes('"bbox"') && (text.includes('"items"') || text.includes('"bboxes"'));
    };
    const layoutWidget = widgetsOfOrigin.find(looksLayout);
    if (layoutWidget) return layoutWidget.value;
    // 3) 再按名字认文本框 / 提示词 / 描述
    const preferred = widgetsOfOrigin.find((item) =>
      /^(text|string|prompt|value|文本|文字|描述|提示词)$/i.test(String(item.name || "").trim()));
    if (preferred) return preferred.value;
    if (widgetsOfOrigin.length) {
      // 没有明确名字就取最长的那条（空字符串也照原样返回：清空＝没有内容）
      return widgetsOfOrigin.reduce((best, item) =>
        (String(item.value).length > String(best.value).length ? item : best)).value;
    }
    // 4) 最后退回执行结果里的纯文本输出
    return readOutputValue(["text", "string", "STRING"]);
  };

  // 和 openImport 走同一个解析器；区别是这里按「当前画布」等比缩放，不反过来改画布尺寸
  const applyLayoutText = (text) => {
    const parsed = parseLayoutText(text);
    if (parsed.error) {
      console.warn("[MOSS YXBOX] 布局提示词导入失败：", parsed.error);
      return false;
    }
    if (parsed.kind === "caption") {
      // 上游换成普通自然语言提示词：只留整体描述，把上一份 JSON 的框清掉；
      // 前后缀也一并清空，免得留下上一份 JSON 的尾巴
      setSideProse("", "");
      clearBoxesForCaption(parsed.caption);
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
    setSideProse(parsed.prefix, parsed.suffix);
    applySideHeights();
    refreshRows();
    layout();
    commit();
    paint();
    node.graph?.setDirtyCanvas?.(true, true);
    return true;
  };

  // 上游文本被清空 → 画布回到「什么都没画」的初始状态（框、选择、描述一起清掉）
  const clearFromSocket = () => {
    if (!S.boxes.length && !String(captionWidget()?.value ?? "").trim()
      && !String(state.prefix || "").trim() && !String(state.suffix || "").trim()) return;
    S.boxes = [];
    S.selected.clear();
    const target = captionWidget();
    if (target) target.value = "";
    // 上游文本被清空：前置 / 后置也一起清掉，不留下上一份内容的残渣
    setSideProse("", "");
    refreshRows();
    layout();
    commit();
    paint();
    node.graph?.setDirtyCanvas?.(true, true);
  };

  let lastLayoutText = null;
  let lastLayoutOk = false;
  let lastLayoutTry = 0;
  const syncLayoutSocket = () => {
    // 先清掉旧工作流留下的重复槽位，保证下面拿到的是真正接着线的那一个
    normalizeLayoutInputs();
    const slot = layoutSlot();
    if (!slot || slot.link == null) {
      lastLayoutText = null;
      lastLayoutOk = false;
      return;
    }
    const text = upstreamLayoutText();
    if (text == null) return;
    if (text === lastLayoutText) {
      // 上一次没导入成功就过一会儿再试，成功了就不重复干活
      if (lastLayoutOk || Date.now() - lastLayoutTry < 1200) return;
    }
    lastLayoutTry = Date.now();
    if (!text.trim()) {
      lastLayoutText = text;
      lastLayoutOk = true;
      clearFromSocket();
      return;
    }
    lastLayoutText = text;
    lastLayoutOk = applyLayoutText(text);
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
    // 原图那一行是「导入原图」接口进来的，预设里不存（换台机器/换图会过期）
    canvas.bgs = (canvas.bgs || []).filter((bg) => bg.kind !== SOURCE_KIND);
    return { widgets, canvas, desc: readCaption() };
  };
  const applyPreset = async (preset, status) => {
    if (!preset) return;
    const data = preset.data || {};
    // 先把「画布尺寸来源」的选项按当前接进来的图重新列一遍：
    // 预设里存的那一档在当前节点不存在时，不能静默被改成「自定义尺寸」。
    normalizeSizeMode();
    syncSizeModeOptions();
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
    syncAspectOptions();
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
        checkRow.appendChild(el("span", null, "同时保存背景图的图片地址（下次加载按地址把图补回那一行；文件被移走或删掉时只提示、不失败）"));
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
    // 与 v1.0.3 之前一致：最小值只给 120，画布区高度不参与「最小高度」推算
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
  // 布局探针：只给自测脚本读数字用，不参与界面
  state.layoutProbe = {
    WIDGET_LABELS,
    listNeeded, listBaseline, listCap, listHeight,
    baseTotalHeight, nodeBaseline, domDesiredHeight,
    stageBaseHeight, stageExtraHeight, stageHeight,
    domWidgetTop, stageReservedHeight, minTotalHeight,
    canvasStep, snapCanvasValue, syncCanvasStep, normalizeCanvasValue, rememberCanvasValue,
    bgShowRows, boxShowRows, bgRowHeight, boxRowHeight, panelHeight, countRows,
    tableHead, bgHead, rows, bgRows, bgScroll, boxScroll,
    bgRowsInput: state.bgRowsInput, boxRowsInput: state.boxRowsInput,
    stageHInput: state.stageHInput, applyStageHeightInput,
    wWidth, wHeight, wLength, wMult,
    tableBar, hideSelBtn, showSelBtn, toolsRow, multiBtn, allBoxesBtn,
    bgInvertBtn, boxInvertBtn,
    headBar: head, stageHField, topBar,
    pngBtn, pngPicker, pngMetaTexts, mossCandidates, applyPngCandidate, canvasDataText, showToast,
    runImageImport, bestPromptText, looksLikePrompt, syncImageImport,
    switchBtn, syncLayoutSwitch, rememberCandidates, persistableImageUrl, fetchPngBuffer,
    upstreamImageFilesOf, pngSizeOf, stampOfUrl, pngCandidates: () => state.pngCandidates,
    canvasSize: () => ({ width: S.width, height: S.height }),
    coordIsDraft, yShown, yFromShown, setCoordMode, syncCoordButtons, axesBtn, draftCoordBtn,
    sourceBg, isSourceBg, ensureSourceBg, dropSourceBg, sizeModeOptions, syncSizeModeOptions,
    modeBgNat, setSizeMode, normalizeSizeMode,
    prefixArea, suffixArea, setSideProse, syncSideValues, splitJsonOutside, composeFinalPrompt,
    proseTotalHeight, applySideHeights, scheduleSideCommit, proseBox, proseArea,
    diagBtn, diagColor, hDivBtn, vDivBtn, hDivColor, vDivColor,
    scheduleSyncBackgrounds, syncBgBusy: () => !!state.bgSyncBusy,
    scheduleRestoredImageRefresh,
    bgList: () => S.bgs,
    bgInfo, bgTitleNote, dropBackground, useAsCanvas,
    boxList: () => S.boxes,
    proseText: () => String(proseWidget?.value ?? ""),
    drawTag, itemColor, drawAxes, drawDiagonals,
    nextLabelNo, fillMissingNos,
    requiredNodeWidth, tableMinWidth, renumberZone, decorateNumHead,
    syncLinkedCanvas, linkedInt, inputSlot, widgetInt, parseSizeText,
    LINK_WIDTH_NAMES, LINK_HEIGHT_NAMES, LINK_LENGTH_NAMES,
    fillBgIntoCanvas, followImageCanvas, applyModeSize, applyCanvasSize, applyLayoutText, applyPngCandidate,
    openPngChooser, showToast, paint, closeMenu, buildMenu,
    syncSizeWidgets, LABEL_TO_TYPE,
    upstreamLayoutText, wMode,
    wAspect, aspectBgOf, aspectOptions, syncAspectOptions,
    ASPECT_AUTO, ASPECT_SOURCE, ASPECT_LEGACY,
  };
  state.canvasStep = canvasStep;
  state.snapCanvasValue = snapCanvasValue;
  state.setShowRows = (value) => {
    const n = Number(value);
    const rows = Number.isFinite(n) ? Math.max(0, Math.min(LIST_ROW_LIMIT, Math.round(n))) : LIST_DEFAULT_ROWS;
    state.bgShowRows = rows;
    state.boxShowRows = rows;
    if (state.bgRowsInput) state.bgRowsInput.value = String(rows);
    if (state.boxRowsInput) state.boxRowsInput.value = String(rows);
    layout();
  };
  state.setBgShowRows = (value) => {
    const n = Number(value);
    state.bgShowRows = Number.isFinite(n) ? Math.max(0, Math.min(LIST_ROW_LIMIT, Math.round(n))) : LIST_DEFAULT_ROWS;
    if (state.bgRowsInput) state.bgRowsInput.value = String(state.bgShowRows);
    layout();
  };
  state.setBoxShowRows = (value) => {
    const n = Number(value);
    state.boxShowRows = Number.isFinite(n) ? Math.max(0, Math.min(LIST_ROW_LIMIT, Math.round(n))) : LIST_DEFAULT_ROWS;
    if (state.boxRowsInput) state.boxRowsInput.value = String(state.boxShowRows);
    layout();
  };
  state.root = root;
  state.wheelHandler = onWheelCapture;
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
  state.scrollEl = bgScroll;
  state.rowsEl = rows;
  state.ensureBgInputs = ensureBgInputs;
  state.geo = geo;
  state.undo = undoStep;
  state.redo = redoStep;
  state.copyBoxes = copySelection;
  state.pasteBoxes = pasteClipboard;
  state.itemLabel = itemLabel;
  state.clipboardLabel = clipboardLabel;
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
