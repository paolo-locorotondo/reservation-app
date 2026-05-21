import { z } from "zod";

export const RoleSchema = z.enum(["USER", "ADMIN"]);
export type Role = z.infer<typeof RoleSchema>;

export const SpotTypeSchema = z.enum(["PARKING", "DESK"]);
export type SpotType = z.infer<typeof SpotTypeSchema>;

export const ReservationStatusSchema = z.enum(["ACTIVE", "CANCELLED"]);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;
