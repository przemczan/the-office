import { CanvasSource, Sprite, Texture } from "pixi.js";
import type { PaintedArt } from "./art/pixel-grid.ts";
import type { FloorPoint } from "./live-view-types.ts";

/** One `Texture` per painted canvas, nearest-neighbour so the pixels stay crisp; destroyed with the stage. */
export class StageTextures {
  private readonly textures = new Map<HTMLCanvasElement, Texture>();

  of(art: PaintedArt): Texture {
    return this.ofCanvas(art.canvas);
  }

  ofCanvas(canvas: HTMLCanvasElement): Texture {
    let texture = this.textures.get(canvas);
    if (!texture) {
      texture = new Texture({
        source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }),
      });
      this.textures.set(canvas, texture);
    }
    return texture;
  }

  /** Drops one canvas's texture, as the floor's when it grows. */
  forget(canvas: HTMLCanvasElement): void {
    this.textures.get(canvas)?.destroy(true);
    this.textures.delete(canvas);
  }

  destroy(): void {
    for (const texture of this.textures.values()) texture.destroy(true);
    this.textures.clear();
  }
}

/** Swaps the sprite's art, its anchor pixel staying where the sprite stands. */
export function setArt(sprite: Sprite, textures: StageTextures, art: PaintedArt): void {
  const texture = textures.of(art);
  if (sprite.texture !== texture) sprite.texture = texture;
  sprite.anchor.set(art.anchorX / texture.width, art.anchorY / texture.height);
}

/** Shows `art` with its anchor pixel on `at`, in the world's art pixels. */
export function showArt(
  sprite: Sprite,
  textures: StageTextures,
  art: PaintedArt,
  at: FloorPoint,
): void {
  setArt(sprite, textures, art);
  sprite.position.set(at.x, at.y);
}

/** A culled sprite of `art` at `at`, tinted by the hour's light unless it gives off its own. */
export function artSprite(
  textures: StageTextures,
  art: PaintedArt,
  at: FloorPoint,
  tint: number | null,
): Sprite {
  const sprite = new Sprite();
  sprite.cullable = true;
  showArt(sprite, textures, art, at);
  if (tint !== null) sprite.tint = tint;
  return sprite;
}
