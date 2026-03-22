import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startDocsWatcher } from "./sync-docs.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");
const nextBinaryName = process.platform === "win32" ? "next.cmd" : "next";
const nextBinaryPath = path.resolve(appDir, "node_modules/.bin", nextBinaryName);
const nextDevLockPath = path.resolve(appDir, ".next/dev/lock");

/**
 * `next dev` が異常終了したあとに stale lock が残ると再起動できなくなるため、起動前に掃除する。
 * もし本当に別プロセスが生きていても、最終的にはポート競合で停止するので整合性は保てる。
 */
async function clearStaleNextDevLock() {
  await rm(nextDevLockPath, { force: true });
}

/**
 * docs 同期 watcher と `next dev` を同じライフサイクルで動かす。
 * Markdown を `docs/` に追加しただけで、再起動なしに Nextra へ反映できる状態を作る。
 */
async function main() {
  await clearStaleNextDevLock();
  const stopDocsWatcher = await startDocsWatcher();
  let nextProcess;
  let shuttingDown = false;

  /**
   * 親プロセス終了時に watcher と `next dev` の両方を止める。
   * 監視だけがバックグラウンドに残る事故を防ぎ、次回起動を素直にするための後始末。
   */
  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
    await stopDocsWatcher();

    if (nextProcess && nextProcess.exitCode === null && nextProcess.signalCode === null) {
      nextProcess.kill(signal);
    }
  };

  const handleSigint = () => {
    void shutdown("SIGINT");
  };

  const handleSigterm = () => {
    void shutdown("SIGTERM");
  };

  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  try {
    nextProcess = spawn(nextBinaryPath, ["dev", "--webpack", ...process.argv.slice(2)], {
      cwd: appDir,
      stdio: "inherit"
    });

    const exitCode = await new Promise((resolve, reject) => {
      nextProcess.once("error", reject);
      nextProcess.once("exit", (code, signal) => {
        resolve(code ?? (signal ? 1 : 0));
      });
    });

    await shutdown("SIGTERM");
    process.exit(exitCode);
  } catch (error) {
    await shutdown("SIGTERM");
    throw error;
  }
}

main().catch((error) => {
  console.error("[docs-dev] Failed to start docs dev server.", error);
  process.exit(1);
});
