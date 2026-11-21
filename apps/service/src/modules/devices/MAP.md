# Devices: module map

**Owns:** Connected devices (spec §2.13): the record (`connected_devices`: kind, name, device key, state, why and by whom Disconnected, the error, the endpoint, a serial board's RFC 2217 address (`rfc2217_url`, while Connected), its baud rate, the round trip last kept and the helper's latest notice (`baud_rate`, `round_trip_ms`, `notice`), who connected it and when, its Task and the Task's Project), kept after it is Disconnected as the Task's history; its transitions (`domain/connected-device.ts`: Connecting → Connected at the helper's endpoint or a paired phone's adb serial, Waiting for the run environment or Disconnected; Connected ⇄ Waiting; any open → Disconnected, for good; on an open one the baud rate set, a round trip kept only when it matters (the first, one crossing `SLOW_ROUND_TRIP_MS` either way, or one at least `ROUND_TRIP_STEP_MS` (25 ms) from the one kept), a new notice; each READY's Connected clears the round trip and the notice and keeps the baud rate; `noticesOf`: `slow-round-trip` over 250 ms, then the helper's notice), each with `ConnectedDeviceChanged`, published after it is saved; connect (`ConnectedDevices.connect`, `POST /tasks/:taskId/devices`), refused with every reason in the UI's words (the Task Done or Dropped, the Project's Run environment Off, an Android phone over wireless debugging, which is paired instead: `WIRELESS_IS_PAIRED`, the helper not built: `DEVICE_HELPER_NOT_BUILT`) as 422, and with "Already connected to the Task «…»." as 409 with `otherTask` when an open record holds the device key, which storage refuses (a partial unique index on `device_key` while not Disconnected: insert, catch the violation, read the holder); never starting the run environment; pairing an Android phone over wireless debugging (`ConnectedDevices.pair`, `POST /tasks/:taskId/devices/wireless`: refused as connect is, `taskProblemsOf` plus `domain/wireless-address.ts`'s `wirelessAddressOf`, which refuses a name, loopback, unspecified, multicast and link-local addresses, an IPv4-mapped one weighed as IPv4, and the helper not built, as it writes the key; device key `android-wireless:<address>`, IPv6 canonical; the record Connecting named by its address, then in the background under `adb:<id>` the run environment started through `RunEnvironmentStart` when it isn't running, the one start a device makes, and `application/wireless-devices.ts`'s `WirelessDevices.pair`: `ensureAdb`, `writeKey`, `adb pair <address>:<pairing port>` with the code on stdin, `adb connect <address>:<port>` and `getprop ro.product.model`, within 30 s (`PAIRING_TIMEOUT_MS`); `phonePaired` makes it Connected, or Waiting with its serial when the environment stopped meanwhile; any other end is an error in adb's words, `ADB_MISSING` or `ADB_WITHOUT_PAIR` for adb older than 30.0); disconnect by a user (`POST /devices/:id/disconnect`, naming them) and the list (`GET /tasks/:taskId/devices`, the newest first); each device's relay socket (`DEVICE_RELAY_PATH_PATTERN`, registered with the platform's `WebSocketRoutes`, signed in): one per device (a second closed with 4409, one for a device not there or Disconnected with 4410), its binary messages device frames (`adapters/websocket/device-relay-link.ts`: from the browser only OPEN, DATA and CLOSE go to the helper, and its PONG is the service's, measuring the round trip from when that PING id went to the browser on the module's `Schedule`; the helper's HELLO, READY, ENDED and NOTICE are the service's, its OPEN, DATA, CLOSE, SETTINGS, SIGNALS and PING go to the browser in order, SETTINGS also telling the baud rate, SETTINGS and SIGNALS passed byte for byte so the browser gets the helper's `at` stamps; the application hears them as `HelperListener`'s `settingsChanged`, `roundTripMeasured` and `noticed`, saved in the device's lock without a `{"type":"state"}` to the socket; the helper's output paused while the socket holds over 1 MiB, the socket paused while the helper's input is full), its text messages `{"type":"state"}` to the browser at each change and `{"type":"unplugged"}` or `{"type":"error",problem}` from it; the helper (an Android phone's `<DEVICE_HELPER_MOUNT>/office-device-helper-<arch> relay --listen 127.0.0.1:0` as the checks' user; a serial board's `… pty --path-prefix /dev/ttyACM --owner <uid>:<gid>` as root, the owner `RunEnvironments.checksUserOf`, READY's first line, the path `/dev/ttyACM0`, its endpoint, and its second, `rfc2217://127.0.0.1:2217`, its RFC 2217 address, read by the contracts' `readyEndpoints`; attached in the Task's run environment) started as the socket opens and at each `RunEnvironmentStarted` for a device that waits with its socket open, Connected at READY's endpoint once HELLO's version is this Office's (`DeviceHelperFiles.helloProblemOf`), an error after 10 s without READY (`HELPER_START_TIMEOUT_MS`, on `Schedule`); how a device follows its Task: Waiting at `RunEnvironmentStopped` or when its helper ends as the environment stops (a phone over wireless debugging keeping its endpoint), a paired phone Waiting connected again at each `RunEnvironmentStarted` (`WirelessDevices.reconnect`: the key and `adb connect`, never pair, within 10 s, `WIRELESS_RECONNECT_TIMEOUT_MS`), or ended as device unplugged with "…pair it again." when it doesn't answer, an error with ENDED's words or the exit when the helper ends while it runs, tab closed, device unplugged, or an error with the browser's first problem as the socket closes, Task ended at `RunEnvironmentRemoved` and the Task's `TaskStateChanged` to Done or Dropped, Run environment turned Off for every device of the Project's Tasks at Projects' `ProjectRunEnvironmentChanged` to anything but On; the startup sweep (`sweep`, from `office.ts`: every open relayed record ends as tab closed, as a restart drops every socket; a phone over wireless debugging goes Waiting instead); `OFFICE_CONNECTED_DEVICES` for every check (`connectedDevicesVariable`: the Connected ones as a JSON array of `{ id, kind, name, endpoint, rfc2217Url }`, `[]` with none), registered into Run environments' `RunEnvironmentCommandVariables`; the Task's devices not Disconnected in words ("Android phone over USB «Pixel 9»: Connected, at 127.0.0.1:41234"; a serial board's with `detailsOf`: "…, at /dev/ttyACM0 and rfc2217://127.0.0.1:2217; 115200 baud; round trip 40 ms; the board didn't answer after its reset"), registered into Work's `TaskConnectedDevices` for `read_task` and the Briefs; `connected-device.changed` to the web; the Project's adb key (`project_adb_keys`, `domain/adb-key.ts`: RSA-2048 and adb's public format, made at the Project's first Android connect and kept, the first kept winning a race); the adb steps in the run environment (`application/adb-in-run-environment.ts`, shared by both Android kinds: `ensureAdb` with `ADB_MISSING`, `writeKey` through the helper's `adb-key` mode with `adb kill-server` on `written`, `pair` with the code on stdin, `connect`, `modelOf`, `disconnect`, each one attach as the checks' user for at most 20 s); an Android phone over USB (`application/android-usb-devices.ts`: the steps at each READY, `adb connect` again 2 s after the relay's last channel closes while Connected, at most once per 30 s, `adb disconnect` as it ends); `adb disconnect` for a phone over wireless debugging as it ends while the run environment runs; `ANDROID_SERIAL` (`androidSerialOf`, the one Android phone of either kind Connected), registered with `unlessProjectSets`.

**Talks to:** Work's `TaskService` behind `DeviceTasks` (`adapters/work/`) for the Task's title, state and Project, and Work's `TaskConnectedDevices` and `TaskStateChanged`; Run environments' `RunEnvironments` (`attach`, `checksUserOf`, `isRunning`), `DeviceHelperFiles`, `RunEnvironmentCommandVariables`, its `RunEnvironmentStarted`, `RunEnvironmentStopped` and `RunEnvironmentRemoved`, and `ProjectRunEnvironments.isOn` behind `ProjectRunEnvironmentSettings` (`adapters/run-environments/`); Projects' `TaskWorktrees.startRunEnvironment` behind `RunEnvironmentStart` (`ports/run-environment-start.ts`, `adapters/projects/`), to start a Task's run environment for a pairing, and `ProjectRunEnvironmentChanged`. [app.module.ts](../../app.module.ts) gives the module Work, Projects and Run environments in `imports`. Activity reads the open devices through `ConnectedDevices.open()`.

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

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

ConnectedDevices, CONNECTED_DEVICES_VARIABLE, DeviceToConnect, ConnectedDeviceChanged, DevicesModule, DevicesModuleOptions

## Domain events

- `domain/connected-device-events.ts`: ConnectedDeviceChanged

## HTTP routes (under `/api`)

- `GET /tasks/:taskId/devices`: DevicesController.list
- `POST /tasks/:taskId/devices`: DevicesController.connect
- `POST /tasks/:taskId/devices/wireless`: DevicesController.pair
- `POST /devices/:id/disconnect`: DevicesController.disconnect

## Tables

- `adapters/postgres/connected-devices.schema.ts`: connected_devices
- `adapters/postgres/project-adb-keys.schema.ts`: project_adb_keys

## Files

### ./

- `devices.fixtures.ts`: HELPER_VERSION, HELPER_ENDPOINT, PROJECT_ID, DeviceTasksForTests, RunEnvironmentSettingsForTests, RunEnvironmentStartForTests, FakeRelaySocket, LoopbackHelperOptions, loopbackHelper, ScriptedAdb, framesWrittenTo, RunEnvironmentsOfTestbed, DevicesTestbed, devicesTestbed
- `devices.module.ts`: DevicesModuleOptions, DevicesModule
- Tests: devices-relay.test.ts, devices-wireless.test.ts

### adapters/device-helper/

- `adb-key-frames.ts`: AdbKeyFrames

### adapters/http/

- `device-refusals.filter.ts`: DeviceRefusalsFilter
- `devices.controller.ts`: DevicesController, deviceResponse

### adapters/postgres/

- `connected-devices.schema.ts`: connectedDevices
- `postgres-adb-key-repository.ts`: PostgresAdbKeyRepository
- `postgres-connected-device-repository.ts`: PostgresConnectedDeviceRepository
- `project-adb-keys.schema.ts`: projectAdbKeys
- Tests: postgres-adb-key-repository.test.ts, postgres-connected-device-repository.test.ts

### adapters/projects/

- `projects-run-environment-start.ts`: ProjectsRunEnvironmentStart

### adapters/run-environments/

- `run-environments-settings.ts`: RunEnvironmentsSettings

### adapters/websocket/

- `connected-device-web-events.ts`: ConnectedDeviceWebEvents
- `device-relay-link.ts`: RelaySocket, SOCKET_HIGH_WATER_BYTES, RelayClock, DeviceRelayLink
- `device-relay-route.ts`: DeviceRelayRoute

### adapters/work/

- `work-device-tasks.ts`: WorkDeviceTasks

### application/

- `adb-in-run-environment.ts`: ADB_MISSING, ADB_WITHOUT_PAIR, ADB_STEP_TIMEOUT_MS, AdbCheck, AdbInRunEnvironment
- `android-usb-devices.ts`: ADB_RECONNECT_DELAY_MS, ADB_RECONNECT_INTERVAL_MS, ConnectedAndroidPhone, AndroidUsbDevices
- `connected-devices.ts`: CONNECTED_DEVICES_VARIABLE, ANDROID_SERIAL_VARIABLE, SERIAL_PATH_PREFIX, HELPER_START_TIMEOUT_MS, DeviceToConnect, WirelessPhoneToPair, ConnectedDevices
- `device-helper-architecture.ts`: hostHelperArchitecture
- `wireless-devices.ts`: PAIRING_TIMEOUT_MS, WIRELESS_RECONNECT_TIMEOUT_MS, PhoneToPair, PhoneOfTask, PairedPhone, WirelessEnd, WirelessDevices
- Tests: adb-in-run-environment-runtime.test.ts, android-usb-devices.test.ts, connected-devices.test.ts, wireless-devices.test.ts

### domain/

- `adb-key.ts`: AdbKey, ADB_KEY_BITS, newAdbKey, encodeAdbPublicKey, decodeAdbPublicKey
- `connected-device-events.ts`: ConnectedDeviceChanged
- `connected-device-refused.ts`: OtherTask, ConnectedDeviceRefused, ConnectedDeviceNotFound
- `connected-device.ts`: CONNECTED_DEVICE_KINDS, ConnectedDeviceKind, ConnectedDeviceState, DisconnectedBecause, HELPER_NOTICE_CODES, HelperNoticeCode, DeviceNotice, SLOW_ROUND_TRIP_MS, ROUND_TRIP_STEP_MS, DeviceUser, ConnectedDevice, ConnectedDeviceChange, RELAYED_KINDS, RUN_ENVIRONMENT_OFF, TASK_DONE, TASK_DROPPED, WIRELESS_IS_PAIRED, ALREADY_IN_THIS_TASK, alreadyConnectedTo, TaskOfDevice, ConnectRequest, taskProblemsOf, connectProblemsOf, NewConnectedDevice, connectingDevice, isOpen, deviceConnected, deviceBaudRateSet, deviceRoundTripMeasured, deviceNoticed, noticesOf, deviceWaiting, phonePaired, Disconnection, deviceDisconnected, connectedDevicesVariable, ANDROID_KINDS, adbSerialOf, androidSerialOf, KIND_WORDS, STATE_WORDS, NOTICE_WORDS, detailsOf
- `wireless-address.ts`: WirelessAddress, wirelessAddressOf, wirelessDeviceKeyOf, adbSerialAt
- Tests: adb-key.test.ts, connected-device.test.ts, wireless-address.test.ts

### ports/

- `adb-key-input.ts`: AdbKeyInput
- `adb-key-repository.fixtures.ts`: AdbKeysForTests
- `adb-key-repository.ts`: AdbKeyRepository
- `connected-device-repository.fixtures.ts`: ConnectedDevicesForTests
- `connected-device-repository.ts`: ConnectedDeviceRepository
- `device-tasks.ts`: DeviceTask, DeviceTasks
- `project-run-environment-settings.ts`: ProjectRunEnvironmentSettings
- `relay-link.ts`: HelperProcess, HelperOpening, HelperListener, RelayClose, RelayLink
- `run-environment-start.ts`: RunEnvironmentStart
