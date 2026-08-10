# SilkStack Image Browser v2.1.0

The v2.1.0 release is all about the files your library actually contains. We've added real video metadata support, deeper ComfyUI workflow parsing across the latest model families, and a round of quality-of-life fixes — including a long-awaited fix for copying images from your library.

### Video Metadata Support

videos are now first-class citizens in your library, whether or not you have ffmpeg installed:

- **Bundled ffprobe** — Video probing now uses a binary bundled with the app, so MP4 metadata extraction works on machines without ffmpeg or ffprobe on PATH.
- **Rotation-Aware Dimensions** — Portrait videos (phone recordings, 90°/270° rotated captures) previously reported swapped width/height. Dimensions are now corrected based on the video's rotation metadata, so thumbnails and aspect ratios display properly.
- **ComfyUI MP4 Metadata (mdta)** — ComfyUI save nodes embed their workflow and prompt as MP4 tags. These are now extracted and passed through, so video files display full generation parameters — prompts, models, and settings — exactly like images do.
- **Accurate Video Dimensions** — ffprobe's encoded dimensions are treated as authoritative for videos, overriding generation metadata that can drift after a resize or re-encode.
- **MP4 parsing without ffprobe** — A pure byte-level mdta parser reads ComfyUI workflow/prompt metadata directly from the file, covering machines where the bundled probe can't run.

### Expanded Format Support

- **TIFF Metadata Extraction** — A minimal TIFF IFD walker reads Make/Model tags, which ComfyUI's SaveWebP node uses to store workflow and prompt JSON. TIFF-based metadata no longer depends on exifr succeeding.
- **More Reliable WebP Parsing** — WebP metadata extraction is now robust against exifr failures (previously an "Invalid input argument" exception could kill the whole extraction). ComfyUI WebP metadata is read directly from the TIFF bytes instead.

### ComfyUI Parser Expansion

Significant upgrades to workflow parsing, bringing support for the latest generation models and video workflows:

- **Qwen-Image / Qwen-Image-Edit** — Text encoders for the Qwen-Image family, including the Edit variants with multi-image conditioning.
- **MiniMax H3 Video Models** — Text-to-video and first/last-frame image-to-video model support, with prompt and dimensions extracted from execution inputs.
- **LTXV Video Model Family** — Full support for LTXV workflows: schedulers, conditioning, latent upsampling, audio latent handling, audio/visual latent merging and splitting, and video VAEs.
- **Additional Nodes** — CreateVideo, SaveVideo, EmptyImage, GetImageSize, PrimitiveInt/PrimitiveFloat, ManualSigmas, VAELoaderKJ, LatentUpscaleModelLoader, CFGNorm, and more.
- **Improved Traversal Engine** — More accurate subgraph traversal for resolving prompts, negative prompts, and parameters through complex workflows.

### Model View: "(no model)" Grouping

- Images without model metadata are no longer hidden. The Model view now shows a dedicated **(no model)** entry grouping all untagged images, so nothing slips through the cracks.
- The **(no model)** group is fully filterable — selecting it in the model filter shows exactly the images with no model metadata, and the active-filters bar displays "(no model)" clearly.

### Copy Images to Clipboard — Now Works for Every Format

- Copying images to the clipboard previously failed for JPEG and other non-PNG formats (Chromium only accepts PNG/WebP on clipboard writes). Non-PNG images are now re-encoded to PNG on the fly before copying, so **Copy Image** works reliably for every format in your library.
- Copy actions now work from inside stacks and stack views, not just the main grid.

### Bug Fixes & Polish

- **Right-click from stacks** — Context menus (rename, copy, delete, etc.) now work correctly when opened from a stack card or the stack view.
- **License tab errors fixed** — The license-compliance build step no longer errors during production packaging.
- **Format-aware file parameters** — Image parameter display handles video files and edge cases correctly in the image modal.

## Feedback

Found a bug or have a feature request? [Open an issue](https://github.com/skkut/SilkStack-Image-Browser/issues)!

---
