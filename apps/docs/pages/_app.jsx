import "nextra-theme-docs/style.css";
import "../styles/docs-overrides.css";

const nextraInternalSymbol = Symbol.for("__nextra_internal__");
const projectPageOrder = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12"
];

function toProjectMetaKey(projectId) {
  return `project${projectId}`;
}

/**
 * Nextra は `_meta.json` の数値キーを JavaScript の仕様どおり並べ替えるため、
 * `10, 11, 12, 01...` の順で案件が見えてしまう。
 * route はそのままに、projects 配下だけ `pageMap` 上の name / meta key を
 * 非数値キーへ置き換えて、概要と同じ並び順を維持する。
 */
function normalizeProjectsChildren(children) {
  return children.map((child) => {
    if (child.kind === "Meta") {
      const otherEntries = Object.entries(child.data).filter(
        ([key]) => !projectPageOrder.includes(key)
      );
      const orderedProjectEntries = projectPageOrder.flatMap((projectId) => (
        projectId in child.data
          ? [[toProjectMetaKey(projectId), child.data[projectId]]]
          : []
      ));

      return {
        ...child,
        data: Object.fromEntries([...otherEntries, ...orderedProjectEntries])
      };
    }

    const matchedProjectId = child.route?.match(/^\/projects\/(\d{2})$/u)?.[1];

    if (!matchedProjectId) {
      return child;
    }

    return {
      ...child,
      name: toProjectMetaKey(matchedProjectId)
    };
  });
}

function normalizeProjectsPageMap(items) {
  return items.map((item) => {
    if (item.kind !== "Folder") {
      return item;
    }

    const normalizedChildren = normalizeProjectsPageMap(item.children);

    if (item.name !== "projects") {
      return {
        ...item,
        children: normalizedChildren
      };
    }

    return {
      ...item,
      children: normalizeProjectsChildren(normalizedChildren)
    };
  });
}

export default function App({ Component, pageProps }) {
  // Nextra はページモジュール初期化時に pageMap を内部コンテキストへ埋め込むため、
  // `_app` では props ではなく内部保持された pageMap を更新する必要がある。
  const nextraInternal = globalThis[nextraInternalSymbol];

  if (nextraInternal?.pageMap) {
    nextraInternal.pageMap = normalizeProjectsPageMap(nextraInternal.pageMap);
  }

  if (nextraInternal?.context) {
    for (const context of Object.values(nextraInternal.context)) {
      if (context.pageOpts?.pageMap) {
        context.pageOpts.pageMap = normalizeProjectsPageMap(context.pageOpts.pageMap);
      }
    }
  }

  return <Component {...pageProps} />;
}
