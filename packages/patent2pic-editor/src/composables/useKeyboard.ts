import { onMounted, onUnmounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import { graphEngine } from '@/services/graph/engine'
import { useEditorStore, type LayoutPreset } from '@/stores/editor'

/** 布局快捷键：Ctrl/Cmd+Shift+1..4 切换预设 */
const LAYOUT_PRESET_KEYS: Record<string, LayoutPreset> = {
  Digit1: 'default',
  Digit2: 'focus',
  Digit3: 'compare',
  Digit4: 'review',
}

export function useKeyboard() {
  const editorStore = useEditorStore()

  /** 布局相关快捷键，命中返回 true */
  function handleLayoutKey(e: KeyboardEvent): boolean {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return false

    const preset = LAYOUT_PRESET_KEYS[e.code]
    if (preset) {
      e.preventDefault()
      editorStore.applyLayoutPreset(preset)
      return true
    }
    if (e.code === 'KeyB') {
      e.preventDefault()
      editorStore.toggleWorkspaceDrawer()
      return true
    }
    if (e.code === 'KeyE') {
      e.preventDefault()
      editorStore.toggleInputPanel()
      return true
    }
    return false
  }

  async function handleKeyDown(e: KeyboardEvent): Promise<void> {
    const isCtrl = e.ctrlKey || e.metaKey

    if (handleLayoutKey(e)) return

    const active = document.activeElement
    if (active?.matches('input, textarea, select, [contenteditable="true"]')) return

    if (isCtrl && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      graphEngine.undo()
    }

    if (isCtrl && e.key === 'z' && e.shiftKey) {
      e.preventDefault()
      graphEngine.redo()
    }

    if (isCtrl && e.key === 'y') {
      e.preventDefault()
      graphEngine.redo()
    }

    if (isCtrl && e.key === 'a') {
      e.preventDefault()
      graphEngine.selectAll()
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const activeEl = document.activeElement
      const tagName = activeEl?.tagName?.toLowerCase()
      const isContentEditable = activeEl?.getAttribute?.('contenteditable') === 'true'
      const isInputFocused = tagName === 'input' || tagName === 'textarea' || tagName === 'select' || isContentEditable
      if (isInputFocused) return

      const nodeIds = graphEngine.getSelectedNodeIds()
      const edgeIds = graphEngine.getSelectedEdgeIds()
      if (nodeIds.length > 0 || edgeIds.length > 0) {
        e.preventDefault()

        const allConnectedEdgeIds: string[] = []
        for (const nodeId of nodeIds) {
          allConnectedEdgeIds.push(...graphEngine.getConnectedEdgeIds(nodeId))
        }

        const totalEdges = allConnectedEdgeIds.length + edgeIds.length

        if (nodeIds.length > 0 && totalEdges > 0) {
          try {
            await ElMessageBox.confirm(
              `选中的 ${nodeIds.length} 个节点有 ${totalEdges} 条相关边关系，请选择删除方式：`,
              '确认删除',
              {
                distinguishCancelAndClose: true,
                confirmButtonText: '删除节点/边和相关边',
                cancelButtonText: '仅删除节点/边',
                type: 'warning',
              }
            )
            nodeIds.forEach(id => graphEngine.removeNodeWithOption(id, true))
            edgeIds.forEach(id => graphEngine.removeEdge(id))
            editorStore.clearSelection()
          } catch (action: unknown) {
            if (action === 'cancel') {
              nodeIds.forEach(id => graphEngine.removeNodeWithOption(id, false))
              edgeIds.forEach(id => graphEngine.removeEdge(id))
              editorStore.clearSelection()
            }
          }
        } else {
          try {
            const itemText = nodeIds.length > 0
              ? `${nodeIds.length} 个节点`
              : `${edgeIds.length} 条边关系`
            await ElMessageBox.confirm(
              `确定要删除选中的 ${itemText} 吗？`,
              '确认删除',
              {
                confirmButtonText: '删除',
                cancelButtonText: '取消',
                type: 'warning',
              }
            )
            nodeIds.forEach(id => graphEngine.removeNodeWithOption(id, true))
            edgeIds.forEach(id => graphEngine.removeEdge(id))
            editorStore.clearSelection()
          } catch {
            // 用户取消
          }
        }
      }
    }

    if (e.key === 'Escape') {
      graphEngine.clearSelection()
      editorStore.clearSelection()
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown)
  })
}
