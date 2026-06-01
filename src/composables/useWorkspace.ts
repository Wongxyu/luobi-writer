import { ref, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { exists, writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { join, basename, extname } from '@tauri-apps/api/path'

export const workspacePath = ref<string | null>(null)
export const workspaceName = ref<string | null>(null)

// 从 localStorage 恢复工作区路径
const savedPath = localStorage.getItem('luobi-workspace')
if (savedPath) {
  workspacePath.value = savedPath
}

// 路径变化时更新文件夹名，并持久化
watch(workspacePath, async (path) => {
  if (path) {
    workspaceName.value = await basename(path)
    localStorage.setItem('luobi-workspace', path)
  } else {
    workspaceName.value = null
    localStorage.removeItem('luobi-workspace')
  }
}, { immediate: true })

export const currentFileExt = ref<'txt' | 'md'>('txt')

/** 检查工作区中是否存在同名文件 */
export async function checkFileExists(fileName: string): Promise<boolean> {
  if (!workspacePath.value) return false
  const ext = currentFileExt.value === 'md' ? '.md' : '.txt'
  const savedName = fileName.endsWith('.txt') || fileName.endsWith('.md')
    ? fileName
    : `${fileName}${ext}`
  try {
    return await exists(await join(workspacePath.value, savedName))
  } catch {
    return false
  }
}

/** 读取工作区中的文件（按文件名） */
export async function readFileByName(fileName: string): Promise<string | null> {
  if (!workspacePath.value) return null
  const ext = currentFileExt.value === 'md' ? '.md' : '.txt'
  const savedName = fileName.endsWith('.txt') || fileName.endsWith('.md')
    ? fileName
    : `${fileName}${ext}`
  try {
    const fullPath = await join(workspacePath.value, savedName)
    return await readTextFile(fullPath)
  } catch {
    return null
  }
}

/** 直接保存/覆盖文件到工作区 */
export async function saveToWorkspace(fileName: string, body: string): Promise<string | null> {
  if (!workspacePath.value) return null

  const ext = currentFileExt.value === 'md' ? '.md' : '.txt'
  const savedName = fileName.endsWith('.txt') || fileName.endsWith('.md')
    ? fileName
    : `${fileName}${ext}`
  const fullPath = await join(workspacePath.value, savedName)

  await writeTextFile(fullPath, body)
  return savedName
}

/** 打开文件选择器，读取 .txt / .md 文件 */
export async function openFile(): Promise<{ fileName: string; body: string; ext: 'txt' | 'md' } | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: '文本文件', extensions: ['txt', 'md'] }],
  })
  if (!selected || typeof selected !== 'string') return null

  const content = await readTextFile(selected)
  const name = await basename(selected)
  const ext = (await extname(selected)).toLowerCase()
  const fileExt: 'txt' | 'md' = ext === 'md' ? 'md' : 'txt'

  // 首行作为标题（文件名），剩余作为正文
  const lines = content.split('\n')
  const titleLine = (lines[0] || '').trim() || name.replace(/\.(txt|md)$/i, '')
  const body = lines.slice(1).join('\n')

  currentFileExt.value = fileExt
  return { fileName: titleLine, body, ext: fileExt }
}

/** 选择工作区文件夹 */
export async function selectWorkspace() {
  const selected = await open({ directory: true, title: '选择工作区文件夹' })
  if (selected && typeof selected === 'string') {
    workspacePath.value = selected
  }
}

/** 过滤 Windows 不支持的文件名字符 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\x00-\x1f]/g, '')
    .trim()
}
