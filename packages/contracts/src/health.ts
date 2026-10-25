import { z } from "zod";

export const healthReportSchema = z.object({ database: z.enum(["up", "down"]) });
export type HealthReport = z.infer<typeof healthReportSchema>;
