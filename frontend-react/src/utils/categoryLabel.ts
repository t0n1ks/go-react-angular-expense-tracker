// Resolves a category's DISPLAY name.
//
// Built-in/default categories carry a `translation_key` (set by the backend) and
// render in the current UI language, so switching the app language retranslates
// them everywhere. User-created categories have no key and are shown exactly as
// the user typed them — never translated.
export interface CategoryLike {
  name?: string;
  translation_key?: string | null;
}

export function categoryLabel(
  cat: CategoryLike | null | undefined,
  t: (key: string) => string,
  fallback = '',
): string {
  if (!cat) return fallback;
  if (cat.translation_key) return t(cat.translation_key);
  return cat.name || fallback;
}
