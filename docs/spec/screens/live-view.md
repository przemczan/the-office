# Live view

Covers: the Live view page, the office floor (isometric pixel-art office drawn with PixiJS), figures and what they do, the hours and light, nameplates and their tooltip and popover, the List of people, zoom, the fire alarm on the floor, reduced motion, states.

## Where it is

- Route: `/live-view`.
- Open it from the Live view item in the rail, its last item ([shell.md](shell.md)).
- The page title is "Live view"; its crumb is "1 person" or "N people".
- The Project filter in the top bar doesn't narrow it: it shows The Office as a whole.

## Layout

- The floor fills the page: the canvas, with the time chip at its top left, the zoom group, the nameplates over the figures and, at the bottom, a toolbar with the **List** button.
- The List opens as a column beside the floor, or, on a narrow page (844px or less), as a drawer over it.
- The page reads one snapshot of everyone filling a Role now, joined with the Roles; a danger alert with the service's message shows over the floor when either read fails.

## The office floor

- Each person filling a Role is a figure at a desk in an isometric pixel-art office. Someone let go isn't in the snapshot: they walk out and are gone.
- The figure is drawn from the person's Role key, so the same Role is the same figure everywhere; its clothes' tint matches the person's Avatar.
- Desks are grouped: the front desk, the Consultants, everyone else, each in hire order. A hire takes a free desk of their group or a new pod at the right end; nobody else moves while the page is open.
- Furniture blocks the tiles it stands on; people walk round it (4 directions, 2.4 tiles a second).
- The room stands on a slab, its two front sides showing, on an open floor whose boards, in line with the room's, run on to the canvas's edges, with the slab's soft shadow on it; only the room's back and left walls stand. The open floor takes the hour's tint with the room; the shadow doesn't change with the hour.
- The floor has a door, windows, desk lamps, an entertainment area (a big TV on a low stand with a games console and three floor pillows), a chill area (sofa, beanbags, coffee table), an exercise mat, a coffee machine, a water cooler, plants and bookshelves.
- The canvas is an image named by a summary: "8 people: 2 working, 1 waiting on you, 5 gone home. Night, 22:30." While the fire alarm is on: "8 people: the fire alarm is on, everyone is out of the office. Day, 10:00." (or "nobody is in the office" with no one).
- Keyboard help, read to screen readers: "Drag or use the arrow keys to move round the office; the wheel, + and − zoom; 0 shows the whole office."
- If the browser can't draw it (no WebGL), the page says "The floor can't be drawn in this browser." and opens the List.

## What a person is doing

- A person's look state decides where they sit or stand. States, in the List's order: **Waiting on you**, **Consulting**, **Working**, **Just joined**, **Idle**, **Asleep at their desk**, **Gone home**.
- Waiting on you: the person has an open Decision on the user (raising a hand at the desk); words "Waiting on you: a Decision on <Task or Initiative>" or "…: a Stage of <Task> is out of tries" for The Office's own Decision.
- Consulting: the person asked a Consultant; words `Asking <Consultant>: "<question>"` ("Asking a Consultant" when it can't be named). The asker walks to the Consultant's desk and they talk once the asker has arrived; when two or more ask one Consultant, the first asks at the Consultant's desk and the rest wait at their own.
- Working: words "Working on <sessions>" where each session reads "a Stage of <the Task>", the Task or Initiative's title, or "a Consultation for <asker>" ("The Office" when it asked), each followed by " on <engine>" and ", standing in for <engine>" on a Stand-in Engine; hovering the link shows why.
- A working person with other sessions still running when waiting says "; still working on …".
- Just joined: for the first hour after the hire, "Just joined: at their new desk"; the nameplate shows **New**.
- Idle: words "Idle: <what>", "Idle" alone with nothing picked. An idle person spends their time in turns of 4 to 8 minutes, each a pastime picked by a seed from the Role key and the turn, never the same twice in a row: having a coffee, having a cup of water, relaxing or chatting on the sofa, on their phone in a beanbag, doing jumping jacks, squats or push-ups, browsing the bookshelf, watering a plant, playing games, stretching at their desk. A pastime whose spots are all taken falls back to the next, ending at the desk.
- Asleep at their desk: a nap, picked only after 30 minutes idle: "Asleep at their desk: idle for 30 minutes or more".
- Gone home: at night every idle person has gone home: "Gone home for the night: idle". They walk out of the door one by one at nightfall and back in one by one at dawn, staggered in hire order.
- Still figures turn their heads now and then; someone at the coffee machine or the water cooler sips. Two browsers show the same, since both are seeded by the Role key and the wall clock.
- Monitors on a desk are lit while the person works; a "+N" tag shows when a person has several sessions.
- A person walks only when the change is seen live (the tab visible); after a hidden tab or a sleeping machine everyone is put in place at once.

## The hours and light

- The floor is drawn in the light of the hour where the browser is: phases **Day**, **Dusk**, **Night**, **Dawn**, with sunrise, sunset and civil twilight worked out from the browser's time zone (a place from a built-in table; nothing asks for the browser's location and nothing is sent anywhere).
- Dawn and dusk tint the art; at night lamps are on; the windows show the sky and sunlight falls on the floor by day. Lit screens, lamp bulbs, the sky, the exit sign and overlays are never tinted.
- A time zone with no place (`UTC`, `Etc/*`, unknown) gives day light all day.
- The light changes each minute.

## Time chip

- Top left of the floor: an icon for the phase, the phase in bold and the clock: "Day · 14:05".
- Its tooltip (a popover opened by a tap on a screen without hover) says where the hours come from: "Sunrise <time>, sunset <time> in <zone>, worked out from this browser's time zone. At night idle people have gone home."; "No sunrise or sunset today in <zone>." on a polar day or night; "Day light all day: this browser gives no time zone to work the sun out from." or "…this browser's time zone (<zone>) has no place to work the sun out from."

## Nameplates

- Over each figure on the floor, below its feet: the Avatar, the name, **New** for the first hour and a state dot (coloured by the look state). Under a zoom of two CSS pixels per art pixel it keeps only the Avatar and the dot.
- Someone gone home has no nameplate; someone let go keeps theirs, inert, while they walk out.
- Hover or focus: a tooltip with "<name> · <title>", the state words, each session's line when there are several, and what a press does: "Click to open the Decision", "Click to open their work" or "Click to choose which work".
- A press on a figure or nameplate:
  - opens the Decision waiting on the user at once, else the person's one piece of work (a Task, an Initiative, a chat);
  - with several, opens a popover with the name, title, state words and a link for each; on a screen without hover a tap always opens the popover.
- Work links in order: each Decision waiting on the user (`Decision on <record>: "<question>"` or `The Office's Decision on …`), each put to a Consultant (`Put to <name>: "<question>"`), each running session; with none: "Chat with <name>" (when Chat is on) and "<name> on People". A target is never linked twice.
- Links go to `/tasks/$taskId`, `/work/initiatives/$initiativeId`, the chat, or `/people/$roleKey` ([task-page.md](task-page.md), [initiative-page.md](initiative-page.md), [people.md](people.md)).

## Zoom and moving

- Group "Zoom" at the floor's corner: **Zoom out** (minus), the percentage, **Zoom in** (plus), then **Fit the whole office**; each button is disabled at its limit.
- Fit the whole office, `0` and opening the page show the whole office at the largest zoom that fits inside the floor's margins, which may fall between steps (e.g. 367%); then it is drawn at the next whole step and scaled down smoothly, so every art pixel is the same size and nothing shimmers on a pan.
- Every other zoom is a whole number of device pixels per art pixel (half only when the office doesn't fit at one), so pixels stay crisp.
- Zoom in, zoom out, the wheel and pinch go from the whole-office zoom to the whole steps either side; zooming out stops at the whole-office zoom, never below half a device pixel per art pixel.
- Drag to move; arrow keys move; wheel, `+` and `−` zoom; `0` shows the whole office; pinch zooms on touch.
- The List's locate button ("Show <name> on the floor") brings that person's figure into view.

## List

- Button **List** (list icon, `aria-expanded`) at the bottom toolbar opens or closes it.
- Column: heading "People" with the count, the button **Close the list**, the floor's summary line, then groups in the look states' order, each headed "<state> · <count>" and shown only when not empty.
- On a narrow page it is a drawer titled "People · N" with the summary as its description.
- Each row: the Avatar, "<name> · <title>", a state dot and the state words, the locate button, and the person's work links.
- The locate button's label is "Show <name> on the floor"; for someone gone home it is disabled and says "<name> has gone home, so isn't on the floor". On a narrow page, showing someone closes the drawer.

## The fire alarm on the floor

- While the fire alarm is on ([2.8](../2.8-fire-alarm.md)), everyone is out of the office, desks kept, and an alarm light flashes on the left wall by the door (lit steadily under reduced motion); the summary says so.
- Under a softer way (after the current Stages or Tasks), those still at work (working, consulting, waiting on you) stay at their desks; the rest are out. The summary reads "8 people: the fire alarm is on, 2 still at work, everyone else is out of the office. Day, 10:00." ("8 still at work" when all are).
- Sounded while the page is open and visible: everyone panics on the spot (a red "!" over them), then runs out of the door one after another; at the all clear they walk back in as at dawn. Otherwise they are put out or back at once.

## Reduced motion

- With reduced motion, the still office is drawn: no walking, no animation, no ticker; it redraws only when the snapshot, the size, the view or the minute changes.

## States

- Loading: the canvas fills in once the snapshot and the Roles are loaded; the floor is first laid out then, everyone in place.
- Nobody hired: the floor shows the Caretaker alone ("1 person").
- Error: the danger alert with the service's message.
- Can't draw: "The floor can't be drawn in this browser." with the List open.
- Narrow window (844px or less): the List is a drawer; zoom and nameplates stay.

## Domain facts

- What each person is doing now and the headline state: [2.2](../2.2-people.md#what-each-person-is-doing-now), [2.2](../2.2-people.md#a-persons-headline-state-on-the-live-view).
- Decisions waiting on the user: [2.4.2](../2.4.2-decisions.md); Consultations: [2.4.3](../2.4.3-consultations.md).
- Stand-in Engines: [5.4.6](../5.4.6-stand-in-engines-and-usage-windows.md).
- The fire alarm: [2.8](../2.8-fire-alarm.md).
- PixiJS stack: [5.2](../5.2-stack.md).
