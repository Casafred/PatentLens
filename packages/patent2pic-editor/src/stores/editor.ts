import { editorStorage } from '@/services/host/storage'
import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 布局预设：用户对当前布局不满意时一键切换 */
export type LayoutPreset = 'default' | 'focus' | 'compare' | 'review'

interface LayoutState {
  preset: LayoutPreset
  /** 工作区抽屉是否展开（覆盖式浮层，不挤占画布宽度） */
  drawerOpen: boolean
  /** 输入/阅读面板是否显示 */
  inputPanelVisible: boolean
  /** 输入/阅读面板宽度 */
  inputPanelWidth: number
  /** 强制显示右侧样式面板（不看选中状态） */
  forceStylePanel: boolean
}

const LAYOUT_KEY = 'patent2pic-layout'

/** 各预设的面板组合（抽屉开关独立于预设，由用户单独控制） */
export const LAYOUT_PRESETS: Record<LayoutPreset, Omit<LayoutState, 'preset' | 'drawerOpen'>> = {
  default: { inputPanelVisible: true, inputPanelWidth: 360, forceStylePanel: false },
  focus: { inputPanelVisible: false, inputPanelWidth: 360, forceStylePanel: false },
  compare: { inputPanelVisible: true, inputPanelWidth: 480, forceStylePanel: false },
  review: { inputPanelVisible: true, inputPanelWidth: 360, forceStylePanel: true },
}

function loadLayout(): LayoutState {
  try {
    const raw = editorStorage.getItem(LAYOUT_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      const preset: LayoutPreset = data.preset && data.preset in LAYOUT_PRESETS
        ? data.preset
        : 'default'
      const width = Number(data.inputPanelWidth)
      return {
        preset,
        drawerOpen: !!data.drawerOpen,
        inputPanelVisible: data.inputPanelVisible !== false,
        inputPanelWidth: Number.isFinite(width) && width >= 280 && width <= 600
          ? width
          : LAYOUT_PRESETS[preset].inputPanelWidth,
        forceStylePanel: !!data.forceStylePanel,
      }
    }
  } catch {
    // 读取失败则用默认布局
  }
  return { preset: 'default', drawerOpen: false, ...LAYOUT_PRESETS.default }
}

export const useEditorStore = defineStore('editor', () => {
  const selectedNodeIds = ref<string[]>([])
  const selectedEdgeIds = ref<string[]>([])
  const highlightedNodeIds = ref<string[]>([])
  const highlightedComboIds = ref<string[]>([])
  const activePanel = ref<'style' | 'ai' | null>(null)
  const zoom = ref(1)
  const isDirty = ref(false)
  const layout = ref<LayoutState>(loadLayout())

  function persistLayout(): void {
    try {
      editorStorage.setItem(LAYOUT_KEY, JSON.stringify(layout.value))
    } catch {
      // 持久化失败不影响使用
    }
  }

  function applyLayoutPreset(preset: LayoutPreset): void {
    layout.value = { ...layout.value, preset, ...LAYOUT_PRESETS[preset] }
    persistLayout()
  }

  /** 工作区抽屉开合（覆盖式，不影响画布宽度） */
  function toggleWorkspaceDrawer(): void {
    layout.value = { ...layout.value, drawerOpen: !layout.value.drawerOpen }
    persistLayout()
  }

  function closeWorkspaceDrawer(): void {
    if (!layout.value.drawerOpen) return
    layout.value = { ...layout.value, drawerOpen: false }
    persistLayout()
  }

  function toggleInputPanel(): void {
    layout.value = { ...layout.value, inputPanelVisible: !layout.value.inputPanelVisible }
    persistLayout()
  }

  /** 拖拽调整输入面板宽度（拖拽过程中不写 editorStorage，由 persistLayout 收尾） */
  function setInputPanelWidth(width: number): void {
    layout.value = { ...layout.value, inputPanelWidth: width }
  }

  function toggleForceStylePanel(): void {
    layout.value = { ...layout.value, forceStylePanel: !layout.value.forceStylePanel }
    persistLayout()
  }

  function selectNodes(ids: string[]): void {
    selectedNodeIds.value = ids
    selectedEdgeIds.value = []
  }

  function highlightNodes(ids: string[]): void {
    highlightedNodeIds.value = ids
  }

  function highlightCombos(ids: string[]): void {
    highlightedComboIds.value = ids
  }

  function toggleNodeInSelection(id: string): void {
    const idx = selectedNodeIds.value.indexOf(id)
    if (idx >= 0) {
      selectedNodeIds.value.splice(idx, 1)
    } else {
      selectedNodeIds.value.push(id)
    }
    selectedEdgeIds.value = []
  }

  function selectEdges(ids: string[]): void {
    selectedEdgeIds.value = ids
    selectedNodeIds.value = []
  }

  function clearSelection(): void {
    selectedNodeIds.value = []
    selectedEdgeIds.value = []
    highlightedNodeIds.value = []
    highlightedComboIds.value = []
  }

  function togglePanel(panel: 'style' | 'ai' | null): void {
    activePanel.value = activePanel.value === panel ? null : panel
  }

  function setZoom(value: number): void {
    zoom.value = Math.max(0.1, Math.min(3, value))
  }

  function markDirty(): void {
    isDirty.value = true
  }

  function markClean(): void {
    isDirty.value = false
  }

  return {
    selectedNodeIds,
    selectedEdgeIds,
    highlightedNodeIds,
    highlightedComboIds,
    activePanel,
    zoom,
    isDirty,
    layout,
    selectNodes,
    highlightNodes,
    highlightCombos,
    toggleNodeInSelection,
    selectEdges,
    clearSelection,
    togglePanel,
    setZoom,
    markDirty,
    markClean,
    applyLayoutPreset,
    persistLayout,
    toggleWorkspaceDrawer,
    closeWorkspaceDrawer,
    toggleInputPanel,
    setInputPanelWidth,
    toggleForceStylePanel,
  }
})
