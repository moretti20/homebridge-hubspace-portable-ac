# Installing on your Homebridge box over SSH

You already have an SSH session to the Homebridge host, so this is the quickest
path. Adjust paths if you are not on a standard Homebridge/hb-service install.

## 1. Copy the project over

From your computer:

```bash
scp homebridge-hubspace-portable-ac-full.zip pi@homebridge.local:~/
```

Then on the Homebridge box:

```bash
cd ~
unzip -o homebridge-hubspace-portable-ac-full.zip -d hubspace-plugin
cd hubspace-plugin
```

## 2. Build it

```bash
npm install
npm run build
```

`npm run build` must finish without errors. If it does not, stop here and send
me the output.

## 3. Remove the upstream plugin (it uses the same platform name)

```bash
sudo hb-service remove @xenuiswatching/homebridge-hubspace
```

If that plugin was not installed, skip this step.

## 4. Link this build in

```bash
sudo npm link
```

If your Homebridge runs with a custom global prefix (hb-service usually does),
use that prefix instead:

```bash
sudo npm install -g .
```

## 5. Restart and watch the log

```bash
sudo hb-service restart
sudo hb-service logs
```

You are looking for:

```
[Hubspace] Adding new accessory: <your AC name>
```

If you turn on Homebridge's debug logging (`hb-service` settings, or
`homebridge -D`), the plugin also prints the exact device values it discovered:

```
[Hubspace] [Garage AC] modes -> cool: cool, auto: auto-cool, fan: fan;
fan speeds -> auto: fan-speed-auto, [fan-speed-2-050, fan-speed-2-100];
target 16-30 step 0.5
```

That line is the fastest way to confirm the plugin matched your unit's
capabilities correctly. If any of those say `n/a`, send me the line.

## 6. Check the Home app

You should see two tiles for the AC:

- **<name>** — the air conditioner (power, Auto/Cool, temperature, fan slider)
- **<name> Fan** — fan-only mode

If you had run an earlier build of this plugin, the old services are cleaned up
automatically on start; you may need to close and reopen the Home app once for
the tiles to redraw.

## Troubleshooting

**"No Response" on the tiles.** Almost always credentials or connectivity. Check
the log for `Incorrect username or password` or `The remote service returned an
error`.

**Changes on the unit take up to 30 seconds to show in Home.** That is the
polling interval. Lower `pollingInterval` in config if you want it snappier;
10 is the practical minimum.

**The AC tile and Fan tile fight each other.** That is expected — the unit has
one mode at a time. Whichever tile you turned on last wins.
