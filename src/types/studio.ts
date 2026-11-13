import type { ObjectId } from "mongodb";

export const STUDIO_CATEGORY_SLUGS = [
  "photo-studio",
  "sound-stage",
  "podcast-room",
  "music-suite",
  "art-workshop",
] as const;

export type StudioCategory = (typeof STUDIO_CATEGORY_SLUGS)[number];

// Accepts the slugs used by the frontend and the labels from the assignment.
const CATEGORY_ALIASES: Record<string, StudioCategory> = {
  "photo-studio": "photo-studio",
  "photo studio": "photo-studio",
  "photography studio": "photo-studio",
  "photo studios": "photo-studio",
  "sound-stage": "sound-stage",
  "sound stage": "sound-stage",
  "film stage": "sound-stage",
  "film stages": "sound-stage",
  "podcast-room": "podcast-room",
  "podcast room": "podcast-room",
  "podcast lounge": "podcast-room",
  "podcast rooms": "podcast-room",
  "music-suite": "music-suite",
  "music suite": "music-suite",
  "music studio": "music-suite",
  "music suites": "music-suite",
  "art-workshop": "art-workshop",
  "art workshop": "art-workshop",
  workshop: "art-workshop",
  "art workshops": "art-workshop",
};

export function normalizeCategory(value: unknown): StudioCategory | null {
  if (typeof value !== "string") {
    return null;
  }

  return CATEGORY_ALIASES[value.trim().toLowerCase()] ?? null;
}

export type StudioDocument = {
  _id: ObjectId;
  title: string;
  category: StudioCategory;
  hourlyRate: number;
  securityDeposit: number;
  capacity: number;
  location: string;
  imageUrl: string;
  amenities: string[];
  description: string;
  hostId: string;
  hostName: string;
  hostEmail: string;
  openTime: string;
  closeTime: string;
  rating: number;
  reviewCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type StudioResponse = Omit<StudioDocument, "_id"> & {
  id: string;
};

export function toStudioResponse(studio: StudioDocument): StudioResponse {
  const { _id, ...rest } = studio;

  return { id: _id.toString(), ...rest };
}
