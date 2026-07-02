// Chapter kinds that belong to the story reading timeline. Everything else
// (cover/nav/toc/colophon/introduction/illustration/title/afterword/extra) is
// front/back matter and must not be treated as story spine.
export const BODY_CHAPTER_KINDS = new Set(["chapter", "prologue", "epilogue", "interlude"]);

export function isBodyChapterKind(kind: string): boolean {
  return BODY_CHAPTER_KINDS.has(kind);
}
