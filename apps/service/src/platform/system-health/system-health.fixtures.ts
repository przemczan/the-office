import { ManualSchedule } from "../schedule/schedule.fixtures.js";
import { FakeWorkstation } from "../workstation/workstation.fixtures.js";
import { OfficeProcess, type EventLoopDelay } from "./office-process.js";
import { HEALTH_READING_INTERVAL_MS, SystemHealthRecorder } from "./system-health-recorder.js";

/** A process whose CPU time, memory and event loop delay the test sets. */
export class FakeOfficeProcess extends OfficeProcess {
  cpuMs = 0;
  delay: EventLoopDelay = { p99Ms: 0, maxMs: 0 };
  residentBytes = 300 * 1024 ** 2;
  heapUsedBytes = 120 * 1024 ** 2;
  started = false;

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.started = false;
  }

  takeEventLoopDelay(): EventLoopDelay {
    const delay = this.delay;
    this.delay = { p99Ms: 0, maxMs: 0 };
    return delay;
  }

  cpuTimeMs(): number {
    return this.cpuMs;
  }

  memory(): { readonly residentBytes: number; readonly heapUsedBytes: number } {
    return { residentBytes: this.residentBytes, heapUsedBytes: this.heapUsedBytes };
  }
}

export const START = new Date("2026-03-01T10:00:00.000Z");

export interface RecorderForTests {
  readonly recorder: SystemHealthRecorder;
  readonly schedule: ManualSchedule;
  readonly workstation: FakeWorkstation;
  readonly officeProcess: FakeOfficeProcess;
  /** Moves both clocks on by `ms`, 5 s unless told: the workstation's and the Schedule's. */
  pass(ms?: number): void;
  /** Moves the clocks on 5 s and takes a reading. */
  readingAfterAStep(): ReturnType<SystemHealthRecorder["takeReading"]>;
}

/** A recorder on a two-core fake workstation and a fake process, its clocks at `START`. */
export function recorderForTests(): RecorderForTests {
  const schedule = new ManualSchedule();
  schedule.setTime(START);
  const workstation = new FakeWorkstation(true);
  const officeProcess = new FakeOfficeProcess();
  const recorder = new SystemHealthRecorder(schedule, workstation, officeProcess);
  const pass = (ms = HEALTH_READING_INTERVAL_MS): void => {
    workstation.clock += ms;
    schedule.setTime(new Date(schedule.now().getTime() + ms));
  };
  return {
    recorder,
    schedule,
    workstation,
    officeProcess,
    pass,
    readingAfterAStep: () => {
      pass();
      return recorder.takeReading();
    },
  };
}
