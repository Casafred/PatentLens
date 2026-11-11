<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    :title="isNode ? '编辑节点' : '编辑关系'"
    width="420px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div class="edit-form">
      <div class="form-group">
        <label>{{ isNode ? '原文部件名称' : '原文关系词' }}</label>
        <el-input
          v-model="originalText"
          placeholder="原文语言"
          size="default"
        />
      </div>
      <div class="form-group">
        <label>{{ isNode ? '中文对照' : '中文关系词' }}</label>
        <el-input
          v-model="chineseText"
          placeholder="中文翻译"
          size="default"
        />
      </div>
      <div v-if="isNode" class="form-group">
        <label>节点类型</label>
        <el-select v-model="nodeType" size="default" class="full-select">
          <el-option-group label="结构类">
            <el-option label="部件 (component)" value="component" />
            <el-option label="子系统 (subsystem)" value="subsystem" />
            <el-option label="特征 (feature)" value="feature" />
          </el-option-group>
          <el-option-group label="方法类">
            <el-option label="步骤 (step)" value="step" />
            <el-option label="判断 (decision)" value="decision" />
            <el-option label="条件 (condition)" value="condition" />
          </el-option-group>
        </el-select>
      </div>
      <div v-if="!isNode" class="form-group">
        <label>关系类型</label>
        <el-select v-model="relationType" size="default" class="full-select">
          <el-option-group label="结构类">
            <el-option label="位置关系" value="position" />
            <el-option label="动作关系" value="action" />
            <el-option label="包含关系" value="containment" />
            <el-option label="逻辑关系" value="logical" />
            <el-option label="属性关系" value="attribute" />
          </el-option-group>
          <el-option-group label="方法类">
            <el-option label="先后顺序" value="sequence" />
            <el-option label="是 (branch_true)" value="branch_true" />
            <el-option label="否 (branch_false)" value="branch_false" />
            <el-option label="触发关系" value="trigger" />
            <el-option label="反馈回路" value="feedback" />
            <el-option label="并行执行" value="parallel" />
          </el-option-group>
        </el-select>
      </div>
    </div>
    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { NodeType, RelationType } from '@/types/graph'

const props = defineProps<{
  visible: boolean
  isNode: boolean
  initialOriginalText: string
  initialChineseText: string
  initialNodeType?: NodeType
  initialRelationType?: RelationType
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'save': [data: { originalText: string; chineseText: string; nodeType?: NodeType; relationType?: RelationType }]
}>()

const originalText = ref('')
const chineseText = ref('')
const nodeType = ref<NodeType>('component')
const relationType = ref<RelationType>('position')

watch(() => props.visible, (val) => {
  if (val) {
    originalText.value = props.initialOriginalText
    chineseText.value = props.initialChineseText
    if (props.initialNodeType) nodeType.value = props.initialNodeType
    if (props.initialRelationType) relationType.value = props.initialRelationType
  }
})

function handleSave(): void {
  emit('save', {
    originalText: originalText.value,
    chineseText: chineseText.value,
    nodeType: props.isNode ? nodeType.value : undefined,
    relationType: !props.isNode ? relationType.value : undefined,
  })
  emit('update:visible', false)
}
</script>

<style scoped>
.edit-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.form-group label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-secondary);
}

.full-select {
  width: 100%;
}
</style>
