// jsdom has no matchMedia, which the appearance reads for the system's light or dark: the system
// is light here, and a test that needs it otherwise stubs its own.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) satisfies MediaQueryList;
}

// jsdom has no ResizeObserver, which what opens from a trigger, such as a select's list, places by;
// a test that needs sizes measured stubs its own.
if (typeof globalThis.ResizeObserver !== "function") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
