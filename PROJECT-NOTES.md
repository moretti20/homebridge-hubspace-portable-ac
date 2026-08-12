# Portable AC support — implementation notes

## What was wrong with the earlier draft

1. **Fan speed value names never matched.** The code looked for category values
   named `auto`, `50%`, `low`, `100%` and `high`. The device actually advertises
   `fan-speed-auto`, `fan-speed-2-050` and `fan-speed-2-100`. Every fan-speed
   read or write threw, which surfaces in the Home app as "No Response" for the
   whole accessory.
2. **A throw during setup killed the entire platform.** `createAccessoryForDevice`
   was called unguarded inside the discovery loop, so one bad device stopped
   every other Hubspace device from loading.
3. **Raw attribute encoding was being guessed.** Writes went through
   `attribute_write` with hex-encoded bytes, which is ambiguous for the AC's
   numeric temperature attribute.
4. **Only one service got a name.** The Fanv2 tile had no `ConfiguredName`, so it
   showed up unnamed in the Home app.
5. **Every characteristic read was its own HTTP request.** Opening the Home app
   fired roughly eight simultaneous calls per accessory.
6. **No polling.** Changes made on the unit or in the Hubspace app never reached
   HomeKit.
7. **Renaming a service would crash on restart.** Cached services were matched by
   display name, so a rename caused a duplicate `addService`, which HAP rejects.

## What changed

- Rewrote `air-conditioner-accessory.ts` around the device's advertised value
  names, discovered at startup instead of hard-coded.
- Added a semantic state transport to `DeviceService`
  (`getMetadeviceState` / `setMetadeviceState`) that uses
  `accounts/{account}/metadevices/{id}/state`. Values are the same names the
  metadata uses, so there is no byte encoding to guess.
- Added read caching (5 s), in-flight request coalescing, optimistic writes with
  an 8 s grace window, and configurable background polling (`pollingInterval`,
  default 30 s).
- Service resolution now matches on UUID + subtype, and stale-service cleanup
  compares identity rather than display name.
- `configureName` sets both `Name` and `ConfiguredName`, guarding services that
  do not support the latter.
- Discovery wraps each device in try/catch and logs unsupported device classes
  at debug level.
- Loosened response interfaces to match reality (`functionInstance` and `range`
  are optional; `range` is `{}` on category functions).
- Type-only imports are now marked `import type`.
- Bumped the TS target to ES2022 and refreshed dev dependencies.

## HomeKit model

Two services, chosen to keep the Home app tidy:

- `HeaterCooler` — Active, CurrentHeaterCoolerState (Inactive/Idle/Cooling),
  TargetHeaterCoolerState (Auto/Cool only), CurrentTemperature,
  CoolingThresholdTemperature, RotationSpeed (0 Auto / 50 Low / 100 High).
- `Fanv2` subtype `ac-fan-only` — Active, RotationSpeed (50 Low / 100 High).

`HeatingThresholdTemperature` is deliberately not exposed, so the Home app shows
a single "cool to" set point in Auto rather than a dual range the unit cannot
honour.

Dehumidify and Sleep are not exposed.

## Verification

`sim/simulate.ts` drives the real accessory class against the real captured
device metadata and state, using stub `homebridge` and `axios` modules. It
covers service layout, characteristic props derived from metadata, every read
path, every write path, mutual exclusion between the AC and Fan tiles, request
coalescing, and that `dehumidify` is never written. 42 assertions, all passing.

Run it with a TypeScript-capable runner, or read it as documentation of the
intended behaviour. It is excluded from `tsconfig.json` and from the published
package.

## Device reference

Captured metadata for the Vissani / Home Comfort unit lives in
`sim/device-dump.json`.

| Function | Instance | Values |
| --- | --- | --- |
| `power` | – | `on`, `off` |
| `mode` | – | `auto-cool`, `cool`, `dehumidify`, `fan` |
| `fan-speed` | `ac-fan-speed` | `fan-speed-auto`, `fan-speed-2-050`, `fan-speed-2-100` |
| `temperature` | `current-temp` | numeric, −18 to 53, step 0.5 |
| `temperature` | `cooling-target` | numeric, 16 to 30, step 0.5 |
| `sleep` | – | `on`, `off` (not exposed) |
| `error` | `water-tray-full` | `normal`, `alerting` (not exposed) |
