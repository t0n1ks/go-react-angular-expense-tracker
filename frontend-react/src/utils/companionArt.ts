// Which art each drifting companion entity uses. Each switch is the ONE place
// that picks its entity's look; the previous asset stays in the repo, so going
// back is a one-line change here (the cow and the calendar independently).

/** 'lottie' = assets/companion/cow-drink-milk.json · 'sprite' = assets/pixelcow.png */
export const COW_ART: 'lottie' | 'sprite' = 'lottie';

/** 'png' = assets/companion/calendar.png · 'svg' = the built-in pixel calendar */
export const CALENDAR_ART: 'png' | 'svg' = 'png';

/**
 * The part of the cow animation's 1920×1080 canvas the cow ever occupies
 * (≈ x 746–1176, y 66–874: the hop at the start, the straw on top, the shadow
 * underneath), padded — a tall box. The milk bottle flies in from outside it.
 */
export const COW_VIEWBOX = '720 50 490 840';

/** Still frame under reduced motion: the cow sitting with its milk. */
export const COW_STILL_FRAME = 240;
