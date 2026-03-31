"use client";

import { useMigrationWizardStore } from "@/lib/stores";
import { useAuth } from "@/lib/auth/auth-context";
import { StepConnect } from "./steps/step-connect";
import { StepSelect } from "./steps/step-select";
import { StepDependencies } from "./steps/step-dependencies";
import { StepValidation } from "./steps/step-validation";
import { StepMapping } from "./steps/step-mapping";
import { StepExecution } from "./steps/step-execution";
import { StepReport } from "./steps/step-report";
import { cn } from "@/lib/utils";
import {
  Plug,
  CheckSquare,
  GitBranch,
  ShieldCheck,
  ArrowRightLeft,
  Play,
  FileText,
} from "lucide-react";

const steps = [
  { label: "Connect", icon: Plug, description: "Authenticate & select environments" },
  { label: "Select", icon: CheckSquare, description: "Choose objects to migrate" },
  { label: "Dependencies", icon: GitBranch, description: "Analyze dependency graph" },
  { label: "Validate", icon: ShieldCheck, description: "Pre-migration checks" },
  { label: "Map", icon: ArrowRightLeft, description: "Remap connections & variables" },
  { label: "Execute", icon: Play, description: "Run Migration" },
  { label: "Report", icon: FileText, description: "Review results" },
];

export function MigrationWizard() {
  const currentStep = useMigrationWizardStore((s) => s.currentStep);
  const { isAuthenticated } = useAuth();

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <StepConnect />;
      case 1:
        return <StepSelect />;
      case 2:
        return <StepDependencies />;
      case 3:
        return <StepValidation />;
      case 4:
        return <StepMapping />;
      case 5:
        return <StepExecution />;
      case 6:
        return <StepReport />;
      default:
        return <StepConnect />;
    }
  };

  return (
    <div className="space-y-8">
      {/* Step Indicator */}
      <nav aria-label="Migration steps" className="w-full">
        <ol className="grid grid-cols-7 gap-2">
          {steps.map((step, index) => {
            const isActive = index === currentStep;
            const isCompleted = index < currentStep;
            const isDisabled = !isAuthenticated && index > 0;

            return (
              <li key={step.label}>
                <button
                  disabled={isDisabled}
                  onClick={() => {
                    if (!isDisabled && index <= currentStep) {
                      useMigrationWizardStore.getState().setCurrentStep(index);
                    }
                  }}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-lg border px-2 py-3 transition-all",
                    isActive
                      ? "border-primary bg-primary/5 shadow-sm"
                      : isCompleted
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-border opacity-60",
                    isDisabled && "cursor-not-allowed opacity-40"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : isCompleted
                        ? "bg-green-500 text-white"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {isCompleted ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <step.icon className="h-4 w-4" />
                    )}
                  </div>
                  <span className="text-xs font-semibold hidden sm:inline">{step.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step Content */}
      <div className="min-h-[500px]">{renderStep()}</div>
    </div>
  );
}
