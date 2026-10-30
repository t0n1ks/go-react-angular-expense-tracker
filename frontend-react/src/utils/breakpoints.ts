// Shared layout breakpoints, so pages that split content between them can
// never disagree (a card shown in both places, or in neither).

/** Phone + tablet: the summary cards live in Statistics as tiles. */
export const COMPACT_QUERY = '(max-width: 1024px)';

/** Laptop + desktop (the complement): the summary cards stay on Home, and the
 *  companion's cosmos screen takes the stats grid's free cell. Keep in sync
 *  with the matching media queries in Dashboard.css. */
export const WIDE_QUERY = '(min-width: 1025px)';
