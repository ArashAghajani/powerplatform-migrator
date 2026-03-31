"use client";

import { useState } from "react";
import {
  useProfilesStore,
  useMigrationWizardStore,
  useEnvironmentStore,
} from "@/lib/stores";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Save,
  Play,
  Trash2,
  Plus,
  Clock,
  Package,
  FolderOpen,
} from "lucide-react";
import type { MigrationProfile } from "@/lib/types";

export default function ProfilesPage() {
  const { profiles, addProfile, removeProfile } = useProfilesStore();
  const wizardStore = useMigrationWizardStore();
  const envStore = useEnvironmentStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const saveCurrentAsProfile = () => {
    if (!newName.trim()) return;

    const profile: MigrationProfile = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      description: newDescription.trim() || undefined,
      sourceEnvironmentId: envStore.sourceEnvironment?.id || "",
      targetEnvironmentId: envStore.targetEnvironment?.id || "",
      selections: wizardStore.selections.filter((s) => s.enabled),
      connectionMappings: wizardStore.connectionMappings,
      envVariableMappings: wizardStore.envVariableMappings,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    addProfile(profile);
    setNewName("");
    setNewDescription("");
    setDialogOpen(false);
  };

  const loadProfile = (profile: MigrationProfile) => {
    // Set selections
    const allSelections = wizardStore.selections.map((s) => {
      const profileSel = profile.selections.find((ps) => ps.objectType === s.objectType);
      return profileSel || { ...s, enabled: false };
    });
    wizardStore.setSelections(allSelections);
    wizardStore.setConnectionMappings(profile.connectionMappings);
    wizardStore.setEnvVariableMappings(profile.envVariableMappings);

    // Set environments if available
    const source = envStore.environments.find((e) => e.id === profile.sourceEnvironmentId);
    const target = envStore.environments.find((e) => e.id === profile.targetEnvironmentId);
    if (source) envStore.setSourceEnvironment(source);
    if (target) envStore.setTargetEnvironment(target);

    // Navigate to wizard step 1
    wizardStore.setCurrentStep(0);
    window.location.href = "/";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Migration Profiles</h1>
          <p className="text-muted-foreground">
            Save and reuse migration configurations for repeatable workflows
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Save Current Config
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save Migration Profile</DialogTitle>
              <DialogDescription>
                Save the current migration wizard configuration as a reusable profile
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Profile Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Dev → Staging Full Migration"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description (optional)</Label>
                <Textarea
                  id="desc"
                  placeholder="Describe what this profile migrates..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveCurrentAsProfile} disabled={!newName.trim()}>
                <Save className="mr-2 h-4 w-4" />
                Save Profile
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {profiles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <FolderOpen className="h-16 w-16 text-muted-foreground" />
            <div className="text-center">
              <h3 className="font-semibold">No Saved Profiles</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Configure a migration in the wizard, then save it as a profile for quick re-use.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[calc(100vh-200px)]">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {profiles.map((profile) => (
              <Card key={profile.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base">{profile.name}</CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removeProfile(profile.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {profile.description && (
                    <CardDescription>{profile.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {profile.selections.map((sel) => (
                      <Badge key={sel.objectType} variant="secondary" className="text-[10px]">
                        <Package className="mr-1 h-3 w-3" />
                        {sel.objectType.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Created {new Date(profile.createdAt).toLocaleDateString()}
                  </div>
                  {profile.connectionMappings.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {profile.connectionMappings.length} connection mappings
                    </div>
                  )}
                </CardContent>
                <CardFooter>
                  <Button className="w-full" size="sm" onClick={() => loadProfile(profile)}>
                    <Play className="mr-2 h-4 w-4" />
                    Load & Run
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
