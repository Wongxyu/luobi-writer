<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, shallowRef } from 'vue'
import { EditorState, Range } from '@codemirror/state'
import {
  EditorView,
  keymap,
  highlightActiveLine,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  gutter,
  GutterMarker,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, cursorCharLeft, cursorCharRight, cursorLineUp, cursorLineDown } from '@codemirror/commands'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

const props = defineProps<{
  modelValue: string
  fontSize: number
  lineHeight: number
  paragraphSpacing: number
  showLineNumbers: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'save': []
  'empty-backspace': []
}>()

/** 供父组件调用，聚焦编辑器 */
defineExpose({ focus: () => viewRef.value?.focus() })

const editorRef = ref<HTMLDivElement>()
const viewRef = shallowRef<EditorView>()

// ── 段落间距装饰 ──────────────────────────────────
function buildParagraphSpacingPlugin() {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.build(update.view)
      }
    }

    build(view: EditorView): DecorationSet {
      const decos: Range<Decoration>[] = []
      const lines = view.state.doc.lines
      for (let i = 1; i <= lines; i++) {
        const line = view.state.doc.line(i)
        decos.push(Decoration.line({ class: 'cm-paragraph-end' }).range(line.from))
      }
      return Decoration.set(decos)
    }
  }, {
    decorations: v => v.decorations,
  })
}

// ── 行号 + 占位（始终渲染，关行号时渲染空块保留宽度） ──
class LineNumberMarker extends GutterMarker {
  num: number
  constructor(num: number) {
    super()
    this.num = num
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-fln'
    el.textContent = String(this.num)
    return el
  }
}

class PlaceholderMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-fln-placeholder'
    return el
  }
}

const lineNumberGutter = gutter({
  class: 'cm-floating-gutter',
  lineMarker(view, line) {
    if (!props.showLineNumbers) return new PlaceholderMarker()
    return new LineNumberMarker(view.state.doc.lineAt(line.from).number)
  },
})

// ── 段落导览条（Minimap） ──────────────────────────
const lineMinimap = ViewPlugin.fromClass(class {
  dom: HTMLElement
  view: EditorView
  activeLine = 0
  isDragging = false

  constructor(view: EditorView) {
    this.view = view
    this.dom = document.createElement('div')
    this.dom.className = 'cm-minimap'
    this.dom.addEventListener('mousedown', this.onMouseDown)
    this.dom.addEventListener('dblclick', (e) => e.preventDefault())
    view.dom.appendChild(this.dom)
    this.activeLine = view.state.doc.lineAt(view.state.selection.main.head).number
    this.renderBlocks()
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.geometryChanged || update.viewportChanged) {
      this.renderBlocks()
    }
    if (update.selectionSet) {
      this.activeLine = update.state.doc.lineAt(update.state.selection.main.head).number
      this.updateActive()
    }
  }

  /** 重算色块位置（仅文档/布局变化时调用） */
  renderBlocks() {
    const view = this.view
    const scroller = view.scrollDOM
    const viewportH = scroller.clientHeight
    const scrollH = scroller.scrollHeight
    if (viewportH <= 0 || scrollH <= 0) { this.dom.innerHTML = ''; return }

    const lines = view.state.doc.lines
    // 每段实际像素高度
    const blockHeights: number[] = []
    for (let i = 1; i <= lines; i++) {
      const block = view.lineBlockAt(view.state.doc.line(i).from)
      blockHeights.push(block.height)
    }
    const totalH = blockHeights.reduce((a, b) => a + b, 0)

    let html = ''
    for (let i = 1; i <= lines; i++) {
      const ratio = totalH > 0 ? blockHeights[i - 1] / totalH : 1 / lines
      const isActive = i === this.activeLine
      html += `<div class="cm-mm-block${isActive ? ' active' : ''}" data-line="${i}" style="flex-grow:${ratio}"></div>`
    }
    this.dom.innerHTML = html
  }

  /** 仅更新高亮（选区变化时调用，不重算位置） */
  updateActive() {
    this.dom.querySelectorAll('.active').forEach(el => el.classList.remove('active'))
    const block = this.dom.querySelector(`[data-line="${this.activeLine}"]`)
    if (block) block.classList.add('active')
  }

  /** 根据鼠标 Y 坐标，定位到对应段落行号（用 getBoundingClientRect） */
  getLineAt(clientY: number): number {
    const containerRect = this.dom.getBoundingClientRect()
    const y = clientY - containerRect.top
    const blocks = this.dom.querySelectorAll('.cm-mm-block') as NodeListOf<HTMLElement>
    if (blocks.length === 0) return 1
    let closest = 1, minDist = Infinity
    blocks.forEach(b => {
      const r = b.getBoundingClientRect()
      const center = r.top + r.height / 2 - containerRect.top
      const dist = Math.abs(y - center)
      if (dist < minDist) { minDist = dist; closest = parseInt(b.dataset.line!) }
    })
    return closest
  }

  /** 将光标移到指定行的行尾，并滚动到可视区域 */
  moveCursorToLine(lineNum: number) {
    const line = this.view.state.doc.line(lineNum)
    this.view.dispatch({ selection: { anchor: line.to } })
  }

  /** 滚动编辑器，使目标行居中 */
  scrollToLine(lineNum: number) {
    const block = this.view.lineBlockAt(this.view.state.doc.line(lineNum).from)
    const scroller = this.view.scrollDOM
    const targetTop = block.top + block.height / 2 - scroller.clientHeight / 2
    scroller.scrollTo({ top: Math.max(0, targetTop) })
  }

  onMouseDown = (e: MouseEvent) => {
    e.preventDefault()
    this.isDragging = true
    const lineNum = this.getLineAt(e.clientY)
    this.moveCursorToLine(lineNum)
    this.scrollToLine(lineNum)

    const onMove = (ev: MouseEvent) => {
      if (this.isDragging) {
        const ln = this.getLineAt(ev.clientY)
        this.moveCursorToLine(ln)
        this.scrollToLine(ln)
      }
    }
    const onUp = () => {
      this.isDragging = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  destroy() {
    this.dom.remove()
  }
}, {
  decorations: () => Decoration.none,
})

// ── 英文括号自动闭合（CM6 原生） ──────────────────
const bracketAutoClose = [
  closeBrackets(),
  keymap.of(closeBracketsKeymap),
]

// ── 中文引号自动配对（裸 DOM 层操作，绕过 IME 状态机冲突） ──
const QUOTE_PAIRS: Record<string, string> = {
  '“': '”', '‘': '’', '「': '」', '『': '』',
  '【': '】', '（': '）', '《': '》',
  '”': '“', '’': '‘',
}
const LEFT_SIDE_QUOTES = ['”', '’']

function getEventData(e: Event): string | null {
  return (e as CompositionEvent).data ?? (e as InputEvent).data ?? null
}

function handleDOMQuote(e: Event) {
  const target = e.target as HTMLElement
  if (!target) return
  const tag = target.tagName

  if (e.type !== 'compositionend' && (e as InputEvent).inputType !== 'insertText') return

  const data = getEventData(e)
  if (!data) return
  const pair = QUOTE_PAIRS[data]
  if (!pair) return

  if (tag === 'TEXTAREA' || tag === 'INPUT') {
    handleInputQuote(target as HTMLInputElement | HTMLTextAreaElement, data, pair)
  } else {
    handleContentEditableQuote(data, pair)
  }
}

function handleInputQuote(el: HTMLInputElement | HTMLTextAreaElement, data: string, pair: string) {
  const isLeft = LEFT_SIDE_QUOTES.includes(data)
  if (isLeft) {
    el.setSelectionRange((el.selectionStart ?? 0) - 1, (el.selectionEnd ?? 0) - 1)
  }

  el.setRangeText(pair)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  ;(el as any).refreshSearch?.()

  if (isLeft) {
    el.setSelectionRange((el.selectionStart ?? 0) + 1, (el.selectionEnd ?? 0) + 1)
  }
}

function handleContentEditableQuote(data: string, pair: string) {
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  const isLeft = LEFT_SIDE_QUOTES.includes(data)

  if (isLeft) {
    const { startContainer, startOffset, endContainer, endOffset } = range
    range.setStart(startContainer, startOffset - 1)
    range.setEnd(endContainer, endOffset - 1)
  }

  const textNode = document.createTextNode(pair)
  range.insertNode(textNode)

  if (isLeft) {
    range.setStartAfter(textNode)
  } else {
    range.setEndBefore(textNode)
  }
  range.commonAncestorContainer.normalize()
}

function startDOMQuoteHandler() {
  document.addEventListener('compositionend', handleDOMQuote)
  document.addEventListener('input', handleDOMQuote as EventListener)
}

function stopDOMQuoteHandler() {
  document.removeEventListener('compositionend', handleDOMQuote)
  document.removeEventListener('input', handleDOMQuote as EventListener)
}

// ── 回车自动滚动 ──────────────────────────────────
const autoScrollOnEnter = keymap.of([{
  key: 'Enter',
  run: (view) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const pos = view.state.selection.main.head
        const coords = view.coordsAtPos(pos)
        if (!coords) return
        const scroller = view.scrollDOM
        const rect = scroller.getBoundingClientRect()
        const targetY = rect.top + scroller.clientHeight * 0.55
        const offset = coords.top - targetY
        if (offset > 0) {
          scroller.scrollBy({ top: offset })
        }
      })
    })
    return false
  },
}])

// ── Ctrl+S 保存 ──────────────────────────────────
const saveKeymap = keymap.of([{
  key: 'Mod-s',
  run: () => {
    emit('save')
    return true
  },
}])

// ── 空文档 Backspace → 通知父组件切回标题 ────────
const emptyBackspaceKeymap = keymap.of([{
  key: 'Backspace',
  run: (view) => {
    if (view.state.doc.length === 0) {
      emit('empty-backspace')
      return true
    }
    return false
  },
}])

// ── 构建主题（根据 props 动态生成） ──────────────
function buildTheme(fs: number, lh: number, ps: number) {
  return EditorView.theme({
    '&': {
      height: '100%',
      fontSize: `${fs}px`,
      lineHeight: `${lh}`,
      fontFamily: '"LXGW WenKai", "PingFang SC", "Microsoft YaHei", serif',
      background: 'var(--cm-bg)',
      color: '#333333',
      position: 'relative',
    },
    '& ::selection': {
      background: '#d0d0d0',
    },
    '.cm-content': {
      padding: '8px 30px 32px 4px',
      maxWidth: '800px',
      margin: '0 auto',
      fontFamily: '"LXGW WenKai", "PingFang SC", "Microsoft YaHei", serif',
      color: '#333333',
    },
    '.cm-content::after': {
      content: '""',
      display: 'block',
      height: '40vh',
    },
    '.cm-gutters': {
      position: 'sticky',
      left: '0',
      background: 'transparent',
      border: 'none',
      zIndex: '2',
    },
    '.cm-scroller': {
      position: 'relative',
      overflow: 'auto',
    },
    '.cm-floating-gutter': {
      width: '2rem',
    },
    '.cm-fln': {
      fontSize: '13px',
      color: '#ccc',
      textAlign: 'left',
      fontFamily: '"LXGW WenKai", "PingFang SC", "Microsoft YaHei", serif',
      height: `${fs * lh}px`,
      lineHeight: `${fs * lh}px`,
    },
    '.cm-fln-placeholder': {
      display: 'inline-block',
      width: '2rem',
      height: `${fs * lh}px`,
    },
    '.cm-line': {
      lineHeight: `${lh}`,
    },
    '.cm-activeLine': {
      background: 'rgba(0, 0, 0, 0.015)',
    },
    '.cm-activeLineGutter': {
      background: 'rgba(0, 0, 0, 0.02)',
    },
    '.cm-selectionBackground': {
      background: 'rgba(0, 0, 0, 0.1) !important',
    },
    '.cm-cursor': {
      borderLeftColor: '#333',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#333',
    },
    '.cm-paragraph-end': {
      paddingBottom: `${ps}em`,
    },
  })
}

// ── 创建编辑器 ────────────────────────────────────
function createEditor(docContent?: string) {
  if (!editorRef.value) return

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      emit('update:modelValue', update.state.doc.toString())
    }
  })

  const state = EditorState.create({
    doc: docContent ?? props.modelValue,
    extensions: [
      lineNumberGutter,
      lineMinimap,
      highlightActiveLine(),
      history(),
      EditorView.lineWrapping,

      // 键盘映射
      autoScrollOnEnter,
      emptyBackspaceKeymap,
      saveKeymap,
      ...bracketAutoClose,
      // 过滤掉 defaultKeymap 中的 Mod-i（selectParentSyntax），避免和我们的 Ctrl-i 冲突
      keymap.of(defaultKeymap.filter(b => b.key !== 'Mod-i')),
      keymap.of(historyKeymap),

      // Vim-style 方向键（Ctrl+J/L/I/K → 左右上下）
      keymap.of([
        { key: 'Ctrl-j', run: cursorCharLeft },
        { key: 'Ctrl-l', run: cursorCharRight },
        { key: 'Ctrl-i', run: cursorLineUp },
        { key: 'Ctrl-k', run: cursorLineDown },
      ]),

      // 语言
      markdown({ base: markdownLanguage, addKeymap: false }),

      // 段落间距
      buildParagraphSpacingPlugin(),

      // 文档更新
      updateListener,

      // 主题
      buildTheme(props.fontSize, props.lineHeight, props.paragraphSpacing),
    ],
  })

  viewRef.value = new EditorView({ state, parent: editorRef.value })
}

onMounted(() => {
  startDOMQuoteHandler()
  createEditor()
  // 容器被点击时强制聚焦 CM6，避免焦点落到标题 input
  editorRef.value?.addEventListener('mousedown', (e: MouseEvent) => {
    if (document.activeElement !== viewRef.value?.contentDOM) {
      e.preventDefault()
      viewRef.value?.focus()
    }
  })
})
onUnmounted(() => {
  stopDOMQuoteHandler()
  viewRef.value?.destroy()
})

// 监听设置变化，重建编辑器
watch([() => props.fontSize, () => props.lineHeight, () => props.paragraphSpacing, () => props.showLineNumbers], () => {
  const view = viewRef.value
  const content = view ? view.state.doc.toString() : ''
  view?.destroy()
  if (editorRef.value) {
    editorRef.value.innerHTML = ''
  }
  createEditor(content || props.modelValue)
})

watch(() => props.modelValue, (newVal) => {
  const view = viewRef.value
  if (!view) return
  if (newVal !== view.state.doc.toString()) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: newVal },
    })
  }
})

</script>

<template>
  <div class="editor-container" ref="editorRef"></div>
</template>

<style scoped>
.editor-container {
  height: 100%;
  overflow: hidden;
}
.editor-container :deep(.cm-editor) {
  height: 100%;
}
.editor-container :deep(.cm-scroller) {
  overflow: auto;
}

/* 自定义滚动条（隐藏） */
.editor-container :deep(.cm-scroller::-webkit-scrollbar) {
  width: 0;
  height: 0;
}

/* ── 段落导览条（Minimap） ─────────────────────── */
.editor-container :deep(.cm-minimap) {
  position: absolute;
  right: 0;
  top: 0;
  width: 12px;
  height: 100%;
  pointer-events: auto;
  z-index: 10;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0;
  align-items: flex-end;
}
.editor-container :deep(.cm-mm-block) {
  flex-shrink: 0;
  min-height: 2px;
  max-height: 60px;
  width: 8px;
  background: rgba(0, 0, 0, 0.1);
  transition: width 0.1s, background 0.1s;
}
.editor-container :deep(.cm-mm-block:hover) {
  background: rgba(0, 0, 0, 0.2);
  width: 10px;
}
.editor-container :deep(.cm-mm-block.active) {
  background: rgba(0, 0, 0, 0.45);
  width: 14px;
}
</style>
