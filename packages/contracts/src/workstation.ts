import { z } from "zod";

const percentSchema = z.number().min(0).max(100);
const bytesSchema = z.number().int().nonnegative();

/** How busy the CPU was since the service's last read, overall and per logical core, in %. */
export const cpuUseSchema = z.object({
  percent: percentSchema,
  perCore: z.array(percentSchema),
});
export type CpuUse = z.infer<typeof cpuUseSchema>;

/** The operating system's load average over 1, 5 and 15 minutes. */
export const loadAverageSchema = z.object({
  oneMinute: z.number().nonnegative(),
  fiveMinutes: z.number().nonnegative(),
  fifteenMinutes: z.number().nonnegative(),
});
export type LoadAverage = z.infer<typeof loadAverageSchema>;

/** The computer The Office runs on, as the Workstation figure shows it. */
export const workstationLoadSchema = z.object({
  cpu: z.object({
    model: z.string(),
    speedMhz: z.number().int().nonnegative(),
    cores: z.number().int().positive(),
    /** Null until a second read gives a time to measure over ("Measuring…"). */
    use: cpuUseSchema.nullable(),
    /** Null where the operating system has none (Windows). */
    loadAverage: loadAverageSchema.nullable(),
  }),
  memory: z.object({
    totalBytes: bytesSchema,
    availableBytes: bytesSchema,
    usedBytes: bytesSchema,
  }),
  /** The service's own resident memory. */
  officeMemoryBytes: bytesSchema,
  uptimeSeconds: z.number().nonnegative(),
});
export type WorkstationLoad = z.infer<typeof workstationLoadSchema>;
