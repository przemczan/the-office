# Devices: module map

**Owns:** Connected devices (spec §2.13): the record (`connected_devices`: kind, name, device key, state, why and by whom Disconnected, the error, the endpoint, who connected it and when, its Task and the Task's Project), kept after it is Disconnected as the Task's history; its transitions (`domain/connected-device.ts`: Connecting → Connected at the helper's endpoint, Waiting for the run environment or Disconnected; Connected ⇄ Waiting; any open → Disconnected, for good), each with `ConnectedDeviceChanged`, published after it is saved; connect (`ConnectedDevices.connect`, `POST /tasks/:taskId/devices`), refused with every reason in the UI's words (the Task Done or Dropped, the Project's Run environment Off, an Android phone over wireless debugging, which isn't built yet, the helper not built: `DEVICE_HELPER_NOT_BUILT`) as 422, and with "Already connected to the Task «…»." as 409 with `otherTask` when an open record holds the device key, which storage refuses (a partial unique index on `device_key` while not Disconnected: insert, catch the violation, read the holder); never starting the run environment; disconnect by a user (`POST /devices/:id/disconnect`, naming them) and the list (`GET /tasks/:taskId/devices`, the newest first); each device's relay socket (`DEVICE_RELAY_PATH_PATTERN`, registered with the platform's `WebSocketRoutes`, signed in): one per device (a second closed with 4409, one for a device not there or Disconnected with 4410), its binary messages device frames (`adapters/websocket/device-relay-link.ts`: from the browser only OPEN, DATA and CLOSE go to the helper; the helper's HELLO, READY and ENDED are the service's, its OPEN, DATA and CLOSE go to the browser; the helper's output paused while the socket holds over 1 MiB, the socket paused while the helper's input is full), its text messages `{"type":"state"}` to the browser at each change and `{"type":"unplugged"}` from it; the helper (`<DEVICE_HELPER_MOUNT>/office-device-helper-<arch> relay --listen 127.0.0.1:0`, attached in the Task's run environment) started as the socket opens and at each `RunEnvironmentStarted` for a device that waits with its socket open, Connected at READY's endpoint once HELLO's version is this Office's (`DeviceHelperFiles.helloProblemOf`), an error after 10 s without READY (`HELPER_START_TIMEOUT_MS`, on `Schedule`); how a device follows its Task: Waiting at `RunEnvironmentStopped` or when its helper ends as the environment stops, an error with ENDED's words or the exit when the helper ends while it runs, tab closed or device unplugged as the socket closes, Task ended at `RunEnvironmentRemoved` and the Task's `TaskStateChanged` to Done or Dropped, Run environment turned Off for every device of the Project's Tasks at Projects' `ProjectRunEnvironmentChanged` to anything but On; the startup sweep (`sweep`, from `office.ts`: every open record ends as tab closed, as a restart drops every socket); `OFFICE_CONNECTED_DEVICES` for every check (`connectedDevicesVariable`: the Connected ones as a JSON array of `{ id, kind, name, endpoint }`, `[]` with none), registered into Run environments' `RunEnvironmentCommandVariables`; the Task's devices not Disconnected in words ("Android phone over USB «Pixel 9»: Connected, at 127.0.0.1:41234"), registered into Work's `TaskConnectedDevices` for `read_task` and the Briefs; `connected-device.changed` to the web; the Project's adb key (`project_adb_keys`, `domain/adb-key.ts`: RSA-2048 and adb's public format, made at the Project's first Android connect and kept, the first kept winning a race); the adb steps in the run environment (`application/adb-in-run-environment.ts`, shared by both Android kinds: `ensureAdb` with `ADB_MISSING`, `writeKey` through the helper's `adb-key` mode with `adb kill-server` on `written`, `connect`, `disconnect`, each one attach as the checks' user for at most 20 s); an Android phone over USB (`application/android-usb-devices.ts`: the steps at each READY, `adb connect` again 2 s after the relay's last channel closes while Connected, at most once per 30 s, `adb disconnect` as it ends); `ANDROID_SERIAL` (`androidSerialOf`, the one Android phone Connected), registered with `unlessProjectSets`.

**Talks to:** Work's `TaskService` behind `DeviceTasks` (`adapters/work/`) for the Task's title, state and Project, and Work's `TaskConnectedDevices` and `TaskStateChanged`; Run environments' `RunEnvironments` (`attach`, `isRunning`), `DeviceHelperFiles`, `RunEnvironmentCommandVariables`, its `RunEnvironmentStarted`, `RunEnvironmentStopped` and `RunEnvironmentRemoved`, and `ProjectRunEnvironments.isOn` behind `ProjectRunEnvironmentSettings` (`adapters/run-environments/`); Projects' `ProjectRunEnvironmentChanged` (the event alone). [app.module.ts](../../app.module.ts) gives the module Work and Run environments in `imports`.

**Traps:**

- The frames codec is the contracts', so the byte relay is an adapter (`DeviceRelayLink`) behind the `RelayLink` port; the application never sees a frame, a close code or `ws`.
- `RunEnvironmentStarted` handlers run inside the Task's step and the bus waits for them: the start handler only attaches (`RunEnvironments.attach` takes no step) and waits for READY at most 10 s per device, never throwing; calling anything that takes the Task's step there would wait for itself.
- A stop forgets the environment before its containers stop, so a helper that ends with them finds `isRunning` false and its device waits; that is weighed as the helper ends, not later in the device's lock, so a quick next start isn't taken for an error.
- Relays live in memory: an Office restart leaves open records with no socket, which the sweep ends as tab closed. The sweep runs from `office.ts`, never at the module's start, so a test app ends nobody's devices.
- The adb steps of an Android phone over USB run detached from the device's lock, under their own key `adb:<id>`: they attach for up to 20 s each, and holding the device's lock that long would stall its state changes; each step's result is weighed against the record as it is then.
- The application layer can't import contracts, so the key's frames for the helper's `adb-key` mode are built in `adapters/device-helper/adb-key-frames.ts` behind the `AdbKeyInput` port.
- The adb private key never leaves the service: it goes only into the helper's stdin, never into a log line, an event, a response or the words for `read_task`.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

ConnectedDevices, CONNECTED_DEVICES_VARIABLE, DeviceToConnect, ConnectedDeviceChanged, DevicesModule, DevicesModuleOptions

## Domain events

- `domain/connected-device-events.ts`: ConnectedDeviceChanged

## HTTP routes (under `/api`)

- `GET /tasks/:taskId/devices`: DevicesController.list
- `POST /tasks/:taskId/devices`: DevicesController.connect
- `POST /devices/:id/disconnect`: DevicesController.disconnect

## Tables

- `adapters/postgres/connected-devices.schema.ts`: connected_devices
- `adapters/postgres/project-adb-keys.schema.ts`: project_adb_keys

## Files

### ./

- `devices.fixtures.ts`: HELPER_VERSION, HELPER_ENDPOINT, PROJECT_ID, DeviceTasksForTests, RunEnvironmentSettingsForTests, FakeRelaySocket, LoopbackHelperOptions, loopbackHelper, ScriptedAdb, framesWrittenTo, RunEnvironmentsOfTestbed, DevicesTestbed, devicesTestbed
- `devices.module.ts`: DevicesModuleOptions, DevicesModule
- Tests: devices-relay.test.ts

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

### adapters/run-environments/

- `run-environments-settings.ts`: RunEnvironmentsSettings

### adapters/websocket/

- `connected-device-web-events.ts`: ConnectedDeviceWebEvents
- `device-relay-link.ts`: RelaySocket, SOCKET_HIGH_WATER_BYTES, DeviceRelayLink
- `device-relay-route.ts`: DeviceRelayRoute

### adapters/work/

- `work-device-tasks.ts`: WorkDeviceTasks

### application/

- `adb-in-run-environment.ts`: ADB_MISSING, ADB_STEP_TIMEOUT_MS, AdbCheck, AdbInRunEnvironment
- `android-usb-devices.ts`: ADB_RECONNECT_DELAY_MS, ADB_RECONNECT_INTERVAL_MS, ConnectedAndroidPhone, AndroidUsbDevices
- `connected-devices.ts`: CONNECTED_DEVICES_VARIABLE, ANDROID_SERIAL_VARIABLE, HELPER_START_TIMEOUT_MS, DeviceToConnect, ConnectedDevices
- `device-helper-architecture.ts`: hostHelperArchitecture
- Tests: android-usb-devices.test.ts, connected-devices.test.ts

### domain/

- `adb-key.ts`: AdbKey, ADB_KEY_BITS, newAdbKey, encodeAdbPublicKey, decodeAdbPublicKey
- `connected-device-events.ts`: ConnectedDeviceChanged
- `connected-device-refused.ts`: OtherTask, ConnectedDeviceRefused, ConnectedDeviceNotFound
- `connected-device.ts`: CONNECTED_DEVICE_KINDS, ConnectedDeviceKind, ConnectedDeviceState, DisconnectedBecause, DeviceUser, ConnectedDevice, ConnectedDeviceChange, RELAYED_KINDS, RUN_ENVIRONMENT_OFF, TASK_DONE, TASK_DROPPED, WIRELESS_NOT_YET, alreadyConnectedTo, ConnectRequest, connectProblemsOf, NewConnectedDevice, connectingDevice, isOpen, deviceConnected, deviceWaiting, Disconnection, deviceDisconnected, connectedDevicesVariable, ANDROID_KINDS, adbSerialOf, androidSerialOf, KIND_WORDS, STATE_WORDS
- Tests: adb-key.test.ts, connected-device.test.ts

### ports/

- `adb-key-input.ts`: AdbKeyInput
- `adb-key-repository.fixtures.ts`: AdbKeysForTests
- `adb-key-repository.ts`: AdbKeyRepository
- `connected-device-repository.fixtures.ts`: ConnectedDevicesForTests
- `connected-device-repository.ts`: ConnectedDeviceRepository
- `device-tasks.ts`: DeviceTask, DeviceTasks
- `project-run-environment-settings.ts`: ProjectRunEnvironmentSettings
- `relay-link.ts`: HelperProcess, HelperOpening, RelayClose, RelayLink
