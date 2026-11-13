import { Router } from "express";
import { ObjectId, type Filter, type Sort } from "mongodb";

import { getDb } from "../db/mongodb.js";
import { HttpError } from "../lib/http-error.js";
import {
  escapeRegex,
  isHttpUrl,
  isRecord,
  readNumber,
  readParam,
  readString,
  readStringArray,
} from "../lib/validate.js";
import { requireMutationAuth, requireSession } from "../middleware/require-auth.js";
import {
  normalizeCategory,
  toStudioResponse,
  type StudioCategory,
  type StudioDocument,
} from "../types/studio.js";

export const studiosRouter = Router();

const studios = () => getDb().collection<StudioDocument>("studios");

type StudioInput = {
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

function parseStudioInput(body: unknown): StudioInput {
  if (!isRecord(body)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid request body.");
  }

  const errors: string[] = [];

  const title = readString(body.title);
  const category = normalizeCategory(body.category);
  const hourlyRate = readNumber(body.hourlyRate);
  const securityDeposit = readNumber(body.securityDeposit);
  const capacity = readNumber(body.capacity);
  const location = readString(body.location);
  const imageUrl = readString(body.imageUrl);
  const description = readString(body.description);
  const amenities = readStringArray(body.amenities);

  if (title.length < 3 || title.length > 100) {
    errors.push("Title must be between 3 and 100 characters.");
  }

  if (!category) {
    errors.push("Please choose a valid studio category.");
  }

  if (hourlyRate === null || hourlyRate <= 0 || hourlyRate > 100000) {
    errors.push("Hourly rate must be a positive number.");
  }

  if (securityDeposit === null || securityDeposit < 0) {
    errors.push("Security deposit cannot be negative.");
  }

  if (capacity === null || capacity < 1 || capacity > 10000) {
    errors.push("Capacity must be at least one person.");
  }

  if (location.length < 3 || location.length > 160) {
    errors.push("Location must be between 3 and 160 characters.");
  }

  if (!isHttpUrl(imageUrl)) {
    errors.push("Please provide a valid image URL starting with http or https.");
  }

  if (amenities.length === 0) {
    errors.push("Please add at least one amenity.");
  }

  if (amenities.length > 20) {
    errors.push("Please list no more than 20 amenities.");
  }

  if (description.length < 20 || description.length > 2000) {
    errors.push("Overview must be between 20 and 2000 characters.");
  }

  if (errors.length > 0) {
    throw new HttpError(400, "VALIDATION_ERROR", errors.join(" "));
  }

  return {
    title,
    category: category as StudioCategory,
    hourlyRate: hourlyRate as number,
    securityDeposit: securityDeposit as number,
    capacity: capacity as number,
    location,
    imageUrl,
    amenities,
    description,
  };
}

function parseObjectId(value: string): ObjectId {
  if (!ObjectId.isValid(value)) {
    throw new HttpError(400, "INVALID_STUDIO_ID", "Invalid studio id.");
  }

  return new ObjectId(value);
}

/** GET /api/studios - public list with search, filters and pagination. */
studiosRouter.get("/", async (request, response, next) => {
  try {
    const filter: Filter<StudioDocument> = {};

    const search = readString(request.query.q ?? request.query.search);
    const categoryValue = readString(request.query.category);
    const minPrice = readNumber(request.query.minPrice);
    const maxPrice = readNumber(request.query.maxPrice);
    const limitValue = readNumber(request.query.limit);
    const limit = limitValue ? Math.min(Math.max(Math.trunc(limitValue), 1), 60) : 24;

    if (search) {
      const pattern = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ title: pattern }, { location: pattern }];
    }

    if (categoryValue) {
      const category = normalizeCategory(categoryValue);

      if (!category) {
        throw new HttpError(400, "INVALID_CATEGORY", "Unknown studio category.");
      }

      filter.category = category;
    }

    if (minPrice !== null || maxPrice !== null) {
      filter.hourlyRate = {};

      if (minPrice !== null) {
        filter.hourlyRate.$gte = Math.max(minPrice, 0);
      }

      if (maxPrice !== null) {
        filter.hourlyRate.$lte = Math.max(maxPrice, 0);
      }
    }

    const sortValue = readString(request.query.sort);
    let sort: Sort = { createdAt: -1 };

    if (sortValue === "price-low") {
      sort = { hourlyRate: 1 };
    } else if (sortValue === "price-high") {
      sort = { hourlyRate: -1 };
    }

    const [documents, count] = await Promise.all([
      studios().find(filter).sort(sort).limit(limit).toArray(),
      studios().countDocuments(filter),
    ]);

    response.json({
      studios: documents.map(toStudioResponse),
      count,
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/studios/mine - listings owned by the logged-in user. */
studiosRouter.get("/mine", requireSession, async (request, response, next) => {
  try {
    const documents = await studios()
      .find({ hostId: request.authUser?.id ?? "" })
      .sort({ createdAt: -1 })
      .toArray();

    response.json({
      studios: documents.map(toStudioResponse),
      count: documents.length,
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/studios/:id - public studio details. */
studiosRouter.get("/:id", async (request, response, next) => {
  try {
    const id = parseObjectId(readParam(request.params.id));
    const studio = await studios().findOne({ _id: id });

    if (!studio) {
      throw new HttpError(404, "STUDIO_NOT_FOUND", "This studio does not exist.");
    }

    response.json({ studio: toStudioResponse(studio) });
  } catch (error) {
    next(error);
  }
});

/** POST /api/studios - create a listing for the logged-in host. */
studiosRouter.post("/", requireMutationAuth, async (request, response, next) => {
  try {
    const user = request.authUser;

    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Please log in to continue.");
    }

    const input = parseStudioInput(request.body);
    const now = new Date();

    const document: StudioDocument = {
      _id: new ObjectId(),
      ...input,
      // Ownership always comes from the verified session, never from the body.
      hostId: user.id,
      hostName: user.name,
      hostEmail: user.email,
      openTime: "08:00",
      closeTime: "22:00",
      rating: 0,
      reviewCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await studios().insertOne(document);

    response.status(201).json({ studio: toStudioResponse(document) });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/studios/:id - update an owned listing. */
studiosRouter.patch("/:id", requireMutationAuth, async (request, response, next) => {
  try {
    const user = request.authUser;

    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Please log in to continue.");
    }

    const id = parseObjectId(readParam(request.params.id));
    const studio = await studios().findOne({ _id: id });

    if (!studio) {
      throw new HttpError(404, "STUDIO_NOT_FOUND", "This studio does not exist.");
    }

    if (studio.hostId !== user.id) {
      throw new HttpError(403, "FORBIDDEN", "You can only edit your own studios.");
    }

    const input = parseStudioInput(request.body);

    await studios().updateOne(
      { _id: id },
      {
        $set: {
          ...input,
          updatedAt: new Date(),
        },
      }
    );

    const updated = await studios().findOne({ _id: id });

    response.json({ studio: updated ? toStudioResponse(updated) : null });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/studios/:id - delete an owned listing. */
studiosRouter.delete("/:id", requireMutationAuth, async (request, response, next) => {
  try {
    const user = request.authUser;

    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Please log in to continue.");
    }

    const id = parseObjectId(readParam(request.params.id));
    const studio = await studios().findOne({ _id: id });

    if (!studio) {
      throw new HttpError(404, "STUDIO_NOT_FOUND", "This studio does not exist.");
    }

    if (studio.hostId !== user.id) {
      throw new HttpError(403, "FORBIDDEN", "You can only delete your own studios.");
    }

    await studios().deleteOne({ _id: id });

    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
