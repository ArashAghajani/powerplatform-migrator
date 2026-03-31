import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { environmentUrl, solutionName, managed } = body as {
    environmentUrl: string;
    solutionName: string;
    managed: boolean;
  };

  if (!environmentUrl || !solutionName) {
    return NextResponse.json(
      { error: "environmentUrl and solutionName are required" },
      { status: 400 }
    );
  }

  // Validate inputs to prevent command injection
  if (!/^https:\/\/[a-zA-Z0-9._-]+\.(dynamics\.com|crm[0-9]*\.dynamics\.com)\/?$/.test(environmentUrl.replace(/\/$/, "") + "/")) {
    return NextResponse.json({ error: "Invalid environment URL" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(solutionName)) {
    return NextResponse.json({ error: "Invalid solution name" }, { status: 400 });
  }

  let tmpDir: string | null = null;
  let zipPath: string | null = null;

  try {
    tmpDir = await mkdtemp(join(tmpdir(), "pac-export-"));
    zipPath = join(tmpDir, `${solutionName}.zip`);

    const args = [
      "solution", "export",
      "--name", solutionName,
      "--path", zipPath,
      "--environment", environmentUrl.replace(/\/$/, ""),
      "--overwrite",
    ];
    if (managed) {
      args.push("--managed");
    }

    await execFileAsync("pac", args, {
      timeout: 600_000, // 10 min
      maxBuffer: 50 * 1024 * 1024,
    });

    const zipData = await readFile(zipPath);
    const base64 = zipData.toString("base64");

    return NextResponse.json({ solutionZipBase64: base64 });
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
