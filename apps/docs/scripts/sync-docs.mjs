import { access, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = path.resolve(__dirname, "../../../docs");
const pagesDir = path.resolve(__dirname, "../pages");
const docsTargetDir = path.resolve(pagesDir, "docs");
const sourceHomeCandidates = ["index.mdx", "index.md"];
const targetHomeFileName = "index.mdx";
const docsSectionLabel = "Docs";
const homePageLabel = "Home";
const pollIntervalMs = 500;
const watchDebounceMs = 120;

async function assertSourceDirectoryExists(dirPath) {
  // docs ソースが存在しないまま起動すると空のサイトになるため、明示的に停止する。
  try {
    await access(dirPath);
  } catch {
    throw new Error(`Docs source directory was not found: ${dirPath}`);
  }
}

/**
 * docs ルートでトップページとして扱うファイルを返す。
 * `index.mdx` を優先しつつ、既存 Markdown をそのまま使えるよう `index.md` も許可する。
 */
async function resolveSourceHomeFileName(dirPath) {
  for (const candidateFileName of sourceHomeCandidates) {
    try {
      await access(path.resolve(dirPath, candidateFileName));
      return candidateFileName;
    } catch {
      continue;
    }
  }

  throw new Error(`Docs home page was not found in ${dirPath}. Expected one of: ${sourceHomeCandidates.join(", ")}`);
}

/**
 * JSON ファイルを書き出す。
 * Nextra の `_meta.json` を毎回同じフォーマットで生成し、差分を読みやすくする。
 */
async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function shouldIgnoreEntry(entryName) {
  return entryName === ".DS_Store";
}

function stripMarkdownExtension(entryName) {
  return entryName.replace(/\.(md|mdx)$/u, "");
}

function isMarkdownFileName(entryName) {
  return /\.(md|mdx)$/u.test(entryName);
}

/**
 * ファイル名をナビゲーション表示用のラベルへ変換する。
 * `_meta.json` がないディレクトリでも最低限読める見出しを自動生成するために使う。
 */
function toTitleLabel(entryName) {
  const normalizedName = stripMarkdownExtension(entryName).replace(/[-_]/gu, " ").trim();

  if (!normalizedName) {
    return entryName;
  }

  return normalizedName.replace(/\b\w/gu, (character) => character.toUpperCase());
}

/**
 * ディレクトリ配下の表示順メタ情報を組み立てる。
 * source 側に `_meta.json` があれば優先し、未定義の Markdown や子ディレクトリだけ補完する。
 */
async function createDirectoryMeta(dirPath) {
  const metaPath = path.resolve(dirPath, "_meta.json");
  let meta = {};

  try {
    meta = JSON.parse(await readFile(metaPath, "utf8"));
  } catch {
    meta = {};
  }

  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldIgnoreEntry(entry.name) || entry.name === "_meta.json") {
      continue;
    }

    if (entry.isDirectory()) {
      meta[entry.name] ??= toTitleLabel(entry.name);
      continue;
    }

    if (!isMarkdownFileName(entry.name)) {
      continue;
    }

    meta[stripMarkdownExtension(entry.name)] ??= toTitleLabel(entry.name);
  }

  return meta;
}

/**
 * docs ルートを `pages/docs` へ丸ごと複製する。
 * コンテンツの正本を `docs/` に固定し、配信用ディレクトリは毎回生成し直す。
 */
async function syncDocsDirectory(sourcePath, targetPath) {
  await rm(targetPath, { recursive: true, force: true });
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true });
}

/**
 * docs ルートの index をサイトトップページへ複製する。
 * `/docs` と `/` の両方から同じ導入ページへ辿れるようにして、初期導線を揃える。
 */
async function syncHomePage(sourcePath, targetPath) {
  const sourceHomeFileName = await resolveSourceHomeFileName(sourcePath);
  const homePageContent = await readFile(path.resolve(sourcePath, sourceHomeFileName), "utf8");
  await writeFile(path.resolve(targetPath, targetHomeFileName), homePageContent);
}

/**
 * サイトの最上位ナビゲーションを生成する。
 * ルートは Home と Docs だけに絞り、ドキュメント本文の構造は `pages/docs` 側へ委ねる。
 */
async function syncPagesRootMeta(sourcePath) {
  const sourceMeta = await createDirectoryMeta(sourcePath);

  await writeJsonFile(path.resolve(pagesDir, "_meta.json"), {
    index: homePageLabel,
    docs: sourceMeta.index ?? docsSectionLabel
  });
}

/**
 * docs 配下の全ディレクトリへ `_meta.json` を補完する。
 * source に `_meta.json` がなくても、Nextra のサイドバーが最低限崩れない状態を維持する。
 */
async function syncDirectoryMetaRecursively(sourcePath, targetPath) {
  await writeJsonFile(path.resolve(targetPath, "_meta.json"), await createDirectoryMeta(sourcePath));

  const entries = await readdir(sourcePath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || shouldIgnoreEntry(entry.name)) {
      continue;
    }

    await syncDirectoryMetaRecursively(
      path.resolve(sourcePath, entry.name),
      path.resolve(targetPath, entry.name)
    );
  }
}

/**
 * `docs/` を Nextra 用の `pages/` ツリーへ同期する。
 * dev と build の両方で同じ規則を使い回し、環境差分で表示が変わる事故を防ぐ。
 */
export async function syncDocsTree() {
  await assertSourceDirectoryExists(sourceDir);
  await mkdir(pagesDir, { recursive: true });
  await syncDocsDirectory(sourceDir, docsTargetDir);
  await syncDirectoryMetaRecursively(sourceDir, docsTargetDir);
  await syncHomePage(sourceDir, pagesDir);
  await syncPagesRootMeta(sourceDir);

  console.log(`Synced docs: ${sourceDir} -> ${pagesDir}`);
}

function shouldIgnoreWatchPath(relativePath) {
  return !relativePath || relativePath.includes(".DS_Store");
}

/**
 * `docs/` 配下の状態比較に使うシグネチャ要素を再帰的に集める。
 * watch API 依存を避け、更新時刻とサイズを使ったポーリングで安定して差分検知する。
 */
async function collectSourceSignatureEntries(rootDir, signatureEntries) {
  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.resolve(rootDir, entry.name);
    const relativePath = path.relative(sourceDir, entryPath);

    if (shouldIgnoreWatchPath(relativePath)) {
      continue;
    }

    const entryStat = await stat(entryPath);
    const normalizedPath = relativePath || ".";
    const sizeMarker = entry.isFile() ? entryStat.size : 0;

    signatureEntries.push(
      `${entry.isDirectory() ? "dir" : "file"}:${normalizedPath}:${entryStat.mtimeMs}:${sizeMarker}`
    );

    if (entry.isDirectory()) {
      await collectSourceSignatureEntries(entryPath, signatureEntries);
    }
  }
}

/**
 * `docs/` 配下の現在状態を比較用文字列へ変換する。
 * 監視イベントの取りこぼしがある環境でも、保存後に必ず再同期へ到達できるようにする。
 */
async function createSourceSignature(rootDir) {
  const signatureEntries = [];
  await collectSourceSignatureEntries(rootDir, signatureEntries);
  return signatureEntries.sort().join("\n");
}

/**
 * docs 変更を監視し、保存後に Nextra 向け生成物を再同期する。
 * Next.js 側は `pages` の更新だけ見ればよいので、ここで docs 正本との橋渡しを担う。
 */
export async function startDocsWatcher() {
  await syncDocsTree();

  let debounceTimer;
  let stopped = false;
  let latestReason = "unknown";
  let latestSignature = await createSourceSignature(sourceDir);
  let pendingSync = Promise.resolve();

  const queueSync = (reason) => {
    latestReason = reason;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      pendingSync = pendingSync.then(async () => {
        if (stopped) {
          return;
        }

        await syncDocsTree();
        console.log(`[sync-docs] Re-synced after: ${latestReason}`);
      });

      pendingSync = pendingSync.catch((error) => {
        console.error("[sync-docs] Failed to sync docs after a change.", error);
      });
    }, watchDebounceMs);
  };

  const pollTimer = setInterval(() => {
    void (async () => {
      try {
        const nextSignature = await createSourceSignature(sourceDir);

        if (nextSignature === latestSignature) {
          return;
        }

        latestSignature = nextSignature;
        queueSync("docs source updated");
      } catch (error) {
        console.error("[sync-docs] Failed to inspect docs source.", error);
      }
    })();
  }, pollIntervalMs);

  return async function stopDocsWatcher() {
    stopped = true;
    clearTimeout(debounceTimer);
    clearInterval(pollTimer);
    await pendingSync;
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncDocsTree().catch((error) => {
    console.error("[sync-docs] Failed to sync docs.", error);
    process.exit(1);
  });
}
