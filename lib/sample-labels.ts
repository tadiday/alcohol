import type { ApplicationFields } from "./label-verifier";

export const SAMPLE_APPLICATION: ApplicationFields = {
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  producerName: "Old Tom Distillery, Louisville, KY",
  countryOfOrigin: "United States",
};

export const SAMPLE_LABELS = [
  {
    id: "matching",
    name: "Matching label",
    description: "Matching details and warning text. Bold formatting still needs visual review.",
    src: "/samples/old-tom-matching.png",
  },
  {
    id: "wrong-abv",
    name: "Wrong alcohol content",
    description: "Label shows 40% ABV; application expects 45%.",
    src: "/samples/old-tom-wrong-abv.png",
  },
  {
    id: "invalid-warning",
    name: "Invalid warning heading",
    description: "Warning heading uses title case instead of all caps.",
    src: "/samples/old-tom-invalid-warning.png",
  },
] as const;

export type SampleLabel = (typeof SAMPLE_LABELS)[number];
