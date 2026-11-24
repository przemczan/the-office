/** A start, a stop or a settings change that breaks the Actions' rules, with every reason. */
export class ActionRunRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "ActionRunRefused";
  }
}

/** No Action run, Action or Project by that id or key. */
export class ActionRunNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionRunNotFound";
  }

  static run(id: string): ActionRunNotFound {
    return new ActionRunNotFound(`There is no Action run "${id}".`);
  }

  static action(projectName: string, key: string): ActionRunNotFound {
    return new ActionRunNotFound(`${projectName} has no Action with the key "${key}".`);
  }

  static project(projectId: string): ActionRunNotFound {
    return new ActionRunNotFound(`There is no Project "${projectId}".`);
  }
}
