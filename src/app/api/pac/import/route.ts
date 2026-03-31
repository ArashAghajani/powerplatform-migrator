import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    environmentUrl,
    solutionZipBase64,
    forceOverwrite,
    publishChanges,
    async: isAsync,
  } = body as {
    environmentUrl: string;
    solutionZipBase64: string;
    forceOverwrite?: boolean;
    publishChanges?: boolean;
    async?: boolean;
  };

  if (!environmentUrl || !solutionZipBase64) {
    return NextResponse.json(
      { error: "environmentUrl and solutionZipBase64 are required" },
      { status: 400 }
    );
  }

  // Validate environment URL to prevent command injection
  if (!/^https:\/\/[a-zA-Z0-9._-]+\.(dynamics\.com|crm[0-9]*\.dynamics\.com)\/?$/.test(environmentUrl.replace(/\/$/, "") + "/")) {
    return NextResponse.json({ error: "Invalid environment URL" }, { status: 400 });
  }

  let tmpDir: string | null = null;
  let zipPath: string | null = null;

  try {
    tmpDir = await mkdtemp(join(tmpdir(), "pac-import-"));
    zipPath = join(tmpDir, "solution.zip");

    const zipBuffer = Buffer.from(solutionZipBase64, "base64");
    await writeFile(zipPath, zipBuffer);

    const args = [
      "solution", "import",
      "--path", zipPath,
      "--environment", environmentUrl.replace(/\/$/, ""),
    ];
    if (forceOverwrite !== false) {
      args.push("--force-overwrite");
    }
    if (publishChanges !== false) {
      args.push("--publish-changes");
    }
    if (isAsync !== false) {
      args.push("--async");
      args.push("--max-async-wait-time", "30");
    }
    args.push("--activate-plugins");

    const { stdout, stderr } = await execFileAsync("pac", args, {
      timeout: 1800_000, // 30 min for large solutions
      maxBuffer: 50 * 1024 * 1024,
    });

    const output = [stdout, stderr].filter(Boolean).join("\n");
    return NextResponse.json({ success: true, output });
  } catch (err: unknown) {
    // execFile throws with { stdout, stderr, message } on non-zero exit
    const execErr = err as { stderr?: string; stdout?: string; message?: string };
    const detail = execErr.stderr || execErr.stdout || execErr.message || String(err);
    return NextResponse.json({ error: detail }, { status: 500 });
  } finally {
    if (zipPath) {
      try { await unlink(zipPath); } catch { /* cleanup */ }
    }
    if (tmpDir) {
      try {
        const { rm } = await import("fs/promises");
        await rm(tmpDir, { recursive: true, force: true });
      } catch { /* cleanup */ }
    }
  }
}
