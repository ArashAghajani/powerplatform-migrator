import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

/**
 * GET /api/pac/install — Check PAC CLI & .NET SDK status
 */
export async function GET() {
  const status = {
    pacInstalled: false,
    dotnetInstalled: false,
    platform: process.platform,
    pacPath: "",
    dotnetVersion: "",
  };

  // Check if pac is in PATH
  try {
    const { stdout } = await execFileAsync("pac", ["--version"], { timeout: 10_000 });
    status.pacInstalled = true;
    status.pacPath = stdout.trim();
  } catch {
    // Also check in .dotnet/tools (might not be in PATH for the server process)
    try {
      const toolsPath = join(homedir(), ".dotnet", "tools", "pac");
      const { stdout } = await execFileAsync(toolsPath, ["--version"], { timeout: 10_000 });
      status.pacInstalled = true;
      status.pacPath = toolsPath + " (" + stdout.trim() + ")";
      // Add .dotnet/tools to PATH for this process so subsequent pac calls work
      process.env.PATH = `${join(homedir(), ".dotnet", "tools")}:${process.env.PATH}`;
    } catch {
      // PAC not found anywhere
    }
  }

  // Check if dotnet is available
  try {
    const { stdout } = await execFileAsync("dotnet", ["--version"], { timeout: 10_000 });
    status.dotnetInstalled = true;
    status.dotnetVersion = stdout.trim();
  } catch {
    // .NET SDK not found
  }

  return NextResponse.json(status);
}

/**
 * POST /api/pac/install — Install PAC CLI via dotnet tool
 */
export async function POST() {
  // Step 1: Check if pac is already installed
  try {
    await execFileAsync("pac", ["--version"], { timeout: 10_000 });
    return NextResponse.json({
      success: true,
      message: "PAC CLI is already installed.",
      alreadyInstalled: true,
    });
  } catch {
    // Also check .dotnet/tools
    try {
      const toolsPath = join(homedir(), ".dotnet", "tools", "pac");
      await execFileAsync(toolsPath, ["--version"], { timeout: 10_000 });
      process.env.PATH = `${join(homedir(), ".dotnet", "tools")}:${process.env.PATH}`;
      return NextResponse.json({
        success: true,
        message: "PAC CLI found in .dotnet/tools. PATH updated for this session.",
        alreadyInstalled: true,
      });
    } catch {
      // Not installed, proceed with installation
    }
  }

  // Step 2: Check if .NET SDK is available
  let dotnetAvailable = false;
  try {
    await execFileAsync("dotnet", ["--version"], { timeout: 10_000 });
    dotnetAvailable = true;
  } catch {
    // .NET SDK not found
  }

  if (!dotnetAvailable) {
    return NextResponse.json({
      success: false,
      message:
        ".NET SDK is not installed. PAC CLI requires .NET SDK 6.0 or later.\n\n" +
        (process.platform === "darwin"
          ? "Install via: brew install dotnet\nOr download from: https://dotnet.microsoft.com/download"
          : process.platform === "win32"
            ? "Install via: winget install Microsoft.DotNet.SDK.8\nOr download from: https://dotnet.microsoft.com/download"
            : "Install via your package manager (e.g., apt install dotnet-sdk-8.0)\nOr download from: https://dotnet.microsoft.com/download"),
      requiresDotnet: true,
    });
  }

  // Step 3: Install PAC CLI via dotnet tool
  try {
    const { stdout, stderr } = await execFileAsync(
      "dotnet",
      ["tool", "install", "--global", "Microsoft.PowerApps.CLI.Tool"],
      { timeout: 120_000 }
    );

    // Ensure .dotnet/tools is in PATH for this process
    const toolsDir = join(homedir(), ".dotnet", "tools");
    if (!process.env.PATH?.includes(toolsDir)) {
      process.env.PATH = `${toolsDir}:${process.env.PATH}`;
    }

    // Verify installation
    try {
      const { stdout: version } = await execFileAsync("pac", ["--version"], { timeout: 10_000 });
      return NextResponse.json({
        success: true,
        message: `PAC CLI installed successfully (${version.trim()}).`,
        output: [stdout, stderr].filter(Boolean).join("\n"),
      });
    } catch {
      // Try from tools dir directly
      try {
        const pacPath = join(toolsDir, "pac");
        const { stdout: version } = await execFileAsync(pacPath, ["--version"], { timeout: 10_000 });
        return NextResponse.json({
          success: true,
          message: `PAC CLI installed successfully (${version.trim()}). You may need to restart your terminal for the PATH to update.`,
          output: [stdout, stderr].filter(Boolean).join("\n"),
        });
      } catch {
        return NextResponse.json({
          success: true,
          message: "PAC CLI installed but may not be in your PATH. Restart the dev server for changes to take effect.",
          output: [stdout, stderr].filter(Boolean).join("\n"),
        });
      }
    }
  } catch (err) {
    // If already installed, try updating instead
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("already installed")) {
      try {
        const { stdout, stderr } = await execFileAsync(
          "dotnet",
          ["tool", "update", "--global", "Microsoft.PowerApps.CLI.Tool"],
          { timeout: 120_000 }
        );

        const toolsDir = join(homedir(), ".dotnet", "tools");
        if (!process.env.PATH?.includes(toolsDir)) {
          process.env.PATH = `${toolsDir}:${process.env.PATH}`;
        }

        return NextResponse.json({
          success: true,
          message: "PAC CLI updated successfully.",
          output: [stdout, stderr].filter(Boolean).join("\n"),
        });
      } catch (updateErr) {
        return NextResponse.json({
          success: false,
          message: `Failed to update PAC CLI: ${updateErr instanceof Error ? updateErr.message : String(updateErr)}`,
        });
      }
    }

    return NextResponse.json({
      success: false,
      message: `Failed to install PAC CLI: ${errMsg}`,
    });
  }
}
