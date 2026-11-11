<script setup lang="ts">
import { ref } from 'vue'
import { useAIStore } from '@/stores/ai'
import { getHost } from '@/services/host/bridge'
import PromptSettings from './PromptSettings.vue'
defineProps<{ visible: boolean }>()
defineEmits<{ 'update:visible': [value: boolean] }>()
const aiStore = useAIStore()
const tab = ref('model')
const selectedResponse = ref('')
function openSettings(): void { getHost().openAISettings() }
</script>
<template>
  <el-dialog :model-value="visible" @update:model-value="$emit('update:visible', $event)" title="成图设置" width="680px" destroy-on-close>
    <el-tabs v-model="tab">
      <el-tab-pane label="AI 模型" name="model">
        <p>供应商与密钥由 PatentLens 统一管理。</p>
        <el-button @click="openSettings">打开 PatentLens AI 设置</el-button>
        <el-button @click="aiStore.refreshProfiles">刷新配置</el-button>
        <div class="setting-row"><el-button text @click="aiStore.followHost">恢复继承 PatentLens 当前模型</el-button><span>{{ aiStore.followsHost ? '正在继承' : '使用成图专用模型' }}</span></div>
        <label>成图供应商</label>
        <el-select :model-value="aiStore.activeProviderType" @update:model-value="aiStore.setActiveProvider" class="wide">
          <el-option v-for="profile in aiStore.profiles" :key="profile.type" :value="profile.type" :label="profile.name + (profile.configured ? '' : '（未配置）')" />
        </el-select>
        <label>成图 / 重构模型</label>
        <el-select :model-value="aiStore.activeModel" @update:model-value="aiStore.updateDefaultModel(aiStore.activeProviderType, $event)" filterable allow-create class="wide">
          <el-option v-for="model in aiStore.activeModels" :key="model" :value="model" :label="model" />
        </el-select>
        <el-alert v-if="!aiStore.activeApiKey" type="warning" :closable="false" title="请先在 PatentLens 中配置该供应商" />
      </el-tab-pane>
      <el-tab-pane label="提示词" name="prompt"><PromptSettings /></el-tab-pane>
      <el-tab-pane label="翻译" name="translation">
        <div class="setting-row"><span>启用翻译</span><el-switch :model-value="aiStore.translationConfig.enabled" @update:model-value="aiStore.updateTranslationConfig({ enabled: $event })" /></div>
        <div class="setting-row"><span>自动翻译</span><el-switch :model-value="aiStore.translationConfig.autoTranslate" @update:model-value="aiStore.updateTranslationConfig({ autoTranslate: $event })" /></div>
        <label>目标语言</label>
        <el-select :model-value="aiStore.translationConfig.targetLanguage" @update:model-value="aiStore.updateTranslationConfig({ targetLanguage: $event })" class="wide">
          <el-option v-for="language in ['zh-CN','en','ja','ko','de','fr']" :key="language" :value="language" :label="language" />
        </el-select>
        <div class="setting-row"><span>单独选择翻译模型</span><el-switch :model-value="aiStore.translationConfig.useSeparateModel" @update:model-value="aiStore.updateTranslationConfig({ useSeparateModel: $event })" /></div>
        <template v-if="aiStore.translationConfig.useSeparateModel">
          <el-select :model-value="aiStore.translationConfig.providerType" @update:model-value="aiStore.updateTranslationConfig({ providerType: $event })" class="wide">
            <el-option v-for="profile in aiStore.profiles" :key="profile.type" :value="profile.type" :label="profile.name" />
          </el-select>
          <el-select :model-value="aiStore.translationConfig.model" @update:model-value="aiStore.updateTranslationConfig({ model: $event })" filterable allow-create class="wide">
            <el-option v-for="model in aiStore.translationModels" :key="model" :value="model" :label="model" />
          </el-select>
        </template>
      </el-tab-pane>
      <el-tab-pane label="调用记录" name="logs">
        <el-button @click="aiStore.clearExtractLogs" type="danger" text>清空记录</el-button>
        <p v-if="!aiStore.extractLogs.length">暂无调用记录</p>
        <div v-for="log in aiStore.extractLogs" :key="log.id" class="log-row">
          <span>{{ log.timestamp }} · {{ log.provider }} / {{ log.model }} · {{ log.status === 'success' ? '成功' : '失败' }}</span>
          <p v-if="log.errorMessage">{{ log.errorMessage }}</p>
          <el-button text @click="selectedResponse = log.rawResponse">查看原始响应</el-button>
        </div>
        <el-dialog :model-value="!!selectedResponse" @update:model-value="selectedResponse = ''" title="AI 原始响应" append-to-body><pre class="response">{{ selectedResponse }}</pre></el-dialog>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>
<style scoped>
.setting-row { display:flex; gap:14px; align-items:center; margin:20px 0; }
.wide { width:100%; margin:8px 0 16px; }
.log-row { border-bottom:1px solid #ddd; padding:12px 0; font-size:12px; }
.response { white-space:pre-wrap; max-height:55vh; overflow:auto; }
</style>
