/*!
 * PatentLens Agent - Core Agent Loop
 * 核心ReAct编排器：负责LLM→工具调用→结果回传→循环直到完成
 */
var AgentCore = (function () {
  var BUS = AgentEventBus;
  var EVT = BUS.EVENTS;

  var MAX_ITERATIONS = 40;
  var LLM_TIMEOUT_MS = 120000; // 单次LLM调用超时：2分钟
  var currentAbortController = null;
  var isRunning = false;
  var memory = [];
  var systemPrompt = "";
  var sessionContext = {};

  var DEFAULT_SYSTEM_PROMPT = [
    "你是PatentLens智能专利助手，运行在Electron桌面应用中。",
    "你可以帮助用户查询专利信息、查看同族、分析权利要求、审查历程，以及完成多专利权利要求比对分析报告。",
    "",
    "## 工作方式",
    "你是ReAct Agent，通过「思考→调用工具→观察结果→继续思考」的循环来完成任务。",
    "任务拆解由你自主完成——根据用户需求自行规划步骤，使用update_todos记录你的计划。",
    "",
    "## ⚠️ 工具使用的根本原则（极其重要，必须严格遵守）",
    "",
    "### 什么时候用 fetch_patent（审查档案查询）？",
    "**只有**当用户明确询问以下内容时，才使用 fetch_patent：",
    "- 审查历程、审查时间线、经历了几次OA/答复",
    "- 审查意见通知书、OA答复、审查文档列表",
    "- 审查状态、法律状态变更（通过审查档案查看）",
    "- 审查文档内容阅读、AI审查意见梳理",
    "简言之：跟「审查流程、审查意见答复、审查文档」有关的才用 fetch_patent。",
    "",
    "### 什么时候用 fetch_patent_fulltext（专利原文查询）？",
    "**默认首选**——除上述审查流程相关问题外，**一切获取专利基本信息的场景都用 fetch_patent_fulltext**：",
    "- 查看专利标题、摘要、申请人、发明人、申请日/公开日/优先权日",
    "- 获取权利要求书（get_patent_claims）、说明书内容",
    "- 分析技术方案、保护范围、发明内容",
    "- **获取同族专利列表**（通过 fetch_patent_fulltext 返回的 familyMembers 字段，或用 get_patent_family 工具）",
    "- 查看引证专利、被引专利",
    "- 权利要求比对（prepare_claim_comparison / quick_compare_claims 内部会使用）",
    "- 查看法律事件、专利状态基本信息",
    "简言之：获取专利信息、同族信息、权利要求、技术方案，一律用 fetch_patent_fulltext。",
    "",
    "### 常见错误（禁止出现）",
    "- ❌ 用户说「帮我查XX专利的同族」，你去调用 fetch_patent → get_family_summary → 遇到500错误",
    "- ✅ 正确做法：直接调用 fetch_patent_fulltext，返回结果中就包含 familyMembers 同族列表",
    "- ❌ 用户说「对比XX专利和YY专利的权利要求」，你先去fetch_patent审查档案",
    "- ✅ 正确做法：直接使用 quick_compare_claims 或 prepare_claim_comparison（内部走专利原文）",
    "- ❌ fetch_patent失败（如500错误/CN/JP/KR等局不支持）后反复重试",
    "- ✅ 正确做法：如果用户要的是同族/权利要求/技术方案，直接切换到 fetch_patent_fulltext",
    "",
    "## 可用工具",
    "",
    "### 专利原文查询（Google Patents，首选工具）",
    "1. fetch_patent_fulltext(patent_number) — **默认首选工具**。查询专利原文，返回：标题、摘要、申请人、发明人、申请日/公开日/优先权日、同族专利列表(familyMembers)、权利要求数量、引证/被引信息、法律事件、以及Espacenet/GP链接。**同族信息直接在返回结果的familyMembers中，不需要另外调用get_family_summary**",
    "2. get_patent_claims() — 获取已查询专利原文的权利要求书全文（含独立/从属标记），需先fetch_patent_fulltext",
    "3. get_patent_abstract() — 获取已查询专利原文的摘要，需先fetch_patent_fulltext",
    "4. get_patent_description(max_length?) — 获取已查询专利原文的说明书全文（发明内容、具体实施方式等），可指定max_length限制返回长度，需先fetch_patent_fulltext",
    "5. get_patent_family() — 获取已查询专利原文的同族专利列表（从GP数据），需先fetch_patent_fulltext。如果fetch_patent_fulltext已返回familyMembers，可直接使用，不必再调此工具",
    "",
    "### 专利审查档案查询（仅审查流程相关）",
    "6. fetch_patent(patent_number) — 查询专利审查档案（Global Dossier）。**仅用于审查历程/OA答复/审查文档场景**。返回专利号、标题、申请人、专利局、文档数等",
    "7. get_patent_basic_info() — 获取审查档案基本信息（需先fetch_patent）",
    "8. get_timeline() — 获取审查时间线事件（需先fetch_patent）",
    "9. get_documents_summary() — 获取审查文档列表摘要（需先fetch_patent）",
    "10. get_family_summary() — 获取审查档案中的同族摘要（需先fetch_patent）。注意：此工具可能返回500错误，此时应切换使用fetch_patent_fulltext获取同族",
    "11. run_ai_analysis(auto_select?) — 触发AI审查意见梳理。**不要让用户去界面上手动勾选**。先用get_documents_summary获取文档列表，在对话中向用户展示文档选项，用户选择后调用此工具传auto_select=true并通过参数指定选择，在后台自动执行。",
    "12. get_analysis_result() — 获取AI分析结果。inProgress=true时不要轮询，直接finish告知用户稍后查看",
    "13. open_document_reader(document_index) — 在应用内打开审查文档阅读器",
    "14. fetch_dossier_and_analyze(patent_number, auto_select?) — 一站式查询审查档案+触发AI分析。默认auto_select=false（需要先问用户选择哪些文档），设为true则自动全选后台执行。",
    "",
    "### 多专利权利要求比对（核心功能）",
    "当用户说「对比权利要求」「比对独权」「权利要求差异分析」「生成比对报告」「同族权利要求比对」等需求时：",
    "",
    "**标准流程（需要用户选择时）：**",
    "15. prepare_claim_comparison(patent_numbers, anchor_patent?) — 批量查询多个专利并提取独立权利要求，返回各专利的独权列表（含权项号和内容预览）",
    "    → 收到结果后，**在对话中清晰列出各专利的独立权利要求选项**，用ask_user询问用户要比对哪些权项、以哪个为锚点",
    "    → 理解用户的自然语言回答（如「只选权1」「用美国专利做锚点」「全部都要」等）",
    "16. execute_claim_comparison(selected_claims?, anchor_claim?, auto_export?) — 根据用户选择传入参数，在后台自动设置锚点、添加权项、执行AI比对、生成HTML报告并自动触发下载。**不需要用户在界面上手动操作任何东西**",
    "",
    "**快捷流程（用户说「直接比对」「快速对比」等无需选择时）：**",
    "17. quick_compare_claims(patent_numbers, anchor_patent?) — 一站式自动完成：查询→自动选全部独权→以第一个专利权1为锚点→AI比对→导出HTML报告。不需要中间确认步骤",
    "",
    "### 通用工具",
    "18. switch_to_tab(tab) — 切换界面标签页/功能模块：overview(概览)、family(同族)、timeline(时间轴)、doclist(审查文档列表)、kanban(审查分栏看板)、ai-analysis(AI分析)、comparison(智能比对)",
    "19. open_url(url, title?) — 在应用内打开外部链接（如Espacenet、Google Patents）。当GP查询失败时，可用此工具打开Espacenet链接让用户手动确认",
    "20. update_todos(todos) — 更新任务进度列表",
    "21. think(thought) — 记录思考过程",
    "22. ask_user(question, options) — 信息不足或需要用户选择时，通过对话提问。**所有需要用户选择的场景都用此工具，绝不要让用户去界面上手动点击操作**",
    "23. finish(summary) — 任务完成时调用，给出最终总结",
    "",
    "## ⚠️ 交互原则（极其重要，必须严格遵守）",
    "",
    "### 禁止让用户操作UI界面！",
    "**你是一个对话式Agent，所有交互都在聊天窗口中完成。绝对不要出现以下行为：**",
    "- ❌ 「请在界面上选择锚点」「请点击XX按钮」「请在面板中勾选文档」",
    "- ❌ 弹出面板后就finish让用户自己操作",
    "- ❌ 依赖UI组件的状态来判断下一步",
    "",
    "### 正确的选择交互流程：",
    "1. 工具返回可选项列表（如各专利独权、审查文档列表）",
    "2. 你在对话中整理这些选项，用清晰的列表/表格展示给用户",
    "3. 用ask_user提问（可以提供选项，也可以开放式提问）",
    "4. 理解用户的自然语言回答（「全部」「只选权1」「用美国那个做基准」「除了XX都要」等）",
    "5. 将用户选择转化为工具参数，调用工具在后台自动执行",
    "",
    "### 什么时候可以不需要询问直接执行？",
    "- 用户明确说「直接比对」「快速对比」「全部选上」「全选」「不用选了直接开始」等",
    "- 选项非常明确且是标准场景（如同族独权比对默认选全部独权、以中国/第一个专利为锚点）",
    "- 用户已经在之前的对话中明确表达过选择偏好",
    "",
    "## 查询失败处理策略",
    "1. 如果 fetch_patent_fulltext 返回 ok:false（GP查不到该专利），不要直接放弃。向用户说明：",
    "   - 告知该专利号在Google Patents中未找到",
    "   - 提供Espacenet链接，可调用 open_url 工具在应用内打开Espacenet让用户手动确认",
    "   - 询问用户是否能提供正确专利号，或是否愿意先在Espacenet中查找确认后再继续",
    "   - 不要因为一次查询失败就终止整个任务",
    "2. 如果 fetch_patent 失败（如500错误/不支持的专利局），而用户需求并非审查流程相关：",
    "   - 直接切换到 fetch_patent_fulltext 获取信息，不要反复重试fetch_patent",
    "3. 如果 get_family_summary 失败（500错误）：",
    "   - 同族信息已经可以从 fetch_patent_fulltext 的 familyMembers 获取，无需再用审查档案的get_family_summary",
    "",
    "## 其他决策原则",
    "1. 用户询问「经历了几次审查/答复」「审查历程」「审查状态」等问题时，调用 fetch_patent → get_timeline → get_documents_summary 回答，不自动触发 run_ai_analysis",
    "2. 只有用户明确说「AI梳理」「深度分析」「梳理审查意见」「分析审查意见」时才调用 run_ai_analysis",
    "3. 调用 run_ai_analysis 前，先用 get_documents_summary 获取文档列表展示给用户，询问要分析哪些文档；如果用户说「全部」「所有文档」则传auto_select=true后台执行。绝不要让用户去界面上勾选！",
    "4. 不要轮询 get_analysis_result 超过2次。inProgress=true时直接finish告知用户稍后在AI分析标签页查看结果",
    "5. 同族专利列表优先使用 fetch_patent_fulltext 返回的 familyMembers，不需要额外调用get_family_summary",
    "6. 权利要求比对场景：如果用户没有明确说「直接比对」，prepare_claim_comparison返回结果后应在对话中展示各专利独权列表，询问用户选择哪些权项和锚点，然后调用execute_claim_comparison后台执行。不要让用户去界面上操作！",
    "",
    "## 同族权利要求比对工作流示例",
    "当用户说「查询XX专利的同族并比对权利要求」时：",
    "1. think：分析需求，需要先查专利原文获取同族列表，再逐个查询同族专利的权利要求",
    "2. update_todos：制定计划",
    "3. 调用 fetch_patent_fulltext(XX) 获取专利基本信息和同族列表(familyMembers)",
    "4. 从familyMembers中筛选主要同族专利（通常选已授权的US/EP/JP/CN等）",
    "5. 判断用户意图：",
    "   - 如果用户说「直接比对」「快速对比」「帮我对比一下」等 → 用 quick_compare_claims 一站式完成",
    "   - 否则 → 用 prepare_claim_comparison 查询，然后在对话中展示各专利独权列表，用ask_user询问选择",
    "6. 用户做出选择后（或直接执行时），调用对应工具在后台完成比对并自动下载报告",
    "7. 向用户展示比对结果摘要，finish",
    "注意：**不要**让用户去界面上点按钮选锚点，**不要**先调用fetch_patent审查档案，**不要**调用get_family_summary（会500错误），**直接**从fetch_patent_fulltext获取同族信息！",
    "",
    "## 工作原则",
    "1. 收到用户消息后，先用think分析需求，再用update_todos制定计划（根据实际需求拆解，不用固定模板）",
    "2. 用户提供专利号时，直接调用对应工具，不需要反复确认（除非信息明显不足）",
    "3. 不要凭空猜测数据，必须通过工具获取真实信息",
    "4. 工具返回结果后，整理成清晰的自然语言回答用户",
    "5. 每完成一个步骤，更新对应todo的状态",
    "6. 所有步骤完成后，调用finish给出总结",
    "",
    "## 回答风格",
    "- 用中文回答",
    "- 专业但易懂，结构化呈现（表格/列表）",
    "- 不要重复工具返回的原始JSON，提炼成用户能看懂的内容",
    "- 回答审查历程时，按时间顺序列出关键审查事件（OA、答复、修改等）",
    "",
    "## 连续对话",
    "你支持多轮连续对话，可以记住之前的对话上下文。如果用户在后续消息中提到「这个专利」「上面的」等指代词，应结合之前的对话历史理解。",
    "如果用户切换到新专利或新任务，会明确提供新的专利号或说明需求。",
  ].join("\n");

  function setSystemPrompt(prompt) {
    systemPrompt = prompt || DEFAULT_SYSTEM_PROMPT;
  }

  function reset() {
    memory = [];
    sessionContext = {};
    isRunning = false;
    if (currentAbortController) {
      try { currentAbortController.abort(); } catch (e) {}
      currentAbortController = null;
    }
  }

  function abort() {
    if (currentAbortController) {
      currentAbortController.abort();
    }
    isRunning = false;
    BUS.emit(EVT.SESSION_ABORTED, {});
  }

  function isActive() {
    return isRunning;
  }

  function getMemory() {
    return memory.slice();
  }

  function getContext() {
    return Object.assign({}, sessionContext);
  }

  function updateContext(patch) {
    Object.assign(sessionContext, patch || {});
  }

  async function run(userMessage, options) {
    if (isRunning) {
      throw new Error("Agent is already running");
    }

    isRunning = true;
    currentAbortController = new AbortController();
    var signal = currentAbortController.signal;
    // Multi-turn conversation: append to existing memory instead of resetting.
    // Reset only happens via explicit reset() call (user clicks clear button).
    if (!memory || memory.length === 0) {
      memory = [{ role: "user", content: userMessage }];
    } else {
      memory.push({ role: "user", content: userMessage });
    }
    // Preserve sessionContext across turns, only update current message/time
    if (!sessionContext) sessionContext = {};
    sessionContext.startTime = Date.now();
    sessionContext.userMessage = userMessage;

    // 不再使用固定todo模板，让AI自己规划
    BUS.emit(EVT.SESSION_STARTED, { message: userMessage });

    var tools = AgentTools.getSchemas();
    console.log("[AgentCore] tools registered:", tools.length, "tool names:", tools.map(function(t){return t.function.name;}));

    try {
      var iteration = 0;
      var finalAnswer = "";
      var lastToolName = "";
      var sameToolRepeatCount = 0;

      while (iteration < MAX_ITERATIONS) {
        iteration++;
        if (signal.aborted) break;

        console.log("[AgentCore] iteration", iteration);

        var assistantMsg = { role: "assistant", content: "" };
        var reasoningBuf = "";
        var contentBuf = "";
        var gotToolCall = false;

        BUS.emit(EVT.ASSISTANT_START, {});
        var thinkStarted = false;

        // 超时保护
        var timeoutId = setTimeout(function() {
          if (currentAbortController) {
            console.warn("[AgentCore] LLM timeout, aborting...");
            try { currentAbortController.abort(); } catch(e) {}
          }
        }, LLM_TIMEOUT_MS);

        var streamGen;
        try {
          streamGen = AgentLLM.streamWithTools(
            systemPrompt,
            memory,
            tools,
            options || {},
            signal
          );
        } catch (llmErr) {
          clearTimeout(timeoutId);
          throw llmErr;
        }

        var streamResult;
        try {
          streamResult = await streamGen.next();
        } catch (streamErr) {
          clearTimeout(timeoutId);
          if (streamErr.name === "AbortError") {
            throw new Error("AI响应超时（" + (LLM_TIMEOUT_MS/1000) + "秒），请检查网络或API配置");
          }
          throw streamErr;
        }

        var doneChunk = null;
        while (!streamResult.done) {
          var chunk = streamResult.value;

          if (chunk.type === "reasoning") {
            if (!thinkStarted) {
              BUS.emit(EVT.THINK_START, {});
              thinkStarted = true;
            }
            reasoningBuf += chunk.content;
            BUS.emit(EVT.THINK_CHUNK, { content: chunk.content });
          } else if (chunk.type === "content") {
            contentBuf += chunk.content;
            BUS.emit(EVT.ASSISTANT_CHUNK, { content: chunk.content });
          } else if (chunk.type === "tool_call_delta") {
            gotToolCall = true;
          } else if (chunk.type === "done") {
            // 捕获done事件中的最终结果（content和toolCalls）
            doneChunk = chunk;
          }

          try {
            streamResult = await streamGen.next();
          } catch (streamErr2) {
            clearTimeout(timeoutId);
            if (streamErr2.name === "AbortError") {
              throw new Error("AI流式响应被中断");
            }
            throw streamErr2;
          }
        }

        clearTimeout(timeoutId);

        // 优先使用done chunk中的结果，其次使用generator返回值，最后回退到累积buffer
        var finalChunk = doneChunk || streamResult.value || {};

        if (thinkStarted) {
          BUS.emit(EVT.THINK_END, { content: reasoningBuf });
        }

        var finalContent = finalChunk.content || contentBuf;
        var finalToolCalls = finalChunk.toolCalls || [];

        console.log("[AgentCore] iteration", iteration, "done. contentLen:", (finalContent||"").length, "toolCalls:", finalToolCalls ? finalToolCalls.length : 0, "gotToolCall:", gotToolCall, "doneChunk:", !!doneChunk);

        // 如果AI没有返回内容也没有工具调用，可能是API不支持tools参数
        if (!finalContent && (!finalToolCalls || finalToolCalls.length === 0)) {
          console.warn("[AgentCore] Empty response, trying fallback without tools parameter...");
          BUS.emit(EVT.ASSISTANT_END, { content: "" });

          // 降级：不带tools参数重试，将工具描述放入system prompt
          var fallbackPrompt = systemPrompt + "\n\n" + _buildManualToolsPrompt(tools);
          var fallbackContent = "";
          var fallbackReasoning = "";
          BUS.emit(EVT.ASSISTANT_START, {});
          thinkStarted = false;

          try {
            var fbGen = AgentLLM.streamWithTools(fallbackPrompt, memory, [], options || {}, signal);
            var fbResult = await fbGen.next();
            while (!fbResult.done) {
              var fbChunk = fbResult.value;
              if (fbChunk.type === "reasoning") {
                if (!thinkStarted) { BUS.emit(EVT.THINK_START, {}); thinkStarted = true; }
                fallbackReasoning += fbChunk.content;
                BUS.emit(EVT.THINK_CHUNK, { content: fbChunk.content });
              } else if (fbChunk.type === "content") {
                fallbackContent += fbChunk.content;
                BUS.emit(EVT.ASSISTANT_CHUNK, { content: fbChunk.content });
              }
              fbResult = await fbGen.next();
            }
            if (thinkStarted) BUS.emit(EVT.THINK_END, { content: fallbackReasoning });
            BUS.emit(EVT.ASSISTANT_END, { content: fallbackContent });
          } catch (fbErr) {
            console.error("[AgentCore] fallback also failed:", fbErr);
            BUS.emit(EVT.ASSISTANT_END, { content: "" });
          }

          if (fallbackContent) {
            // 尝试从回复中解析手动工具调用
            var parsedCalls = _parseManualToolCalls(fallbackContent);
            if (parsedCalls && parsedCalls.length > 0) {
              console.log("[AgentCore] fallback parsed tool calls:", parsedCalls.length);
              finalToolCalls = parsedCalls;
              finalContent = "";
              // 提取工具调用之外的文本
              var textBefore = _extractTextBeforeToolCall(fallbackContent);
              if (textBefore) {
                finalContent = textBefore;
                assistantMsg.content = textBefore;
              }
            } else {
              // 没有工具调用，直接作为最终回答
              finalAnswer = fallbackContent;
              assistantMsg.content = fallbackContent;
              memory.push(assistantMsg);
              break;
            }
          } else {
            finalAnswer = "（AI未返回有效内容。可能原因：1.API Key未配置 2.模型不支持工具调用 3.网络问题。请检查AI设置）";
            break;
          }
        }

        // 如果没有工具调用但有内容
        if ((!gotToolCall && finalToolCalls.length === 0) && finalContent) {
          BUS.emit(EVT.ASSISTANT_END, { content: finalContent });
          assistantMsg.content = finalContent;
          memory.push(assistantMsg);

          // nudge机制：前2次迭代如果AI只回复文本但不调用工具，
          // 追加一条system消息推动AI实际使用工具
          if (iteration <= 2 && _shouldNudge(userMessage, finalContent)) {
            console.log("[AgentCore] nudging AI to use tools (iteration " + iteration + ")");
            memory.push({
              role: "user",
              content: "请直接使用工具来完成任务，不要只用文字描述你的计划。例如，如果要查询专利，请直接调用 fetch_patent 工具。",
            });
            continue;
          }

          finalAnswer = finalContent;
          break;
        }

        if (finalContent) {
          assistantMsg.content = finalContent;
          BUS.emit(EVT.ASSISTANT_END, { content: finalContent });
        } else {
          BUS.emit(EVT.ASSISTANT_END, { content: "" });
        }

        if (finalToolCalls.length === 0) {
          finalAnswer = finalContent || "";
          break;
        }

        // 保存assistant消息（含tool_calls）到memory
        assistantMsg.tool_calls = finalToolCalls.map(function (tc) {
          return {
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          };
        });
        memory.push(assistantMsg);

        // 执行工具调用
        for (var ti = 0; ti < finalToolCalls.length; ti++) {
          var tc = finalToolCalls[ti];
          console.log("[AgentCore] executing tool:", tc.name, "args:", JSON.stringify(tc.arguments).substring(0, 200));
          BUS.emit(EVT.TOOL_CALL_START, { name: tc.name, arguments: tc.arguments, id: tc.id });

          var toolResult;
          try {
            toolResult = await AgentTools.execute(tc.name, tc.arguments, sessionContext);
          } catch (toolErr) {
            console.error("[AgentCore] tool error:", tc.name, toolErr);
            toolResult = { error: toolErr.message || String(toolErr) };
          }

          console.log("[AgentCore] tool result:", tc.name, JSON.stringify(toolResult).substring(0, 200));
          BUS.emit(EVT.TOOL_CALL_END, { name: tc.name, result: toolResult, id: tc.id });

          // 停滞检测：如果同一个工具连续被调用超过3次，注入一条提醒让AI停止轮询
          if (tc.name === lastToolName) {
            sameToolRepeatCount++;
          } else {
            lastToolName = tc.name;
            sameToolRepeatCount = 1;
          }
          if (sameToolRepeatCount >= 3) {
            console.warn("[AgentCore] stall detected: tool '" + tc.name + "' called " + sameToolRepeatCount + " times in a row");
            memory.push({
              role: "user",
              content: "你已经连续调用 " + tc.name + " 工具 " + sameToolRepeatCount + " 次了。请停止轮询，根据已有信息直接调用finish给出总结。如果分析仍在进行中，告知用户稍后查看结果即可。",
            });
          }

          var resultStr = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2);
          memory.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.name,
            content: resultStr,
          });
        }

        // 如果调用了finish工具，结束循环
        var hasFinishTool = finalToolCalls.some(function (tc) { return tc.name === "finish"; });
        if (hasFinishTool) {
          // 从finish工具的参数中提取summary作为最终回答
          for (var fi = 0; fi < finalToolCalls.length; fi++) {
            if (finalToolCalls[fi].name === "finish" && finalToolCalls[fi].arguments && finalToolCalls[fi].arguments.summary) {
              finalAnswer = finalToolCalls[fi].arguments.summary;
            }
          }
          break;
        }

        // 如果工具返回了 waitForUser=true，说明需要用户操作，自动结束并等待
        var hasWaitForUser = finalToolCalls.some(function (tc) {
          return tc.name === "run_ai_analysis" || tc.name === "fetch_dossier_and_analyze";
        });
        if (hasWaitForUser) {
          // 检查工具结果是否包含 waitForUser
          for (var wi = memory.length - 1; wi >= 0 && wi >= memory.length - finalToolCalls.length; wi--) {
            var memEntry = memory[wi];
            if (memEntry && memEntry.role === "tool" && memEntry.content) {
              try {
                var parsedResult = JSON.parse(memEntry.content);
                if (parsedResult.waitForUser) {
                  finalAnswer = parsedResult.tip || "已弹出文档选择面板，请在界面上选择需要分析的文档并确认。";
                  var stubAssistantMsg = { role: "assistant", content: finalAnswer };
                  memory.push(stubAssistantMsg);
                  var shouldBreak = true;
                  break;
                }
              } catch (e) {}
            }
          }
          if (typeof shouldBreak !== "undefined" && shouldBreak) break;
        }
      }

      if (iteration >= MAX_ITERATIONS) {
        console.warn("[AgentCore] reached max iterations", MAX_ITERATIONS);
        if (!finalAnswer) {
          finalAnswer = "（已达到最大迭代次数限制，任务可能未完全完成）";
        }
      }

      BUS.emit(EVT.SESSION_FINISHED, { answer: finalAnswer, context: sessionContext });
      isRunning = false;
      return { answer: finalAnswer, context: sessionContext };
    } catch (err) {
      isRunning = false;
      console.error("[AgentCore] error:", err);
      BUS.emit(EVT.SESSION_ERROR, { error: err.message || String(err) });
      throw err;
    } finally {
      currentAbortController = null;
    }
  }

  function updateTodos(todos) {
    sessionContext.todos = todos;
    BUS.emit(EVT.TODOS_UPDATED, { todos: todos });
  }

  // === nudge机制：判断是否需要推动AI使用工具 ===

  function _shouldNudge(userMessage, aiResponse) {
    if (!userMessage || !aiResponse) return false;
    var um = userMessage.toLowerCase();
    var ar = aiResponse.toLowerCase();
    // 用户消息包含专利号模式（如EP4008488B1, US12345678, CN10...）
    var hasPatentNum = /[a-z]{2}\d+[a-z]?/i.test(userMessage);
    // AI回复中包含"查询"、"帮你"、"我来"等意图描述但没有实际调用工具
    var hasIntent = /(查询|帮你|我来|开始|首先|计划|调用|执行)/.test(aiResponse);
    // AI回复较短（不是完整答案）
    var isShort = aiResponse.length < 200;
    return (hasPatentNum || /专利|patent/i.test(um)) && hasIntent && isShort;
  }

  // === 降级模式辅助函数 ===

  function _buildManualToolsPrompt(tools) {
    var lines = [
      "",
      "## 可用工具（手动模式）",
      "由于API不支持原生工具调用，请用以下JSON格式输出工具调用：",
      "```json",
      '{"tool": "工具名", "arguments": {...参数...}}',
      "```",
      "可以先用自然语言思考，然后在最后一行输出工具调用JSON。",
      "如果不需要调用工具，直接用自然语言回答即可。",
      "",
      "### 工具列表",
    ];
    for (var i = 0; i < tools.length; i++) {
      var t = tools[i].function || tools[i];
      lines.push("- " + t.name + ": " + (t.description || ""));
      if (t.parameters && t.parameters.properties) {
        var props = t.parameters.properties;
        for (var pk in props) {
          lines.push("  - " + pk + ": " + (props[pk].description || props[pk].type || ""));
        }
      }
    }
    return lines.join("\n");
  }

  function _parseManualToolCalls(text) {
    if (!text) return null;
    // 尝试匹配 ```json ... ``` 格式
    var jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      try {
        var parsed = JSON.parse(jsonBlockMatch[1].trim());
        if (parsed.tool) {
          return [{
            id: "manual_" + Date.now(),
            name: parsed.tool,
            arguments: parsed.arguments || {},
          }];
        }
      } catch (e) { /* ignore */ }
    }
    // 尝试匹配裸JSON {"tool": "...", ...}
    var jsonMatch = text.match(/\{[^{}]*"tool"\s*:\s*"[^"]+"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        var parsed2 = JSON.parse(jsonMatch[0]);
        if (parsed2.tool) {
          return [{
            id: "manual_" + Date.now(),
            name: parsed2.tool,
            arguments: parsed2.arguments || {},
          }];
        }
      } catch (e2) { /* ignore */ }
    }
    return null;
  }

  function _extractTextBeforeToolCall(text) {
    if (!text) return "";
    var idx = text.indexOf("```json");
    if (idx === -1) {
      var m = text.match(/\{[^{}]*"tool"\s*:/);
      if (m) idx = m.index;
    }
    if (idx > 0) return text.substring(0, idx).trim();
    return "";
  }

  return {
    run: run,
    abort: abort,
    reset: reset,
    isActive: isActive,
    getMemory: getMemory,
    getContext: getContext,
    updateContext: updateContext,
    setSystemPrompt: setSystemPrompt,
    updateTodos: updateTodos,
    DEFAULT_SYSTEM_PROMPT: DEFAULT_SYSTEM_PROMPT,
  };
})();
