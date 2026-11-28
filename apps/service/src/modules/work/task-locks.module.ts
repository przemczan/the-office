import { Module } from "@nestjs/common";
import { TaskLocks } from "./application/task-locks.js";

/** Imported by each module that moves a Task under its lock; one instance across them. */
@Module({ providers: [TaskLocks], exports: [TaskLocks] })
export class TaskLocksModule {}
