# Credits: the Live view's art

The art in this folder is original pixel art drawn in code for The Office: every shape and figure is a grid of palette indexes painted by these modules (`pixel-grid.ts`, `furniture.ts`, `floor-art.ts`, `figures.ts`, `overlays.ts`, with the colours in `palettes.ts`).

- **Author:** The Office.
- **Licence:** GPL-3.0-only, The Office's own.
- **Source:** ported from the Live view's prototype, [`docs/design/live-view.html`](../../../../../../docs/design/live-view.html).
- **Third-party assets:** none. No image, sprite sheet or font is downloaded or bundled.

## The packs weighed

No openly licensed pack fits, so the art is drawn in code. The packs weighed:

| Pack | Licence | Why not |
| --- | --- | --- |
| Kenney, Furniture Kit | CC0 | Rendered 3D furniture, not pixel art; no office computers, no characters to match it. |
| Liberated Pixel Cup (LPC) character generator | CC-BY-SA 3.0, GPL 3.0 or OGA-BY 3.0, per asset | Layered and recolourable, but drawn for a top-down ¾ view, not isometric, and every asset needs its own credit. |
| CC0 isometric characters on OpenGameArt | CC0 | No separate layers for body, hair and clothes, so no recolouring by palette and no generated variety. |
| Paid isometric office packs | Commercial | Not openly licensed. |

Drawn in code, the art fits the 2:1 tiles exactly, is layered by construction, recolours by palette, and needs no download and no credit per asset.

## The renderer

[PixiJS](https://github.com/pixijs/pixijs) (`pixi.js`, MIT) draws the painted canvases on the floor. It is the renderer only: it brings no art, and nothing in this folder imports it.
