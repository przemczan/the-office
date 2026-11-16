# Live view surface: map

**Owns:** the Live view page (`/live-view`, last surface on the rail; [the adopted design](../../../../../docs/design/live-view.html) and its decisions in `docs/design/README.md`, "Live view: what it proposes", are its UI spec): The Office drawn as an isometric pixel-art office, each person filling a Role a figure at a desk, drawn in place by their state in the light of the hour where the browser is. `live-view-page.tsx` joins the snapshot with the Roles (`office-people.ts`: `OfficePerson`, the titles and the names), loads the PixiJS stage, holds the nameplates, the zoom buttons, the List toggle and which popover is open. `live-view-types.ts` holds the shapes every part shares, the stage's contract (`OfficeStage`, `StageView`) included.

- **Art** (`art/`): pure grids of palette indexes painted to canvases, cached by shape and palette (`pixel-grid.ts`), the art's palette and the Avatar's tint (`palettes.ts`: `avatarToneIndex` is `Avatar.jsx`'s hash, `toneColours` reads the ramp tokens), the furniture, the floor and walls (`floor-art.ts`), the figures generated from a Role key (`figures.ts`), and the sign, bubble, Z, "+N" tag and glyphs (`overlays.ts`). `CREDITS.md` records the art as The Office's own, GPL-3.0-only, and pixi.js (MIT) as the renderer.
- **The floor plan** (`floor-plan.ts`, pure): groups (front desk, Consultants, everyone else, each in hire order), pods, the floor's size, the meeting spot, the chill area, the door and the tiles furniture blocks; `addHire` and `letGo` change a laid-out floor without moving anyone. `office-geometry.ts` places it in the art's pixels.
- **The hours** (design decisions 11–13; pure): `light.ts`'s `lightAt(now)` is the light: the browser's time zone (`browserZone()`) to a place through `zones.json`, then the phase, the tint (dawn and dusk ramps by the sun's height, white from 14°, steps of 8), the lamps, the glow, the sky in the windows and the sunlight on the floor. `sun.ts` is NOAA's solar equations (sunrise, sunset and civil twilight in minutes after local midnight, polar days and nights, white nights). `zones.json` is generated, never hand-edited: tzdb's `zone1970.tab` and its links (public domain) by `npm run live-view-zones` (`tools/live-view-zones`). A zone it has no place for (`Etc/*`, `UTC`, unknown) gives noon's day light all day. `time-chip.tsx` shows the phase and the clock, with the day's sunrise and sunset in its Tooltip.
- **States and words** (`live-states.ts`, pure): the look state (asleep after 30 idle minutes, just joined for the first hour, gone home at night), each figure's placement and pose, the monitors and the tag, the state in words, the links to someone's work (the Decision first) and the canvas's summary with the phase and the local clock; `walksAtLightChange` decides whether a change of light walks people.
- **Walks** (pure, no Pixi): `routes.ts` finds a way round the furniture, four ways along the floor's tiles (`findTiles`, a breadth-first search, null when there is none), and `routeBetween` turns it into points with the step out of a chair and into the next. `walkers.ts` is the state machine of everyone on the floor: `direct` sends each walker where its placement says (the first time, and under the still office, by a jump), `step` walks them at 2.4 tiles a second, and `poseOf`, `depthOf`, `doorOpen`, `visitorsOf`, `conversations` and `sparkles` are what the stage draws from it. `walkers.direct` replaced 35341bed's `moveFigure`.
- **The view** (`view.ts`, `figure-hit.ts`, pure): whole device pixels per art pixel, fit, the 80px clamp, zoom round a point, pinch; the hit test, front-most first.
- **The stage** (`office-stage.ts`, `stage-scene.ts`, `stage-textures.ts`, `stage-input.ts`): the PixiJS application, its sprites sorted by depth, the one ticker (which steps the walkers, moves the walking figures and their nameplates, opens the door and fades the tint), and the canvas's own pointer, wheel, touch and key handling. The scene is built again whenever a walker sets off, arrives or is gone; in between only walking figures move. `setLight` (given before the first `apply`, then each minute) tints the art, shows the sky sprite over the windows, the sunlight on the floor, desk lamps and the odd pizza box, and the additive glow layer.
- **The rest of the page:** `time-chip.tsx`, `nameplate.tsx` (nameplates, the `Tooltip`, the `Popover` of someone's work), `people-list.tsx` (the list, a column or, at 844px or less, a `Drawer`), `work-links.tsx` (a `WorkTarget` as a router link), `press-words.ts`, `use-reduced-motion.ts`, `live-view.css`.

**Talks to:** `api/live-view.ts` (`liveViewQueries.snapshot()`, kept whole by `live-view.changed`; only this page reads it, so an Office nobody watches does no extra reads); People's `roleQueries.list()` (Task limit, Consultant, chat, Avatar, `hiredAt`); Work's Task and Initiative lists (titles); the shell's `useClock`, `useNarrowPage`, `PersonAvatar` and page heading; `@the-office/ui`'s `Tooltip`, `Popover` (held open by `open`/`onOpenChange`, so a press on the canvas opens a nameplate's), `Drawer` and `IconButton`.

**Going home** (a5cefa95) uses the walkers as they are: a `gone` placement walks the person out of the door and leaves them hidden with their desk kept; any other placement for a hidden walker walks them back in; and every move through the door in one `direct` (into or out of `gone`, hires, those let go) waits `0.3 + 1.1 × n` seconds in hire order (someone caught mid-walk waits where they stand, `isOnTheMove`, drawn in the walk cycle), so nightfall's "everyone idle goes home" leaves one by one and dawn comes back one by one.

**Traps:**

- pixi.js loads only through the page's dynamic `import("./office-stage.ts")`, so it is a chunk of its own and jsdom never loads it: nothing the page imports statically may import pixi.js or the stage files. Page tests mock `office-stage.ts`. Pixi's init asks for WebGL (`preference`), so a browser without it rejects and the page says the floor can't be drawn and opens the list, rather than falling back silently.
- Art colours are numbers (`0xRRGGBB`), Pixi's own form: they are sprite data, an exception to spec 4.1's "tokens only", which holds for everything else on the page, nameplates and list included. The clothes' tint is read from the ramp tokens so it always matches the Avatar.
- Two depth rules from the design: furniture blocks every tile it stands on (the routes fd27cb9e adds need it), and long furniture (the sofa, the long coffee table) sorts by its front-left corner, not its middle.
- Zoom is always a whole number of device pixels per art pixel (half only when the office doesn't fit at one), with nearest-neighbour textures, so pixels stay crisp; never set a scale view.ts didn't give.
- The ticker runs only while the page is open and the tab visible, and never under reduced motion, where the still office is drawn with `app.render()` only when the snapshot, the size, the view or the minute changes.
- `lookOf`'s draw order must never change: it is what makes the same Role key draw the same figure everywhere.
- The floor is laid out once per page open; a hire takes a free desk of their group or a new pod at the right end, and nobody else moves while the page is open.
- Routes are searched only in `walkers.direct` and `setFloor`, never per frame, and a frame allocates nothing per walker: `step` answers a reused array, `poseOf` writes into the walker. Only the walkers that moved touch their sprite and nameplate.
- A walk that changes course mid-way starts from the tile underfoot only when it is walkable, else from the next route point's tile, else the last one's: halfway out of a chair a figure stands on the desk's tile, and routing from there would cross the desk.
- Getting up from a seat or sitting down in one, a figure keeps the seat's depth until it is a step away (`depthOf`), so a chair or the sofa never covers it.
- Outside the room (x < 0.1) a figure is drawn in the doorway container, clipped to the doorway and over the open door (whose opening is opaque), and its nameplate is hidden. Nameplates of walking figures move by `onFigureMove` writing `style.transform` straight into the DOM, never through React state.
- The Consultant turns round, and anyone talks, only once the asker has arrived: the scene works out desk activity and conversations from the walkers (`visitorsOf`, `conversations`), not from the snapshot's placement.
- The place comes only from `Intl.DateTimeFormat().resolvedOptions().timeZone`: nothing reads `navigator.geolocation`, nothing asks permission, there is no setting and nothing is sent anywhere (`light.test.ts` spies on the location).
- Untinted on purpose (design decision 2): lit screens, the lamp bulb, the windows' sky, the exit sign, the "+N" tag and the overlays (sign, bubble, Z). Everything else, the cached floor and walls texture included, takes `light.tint`.
- People walk out at nightfall and in at dawn only when the crossing is seen live (`walksAtLightChange`: the previous light under 2 minutes old, and the tab visible, as a hidden tab's clock still ticks). After a hidden tab or a sleeping machine they are put in place, so a whole office doesn't walk at once. Any other change of light (dawn to day, lamps on) walks what the minute changed, as `apply` does.
- Dawn resets the asleep clock: asleep counts from `max(idleSince, light.dawnAt)`, so those back at dawn sit in the chill area for 30 minutes first; the words still count from `idleSince`.
- `home` gives a `gone` placement and keeps the desk; a let-go is told apart by the snapshot's keys, never by the placement. A desk nobody sits at has its chair pushed in and its monitors dark.
- Reduced motion remakes the stage (the page's `canvasKey`), so turning it on mid-walk puts everyone in place at once; `walkers.settle()` does the same for a stage that stays.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Files

### ./

- `figure-hit.ts`: FigureHitBox, FigureAnchor, NAMEPLATE_BELOW_FEET, figureAt, figureAnchor
- `floor-plan.ts`: AISLE_ROW, DESK_GROUPS, groupOf, PodShape, podShapeFor, layoutOffice, deskOf, placeDesk, addHire, letGo, deskSpot, pushedInSpot, consultSpot, DOOR_OUTSIDE, amenitiesOf, Walkable, walkableOf, isWalkable
- `light.ts`: browserZone, placeOfZone, lightOfDay, lightAt
- `live-states.ts`: ASLEEP_AFTER_MINUTES, NEW_FOR_MINUTES, isNewHire, lookStateOf, SeenLight, walksAtLightChange, lookStatesOf, deskActivity, deskPoseOf, placementsOf, DeskMonitors, monitorsOf, PersonNames, agentWords, stateWords, workLinksOf, LIST_GROUPS, LOOK_STATE_ORDER, PHASE_WORDS, clockWords, summaryWords
- `live-view-page.tsx`: LiveViewPage
- `live-view-types.ts`: OfficePerson, LookState, Phase, Sky, Place, SunDay, Light, DeskGroup, FloorPoint, Spot, PodColumn, Desk, Layout, Facing, Seat, AmenityKind, Amenity, Amenities, FigurePose, DeskActivity, Placement, RecordTitles, WorkTarget, WorkLink, FigureAnchor, StageView, OfficeStageOptions, OfficeStage, CreateOfficeStage
- `live-view.fixtures.ts`: DAY_LIGHT, NIGHT_LIGHT, ROSTER, HIRED_LONG_AGO, officePerson, rosterOf, FLOOR_SIZES, floorPeopleOf
- `nameplate.tsx`: NameplatesProps, placeNameplate, Nameplates
- `office-geometry.ts`: ArtRect, OfficeGeometry, officeGeometryOf, officeBounds, toArt
- `office-people.ts`: officePeopleOf, recordTitlesOf, personNamesOf, ShownPerson, shownPeopleOf
- `office-stage.ts`: createOfficeStage
- `people-list.tsx`: PeopleListProps, PeopleList
- `press-words.ts`: directLinkOf, pressWords
- `routes.fixtures.ts`: spotsOf, blockedCrossings
- `routes.ts`: RouteFloor, routeFloorOf, findTiles, routeBetween, routeLength
- `stage-input.ts`: StageInputTarget, attachStageInput
- `stage-scene.ts`: SceneInput, PlacedFigure, OfficeScene
- `stage-textures.ts`: StageTextures, setArt, showArt, artSprite
- `sun.ts`: SunPosition, sunAt, zoneOffsetMinutes, localMinutes, sunDay, sunElevation, phaseAt, instantOfMinutes
- `time-chip.tsx`: TimeChip
- `use-reduced-motion.ts`: useReducedMotion, useNoHover
- `view.ts`: Framing, View, Point, FIT_MARGINS, createView, zoomLevels, scaleOf, nearestLevel, frameBounds, fitView, clampView, panBy, zoomTo, zoomStep, pinchTo, figureFrame, frameFigure, resizeView, zoomPercent, canZoomIn, canZoomOut, artOrigin, toCanvas, toArtPoint
- `walkers.ts`: WALK_SPEED, OUTSIDE, WalkPose, Walker, Sparkle, WalkerEvents, Walkers, placementKey, createWalkers
- `work-links.tsx`: workLinkOptions, WorkLinks
- Tests: figure-hit.full.test.ts, floor-plan.test.ts, light.test.ts, live-states.full.test.ts, live-view-page.test.tsx, routes.test.ts, sun.test.ts, view.full.test.ts, walkers.full.test.ts, walkers.test.ts

### art/

- `figures.ts`: seedOf, seededRandom, pickFrom, FIGURE, F, SKINS, HAIRS, TROUSERS, SHOES, BUILDS, HAIR_STYLES, TOPS, ACCESSORIES, LAYERS, Build, HairStyle, Top, Accessory, FigureLayer, FigureLook, lookOf, figureColors, figurePaletteKey, figureShapeKey, FigureFrame, figureFrame, paintFigure, ArmPixel, armPixels, LegPixels, legPixels, paintTorso, paintHead, paintHairFront, paintHairBack, paintAccessory, figureShape, paintedFigure
- `floor-art.ts`: Windows, windowsOf, paintFloorLayer, paintSunPatches, paintWalls
- `furniture.ts`: monitorSlots, deskShape, screenShape, chairSeatShape, ChairBackSide, chairBackShape, sofaShape, beanbagShape, coffeeTableShape, meetingTableShape, coffeeMachineShape, waterCoolerShape, plantShape, bookshelfShape, printerShape, lampShape, pizzaShape, doorShape
- `iso.ts`: HALF_W, HALF_H, WALL_H, DESK_H, isoX, isoY
- `overlays.ts`: O, OVERLAY_PALETTE, OVERLAY_PALETTE_LIGHT_OUTLINE, GLYPHS, Glyph, paintGlyphs, paintedOverlay, signShape, bubbleShape, zShape, tagShape, sparkleShape
- `palettes.ts`: ART_COLORS, ArtColorName, ART, ART_PALETTE, artPalette, SKY_PALETTES, paintedOfficeArt, GroupArt, GROUP_ART, AvatarTone, AVATAR_TONE_COUNT, avatarToneIndex, toneColours, avatarTone
- `pixel-grid.ts`: Palette, GridPoint, PixelGrid, ArtShape, TilePoint, IsoPen, isoPen, IsoBounds, isoShape, mix, darker, lighter, paintGrid, PaintedArt, paintedArt, forgetPaintedArt
- Tests: figures.test.ts
