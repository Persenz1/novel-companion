// Chapter kinds that belong to the story / structured-extraction timeline.
// Front/back matter can still be readable book material; it just must not be
// treated as story evidence for drafting/review.
export const BODY_CHAPTER_KINDS = new Set(["chapter", "prologue", "epilogue", "interlude"]);

export function isBodyChapterKind(kind: string): boolean {
  return BODY_CHAPTER_KINDS.has(kind);
}

/** True when a chapter should be shown to readers and reviewed by cleaning. */
export function isReadableChapterKind(_kind: string): boolean {
  return true;
}
