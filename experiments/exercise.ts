/**
 * Exercise metadata and the pure apparatus helpers shared by the operational
 * exercise tool: which frozen spec files gate verify, the frozen paste
 * prompts, the spec tamper gate, and the corpus manifest check for the deep
 * exercise's seeded generator. The fixtures under `fixtures/<exercise>/` are
 * the single source of truth for template, reference, prompts, and spec
 * files; they are byte-copies of the LRU-81/82 apparatus.
 */

import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const EXERCISE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures")

export type ExerciseName = "rotator" | "deep"

export type Exercise = {
  name: ExerciseName
  templateDir: string
  referenceDir: string
  specFiles: readonly string[]
  workdirSpecFiles: readonly string[]
  pastePrompt: string
  entryModule: string
}

const PROMPT_ROTATOR =
  "Complete the coding task in /tmp/opencode/ab-work: read its README, implement until node --test is green, then summarize what you built. Do not modify anything under tests/; the spec files are frozen."
const PROMPT_DEEP =
  "Complete the coding task in /tmp/opencode/ab-work-deep: read its README and follow it exactly; the processing rules are scattered as directive records across the data/ archives, so collect every directive before implementing; implement src/importer.mjs until node --test is green, then summarize what you built including the reconciled directive table. Do not modify anything under tests/; the spec files are frozen. Do not use any memory tools (no qhaway or other memory reads or writes) during this session."

/**
 * Resolves an exercise's committed fixture layout by name.
 *
 * @param name the exercise name ("rotator" or "deep")
 * @returns the exercise's template/reference directories, the frozen spec
 *   files shared by both trees, the workdir-checked spec files (the shared
 *   list plus the template-only fence config for the deep exercise), the
 *   paste prompt, and the entry module path
 */
export const resolveExercise = (name: ExerciseName): Exercise => {
  const templateDir = join(EXERCISE_ROOT, name, "template")
  if (name === "rotator") {
    const specFiles = ["tests/rotator.test.mjs", "README.md", "package.json"] as const
    return {
      name,
      templateDir,
      referenceDir: join(EXERCISE_ROOT, name, "reference"),
      specFiles,
      workdirSpecFiles: specFiles,
      pastePrompt: PROMPT_ROTATOR,
      entryModule: "src/rotator.mjs",
    }
  }
  const specFiles = ["tests/importer.test.mjs", "README.md", "package.json"] as const
  return {
    name,
    templateDir,
    referenceDir: join(EXERCISE_ROOT, name, "reference"),
    specFiles,
    workdirSpecFiles: [...specFiles, ".opencode/opencode.json"],
    pastePrompt: PROMPT_DEEP,
    entryModule: "src/importer.mjs",
  }
}

export type SpecTamperResult = { ok: true } | { ok: false; file: string }

/**
 * The spec tamper gate: byte-compares the frozen spec files of the work tree
 * against the template. A missing template copy is an apparatus defect and
 * names the file; a missing or changed work copy means the solve touched the
 * spec and verify must fail.
 *
 * @param templateDir the pristine template directory
 * @param workDir the solve's work tree
 * @param specFiles the frozen spec files, repo-relative
 * @returns ok, or the first tampered (or missing) spec file
 */
export const checkSpecIntegrity = (templateDir: string, workDir: string, specFiles: readonly string[]): SpecTamperResult => {
  for (const rel of specFiles) {
    const templatePath = join(templateDir, rel)
    try {
      readFileSync(templatePath)
    } catch {
      return { ok: false, file: `${rel} (template missing: apparatus defect)` }
    }
    let workBytes: Buffer
    try {
      workBytes = readFileSync(join(workDir, rel))
    } catch {
      return { ok: false, file: rel }
    }
    if (!workBytes.equals(readFileSync(templatePath))) return { ok: false, file: rel }
  }
  return { ok: true }
}

/**
 * Byte manifest of a directory tree: sorted `sha256sum`-compatible lines
 * over the relative paths of every regular file. The determinism proof
 * compares two runs' manifests.
 *
 * @param root the tree root
 * @returns the manifest text (one `<hex>  <relpath>` line per file)
 */
export const treeManifest = (root: string): string => {
  const lines: string[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const absolute = join(dir, entry)
      const relative = prefix.length === 0 ? entry : `${prefix}/${entry}`
      if (statSync(absolute).isDirectory()) {
        walk(absolute, relative)
        continue
      }
      const digest = createHash("sha256").update(readFileSync(absolute)).digest("hex")
      lines.push(`${digest}  ${relative}`)
    }
  }
  walk(root, "")
  return lines.join("\n")
}

/**
 * Reads the deep exercise's committed corpus manifest (the frozen corpus
 * every regeneration must reproduce byte-for-byte).
 *
 * @returns the manifest text
 */
export const corpusManifest = (): string => readFileSync(join(EXERCISE_ROOT, "deep", "corpus-manifest.txt"), "utf8").trimEnd()
