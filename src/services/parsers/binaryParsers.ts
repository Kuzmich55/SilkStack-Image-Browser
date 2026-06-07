/**
 * Binary metadata parsers for PNG, JPEG, and WebP images.
 *
 * Extracted from fileIndexer.ts for sharing between the main thread and
 * the metadata Web Worker. All functions are PURE — no Electron, window,
 * or DOM dependencies. Works exclusively with ArrayBuffer / DataView.
 */

import { parse } from 'exifr';
import {
  type ImageMetadata,
  type ComfyUIMetadata,
  isInvokeAIMetadata,
  isComfyUIMetadata,
} from '../../types';

// Debug flag — worker-compatible (no window reference)
const shouldLogPngDebug = Boolean(
  (typeof globalThis !== 'undefined' && (globalThis as any)?.process?.env?.PNG_DEBUG === 'true') ||
  (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.VITE_PNG_DEBUG)
);

// ═══════════════════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════════════════

function sanitizeJson(jsonString: string): string {
    // Replace NaN with null, as NaN is not valid JSON
    return jsonString.replace(/:\s*NaN/g, ': null');
}

export function detectImageType(view: DataView): 'png' | 'jpeg' | 'webp' | null {
  if (view.byteLength < 12) {
    return null;
  }

  if (view.getUint32(0) === 0x89504E47 && view.getUint32(4) === 0x0D0A1A0A) {
    return 'png';
  }

  if (view.getUint16(0) === 0xFFD8) {
    return 'jpeg';
  }

  if (view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    return 'webp';
  }

  return null;
}

function extractJpegComment(buffer: ArrayBuffer): string | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xFFD8) {
    return null;
  }

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xFF) {
      offset += 1;
      continue;
    }

    let marker = view.getUint8(offset + 1);
    while (marker === 0xFF && offset + 2 < view.byteLength) {
      offset += 1;
      marker = view.getUint8(offset + 1);
    }

    if (marker === 0xDA || marker === 0xD9) {
      break;
    }

    // Standalone markers without length
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      offset += 2;
      continue;
    }

    const size = view.getUint16(offset + 2, false);
    if (size < 2 || offset + 2 + size > view.byteLength) {
      break;
    }

    if (marker === 0xFE) {
      const start = offset + 4;
      const end = offset + 2 + size;
      const bytes = new Uint8Array(buffer.slice(start, end));
      const utf8 = new TextDecoder('utf-8').decode(bytes).trim();
      if (utf8.includes('\uFFFD')) {
        return new TextDecoder('latin1').decode(bytes).trim();
      }
      return utf8;
    }

    offset += 2 + size;
  }

  return null;
}

function isMetaHubSaveNodePayload(payload: any): payload is Record<string, any> {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const data = payload as Record<string, any>;
  const generator = data.generator ?? data.Generator;
  const hasMetaHubMarkers = Boolean(
    data.imh_pro ||
    data._metahub_pro ||
    data.analytics ||
    data._analytics ||
    data.workflow ||
    data.prompt_api
  );
  const hasCoreFields = Boolean(
    data.prompt ||
    data.negativePrompt ||
    data.seed !== undefined ||
    data.steps !== undefined ||
    data.sampler_name ||
    data.model
  );

  return (generator === 'ComfyUI' && (hasMetaHubMarkers || hasCoreFields)) || (hasMetaHubMarkers && hasCoreFields);
}

function wrapMetaHubData(payload: any): ImageMetadata | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = payload as Record<string, any>;
  if (data.imagemetahub_data) {
    return { imagemetahub_data: data.imagemetahub_data };
  }

  if (isMetaHubSaveNodePayload(data)) {
    return { imagemetahub_data: data };
  }

  return null;
}

function tryParseMetaHubJson(text: string): ImageMetadata | null {
  try {
    const parsed = JSON.parse(text);
    return wrapMetaHubData(parsed);
  } catch {
    return null;
  }
}

async function decodeITXtText(
  data: Uint8Array,
  compressionFlag: number,
  decoder: TextDecoder
): Promise<string> {
  if (compressionFlag === 0) {
    return decoder.decode(data);
  }

  if (compressionFlag === 1) {
    // Deflate-compressed (zlib) text
    try {
      // Prefer browser-native DecompressionStream (Chromium/Electron)
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate');
        // Ensure we pass a real ArrayBuffer (not SharedArrayBuffer) to Blob to satisfy TS/DOM types
        const arrayCopy = new Uint8Array(data.byteLength);
        arrayCopy.set(data);
        const arrayBuf = arrayCopy.buffer;
        const decompressedStream = new Blob([arrayBuf]).stream().pipeThrough(ds);
        const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();
        return decoder.decode(decompressedBuffer);
      }
      // Fallback for Node.js (should rarely be needed in renderer)
      if (typeof require !== 'undefined') {
        const zlib = await import('zlib');
        const inflated = zlib.inflateSync(Buffer.from(data));
        return decoder.decode(inflated);
      }
    } catch (err) {
      if (shouldLogPngDebug) {
        console.warn('[PNG DEBUG] Failed to decompress iTXt chunk', err);
      }
      return '';
    }
  }

  return '';
}

export async function parsePNGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
  const view = new DataView(buffer);
  let offset = 8;
  const decoder = new TextDecoder();
  const chunks: { [key: string]: string } = {};
  let shouldTryExif = false;
  
  // OPTIMIZATION: Stop early if we found all needed chunks
  let foundChunks = 0;
  const maxChunks = 5; // invokeai_metadata, parameters, workflow, prompt, Description

  while (offset < view.byteLength && foundChunks < maxChunks) {
    if (offset + 8 > view.byteLength) {
      break;
    }
    const length = view.getUint32(offset);
    const type = decoder.decode(buffer.slice(offset + 4, offset + 8));
    if (offset + 12 + length > view.byteLength) {
      break;
    }
    
    if (type === 'tEXt') {
      const chunkData = buffer.slice(offset + 8, offset + 8 + length);
      const chunkString = decoder.decode(chunkData);
      const [keyword, text] = chunkString.split('\0');
      if (keyword.toLowerCase() === 'xml:com.adobe.xmp') {
        shouldTryExif = true;
      }
      
      if (['invokeai_metadata', 'parameters', 'Parameters', 'workflow', 'prompt', 'Description'].includes(keyword) && text) {
        chunks[keyword.toLowerCase()] = text;
        foundChunks++;
      }
    } else if (type === 'iTXt') {
      const chunkData = new Uint8Array(buffer.slice(offset + 8, offset + 8 + length));
      const keywordEndIndex = chunkData.indexOf(0);
      if (keywordEndIndex === -1) {
        offset += 12 + length;
        continue;
      }
      const keyword = decoder.decode(chunkData.slice(0, keywordEndIndex));
      if (keyword.toLowerCase() === 'xml:com.adobe.xmp') {
        shouldTryExif = true;
      }

      if (['invokeai_metadata', 'parameters', 'Parameters', 'workflow', 'prompt', 'Description', 'imagemetahub_data'].includes(keyword)) {
        const compressionFlag = chunkData[keywordEndIndex + 1];
        let currentIndex = keywordEndIndex + 3; // Skip null separator, compression flag, and method

        const langTagEndIndex = chunkData.indexOf(0, currentIndex);
        if (langTagEndIndex === -1) {
          offset += 12 + length;
          continue;
        }
        currentIndex = langTagEndIndex + 1;

        const translatedKwEndIndex = chunkData.indexOf(0, currentIndex);
        if (translatedKwEndIndex === -1) {
          offset += 12 + length;
          continue;
        }
        currentIndex = translatedKwEndIndex + 1;

        const text = await decodeITXtText(chunkData.slice(currentIndex), compressionFlag, decoder);
        if (text) {
          chunks[keyword.toLowerCase()] = text;
          foundChunks++;
        }
      }
    } else if (type === 'eXIf') {
      shouldTryExif = true;
    }
    if (type === 'IEND') break;
    offset += 12 + length;
  }

  // PRIORITY 0: MetaHub Save Node chunk (highest priority)
  if (chunks.imagemetahub_data) {
    try {
      const metahubData = JSON.parse(chunks.imagemetahub_data);
      return { imagemetahub_data: metahubData };
    } catch (e) {
      console.warn('[PNG Parser] Failed to parse imagemetahub_data chunk:', e);
      // Fall through to other parsers
    }
  }

  // PRIORITY 1: Prioritize workflow for ComfyUI, then parameters for A1111, then InvokeAI
  if (chunks.workflow) {
    const comfyMetadata: ComfyUIMetadata = {};
    if (chunks.workflow) comfyMetadata.workflow = chunks.workflow;
    if (chunks.prompt) comfyMetadata.prompt = chunks.prompt;
    return comfyMetadata;
  } else if (chunks.parameters || chunks.description) {
    const paramsValue = chunks.parameters || chunks.description;
    if (shouldLogPngDebug) {
      console.log('[PNG DEBUG] Found parameters chunk:', {
        length: paramsValue.length,
        preview: paramsValue.substring(0, 150),
        hasSuiImageParams: paramsValue.includes('sui_image_params')
      });
    }
    return { parameters: paramsValue };
  } else if (chunks.invokeai_metadata) {
    return JSON.parse(chunks.invokeai_metadata);
  } else if (chunks.prompt) {
    return { prompt: chunks.prompt };
  }

  // Try EXIF/XMP extraction only when PNG has XMP or EXIF chunks present.
  if (shouldTryExif) {
    try {
      const exifResult = await parseJPEGMetadata(buffer);
      if (exifResult) {
        return exifResult;
      }
    } catch {
      // Silent error - EXIF extraction may fail
    }
  }

  // If no EXIF found, try PNG chunks as fallback
  // ...existing code...
}

export async function parseJPEGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
  try {
    // Extract EXIF data with UserComment and XMP support
    const exifData = await parse(buffer, {
      userComment: true,
      xmp: true,
      mergeOutput: true,
      sanitize: false,
      reviveValues: true
    });

    const commentText = extractJpegComment(buffer);

    if (!exifData) {
      if (commentText) {
        const metaHubFromComment = tryParseMetaHubJson(commentText);
        if (metaHubFromComment) {
          return metaHubFromComment;
        }
        return { parameters: commentText };
      }
      return null;
    }

    // PRIORITY 0: Check for MetaHub Save Node JSON in ImageDescription (JPEG/WebP save format)
    // MetaHub Save Node stores the IMH metadata as JSON in EXIF ImageDescription for JPEG/WebP
    if (exifData.ImageDescription) {
      try {
        const imageDesc = typeof exifData.ImageDescription === 'string'
          ? exifData.ImageDescription
          : new TextDecoder('utf-8').decode(exifData.ImageDescription);

        const metaHubData = tryParseMetaHubJson(imageDesc);
        if (metaHubData) {
          return metaHubData;
        }
      } catch {
        // Not JSON or not MetaHub metadata, continue with normal parsing
      }
    }

    // Check all possible field names for UserComment (A1111 and SwarmUI store metadata here in JPEGs)
    // Also check XMP Description for Draw Things and other XMP-based metadata
    let metadataText: string | Uint8Array | undefined =
      exifData.UserComment ||
      exifData.userComment ||
      exifData['User Comment'] ||
      exifData.ImageDescription ||
      exifData.Parameters ||
      exifData.Description || // XMP Description
      commentText ||
      null;

    if (!metadataText) {
      if (exifData.imagemetahub_data) {
        try {
          const parsed = typeof exifData.imagemetahub_data === 'string'
            ? JSON.parse(exifData.imagemetahub_data)
            : exifData.imagemetahub_data;
          return { imagemetahub_data: parsed };
        } catch {
          return { imagemetahub_data: exifData.imagemetahub_data };
        }
      }

      const comfyMetadata: Partial<ComfyUIMetadata> = {};
      if (exifData.workflow) {
        comfyMetadata.workflow = exifData.workflow;
      }
      if (exifData.prompt) {
        comfyMetadata.prompt = exifData.prompt;
      }
      if (comfyMetadata.workflow || comfyMetadata.prompt) {
        return comfyMetadata;
      }

      return null;
    }
    
    // Convert Uint8Array to string if needed (exifr returns UserComment as Uint8Array)
    if (metadataText instanceof Uint8Array) {
      // UserComment in EXIF has 8-byte character code prefix (e.g., "ASCII\0\0\0", "UNICODE\0")
      // Find where the actual data starts (look for '{' character for JSON data)
      let startOffset = 0;
      for (let i = 0; i < Math.min(20, metadataText.length); i++) {
        if (metadataText[i] === 0x7B) { // '{' character
          startOffset = i;
          break;
        }
      }
      
      // If no JSON found at start, skip the standard 8-byte prefix
      if (startOffset === 0 && metadataText.length > 8) {
        startOffset = 8;
      }
      
      // Remove null bytes (0x00) that can interfere with decoding
      const cleanedData = Array.from(metadataText.slice(startOffset)).filter(byte => byte !== 0x00);
      metadataText = new TextDecoder('utf-8').decode(new Uint8Array(cleanedData));
    } else if (typeof metadataText !== 'string') {
      // Convert other types to string
      metadataText = typeof metadataText === 'object' ? JSON.stringify(metadataText) : String(metadataText);
    }

    if (!metadataText) {
      return null;
    }

    const metaHubFromText = tryParseMetaHubJson(metadataText);
    if (metaHubFromText) {
      return metaHubFromText;
    }

    // ========== CRITICAL FIX: Check for ComfyUI FIRST (before other patterns) ==========
    // ComfyUI images stored as JPEG with A1111-style parameters in EXIF
    if (metadataText.includes('Version: ComfyUI')) {
      return { parameters: metadataText };
    }

    // No ComfyUI detected, checking other patterns...

    // ========== DRAW THINGS XMP FORMAT DETECTION ==========
    // Draw Things stores metadata in XMP format: {"lang":"x-default","value":"{JSON}"}
    if (metadataText.includes('"lang":"x-default"') && metadataText.includes('"value":')) {
      try {
        const xmpData = JSON.parse(metadataText);
        if (xmpData.value && typeof xmpData.value === 'string') {
          const innerJson = xmpData.value;
          // Check if the inner JSON contains Draw Things characteristics
          if (innerJson.includes('"c":') && (innerJson.includes('"model":') || innerJson.includes('"sampler":') || innerJson.includes('"scale":'))) {
            // Return in the expected format with Draw Things indicators so it gets routed to Draw Things parser
            return { parameters: 'Draw Things ' + innerJson, userComment: innerJson };
          }
        }
      } catch {
        // Not valid JSON, continue with other checks
      }
    }

    // A1111-style data is often not valid JSON, so we check for its characteristic pattern first.
    // Check for Civitai resources format first (A1111 without Model hash but with Civitai resources)
    if (metadataText.includes('Civitai resources:') && metadataText.includes('Steps:')) {
      return { parameters: metadataText };
    }
    if (metadataText.includes('Steps:') && metadataText.includes('Sampler:') && metadataText.includes('Model hash:')) {
      return { parameters: metadataText };
    }

    // Easy Diffusion uses similar format but without Model hash
    if (metadataText.includes('Prompt:') && metadataText.includes('Steps:') && metadataText.includes('Sampler:') && !metadataText.includes('Model hash:')) {
      return { parameters: metadataText };
    }

    // Midjourney uses parameter flags like --v, --ar, --q, --s
    if (metadataText.includes('--v') || metadataText.includes('--ar') || metadataText.includes('--q') || metadataText.includes('--s') || metadataText.includes('Midjourney')) {
      return { parameters: metadataText };
    }

    // Forge uses A1111-style parameters but includes "Forge" or "Gradio" indicators
    if ((metadataText.includes('Forge') || metadataText.includes('Gradio')) && 
        metadataText.includes('Steps:') && metadataText.includes('Sampler:') && metadataText.includes('Model hash:')) {
      return { parameters: metadataText };
    }

    // Draw Things (iOS/Mac AI app) - SIMPLIFIED: If it has Guidance Scale + Steps + Sampler, it's Draw Things
    if (metadataText.includes('Guidance Scale:') && metadataText.includes('Steps:') && metadataText.includes('Sampler:') &&
        !metadataText.includes('Model hash:') && !metadataText.includes('Forge') && !metadataText.includes('Gradio') &&
        !metadataText.includes('DreamStudio') && !metadataText.includes('Stability AI') && !metadataText.includes('--niji')) {
      // Extract UserComment JSON if available
      let userComment: string | undefined;
      if (exifData.UserComment || exifData.userComment || exifData['User Comment']) {
        const comment = exifData.UserComment || exifData.userComment || exifData['User Comment'];
        if (typeof comment === 'string' && comment.includes('{')) {
          userComment = comment;
        }
      }
      return { parameters: metadataText, userComment };
    }

    // Try to parse as JSON for other formats like SwarmUI, InvokeAI, ComfyUI, or DALL-E
    try {
      const parsedMetadata = JSON.parse(metadataText);

      const wrappedMetaHub = wrapMetaHubData(parsedMetadata);
      if (wrappedMetaHub) {
        return wrappedMetaHub;
      }

      // Check for DALL-E C2PA manifest
      if (parsedMetadata.c2pa_manifest ||
          (parsedMetadata.exif_data && (parsedMetadata.exif_data['openai:dalle'] ||
                                        parsedMetadata.exif_data.Software?.includes('DALL-E')))) {
        return parsedMetadata;
      }

      // Check for SwarmUI format (sui_image_params)
      if (parsedMetadata.sui_image_params) {
        return parsedMetadata;
      }

      if (isInvokeAIMetadata(parsedMetadata)) {
        return parsedMetadata;
      } else if (isComfyUIMetadata(parsedMetadata)) {
        return parsedMetadata;
      } else {
        return parsedMetadata;
      }
    } catch {
      // JSON parsing failed - check for ComfyUI patterns in raw text
      // ComfyUI sometimes stores workflow/prompt as JSON strings in EXIF
      if (metadataText.includes('"workflow"') || metadataText.includes('"prompt"') ||
          metadataText.includes('last_node_id') || metadataText.includes('class_type') ||
          metadataText.includes('Version: ComfyUI')) {
        // Try to extract workflow and prompt from the text
        try {
          // Look for workflow JSON
          const workflowMatch = metadataText.match(/"workflow"\s*:\s*(\{[^}]*\}|\[[^\]]*\]|"[^"]*")/);
          const promptMatch = metadataText.match(/"prompt"\s*:\s*(\{[^}]*\}|\[[^\]]*\]|"[^"]*")/);

          const comfyMetadata: Partial<ComfyUIMetadata> = {};

          if (workflowMatch) {
            try {
              comfyMetadata.workflow = JSON.parse(workflowMatch[1]);
            } catch {
              comfyMetadata.workflow = workflowMatch[1];
            }
          }

          if (promptMatch) {
            try {
              comfyMetadata.prompt = JSON.parse(promptMatch[1]);
            } catch {
              comfyMetadata.prompt = promptMatch[1];
            }
          }

          // If we found either workflow or prompt, return as ComfyUI metadata
          if (comfyMetadata.workflow || comfyMetadata.prompt) {
            return comfyMetadata;
          }

          // Special case: If we detected "Version: ComfyUI" but couldn't extract workflow/prompt,
          // this might be a ComfyUI image with parameters stored in A1111-style format
          // Return it as parameters so it gets parsed by A1111 parser which can handle ComfyUI format
          if (metadataText.includes('Version: ComfyUI')) {
            return { parameters: metadataText };
          }
        } catch {
          // Silent error - pattern matching failed
        }
      }

      // Silent error - JSON parsing may fail
      return null;
    }
  } catch {
    // Silent error - EXIF parsing may fail
    return null;
  }
}

export async function parseWebPMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
  try {
    // WebP stores EXIF in an 'EXIF' chunk within the RIFF container
    // We need to extract the EXIF chunk first, then parse it with exifr
    const view = new DataView(buffer);
    const decoder = new TextDecoder();

    const findExifTiffHeaderOffset = (bytes: Uint8Array): number => {
      if (bytes.length < 4) {
        return -1;
      }

      // JPEG-style EXIF header ("Exif\0\0") prefix
      if (bytes.length >= 6 &&
          bytes[0] === 0x45 && bytes[1] === 0x78 && bytes[2] === 0x69 && bytes[3] === 0x66 &&
          bytes[4] === 0x00 && bytes[5] === 0x00) {
        return 6;
      }

      // TIFF header at start
      if ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d)) {
        return 0;
      }

      // Scan for TIFF header within the first 64 bytes (handles extra padding)
      const limit = Math.min(64, bytes.length - 4);
      for (let i = 0; i <= limit; i++) {
        if (bytes[i] === 0x49 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0x2a && bytes[i + 3] === 0x00) {
          return i;
        }
        if (bytes[i] === 0x4d && bytes[i + 1] === 0x4d && bytes[i + 2] === 0x00 && bytes[i + 3] === 0x2a) {
          return i;
        }
      }

      // Fallback: find II/MM without the 0x2a marker (last resort)
      const fallbackLimit = Math.min(64, bytes.length - 2);
      for (let i = 0; i <= fallbackLimit; i++) {
        if ((bytes[i] === 0x49 && bytes[i + 1] === 0x49) || (bytes[i] === 0x4d && bytes[i + 1] === 0x4d)) {
          return i;
        }
      }

      return -1;
    };

    // Verify RIFF header
    if (decoder.decode(buffer.slice(0, 4)) !== 'RIFF') {
      return null;
    }

    // Verify WEBP format
    if (decoder.decode(buffer.slice(8, 12)) !== 'WEBP') {
      return null;
    }

    // Search for EXIF chunk
    let offset = 12; // Skip RIFF header and WEBP signature
    let exifChunkData: ArrayBuffer | null = null;

    while (offset + 8 <= view.byteLength) {
      const chunkType = decoder.decode(buffer.slice(offset, offset + 4));
      const chunkSize = view.getUint32(offset + 4, true); // Little-endian

      if (chunkType === 'EXIF') {
        // Found EXIF chunk!
        const exifStart = offset + 8; // Skip chunk header (type + size)
        const rawExifData = buffer.slice(exifStart, exifStart + chunkSize);
        const rawBytes = new Uint8Array(rawExifData);
        const tiffHeaderOffset = findExifTiffHeaderOffset(rawBytes);

        if (tiffHeaderOffset >= 0) {
          exifChunkData = rawExifData.slice(tiffHeaderOffset);
        } else {
          // No TIFF header detected; attempt JSON extraction (MetaHub Save Node payloads)
          let jsonStartOffset = -1;
          for (let i = 0; i < rawBytes.length - 1; i++) {
            if (rawBytes[i] === 0x7b && rawBytes[i + 1] === 0x22) { // '{"'
              jsonStartOffset = i;
              break;
            }
          }

          if (jsonStartOffset >= 0) {
            const jsonBytes = rawExifData.slice(jsonStartOffset);
            const jsonString = decoder.decode(jsonBytes).trim();
            let braceCount = 0;
            let jsonEnd = -1;
            for (let i = 0; i < jsonString.length; i++) {
              if (jsonString[i] === '{') braceCount++;
              if (jsonString[i] === '}') braceCount--;
              if (braceCount === 0) {
                jsonEnd = i + 1;
                break;
              }
            }

            if (jsonEnd > 0) {
              const completeJson = jsonString.substring(0, jsonEnd);
              try {
                const parsed = JSON.parse(completeJson);
                const metaHubData = wrapMetaHubData(parsed);
                if (metaHubData) {
                  return metaHubData;
                }
              } catch {
                // Failed to parse JSON, continue
              }
            }
          }

          exifChunkData = rawExifData; // Try exifr anyway as fallback
        }

        break;
      }

      // Move to next chunk (align to even byte boundary)
      offset += 8 + chunkSize;
      if (chunkSize % 2 !== 0) offset += 1;
    }

    if (!exifChunkData) {
      return null;
    }

    // Now parse the EXIF data with exifr
    const exifData = await parse(exifChunkData, {
      userComment: true,
      xmp: true,
      mergeOutput: true,
      sanitize: false,
      reviveValues: true
    });

    if (!exifData) {
      return null;
    }

    if ((exifData as any).imagemetahub_data) {
      try {
        const parsed = typeof (exifData as any).imagemetahub_data === 'string'
          ? JSON.parse((exifData as any).imagemetahub_data)
          : (exifData as any).imagemetahub_data;
        const wrapped = wrapMetaHubData({ imagemetahub_data: parsed });
        if (wrapped) {
          return wrapped;
        }
      } catch {
        const wrapped = wrapMetaHubData({ imagemetahub_data: (exifData as any).imagemetahub_data });
        if (wrapped) {
          return wrapped;
        }
      }
    }

    // PRIORITY 0: Check for MetaHub Save Node JSON in ImageDescription (WebP save format)
    // MetaHub Save Node stores the IMH metadata as JSON in EXIF ImageDescription for WebP
    if (exifData.ImageDescription) {
      try {
        const imageDesc = typeof exifData.ImageDescription === 'string'
          ? exifData.ImageDescription
          : new TextDecoder('utf-8').decode(exifData.ImageDescription);

        const metaHubData = tryParseMetaHubJson(imageDesc);
        if (metaHubData) {
          return metaHubData;
        }
      } catch (e) {
        // Not JSON or not MetaHub metadata, continue with normal parsing
      }
    }

    // Fall back to regular JPEG parsing logic (UserComment, etc.)
    // Reuse the JPEG parsing by reconstructing metadataText
    let metadataText: string | Uint8Array | undefined =
      exifData.UserComment ||
      exifData.userComment ||
      exifData['User Comment'] ||
      exifData.ImageDescription ||
      exifData.Parameters ||
      exifData.Description ||
      null;

    if (!metadataText) {
      return null;
    }

    // Convert Uint8Array to string if needed
    if (metadataText instanceof Uint8Array) {
      let startOffset = 0;
      for (let i = 0; i < Math.min(20, metadataText.length); i++) {
        if (metadataText[i] === 0x7B) { // '{' character
          startOffset = i;
          break;
        }
      }
      if (startOffset === 0 && metadataText.length > 8) {
        startOffset = 8;
      }
      const cleanedData = Array.from(metadataText.slice(startOffset)).filter(byte => byte !== 0x00);
      metadataText = new TextDecoder('utf-8').decode(new Uint8Array(cleanedData));
    }

    const metaHubFromText = tryParseMetaHubJson(metadataText);
    if (metaHubFromText) {
      return metaHubFromText;
    }

    // Check for ComfyUI first
    if (metadataText.includes('Version: ComfyUI')) {
      return { parameters: metadataText };
    }

    // Check for A1111/other formats
    return { parameters: metadataText };
  } catch (e) {
    console.error('[WebP DEBUG] Error in parseWebPMetadata:', e);
    return null;
  }
}

export function extractDimensionsFromBuffer(buffer: ArrayBuffer): { width: number; height: number } | null {
  const view = new DataView(buffer);
  const type = detectImageType(view);

  // PNG signature + IHDR
  if (type === 'png') {
    // IHDR chunk starts at byte 16, big-endian
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (width > 0 && height > 0) {
      return { width, height };
    }
    return null;
  }

  // JPEG SOF markers
  if (type === 'jpeg') {
    let offset = 2;
    const length = view.byteLength;
    while (offset < length) {
      if (view.getUint8(offset) !== 0xFF) {
        break;
      }
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2, false);

      // SOF0 - SOF15 (except padding markers)
      if (marker >= 0xC0 && marker <= 0xC3 || marker >= 0xC5 && marker <= 0xC7 || marker >= 0xC9 && marker <= 0xCB || marker >= 0xCD && marker <= 0xCF) {
        const height = view.getUint16(offset + 5, false);
        const width = view.getUint16(offset + 7, false);
        if (width > 0 && height > 0) {
          return { width, height };
        }
        break;
      }

      // Prevent infinite loop
      if (size < 2) {
        break;
      }
      offset += 2 + size;
    }
    return null;
  }

  // WebP RIFF container
  if (type === 'webp') {
    let offset = 12;
    while (offset + 8 <= view.byteLength) {
      const chunkType = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      );
      const chunkSize = view.getUint32(offset + 4, true);
      const chunkDataOffset = offset + 8;
      const chunkDataEnd = chunkDataOffset + chunkSize;

      if (chunkDataEnd > view.byteLength) {
        break;
      }

      if (chunkType === 'VP8X' && chunkDataOffset + 10 <= view.byteLength) {
        const widthMinusOne = view.getUint8(chunkDataOffset + 4) |
          (view.getUint8(chunkDataOffset + 5) << 8) |
          (view.getUint8(chunkDataOffset + 6) << 16);
        const heightMinusOne = view.getUint8(chunkDataOffset + 7) |
          (view.getUint8(chunkDataOffset + 8) << 8) |
          (view.getUint8(chunkDataOffset + 9) << 16);
        return { width: widthMinusOne + 1, height: heightMinusOne + 1 };
      }

      if (chunkType === 'VP8 ' && chunkDataOffset + 10 <= view.byteLength) {
        const width = (view.getUint8(chunkDataOffset + 6) | (view.getUint8(chunkDataOffset + 7) << 8)) & 0x3FFF;
        const height = (view.getUint8(chunkDataOffset + 8) | (view.getUint8(chunkDataOffset + 9) << 8)) & 0x3FFF;
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }

      if (chunkType === 'VP8L' && chunkDataOffset + 5 <= view.byteLength) {
        const signature = view.getUint8(chunkDataOffset);
        if (signature === 0x2f) {
          const b1 = view.getUint8(chunkDataOffset + 1);
          const b2 = view.getUint8(chunkDataOffset + 2);
          const b3 = view.getUint8(chunkDataOffset + 3);
          const b4 = view.getUint8(chunkDataOffset + 4);
          const width = 1 + (b1 | ((b2 & 0x3F) << 8));
          const height = 1 + (((b2 & 0xC0) >> 6) | (b3 << 2) | ((b4 & 0x0F) << 10));
          if (width > 0 && height > 0) {
            return { width, height };
          }
        }
      }

      offset = chunkDataEnd + (chunkSize % 2);
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Worker-friendly entry point
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse image metadata from an ArrayBuffer.
 * Drop-in for the original parseImageMetadata() but works with raw buffers
 * instead of File objects — suitable for Web Worker use.
 */
export async function parseImageBuffer(
  buffer: ArrayBuffer,
): Promise<ImageMetadata | null> {
  const view = new DataView(buffer);
  const detectedType = detectImageType(view);

  if (detectedType === 'png') {
    return parsePNGMetadata(buffer);
  }
  if (detectedType === 'jpeg') {
    return parseJPEGMetadata(buffer);
  }
  if (detectedType === 'webp') {
    return parseWebPMetadata(buffer);
  }
  return null;
}
