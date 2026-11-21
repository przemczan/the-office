/** A launch, or a settings change, that breaks the Test instances' rules, with every reason. */
export class TestInstanceRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "TestInstanceRefused";
  }
}

/** No Test instance, or no Initiative, by that id. */
export class TestInstanceNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestInstanceNotFound";
  }

  static instance(id: string): TestInstanceNotFound {
    return new TestInstanceNotFound(`There is no Test instance "${id}".`);
  }

  /** Not one of a Built instance's files, or its files were removed. */
  static file(id: string): TestInstanceNotFound {
    return new TestInstanceNotFound(`The Test instance "${id}" has no such file to download.`);
  }

  static initiative(id: string): TestInstanceNotFound {
    return new TestInstanceNotFound(`There is no Initiative "${id}".`);
  }
}
