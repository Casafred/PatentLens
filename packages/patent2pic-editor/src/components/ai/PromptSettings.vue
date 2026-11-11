<template>
  <div class="prompt-settings">
    <el-tabs v-model="activeTab" class="prompt-tabs">
      <el-tab-pane label="结构类提示词" name="structure">
        <div class="tab-desc">用于装置/设备/系统类权利要求的拆解构图</div>
      </el-tab-pane>
      <el-tab-pane label="方法类提示词" name="method">
        <div class="tab-desc">用于方法/流程/过程类权利要求的拆解构图</div>
      </el-tab-pane>
      <el-tab-pane label="混合类提示词" name="mixed">
        <div class="tab-desc">用于装置类权利要求中嵌套方法步骤的混合拆解构图</div>
      </el-tab-pane>
    </el-tabs>

    <template v-if="activeTab === 'structure'">
      <div class="prompt-section">
        <div class="section-header">
          <h4>系统提示词 (System Prompt)</h4>
          <el-button size="small" text type="warning" @click="resetSystemPrompt">恢复默认</el-button>
        </div>
        <p class="section-desc">定义 AI 的角色和行为规范，影响抽取结果的质量和格式</p>
        <el-input
          v-model="systemPrompt"
          type="textarea"
          :rows="8"
          placeholder="输入系统提示词"
          @change="handleSystemPromptChange"
        />
      </div>

      <div class="prompt-section">
        <div class="section-header">
          <h4>用户提示词模板 (User Prompt)</h4>
          <el-button size="small" text type="warning" @click="resetUserPrompt">恢复默认</el-button>
        </div>
        <p class="section-desc">定义发送给 AI 的具体指令，<code>{claimText}</code> 会被替换为实际权利要求文本</p>
        <el-input
          v-model="userPromptTemplate"
          type="textarea"
          :rows="10"
          placeholder="输入用户提示词模板"
          @change="handleUserPromptChange"
        />
      </div>

      <div class="prompt-actions">
        <el-button size="small" @click="resetAll">全部恢复默认</el-button>
        <el-button size="small" type="primary" @click="handlePreview('structure')">预览完整提示词</el-button>
      </div>
    </template>

    <template v-else-if="activeTab === 'method'">
      <div class="prompt-section">
        <div class="section-header">
          <h4>方法类系统提示词 (System Prompt)</h4>
          <el-button size="small" text type="warning" @click="resetMethodSystemPrompt">恢复默认</el-button>
        </div>
        <p class="section-desc">定义 AI 对方法类权利要求的分析规则，包括步骤/判断/条件节点和顺序/分支/触发关系的提取</p>
        <el-input
          v-model="methodSystemPrompt"
          type="textarea"
          :rows="8"
          placeholder="输入方法类系统提示词"
          @change="handleMethodSystemPromptChange"
        />
      </div>

      <div class="prompt-section">
        <div class="section-header">
          <h4>方法类用户提示词模板 (User Prompt)</h4>
          <el-button size="small" text type="warning" @click="resetMethodUserPrompt">恢复默认</el-button>
        </div>
        <p class="section-desc">定义发送给 AI 的方法类分析指令，<code>{claimText}</code> 会被替换为实际权利要求文本</p>
        <el-input
          v-model="methodUserPromptTemplate"
          type="textarea"
          :rows="10"
          placeholder="输入方法类用户提示词模板"
          @change="handleMethodUserPromptChange"
        />
      </div>

      <div class="prompt-actions">
        <el-button size="small" @click="resetAllMethod">全部恢复默认</el-button>
        <el-button size="small" type="primary" @click="handlePreview('method')">预览完整提示词</el-button>
      </div>
    </template>

    <template v-else>
      <div class="prompt-section">
        <div class="section-header">
          <h4>混合类系统提示词 (System Prompt)</h4>
          <el-button size="small" text type="warning" @click="resetMixedSystemPrompt">恢复默认</el-button>
        </div>
        <p class="section-desc">定义 AI 对混合型权利要求的分析规则，同时提取组件节点和方法步骤节点，组件的方法行为拆解为独立步骤</p>
        <el-input
          v-model="mixedSystemPrompt"
          type="textarea"
          :rows="8"
          placeholder="输入混合类系统提示词"
          @change="handleMixedSystemPromptChange"
        />
      </div>

      <div class="prompt-section">
        <div class="section-header">
          <h4>混合类用户提示词模板 (User Prompt)</h4>
          <el-button size="small" text type="warning" @click="resetMixedUserPrompt">恢复默认</el-button>
        </div>
        <p class="section-desc">定义发送给 AI 的混合类分析指令，<code>{claimText}</code> 会被替换为实际权利要求文本</p>
        <el-input
          v-model="mixedUserPromptTemplate"
          type="textarea"
          :rows="10"
          placeholder="输入混合类用户提示词模板"
          @change="handleMixedUserPromptChange"
        />
      </div>

      <div class="prompt-actions">
        <el-button size="small" @click="resetAllMixed">全部恢复默认</el-button>
        <el-button size="small" type="primary" @click="handlePreview('mixed')">预览完整提示词</el-button>
      </div>
    </template>

    <el-dialog
      v-model="showPreview"
      title="提示词预览"
      width="600px"
      append-to-body
    >
      <div class="preview-content">
        <div class="preview-section">
          <h5>System Prompt</h5>
          <pre class="preview-text">{{ previewSystem }}</pre>
        </div>
        <div class="preview-section">
          <h5>User Prompt</h5>
          <pre class="preview-text">{{ previewUser.replace('{claimText}', '[权利要求文本将插入此处]') }}</pre>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  getSystemPrompt,
  getUserPromptTemplate,
  setSystemPrompt,
  setUserPromptTemplate,
  getDefaultSystemPrompt,
  getDefaultUserPromptTemplate,
  getMethodSystemPrompt,
  getMethodUserPromptTemplate,
  setMethodSystemPrompt,
  setMethodUserPromptTemplate,
  getDefaultMethodSystemPrompt,
  getDefaultMethodUserPromptTemplate,
  getMixedSystemPrompt,
  getMixedUserPromptTemplate,
  setMixedSystemPrompt,
  setMixedUserPromptTemplate,
  getDefaultMixedSystemPrompt,
  getDefaultMixedUserPromptTemplate,
} from '@/services/ai/prompt'

const activeTab = ref<'structure' | 'method' | 'mixed'>('structure')

// 结构类提示词
const systemPrompt = ref('')
const userPromptTemplate = ref('')

// 方法类提示词
const methodSystemPrompt = ref('')
const methodUserPromptTemplate = ref('')

// 混合类提示词
const mixedSystemPrompt = ref('')
const mixedUserPromptTemplate = ref('')

// 预览
const showPreview = ref(false)
const previewSystem = ref('')
const previewUser = ref('')

onMounted(() => {
  systemPrompt.value = getSystemPrompt()
  userPromptTemplate.value = getUserPromptTemplate()
  methodSystemPrompt.value = getMethodSystemPrompt()
  methodUserPromptTemplate.value = getMethodUserPromptTemplate()
  mixedSystemPrompt.value = getMixedSystemPrompt()
  mixedUserPromptTemplate.value = getMixedUserPromptTemplate()
})

// 结构类
function handleSystemPromptChange(): void {
  setSystemPrompt(systemPrompt.value)
}

function handleUserPromptChange(): void {
  setUserPromptTemplate(userPromptTemplate.value)
}

function resetSystemPrompt(): void {
  systemPrompt.value = getDefaultSystemPrompt()
  setSystemPrompt(systemPrompt.value)
}

function resetUserPrompt(): void {
  userPromptTemplate.value = getDefaultUserPromptTemplate()
  setUserPromptTemplate(userPromptTemplate.value)
}

function resetAll(): void {
  resetSystemPrompt()
  resetUserPrompt()
}

// 方法类
function handleMethodSystemPromptChange(): void {
  setMethodSystemPrompt(methodSystemPrompt.value)
}

function handleMethodUserPromptChange(): void {
  setMethodUserPromptTemplate(methodUserPromptTemplate.value)
}

function resetMethodSystemPrompt(): void {
  methodSystemPrompt.value = getDefaultMethodSystemPrompt()
  setMethodSystemPrompt(methodSystemPrompt.value)
}

function resetMethodUserPrompt(): void {
  methodUserPromptTemplate.value = getDefaultMethodUserPromptTemplate()
  setMethodUserPromptTemplate(methodUserPromptTemplate.value)
}

function resetAllMethod(): void {
  resetMethodSystemPrompt()
  resetMethodUserPrompt()
}

// 混合类
function handleMixedSystemPromptChange(): void {
  setMixedSystemPrompt(mixedSystemPrompt.value)
}

function handleMixedUserPromptChange(): void {
  setMixedUserPromptTemplate(mixedUserPromptTemplate.value)
}

function resetMixedSystemPrompt(): void {
  mixedSystemPrompt.value = getDefaultMixedSystemPrompt()
  setMixedSystemPrompt(mixedSystemPrompt.value)
}

function resetMixedUserPrompt(): void {
  mixedUserPromptTemplate.value = getDefaultMixedUserPromptTemplate()
  setMixedUserPromptTemplate(mixedUserPromptTemplate.value)
}

function resetAllMixed(): void {
  resetMixedSystemPrompt()
  resetMixedUserPrompt()
}

// 预览
function handlePreview(type: 'structure' | 'method' | 'mixed'): void {
  if (type === 'structure') {
    previewSystem.value = systemPrompt.value
    previewUser.value = userPromptTemplate.value
  } else if (type === 'method') {
    previewSystem.value = methodSystemPrompt.value
    previewUser.value = methodUserPromptTemplate.value
  } else {
    previewSystem.value = mixedSystemPrompt.value
    previewUser.value = mixedUserPromptTemplate.value
  }
  showPreview.value = true
}
</script>

<style scoped>
.prompt-settings {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.prompt-tabs {
  margin-bottom: -8px;
}

.prompt-tabs :deep(.el-tabs__header) {
  margin-bottom: 8px;
}

.prompt-tabs :deep(.el-tabs__item) {
  font-size: var(--font-size-sm);
  padding: 0 12px;
  height: 32px;
  line-height: 32px;
}

.tab-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-bottom: var(--spacing-sm);
}

.prompt-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-header h4 {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
}

.section-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-bottom: var(--spacing-xs);
}

.section-desc code {
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: var(--font-size-xs);
  color: var(--color-primary);
}

.prompt-actions {
  display: flex;
  gap: var(--spacing-sm);
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--border-color-light);
}

.preview-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.preview-section h5 {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: var(--spacing-xs);
}

.preview-text {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
}
</style>
