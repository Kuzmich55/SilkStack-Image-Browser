# ComfyUI CLI Tools

Command-line tools for parsing ComfyUI workflow JSON files and extracting structured metadata — models, LoRAs, VAEs, schedulers, samplers, prompts, and more.

## Quick Start

```bash
# Parse from a file
npm run comfy:parse -- workflow.json --pretty

# Parse from stdin — pipe or paste raw JSON
cat workflow.json | npm run comfy:parse --
pbpaste | npm run comfy:parse --          # macOS clipboard
Get-Clipboard | npm run comfy:parse --    # Windows clipboard

# Parse all workflows in a directory → summary
npm run comfy:batch -- path/to/workflows/ --summary

# Parse recursively → JSONL file
npm run comfy:batch -- path/to/workflows/ --recursive --out results.jsonl
```

Both scripts are TypeScript and run via `tsx`. They import the graph-traversal engine from `@image-metahub/metadata-engine` — the same production parser used by the SilkStack desktop app.

---

## `parse-comfy-workflow` — Single Workflow Parser

Parses one ComfyUI workflow and writes structured metadata to stdout.
**Accepts a file path or raw JSON from stdin.**

### Usage

```bash
# ── From a file ────────────────────────────
npm run comfy:parse -- <file> [options]
npx tsx scripts/parse-comfy-workflow.ts <file> [options]

# ── From stdin (pipe raw JSON) ─────────────
cat workflow.json | npm run comfy:parse --
pbpaste | npx tsx scripts/parse-comfy-workflow.ts      # macOS
Get-Clipboard | npx tsx scripts/parse-comfy-workflow.ts # Windows PS

# ── From stdin (explicit flag) ─────────────
npm run comfy:parse -- --stdin < workflow.json
npx tsx scripts/parse-comfy-workflow.ts -              # "-" = stdin
```

> **Tip:** When piping via `npm run`, use `--` as the final argument (no file path) to signal stdin mode. When using `npx tsx` directly, just omit the file argument.

### Input Formats

| Source | Example |
|---|---|
| **File path** | `npx tsx scripts/parse-comfy-workflow.ts workflow.json` |
| **Pipe / redirect** | `cat workflow.json \| npx tsx scripts/parse-comfy-workflow.ts` |
| **Clipboard paste** | `Get-Clipboard \| npx tsx scripts/parse-comfy-workflow.ts` |
| **Explicit stdin** | `npx tsx scripts/parse-comfy-workflow.ts -` or `--stdin` |

The JSON content itself can be any of these ComfyUI export formats:

| Format | Description |
|---|---|
| Full export | JSON with both `"workflow"` and `"prompt"` top-level keys |
| API format | JSON keyed by node ID strings, each containing `class_type` + `inputs` |
| Stringified | `"workflow"` or `"prompt"` values encoded as JSON strings (auto-decoded) |

### Options

| Flag | Description |
|---|---|
| `--stdin` | Force reading from stdin even when a file path is provided |
| `--pretty` | Pretty-print JSON with 2-space indentation |
| `--facts` | Output in structured `WorkflowFacts` format (grouped sections: `prompts`, `model`, `loras`, `sampling`, `dimensions`) |
| `--raw` | Include the raw pre-cleaning result under a `_raw` key |
| `--no-telemetry` | Omit `_telemetry` data (detection method, unknown node count, warnings) |

The `file` field in the output shows the source filename, or `"<stdin>"` when input was piped.

### Default Output Schema

### Default Output Schema

```jsonc
{
  "file": "workflow.json",
  "generator": "ComfyUI",
  "parsed_at": "2026-08-04T19:25:20.450Z",

  // ── Model ──
  "model": "sd_xl_base_1.0.safetensors",
  "vae": "ae.safetensors",

  // ── Sampling ──
  "seed": 12345,
  "approximate_seed": false,
  "steps": 20,
  "cfg": 8,
  "sampler": "euler",
  "scheduler": "normal",
  "denoise": 1,

  // ── Prompts ──
  "prompt": "beautiful landscape, mountains, sunset",
  "negative_prompt": "blurry, low quality",

  // ── LoRAs (with weights) ──
  "loras": [
    { "name": "style_lora_v1.safetensors", "weight": 0.8 },
    { "name": "detail_tweaker.safetensors", "weight": 0.5 }
  ],

  // ── ControlNet (with weights & targets) ──
  "controlnets": [
    { "name": "control_v11p_sd15_canny.pth", "weight": 0.85, "applied_to": "image" }
  ],

  // ── Dimensions (from workflow; use image file dimensions for real size) ──
  "width": 1024,
  "height": 1024,

  // ── Additional ──
  "comfyui_version": "1.2.3",
  "edit_history": null,
  "vaes": [{ "name": "ae.safetensors" }],

  "_telemetry": {
    "detection_method": "standard",
    "unknown_nodes_count": 0,
    "warnings": []
  }
}
```

### `--facts` Output Schema

```jsonc
{
  "file": "workflow.json",
  "generator": "ComfyUI",
  "parsed_at": "2026-08-04T19:25:44.193Z",

  "prompts": {
    "positive": "beautiful landscape, mountains, sunset",
    "negative": "blurry, low quality"
  },

  "model": {
    "base": "sd_xl_base_1.0.safetensors",
    "vae": "ae.safetensors"
  },

  "loras": [
    { "name": "style_lora_v1.safetensors" }
  ],

  "sampling": {
    "seed": 12345,
    "steps": 20,
    "cfg": 8,
    "sampler_name": "euler",
    "scheduler": "normal",
    "denoise": 1
  },

  "dimensions": {
    "width": 1024,
    "height": 1024
  },

  "controlnets": [],
  "vaes": [],
  "edit_history": null,
  "comfyui_version": "1.2.3"
}
```

### Examples

```bash
# Basic parse
npm run comfy:parse -- my_workflow.json

# Pretty-printed for reading
npm run comfy:parse -- my_workflow.json --pretty

# Structured facts format (good for piping into jq)
npm run comfy:parse -- my_workflow.json --facts | jq '.sampling'

# With raw data for debugging
npm run comfy:parse -- my_workflow.json --raw --pretty

# Extract just the model name
npm run comfy:parse -- my_workflow.json | jq -r '.model'
```

---

## `parse-comfy-batch` — Directory Batch Processor

Scans a directory for JSON files, parses each as a ComfyUI workflow, and outputs results in bulk.

### Usage

```bash
npm run comfy:batch -- <directory> [options]

# Or directly:
npx tsx scripts/parse-comfy-batch.ts <directory> [options]
```

### Options

| Flag | Description |
|---|---|
| `--recursive` | Scan subdirectories recursively |
| `--out <file>` | Write output to file instead of stdout |
| `--array` | Output as a JSON array instead of JSONL (one object per line) |
| `--summary` | Output aggregate summary statistics only (unique models, LoRAs, etc.) |
| `--failures` | Output only files that failed to parse (useful for debugging) |

### Output Formats

**JSONL (default):** One JSON object per line — ideal for piping into tools like `jq`, `grep`, or `wc`.

```bash
npm run comfy:batch -- ./workflows/ | jq '.model'
npm run comfy:batch -- ./workflows/ | wc -l   # count workflows
```

**JSON Array (`--array`):** Standard JSON array of all results.

**Summary (`--summary`):** Aggregate statistics across all files.

```jsonc
{
  "total_files": 13,
  "successful": 13,
  "failed": 0,
  "unique_models": [
    "sd_xl_base_1.0.safetensors",
    "ideogram4_int8_convrot.safetensors"
  ],
  "unique_loras": [
    "style_lora_v1.safetensors",
    "detail_tweaker.safetensors"
  ],
  "unique_vaes": ["flux2-vae.safetensors"],
  "unique_samplers": ["dpmpp_2m", "euler", "euler_a"],
  "unique_schedulers": ["karras", "normal", "simple"]
}
```

**Failures (`--failures`):** Only entries where `success: false`, including error messages.

### Per-File Entry Schema (JSONL / Array modes)

```jsonc
{
  "file": "workflow.json",
  "success": true,
  "model": "sd_xl_base_1.0.safetensors",
  "vae": null,
  "loras": [
    { "name": "style_lora_v1.safetensors", "modelStrength": 0.8, "clipStrength": 0.8 }
  ],
  "sampler": "euler",
  "scheduler": "normal",
  "steps": 20,
  "cfg": 8,
  "seed": 12345,
  "prompt": "beautiful landscape, mountains, sunset",
  "negative_prompt": "blurry, low quality",
  "denoise": 1,
  "controlnets": [],
  "comfyui_version": null
}
```

### Examples

```bash
# Parse all workflows in a directory, write to file
npm run comfy:batch -- ./my_workflows/ --out parsed.jsonl

# Recursive scan + summary of all workflows on disk
npm run comfy:batch -- ~/ComfyUI/output/ --recursive --summary

# Find workflows using a specific model
npm run comfy:batch -- ./workflows/ | jq 'select(.model | test("xl_base"))'

# Count workflows that use LoRAs
npm run comfy:batch -- ./workflows/ | jq 'select(.loras | length > 0)' | wc -l

# Export all unique models across a directory
npm run comfy:batch -- ./workflows/ --summary | jq '.unique_models[]'
```

---

## How It Works

Both tools use the same production-grade ComfyUI graph parser as the SilkStack desktop app. The parsing pipeline:

```
JSON file
  → Extract "workflow" + "prompt" sections
  → Merge UI graph (widgets_values) with API graph (inputs, class_type)
  → Find terminal SINK node (KSampler / SaveImage)
  → Walk backward through graph connections, resolving parameters
  → Apply post-processing (dedup, clean prompts, detect ControlNet/LoRA/VAE)
  → Output structured JSON
```

**Supported node types:** ~100+ ComfyUI nodes are registered in the declarative `NodeRegistry`, including:
- **Samplers:** `KSampler`, `KSampler (Efficient)`, `SamplerCustom`, `SamplerCustomAdvanced`, `UltimateSDUpscale`, `FaceDetailer`
- **Loaders:** `CheckpointLoaderSimple`, `VAELoader`, `LoraLoader`, `ControlNetLoader`, `UNETLoader`, `DualCLIPLoader`, `UpscaleModelLoader`
- **Conditioning:** `CLIPTextEncode`, `CLIPTextEncodeFlux`, `BasicGuider`, `CFGGuider`, `DualModelGuider`
- **Routing:** `Reroute`, `ImpactSwitch`, `ComfySwitchNode`
- **Flux-specific:** `FluxGuidance`, `ModelSamplingFlux`, `UnetLoaderGGUF`, `DualCLIPLoaderGGUF`
- **Utilities:** `String Literal`, `PrimitiveStringMultiline`, `ImpactWildcardEncode`, `CR LoRA Stack`, `ttN concat`

See `packages/metadata-engine/src/parsers/comfyui/nodeRegistry.ts` for the full registry.

---

## Using with Other Tools

### jq (JSON processor)

```bash
# Extract just the model name
npm run comfy:parse -- workflow.json | jq -r '.model'

# List all LoRA names
npm run comfy:parse -- workflow.json | jq '.loras[].name'

# Check if a scheduler is used
npm run comfy:parse -- workflow.json | jq '.scheduler == "karras"'

# Get all unique models across a directory
npm run comfy:batch -- ./workflows/ --summary | jq '.unique_models[]'
```

### PowerShell

```powershell
# Parse and convert from JSON
$result = npx tsx scripts/parse-comfy-workflow.ts workflow.json | ConvertFrom-Json
Write-Host "Model: $($result.model), Scheduler: $($result.scheduler)"

# Batch process and filter
npx tsx scripts/parse-comfy-batch.ts ./workflows/ | ForEach-Object {
    $entry = $_ | ConvertFrom-Json
    if ($entry.loras.Count -gt 0) { Write-Host $entry.file }
}
```

### Python

```python
import subprocess, json

# Parse a single workflow
result = subprocess.run(
    ["npx", "tsx", "scripts/parse-comfy-workflow.ts", "workflow.json"],
    capture_output=True, text=True
)
data = json.loads(result.stdout)
print(f"Model: {data['model']}, Steps: {data['steps']}")
```
