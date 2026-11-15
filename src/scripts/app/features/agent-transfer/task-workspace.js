/* A single durable ledger owned by the Electron host; shared with the same-origin editor. */
(function (root) {
  'use strict';
  if (root.parent !== root && root.parent.AgentTaskWorkspace) { root.AgentTaskWorkspace = root.parent.AgentTaskWorkspace; return; }
  var raw = '[]', loaded = false, pending = Promise.resolve(), failure = null, routes = {};
  async function validateTask(task) {
    if (!task || task.kind !== 'patentlens-agent-task' || task.schemaVersion !== 1 || typeof task.taskId !== 'string' || typeof task.label !== 'string' || typeof task.instructions !== 'string' || !task.input || typeof task.input !== 'object' || await root.AgentHandoffProtocol.hash(task.input) !== task.sourceHash) throw new Error('任务材料校验失败，请保留任务文件并从备份恢复');
    for (var revision of task.revisions || []) if (!revision || !revision.payload || typeof revision.payload !== 'object' || Array.isArray(revision.payload) || await root.AgentHandoffProtocol.hash(revision.payload) !== revision.hash || !Array.isArray(revision.acceptance)) throw new Error('结果版本校验失败');
  }
  var store = root.AgentHandoffProtocol.createStore({
    getItem: function () { if (!loaded) throw new Error('任务台账尚未加载'); return raw; },
    setItem: function (_, value) {
      if (failure) throw failure;
      raw = value;
      pending = pending.then(async function () {
        if (!root.electronAPI || !root.electronAPI.agentHandoffSave) throw new Error('当前环境不支持持久任务台账');
        await root.electronAPI.agentHandoffSave(value);
      }).catch(function (error) { failure = error; throw error; });
      pending.catch(function () {});
    }
  }, 'ledger', 32 * 1024 * 1024);
  var ready = (async function () {
    if (!root.electronAPI || !root.electronAPI.agentHandoffLoad) throw new Error('请在 Electron 桌面版使用任务台账');
    raw = await root.electronAPI.agentHandoffLoad();
    if (!Array.isArray(JSON.parse(raw))) throw new Error('任务台账格式异常');
    for (var task of JSON.parse(raw)) await validateTask(task);
    loaded = true;
    var legacy = root.localStorage.getItem('patentlens-agent-comparison-tasks');
    if (legacy) { await migrate(JSON.parse(legacy)); root.localStorage.removeItem('patentlens-agent-comparison-tasks'); }
  })();
  ready.catch(function (error) { failure = error; });
  async function flush() { await ready; await pending; if (failure) throw failure; }
  async function migrate(tasks) {
    var rows = store.list(), changed = false;
    for (var task of tasks) { await validateTask(task); if (!rows.some(function (row) { return row.taskId === task.taskId; })) { rows.unshift(task); changed = true; } }
    if (changed) { store.replaceAll(rows); await pending; }
  }
  async function importBundle(text) {
    await ready;
    if (text.length > 32 * 1024 * 1024) throw new Error('任务包过大');
    var bundle = JSON.parse(text);
    if (bundle.kind !== 'patentlens-agent-workspace' || bundle.schemaVersion !== 1 || !Array.isArray(bundle.tasks)) throw new Error('不是有效的任务迁移包');
    var rows = store.list(), added = 0;
    for (var task of bundle.tasks) {
      await validateTask(task);
      var existing = rows.find(function (row) { return row.taskId === task.taskId; });
      if (existing) { if (existing.sourceHash !== task.sourceHash || existing.taskType !== task.taskType) throw new Error('同编号任务材料冲突');
        for (var revision of task.revisions || []) {
          if (!(existing.revisions || []).some(function (r) { return r.hash === revision.hash; })) { existing.revisions = (existing.revisions || []).concat(revision); added++; }
        }
        existing.importedHashes = Array.from(new Set((existing.importedHashes || []).concat((existing.revisions || []).map(function (r) { return r.hash; }))));
        if ((existing.revisions || []).length && existing.status === 'pending') existing.status = 'returned';
        continue;
      }
      // Device-local destinations must be rebound explicitly before accepting a portable result.
      task.migrated = true; rows.unshift(task); added++;
    }
    if (rows.length > 20 || JSON.stringify(rows).length > 32 * 1024 * 1024) throw new Error('任务空间不足，请先导出并清理旧任务');
    // Validate the complete bundle before mutating the ledger.
    store.replaceAll(rows);
    await flush(); return added;
  }
  function open() {
    void ready.then(function () {
      var instructions = '', material = '';
      root.AgentHandoffPanel.open({ title: 'Agent 任务', description: '准备材料 → 复制给外部 Agent → 带回回答。在这里继续已有任务，或填写材料新建分析任务。',
        store: store, reviewFirst: true,
        configure: function (dialog) {
          var config = document.createElement('div'); config.className = 'agent-report-config';
          var goal = document.createElement('textarea'), source = document.createElement('textarea'); goal.placeholder = '分析目标'; source.placeholder = '报告原文材料'; goal.setAttribute('aria-label', '报告分析目标'); source.setAttribute('aria-label', '报告原文材料');
          var goalLabel = document.createElement('label'); goalLabel.textContent = '你希望 Agent 分析什么？'; goalLabel.className = 'agent-task-step';
          var sourceLabel = document.createElement('label'); sourceLabel.textContent = '分析使用的原文材料'; sourceLabel.className = 'agent-task-step';
          goal.id = 'agent-report-goal'; goalLabel.htmlFor = goal.id; source.id = 'agent-report-source'; sourceLabel.htmlFor = source.id;
          goal.oninput = function () { instructions = goal.value; }; source.oninput = function () { material = source.value; }; config.append(goalLabel, goal, sourceLabel, source); dialog.querySelector('[data-step="prepare"]').prepend(config);
        },
        createTask: async function () {
          if (!instructions.trim() || !material.trim()) throw new Error('请填写分析目标和原文材料');
          return root.AgentHandoffProtocol.create({ taskType: 'report', label: instructions.slice(0, 60), target: {}, input: { sources: root.AgentSourceReferences.textSources('report:material', material, { documentName: '报告材料' }) }, instructions: instructions + '\n返回 {"report":"完整报告","evidence":[{"sourceId":"原文编号","quote":"逐字引文","explanation":"对应结论"}]}。找不到依据时明确待核查。' });
        },
        apply: function (task, payload, hash) {
          if (!routes[task.taskType]) throw new Error('请先打开此任务所属工作台，再导入或采用结果');
          return routes[task.taskType].apply(task, payload, hash);
        },
        accept: function (task, payload, hash) {
          if (!routes[task.taskType] || !routes[task.taskType].accept) throw new Error('请到原工作台查看或恢复生成版本');
          return routes[task.taskType].accept(task, payload, hash);
        },
        merge: function (task, payloads) {
          if (!routes[task.taskType] || !routes[task.taskType].merge) throw new Error('请先打开对应工作台');
          return routes[task.taskType].merge(task, payloads);
        }
      });
    }).catch(function (error) { root.alert(error.message); });
  }
  root.AgentTaskWorkspace = { ready: ready, getStore: function () { return store; }, flush: flush, migrate: migrate,
    register: function (type, route) { routes[type] = route; }, open: open, importBundle: importBundle,
    exportBundle: function () { return JSON.stringify({ kind: 'patentlens-agent-workspace', schemaVersion: 1, exportedAt: Date.now(), tasks: store.list() }, null, 2); }
  };
  function init() {
    if (document.getElementById('agent-workspace-entry')) return;
    var button = document.createElement('button'); button.type = 'button'; button.textContent = 'Agent 任务'; button.title = '继续 Agent 任务、导入回答、查看结果';
    button.id = 'agent-workspace-entry';
    button.style.cssText = 'position:fixed;left:18px;bottom:24px;z-index:9500;padding:10px 16px;border:1px solid #86aa9d;border-radius:12px;background:var(--bg-primary,#fff);color:var(--text-primary,#234);cursor:pointer;box-shadow:0 3px 14px #0002';
    button.addEventListener('click', open); document.body.appendChild(button);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(globalThis);
