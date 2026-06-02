import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { clampInteger } from "./helpers.js";

export interface CodeConnectScanOptions {
  fileKey: string;
  nodeId?: string;
  componentKey?: string;
  rootDir?: string;
  cwd: string;
  maxMatches?: number;
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface CodeConnectMatch {
  path: string;
  line: number;
  kind:
    | "figma-connect"
    | "figma-config"
    | "figma-file-reference"
    | "figma-node-reference"
    | "component-key-reference";
  preview: string;
}

export interface CodeConnectScanResult {
  rootDir: string;
  matches: CodeConnectMatch[];
  metadata: {
    truncated: boolean;
    truncatedReasons: string[];
    nextSteps: string[];
  };
}

const IGNORE_DIRS: Record<string, true> = {
  node_modules: true,
  dist: true,
  build: true,
  ".git": true,
  coverage: true,
  ".next": true,
  ".turbo": true,
  ".cache": true,
};

const DEFAULT_MAX_MATCHES = 40;
const DEFAULT_MAX_FILES = 1500;
const DEFAULT_MAX_FILE_BYTES = 300_000;

export async function findCodeConnectMapping(
  options: CodeConnectScanOptions,
): Promise<CodeConnectScanResult> {
  const rootDir = resolveRoot(options.cwd, options.rootDir);
  const maxMatches = clampInteger(
    options.maxMatches ?? DEFAULT_MAX_MATCHES,
    1,
    200,
  );
  const maxFiles = clampInteger(
    options.maxFiles ?? DEFAULT_MAX_FILES,
    1,
    10_000,
  );
  const maxFileBytes = clampInteger(
    options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    1_000,
    2_000_000,
  );
  const normalizedNodeId = options.nodeId?.replace(/-/g, ":");
  const urlNodeId = normalizedNodeId?.replace(/:/g, "-");
  const matches: CodeConnectMatch[] = [];
  const truncatedReasons: string[] = [];
  let filesSeen = 0;

  async function scanDir(dir: string): Promise<void> {
    if (filesSeen >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (filesSeen >= maxFiles || matches.length >= maxMatches) return;
      if (entry in IGNORE_DIRS) continue;
      if (entry.startsWith(".")) continue;
      const fullPath = join(dir, entry);
      let st;
      try {
        st = await stat(fullPath);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        await scanDir(fullPath);
      } else if (
        st.isFile() &&
        isLikelySource(entry) &&
        st.size <= maxFileBytes
      ) {
        filesSeen += 1;
        await scanFile(fullPath);
      }
    }
  }

  async function scanFile(filePath: string): Promise<void> {
    if (matches.length >= maxMatches) return;
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxMatches) break;
      const line = lines[i];
      const kinds = classify(
        line,
        filePath,
        options.fileKey,
        normalizedNodeId,
        urlNodeId,
        options.componentKey,
      );
      for (const kind of kinds) {
        if (matches.length >= maxMatches) break;
        matches.push({
          path: relative(rootDir, filePath),
          line: i + 1,
          kind,
          preview: line.trim().slice(0, 200),
        });
      }
    }
  }

  await scanDir(rootDir);

  if (filesSeen >= maxFiles) {
    truncatedReasons.push(
      `Reached maxFiles ${maxFiles}; additional files were not scanned.`,
    );
  }
  if (matches.length >= maxMatches) {
    truncatedReasons.push(
      `Reached maxMatches ${maxMatches}; additional matches were omitted.`,
    );
  }

  const nextSteps = matches.length
    ? [
        "Open matched files to inspect local component props and implementation conventions.",
      ]
    : [
        "No local Code Connect mapping was found; use Figma implementation context and existing component search next.",
      ];
  if (truncatedReasons.length)
    nextSteps.push(
      "Narrow rootDir or raise maxMatches/maxFiles if you expect more mappings.",
    );

  return {
    rootDir,
    matches,
    metadata: {
      truncated: truncatedReasons.length > 0,
      truncatedReasons: [...new Set(truncatedReasons)],
      nextSteps,
    },
  };
}

function classify(
  line: string,
  filePath: string,
  fileKey: string,
  nodeId?: string,
  urlNodeId?: string,
  componentKey?: string,
): Array<CodeConnectMatch["kind"]> {
  const kinds: Array<CodeConnectMatch["kind"]> = [];
  if (
    line.includes("figma.connect(") ||
    line.includes("codeConnect") ||
    line.includes("figma_code_connect")
  ) {
    kinds.push("figma-connect");
  }
  if (
    line.includes("figma.config") ||
    line.includes('"figma"') ||
    line.includes("'figma'")
  ) {
    kinds.push("figma-config");
  }
  if (fileKey && line.includes(fileKey)) {
    kinds.push("figma-file-reference");
  }
  if (
    nodeId &&
    line.includes(nodeId)
  ) {
    kinds.push("figma-node-reference");
  }
  if (
    urlNodeId &&
    line.includes(urlNodeId)
  ) {
    kinds.push("figma-node-reference");
  }
  if (
    componentKey &&
    line.includes(componentKey)
  ) {
    kinds.push("component-key-reference");
  }
  return kinds;
}

function resolveRoot(cwd: string, rootDir?: string): string {
  if (rootDir) {
    return isAbsolute(rootDir) ? rootDir : resolve(cwd, rootDir);
  }
  return cwd;
}

function isLikelySource(name: string): boolean {
  return /(?:figma\.config\..*|\.figma\..*|\.(tsx?|jsx?|vue|svelte|mdx?|json|ya?ml))$/i.test(
    name,
  );
}
