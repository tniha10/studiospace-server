import "dotenv/config";

import { ObjectId } from "mongodb";

import { client, connectToDatabase, getDb } from "../db/mongodb.js";
import type { StudioCategory, StudioDocument } from "../types/studio.js";

type SeedStudio = {
  title: string;
  category: StudioCategory;
  hourlyRate: number;
  securityDeposit: number;
  capacity: number;
  location: string;
  imageUrl: string;
  amenities: string[];
  description: string;
};

const studios: SeedStudio[] = [
  {
    title: "Sunlit Portrait Studio",
    category: "photo-studio",
    hourlyRate: 75,
    securityDeposit: 150,
    capacity: 8,
    location: "Brooklyn, New York",
    imageUrl:
      "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",
    amenities: [
      "Seamless backdrops",
      "Profoto lighting kit",
      "Makeup station",
      "Fast WiFi",
      "Street parking",
    ],
    description:
      "A bright corner studio with tall windows, three seamless backdrops, and a full Profoto lighting kit. Ideal for portraits, lookbooks, and small product shoots. A private makeup station and styling rack are included.",
  },
  {
    title: "Riverside Sound Stage",
    category: "sound-stage",
    hourlyRate: 180,
    securityDeposit: 500,
    capacity: 30,
    location: "Los Angeles, California",
    imageUrl:
      "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=1200&q=80",
    amenities: [
      "White cyclorama",
      "Lighting grid",
      "Loading dock",
      "Green room",
      "Sound blankets",
    ],
    description:
      "A versatile stage for film, commercial, and music video shoots. The space includes a white cyclorama, a pre-rigged lighting grid, a loading dock, and a private green room for talent. Crew parking is available on site.",
  },
  {
    title: "The Quiet Mic Podcast Room",
    category: "podcast-room",
    hourlyRate: 45,
    securityDeposit: 100,
    capacity: 4,
    location: "Austin, Texas",
    imageUrl:
      "https://images.unsplash.com/photo-1478737270239-2f02b77fc618?auto=format&fit=crop&w=1200&q=80",
    amenities: [
      "Four Shure microphones",
      "Acoustic treatment",
      "Headphone mixer",
      "Remote guest setup",
    ],
    description:
      "A treated room built for clear conversation. Four microphones, a headphone mixer, and a remote-guest setup are ready to record. The room fits up to four people and is quiet enough for long-form interviews.",
  },
  {
    title: "Northside Music Suite",
    category: "music-suite",
    hourlyRate: 95,
    securityDeposit: 250,
    capacity: 6,
    location: "Chicago, Illinois",
    imageUrl:
      "https://images.unsplash.com/photo-1598653222000-6b7b7a552625?auto=format&fit=crop&w=1200&q=80",
    amenities: [
      "Mixing desk",
      "Isolation booth",
      "Drum kit",
      "Upright piano",
      "Studio monitors",
    ],
    description:
      "A comfortable suite for recording, rehearsing, and mixing. The control room has a mixing desk and studio monitors, while the live room includes a drum kit and an upright piano. An isolation booth is available for vocals.",
  },
  {
    title: "Maker's Art Workshop",
    category: "art-workshop",
    hourlyRate: 55,
    securityDeposit: 120,
    capacity: 15,
    location: "Portland, Oregon",
    imageUrl:
      "https://images.unsplash.com/photo-1452860606245-08befc0ff44b?auto=format&fit=crop&w=1200&q=80",
    amenities: [
      "Easels and worktables",
      "Utility sinks",
      "Kiln access",
      "Natural light",
      "Tool wall",
    ],
    description:
      "An open, light-filled workshop for classes, painting, and hands-on making. Long worktables, easels, utility sinks, and a tool wall are included. Kiln access can be arranged with the host for ceramic projects.",
  },
  {
    title: "Daylight Content Studio",
    category: "photo-studio",
    hourlyRate: 110,
    securityDeposit: 200,
    capacity: 12,
    location: "Miami, Florida",
    imageUrl:
      "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1200&q=80",
    amenities: [
      "Floor-to-ceiling windows",
      "Seamless paper",
      "Tethering station",
      "Styling rack",
      "Freight elevator",
    ],
    description:
      "A modern studio with floor-to-ceiling windows and strong daylight all morning. It includes seamless paper, a tethering station, and a styling rack, making it a strong fit for editorial, e-commerce, and social content shoots.",
  },
];

async function main() {
  await connectToDatabase();

  const db = getDb();
  const users = db.collection("user");

  const configuredEmail = process.env.SEED_HOST_EMAIL?.trim();
  const host = configuredEmail
    ? await users.findOne({ email: configuredEmail })
    : await users.findOne({});

  if (!host) {
    console.error(
      configuredEmail
        ? `No user found with email "${configuredEmail}". Register that account first, then run the seed again.`
        : "No users found. Register an account in the app first, then run the seed again."
    );
    process.exitCode = 1;
    return;
  }

  const hostId = String(host._id);
  const hostName = typeof host.name === "string" ? host.name : "StudioSpace Host";
  const hostEmail = typeof host.email === "string" ? host.email : "";

  const collection = db.collection<StudioDocument>("studios");
  let inserted = 0;
  let skipped = 0;

  for (const [index, studio] of studios.entries()) {
    const existing = await collection.findOne({ title: studio.title });

    if (existing) {
      skipped += 1;
      continue;
    }

    const now = new Date();

    await collection.insertOne({
      _id: new ObjectId(),
      ...studio,
      hostId,
      hostName,
      hostEmail,
      openTime: "08:00",
      closeTime: "22:00",
      rating: 0,
      reviewCount: 0,
      createdAt: new Date(now.getTime() - index * 86_400_000),
      updatedAt: now,
    });

    inserted += 1;
  }

  console.log(
    `[seed] ${inserted} inserted, ${skipped} skipped. Host: ${hostName} <${hostEmail}>`
  );
}

main()
  .catch((error) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.close();
  });
