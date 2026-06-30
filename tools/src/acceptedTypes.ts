// Accepted type -> file mapping (docs/modules/bookpack-data.md), shared by the
// Validator and the AcceptedStore so the two never drift.

export const ACCEPTED_TYPE_FILES: Array<{ type: string; file: string }> = [
  { type: "entity", file: "accepted/entities.jsonl" },
  { type: "fact", file: "accepted/facts.jsonl" },
  { type: "event", file: "accepted/events.jsonl" },
  { type: "relation_change", file: "accepted/relation_changes.jsonl" },
  { type: "metric", file: "accepted/metrics.jsonl" },
  { type: "metric_change", file: "accepted/metric_changes.jsonl" },
  { type: "character_card", file: "accepted/character_cards.jsonl" },
  { type: "term_card", file: "accepted/term_cards.jsonl" },
  { type: "speaker_label", file: "accepted/speaker_labels.jsonl" },
  { type: "asset_subject", file: "accepted/asset_subjects.jsonl" },
];

const TYPE_TO_FILE = new Map(ACCEPTED_TYPE_FILES.map((e) => [e.type, e.file]));

/** File path for an accepted type, or undefined if the type is not accepted. */
export function acceptedFileFor(type: string): string | undefined {
  return TYPE_TO_FILE.get(type);
}
