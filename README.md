# Baithul Hamd - Home Finish Visualizer

Upload photos of an unfinished house (bare walls, exposed brick or concrete, empty floors) and see each space **finished as a modern home**: flooring, wall paint, ceiling, lighting, fixtures and furniture. You can steer the style with your own reference images, compare before and after, change one element at a time, and turn the rooms into a **3D walkthrough you can download as an MP4**.

The app is for homeowners and small contractors. Renders are **visual previews, not structural or engineering plans** (the app says so on screen and in every comparison image and video).

## Quick start

You need [Node.js](https://nodejs.org) **20.12 or newer**.

```bash
npm install
npm start
```

Open **http://localhost:3000** and press **Try sample photos**, then **Render**.

No API keys are needed: the **Free preview** engine runs entirely in your browser. To use the paid AI engines, copy `.env.example` to `.env`, add a key, and restart.

To use the app from a phone on the same Wi-Fi, start it with `HOST=0.0.0.0 npm start` and open `http://<your-computer's-IP>:3000`. Only do this on a network you trust: anyone on it could use your API keys.

## What you can do

| Area | Features |
| --- | --- |
| **Upload** | Drag and drop (or tap to choose) photos and reference images, with a thumbnail for each. Clear messages when a photo is **too small, too dark, blurry or unclear**, with a "Use it anyway" option. HEIC photos get a tip on how to export them as JPEG. |
| **Room types** | Living room, kitchen, bedroom, bathroom, full house exterior (set per photo). |
| **Style** | Up to **5 reference images per project**, each with a label and a role: *overall style, flooring, kitchen, colour palette* or *furniture*. Without references, pick a preset: *Modern minimalist, Scandinavian, Luxury contemporary, Indian modern, Industrial loft*. |
| **How references are used** | Each role only controls its own elements: a flooring reference changes the floor and nothing else, a palette sets wall and fabric colours, and so on. Each render lists the references it used and what each one changed. If a reference conflicts with the room's layout or scale (a kitchen reference on a bedroom, an outdoor scene for an interior, a "flooring sample" that is a whole room, a different framing), **the layout from your photo is kept and a warning explains what was ignored**. The optional AI reference check (Claude) adds a deeper check. |
| **Renders** | Before/after **slider**, **side by side** or after only. Switching style, adding or swapping a reference, or changing the room type updates the render without re-uploading. With the free engine this happens automatically; with AI engines you click "Update render". |
| **Edit one element** | Change just the flooring, walls and paint (feature wall, tiles), ceiling, lighting (mood, colour temperature, downlights), fixtures (metal finish, pendant, frames, doors), kitchen cabinets or vanity, or furniture. Everything else stays the same. |
| **Save and download** | Save renders to the project (they appear on the Saved tab), download each finished image, or download a labelled before/after image. Projects are stored in your browser and survive reloads. |
| **3D house & video** | Every rendered room becomes part of a **3D house**. Free-preview renders include real 3D furniture. Preview the **walkthrough** (exterior approach, house overview, a walk through each room) or orbit freely. **Download it as MP4** with a progress bar and cancel button, or download the **3D model (.glb)**. The video uses the same references and style as the renders. |

### Tips for good photos

- Stand in the doorway and **face the far wall straight on**, holding the phone level at chest height.
- Take photos in daylight, or with lights on. Avoid pointing straight at a bright window.
- After uploading, press **Adjust room box** and drag the corners onto the far wall's corners. This gives better perspective, furniture placement and 3D. The app tries to detect the box automatically.

## Render engines

| Engine | Cost | What it does |
| --- | --- | --- |
| **Free preview** (default) | Free, runs in your browser | Fits a 3D "room box" to the photo and repaints every surface with real materials while keeping the photo's own light and shadow. Detects doors and windows (it keeps the view outside and adds frames and doors), adds downlights or cove lighting, and places 3D furniture that avoids doorways, with curtains at windows. Fast, private and consistent. It works best with straight-on photos, and is a stylised mock-up rather than a photo-real render. |
| **OpenAI** | Paid API | Photo-real render using OpenAI image editing (`gpt-image-1` by default). Your photo is the first image and your references follow, each tagged with its role. Single-element edits of the floor, walls or ceiling use a mask so only that area changes. |
| **Google Gemini** | Paid API | Photo-real render with Gemini's image model (`gemini-2.5-flash-image` by default), which handles several role-tagged reference images well. |

Both AI engines are instructed to keep the exact camera, room geometry and openings of your photo, and never to reproduce logos, brand names or trademarked products. AI models can still change details, so check the before/after.

## Features that need a paid API or service

Everything else in the app is free and runs locally: the free preview renderer, image checks, reference analysis and conflict warnings, element editing, saving, 3D house, walkthrough preview, MP4 export and GLB export.

| Feature | Service | Setting in `.env` | Notes |
| --- | --- | --- | --- |
| Photo-real AI renders and AI single-element edits | **OpenAI Images API** (paid per image) | `OPENAI_API_KEY` (optional: `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`, `OPENAI_INPUT_FIDELITY`) | `quality=medium` is a good balance. `input_fidelity=high` keeps the layout closer but costs more. |
| Photo-real AI renders and AI single-element edits | **Google Gemini API** (paid per image) | `GEMINI_API_KEY` (optional: `GEMINI_IMAGE_MODEL`) | |
| AI reference check: deeper layout/scale conflict detection plus a written style brief that is added to AI render prompts | **Anthropic Claude API** (paid per request) | `ANTHROPIC_API_KEY` (optional: `ANTHROPIC_MODEL`, default `claude-opus-5-5`) | Uses Claude's vision with a JSON-schema answer. Server-side fallback is enabled for declined requests. |

Not included, but available as paid services if you want to go further:

- **True 3D reconstruction from photos** (photogrammetry or Gaussian splatting, e.g. Luma AI, Polycam, Matterport). The built-in 3D house is a simplified box model per room, built from one photo each.
- **AI video generation** (e.g. Runway or Google Veo) for cinematic, photo-real walkthroughs. The built-in video is rendered from the 3D house.

**MP4 export** is free. Chrome, Edge and Safari encode it in the browser (WebCodecs). Other browsers fall back to the local server, which needs [ffmpeg](https://ffmpeg.org) installed (`FFMPEG_PATH` if it is not on your PATH).

## Privacy

Photos, references and renders stay in your browser (IndexedDB). They are only sent somewhere when you choose an AI engine or the AI reference check, and then only to that provider, through your own server. API keys stay on the server and are never sent to the browser. A simple rate limit protects the paid endpoints.

## How it works

```
public/                     the web app (plain ES modules, no build step)
  index.html, css/styles.css
  js/main.js                start-up
  js/state.js               project store, auto-saved to IndexedDB
  js/catalog.js             room types, reference roles, elements, presets (shared with the server)
  js/lib/geometry.js        room box maths: camera, surfaces, room size, far-wall detection
  js/lib/imageTools.js      loading, quality checks, colour palettes
  js/render/styles.js       style specs: presets -> references (by role) -> one-element edits
  js/render/references.js   reference analysis and layout/scale conflict warnings
  js/render/materials.js    procedural materials (wood, herringbone, tiles, marble, terrazzo...)
  js/render/localRenderer.js  the free preview renderer
  js/render/furniture.js    furniture planning (metres) and 3D models (three.js)
  js/render/engine.js       one "render this photo" entry point for all engines
  js/three/house.js         3D house and walkthrough timeline
  js/three/videoExport.js   MP4 export (WebCodecs + mp4-muxer, ffmpeg fallback)
  js/ui/*.js                upload panels, workspace, compare slider, room box, element editor, 3D tab
  samples/                  sample photos (generated by tools/make_samples.py, no licence restrictions)
server/
  index.js                  Express server and API
  prompt.js                 builds AI prompts from the style spec and reference roles
  providers/                OpenAI, Gemini and Claude adapters
  video.js                  ffmpeg MP4 fallback
test/                       unit tests (npm test)
```

**Free preview renderer.** A photo taken facing a wall is treated as a camera standing in a box. From the far-wall rectangle, the vanishing point and an assumed camera height of 1.5 m, the app works out which surface every pixel shows and where it is in metres. Each surface is repainted with its material in correct perspective (with mip-mapping so distant floors don't shimmer), then multiplied by the photo's own smoothed lighting, so window light and shadows stay where they were. Furniture is planned in metres and rendered with three.js through the same virtual camera, so it sits in the room with soft shadows. A final grade sets white balance, exposure, bloom and vignette.

**3D house.** Each room is a box textured by projecting its finished image back from where the photo was taken. The free renderer also produces a wider, furniture-free version of the finishes for this. Free-preview rooms get their real 3D furniture. Surfaces the photo never saw are left open, giving a dollhouse cutaway.

## Development

```bash
npm run dev   # restarts the server when files change
npm test      # unit tests: geometry, quality checks, styles, conflicts, furniture planning, prompts, provider adapters
```

`python3 tools/make_samples.py` regenerates the sample images (needs numpy and Pillow).

## Disclaimer

Images, videos and 3D models from this app are visual previews for homeowners and small contractors. They are not architectural, structural, electrical, plumbing or engineering drawings, and room sizes are rough estimates. Always consult qualified professionals before building. Reference images are used for style only; the app does not copy trademarked products or logos.

## Licence

MIT, see [LICENSE](LICENSE).
