import { z } from "zod";

export const healthReportSchema = z.object({
  database: z.enum(["up", "down"]),
  /** Whether this service is a test instance of The Office (`OFFICE_TEST_INSTANCE`), which the web shows as a banner on every page. */
  testInstance: z.boolean(),
});
export type HealthReport = z.infer<typeof healthReportSchema>;
