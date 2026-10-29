// How the companion's Lottie UFO (assets/companion/ufo-3d.json, 1000×1000
// canvas) is played inside the widget.

/**
 * The part of the 1000×1000 canvas the tilting 3D saucer ever occupies over
 * the whole loop (≈ x −9…1020, y 173…812 — it is wide and has no beam),
 * padded for its outline strokes and squared around its centre — so the UFO
 * fills its box crisply and is never clipped.
 */
export const UFO_VIEWBOX = '-24 -38 1060 1060';

/** Still frame shown when the user prefers reduced motion (level, mid-size). */
export const UFO_STILL_FRAME = 0;

/** Loop normally; under reduced motion show one still frame instead. */
export function ufoPlayerOptions(reduceMotion: boolean): { loop: boolean; autoplay: boolean; stillFrame: number | null } {
  return reduceMotion
    ? { loop: false, autoplay: false, stillFrame: UFO_STILL_FRAME }
    : { loop: true, autoplay: true, stillFrame: null };
}
