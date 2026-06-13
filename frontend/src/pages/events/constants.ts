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

export const EVENT_COLORS: Record<string, string> = {
  symptom: "bg-yellow-500",
  diagnosis: "bg-red-500",
  hospitalization: "bg-purple-500",
  surgery: "bg-pink-500",
  treatment: "bg-blue-500",
  follow_up: "bg-cyan-500",
  emergency: "bg-red-600",
  pregnancy: "bg-rose-400",
  chronic_condition: "bg-orange-500",
  injury: "bg-amber-500",
  screening: "bg-green-500",
  other: "bg-gray-500",
};
