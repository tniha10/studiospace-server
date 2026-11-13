import { Router } from "express";
import { MongoServerError, ObjectId } from "mongodb";
import type { ClientSession } from "mongodb";

import { client, getDb } from "../db/mongodb.js";
import {
  MAX_BOOKING_HOURS,
  intervalsOverlap,
  minutesToHours,
  timeToMinutes,
  validateBookingWindow,
} from "../lib/booking-time.js";
import { HttpError } from "../lib/http-error.js";
import { isDateString, isRecord, readParam, readString } from "../lib/validate.js";
import { requireMutationAuth, requireSession } from "../middleware/require-auth.js";
import {
  toBookingResponse,
  type BookingDocument,
  type BookingStatus,
} from "../types/booking.js";
import type { StudioDocument } from "../types/studio.js";

export const bookingsRouter = Router();

const bookings = () => getDb().collection<BookingDocument>("bookings");
const studios = () => getDb().collection<StudioDocument>("studios");

// One lock document per studio + date. Writing it inside the transaction makes
// two simultaneous booking requests conflict, so MongoDB retries one of them
// and the overlap check sees the other booking.
const bookingLocks = () =>
  getDb().collection<{ _id: string; updatedAt: Date }>("booking_locks");

const ACTIVE_STATUSES: BookingStatus[] = ["Pending", "Confirmed"];

type BookingInput = {
  studioId: ObjectId;
  studioTitle: string;
  date: string;
  startTime: string;
  endTime: string;
  hours: number;
  hourlyRate: number;
  totalPrice: number;
};

function parseBookingInput(body: unknown): {
  studioId: ObjectId;
  date: string;
  startTime: string;
  endTime: string;
} {
  if (!isRecord(body)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid request body.");
  }

  const studioIdValue = readString(body.studioId);
  const date = readString(body.date);
  const startTime = readString(body.startTime);
  const endTime = readString(body.endTime);

  if (!ObjectId.isValid(studioIdValue)) {
    throw new HttpError(400, "INVALID_STUDIO_ID", "Invalid studio id.");
  }

  if (!isDateString(date)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Please choose a valid date.");
  }

  const today = new Date().toISOString().slice(0, 10);

  if (date < today) {
    throw new HttpError(400, "VALIDATION_ERROR", "The booking date cannot be in the past.");
  }

  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Please choose valid start and end times.");
  }

  return {
    studioId: new ObjectId(studioIdValue),
    date,
    startTime,
    endTime,
  };
}

async function findOverlap(
  studioId: ObjectId,
  date: string,
  startTime: string,
  endTime: string,
  session?: ClientSession
): Promise<BookingDocument | null> {
  const requestedStart = timeToMinutes(startTime);
  const requestedEnd = timeToMinutes(endTime);

  if (requestedStart === null || requestedEnd === null) {
    return null;
  }

  const activeBookings = await bookings()
    .find(
      { studioId, date, status: { $in: ACTIVE_STATUSES } },
      session ? { session } : undefined
    )
    .toArray();

  for (const booking of activeBookings) {
    const existingStart = timeToMinutes(booking.startTime);
    const existingEnd = timeToMinutes(booking.endTime);

    if (existingStart === null || existingEnd === null) {
      continue;
    }

    if (
      intervalsOverlap(requestedStart, requestedEnd, existingStart, existingEnd)
    ) {
      return booking;
    }
  }

  return null;
}

function isTransactionUnsupported(error: unknown): boolean {
  return (
    error instanceof MongoServerError &&
    (error.code === 20 ||
      error.message.includes("Transaction numbers are only allowed"))
  );
}

/** GET /api/bookings/mine - bookings that belong to the logged-in user. */
bookingsRouter.get("/mine", requireSession, async (request, response, next) => {
  try {
    const documents = await bookings()
      .find({ userId: request.authUser?.id ?? "" })
      .sort({ date: -1, startTime: -1 })
      .toArray();

    response.json({
      bookings: documents.map(toBookingResponse),
      count: documents.length,
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/bookings - create a Pending booking with server-side pricing. */
bookingsRouter.post("/", requireMutationAuth, async (request, response, next) => {
  try {
    const user = request.authUser;

    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Please log in to continue.");
    }

    const input = parseBookingInput(request.body);
    const studio = await studios().findOne({ _id: input.studioId });

    if (!studio) {
      throw new HttpError(404, "STUDIO_NOT_FOUND", "This studio does not exist.");
    }

    const windowError = validateBookingWindow(
      input.startTime,
      input.endTime,
      studio.openTime,
      studio.closeTime
    );

    if (windowError) {
      throw new HttpError(400, "INVALID_BOOKING_TIME", windowError);
    }

    const start = timeToMinutes(input.startTime);
    const end = timeToMinutes(input.endTime);

    if (start === null || end === null) {
      throw new HttpError(400, "INVALID_BOOKING_TIME", "Invalid booking times.");
    }

    const hours = minutesToHours(end - start);

    if (hours <= 0 || hours > MAX_BOOKING_HOURS) {
      throw new HttpError(400, "INVALID_BOOKING_TIME", "Invalid booking duration.");
    }

    // The browser may send a price, but we always use the current studio rate.
    const totalPrice = Math.round(hours * studio.hourlyRate * 100) / 100;

    const bookingDocument: BookingDocument = {
      _id: new ObjectId(),
      studioId: studio._id,
      studioTitle: studio.title,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      hours,
      hourlyRate: studio.hourlyRate,
      totalPrice,
      status: "Pending",
      createdAt: new Date(),
    };

    const overlapError = new HttpError(
      409,
      "BOOKING_OVERLAP",
      "That time is already booked for this studio. Please choose another slot."
    );

    const lockId = `${studio._id.toString()}:${input.date}`;
    const session = client.startSession();

    try {
      await session.withTransaction(async () => {
        // Serialize all bookings for this studio and date.
        await bookingLocks().updateOne(
          { _id: lockId },
          { $set: { updatedAt: new Date() } },
          { upsert: true, session }
        );

        const overlap = await findOverlap(
          studio._id,
          input.date,
          input.startTime,
          input.endTime,
          session
        );

        if (overlap) {
          throw overlapError;
        }

        await bookings().insertOne(bookingDocument, { session });
      });
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      // Standalone MongoDB servers (no replica set) cannot run transactions.
      // Fall back to a check-then-insert so the project still works locally.
      if (isTransactionUnsupported(error)) {
        await bookingLocks().updateOne(
          { _id: lockId },
          { $set: { updatedAt: new Date() } },
          { upsert: true }
        );

        const overlap = await findOverlap(
          studio._id,
          input.date,
          input.startTime,
          input.endTime
        );

        if (overlap) {
          throw overlapError;
        }

        await bookings().insertOne(bookingDocument);
      } else {
        throw error;
      }
    } finally {
      await session.endSession();
    }

    response.status(201).json({ booking: toBookingResponse(bookingDocument) });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/bookings/:id/cancel - cancel one of your Pending bookings. */
bookingsRouter.patch(
  "/:id/cancel",
  requireMutationAuth,
  async (request, response, next) => {
    try {
      const user = request.authUser;

      if (!user) {
        throw new HttpError(401, "UNAUTHORIZED", "Please log in to continue.");
      }

      const id = readParam(request.params.id);

      if (!ObjectId.isValid(id)) {
        throw new HttpError(400, "INVALID_BOOKING_ID", "Invalid booking id.");
      }

      const booking = await bookings().findOne({ _id: new ObjectId(id) });

      if (!booking) {
        throw new HttpError(404, "BOOKING_NOT_FOUND", "This booking does not exist.");
      }

      if (booking.userId !== user.id) {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "You can only cancel your own bookings."
        );
      }

      if (booking.status !== "Pending") {
        throw new HttpError(
          409,
          "CANCEL_NOT_ALLOWED",
          "Only pending bookings can be cancelled."
        );
      }

      await bookings().updateOne(
        { _id: booking._id },
        { $set: { status: "Cancelled" } }
      );

      const updated = await bookings().findOne({ _id: booking._id });

      response.json({
        booking: updated ? toBookingResponse(updated) : null,
      });
    } catch (error) {
      next(error);
    }
  }
);
