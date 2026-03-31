"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRightLeft,
  History,
  LayoutDashboard,
  Save,
  LogOut,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth/auth-context";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navItems = [
  { href: "/", label: "Migration Wizard", icon: ArrowRightLeft },
  { href: "/profiles", label: "Saved Profiles", icon: Save },
  { href: "/history", label: "Migration History", icon: History },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAuthenticated, account, logout } = useAuth();

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col">
        {/* Top Nav Bar */}
        <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-14 items-center px-6">
            <div className="flex items-center gap-2 mr-8">
              <LayoutDashboard className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold tracking-tight">
                Power Platform Migrator
              </span>
            </div>

            <nav className="flex items-center gap-1">
              {navItems.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              {isAuthenticated && account && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="max-w-[200px] truncate">
                          {account.name || account.username}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{account.username}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={logout}>
                        <LogOut className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Sign out</TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-6">{children}</div>
        </main>
      </div>
    </TooltipProvider>
  );
}
