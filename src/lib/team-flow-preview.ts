import type { FlowEdge, FlowNode, Graph, Member, NodeKind, Workflow } from './collaboration';

export interface FlowPreviewMember {
  id: string;
  name?: string;
  missing: boolean;
}

export interface FlowPreviewNode {
  id: string;
  title: string;
  type: NodeKind;
  memberIds: string[];
  members: FlowPreviewMember[];
  missingMemberIds: string[];
  /** True when a member-driven node has no assignment, or references an absent member. */
  hasMissingMember: boolean;
  instructions: string;
  outputs: string;
  inputRefs: string[];
  maxVisits: number;
  join: FlowNode['join'];
  condition?: FlowNode['condition'];
  ports: NonNullable<FlowNode['ports']>;
  reviewMode?: FlowNode['reviewMode'];
  x: number;
  y: number;
  /** Nodes in one strongly connected component share a layer. */
  layer: number;
  orderInLayer: number;
}

export interface FlowPreviewEdge {
  id: string;
  from: string;
  to: string;
  port?: string;
  label: string;
  loop: boolean;
  maxTraversals: number;
  missingFrom: boolean;
  missingTo: boolean;
}

export interface TeamFlowPreview {
  workflowId: string;
  workflowName: string;
  source: 'version' | 'draft';
  versionId?: string;
  versionNumber?: number;
  /** Compared with the selected frozen version, including positions and limits. */
  hasDraftChanges: boolean;
  maxSteps: number;
  maxMinutes: number;
  maxTokens: number;
  nodes: FlowPreviewNode[];
  edges: FlowPreviewEdge[];
  /** Parallel entries remain peers; this is layout metadata, not an execution order. */
  layers: { index: number; nodeIds: string[] }[];
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function memberIdsOf(node: FlowNode): string[] {
  return [...new Set((node.type==='discussion'?node.participants??[]:node.memberId?[node.memberId]:[]).filter((id): id is string => Boolean(id)))];
}

const NEEDS_MEMBER = new Set<NodeKind>(['agent', 'discussion', 'review', 'handoff']);

/**
 * Assign finite display layers without treating the graph as a linear plan.
 * Declared rework edges do not pull nodes backwards. Any remaining cycles are
 * condensed into strongly connected components before the DAG is ranked.
 */
function graphLayers(nodes: FlowNode[], edges: FlowEdge[]): Map<string, number> {
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (edge.loop || !adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    const next = adjacency.get(edge.from)!;
    if (!next.includes(edge.to)) next.push(edge.to);
  }

  let serial = 0;
  const indices = new Map<string, number>();
  const lows = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string) => {
    indices.set(id, serial);
    lows.set(id, serial++);
    stack.push(id);
    stacked.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!indices.has(next)) {
        visit(next);
        lows.set(id, Math.min(lows.get(id)!, lows.get(next)!));
      } else if (stacked.has(next)) {
        lows.set(id, Math.min(lows.get(id)!, indices.get(next)!));
      }
    }
    if (lows.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    for (;;) {
      const current = stack.pop()!;
      stacked.delete(current);
      component.push(current);
      if (current === id) break;
    }
    component.sort((a, b) => order.get(a)! - order.get(b)!);
    components.push(component);
  };
  for (const node of nodes) if (!indices.has(node.id)) visit(node.id);

  const componentOf = new Map<string, number>();
  components.forEach((component, index) => component.forEach((id) => componentOf.set(id, index)));
  const nextComponents = components.map(() => new Set<number>());
  const indegree = components.map(() => 0);
  for (const [from, targets] of adjacency) {
    const fromComponent = componentOf.get(from)!;
    for (const target of targets) {
      const toComponent = componentOf.get(target)!;
      if (fromComponent === toComponent || nextComponents[fromComponent].has(toComponent)) continue;
      nextComponents[fromComponent].add(toComponent);
      indegree[toComponent]++;
    }
  }
  const firstOrder = components.map((component) => Math.min(...component.map((id) => order.get(id)!)));
  const ready = components.map((_, index) => index).filter((index) => indegree[index] === 0)
    .sort((a, b) => firstOrder[a] - firstOrder[b]);
  const ranks = components.map(() => 0);
  while (ready.length) {
    const current = ready.shift()!;
    for (const next of nextComponents[current]) {
      ranks[next] = Math.max(ranks[next], ranks[current] + 1);
      if (--indegree[next] === 0) {
        ready.push(next);
        ready.sort((a, b) => firstOrder[a] - firstOrder[b]);
      }
    }
  }
  return new Map(nodes.map((node) => [node.id, ranks[componentOf.get(node.id)!]]));
}

export function teamFlowPreview(
  workflow: Workflow,
  members: readonly Member[],
  versionId?: string,
): TeamFlowPreview {
  const selected = versionId
    ? workflow.versions.find((version) => version.id === versionId)
    : workflow.versions.reduce<typeof workflow.versions[number] | undefined>((latest, version) => {
      if (!latest || version.number > latest.number ||
        (version.number === latest.number && version.createdAt > latest.createdAt)) return version;
      return latest;
    }, undefined);
  if (versionId && !selected) throw new Error(`流程版本不存在：${versionId}`);
  const graph: Graph = selected?.graph ?? workflow.draft;
  const source = selected ? 'version' as const : 'draft' as const;
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const memberById = new Map(members.map((member) => [member.id, member]));
  const rank = graphLayers(graph.nodes, graph.edges);
  const inLayer = new Map<number, number>();
  const previewNodes = graph.nodes.map((node) => {
    const layer = rank.get(node.id) ?? 0;
    const orderInLayer = inLayer.get(layer) ?? 0;
    inLayer.set(layer, orderInLayer + 1);
    const memberIds = memberIdsOf(node);
    const memberRefs = memberIds.map((id) => ({ id, name: memberById.get(id)?.name, missing: !memberById.has(id) }));
    const missingMemberIds = memberRefs.filter((member) => member.missing).map((member) => member.id);
    return {
      id: node.id,
      title: node.title,
      type: node.type,
      memberIds,
      members: memberRefs,
      missingMemberIds,
      hasMissingMember: missingMemberIds.length > 0 || (NEEDS_MEMBER.has(node.type) && memberIds.length === 0),
      instructions: node.instructions,
      outputs: node.outputRequirement,
      inputRefs: [...(node.inputRefs ?? [])],
      maxVisits: node.maxVisits,
      join: node.join,
      condition: node.condition ? { ...node.condition } : undefined,
      ports: (node.ports ?? []).map((port) => ({ ...port })),
      reviewMode: node.reviewMode,
      x: node.x,
      y: node.y,
      layer,
      orderInLayer,
    };
  });
  const previewEdges = graph.edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    port: edge.port,
    label: edge.label,
    loop: edge.loop === true,
    maxTraversals: edge.maxTraversals,
    missingFrom: !nodeIds.has(edge.from),
    missingTo: !nodeIds.has(edge.to),
  }));
  const grouped = new Map<number, string[]>();
  for (const node of previewNodes) grouped.set(node.layer, [...(grouped.get(node.layer) ?? []), node.id]);

  return {
    workflowId: workflow.id,
    workflowName: workflow.name,
    source,
    versionId: selected?.id,
    versionNumber: selected?.number,
    hasDraftChanges: selected ? stableValue(workflow.draft) !== stableValue(selected.graph) : false,
    maxSteps: graph.maxSteps,
    maxMinutes: graph.maxMinutes,
    maxTokens: graph.maxTokens,
    nodes: previewNodes,
    edges: previewEdges,
    layers: [...grouped.entries()].sort(([a], [b]) => a - b).map(([index, ids]) => ({ index, nodeIds: ids })),
  };
}
