// How the companion's Lottie UFO (assets/companion/UFO_404.json, 800×800
// canvas) is played inside the widget.

/**
 * The part of the 800×800 canvas the saucer and its light beam ever occupy
 * over the whole loop (≈ x 130–670, y 248–777), padded and squared — so the
 * UFO fills its box crisply instead of floating in empty canvas.
 */
export const UFO_VIEWBOX = '120 236 560 560';

/** Still frame shown when the user prefers reduced motion. */
export const UFO_STILL_FRAME = 0;

/** Loop normally; under reduced motion show one still frame instead. */
export function ufoPlayerOptions(reduceMotion: boolean): { loop: boolean; autoplay: boolean; stillFrame: number | null } {
  return reduceMotion
    ? { loop: false, autoplay: false, stillFrame: UFO_STILL_FRAME }
    : { loop: true, autoplay: true, stillFrame: null };
}
