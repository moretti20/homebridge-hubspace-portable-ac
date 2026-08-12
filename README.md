<p align="center">
  <img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" height="150"/>
</p>

# Homebridge Hubspace (with portable AC support)

Homebridge plugin for Hubspace accessories sold through Home Depot.

Based on `XenuIsWatching/homebridge-hubspace` v2.3.3, with portable air
conditioner support added.

## Portable air conditioner

Tested against:

- Vissani / "Home Comfort" portable AC
- Hubspace device class: `portable-air-conditioner`

### What you get in the Home app

Two tiles, no clutter:

**1. Air Conditioner** (HeaterCooler)

| Control | Behaviour |
| --- | --- |
| Power | On / off |
| Mode | Auto (device `auto-cool`) or Cool (device `cool`) |
| Current temperature | Read from the unit's sensor |
| Target temperature | 16–30 °C in 0.5° steps, matching the device's own range |
| Fan speed slider | **0% = Auto, 50% = Low, 100% = High** |

**2. Air Conditioner Fan** (Fanv2)

| Control | Behaviour |
| --- | --- |
| Power | Puts the unit in fan-only mode |
| Fan speed slider | 50% = Low, 100% = High |

The two tiles are mutually exclusive by design, because the unit only has one
mode at a time. Turning the Fan tile on switches the unit to fan-only and the AC
tile goes inactive; turning the AC tile on switches back to cooling and the Fan
tile goes inactive. Turning one tile off will not cut power while the other one
is the thing actually running.

Dehumidify and Sleep are intentionally not exposed.

### Notes on the fan slider

`0% = Auto` is a deliberate choice so all three of the unit's fan settings are
reachable from the AC tile. On a HeaterCooler service, 0% does not mean "off" —
the Power control handles that. On the Fan tile, which is a plain fan, 0% does
mean off, which is standard HomeKit behaviour.

## How it talks to the device

Reads and writes go through Afero's semantic state API
(`accounts/{account}/metadevices/{id}/state`), which uses the same human
readable values the device advertises in its own metadata (`cool`,
`fan-speed-2-050`, `22.0`) rather than raw attribute bytes.

Nothing about the AC is hard-coded. Mode names, fan speed names and the
temperature range are all discovered from the device's function metadata at
startup, so a unit that labels things differently (three fan speeds, `fan-only`
instead of `fan`, and so on) still works.

Reads are cached for 5 seconds and concurrent reads are coalesced into a single
HTTP request, so opening the Home app makes one call instead of eight. After a
write, the plugin trusts its own value for 8 seconds so sliders do not snap back
while the cloud catches up.

## Configuration

```json
{
  "platform": "Hubspace",
  "name": "Hubspace",
  "username": "you@example.com",
  "password": "your-password",
  "pollingInterval": 30
}
```

`pollingInterval` (seconds, default 30) controls how often air conditioners are
refreshed so changes made on the unit itself or in the Hubspace app show up in
the Home app. Set it to `0` to disable polling. Values below 10 are treated
as 10.

## Build

```bash
npm install
npm run build
```

Lint and typecheck:

```bash
npm run lint
npm run check
```

## Upstream

Original project: `https://github.com/XenuIsWatching/homebridge-hubspace`

This derivative remains under the upstream Apache-2.0 license.
