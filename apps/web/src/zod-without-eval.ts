import { z } from "zod";

// The pages allow no `eval` (spec §6, "The web app's pages"), yet zod tries `new Function` once to
// see whether it may compile its object parsers, which the browser reports as a Content-Security-
// Policy violation even though zod catches it. Each object schema reads this setting as it is made,
// so it is set before any is: this module is main.tsx's first import, and imports zod alone.
z.config({ jitless: true });
