import { describe, it, expect } from 'vitest';
import { parseComfyUIMetadataEnhanced } from '../../src/services/parsers/comfyUIParser';

describe('ComfyUI Parser - Deep Workflow', () => {
  it('correctly retrieves prompt from primitive string multiline with switch', async () => {
    const rawData = {
      "workflow": {
        "id":"08988737-a544-4ab1-99fb-22d67b7c36e3",
        "definitions":{
          "subgraphs":[{
            "id":"b0e5ca93-2731-42b9-8e0a-d28ea851ff81",
            "nodes":[
              {"id":6,"type":"CLIPTextEncode","inputs":{"clip":["11",0],"text":["28",0]},"widgets_values":["A high-contrast, hyper-stylized fashion editorial portrait shot against a saturated mustard-yellow seamless backdrop, with the central figure rendered in crisp desaturated black-and-white, creating a striking duotone aesthetic reminiscent of David LaChapelle meets Helmut Newton with a punk-gothic edge.\n\nThe subject is a fierce young woman with a platinum-bleached, spiked liberty mohawk crown of hair, her expression cold and commanding as she stares directly into the lens. She wears a cropped black leather biker jacket exploding with oversized metallic conical studs and spikes across the shoulders, paired with a minimal black bikini bottom, sheer black thigh-high stockings, and chunky knee-high lace-up combat platform boots. Her toned, athletic physique is fully exposed at the midriff.\n\nShe sits regally upon an ornate throne carved in the shape of a snarling, fanged beast's head — part dragon, part demonic feline — its silver-grey surface intricately detailed with bones, scales, and gothic ornamentation. Her booted foot rests on a battered metal road case wrapped in heavy chains and covered in stickers and band decals.\n\nIn her right hand she grips a massive medieval war scythe, its long wooden shaft wrapped in leather, the enormous curved blade arcing dramatically over her head. Perched on her left fist, talons gripping her knuckles, is a majestic American bald eagle with pristine white head feathers and a sharp yellow beak, staring off to the side with predatory alertness.\n\nStudio lighting is hard and theatrical, casting crisp shadows. The composition is symmetrical, iconic, and poster-like — punk rock goddess of war meets American mythology. Hyperrealistic, high-fashion photography, 8k, sharp detail, magazine cover quality."]},
              {"id":3,"type":"KSampler","inputs":{"model":["22",0],"positive":["6",0],"negative":["13",0],"latent_image":["5",0]}},
              {"id":8,"type":"VAEDecode","inputs":{"samples":["3",0],"vae":["12",0]}},
              {"id":16,"type":"TextGenerate","inputs":{"prompt":["17",4]}},
              {"id":17,"type":"StringConcatenate","inputs":{"string_a":["18",0],"string_b":["19",0]}},
              {"id":18,"type":"PrimitiveStringMultiline","widgets_values":["System prompt content here."]},
              {"id":19,"type":"PrimitiveStringMultiline","widgets_values":["A high-resolution, surreal digital illustration showing a human hand holding a martini glass. The image is overlaid with whimsical, expressive ink-style doodles, including a cartoon figure inside the glass, a drawn citrus wedge on the rim, and various abstract sketches and faces surrounding the glass against a clean, white background. The style seamlessly blends a realistic, lit photograph with loose, hand-drawn marker artistry, creating a playful and artistic juxtaposition."]},
              {"id":20,"type":"PreviewAny","inputs":{"source":["21",0]}},
              {"id":21,"type":"ComfySwitchNode","inputs":{"on_false":["19",0],"on_true":["16",0],"switch":["24",0]}},
              {"id":24,"type":"PrimitiveBoolean","widgets_values":[true]},
              {"id":27,"type":"StringConcatenate","inputs":{"string_a":["20",0]}},
              {"id":28,"type":"ComfySwitchNode","inputs":{"on_false":["20",0],"on_true":["27",0],"switch":["23",0]}},
              {"id":23,"type":"PrimitiveBoolean","widgets_values":[false]},
              {"id":-20,"inputs":{"IMAGE":["8",0]}}
            ],
            "links":[
              [43, 8, 0, -20, 0, "IMAGE"],
              [32, 24, 0, 21, 2, "BOOLEAN"],
              [33, 16, 0, 21, 1, "STRING"],
              [34, 19, 0, 21, 0, "STRING"],
              [27, 21, 0, 20, 0, "STRING"],
              [37, 20, 0, 28, 0, "STRING"],
              [40, 28, 0, 6, 1, "STRING"],
              [42, 23, 0, 28, 2, "BOOLEAN"],
              [19, 17, 0, 16, 0, "STRING"],
              [21, 18, 0, 17, 0, "STRING"],
              [22, 19, 0, 17, 1, "STRING"],
              [41, 6, 0, 3, 1, "CONDITIONING"]
            ]
          }]
        },
        "nodes":[
          {"id":30,"type":"b0e5ca93-2731-42b9-8e0a-d28ea851ff81","inputs":{"value":["-1",0]},"widgets_values":[]},
          {"id":51,"type":"SaveCompressedWeppy","inputs":{"images":["30",0]}}
        ]
      }
    };

    const result = await parseComfyUIMetadataEnhanced(rawData);
    expect(result.prompt).toContain('A high-resolution, surreal digital illustration');
  });
});
