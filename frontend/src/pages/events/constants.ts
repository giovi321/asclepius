export const EVENT_TYPES = [
  "symptom",
  "diagnosis",
  "hospitalization",
  "surgery",
  "treatment",
  "follow_up",
  "emergency",
  "pregnancy",
  "chronic_condition",
  "injury",
  "screening",
  "other",
];

// Event-type dot colors collapsed onto the semantic tokens (DESIGN.md);
// hue-adjacent types intentionally share an accent.
export const EVENT_COLORS: Record<string, string> = {
  symptom: "bg-warning",
  diagnosis: "bg-destructive",
  hospitalization: "bg-cat-violet",
  surgery: "bg-cat-violet",
  treatment: "bg-info",
  follow_up: "bg-cat-teal",
  emergency: "bg-destructive",
  pregnancy: "bg-primary",
  chronic_condition: "bg-warning",
  injury: "bg-warning",
  screening: "bg-success",
  other: "bg-muted-foreground",
};
