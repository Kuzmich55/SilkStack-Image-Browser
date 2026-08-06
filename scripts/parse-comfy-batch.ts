#!/usr/bin/env node
/**
 * parse-comfy-batch.ts
 *
 * Batch-process multiple ComfyUI workflow JSON files from a directory.
 * Outputs JSONL (one JSON object per line) by default, or a JSON array.
 *
 * Usage:
 *   tsx scripts/parse-comfy-batch.ts <directory>
 *   tsx scripts/parse-comfy-batch.ts <directory> --recursive
 *   tsx scripts/parse-comfy-batch.ts <directory> --out results.jsonl
 *   tsx scripts/parse-comfy-batch.ts <directory> --summary        (aggregate stats only)
 *   tsx scripts/parse-comfy-batch.ts <directory> --array           (output JSON array instead of JSONL)
 *
 *   # Via npm scripts:
 *   npm run comfy:batch -- <directory>
 *   npm run comfy:batch -- <directory> --recursive --summary
 */

import { Command } from 'commander';
import { readFileSync, createWriteStream, existsSync, statSync } from 'fs';
import { readdir } from 'fs/promises';
import { resolve, basename, extname, join } from 'path';
import { resolvePromptFromGraph } from '../src/services/parsers/comfyUIParser';

// ── Debug suppression ─────────────────────────────────────────────────────────
// The ComfyUI parser emits debug logs via console.log. Since this CLI writes
// JSON to stdout, we temporarily suppress console.log during parsing.
function suppressDebugLogs<T>(fn: () => T): T {
  const originalLog = console.log;
  const originalDebug = console.debug;
  console.log = () => {};
  console.debug = () => {};
  try {
    return fn();
  } finally {
    console.log = originalLog;
    console.debug = originalDebug;
  }
}

const program = new Command();

interface ParseEntry {
  file: string;
  success: boolean;
  error?: string;
  model: string | null;
  vae: string | null;
  loras: Array<{ name: string; modelStrength?: number; clipStrength?: number }>;
  sampler: string | null;
  scheduler: string | null;
  steps: number | null;
  cfg: number | null;
  seed: number | null;
  prompt: string | null;
  negative_prompt: string | null;
  denoise: number | null;
  controlnets: any[];
  comfyui_version: string | null;
}

function parseSingleWorkflow(filePath: string): ParseEntry {
  const fileName = basename(filePath);

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    let workflow = data.workflow;
    let prompt = data.prompt;

    // Handle API-format JSON
    if (!workflow && !prompt) {
      const hasClassType = Object.values(data).some(
        (v: any) => v && typeof v === 'object' && 'class_type' in v
      );
      if (hasClassType) {
        prompt = data;
        workflow = { nodes: [] };
      } else {
        return {
          file: fileName,
          success: false,
          error: 'Not a ComfyUI workflow (no "workflow" or "prompt" section)',
          model: null, vae: null, loras: [], sampler: null, scheduler: null,
          steps: null, cfg: null, seed: null, prompt: null, negative_prompt: null,
          denoise: null, controlnets: [], comfyui_version: null,
        };
      }
    }

    if (typeof workflow === 'string') {
      try { workflow = JSON.parse(workflow.replace(/: NaN/g, ': null')); }
      catch { workflow = { nodes: [] }; }
    }
    if (typeof prompt === 'string') {
      try { prompt = JSON.parse(prompt.replace(/: NaN/g, ': null')); }
      catch { /* keep as-is */ }
    }

    const result = suppressDebugLogs(() => resolvePromptFromGraph(workflow, prompt));

    return {
      file: fileName,
      success: true,
      model: result.model || null,
      vae: result.vae || result.vaes?.[0]?.name || null,
      loras: (result.loras && result.loras.length > 0)
        ? result.loras
        : (result.lora && Array.isArray(result.lora)
            ? result.lora.map((n: string) => ({ name: n }))
            : []),
      sampler: result.sampler_name ?? null,
      scheduler: result.scheduler ?? null,
      steps: result.steps ?? null,
      cfg: result.cfg ?? null,
      seed: result.seed ?? null,
      prompt: result.prompt || null,
      negative_prompt: result.negativePrompt || null,
      denoise: result.denoise ?? null,
      controlnets: result.controlnets || [],
      comfyui_version: result.comfyui_version || null,
    };
  } catch (error) {
    return {
      file: fileName,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      model: null, vae: null, loras: [], sampler: null, scheduler: null,
      steps: null, cfg: null, seed: null, prompt: null, negative_prompt: null,
      denoise: null, controlnets: [], comfyui_version: null,
    };
  }
}

async function collectJsonFiles(dir: string, recursive: boolean): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      try {
        const nested = await collectJsonFiles(fullPath, recursive);
        results.push(...nested);
      } catch { /* skip inaccessible directories */ }
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') {
      results.push(fullPath);
    }
  }

  return results;
}

interface SummaryStats {
  total_files: number;
  successful: number;
  failed: number;
  unique_models: string[];
  unique_loras: string[];
  unique_vaes: string[];
  unique_samplers: string[];
  unique_schedulers: string[];
}

function buildSummary(entries: ParseEntry[]): SummaryStats {
  const modelSet = new Set<string>();
  const loraSet = new Set<string>();
  const vaeSet = new Set<string>();
  const samplerSet = new Set<string>();
  const schedulerSet = new Set<string>();

  for (const entry of entries) {
    if (!entry.success) continue;
    if (entry.model) modelSet.add(entry.model);
    if (entry.vae) vaeSet.add(entry.vae);
    for (const l of entry.loras) loraSet.add(l.name);
    if (entry.sampler) samplerSet.add(entry.sampler);
    if (entry.scheduler) schedulerSet.add(entry.scheduler);
  }

  return {
    total_files: entries.length,
    successful: entries.filter(e => e.success).length,
    failed: entries.filter(e => !e.success).length,
    unique_models: Array.from(modelSet).sort(),
    unique_loras: Array.from(loraSet).sort(),
    unique_vaes: Array.from(vaeSet).sort(),
    unique_samplers: Array.from(samplerSet).sort(),
    unique_schedulers: Array.from(schedulerSet).sort(),
  };
}

program
  .name('parse-comfy-batch')
  .description('Batch-parse ComfyUI workflow JSON files from a directory')
  .version('1.0.0')
  .argument('<directory>', 'Directory containing ComfyUI workflow JSON files')
  .option('--recursive', 'Scan subdirectories recursively')
  .option('--out <file>', 'Write output to file instead of stdout')
  .option('--array', 'Output as a JSON array instead of JSONL (one per line)')
  .option('--summary', 'Output aggregate summary statistics only')
  .option('--failures', 'Output only failed parses (useful for debugging)')
  .action(async (dir: string, options: { recursive: boolean; out?: string; array: boolean; summary: boolean; failures: boolean }) => {
    try {
      const dirPath = resolve(dir);

      if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
        console.error(`Error: Directory not found: ${dirPath}`);
        process.exit(1);
      }

      // Collect JSON files
      const files = await collectJsonFiles(dirPath, options.recursive);
      if (files.length === 0) {
        console.error('No JSON files found in the specified directory.');
        process.exit(1);
      }

      console.error(`Found ${files.length} JSON file(s) in: ${dirPath}`);
      console.error(`Parsing...`);

      // Parse all files
      const entries: ParseEntry[] = [];
      for (let i = 0; i < files.length; i++) {
        const entry = parseSingleWorkflow(files[i]);
        entries.push(entry);
        if ((i + 1) % 50 === 0) {
          console.error(`  Progress: ${i + 1}/${files.length}`);
        }
      }

      // Determine output
      const outStream = options.out
        ? createWriteStream(resolve(options.out))
        : null;

      if (options.summary) {
        const summary = buildSummary(entries);
        const json = JSON.stringify(summary, null, 2);
        if (outStream) {
          outStream.write(json + '\n');
          outStream.end();
        } else {
          console.log(json);
        }
      } else if (options.failures) {
        const failures = entries.filter(e => !e.success);
        const json = JSON.stringify(failures, null, 2);
        if (outStream) {
          outStream.write(json + '\n');
          outStream.end();
        } else {
          console.log(json);
        }
      } else if (options.array) {
        const json = JSON.stringify(entries, null, 2);
        if (outStream) {
          outStream.write(json + '\n');
          outStream.end();
        } else {
          console.log(json);
        }
      } else {
        // JSONL format (default)
        for (const entry of entries) {
          const line = JSON.stringify(entry);
          if (outStream) {
            outStream.write(line + '\n');
          } else {
            console.log(line);
          }
        }
        if (outStream) {
          outStream.end();
        }
      }

      // Summary to stderr
      const successCount = entries.filter(e => e.success).length;
      const failCount = entries.filter(e => !e.success).length;
      console.error(`\nDone: ${successCount} succeeded, ${failCount} failed (${entries.length} total).`);
      if (options.out) {
        console.error(`Output written to: ${resolve(options.out)}`);
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
