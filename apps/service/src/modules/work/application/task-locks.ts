import { Injectable } from "@nestjs/common";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";

/**
 * One lock per Task, keyed by its id, shared across modules: the user's switch of a Stage waiting
 * for a Stand-in Engine (Pipelines) and the Task's resume as its usage window resets or its engine
 * frees (Work) take it, so neither moves a Task the other is moving.
 */
@Injectable()
export class TaskLocks extends KeyedLocks {}
