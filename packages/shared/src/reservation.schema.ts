import { z } from "zod";
import { ReservationStatusSchema } from "./enums.js";
import { SpotSchema } from "./spot.schema.js";

export const ReservationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  spotId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: ReservationStatusSchema,
  createdAt: z.string(),
});
export type Reservation = z.infer<typeof ReservationSchema>;

export const ReservationWithSpotSchema = ReservationSchema.extend({
  spot: SpotSchema,
});
export type ReservationWithSpot = z.infer<typeof ReservationWithSpotSchema>;

export const CreateReservationSchema = z.object({
  spotId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});
export type CreateReservationDto = z.infer<typeof CreateReservationSchema>;

export const ReservationsRangeQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type ReservationsRangeQuery = z.infer<typeof ReservationsRangeQuerySchema>;

export const MAX_DAYS_AHEAD = 30;
