"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMigrationWizardStore, useEnvironmentStore } from "@/lib/stores";
import { useAuth } from "@/lib/auth/auth-context";
import { listSolutionComponents, getSolutionDependencies } from "@/lib/api/power-platform";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, GitBranch, RefreshCw, ChevronRight, ChevronDown } from "lucide-react";
import type { ComponentType, DependencyGraph, DependencyNode as DepNode } from "@/lib/types";

const typeColors: Record<ComponentType, string> = {
  solution: "#6366f1",
  table: "#22c55e",
  column: "#86efac",
  relationship: "#4ade80",
  canvas_app: "#f59e0b",
  model_driven_app: "#f97316",
  cloud_flow: "#3b82f6",
  env_variable: "#8b5cf6",
  connection_reference: "#06b6d4",
  security_role: "#ef4444",
  choice: "#ec4899",
  business_rule: "#14b8a6",
  bpf: "#a855f7",
  web_resource: "#0ea5e9",
  form: "#d946ef",
  view: "#10b981",
  chart: "#f472b6",
  sitemap: "#78716c",
  plugin_assembly: "#64748b",
  sdk_step: "#94a3b8",
  custom_control: "#c084fc",
  custom_api: "#818cf8",
  agent: "#fb923c",
  agent_component: "#fdba74",
  card: "#fbbf24",
  component_library: "#2dd4bf",
  report: "#a78bfa",
  email_template: "#38bdf8",
  ribbon: "#737373",
  other: "#9ca3af",
};

const typeLabels: Record<ComponentType, string> = {
  solution: "Solution",
  table: "Table",
  column: "Column",
  relationship: "Relationship",
  canvas_app: "Canvas App",
  model_driven_app: "Model App",
  cloud_flow: "Cloud Flow",
  env_variable: "Env Variable",
  connection_reference: "Connection Ref",
  security_role: "Security Role",
  choice: "Choice",
  business_rule: "Business Rule",
  bpf: "BPF",
  web_resource: "Web Resource",
  form: "Form",
  view: "View",
  chart: "Chart",
  sitemap: "Site Map",
  plugin_assembly: "Plugin",
  sdk_step: "SDK Step",
  custom_control: "Custom Control",
  custom_api: "Custom API",
  agent: "Agent",
  agent_component: "Topic",
  card: "Card",
  component_library: "Component Library",
  report: "Report",
  email_template: "Email Template",
  ribbon: "Ribbon",
  other: "Other",
};

// ─── Tree structures ──────────────────────────────────────
interface TreeNode {
  id: string;
  label: string;
  type: ComponentType;
  children: TreeNode[];
}

function buildTree(graph: DependencyGraph): TreeNode[] {
  const nodeMap = new Map<string, DepNode>();
  for (const n of graph.nodes) nodeMap.set(n.id, n);

  // Find which nodes are children (targets of edges)
  const childIds = new Set(graph.edges.map((e) => e.target));
  // Build children lookup: parentId → [childIds]
  const childrenOf = new Map<string, string[]>();
  for (const e of graph.edges) {
    const arr = childrenOf.get(e.source) || [];
    arr.push(e.target);
    childrenOf.set(e.source, arr);
  }

  function buildNode(id: string, visited: Set<string>): TreeNode | null {
    if (visited.has(id)) return null;
    visited.add(id);
    const node = nodeMap.get(id);
    if (!node) return null;
    const kids = (childrenOf.get(id) || [])
      .map((cid) => buildNode(cid, visited))
      .filter(Boolean) as TreeNode[];
    // Sort children by type first (alphabetical by type label), then by name within same type
    const typeOrder = Object.keys(typeLabels);
    kids.sort((a, b) => {
      const aIdx = typeOrder.indexOf(a.type);
      const bIdx = typeOrder.indexOf(b.type);
      const aOrder = aIdx === -1 ? 999 : aIdx;
      const bOrder = bIdx === -1 ? 999 : bIdx;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.label.localeCompare(b.label);
    });
    return { id: node.id, label: node.label, type: node.type, children: kids };
  }

  // Root nodes = nodes that are NOT a child of any edge
  const roots = graph.nodes
    .filter((n) => !childIds.has(n.id))
    .map((n) => buildNode(n.id, new Set()))
    .filter(Boolean) as TreeNode[];

  // If every node is a child (cycle), just use all nodes as roots
  if (roots.length === 0) {
    return graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      children: [],
    }));
  }

  return roots;
}

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const color = typeColors[node.type] || "#6b7280";
  const label = node.label.replace(/\n/g, " — ");

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span
          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm truncate font-medium">{label}</span>
        <Badge
          variant="outline"
          className="ml-auto text-[10px] shrink-0"
          style={{ borderColor: color, color }}
        >
          {typeLabels[node.type] || node.type}
        </Badge>
        {hasChildren && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            ({node.children.length})
          </span>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function DependencyTree({ graph }: { graph: DependencyGraph }) {
  const tree = useMemo(() => buildTree(graph), [graph]);
  const [allExpanded, setAllExpanded] = useState(false);
  // Use a key to force re-render all TreeItems when toggling expand/collapse
  const [treeKey, setTreeKey] = useState(0);

  const toggleAll = () => {
    setAllExpanded(!allExpanded);
    setTreeKey((k) => k + 1);
  };

  if (tree.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground py-12">
        No dependency data available
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end px-3 pt-2">
        <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs h-7">
          {allExpanded ? "Collapse All" : "Expand All"}
        </Button>
      </div>
      <div className="px-2 pb-3 max-h-[500px] overflow-y-auto" key={treeKey}>
        {tree.map((node) => (
          <TreeItemControlled key={node.id} node={node} depth={0} forceExpanded={allExpanded} />
        ))}
      </div>
    </div>
  );
}

function TreeItemControlled({ node, depth = 0, forceExpanded }: { node: TreeNode; depth?: number; forceExpanded: boolean }) {
  const [expanded, setExpanded] = useState(forceExpanded || depth < 2);
  const hasChildren = node.children.length > 0;
  const color = typeColors[node.type] || "#6b7280";
  const label = node.label.replace(/\n/g, " — ");

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span
          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm truncate font-medium">{label}</span>
        <Badge
          variant="outline"
          className="ml-auto text-[10px] shrink-0"
          style={{ borderColor: color, color }}
        >
          {typeLabels[node.type] || node.type}
        </Badge>
        {hasChildren && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            ({node.children.length})
          </span>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeItemControlled key={child.id} node={child} depth={depth + 1} forceExpanded={forceExpanded} />
          ))}
        </div>
      )}
    </div>
  );
}

export function StepDependencies() {
  const { getDataverseToken } = useAuth();
  const sourceEnv = useEnvironmentStore((s) => s.sourceEnvironment);
  const {
    selections,
    solutions,
    tables,
    connectionRefs,
    envVariables,
    securityRoles,
    dependencyGraph,
    setDependencyGraph,
    setCurrentStep,
  } = useMigrationWizardStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build a lookup map: id → display name
  const nameMap = useMemo(() => {
    const map = new Map<string, { name: string; type: string }>();
    for (const s of solutions) map.set(s.solutionid, { name: s.friendlyname, type: "Solution" });
    for (const t of tables) map.set(t.logicalName, { name: t.displayName, type: "Table" });
    for (const c of connectionRefs) map.set(c.id, { name: c.displayName, type: "Connection Ref" });
    for (const v of envVariables) map.set(v.id, { name: v.displayName, type: "Env Variable" });
    for (const r of securityRoles) map.set(r.roleid, { name: r.name, type: "Security Role" });
    return map;
  }, [solutions, tables, connectionRefs, envVariables, securityRoles]);

  const resolveName = useCallback((id: string, fallbackType: string) => {
    const entry = nameMap.get(id);
    if (entry) return { name: entry.name, typeName: entry.type };
    return { name: id.substring(0, 12) + "...", typeName: fallbackType };
  }, [nameMap]);

  const analyzeDependencies = useCallback(async () => {
    if (!sourceEnv?.orgUrl) return;
    setLoading(true);
    setError(null);

    try {
      const token = await getDataverseToken(sourceEnv.orgUrl);
      const selectedSolutions = selections.find((s) => s.objectType === "solutions");
      const nodes: DependencyGraph["nodes"] = [];
      const edges: DependencyGraph["edges"] = [];
      const seen = new Set<string>();

      // Component type number → friendly name
      const compTypeLabel: Record<number, string> = {
        1: "Table", 2: "Column", 3: "Relationship", 9: "Choice",
        10: "Relationship", 20: "Security Role", 24: "Form",
        26: "View", 29: "Cloud Flow", 31: "Report",
        36: "Email Template", 59: "Chart", 60: "Form",
        61: "Web Resource", 62: "Site Map", 66: "Custom Control",
        80: "Model App", 91: "Plugin", 92: "SDK Step",
        122: "Business Rule", 176: "Custom API", 300: "Canvas App",
        371: "Connection Ref", 380: "Env Variable",
        400: "Agent", 401: "Agent", 402: "Agent",
        430: "Card", 431: "Card",
      };

      // Add selected solutions as root nodes
      if (selectedSolutions?.enabled && selectedSolutions.items.length > 0) {
        for (const solId of selectedSolutions.items) {
          const sol = solutions.find((s) => s.solutionid === solId);
          if (!sol) continue;
          if (!seen.has(solId)) {
            nodes.push({ id: solId, label: `${sol.friendlyname}\nSolution`, type: "solution" });
            seen.add(solId);
          }

          // Fetch components — no limit, show all
          try {
            const components = await listSolutionComponents(token, sourceEnv.orgUrl, solId);
            for (const comp of components) {
              if (!seen.has(comp.id)) {
                const displayLabel = comp.displayName !== comp.name ? comp.displayName : comp.name;
                const typeFriendly = comp.type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
                nodes.push({ id: comp.id, label: `${displayLabel}\n${typeFriendly}`, type: comp.type });
                seen.add(comp.id);
              }
              edges.push({ source: solId, target: comp.id });
            }
          } catch {
            // Component listing may fail for some solution
          }

          // Fetch dependencies — no limit, show all
          try {
            const deps = await getSolutionDependencies(token, sourceEnv.orgUrl, sol.uniquename);
            for (const dep of deps) {
              const reqId = dep.requiredComponentObjectId;
              const depId = dep.dependentComponentObjectId;
              const reqTypeLabel = compTypeLabel[dep.requiredComponentType] || "Component";
              const depTypeLabel = compTypeLabel[dep.dependentComponentType] || "Component";
              if (!seen.has(reqId)) {
                const resolved = resolveName(reqId, reqTypeLabel);
                nodes.push({ id: reqId, label: `${resolved.name}\n${resolved.typeName}`, type: "table" });
                seen.add(reqId);
              }
              if (!seen.has(depId)) {
                const resolved = resolveName(depId, depTypeLabel);
                nodes.push({ id: depId, label: `${resolved.name}\n${resolved.typeName}`, type: "table" });
                seen.add(depId);
              }
              edges.push({ source: reqId, target: depId });
            }
          } catch {
            // Dependencies may not be available
          }
        }
      }

      // Map objectType → friendly label and component type
      const typeConfig: Record<string, { label: string; compType: ComponentType }> = {
        tables: { label: "Table", compType: "table" },
        cloud_flows: { label: "Cloud Flow", compType: "cloud_flow" },
        canvas_apps: { label: "Canvas App", compType: "canvas_app" },
        model_driven_apps: { label: "Model App", compType: "model_driven_app" },
        env_variables: { label: "Env Variable", compType: "env_variable" },
        connection_references: { label: "Connection Ref", compType: "connection_reference" },
        security_roles: { label: "Security Role", compType: "security_role" },
        choices: { label: "Choice", compType: "choice" },
        business_rules: { label: "Business Rule", compType: "business_rule" },
        bpfs: { label: "BPF", compType: "bpf" },
      };

      // Add other selected types as nodes
      const otherTypes = selections.filter((s) => s.enabled && s.objectType !== "solutions");
      for (const sel of otherTypes) {
        const cfg = typeConfig[sel.objectType] || { label: sel.objectType.replace(/_/g, " "), compType: "solution" as ComponentType };
        const groupLabel = cfg.label + "s";
        const typeNodeId = `type-${sel.objectType}`;
        if (!seen.has(typeNodeId)) {
          nodes.push({ id: typeNodeId, label: groupLabel, type: "solution" as ComponentType });
          seen.add(typeNodeId);
        }
        for (const itemId of sel.items.slice(0, 10)) {
          if (!seen.has(itemId)) {
            const resolved = resolveName(itemId, cfg.label);
            nodes.push({ id: itemId, label: `${resolved.name}\n${resolved.typeName}`, type: cfg.compType });
            seen.add(itemId);
          }
          edges.push({ source: typeNodeId, target: itemId });
        }
      }

      // If we have no data at all, create a demo graph
      if (nodes.length === 0) {
        const enabledSelections = selections.filter((s) => s.enabled);
        for (const sel of enabledSelections) {
          nodes.push({
            id: sel.objectType,
            label: sel.objectType.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
            type: "solution",
          });
        }
        for (let i = 1; i < nodes.length; i++) {
          edges.push({ source: nodes[0].id, target: nodes[i].id });
        }
      }

      setDependencyGraph({ nodes, edges });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze dependencies");
    } finally {
      setLoading(false);
    }
  }, [sourceEnv, getDataverseToken, selections, solutions, setDependencyGraph, resolveName]);

  useEffect(() => {
    if (dependencyGraph.nodes.length === 0) {
      analyzeDependencies();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Dependency Analysis
          </h2>
          <p className="text-sm text-muted-foreground">
            Visualize component dependencies and migration order
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={analyzeDependencies} disabled={loading}>
          {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Re-analyze
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Legend — only show types present in the data */}
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(typeColors)
          .filter(([type]) => dependencyGraph.nodes.some((n) => n.type === type))
          .map(([type, color]) => (
          <Badge
            key={type}
            variant="outline"
            className="text-[10px]"
            style={{ borderColor: color, color }}
          >
            {typeLabels[type as ComponentType] || type.replace(/_/g, " ")}
          </Badge>
        ))}
      </div>

      {/* Visualization */}
      <Card>
        <CardContent className="p-0">
          {dependencyGraph.nodes.length > 0 ? (
            <DependencyTree graph={dependencyGraph} />
          ) : (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              {loading ? "Analyzing dependencies..." : "No dependency data available"}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Summary</CardTitle>
          <CardDescription>
            {dependencyGraph.nodes.length} components, {dependencyGraph.edges.length} dependencies detected
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setCurrentStep(1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={() => setCurrentStep(3)}>
          Next: Validate
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
