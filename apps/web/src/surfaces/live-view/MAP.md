# Live view surface: map

**Owns:** the Live view page (`/live-view`, last surface on the rail; [the adopted design](../../../../../docs/design/live-view.html) and its decisions in `docs/design/README.md`, "Live view: what it proposes", are its UI spec): The Office drawn as an isometric pixel-art office, each person filling a Role a figure at a desk, drawn in place by their state with day light only. `live-view-page.tsx` joins the snapshot with the Roles (`office-people.ts`: `OfficePerson`, the titles and the names), loads the PixiJS stage, holds the nameplates, the zoom buttons, the List toggle and which popover is open. `live-view-types.ts` holds the shapes every part shares, the stage's contract (`OfficeStage`, `StageView`) included.

- **Art** (`art/`): pure grids of palette indexes painted to canvases, cached by shape and palette (`pixel-grid.ts`), the art's palette and the Avatar's tint (`palettes.ts`: `avatarToneIndex` is `Avatar.jsx`'s hash, `toneColours` reads the ramp tokens), the furniture, the floor and walls (`floor-art.ts`), the figures generated from a Role key (`figures.ts`), and the sign, bubble, Z, "+N" tag and glyphs (`overlays.ts`). `CREDITS.md` records the art as The Office's own, GPL-3.0-only, and pixi.js (MIT) as the renderer.
- **The floor plan** (`floor-plan.ts`, pure): groups (front desk, Consultants, everyone else, each in hire order), pods, the floor's size, the meeting spot, the chill area, the door and the tiles furniture blocks; `addHire` and `letGo` change a laid-out floor without moving anyone. `office-geometry.ts` places it in the art's pixels.
- **States and words** (`live-states.ts`, pure): the look state (asleep after 30 idle minutes, just joined for the first hour), each figure's placement and pose, the monitors and the tag, the state in words, the links to someone's work (the Decision first) and the canvas's summary. `light.ts`'s `lightAt` is the light.
- **The view** (`view.ts`, `figure-hit.ts`, pure): whole device pixels per art pixel, fit, the 80px clamp, zoom round a point, pinch; the hit test, front-most first.
- **The stage** (`office-stage.ts`, `stage-scene.ts`, `stage-textures.ts`, `stage-input.ts`): the PixiJS application, its sprites sorted by depth, the one ticker, and the canvas's own pointer, wheel, touch and key handling.
- **The rest of the page:** `nameplate.tsx` (nameplates, the `Tooltip`, the `Popover` of someone's work), `people-list.tsx` (the list, a column or, at 844px or less, a `Drawer`), `work-links.tsx` (a `WorkTarget` as a router link), `press-words.ts`, `use-reduced-motion.ts`, `live-view.css`.

**Talks to:** `api/live-view.ts` (`liveViewQueries.snapshot()`, kept whole by `live-view.changed`; only this page reads it, so an Office nobody watches does no extra reads); People's `roleQueries.list()` (Task limit, Consultant, chat, Avatar, `hiredAt`); Work's Task and Initiative lists (titles); the shell's `useClock`, `useNarrowPage`, `PersonAvatar` and page heading; `@the-office/ui`'s `Tooltip`, `Popover` (held open by `open`/`onOpenChange`, so a press on the canvas opens a nameplate's), `Drawer` and `IconButton`.

**Seams for the Tasks after it:** movement (fd27cb9e) replaces `moveFigure` in `stage-scene.ts`, which snaps a figure into place, and uses `figures.ts`'s walk frames and `floor-plan.ts`'s `walkableOf`, `DOOR_INSIDE`/`DOOR_OUTSIDE`; day and night (a5cefa95) replaces `light.ts`, reaches `lookStateOf`'s `home`, and draws `furniture.ts`'s lamp and pizza shapes, ported but not drawn yet.

**Traps:**

- pixi.js loads only through the page's dynamic `import("./office-stage.ts")`, so it is a chunk of its own and jsdom never loads it: nothing the page imports statically may import pixi.js or the stage files. Page tests mock `office-stage.ts`. Pixi's init asks for WebGL (`preference`), so a browser without it rejects and the page says the floor can't be drawn and opens the list, rather than falling back silently.
- Art colours are numbers (`0xRRGGBB`), Pixi's own form: they are sprite data, an exception to spec 4.1's "tokens only", which holds for everything else on the page, nameplates and list included. The clothes' tint is read from the ramp tokens so it always matches the Avatar.
- Two depth rules from the design: furniture blocks every tile it stands on (the routes fd27cb9e adds need it), and long furniture (the sofa, the long coffee table) sorts by its front-left corner, not its middle.
- Zoom is always a whole number of device pixels per art pixel (half only when the office doesn't fit at one), with nearest-neighbour textures, so pixels stay crisp; never set a scale view.ts didn't give.
- The ticker runs only while the page is open and the tab visible, and never under reduced motion, where the still office is drawn with `app.render()` only when the snapshot, the size, the view or the minute changes.
- `lookOf`'s draw order must never change: it is what makes the same Role key draw the same figure everywhere.
- The floor is laid out once per page open; a hire takes a free desk of their group or a new pod at the right end, and nobody else moves while the page is open.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Files

### ./

- `figure-hit.ts`: FigureHitBox, FigureAnchor, figureAt, figureAnchor
- `floor-plan.ts`: AISLE_ROW, DESK_GROUPS, groupOf, PodShape, podShapeFor, layoutOffice, deskOf, placeDesk, addHire, letGo, nextDeskOf, deskSpot, pushedInSpot, consultSpot, DOOR_INSIDE, DOOR_OUTSIDE, amenitiesOf, Walkable, walkableOf, isWalkable
- `light.ts`: lightAt
- `live-states.ts`: ASLEEP_AFTER_MINUTES, NEW_FOR_MINUTES, isNewHire, lookStateOf, lookStatesOf, placementsOf, DeskMonitors, monitorsOf, PersonNames, agentWords, stateWords, workLinksOf, LIST_GROUPS, LOOK_STATE_ORDER, summaryWords
- `live-view-page.tsx`: LiveViewPage
- `live-view-types.ts`: OfficePerson, LookState, Light, DeskGroup, FloorPoint, Spot, PodColumn, Desk, Layout, Facing, Seat, AmenityKind, Amenity, Amenities, FigurePose, DeskActivity, Placement, RecordTitles, WorkTarget, WorkLink, FigureAnchor, StageView, OfficeStageOptions, OfficeStage, CreateOfficeStage
- `live-view.fixtures.ts`: ROSTER, HIRED_LONG_AGO, officePerson, rosterOf
- `nameplate.tsx`: NameplatesProps, Nameplates
- `office-geometry.ts`: ArtRect, OfficeGeometry, officeGeometryOf, officeBounds, toArt
- `office-people.ts`: officePeopleOf, recordTitlesOf, personNamesOf, ShownPerson, shownPeopleOf
- `office-stage.ts`: createOfficeStage
- `people-list.tsx`: PeopleListProps, PeopleList
- `press-words.ts`: directLinkOf, pressWords
- `stage-input.ts`: StageInputTarget, attachStageInput
- `stage-scene.ts`: SceneInput, OfficeScene
- `stage-textures.ts`: StageTextures, setArt, showArt, artSprite
- `use-reduced-motion.ts`: useReducedMotion, useNoHover
- `view.ts`: Framing, View, Point, FIT_MARGINS, createView, zoomLevels, scaleOf, nearestLevel, frameBounds, fitView, clampView, panBy, zoomTo, zoomStep, pinchTo, figureFrame, frameFigure, resizeView, zoomPercent, canZoomIn, canZoomOut, artOrigin, toCanvas, toArtPoint
- `work-links.tsx`: workLinkOptions, WorkLinks
- Tests: figure-hit.full.test.ts, floor-plan.test.ts, live-states.full.test.ts, live-view-page.test.tsx, view.full.test.ts

### art/

- `figures.ts`: seedOf, seededRandom, pickFrom, FIGURE, F, SKINS, HAIRS, TROUSERS, SHOES, BUILDS, HAIR_STYLES, TOPS, ACCESSORIES, LAYERS, Build, HairStyle, Top, Accessory, FigureLayer, FigureLook, lookOf, figureColors, figurePaletteKey, figureShapeKey, FigureFrame, figureFrame, paintFigure, ArmPixel, armPixels, LegPixels, legPixels, paintTorso, paintHead, paintHairFront, paintHairBack, paintAccessory, figureShape, paintedFigure
- `floor-art.ts`: Windows, windowsOf, paintFloorLayer, paintWalls
- `furniture.ts`: monitorSlots, deskShape, screenShape, chairSeatShape, ChairBackSide, chairBackShape, sofaShape, beanbagShape, coffeeTableShape, meetingTableShape, coffeeMachineShape, waterCoolerShape, plantShape, bookshelfShape, printerShape, lampShape, pizzaShape, doorShape
- `iso.ts`: HALF_W, HALF_H, WALL_H, DESK_H, isoX, isoY
- `overlays.ts`: O, OVERLAY_PALETTE, OVERLAY_PALETTE_LIGHT_OUTLINE, GLYPHS, Glyph, paintGlyphs, paintedOverlay, signShape, bubbleShape, zShape, tagShape, sparkleShape
- `palettes.ts`: ART_COLORS, ArtColorName, ART, ART_PALETTE, artPalette, paintedOfficeArt, GroupArt, GROUP_ART, AvatarTone, AVATAR_TONE_COUNT, avatarToneIndex, toneColours, avatarTone
- `pixel-grid.ts`: Palette, GridPoint, PixelGrid, ArtShape, TilePoint, IsoPen, isoPen, IsoBounds, isoShape, mix, darker, lighter, paintGrid, PaintedArt, paintedArt, forgetPaintedArt
- Tests: figures.test.ts
