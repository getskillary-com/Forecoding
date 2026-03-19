import type {
    ArchitectureDiagramEdge,
    ArchitectureDiagramLayer,
    ArchitectureDiagramLayerId,
    ArchitectureDiagramModel,
    ArchitectureDiagramNode,
    ArchitecturePack,
    DecisionRecord,
    GuardrailChecklist
} from "@/types";

type DiagramLanguage = "zh" | "en";

type DiagramLayerDescriptor = {
    id: ArchitectureDiagramLayerId;
    title: string;
    summary: string;
    items: string[];
};

type DiagramInspectorSection = {
    id: ArchitectureDiagramLayerId;
    title: string;
    summary: string;
    items: string[];
};

const MAX_LABEL_CHARS = 84;
const MAX_CONTEXT_ITEMS = 5;
const MAX_STRUCTURE_ITEMS = 6;
const MAX_DATA_ITEMS = 6;
const MAX_DELIVERY_ITEMS = 6;

function clipText(value: string, maxChars: number) {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars - 3)}...`;
}

function normalizeWhitespace(value: string) {
    return value.replace(/\s+/g, " ").trim();
}

export function sanitizeArchitectureDiagramLabel(value: string, maxChars: number = MAX_LABEL_CHARS) {
    return clipText(
        normalizeWhitespace(
            value
                .replace(/<[^>]+>/g, " ")
                .replace(/[`|]/g, " ")
                .replace(/[[\]{}]/g, " ")
                .replace(/"/g, "'")
                .replace(/\r?\n+/g, " ")
        ),
        maxChars
    );
}

function normalizeMermaidCompatibilityCode(value: string | null | undefined) {
    if (!value || !value.trim()) return "";
    return value
        .replace(/```mermaid\s*/gi, "")
        .replace(/```/g, "")
        .replace(/\r/g, "")
        .replace(/<\s*\/\s*subgraph\s*>/gi, "\nend\n")
        .trim();
}

function stableHash(value: string) {
    let hash = 0;
    for (const char of value) {
        hash = ((hash << 5) - hash) + char.charCodeAt(0);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

function buildNodeId(layerId: ArchitectureDiagramLayerId, label: string, index: number) {
    const normalized = sanitizeArchitectureDiagramLabel(label, 48)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    if (normalized) {
        return `${layerId}_${normalized}_${index}`;
    }

    return `${layerId}_${stableHash(label)}_${index}`;
}

function dedupeItems(items: string[], maxItems: number) {
    const seen = new Set<string>();
    const deduped: string[] = [];

    for (const rawItem of items) {
        const item = sanitizeArchitectureDiagramLabel(rawItem);
        if (!item) continue;
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
        if (deduped.length >= maxItems) break;
    }

    return deduped;
}

function hasNonEmptyList(values: string[]) {
    return values.some((value) => typeof value === "string" && value.trim().length > 0);
}

export function hasStructuredArchitectureDiagramSource(
    architecturePack: ArchitecturePack,
    decisionRecords: DecisionRecord[] = [],
    guardrailChecklist?: GuardrailChecklist
) {
    return Boolean(
        architecturePack.businessContext.productGoal ||
        architecturePack.platformStrategy.primaryPlatform ||
        hasNonEmptyList(architecturePack.businessContext.targetUsers) ||
        hasNonEmptyList(architecturePack.businessContext.userJourneys) ||
        hasNonEmptyList(architecturePack.businessContext.constraints) ||
        hasNonEmptyList(architecturePack.businessContext.risks) ||
        architecturePack.boundedContexts.length > 0 ||
        architecturePack.moduleResponsibilities.length > 0 ||
        architecturePack.dataOwnership.length > 0 ||
        architecturePack.integrationContracts.length > 0 ||
        architecturePack.nonFunctionalRequirements.length > 0 ||
        architecturePack.experienceConstraints.keyScreens.length > 0 ||
        architecturePack.experienceConstraints.uiComponents.length > 0 ||
        architecturePack.experienceConstraints.responsiveStrategy.length > 0 ||
        decisionRecords.length > 0 ||
        (guardrailChecklist?.implementationOrder.length || 0) > 0 ||
        (guardrailChecklist?.acceptanceCriteria.length || 0) > 0 ||
        (guardrailChecklist?.testStrategy.length || 0) > 0
    );
}

function buildPlaceholderLayer(language: DiagramLanguage): DiagramLayerDescriptor {
    return {
        id: "placeholder",
        title: language === "zh" ? "架构梳理" : "Architecture discovery",
        summary: language === "zh" ? "从这里开始梳理架构" : "Start architecture discovery",
        items: [
            language === "zh"
                ? "先确认产品目标、核心用户和关键流程"
                : "Clarify the product goal, core users, and key workflow"
        ]
    };
}

function buildContextLayer(pack: ArchitecturePack, language: DiagramLanguage): DiagramLayerDescriptor {
    const isZh = language === "zh";
    const summary = sanitizeArchitectureDiagramLabel(
        pack.businessContext.productGoal ||
        (isZh ? "明确产品目标与平台策略" : "Define product intent and launch platform")
    );

    const items = dedupeItems([
        pack.platformStrategy.primaryPlatform
            ? `${isZh ? "首发平台" : "Primary platform"}: ${pack.platformStrategy.primaryPlatform}`
            : "",
        ...pack.businessContext.targetUsers.map((item) => `${isZh ? "目标用户" : "Target user"}: ${item}`),
        ...pack.businessContext.userJourneys.map((item) => `${isZh ? "关键旅程" : "Journey"}: ${item}`),
        ...pack.businessContext.constraints.map((item) => `${isZh ? "约束" : "Constraint"}: ${item}`),
        ...pack.businessContext.risks.map((item) => `${isZh ? "风险" : "Risk"}: ${item}`)
    ], MAX_CONTEXT_ITEMS);

    return {
        id: "context",
        title: isZh ? "业务背景" : "Business context",
        summary,
        items
    };
}

function buildStructureLayer(pack: ArchitecturePack, language: DiagramLanguage): DiagramLayerDescriptor {
    const isZh = language === "zh";
    const items = dedupeItems([
        ...pack.boundedContexts.map((item) => `${isZh ? "限界上下文" : "Bounded context"}: ${item.name} - ${item.responsibility}`),
        ...pack.moduleResponsibilities.map((item) => `${isZh ? "模块职责" : "Module"}: ${item.module} - ${item.responsibility}`),
        ...pack.experienceConstraints.keyScreens.map((item) => `${isZh ? "关键界面" : "Key screen"}: ${item}`),
        ...pack.experienceConstraints.uiComponents.map((item) => `${isZh ? "共享组件" : "Shared component"}: ${item}`)
    ], MAX_STRUCTURE_ITEMS);

    return {
        id: "structure",
        title: isZh ? "核心结构" : "Core structure",
        summary: isZh ? "划清模块边界与界面骨架" : "Define module boundaries and app surfaces",
        items
    };
}

function buildDataLayer(pack: ArchitecturePack, language: DiagramLanguage): DiagramLayerDescriptor {
    const isZh = language === "zh";
    const items = dedupeItems([
        ...pack.dataOwnership.map((item) => `${isZh ? "数据归属" : "Data ownership"}: ${item.data} -> ${item.owner}`),
        ...pack.integrationContracts.map((item) => `${isZh ? "集成契约" : "Contract"}: ${item.name} | ${item.producer} -> ${item.consumer}`),
        ...pack.experienceConstraints.responsiveStrategy.map((item) => `${isZh ? "响应式策略" : "Responsive rule"}: ${item}`)
    ], MAX_DATA_ITEMS);

    return {
        id: "data",
        title: isZh ? "数据与集成" : "Data and integrations",
        summary: isZh ? "连接数据边界、接口契约与运行环境" : "Connect data ownership, contracts, and runtime edges",
        items
    };
}

function buildDeliveryLayer(
    pack: ArchitecturePack,
    decisionRecords: DecisionRecord[],
    guardrailChecklist: GuardrailChecklist,
    language: DiagramLanguage
): DiagramLayerDescriptor {
    const isZh = language === "zh";
    const items = dedupeItems([
        ...pack.nonFunctionalRequirements.map((item) => `${isZh ? "NFR" : "NFR"}: ${item.category} - ${item.requirement}`),
        ...decisionRecords.map((item) => `${isZh ? "架构决策" : "Decision"}: ${item.title || item.decision}`),
        ...guardrailChecklist.implementationOrder.map((item) => `${isZh ? "实施顺序" : "Implementation"}: ${item}`),
        ...guardrailChecklist.acceptanceCriteria.map((item) => `${isZh ? "验收标准" : "Acceptance"}: ${item}`),
        ...guardrailChecklist.testStrategy.map((item) => `${isZh ? "测试策略" : "Test"}: ${item}`)
    ], MAX_DELIVERY_ITEMS);

    return {
        id: "delivery",
        title: isZh ? "交付护栏" : "Delivery guardrails",
        summary: isZh ? "锁定关键决策、约束与验收路径" : "Lock decisions, constraints, and validation path",
        items
    };
}

function buildLayerDescriptors(
    pack: ArchitecturePack,
    decisionRecords: DecisionRecord[],
    guardrailChecklist: GuardrailChecklist,
    language: DiagramLanguage
) {
    if (!hasStructuredArchitectureDiagramSource(pack, decisionRecords, guardrailChecklist)) {
        return [buildPlaceholderLayer(language)];
    }

    return [
        buildContextLayer(pack, language),
        buildStructureLayer(pack, language),
        buildDataLayer(pack, language),
        buildDeliveryLayer(pack, decisionRecords, guardrailChecklist, language)
    ].filter((layer) => layer.summary || layer.items.length > 0);
}

export function buildArchitectureDiagramModel(
    architecturePack: ArchitecturePack,
    decisionRecords: DecisionRecord[] = [],
    guardrailChecklist?: GuardrailChecklist,
    language: DiagramLanguage = "en"
): ArchitectureDiagramModel {
    const safeGuardrails: GuardrailChecklist = guardrailChecklist ?? {
        implementationOrder: [],
        acceptanceCriteria: [],
        testStrategy: []
    };
    const descriptors = buildLayerDescriptors(
        architecturePack,
        decisionRecords,
        safeGuardrails,
        language
    );
    const nodes: ArchitectureDiagramNode[] = [];
    const edges: ArchitectureDiagramEdge[] = [];
    const layers: ArchitectureDiagramLayer[] = [];

    const addNode = (
        layerId: ArchitectureDiagramLayerId,
        label: string,
        kind: "summary" | "detail",
        index: number
    ) => {
        const node: ArchitectureDiagramNode = {
            id: buildNodeId(layerId, label, index),
            layerId,
            label: sanitizeArchitectureDiagramLabel(label),
            kind
        };
        nodes.push(node);
        return node.id;
    };

    const summaryNodeIds: string[] = [];

    descriptors.forEach((descriptor) => {
        const summaryNodeId = addNode(descriptor.id, descriptor.summary, "summary", 0);
        const nodeIds = [summaryNodeId];
        summaryNodeIds.push(summaryNodeId);

        descriptor.items.forEach((item, index) => {
            const itemNodeId = addNode(descriptor.id, item, "detail", index + 1);
            nodeIds.push(itemNodeId);
            edges.push({ from: summaryNodeId, to: itemNodeId });
        });

        layers.push({
            id: descriptor.id,
            title: descriptor.title,
            summaryNodeId,
            nodeIds
        });
    });

    for (let index = 0; index < summaryNodeIds.length - 1; index += 1) {
        edges.push({
            from: summaryNodeIds[index],
            to: summaryNodeIds[index + 1]
        });
    }

    return {
        version: "architecture_diagram_v1",
        direction: "LR",
        layers,
        nodes,
        edges
    };
}

function renderMermaidEdge(edge: ArchitectureDiagramEdge) {
    const label = sanitizeArchitectureDiagramLabel(edge.label || "", 48);
    return label
        ? `${edge.from} -->|"${label}"| ${edge.to}`
        : `${edge.from} --> ${edge.to}`;
}

export function renderArchitectureDiagramMermaid(model: ArchitectureDiagramModel) {
    const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
    const layerByNodeId = new Map<string, ArchitectureDiagramLayerId>();
    model.layers.forEach((layer) => {
        layer.nodeIds.forEach((nodeId) => layerByNodeId.set(nodeId, layer.id));
    });

    const lines: string[] = [`flowchart ${model.direction}`];

    model.layers.forEach((layer) => {
        lines.push(`    subgraph ${layer.id}["${sanitizeArchitectureDiagramLabel(layer.title, 48)}"]`);
        layer.nodeIds.forEach((nodeId) => {
            const node = nodeById.get(nodeId);
            if (!node) return;
            lines.push(`        ${node.id}["${sanitizeArchitectureDiagramLabel(node.label)}"]`);
        });
        model.edges
            .filter((edge) => layerByNodeId.get(edge.from) === layer.id && layerByNodeId.get(edge.to) === layer.id)
            .forEach((edge) => {
                lines.push(`        ${renderMermaidEdge(edge)}`);
            });
        lines.push("    end");
    });

    model.edges
        .filter((edge) => layerByNodeId.get(edge.from) !== layerByNodeId.get(edge.to))
        .forEach((edge) => {
            lines.push(`    ${renderMermaidEdge(edge)}`);
        });

    return lines.join("\n");
}

export function buildEmptyArchitectureDiagramMermaid(language: DiagramLanguage = "en") {
    return renderArchitectureDiagramMermaid(
        buildArchitectureDiagramModel(
            {
                version: "architecture_pack_v1",
                businessContext: {
                    productGoal: "",
                    targetUsers: [],
                    userJourneys: [],
                    constraints: [],
                    risks: []
                },
                platformStrategy: {
                    primaryPlatform: "",
                    targetPlatforms: [],
                    runtimeEnvironments: [],
                    distributionChannels: []
                },
                domainModel: [],
                boundedContexts: [],
                moduleResponsibilities: [],
                dataOwnership: [],
                integrationContracts: [],
                nonFunctionalRequirements: [],
                deliveryPlan: [],
                experienceConstraints: {
                    keyScreens: [],
                    uiComponents: [],
                    interactionStates: [],
                    responsiveStrategy: []
                }
            },
            [],
            {
                implementationOrder: [],
                acceptanceCriteria: [],
                testStrategy: []
            },
            language
        )
    );
}

export function deriveArchitectureDiagramMermaid(input: {
    architecturePack: ArchitecturePack;
    decisionRecords?: DecisionRecord[];
    guardrailChecklist?: GuardrailChecklist;
    language?: DiagramLanguage;
    fallbackDiagram?: string | null;
}) {
    const language = input.language ?? "en";
    const decisionRecords = input.decisionRecords ?? [];
    const guardrailChecklist = input.guardrailChecklist ?? {
        implementationOrder: [],
        acceptanceCriteria: [],
        testStrategy: []
    };

    if (!hasStructuredArchitectureDiagramSource(input.architecturePack, decisionRecords, guardrailChecklist)) {
        const compatibilityDiagram = normalizeMermaidCompatibilityCode(input.fallbackDiagram);
        if (compatibilityDiagram) {
            return compatibilityDiagram;
        }
    }

    const model = buildArchitectureDiagramModel(
        input.architecturePack,
        decisionRecords,
        guardrailChecklist,
        language
    );
    return renderArchitectureDiagramMermaid(model);
}

export function buildArchitectureDiagramInspectorSections(model: ArchitectureDiagramModel): DiagramInspectorSection[] {
    const nodeById = new Map(model.nodes.map((node) => [node.id, node]));

    return model.layers
        .map((layer) => {
            const summary = nodeById.get(layer.summaryNodeId)?.label || "";
            const items = layer.nodeIds
                .filter((nodeId) => nodeId !== layer.summaryNodeId)
                .map((nodeId) => nodeById.get(nodeId)?.label || "")
                .filter(Boolean);

            return {
                id: layer.id,
                title: layer.title,
                summary,
                items
            };
        })
        .filter((section) => section.summary || section.items.length > 0);
}
