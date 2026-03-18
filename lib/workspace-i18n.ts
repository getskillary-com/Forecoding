import type { ArchitectureStage } from "@/types";
import type { WorkspaceLanguage } from "@/lib/project-language";

export function getArchitectureStageLabel(language: WorkspaceLanguage, stage: ArchitectureStage) {
    const labels: Record<ArchitectureStage, { zh: string; en: string }> = {
        context: { zh: "背景", en: "Context" },
        boundaries: { zh: "边界", en: "Boundaries" },
        decisions: { zh: "决策", en: "Decisions" },
        guardrails: { zh: "护栏", en: "Guardrails" },
        ready_to_generate: { zh: "可生成", en: "Ready" }
    };

    return labels[stage][language];
}

export function getWorkspaceUiText(language: WorkspaceLanguage) {
    if (language === "zh") {
        return {
            projectLabel: "项目",
            showEarlierMessages: (count: number, hidden: number) => `显示更早消息 ${count} 条（还有 ${hidden} 条）`,
            thinking: "思考中...",
            architectStage: "架构阶段",
            readiness: "就绪度",
            scaffoldGenerated: "脚手架已生成",
            scaffoldGeneratedDesc: "脚手架已经生成完成。你仍然可以继续补充架构、更新 PRD 或调整方向。",
            checkingAccess: "正在检查访问权限...",
            generateLockedUntilReady: "就绪度未达生成要求，暂不可生成",
            redirectingToPayment: "正在跳转支付...",
            architectingSolution: "正在生成方案...",
            generateScaffold: "生成脚手架",
            proceedToPayment: "前往支付",
            proceedToPaymentWithAmount: (amount: string) => `前往支付（${amount}）`,
            proceedToPaymentCalculating: "前往支付（计算中...）",
            checkingPermissions: "正在检查权限...",
            readinessNotReady: (blocker: string) => `当前就绪度仍未达到生成要求。${blocker || "继续完善下方内容以补齐剩余缺口。"}`,
            adminModeBypassEnabled: "管理员模式：已跳过支付",
            readyToBuild: "架构就绪度已达生成要求，可以开始构建或更新脚手架。",
            estimatedQuote: (amount: string, tier: string) => `预计价格 ${amount}（${tier} 复杂度）。`,
            calculatingPrice: "正在按复杂度计算价格...",
            paymentRequired: "生成前需要先完成支付",
            nextReadinessBlocker: (blocker: string) => `继续在下方完善。当前主要阻塞项：${blocker || "补齐剩余架构缺口。"}`,
            attachFiles: "添加文件",
            generatedPlaceholder: (name: string) => `描述 ${name} 的实现变更、PRD 更新或执行方向调整...`,
            architecturePlaceholder: (name: string) => `描述 ${name} 的产品目标、模块边界、契约、风险，或直接附加文档...`,
            aiRespondingHint: "AI 正在回复。点击方形按钮可停止当前响应并发起新问题。",
            resizeChatPanel: "调整聊天面板宽度",
            architectureTab: "架构",
            prdTab: "PRD",
            scaffoldTab: "脚手架",
            techStackTab: "技术栈",
            technologyStack: "技术栈",
            prdTitle: "PRD 记录",
            prdDesc: "根据聊天记录、结构化架构对象与当前 readiness 实时同步。",
            prdSummary: "当前摘要",
            prdClarified: "已明确需求",
            prdOpenQuestions: "待确认问题",
            prdConversationSignals: "聊天同步记录",
            prdArchitectureSnapshot: "架构快照",
            prdDecisionLog: "关键决策",
            prdGuardrails: "交付护栏",
            prdNoClarified: "暂无已明确需求。",
            prdNoOpenQuestions: "暂无待确认问题。",
            prdNoConversationSignals: "还没有可同步到 PRD 的聊天记录。",
            prdNoDecisionLog: "暂无关键决策记录。",
            prdNoGuardrails: "暂无交付护栏内容。",
            prdLastUpdated: "实时同步",
            paymentCancelled: "支付已取消。",
            missingGenerateContext: "缺少生成脚手架所需的项目上下文。",
            failedToGenerate: "生成失败",
            generateTimedOut: "服务端生成超时，请重试。",
            gatewayTimedOut: "网关超时（524），请重试。",
            scaffoldPreflightFailed: (codes: string) => `脚手架预检失败：${codes || "未知错误"}`,
            scaffoldGenerationFailed: "脚手架生成失败。",
            setupProjectStructure: "初始化项目结构",
            setupProjectStructureDesc: "初始化脚手架。",
            implementCoreFeatures: "实现核心功能",
            implementCoreFeaturesDesc: "基于脚手架推进实现。",
            missingCheckoutContext: "缺少发起支付所需的项目上下文。",
            adminBypassesPayment: "管理员模式已跳过支付，请直接生成。",
            projectCredit: "项目额度",
            unableToStartStripeCheckout: "无法启动 Stripe 支付。",
            failedToStartCheckout: "启动支付失败。",
            completeReadinessBeforeGenerate: "请先补齐架构就绪度要求，再生成脚手架。",
            loading: "加载中..."
        };
    }

    return {
        projectLabel: "Project",
        showEarlierMessages: (count: number, hidden: number) => `Show ${count} earlier messages (${hidden} hidden)`,
        thinking: "Thinking...",
        architectStage: "Architect Stage",
        readiness: "Readiness",
        scaffoldGenerated: "Scaffold Generated",
        scaffoldGeneratedDesc: "Scaffold generated successfully. You can still refine the architecture, update the PRD, or adjust direction.",
        checkingAccess: "Checking access...",
        generateLockedUntilReady: "Generate Locked Until Ready",
        redirectingToPayment: "Redirecting to Payment...",
        architectingSolution: "Architecting Solution...",
        generateScaffold: "Generate Scaffold",
        proceedToPayment: "Proceed to Payment",
        proceedToPaymentWithAmount: (amount: string) => `Proceed to Payment (${amount})`,
        proceedToPaymentCalculating: "Proceed to Payment (Calculating...)",
        checkingPermissions: "Checking permissions...",
        readinessNotReady: (blocker: string) => `Architecture readiness is not complete yet. ${blocker || "Continue editing below to close the remaining gap."}`,
        adminModeBypassEnabled: "Admin mode: payment bypass enabled",
        readyToBuild: "Architecture readiness is complete. Ready to build or update scaffold.",
        estimatedQuote: (amount: string, tier: string) => `Estimated ${amount} (${tier} complexity).`,
        calculatingPrice: "Calculating complexity-based price...",
        paymentRequired: "Payment required before generation",
        nextReadinessBlocker: (blocker: string) => `Continue editing below. Primary blocker: ${blocker || "Close the remaining architecture gap."}`,
        attachFiles: "Attach files",
        generatedPlaceholder: (name: string) => `Describe implementation changes, PRD updates, or execution direction updates for ${name}...`,
        architecturePlaceholder: (name: string) => `Describe architecture goals, module boundaries, contracts, risks, or attach documents for ${name}...`,
        aiRespondingHint: "AI is responding. Press the square button to stop and ask a new question.",
        resizeChatPanel: "Resize chat panel",
        architectureTab: "Architecture",
        prdTab: "PRD",
        scaffoldTab: "Scaffold",
        techStackTab: "Tech Stack",
        technologyStack: "Technology Stack",
        prdTitle: "PRD Record",
        prdDesc: "Synced in real time from chat history, structured architecture state, and readiness.",
        prdSummary: "Current Summary",
        prdClarified: "Clarified Requirements",
        prdOpenQuestions: "Open Questions",
        prdConversationSignals: "Conversation Signals",
        prdArchitectureSnapshot: "Architecture Snapshot",
        prdDecisionLog: "Decision Log",
        prdGuardrails: "Delivery Guardrails",
        prdNoClarified: "No clarified requirements yet.",
        prdNoOpenQuestions: "No open questions.",
        prdNoConversationSignals: "No chat signals have been synced into the PRD yet.",
        prdNoDecisionLog: "No decision records yet.",
        prdNoGuardrails: "No delivery guardrails yet.",
        prdLastUpdated: "Live sync",
        paymentCancelled: "Payment cancelled.",
        missingGenerateContext: "Missing project context for scaffold generation.",
        failedToGenerate: "Failed to generate",
        generateTimedOut: "Generation timed out on server. Please retry.",
        gatewayTimedOut: "Gateway timeout from CDN/origin (524). Please retry.",
        scaffoldPreflightFailed: (codes: string) => `Scaffold preflight failed: ${codes || "unknown"}`,
        scaffoldGenerationFailed: "Scaffold generation failed.",
        setupProjectStructure: "Setup Project Structure",
        setupProjectStructureDesc: "Initialize scaffold.",
        implementCoreFeatures: "Implement Core Features",
        implementCoreFeaturesDesc: "Based on scaffold.",
        missingCheckoutContext: "Missing project context for checkout.",
        adminBypassesPayment: "Admin mode bypasses payment. Please generate directly.",
        projectCredit: "Project Credit",
        unableToStartStripeCheckout: "Unable to start Stripe checkout.",
        failedToStartCheckout: "Failed to start checkout.",
        completeReadinessBeforeGenerate: "Complete the architecture readiness checklist before generating scaffold.",
        loading: "Loading..."
    };
}

export function translateComplexityTier(language: WorkspaceLanguage, tier: string) {
    if (language !== "zh") return tier;

    switch ((tier || "").toLowerCase()) {
        case "simple":
            return "简单";
        case "medium":
            return "中等";
        case "complex":
            return "复杂";
        default:
            return tier;
    }
}

export function translateReadinessText(language: WorkspaceLanguage, value: string) {
    if (language !== "zh") return value;

    const exactMap: Record<string, string> = {
        "Capture at least 2 concrete user journeys.": "请至少明确 2 条具体用户旅程。",
        "Capture at least 2 concrete constraints or risks.": "请至少明确 2 条具体约束或风险。",
        "Define at least 1 bounded context.": "请至少定义 1 个限界上下文。",
        "Define at least 2 concrete module responsibilities.": "请至少定义 2 条具体模块职责。",
        "Define at least 1 explicit data ownership rule.": "请至少定义 1 条明确的数据归属规则。",
        "Record at least 2 concrete architecture decisions with rationale.": "请至少记录 2 条带理由的具体架构决策。",
        "Define at least 1 meaningful integration contract.": "请至少定义 1 条有意义的集成契约。",
        "Define at least 2 non-functional requirements.": "请至少定义 2 条非功能性需求。",
        "Define at least 3 implementation-order steps.": "请至少定义 3 个实现顺序步骤。",
        "Define at least 4 acceptance criteria.": "请至少定义 4 条验收标准。",
        "Define at least 2 concrete test strategy items.": "请至少定义 2 条具体测试策略。",
        "Define at least 3 key screens.": "请至少定义 3 个关键界面。",
        "Define at least 3 shared UI components.": "请至少定义 3 个共享 UI 组件。",
        "Define at least 1 responsive strategy rule.": "请至少定义 1 条响应式策略规则。",
        "Add more concrete detail.": "请补充更具体的细节。",
        "Proceed to scaffold generation when ready.": "准备就绪后进入脚手架生成。",
        "Proceed to scaffold generation.": "进入脚手架生成。",
        "Complete the architecture readiness checklist before generating scaffold.": "请先补齐架构就绪度要求，再生成脚手架。"
    };

    if (exactMap[value]) return exactMap[value];

    return value
        .replace("Business context", "业务背景")
        .replace("System boundaries", "系统边界")
        .replace("Architecture decisions", "架构决策")
        .replace("Delivery guardrails", "交付护栏")
        .replace("Experience constraints", "体验约束")
        .replace("Target users", "目标用户")
        .replace("Primary journey", "主流程")
        .replace("Core system shape", "核心系统形态")
        .replace("Key architecture decision", "关键架构决策")
        .replace("Non-functional requirement", "非功能性需求")
        .replace("Implementation order", "实现顺序")
        .replace("Acceptance criteria", "验收标准")
        .replace("Key screens", "关键界面")
        .replace(" is incomplete. ", " 尚未完整。")
        .replace("Add more concrete detail.", "请补充更具体的细节。");
}
