"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Position,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
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
import { ArrowLeft, ArrowRight, GitBranch, RefreshCw } from "lucide-react";
import type { ComponentType, DependencyGraph } from "@/lib/types";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 60;

const typeColors: Record<ComponentType, string> = {
  solution: "#6366f1",
  table: "#22c55e",
  canvas_app: "#f59e0b",
  model_driven_app: "#f97316",
  cloud_flow: "#3b82f6",
  env_variable: "#8b5cf6",
  connection_reference: "#06b6d4",
  security_role: "#ef4444",
  choice: "#ec4899",
  business_rule: "#14b8a6",
  bpf: "#a855f7",
};

function layoutGraph(graph: DependencyGraph) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80 });

  graph.nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  graph.edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const nodes: Node[] = graph.nodes.map((node) => {
    const { x, y } = g.node(node.id);
    return {
      id: node.id,
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      data: { label: node.label, type: node.type },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      style: {
        background: typeColors[node.type] || "#6b7280",
        color: "white",
        border: "none",
        borderRadius: "8px",
        padding: "8px 12px",
        fontSize: "11px",
        fontWeight: 500,
        width: NODE_WIDTH,
        textAlign: "center" as const,
        whiteSpace: "pre-line" as const,
        lineHeight: "1.3",
      },
    };
  });

  const edges: Edge[] = graph.edges.map((edge, i) => ({
    id: `e-${i}`,
    source: edge.source,
    target: edge.target,
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "#94a3b8", strokeWidth: 1.5 },
  }));

  return { nodes, edges };
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
        1: "Table", 24: "Security Role", 29: "Cloud Flow", 60: "Canvas App",
        80: "Model App", 300: "Canvas App", 371: "Connection Ref",
        380: "Env Variable", 9: "Choice", 122: "Business Rule",
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

          // Fetch components
          try {
            const components = await listSolutionComponents(token, sourceEnv.orgUrl, solId);
            for (const comp of components.slice(0, 30)) {
              if (!seen.has(comp.id)) {
                const resolved = resolveName(comp.name || comp.id, comp.type.replace(/_/g, " "));
                const typeFriendly = resolved.typeName || comp.type.replace(/_/g, " ");
                nodes.push({ id: comp.id, label: `${resolved.name}\n${typeFriendly}`, type: comp.type });
                seen.add(comp.id);
              }
              edges.push({ source: solId, target: comp.id });
            }
          } catch {
            // Component listing may fail for some solution
          }

          // Fetch dependencies
          try {
            const deps = await getSolutionDependencies(token, sourceEnv.orgUrl, sol.uniquename);
            for (const dep of deps.slice(0, 50)) {
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

  const { nodes, edges } = useMemo(
    () => layoutGraph(dependencyGraph),
    [dependencyGraph]
  );

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

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(typeColors).map(([type, color]) => (
          <Badge
            key={type}
            variant="outline"
            className="text-[10px]"
            style={{ borderColor: color, color }}
          >
            {type.replace(/_/g, " ")}
          </Badge>
        ))}
      </div>

      {/* Graph */}
      <Card>
        <CardContent className="p-0">
          <div className="h-[500px] w-full">
            {nodes.length > 0 ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                fitView
                attributionPosition="bottom-left"
                minZoom={0.3}
                maxZoom={2}
              >
                <Background />
                <Controls />
                <MiniMap
                  nodeStrokeWidth={3}
                  style={{ height: 100, width: 150 }}
                />
              </ReactFlow>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                {loading ? "Analyzing dependencies..." : "No dependency data available"}
              </div>
            )}
          </div>
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
