# Devices: module map

**Owns:** Connected devices (spec §2.13): the record (`connected_devices`: kind, name, device key, state, why and by whom Disconnected, the error, the endpoint, a serial board's RFC 2217 address (`rfc2217_url`, while Connected), its baud rate, the round trip last kept and the helper's latest notice (`baud_rate`, `round_trip_ms`, `notice`), who connected it and when, its Task and the Task's Project), kept after it is Disconnected as the Task's history; its transitions (`domain/connected-device.ts`: Connecting → Connected at the helper's endpoint or a paired phone's adb serial, Waiting for the run environment or Disconnected; Connected ⇄ Waiting; any open → Disconnected, for good; on an open one the baud rate set, a round trip kept only when it matters (the first, one crossing `SLOW_ROUND_TRIP_MS` either way, or one at least `ROUND_TRIP_STEP_MS` (25 ms) from the one kept), a new notice; each READY's Connected clears the round trip and the notice and keeps the baud rate; `noticesOf`: `slow-round-trip` over 250 ms, then the helper's notice), each with `ConnectedDeviceChanged`, published after it is saved; connect (`ConnectedDevices.connect`, `POST /tasks/:taskId/devices`), refused with every reason in the UI's words (the Task Done or Dropped, the Project's Run environment Off, Connected devices switched off for the Project in Projects' words, "Connected devices are switched off for «…».", asked only while the Run environment is On, an Android phone over wireless debugging, which is paired instead: `WIRELESS_IS_PAIRED`, the helper not built: `DEVICE_HELPER_NOT_BUILT`) as 422, and with "Already connected to the Task «…»." as 409 with `otherTask` when an open record holds the device key, which storage refuses (a partial unique index on `device_key` while not Disconnected: insert, catch the violation, read the holder); never starting the run environment; pairing an Android phone over wireless debugging (`ConnectedDevices.pair`, `POST /tasks/:taskId/devices/wireless`: refused as connect is, `taskProblemsOf` plus `domain/wireless-address.ts`'s `wirelessAddressOf`, which refuses a name, loopback, unspecified, multicast and link-local addresses, an IPv4-mapped one weighed as IPv4, and the helper not built, as it writes the key; device key `android-wireless:<address>`, IPv6 canonical; the record Connecting named by its address, then in the background under `adb:<id>` the run environment started through `RunEnvironmentStart` when it isn't running, the one start a device makes, and `application/wireless-devices.ts`'s `WirelessDevices.pair`: `ensureAdb`, `writeKey`, `adb pair <address>:<pairing port>` with the code on stdin, `adb connect <address>:<port>` and `getprop ro.product.model`, within 30 s (`PAIRING_TIMEOUT_MS`); `phonePaired` makes it Connected, or Waiting with its serial when the environment stopped meanwhile; any other end is an error in adb's words, `ADB_MISSING` or `ADB_WITHOUT_PAIR` for adb older than 30.0); disconnect by a user (`POST /devices/:id/disconnect`, naming them) and the list (`GET /tasks/:taskId/devices`, the newest first); each device's relay socket (`DEVICE_RELAY_PATH_PATTERN`, registered with the platform's `WebSocketRoutes`, signed in): one per device (a second closed with 4409, one for a device not there or Disconnected with 4410), its binary messages device frames (`adapters/websocket/device-relay-link.ts`: from the browser only OPEN, DATA and CLOSE go to the helper, and its PONG is the service's, measuring the round trip from when that PING id went to the browser on the module's `Schedule`; the helper's HELLO, READY, ENDED and NOTICE are the service's, its OPEN, DATA, CLOSE, SETTINGS, SIGNALS and PING go to the browser in order, SETTINGS also telling the baud rate, SETTINGS and SIGNALS passed byte for byte so the browser gets the helper's `at` stamps; the application hears them as `HelperListener`'s `settingsChanged`, `roundTripMeasured` and `noticed`, saved in the device's lock without a `{"type":"state"}` to the socket; the helper's output paused while the socket holds over 1 MiB, the socket paused while the helper's input is full), its text messages `{"type":"state"}` to the browser at each change and `{"type":"unplugged"}` or `{"type":"error",problem}` from it; the helper (an Android phone's `<DEVICE_HELPER_MOUNT>/office-device-helper-<arch> relay --listen 127.0.0.1:0` as the checks' user; a serial board's `… pty --path-prefix /dev/ttyACM --owner <uid>:<gid>` as root, the owner `RunEnvironments.checksUserOf`, READY's first line, the path `/dev/ttyACM0`, its endpoint, and its second, `rfc2217://127.0.0.1:2217`, its RFC 2217 address, read by the contracts' `readyEndpoints`; attached in the Task's run environment) started as the socket opens and at each `RunEnvironmentStarted` for a device that waits with its socket open, Connected at READY's endpoint once HELLO's version is this Office's (`DeviceHelperFiles.helloProblemOf`), an error after 10 s without READY (`HELPER_START_TIMEOUT_MS`, on `Schedule`); how a device follows its Task: Waiting at `RunEnvironmentStopped` or when its helper ends as the environment stops (a phone over wireless debugging keeping its endpoint), a paired phone Waiting connected again at each `RunEnvironmentStarted` (`WirelessDevices.reconnect`: the key and `adb connect`, never pair, within 10 s, `WIRELESS_RECONNECT_TIMEOUT_MS`), or ended as device unplugged with "…pair it again." when it doesn't answer, an error with ENDED's words or the exit when the helper ends while it runs, tab closed, device unplugged, or an error with the browser's first problem as the socket closes, Task ended at `RunEnvironmentRemoved` and the Task's `TaskStateChanged` to Done or Dropped, Run environment turned Off for every device of the Project's Tasks at Projects' `ProjectRunEnvironmentChanged` to anything but On and at `ProjectFeaturesChanged` with `connected-devices` off (one path, `projectSwitchedOff`; both events may come for one change, the second finding none open); the startup sweep (`sweep`, from `office.ts`: every open relayed record ends as tab closed, as a restart drops every socket; a phone over wireless debugging goes Waiting instead); `OFFICE_CONNECTED_DEVICES` for every check (`connectedDevicesVariable`: the Connected ones as a JSON array of `{ id, kind, name, endpoint, rfc2217Url }`, `[]` with none), registered into Run environments' `RunEnvironmentCommandVariables`; the Task's devices not Disconnected in words ("Android phone over USB «Pixel 9»: Connected, at 127.0.0.1:41234"; a serial board's with `detailsOf`: "…, at /dev/ttyACM0 and rfc2217://127.0.0.1:2217; 115200 baud; round trip 40 ms; the board didn't answer after its reset"), registered into Work's `TaskConnectedDevices` for `read_task` and the Briefs; `connected-device.changed` to the web; the Project's adb key (`project_adb_keys`, `domain/adb-key.ts`: RSA-2048 and adb's public format, made at the Project's first Android connect and kept, the first kept winning a race); the adb steps in the run environment (`application/adb-in-run-environment.ts`, shared by both Android kinds: `ensureAdb` with `ADB_MISSING`, `writeKey` through the helper's `adb-key` mode with `adb kill-server` on `written`, `pair` with the code on stdin, `connect`, `modelOf`, `disconnect`, each one attach as the checks' user for at most 20 s); an Android phone over USB (`application/android-usb-devices.ts`: the steps at each READY, `adb connect` again 2 s after the relay's last channel closes while Connected, at most once per 30 s, `adb disconnect` as it ends); `adb disconnect` for a phone over wireless debugging as it ends while the run environment runs; `ANDROID_SERIAL` (`androidSerialOf`, the one Android phone of either kind Connected), registered with `unlessProjectSets`.

**Owns, Project devices** (spec §2.13 "A Project's device" to "Removing a Project device"; `application/project-devices.ts`, `ProjectDevices`, exported): each Project's devices (`project_devices`: kind, device key unique per Project by its index `project_devices_project_device_key`, insert and catch the violation, the user's name of at most 60 characters, a phone's address and Port, its state at rest, the pairing's step and problem, who added it and when, its last use), kept until removed; `domain/project-device.ts`: at rest Paired, Didn't answer, Not paired or Over USB, In use worked out from the open Connected device record naming it (`connected_devices.project_device_id`, `openOfProjectDevice`), never kept; each change with `ProjectDeviceChanged {projectId, deviceId}`, published after it is saved and reaching the web as `project-device.changed` (`adapters/websocket/project-device-web-events.ts`). Routes (`ProjectDevicesController`, the module's refusal filter, `projectDeviceRefusalSchema`'s shape: 409 with `holder` while another environment holds it, else 422; 404 for no such device): `GET`/`POST /projects/:projectId/devices` (a device over USB by its device key, Over USB, its name the browser's cut to 60; a phone over wireless debugging Not paired, named by its address, its pairing started at once), `PATCH /project-devices/:id` (rename, trimmed, 1..60; a phone's new Port, needing no pairing, Didn't answer becoming Paired), `DELETE /project-devices/:id` (204; refused while in use, naming the holder, or while it pairs), `POST /project-devices/:id/pair` (again, at the address and Port given, a new address a new device key, refused as already among the Project's), `POST /tasks/:taskId/devices/lend` (`ConnectedDevices.lend`). Adding and pairing are refused while the Project's Run environment isn't On ("Needs Run environment On: …", the Project page's words) or Connected devices is switched off (Projects' words), and for a phone an address the run environment can't reach (`wirelessAddressOf`) or the helper not built; renaming, a new Port and removing stay allowed. Pairing (detached, tracked for `settled()` in tests): `pairingStep` starting-environment, Projects' `PairingDefinitionExports` behind `PairingDefinitions` (`adapters/projects/`), Run environments' `PairingEnvironments` behind `PairingEnvironmentStart` (`adapters/run-environments/`, its log in a temp folder), then pairing: `WirelessDevices.pairIn` in the pairing environment (`AdbPlace`), reading-model once adb connected, `adb disconnect`; Paired (a name still the address becomes the model) or Not paired with adb's or the service's words; the environment, the definition and the log folder removed in a `finally`, however it ends. Lending (`ConnectedDevices.lend`): refused as a connect is (`taskProblemsOf`, the switch, the helper) as `ProjectDeviceRefused`, while it pairs, for a Task of another Project; a Task-held record with `projectDeviceId`, the device's kind, name and key: a device over USB Connecting, the browser opening its relay; a phone over wireless debugging Waiting at `adbSerialAt(address, port)`, reconnected at once (detached, `reconnectWireless`) while the Task's run environment runs, else at its next start as any paired phone; a second holder refused by the open `device_key` index, 409 with "<name> is in use by <Task title>.". Giving back: every lent record's change comes through `ConnectedDeviceChanged`, which carries `projectDeviceId` and the state: Connected is remembered in memory, Disconnected (any way it ends) sets the device's last use (the Task with its title) and its rest state (`restStateAfter`: device unplugged → Didn't answer, ever Connected → Paired, else as it was), and every change publishes `ProjectDeviceChanged`. The startup sweep (`ProjectDevices.sweep`, from `office.ts`): `PairingEnvironments.sweep()`, then every device left with a pairing step Not paired, "The pairing was cut off by a restart; pair it again.". The Project's devices in words for `list_projects`, registered into Projects' `ProjectDeviceLines`: kind, name and state ("Paired", "Didn't answer", "Not paired", "Over USB", "In use by <Task title>", ", being paired now" while it pairs), never the address or Port.

**Talks to:** Work's `TaskService` behind `DeviceTasks` (`adapters/work/`) for the Task's title, state and Project, and Work's `TaskConnectedDevices` and `TaskStateChanged`; Run environments' `RunEnvironments` (`attach`, `checksUserOf`, `isRunning`), `DeviceHelperFiles`, `RunEnvironmentCommandVariables`, its `RunEnvironmentStarted`, `RunEnvironmentStopped` and `RunEnvironmentRemoved`, and `ProjectRunEnvironments.isOn` behind `ProjectRunEnvironmentSettings` (`adapters/run-environments/`); Projects' `TaskWorktrees.startRunEnvironment` behind `RunEnvironmentStart` (`ports/run-environment-start.ts`, `adapters/projects/`), to start a Task's run environment for a pairing, `ProjectFeatures.ensureOn` for `connected-devices` behind `ProjectDeviceFeature` (`ports/project-features.ts`, `adapters/projects/`, answering `FeatureSwitchedOff`'s words), `ProjectRunEnvironmentChanged` and `ProjectFeaturesChanged`. [app.module.ts](../../app.module.ts) gives the module Work, Projects and Run environments in `imports`. Activity reads the open devices through `ConnectedDevices.open()`. For Project devices: Projects' `PairingDefinitionExports` behind `PairingDefinitions` and its `ProjectDeviceLines` registry, Run environments' `PairingEnvironments` behind `PairingEnvironmentStart`.

**Traps:**

- The frames codec is the contracts', so the byte relay is an adapter (`DeviceRelayLink`) behind the `RelayLink` port; the application never sees a frame, a close code or `ws`.
- `RunEnvironmentStarted` handlers run inside the Task's step and the bus waits for them: the start handler only attaches (`RunEnvironments.attach` takes no step) and waits for READY at most 10 s per device, never throwing; calling anything that takes the Task's step there would wait for itself.
- A stop forgets the environment before its containers stop, so a helper that ends with them finds `isRunning` false and its device waits; that is weighed as the helper ends, not later in the device's lock, so a quick next start isn't taken for an error.
- Relays live in memory: an Office restart leaves open records with no socket, which the sweep ends as tab closed. The sweep runs from `office.ts`, never at the module's start, so a test app ends nobody's devices.
- The domain can't import contracts: `HELPER_NOTICE_CODES` and `SLOW_ROUND_TRIP_MS` mirror `helperNoticeCodeSchema` and the contracts' `SLOW_ROUND_TRIP_MS`, which `devices-relay.test.ts` checks.
- A round trip that didn't matter is dropped, not saved: the kept `roundTripMs` is the last one that moved enough, so a PING every 5 s never writes the row or emits.
- The adb steps of an Android phone over USB run detached from the device's lock, under their own key `adb:<id>`: they attach for up to 20 s each, and holding the device's lock that long would stall its state changes; each step's result is weighed against the record as it is then.
- The application layer can't import contracts, so the key's frames for the helper's `adb-key` mode are built in `adapters/device-helper/adb-key-frames.ts` behind the `AdbKeyInput` port.
- The adb private key never leaves the service: it goes only into the helper's stdin, never into a log line, an event, a response or the words for `read_task`.
- A pairing code goes only into `adb pair`'s stdin (`AdbInRunEnvironment.pair`): never into the record, a log line, an event, a response, a command line, a variable or a helper frame; it is passed as an argument from the controller through `ConnectedDevices.pair`, `followPairing` and `WirelessDevices.pair`, and kept nowhere.
- A phone over wireless debugging keeps its `endpoint`, its adb serial `<address>:<port>`, while Waiting for the run environment (`deviceWaiting`, `phonePaired`): the next start reconnects there. Every other kind's endpoint is null while Waiting, and a Waiting wireless record with a null endpoint (its pairing cut off by a restart) ends as device unplugged at the next start.
- The pairing runs detached under `adb:<id>`, as the USB adb steps do, since a run environment start and adb may take long; a phone Disconnected while it paired is `adb disconnect`ed once the pairing ends. A Waiting record holds the address's device key, so pairing the same phone again, in this Task too, is refused as already connected until it is Disconnected.
- Reconnecting runs inside the `RunEnvironmentStarted` handler, so the phone is Connected before the first check, and it never throws; it never starts a run environment, only `pair` does.
- adb runs where an `AdbPlace` says (`AdbInRunEnvironment.inTask` wraps `RunEnvironments.attach`; a pairing's wraps its pairing environment's `attach`, a removed one answering undefined, which adb's steps read as not running): the steps never name a Task.
- A Project device is given back in `ProjectDevices`' `ConnectedDeviceChanged` handler, the one place every record change passes, never in the callers that end records; the bus waits for it inside `ConnectedDevices.change`, under the record's lock, so it never takes a `ConnectedDevices` lock or calls back into it, and never throws.
- Whether a lent record was ever Connected lives in memory: after a restart a lend that ends before connecting again keeps the device's rest state as it was.
- A pairing environment's start (image build included) isn't bounded; only adb's steps are, from the environment running, as a Task's pairing. A pairing left running past a Run environment turned Off ends on its own.
- The pairing code goes only into `adb pair`'s stdin, passed as an argument from the controller through `ProjectDevices.add`/`pair`, `followPairing` and `WirelessDevices.pairIn`; never into `project_devices`, an event, a response, a log line or a command line (`project-devices.test.ts` scans them all).
- `ScriptedAdb` (`adapters/scripted/`) is built, not a fixture: the end-to-end service (`src/e2e.ts`) hooks it into Run environments' scripted runtime's `onAttach` through `index.ts`, so adb answers there as a phone that pairs; `devicesTestbed` uses the same class.
- The Project device's id names its pairing environment's compose project (`office-<office>-pairing-<id>`), so one device pairs in one environment at a time; a second pairing is refused by `pairingStep` in the row's transaction.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

ConnectedDevices, CONNECTED_DEVICES_VARIABLE, DeviceToConnect, ProjectDevices, ConnectedDeviceChanged, ProjectDeviceChanged, DevicesModule, DevicesModuleOptions, ScriptedAdb

## Domain events

- `domain/connected-device-events.ts`: ConnectedDeviceChanged
- `domain/project-device-events.ts`: ProjectDeviceChanged

## HTTP routes (under `/api`)

- `GET /tasks/:taskId/devices`: DevicesController.list
- `POST /tasks/:taskId/devices`: DevicesController.connect
- `POST /tasks/:taskId/devices/wireless`: DevicesController.pair
- `POST /devices/:id/disconnect`: DevicesController.disconnect
- `GET /projects/:projectId/devices`: ProjectDevicesController.list
- `POST /projects/:projectId/devices`: ProjectDevicesController.add
- `PATCH /project-devices/:id`: ProjectDevicesController.change
- `DELETE /project-devices/:id`: ProjectDevicesController.remove
- `POST /project-devices/:id/pair`: ProjectDevicesController.pair
- `POST /tasks/:taskId/devices/lend`: ProjectDevicesController.lend

## Tables

- `adapters/postgres/connected-devices.schema.ts`: connected_devices
- `adapters/postgres/project-adb-keys.schema.ts`: project_adb_keys
- `adapters/postgres/project-devices.schema.ts`: project_devices

## Files

### ./

- `devices.fixtures.ts`: HELPER_VERSION, HELPER_ENDPOINT, PROJECT_ID, DeviceTasksForTests, RunEnvironmentSettingsForTests, DeviceFeatureForTests, RunEnvironmentStartForTests, PairingDefinitionsForTests, FakeRelaySocket, LoopbackHelperOptions, loopbackHelper, framesWrittenTo, RunEnvironmentsOfTestbed, DevicesTestbed, devicesTestbed
- `devices.module.ts`: DevicesModuleOptions, DevicesModule
- Tests: devices-project.test.ts, devices-relay.test.ts, devices-wireless.test.ts

### adapters/device-helper/

- `adb-key-frames.ts`: AdbKeyFrames

### adapters/http/

- `device-refusals.filter.ts`: DeviceRefusalsFilter
- `devices.controller.ts`: DevicesController, deviceResponse
- `project-devices.controller.ts`: ProjectDevicesController, projectDeviceResponse

### adapters/postgres/

- `connected-devices.schema.ts`: connectedDevices
- `postgres-adb-key-repository.ts`: PostgresAdbKeyRepository
- `postgres-connected-device-repository.ts`: PostgresConnectedDeviceRepository
- `postgres-project-device-repository.ts`: PostgresProjectDeviceRepository
- `project-adb-keys.schema.ts`: projectAdbKeys
- `project-devices.schema.ts`: projectDevices
- Tests: postgres-adb-key-repository.test.ts, postgres-connected-device-repository.test.ts, postgres-project-device-repository.test.ts

### adapters/projects/

- `projects-device-feature.ts`: ProjectsDeviceFeature
- `projects-pairing-definitions.ts`: ProjectsPairingDefinitions
- `projects-run-environment-start.ts`: ProjectsRunEnvironmentStart

### adapters/run-environments/

- `run-environments-pairing-start.ts`: RunEnvironmentsPairingStart
- `run-environments-settings.ts`: RunEnvironmentsSettings

### adapters/scripted/

- `scripted-adb.ts`: ScriptedAdb

### adapters/websocket/

- `connected-device-web-events.ts`: ConnectedDeviceWebEvents
- `device-relay-link.ts`: RelaySocket, SOCKET_HIGH_WATER_BYTES, RelayClock, DeviceRelayLink
- `device-relay-route.ts`: DeviceRelayRoute
- `project-device-web-events.ts`: ProjectDeviceWebEvents

### adapters/work/

- `work-device-tasks.ts`: WorkDeviceTasks

### application/

- `adb-in-run-environment.ts`: ADB_MISSING, ADB_WITHOUT_PAIR, ADB_STEP_TIMEOUT_MS, AdbCheck, AdbPlace, AdbInRunEnvironment
- `android-usb-devices.ts`: ADB_RECONNECT_DELAY_MS, ADB_RECONNECT_INTERVAL_MS, ConnectedAndroidPhone, AndroidUsbDevices
- `connected-devices.ts`: CONNECTED_DEVICES_VARIABLE, ANDROID_SERIAL_VARIABLE, SERIAL_PATH_PREFIX, HELPER_START_TIMEOUT_MS, DeviceToConnect, WirelessPhoneToPair, DeviceToLend, ConnectedDevices
- `device-helper-architecture.ts`: hostHelperArchitecture
- `project-devices.ts`: UsbDeviceToAdd, WirelessDeviceToAdd, ProjectDeviceToAdd, ProjectDeviceEdit, SeenProjectDevice, ProjectDevices
- `wireless-devices.ts`: PAIRING_TIMEOUT_MS, WIRELESS_RECONNECT_TIMEOUT_MS, PhoneToPair, PhoneOfTask, PairedPhone, WirelessEnd, WirelessDevices
- Tests: adb-in-run-environment-runtime.test.ts, android-usb-devices.test.ts, connected-devices.test.ts, project-devices.test.ts, wireless-devices.test.ts

### domain/

- `adb-key.ts`: AdbKey, ADB_KEY_BITS, newAdbKey, encodeAdbPublicKey, decodeAdbPublicKey
- `connected-device-events.ts`: ConnectedDeviceChanged
- `connected-device-refused.ts`: OtherTask, ConnectedDeviceRefused, ConnectedDeviceNotFound
- `connected-device.ts`: CONNECTED_DEVICE_KINDS, ConnectedDeviceKind, ConnectedDeviceState, DisconnectedBecause, HELPER_NOTICE_CODES, HelperNoticeCode, DeviceNotice, SLOW_ROUND_TRIP_MS, ROUND_TRIP_STEP_MS, DeviceUser, ConnectedDevice, ConnectedDeviceChange, RELAYED_KINDS, RUN_ENVIRONMENT_OFF, TASK_DONE, TASK_DROPPED, WIRELESS_IS_PAIRED, ALREADY_IN_THIS_TASK, alreadyConnectedTo, TaskOfDevice, ConnectRequest, taskProblemsOf, connectProblemsOf, NewConnectedDevice, connectingDevice, lentDevice, isOpen, deviceConnected, deviceBaudRateSet, deviceRoundTripMeasured, deviceNoticed, noticesOf, deviceWaiting, phonePaired, Disconnection, deviceDisconnected, connectedDevicesVariable, ANDROID_KINDS, adbSerialOf, androidSerialOf, KIND_WORDS, STATE_WORDS, NOTICE_WORDS, detailsOf
- `project-device-events.ts`: ProjectDeviceChanged
- `project-device-refused.ts`: ProjectDeviceHolder, ProjectDeviceRefused, ProjectDeviceNotFound
- `project-device.ts`: PROJECT_DEVICE_NAME_MAX_LENGTH, ProjectDeviceRestState, ProjectDeviceState, ProjectDevicePairingStep, ProjectDeviceLastUse, ProjectDevice, ProjectDeviceChange, NEEDS_RUN_ENVIRONMENT_ON, NAME_LENGTH, PORT_RANGE, ONLY_WIRELESS_HAS_A_PORT, ONLY_WIRELESS_IS_PAIRED, PAIRING_CUT_OFF_BY_RESTART, firstRestStateOf, projectDeviceNameOf, usbProjectDevice, PhonePlace, wirelessProjectDevice, projectDeviceRenamed, projectDevicePortChanged, pairingStarted, pairingStepped, pairingSucceeded, pairingFailed, pairingCutOff, projectDeviceStateOf, restStateAfter, lastUseOf, projectDeviceGivenBack, inUseBy, beingPaired, alreadyAmongTheProjects, notOfTheTasksProject, ProjectDeviceHolder
- `wireless-address.ts`: WirelessAddress, wirelessAddressOf, wirelessDeviceKeyOf, adbSerialAt
- Tests: adb-key.test.ts, connected-device.test.ts, project-device.test.ts, wireless-address.test.ts

### ports/

- `adb-key-input.ts`: AdbKeyInput
- `adb-key-repository.fixtures.ts`: AdbKeysForTests
- `adb-key-repository.ts`: AdbKeyRepository
- `connected-device-repository.fixtures.ts`: ConnectedDevicesForTests
- `connected-device-repository.ts`: ConnectedDeviceRepository
- `device-tasks.ts`: DeviceTask, DeviceTasks
- `pairing-definitions.ts`: PairingDefinition, PairingDefinitions
- `pairing-environment-start.ts`: RunningPairingEnvironment, PairingEnvironmentToStart, PairingEnvironmentStart
- `project-device-repository.fixtures.ts`: ProjectDevicesForTests
- `project-device-repository.ts`: ProjectDeviceUpdate, ProjectDeviceRepository
- `project-features.ts`: ProjectDeviceFeature
- `project-run-environment-settings.ts`: ProjectRunEnvironmentSettings
- `relay-link.ts`: HelperProcess, HelperOpening, HelperListener, RelayClose, RelayLink
- `run-environment-start.ts`: RunEnvironmentStart
