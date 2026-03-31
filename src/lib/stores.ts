import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  PowerPlatformEnvironment,
  Solution,
  SolutionComponent,
  DataverseTable,
  ConnectionReference,
  EnvironmentVariable,
  SecurityRole,
  MigrationSelection,
  MigrationObjectType,
  ConnectionMapping,
  EnvironmentVariableMapping,
  ValidationResult,
  MigrationRun,
  MigrationItemProgress,
  MigrationProfile,
  DependencyGraph,
  ConflictResolution,
  MigrationType,
} from "@/lib/types";

// ─── Environment Store ────────────────────────────────────
interface EnvironmentState {
  environments: PowerPlatformEnvironment[];
  sourceEnvironment: PowerPlatformEnvironment | null;
  targetEnvironment: PowerPlatformEnvironment | null;
  isLoading: boolean;
  migrationType: MigrationType;
  targetEnvironments: PowerPlatformEnvironment[];
  isLoadingTarget: boolean;
  setEnvironments: (envs: PowerPlatformEnvironment[]) => void;
  setSourceEnvironment: (env: PowerPlatformEnvironment | null) => void;
  setTargetEnvironment: (env: PowerPlatformEnvironment | null) => void;
  setIsLoading: (val: boolean) => void;
  setMigrationType: (type: MigrationType) => void;
  setTargetEnvironments: (envs: PowerPlatformEnvironment[]) => void;
  setIsLoadingTarget: (val: boolean) => void;
}

export const useEnvironmentStore = create<EnvironmentState>((set) => ({
  environments: [],
  sourceEnvironment: null,
  targetEnvironment: null,
  isLoading: false,
  migrationType: "same-tenant",
  targetEnvironments: [],
  isLoadingTarget: false,
  setEnvironments: (envs) => set({ environments: envs }),
  setSourceEnvironment: (env) => set({ sourceEnvironment: env }),
  setTargetEnvironment: (env) => set({ targetEnvironment: env }),
  setIsLoading: (val) => set({ isLoading: val }),
  setMigrationType: (type) => set({ migrationType: type }),
  setTargetEnvironments: (envs) => set({ targetEnvironments: envs }),
  setIsLoadingTarget: (val) => set({ isLoadingTarget: val }),
}));

// ─── Migration Wizard Store ───────────────────────────────
interface MigrationWizardState {
  currentStep: number;
  solutions: Solution[];
  components: SolutionComponent[];
  tables: DataverseTable[];
  connectionRefs: ConnectionReference[];
  envVariables: EnvironmentVariable[];
  securityRoles: SecurityRole[];
  selections: MigrationSelection[];
  connectionMappings: ConnectionMapping[];
  envVariableMappings: EnvironmentVariableMapping[];
  validationResults: ValidationResult[];
  dependencyGraph: DependencyGraph;
  isLoadingData: boolean;

  setCurrentStep: (step: number) => void;
  setSolutions: (sols: Solution[]) => void;
  setComponents: (comps: SolutionComponent[]) => void;
  setTables: (tables: DataverseTable[]) => void;
  setConnectionRefs: (refs: ConnectionReference[]) => void;
  setEnvVariables: (vars: EnvironmentVariable[]) => void;
  setSecurityRoles: (roles: SecurityRole[]) => void;
  setSelections: (selections: MigrationSelection[]) => void;
  toggleSelection: (type: MigrationObjectType, enabled: boolean) => void;
  updateSelectionItems: (type: MigrationObjectType, items: string[]) => void;
  updateConflictResolution: (type: MigrationObjectType, resolution: ConflictResolution) => void;
  setConnectionMappings: (mappings: ConnectionMapping[]) => void;
  setEnvVariableMappings: (mappings: EnvironmentVariableMapping[]) => void;
  setValidationResults: (results: ValidationResult[]) => void;
  setDependencyGraph: (graph: DependencyGraph) => void;
  setIsLoadingData: (val: boolean) => void;
  reset: () => void;
}

const defaultSelections: MigrationSelection[] = [
  { objectType: "solutions", enabled: false, items: [] },
  { objectType: "tables", enabled: false, items: [], conflictResolution: "upsert" },
  { objectType: "canvas_apps", enabled: false, items: [] },
  { objectType: "model_driven_apps", enabled: false, items: [] },
  { objectType: "cloud_flows", enabled: false, items: [] },
  { objectType: "env_variables", enabled: false, items: [] },
  { objectType: "connection_references", enabled: false, items: [] },
  { objectType: "security_roles", enabled: false, items: [] },
  { objectType: "choices", enabled: false, items: [] },
  { objectType: "business_rules", enabled: false, items: [] },
  { objectType: "bpfs", enabled: false, items: [] },
];

export const useMigrationWizardStore = create<MigrationWizardState>((set) => ({
  currentStep: 0,
  solutions: [],
  components: [],
  tables: [],
  connectionRefs: [],
  envVariables: [],
  securityRoles: [],
  selections: [...defaultSelections],
  connectionMappings: [],
  envVariableMappings: [],
  validationResults: [],
  dependencyGraph: { nodes: [], edges: [] },
  isLoadingData: false,

  setCurrentStep: (step) => set({ currentStep: step }),
  setSolutions: (sols) => set({ solutions: sols }),
  setComponents: (comps) => set({ components: comps }),
  setTables: (tables) => set({ tables }),
  setConnectionRefs: (refs) => set({ connectionRefs: refs }),
  setEnvVariables: (vars) => set({ envVariables: vars }),
  setSecurityRoles: (roles) => set({ securityRoles: roles }),
  setSelections: (selections) => set({ selections }),
  toggleSelection: (type, enabled) =>
    set((state) => ({
      selections: state.selections.map((s) =>
        s.objectType === type ? { ...s, enabled } : s
      ),
    })),
  updateSelectionItems: (type, items) =>
    set((state) => ({
      selections: state.selections.map((s) =>
        s.objectType === type ? { ...s, items } : s
      ),
    })),
  updateConflictResolution: (type, resolution) =>
    set((state) => ({
      selections: state.selections.map((s) =>
        s.objectType === type ? { ...s, conflictResolution: resolution } : s
      ),
    })),
  setConnectionMappings: (mappings) => set({ connectionMappings: mappings }),
  setEnvVariableMappings: (mappings) => set({ envVariableMappings: mappings }),
  setValidationResults: (results) => set({ validationResults: results }),
  setDependencyGraph: (graph) => set({ dependencyGraph: graph }),
  setIsLoadingData: (val) => set({ isLoadingData: val }),
  reset: () =>
    set({
      currentStep: 0,
      solutions: [],
      components: [],
      tables: [],
      connectionRefs: [],
      envVariables: [],
      securityRoles: [],
      selections: [...defaultSelections],
      connectionMappings: [],
      envVariableMappings: [],
      validationResults: [],
      dependencyGraph: { nodes: [], edges: [] },
      isLoadingData: false,
    }),
}));

// ─── Migration Execution Store ────────────────────────────
interface MigrationExecutionState {
  currentRun: MigrationRun | null;
  isRunning: boolean;
  setCurrentRun: (run: MigrationRun | null) => void;
  updateItemStatus: (itemId: string, status: MigrationItemProgress["status"], message?: string) => void;
  setIsRunning: (val: boolean) => void;
  incrementCompleted: () => void;
  incrementFailed: () => void;
  incrementWarning: () => void;
}

export const useMigrationExecutionStore = create<MigrationExecutionState>((set) => ({
  currentRun: null,
  isRunning: false,
  setCurrentRun: (run) => set({ currentRun: run }),
  updateItemStatus: (itemId, status, message) =>
    set((state) => {
      if (!state.currentRun) return {};
      return {
        currentRun: {
          ...state.currentRun,
          items: state.currentRun.items.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  status,
                  message,
                  ...(status === "in-progress" ? { startedAt: new Date().toISOString() } : {}),
                  ...(["success", "failed", "warning", "skipped"].includes(status)
                    ? { completedAt: new Date().toISOString() }
                    : {}),
                }
              : item
          ),
        },
      };
    }),
  setIsRunning: (val) => set({ isRunning: val }),
  incrementCompleted: () =>
    set((state) => ({
      currentRun: state.currentRun
        ? { ...state.currentRun, completedItems: state.currentRun.completedItems + 1 }
        : null,
    })),
  incrementFailed: () =>
    set((state) => ({
      currentRun: state.currentRun
        ? { ...state.currentRun, failedItems: state.currentRun.failedItems + 1 }
        : null,
    })),
  incrementWarning: () =>
    set((state) => ({
      currentRun: state.currentRun
        ? { ...state.currentRun, warningItems: state.currentRun.warningItems + 1 }
        : null,
    })),
}));

// ─── History Store (persisted) ────────────────────────────
interface HistoryState {
  runs: MigrationRun[];
  addRun: (run: MigrationRun) => void;
  updateRun: (run: MigrationRun) => void;
  removeRun: (id: string) => void;
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      runs: [],
      addRun: (run) => set((state) => ({ runs: [run, ...state.runs] })),
      updateRun: (run) =>
        set((state) => ({
          runs: state.runs.map((r) => (r.id === run.id ? run : r)),
        })),
      removeRun: (id) =>
        set((state) => ({ runs: state.runs.filter((r) => r.id !== id) })),
      clearHistory: () => set({ runs: [] }),
    }),
    { name: "migration-history" }
  )
);

// ─── Profiles Store (persisted) ───────────────────────────
interface ProfilesState {
  profiles: MigrationProfile[];
  addProfile: (profile: MigrationProfile) => void;
  updateProfile: (profile: MigrationProfile) => void;
  removeProfile: (id: string) => void;
}

export const useProfilesStore = create<ProfilesState>()(
  persist(
    (set) => ({
      profiles: [],
      addProfile: (profile) =>
        set((state) => ({ profiles: [profile, ...state.profiles] })),
      updateProfile: (profile) =>
        set((state) => ({
          profiles: state.profiles.map((p) => (p.id === profile.id ? profile : p)),
        })),
      removeProfile: (id) =>
        set((state) => ({
          profiles: state.profiles.filter((p) => p.id !== id),
        })),
    }),
    { name: "migration-profiles" }
  )
);

// ─── Snapshot Store ───────────────────────────────────────
interface SnapshotEntry {
  id: string;
  solutionName: string;
  timestamp: string;
  data: ArrayBuffer | null;
}

interface SnapshotState {
  snapshots: SnapshotEntry[];
  addSnapshot: (snapshot: SnapshotEntry) => void;
  removeSnapshot: (id: string) => void;
  getSnapshot: (id: string) => SnapshotEntry | undefined;
}

export const useSnapshotStore = create<SnapshotState>((set, get) => ({
  snapshots: [],
  addSnapshot: (snapshot) =>
    set((state) => ({ snapshots: [snapshot, ...state.snapshots] })),
  removeSnapshot: (id) =>
    set((state) => ({
      snapshots: state.snapshots.filter((s) => s.id !== id),
    })),
  getSnapshot: (id) => get().snapshots.find((s) => s.id === id),
}));
