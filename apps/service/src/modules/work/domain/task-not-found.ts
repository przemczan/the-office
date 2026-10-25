export class TaskNotFound extends Error {
  constructor(readonly taskId: string) {
    super(`There is no Task "${taskId}".`);
    this.name = "TaskNotFound";
  }
}
