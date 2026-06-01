# 落笔写作

> 轻量桌面码字工具 — 专注、简洁、开箱即用。

一个为写作者设计的 Windows 桌面应用。没有复杂的功能堆砌，只有码字时真正需要的东西：安静的界面、流畅的编辑体验、可靠的自动保存。

---

## 为什么选择落笔写作

- **真正的「轻量」** — 启动快、占用低，打开就能写
- **开箱即用** — 内置中文字体（霞鹜文楷），无需任何配置
- **专注写作** — 黑白灰极简界面，没有花花绿绿的按钮来打扰你
- **段落导览** — 右侧色块 Minimap，一眼看清全文段落分布，点击瞬间跳转
- **可靠的保存** — 30 秒自动保存 + 关闭前补存，不会丢稿
- **工作区模式** — 指定一个文件夹作为工作区，所有文稿集中管理

---

## 功能速览

### 写作体验

- 纯文本写作，支持 `.txt` / `.md` 格式
- 中文引号自动补全（`「」` `""` `【】`）
- 字体大小、行距、段落间距实时调节
- 行号显示可开关
- Vim 风格方向键（`Ctrl+J/L/I/K`）

### 文件管理

- **新建文件** `Ctrl+N`
- **打开文件** `Ctrl+O`
- **保存文件** `Ctrl+S`（静默覆盖，无弹窗打扰）
- **自动保存**：每 30 秒自动保存，窗口关闭时补存一次
- **工作区**：选择本地文件夹，所有文件集中在工作区中管理
- **切换工作区**：切换时自动保存当前文件

### 段落导览条

编辑区域右侧的色块导航条，替代传统滚动条：

- 每个色块代表一个段落，高度按段落比例自动调整
- 当前光标所在段落高亮显示
- 点击或拖拽色块 → 瞬间跳转到对应段落

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+S` | 保存 |
| `Ctrl+N` | 新建文件 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+J` | 光标左移 |
| `Ctrl+L` | 光标右移 |
| `Ctrl+I` | 光标上移 |
| `Ctrl+K` | 光标下移 |

---

## 安装

从 [Releases](../../releases/latest) 下载 `luobi-writer_x.x.x_x64-setup.exe`，双击安装即可。

> **系统要求**：Windows 10/11（Win10 21H2+ 及 Win11 已内置 WebView2 运行时）

---

## 致谢

本应用基于以下开源项目构建：

- **[霞鹜文楷](https://github.com/lxgw/LxgwWenKai)** — 内置中文字体，[SIL Open Font License 1.1](https://github.com/lxgw/LxgwWenKai/blob/main/OFL.txt)
- **[CodeMirror](https://github.com/codemirror/codemirror)** — 文本编辑器引擎，[MIT](https://github.com/codemirror/codemirror/blob/main/LICENSE-MIT)
- **[Vue.js](https://github.com/vuejs/core)** — 前端框架，[MIT](https://github.com/vuejs/core/blob/main/LICENSE)
- **[Tauri](https://github.com/tauri-apps/tauri)** — 桌面应用框架，[Apache-2.0 / MIT](https://github.com/tauri-apps/tauri/blob/dev/LICENSE_APACHE-2.0)
- **[Lucide](https://github.com/lucide-icons/lucide)** — 图标库，[ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE)

---

## 开源协议

MIT License © wongxu
