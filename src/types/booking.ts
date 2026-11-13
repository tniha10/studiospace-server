import type { ObjectId } from "mongodb";

export const BOOKING_STATUSES = [
  "Pending",
  "Confirmed",
  "Completed",
  "Cancelled",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type BookingDocument = {
  _id: ObjectId;
  studioId: ObjectId;
  studioTitle: string;
  userId: string;
  userName: string;
  userEmail: string;
  date: string;
  startTime: string;
  endTime: string;
  hours: number;
  hourlyRate: number;
  totalPrice: number;
  status: BookingStatus;
  createdAt: Date;
};

export type BookingResponse = Omit<BookingDocument, "_id" | "studioId"> & {
  id: string;
  studioId: string;
};

export function toBookingResponse(booking: BookingDocument): BookingResponse {
  const { _id, studioId, ...rest } = booking;

  return {
    id: _id.toString(),
    studioId: studioId.toString(),
    ...rest,
  };
}
