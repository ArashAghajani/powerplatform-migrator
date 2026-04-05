// ─── Environment ──────────────────────────────────────────
export type MigrationType = "same-tenant" | "cross-tenant";

export interface PowerPlatformEnvironment {
  id: string;
  name: string;
  displayName: string;
  location: string;
  type: "Production" | "Sandbox" | "Developer" | "Trial" | "Default";
  orgUrl: string;
  apiUrl: string;
  state: string;
  createdTime: string;
  tenantId?: string;
}

// ─── Solution ─────────────────────────────────────────────
export interface Solution {
  solutionid: string;
  uniquename: string;
  friendlyname: string;
  version: string;
  ismanaged: boolean;
  publisherid: string;
  description?: string;
  installedon?: string;
}

// ─── Solution Component ───────────────────────────────────
export type ComponentType =
  | "solution"
  | "table"
  | "column"
  | "relationship"
  | "canvas_app"
  | "model_driven_app"
  | "cloud_flow"
  | "env_variable"
  | "connection_reference"
  | "security_role"
  | "choice"
  | "business_rule"
  | "bpf"
  | "web_resource"
  | "form"
  | "view"
  | "chart"
  | "sitemap"
  | "plugin_assembly"
  | "sdk_step"
  | "custom_control"
  | "custom_api"
  | "agent"
  | "agent_component"
  | "card"
  | "component_library"
  | "report"
  | "email_template"
  | "ribbon"
  | "other";

export interface SolutionComponent {
  id: string;
  name: string;
  displayName: string;
  type: ComponentType;
  solutionId: string;
  dependsOn: string[];
  metadata?: Record<string, unknown>;
}

// ─── Dataverse Table ──────────────────────────────────────
export interface DataverseTable {
  logicalName: string;
  displayName: string;
  schemaName: string;
  entitySetName: string;
  isCustomEntity: boolean;
  columns: DataverseColumn[];
  rowCount?: number;
}

export interface DataverseColumn {
  logicalName: string;
  displayName: string;
  attributeType: string;
  isPrimaryId: boolean;
  isPrimaryName: boolean;
  isCustomAttribute: boolean;
  requiredLevel: string;
  maxLength?: number;
  lookupTarget?: string;
}

// ─── Connection Reference ─────────────────────────────────
export interface ConnectionReference {
  id: string;
  connectionReferenceLogicalName: string;
  displayName: string;
  connectorId: string;
  connectionId?: string;
  status?: string;
}

export interface ConnectionMapping {
  sourceRef: ConnectionReference;
  targetConnectionId: string;
  targetConnectionName: string;
}

// ─── Environment Variable ─────────────────────────────────
export interface EnvironmentVariable {
  id: string;
  schemaName: string;
  displayName: string;
  type: "String" | "Number" | "Boolean" | "JSON" | "Data Source";
  defaultValue?: string;
  currentValue?: string;
}

export interface EnvironmentVariableMapping {
  variable: EnvironmentVariable;
  targetValue: string;
}

// ─── Security Role ────────────────────────────────────────
export interface SecurityRole {
  roleid: string;
  name: string;
  businessunitid: string;
  ismanaged: boolean;
  privileges: SecurityPrivilege[];
}

export interface SecurityPrivilege {
  name: string;
  privilegeid: string;
  accessRight: number;
  depth: number;
}

// ─── Migration ────────────────────────────────────────────
export type MigrationObjectType =
  | "solutions"
  | "tables"
  | "canvas_apps"
  | "model_driven_apps"
  | "cloud_flows"
  | "env_variables"
  | "connection_references"
  | "security_roles"
  | "choices"
  | "business_rules"
  | "bpfs";

export type ConflictResolution = "skip" | "upsert" | "overwrite";

export interface MigrationSelection {
  objectType: MigrationObjectType;
  enabled: boolean;
  items: string[];
  conflictResolution?: ConflictResolution;
}

export type MigrationItemStatus = "queued" | "in-progress" | "success" | "warning" | "failed" | "skipped";

export interface MigrationItemProgress {
  id: string;
  name: string;
  type: MigrationObjectType;
  status: MigrationItemStatus;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  errorDetails?: string;
}

export interface MigrationRun {
  id: string;
  name: string;
  sourceEnvironment: PowerPlatformEnvironment;
  targetEnvironment: PowerPlatformEnvironment;
  selections: MigrationSelection[];
  connectionMappings: ConnectionMapping[];
  envVariableMappings: EnvironmentVariableMapping[];
  items: MigrationItemProgress[];
  status: "pending" | "running" | "completed" | "completed-with-errors" | "failed" | "aborted" | "rolled-back";
  startedAt: string;
  completedAt?: string;
  snapshotId?: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  warningItems: number;
}

// ─── Migration Profile ────────────────────────────────────
export interface MigrationProfile {
  id: string;
  name: string;
  description?: string;
  sourceEnvironmentId: string;
  targetEnvironmentId: string;
  selections: MigrationSelection[];
  connectionMappings: ConnectionMapping[];
  envVariableMappings: EnvironmentVariableMapping[];
  createdAt: string;
  updatedAt: string;
}

// ─── Validation ───────────────────────────────────────────
export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationResult {
  component: string;
  componentType: MigrationObjectType;
  severity: ValidationSeverity;
  message: string;
  resolution?: string;
}

// ─── Dependency Graph ─────────────────────────────────────
export interface DependencyNode {
  id: string;
  label: string;
  type: ComponentType;
}

export interface DependencyEdge {
  source: string;
  target: string;
  label?: string;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

// ─── API ──────────────────────────────────────────────────
export interface ApiError {
  code: string;
  message: string;
  details?: string;
  retryable: boolean;
}

export interface PaginatedResponse<T> {
  value: T[];
  nextLink?: string;
  count?: number;
}
