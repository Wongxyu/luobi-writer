<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { FolderOpen, Minus, Maximize2, X } from '@lucide/vue'
import Editor from './components/Editor.vue'
import {
  workspacePath,
  workspaceName,
  currentFileExt,
  selectWorkspace,
  sanitizeFileName,
  saveToWorkspace,
  checkFileExists,
  readFileByName,
  openFile,
} from './composables/useWorkspace'

// ── 编辑器内容 ────────────────────────────────────
const title = ref('')
const content = ref('')
const editorRef = ref<InstanceType<typeof Editor>>()
const titleInputRef = ref<HTMLInputElement>()

// ── 遮罩状态：标题未回车前，遮罩覆盖编辑器，点击→聚焦标题
const editorActive = ref(false)

const autoSaving = ref(false)

// ── Dirty 追踪 ────────────────────────────────────
let lastSavedTitle = ''
let lastSavedContent = ''
const dirty = ref(false)
let autoSaveTimer: ReturnType<typeof setInterval> | null = null

function markDirty() {
  dirty.value = title.value !== lastSavedTitle || content.value !== lastSavedContent
}
function markClean() {
  lastSavedTitle = title.value
  lastSavedContent = content.value
  dirty.value = false
}

watch([title, content], markDirty)

/** 保存（Ctrl+S 和自动保存共用）：静默覆盖
 *  @param silent 静默模式（自动保存时不弹 Toast，改底部栏闪烁）
 */
async function handleSave(silent = false) {
  if (!dirty.value) return
  if (!content.value.trim() && !title.value.trim()) return
  if (!workspacePath.value) return

  if (silent) autoSaving.value = true

  const fileName = sanitizeFileName(title.value.trim()) || '未命名'
  const body = title.value.trim() + '\n' + content.value
  const saved = await saveToWorkspace(fileName, body)
  if (saved) {
    markClean()
    if (silent) {
      setTimeout(() => { autoSaving.value = false }, 1500)
    } else {
      showToast(`已保存: ${saved}`)
    }
  } else if (silent) {
    autoSaving.value = false
  }
}

// ── 标题回车：冲突检测 ────────────────────────────
const conflictModal = ref<{
  visible: boolean
  fileName: string
  resolve: (value: 'open' | 'rename' | null) => void
}>({
  visible: false,
  fileName: '',
  resolve: () => {},
})

async function handleTitleEnter() {
  const name = sanitizeFileName(title.value.trim())
  if (!name) return

  // 确保工作区
  if (!workspacePath.value) {
    await selectWorkspace()
    if (!workspacePath.value) return
  }

  // 冲突检测
  if (await checkFileExists(name)) {
    // 弹窗：打开 or 重命名
    const choice = await new Promise<'open' | 'rename' | null>((resolve) => {
      conflictModal.value = { visible: true, fileName: name, resolve }
    })
    if (choice === 'open') {
      // 读取文件内容，填入编辑器
      const fileContent = await readFileByName(name)
      if (fileContent !== null) {
        const lines = fileContent.split('\n')
        title.value = (lines[0] || '').trim()
        content.value = lines.slice(1).join('\n')
        markClean()
      }
      editorActive.value = true
      editorRef.value?.focus()
    } else if (choice === 'rename') {
      // 回到标题，全选文字
      conflictModal.value.visible = false
      titleInputRef.value?.focus()
      titleInputRef.value?.select()
    }
  } else {
    // 无冲突：创建空文件，进入编辑
    const body = name + '\n'
    const saved = await saveToWorkspace(name, body)
    if (saved) {
      markClean()
      editorActive.value = true
      editorRef.value?.focus()
    }
  }
}

function resolveConflictOpen() {
  conflictModal.value.resolve('open')
  conflictModal.value.visible = false
}

function resolveConflictRename() {
  conflictModal.value.resolve('rename')
  conflictModal.value.visible = false
}

// ── 编辑器设置（从 localStorage 恢复） ────────────
const STORAGE_KEY = 'luobi-settings'
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (saved.fontSize) fontSize.value = saved.fontSize
    if (saved.lineHeight) lineHeight.value = saved.lineHeight
    if (saved.paragraphSpacing != null) paragraphSpacing.value = saved.paragraphSpacing
    if (saved.showLineNumbers != null) showLineNumbers.value = saved.showLineNumbers
  } catch {}
}
function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    fontSize: fontSize.value,
    lineHeight: lineHeight.value,
    paragraphSpacing: paragraphSpacing.value,
    showLineNumbers: showLineNumbers.value,
  }))
}

const fontSize = ref(16)
const lineHeight = ref(1.5)
const paragraphSpacing = ref(1)
const showLineNumbers = ref(true)

loadSettings()

function adjustSetting(key: 'fontSize' | 'lineHeight' | 'paragraphSpacing', delta: number, min: number, max: number) {
  const refMap = { fontSize, lineHeight, paragraphSpacing }
  const r = refMap[key]
  const next = Math.round((r.value + delta) * 10) / 10
  r.value = Math.min(max, Math.max(min, next))
  saveSettings()
}

function toggleLineNumbers() {
  showLineNumbers.value = !showLineNumbers.value
  saveSettings()
}

// ── 字数统计 ──────────────────────────────────────
const wordCount = computed(() => {
  const chineseChars = (content.value.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const englishWords = (content.value.match(/[a-zA-Z]+/g) || []).length
  return { chars: chineseChars, words: englishWords, total: chineseChars + englishWords }
})

// ── 当前文件名（含扩展名） ────────────────────────
const currentFullName = computed(() => {
  const name = sanitizeFileName(title.value.trim()) || '未命名'
  const ext = currentFileExt.value === 'md' ? '.md' : '.txt'
  return name.endsWith(ext) ? name : name + ext
})

// ── 下拉菜单 ──────────────────────────────────────
const menuOpen = ref(false)
const menuRef = ref<HTMLElement>()

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function handleClickOutside(e: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    menuOpen.value = false
  }
}

// ── Ctrl+N: 新建文件 ──────────────────────────────
async function handleNewFile() {
  if (editorActive.value) await handleSave(true)
  title.value = ''
  content.value = ''
  currentFileExt.value = 'txt'
  editorActive.value = false
  markClean()
  titleInputRef.value?.focus()
}

// ── Ctrl+O: 打开文件 ──────────────────────────────
async function handleOpenFile() {
  if (editorActive.value) await handleSave(true)

  const result = await openFile()
  if (result) {
    title.value = result.fileName
    content.value = result.body
    currentFileExt.value = result.ext
    markClean()
    editorActive.value = true
    editorRef.value?.focus()
  }
}

// ── 切换工作区：保存当前→选择新→重置 ──────────
async function handleSwitchWorkspace() {
  // 先保存当前文件到旧工作区
  if (editorActive.value) await handleSave(true)

  const oldPath = workspacePath.value
  await selectWorkspace()

  // 确实切换了工作区
  if (workspacePath.value && workspacePath.value !== oldPath) {
    title.value = ''
    content.value = ''
    currentFileExt.value = 'txt'
    editorActive.value = false
    markClean()
    titleInputRef.value?.focus()
  }
}

// ── Toast ─────────────────────────────────────────
const toast = ref<{ visible: boolean; message: string }>({ visible: false, message: '' })
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string) {
  toast.value = { visible: true, message: msg }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value.visible = false }, 2000)
}

// ── 生命周期 ──────────────────────────────────────
onMounted(async () => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeydown)
  try { await invoke('show_main_window') } catch {}
  autoSaveTimer = setInterval(() => { if (editorActive.value) handleSave(true) }, 30_000)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
  if (autoSaveTimer) clearInterval(autoSaveTimer)
  if (editorActive.value) handleSave(true)
})

// ── 快捷键 ────────────────────────────────────────
function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    if (editorActive.value) handleSave(true)
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault()
    handleNewFile()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault()
    handleOpenFile()
    return
  }
}

// ── 窗口控制 ──────────────────────────────────────
const appWindow = getCurrentWindow()
function minimize() { appWindow.minimize() }
function toggleMaximize() { appWindow.toggleMaximize() }
function close() { appWindow.close() }
</script>

<template>
  <div class="app-layout">
    <!-- 标题栏 -->
    <header class="titlebar" data-tauri-drag-region>
      <div class="titlebar-left" ref="menuRef">
        <span class="app-title" @click.stop="toggleMenu">Writer</span>
        <Transition name="dropdown">
          <div v-if="menuOpen" class="dropdown-menu">
            <div class="menu-item" @click="handleSwitchWorkspace(); menuOpen = false">打开工作区</div>
            <div class="menu-item" @click="handleSave(); menuOpen = false">保存 (Ctrl+S)</div>
            <div class="menu-divider"></div>
            <div class="menu-setting">
              <span class="setting-label">字体大小</span>
              <div class="setting-control">
                <button class="adj-btn" @click="adjustSetting('fontSize', -1, 12, 28)">−</button>
                <span class="setting-value">{{ fontSize }}</span>
                <button class="adj-btn" @click="adjustSetting('fontSize', 1, 12, 28)">+</button>
              </div>
            </div>
            <div class="menu-setting">
              <span class="setting-label">段落间距</span>
              <div class="setting-control">
                <button class="adj-btn" @click="adjustSetting('paragraphSpacing', -0.5, 0, 5)">−</button>
                <span class="setting-value">{{ paragraphSpacing }}</span>
                <button class="adj-btn" @click="adjustSetting('paragraphSpacing', 0.5, 0, 5)">+</button>
              </div>
            </div>
            <div class="menu-setting">
              <span class="setting-label">行距</span>
              <div class="setting-control">
                <button class="adj-btn" @click="adjustSetting('lineHeight', -0.1, 1.0, 3.0)">−</button>
                <span class="setting-value">{{ lineHeight.toFixed(1) }}</span>
                <button class="adj-btn" @click="adjustSetting('lineHeight', 0.1, 1.0, 3.0)">+</button>
              </div>
            </div>
            <div class="menu-setting">
              <span class="setting-label">行号显示</span>
              <button class="toggle-btn" :class="{ active: showLineNumbers }" @click="toggleLineNumbers">
                {{ showLineNumbers ? '开' : '关' }}
              </button>
            </div>
          </div>
        </Transition>
      </div>

      <button class="workspace-btn" :class="{ 'no-workspace': !workspacePath }" @click="handleSwitchWorkspace()" :title="workspacePath || '选择工作区'">
        <FolderOpen :size="14" class="workspace-icon" />
        <span class="workspace-label">{{ workspaceName || '选择工作区' }}</span>
      </button>

      <div class="titlebar-right">
        <button class="win-btn" @click="minimize" title="最小化"><Minus :size="15" :stroke-width="1.5" /></button>
        <button class="win-btn" @click="toggleMaximize" title="最大化"><Maximize2 :size="13" :stroke-width="1.5" /></button>
        <button class="win-btn close" @click="close" title="关闭"><X :size="15" :stroke-width="1.5" /></button>
      </div>
    </header>

    <!-- 标题输入 + 编辑区 -->
    <main class="editor-area">
      <input ref="titleInputRef" class="title-input" v-model="title" placeholder="开始输入…"
        maxlength="30"
        @keydown.enter.prevent="handleTitleEnter" />
      <div class="editor-wrapper">
        <Editor ref="editorRef" v-model="content" @save="handleSave" @empty-backspace="titleInputRef?.focus()"
          :font-size="fontSize" :line-height="lineHeight" :paragraph-spacing="paragraphSpacing" :show-line-numbers="showLineNumbers" />
        <!-- 遮罩：标题未回车前覆盖编辑器 -->
        <div v-if="!editorActive" class="editor-mask" @click="titleInputRef?.focus()">
          <div class="mask-tips">
            <div class="mask-row"><span>保存</span><span>Ctrl+S</span></div>
            <div class="mask-row"><span>新建</span><span>Ctrl+N</span></div>
            <div class="mask-row"><span>打开</span><span>Ctrl+O</span></div>
            <div class="mask-row"><span>光标</span><span>Ctrl+J/L/I/K</span></div>
          </div>
        </div>
      </div>
    </main>

    <!-- 状态栏 -->
    <footer class="statusbar">
      <span class="statusbar-saving" :class="{ show: autoSaving }">● 保存中</span>
      <span class="statusbar-filename" :title="currentFullName">{{ currentFullName }}</span>
      <span class="statusbar-right">{{ wordCount.total }} 字</span>
    </footer>

    <!-- 冲突弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="conflictModal.visible" class="modal-overlay" @click.self="resolveConflictRename">
          <div class="modal-box">
            <div class="modal-title">文件已存在</div>
            <div class="modal-text">
              工作区中已存在 <strong>{{ conflictModal.fileName }}</strong>
            </div>
            <div class="modal-actions">
              <button class="modal-btn primary" @click="resolveConflictOpen">打开</button>
              <button class="modal-btn" @click="resolveConflictRename">重命名</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast.visible" class="toast">{{ toast.message }}</div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── 布局 ───────────────────────────────────────── */
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--border);
  overflow: hidden;
}

/* ── 标题栏 ─────────────────────────────────────── */
.titlebar {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0;
  background: var(--sidebar-bg);
  border-bottom: 1px solid var(--border);
  user-select: none;
  flex-shrink: 0;
}

.titlebar-left {
  position: relative;
  padding-left: 10px;
  -webkit-app-region: no-drag;
}

.app-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text);
  opacity: 0.8;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 4px;
  transition: background 0.15s;
}
.app-title:hover { background: rgba(0,0,0,0.06); }

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 180px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  padding: 4px 0;
  z-index: 100;
}
.menu-item {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}
.menu-item:hover { background: rgba(0,0,0,0.06); }

.menu-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 12px;
}

.menu-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  font-size: 13px;
  color: var(--text);
}

.setting-label {
  color: var(--text);
  opacity: 0.7;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 0;
}

.adj-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 16px;
  color: var(--text);
  opacity: 0.6;
  transition: background 0.15s, opacity 0.15s;
}
.adj-btn:hover { background: rgba(0,0,0,0.06); opacity: 0.9; }

.setting-value {
  width: 32px;
  text-align: center;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  opacity: 0.8;
}

.toggle-btn {
  padding: 2px 12px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--muted);
  background: rgba(0,0,0,0.04);
  transition: all 0.15s;
}
.toggle-btn.active {
  color: #fff;
  background: #333;
}

/* 工作区按钮 */
.workspace-btn {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 12px;
  background: rgba(0,0,0,0.05);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text);
  opacity: 0.7;
  max-width: 200px;
  -webkit-app-region: no-drag;
}
.workspace-btn:hover { background: rgba(0,0,0,0.09); opacity: 0.9; }
.workspace-icon { flex-shrink: 0; }
.workspace-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 窗口控制 ───────────────────────────────────── */
.titlebar-right {
  display: flex;
  margin-left: auto;
  padding-right: 8px;
  -webkit-app-region: no-drag;
  gap: 4px;
}

.win-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: #666;
  transition: background 0.1s, color 0.1s;
}
.win-btn:hover { background: rgba(0,0,0,0.06); }
.win-btn.close:hover { background: var(--destructive); color: #fff; }

/* ── 编辑区 ─────────────────────────────────────── */
.editor-area { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.editor-wrapper { flex: 1; position: relative; overflow: hidden; }
.editor-mask {
  position: absolute;
  inset: 0;
  z-index: 10;
  cursor: text;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mask-tips {
  text-align: center;
  color: #aaa;
  font-size: 14px;
  line-height: 2.4;
  pointer-events: none;
}
.mask-row {
  display: flex;
  justify-content: space-between;
  width: 200px;
  margin: 0 auto;
}
.title-input {
  border: none;
  outline: none;
  background: var(--cm-bg);
  font-family: 'LXGW WenKai', 'PingFang SC', 'Microsoft YaHei', serif;
  font-size: 20px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #333;
  padding: 2rem 3rem 0.75rem 2.5rem;
  width: 100%;
  box-sizing: border-box;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.title-input::placeholder { color: #ccc; }
.title-input:focus { outline: none; }

/* ── 状态栏 ─────────────────────────────────────── */
.statusbar {
  display: flex;
  align-items: center;
  padding: 0.25rem 1.5rem;
  font-size: 11px;
  color: #888;
  background: var(--sidebar-bg);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  min-width: 0;
  position: relative;
}
.statusbar-filename {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
.statusbar-saving {
  color: #888;
  opacity: 0;
  font-size: 11px;
  flex-shrink: 0;
}
.statusbar-saving.show {
  opacity: 1;
  animation: auto-save-dot 0.6s ease-in-out infinite alternate;
}
@keyframes auto-save-dot {
  from { opacity: 0.3; }
  to { opacity: 1; }
}
.statusbar-right { margin-left: auto; flex-shrink: 0; }

/* ── 动画 ───────────────────────────────────────── */
.dropdown-enter-active { transition: opacity 0.12s, transform 0.12s; }
.dropdown-leave-active { transition: opacity 0.08s, transform 0.08s; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(-4px); }

.modal-enter-active { transition: opacity 0.15s; }
.modal-leave-active { transition: opacity 0.1s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-box {
  background: #fff;
  border-radius: 10px;
  padding: 24px 28px;
  min-width: 300px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.15);
}
.modal-title { font-weight: 600; font-size: 15px; margin-bottom: 12px; }
.modal-text { font-size: 13px; color: #666; margin-bottom: 20px; }
.modal-text strong { color: var(--text); }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

.modal-btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  background: rgba(0,0,0,0.05);
  color: var(--text);
  transition: background 0.15s;
}
.modal-btn:hover { background: rgba(0,0,0,0.1); }
.modal-btn.primary { background: #333; color: #fff; }
.modal-btn.primary:hover { background: #555; }
.modal-btn.ghost { color: #999; }

.toast {
  position: fixed;
  top: 48px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 18px;
  border-radius: 4px;
  background: rgba(0,0,0,0.75);
  color: #fff;
  font-size: 12px;
  z-index: 1001;
}
.toast-enter-active { transition: opacity 0.2s, transform 0.2s; }
.toast-leave-active { transition: opacity 0.15s; }
.toast-enter-from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
.toast-leave-to { opacity: 0; }
</style>

<style>
/* 非 scoped：呼吸动画（避免 Vue scoped 哈希干扰 @keyframes） */
.workspace-btn.no-workspace {
  animation: breathe-double 4s ease-in-out infinite;
}
@keyframes breathe-double {
  0%, 20% { background: rgba(0,0,0,0.05); }
  28%, 36% { background: rgba(0,0,0,0.15); }
  44%, 56% { background: rgba(0,0,0,0.05); }
  64%, 72% { background: rgba(0,0,0,0.15); }
  80%, 100% { background: rgba(0,0,0,0.05); }
}
</style>
