// The profile avatars — one registry: id → image, in display order. The
// header chip and the profile dialog both read from here; the backend accepts
// exactly these ids (handlers.validAvatars). "" (no avatar) = the
// first-letter circle.
import shark from '../assets/avatars/shark.png';
import koala from '../assets/avatars/koala.png';
import giraffe from '../assets/avatars/giraffe.png';
import seaLion from '../assets/avatars/sea-lion.png';
import rabbit from '../assets/avatars/rabbit.png';
import eagle from '../assets/avatars/eagle.png';
import cow from '../assets/avatars/cow.png';
import hippopotamus from '../assets/avatars/hippopotamus.png';
import alien from '../assets/avatars/alien.png';

export const AVATARS: ReadonlyArray<{ id: string; src: string }> = [
  { id: 'shark', src: shark },
  { id: 'koala', src: koala },
  { id: 'giraffe', src: giraffe },
  { id: 'sea-lion', src: seaLion },
  { id: 'rabbit', src: rabbit },
  { id: 'eagle', src: eagle },
  { id: 'cow', src: cow },
  { id: 'hippopotamus', src: hippopotamus },
  { id: 'alien', src: alien },
];

const BY_ID = new Map(AVATARS.map(a => [a.id, a.src]));

/** The image for an avatar id, or undefined for "" / an unknown id (→ letter). */
export function avatarSrc(id: string | null | undefined): string | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** The name the app shows: the display name, else the username. */
export function shownName(user: { username: string; displayName?: string } | null | undefined): string {
  return (user?.displayName || user?.username || '').trim();
}
