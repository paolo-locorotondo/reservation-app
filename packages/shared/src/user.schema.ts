import { z } from "zod";
import { RoleSchema } from "./enums.js";

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  role: RoleSchema,
});
export type User = z.infer<typeof UserSchema>;
