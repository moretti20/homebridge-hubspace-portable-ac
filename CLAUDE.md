# homebridge-hubspace (portable AC fork)

Homebridge plugin for Hubspace / Afero devices sold through Home Depot. Forked
from `XenuIsWatching/homebridge-hubspace` v2.3.3 to add portable air
conditioner support. Everything else (lights, fans, outlets, sprinklers) is
upstream code and should be left alone unless there is a reason to touch it.

## Build and check

```bash
npm install
npm run build     # rimraf dist && tsc
npm run check     # tsc --noEmit
npm run lint      # eslint, max-warnings=0
```

Node 18/20/22/24, Homebridge 1.6+ or 2.x. `tsconfig.json` sets
`useDefineForClassFields: false` on purpose — upstream `platform.ts` reads
`this.api` from a field initializer, which breaks under the ES2022 default.

## Behaviour tests

`sim/simulate.ts` drives the real `AirConditionerAccessory` against real
captured device metadata (`sim/device-dump.json`) using stub `homebridge` and
`axios` modules. 52 assertions covering service layout, characteristic props,
every read and write path, mutual exclusion between the fan tiles, request
coalescing, and the rule that dehumidify is never written.

Run it with any TS runner, for example `npx tsx sim/simulate.ts`. It is
excluded from `tsconfig.json` and from the npm package.

**Add a case here for any behaviour change to the AC accessory.** It is the only
automated coverage in the repo.

## Architecture

```
src/
  index.ts                        registers the platform
  platform.ts                     HubspacePlatform, wires up services
  config.ts                       config validation
  settings.ts                     PLATFORM_NAME / PLUGIN_NAME
  api/                            axios clients, bearer token interceptor
  services/
    token.service.ts              Hubspace auth, persists a refresh token
    account.service.ts            resolves accountId
    discovery.service.ts          lists metadevices, builds Device models
    device.service.ts             two transports, see below
  models/                         Device, DeviceType, DeviceFunction registry
  responses/                      API response shapes
  accessories/
    hubspace-accessory.ts         base class: service resolution, naming
    air-conditioner-accessory.ts  the portable AC (the interesting one)
    fan|light|outlet|sprinkler    upstream, untouched
```

### Two transports in `device.service.ts`

1. **Attribute API** (`getValue` / `setValue`) — upstream. Reads
   `devices/{deviceId}?expansions=attributes,state` and writes via
   `attribute_write` with hex-encoded bytes. Used by the upstream accessories.
2. **Semantic API** (`getMetadeviceState` / `setMetadeviceState`) — added for
   the AC. Reads and writes `accounts/{account}/metadevices/{id}/state` using
   the human readable value names the device advertises in its own metadata
   (`cool`, `fan-speed-2-050`, `22.0`). No byte encoding to guess at.

New work should prefer the semantic API. Reads are coalesced per metadevice so
HomeKit's burst of characteristic reads becomes one HTTP call.

## The air conditioner

Device class `portable-air-conditioner`. Reference metadata and state are in
`sim/device-dump.json`; that file is the source of truth for value names.

| Function | Instance | Values |
| --- | --- | --- |
| `power` | – | `on`, `off` |
| `mode` | – | `auto-cool`, `cool`, `dehumidify`, `fan` |
| `fan-speed` | `ac-fan-speed` | `fan-speed-auto`, `fan-speed-2-050`, `fan-speed-2-100` |
| `temperature` | `current-temp` | numeric, −18..53, step 0.5 |
| `temperature` | `cooling-target` | numeric, 16..30, step 0.5 |
| `sleep` | – | `on`, `off` (not exposed) |
| `error` | `water-tray-full` | `normal`, `alerting` (not exposed) |

### HomeKit layout and why

Four services on one accessory:

1. `HeaterCooler` — power, Auto/Cool, current + target temperature.
2. `Fanv2` subtype `ac-cool-fan`, "<name> Cool" — on means cooling; slider is
   the fan speed used while cooling (Low/High).
3. `Fanv2` subtype `ac-fan-only`, "<name> Fan" — on means fan-only mode;
   slider is Low/High.
4. `TemperatureSensor` subtype `ac-temp-sensor`, "<name> Temperature" — mirrors
   the current temperature. Exists only so the Home app offers "temperature
   rises above / drops below" automation triggers; the HeaterCooler's own
   current temperature is not selectable as an automation trigger in Home.

Both sliders are Low/High only — Auto is not offered as a slider stop. Turning
one tile on pushes the other tile off in HomeKit immediately (see `pushState`),
so they never both appear on.

**The Apple Home app does not render `RotationSpeed` on a `HeaterCooler`
service.** That is why fan speed also lives on the Fanv2 services — in stock
Home those tiles are the only way to change speed. The HeaterCooler *does*
carry a `RotationSpeed` (Auto/Low/High, same shared value, synced in `refresh`)
so third-party apps that render it (Eve, Controller for HomeKit) put fan speed
directly on the AC. Stock Home simply ignores it, so keep the Fanv2 tiles.

`HeatingThresholdTemperature` is also deliberately absent, so Home shows a
single "cool to" set point in Auto rather than a dual range the unit cannot
honour.

### Invariants

These are the rules that took iterations to get right. Breaking them causes
real, user-visible bugs.

- **Moving a fan slider must never change the mode or the power state.** Only
  the `Active` characteristics change modes. An earlier version forced fan-only
  mode on any fan-speed write, which silently stopped the AC cooling.
- **The two fan tiles are mutually exclusive.** The unit has one mode at a time.
  Switching one on switches the other off.
- **Turning a tile off must not cut power if the other tile is what is
  running.** Check the current mode before writing `power=off`.
- **Both sliders write the same device setting.** The unit has a single shared
  fan-speed value; there is no per-mode speed.
- **Nothing about the device is hard-coded.** Mode names, fan speed names and
  temperature ranges are resolved from `device.functions` at construction.
  Preserve that when adding capabilities.
- **Never write `dehumidify`.** The user does not want it exposed.
- **A throw during accessory setup must not take down the platform.**
  `discovery.service.ts` wraps `createAccessoryForDevice` in try/catch.

### State handling

`_state` is a map of `functionClass[::functionInstance]` to value. Reads are
cached 5s. After a write the local optimistic value is trusted for 8s
(`WRITE_GRACE_MS`) so Home app sliders do not snap back while Afero catches up.
A background poll (`pollingInterval`, default 30s, 0 disables) pushes external
changes into HomeKit via `updateCharacteristic`.

## Debugging

With Homebridge debug logging on, the accessory prints what it matched at
startup:

```
[Garage AC] modes -> cool: cool, auto: auto-cool, fan: fan;
cool fan stops -> [50%=fan-speed-2-050, 100%=fan-speed-2-100];
fan only stops -> [50%=fan-speed-2-050, 100%=fan-speed-2-100];
target 16-30 step 0.5
```

Any `n/a` there means capability discovery failed for that function and the
related control will not work.

## Deployment

Installed globally on a Raspberry Pi running Homebridge as a systemd service:

```bash
npm run build
npm pack
sudo npm install -g ./xenuiswatching-homebridge-hubspace-<version>.tgz
sudo systemctl restart homebridge
```

Plain `npm install -g .` gets short-circuited by npm when a package of the same
name is already present; use the tarball.
