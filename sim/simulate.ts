/* eslint-disable no-console */
// End-to-end simulation of the portable AC accessory against the real
// Hubspace metadata + state captured from a Vissani / Home Comfort unit.
import * as fs from 'fs';
import * as path from 'path';
import { AirConditionerAccessory } from '../src/accessories/air-conditioner-accessory';
import { DiscoveryService } from '../src/services/discovery.service';
import { DeviceService } from '../src/services/device.service';
import { HubspacePlatform } from '../src/platform';
import { isConfigValid } from '../src/config';
import { createAccessoryForDevice } from '../src/accessories/device-accessory-factory';

import { hap, installAxiosStub } from './stubs';
// Route every axios client the code builds to our in-memory fake cloud.
const axiosStub: any = installAxiosStub();

const dump = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'sim', 'device-dump.json'), 'utf8'));

// ---- fake device cloud -------------------------------------------------
const deviceState: Record<string, unknown> = {};
for(const v of dump.state.values){
    deviceState[v.functionInstance ? `${v.functionClass}::${v.functionInstance}` : v.functionClass] = v.value;
}

const writes: { key: string; value: unknown }[] = [];
let getCount = 0;

axiosStub.__handlers.get = async (url: string) => {
    if(url.includes('/metadevices/') && url.endsWith('/state')){
        getCount++;
        return {
            status: 200,
            data: {
                metadeviceId: dump.id,
                values: Object.entries(deviceState).map(([k, value]) => {
                    const [functionClass, functionInstance] = k.split('::');
                    return { functionClass, functionInstance: functionInstance ?? null, value };
                })
            }
        };
    }
    if(url.includes('metadevices')) return { status: 200, data: [dump] };
    throw new Error('unexpected GET ' + url);
};

axiosStub.__handlers.put = async (url: string, body: any) => {
    for(const v of body.values){
        const key = v.functionInstance ? `${v.functionClass}::${v.functionInstance}` : v.functionClass;
        deviceState[key] = v.value;
        writes.push({ key, value: v.value });
    }
    return { status: 200, data: body };
};

// ---- fake homebridge ---------------------------------------------------
class FakeAccessory {
    displayName: string;
    UUID: string;
    context: any = {};
    services: any[] = [];

    constructor(name: string, uuid: string){
        this.displayName = name;
        this.UUID = uuid;
        this.services.push(new hap.Service.AccessoryInformation('AccessoryInformation'));
    }

    addService(service: any){
        const resolved = typeof service === 'function' ? new service() : service;
        if(this.services.some(s => s.UUID === resolved.UUID && s.subtype === resolved.subtype)){
            throw new Error('Cannot add a Service with the same UUID and subtype as another Service.');
        }
        this.services.push(resolved);
        return resolved;
    }

    getService(target: any){
        if(typeof target === 'string') return this.services.find(s => s.displayName === target);
        return this.services.find(s => s.UUID === target.UUID && !s.subtype);
    }

    getServiceById(target: any, subtype: string){
        if(typeof target === 'string') return this.services.find(s => s.displayName === target && s.subtype === subtype);
        return this.services.find(s => s.UUID === target.UUID && s.subtype === subtype);
    }

    removeService(service: any){
        this.services = this.services.filter(s => s !== service);
    }
}

const logLines: string[] = [];
const log: any = {
    info: (...a: any[]) => logLines.push('INFO  ' + a.join(' ')),
    warn: (...a: any[]) => logLines.push('WARN  ' + a.join(' ')),
    error: (...a: any[]) => logLines.push('ERROR ' + a.join(' ')),
    debug: (...a: any[]) => logLines.push('DEBUG ' + a.join(' '))
};

const platform: any = {
    log,
    config: { name: 'Hubspace', username: 'u', password: 'p', pollingInterval: 0 },
    Service: hap.Service,
    Characteristic: hap.Characteristic,
    api: { hap: hap, user: { storagePath: () => '/tmp' } },
    accountService: { accountId: 'acct-1' }
};
platform.deviceService = new DeviceService(platform);

// ---- build the device model through the real discovery mapping ---------
const discovery: any = new DiscoveryService(platform);
const device = discovery.mapDeviceResponseToModel(dump);

if(!device) throw new Error('Discovery refused to map the air conditioner.');

const accessory: any = new FakeAccessory(device.name, device.uuid);
accessory.context.device = device;

// ---- drive the accessory ----------------------------------------------
const C = hap.Characteristic;

function ch(service: any, characteristic: any){
    return service.getCharacteristic(characteristic);
}

async function main(){
    void HubspacePlatform; void isConfigValid;
    const ac = createAccessoryForDevice(device, platform, accessory);
    void (ac instanceof AirConditionerAccessory);

    const acService = accessory.services.find((s: any) => s.UUID === hap.Service.HeaterCooler.UUID);
    const coolFan = accessory.services.find((s: any) => s.subtype === 'ac-cool-fan');
    const fanOnly = accessory.services.find((s: any) => s.subtype === 'ac-fan-only');

    const results: string[] = [];
    const assert = (label: string, actual: unknown, expected: unknown) => {
        const ok = JSON.stringify(actual) === JSON.stringify(expected);
        results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}  actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    };

    // --- layout
    assert('three functional services', accessory.services.length, 4); // + AccessoryInformation
    assert('AC named after device', ch(acService, C.ConfiguredName).value, 'Garage AC');
    assert('cool fan named', ch(coolFan, C.ConfiguredName).value, 'Garage AC Cool');
    assert('fan named', ch(fanOnly, C.ConfiguredName).value, 'Garage AC Fan');
    assert('HeaterCooler now carries a fan slider', acService.testCharacteristic(C.RotationSpeed), true);

    assert('target temp range', ch(acService, C.CoolingThresholdTemperature).props,
        { minValue: 16, maxValue: 30, minStep: 0.5 });
    assert('target states are Auto + Cool', ch(acService, C.TargetHeaterCoolerState).props,
        { validValues: [C.TargetHeaterCoolerState.AUTO, C.TargetHeaterCoolerState.COOL] });

    // --- initial reads: unit off, mode auto-cool, fan auto, 35C, target 22C
    assert('AC inactive while off', await ch(acService, C.Active)._get(), C.Active.INACTIVE);
    assert('cool fan inactive while off', await ch(coolFan, C.Active)._get(), C.Active.INACTIVE);
    assert('fan only inactive while off', await ch(fanOnly, C.Active)._get(), C.Active.INACTIVE);
    assert('cool fan slider reads 0 while off', await ch(coolFan, C.RotationSpeed)._get(), 0);
    assert('current temperature', await ch(acService, C.CurrentTemperature)._get(), 35);
    assert('target temperature', await ch(acService, C.CoolingThresholdTemperature)._get(), 22);
    assert('target state is Auto', await ch(acService, C.TargetHeaterCoolerState)._get(), C.TargetHeaterCoolerState.AUTO);

    const readsBefore = getCount;
    await Promise.all([
        ch(acService, C.Active)._get(),
        ch(coolFan, C.RotationSpeed)._get(),
        ch(fanOnly, C.Active)._get()
    ]);
    assert('concurrent reads share one HTTP call', getCount - readsBefore, 0);

    // --- turn cooling on from the cool fan tile
    writes.length = 0;
    await ch(coolFan, C.Active)._set(C.Active.ACTIVE);
    assert('cool fan on just powers up (mode already auto-cool)', writes.map(w => `${w.key}=${w.value}`), ['power=on']);
    assert('AC tile follows', await ch(acService, C.Active)._get(), C.Active.ACTIVE);
    assert('cool fan slider shows Low (50%) - Auto is not a slider stop', await ch(coolFan, C.RotationSpeed)._get(), 50);
    assert('cooling because 35C > 22C', await ch(acService, C.CurrentHeaterCoolerState)._get(),
        C.CurrentHeaterCoolerState.COOLING);

    // --- THE REGRESSION: changing cool fan speed must not stop cooling
    writes.length = 0;
    await ch(coolFan, C.RotationSpeed)._set(100);
    assert('100% picks high speed', writes.map(w => `${w.key}=${w.value}`), ['fan-speed::ac-fan-speed=fan-speed-2-100']);
    assert('no mode write on speed change', writes.some(w => w.key === 'mode'), false);
    assert('no power write on speed change', writes.some(w => w.key === 'power'), false);
    assert('AC still on after speed change', await ch(acService, C.Active)._get(), C.Active.ACTIVE);
    assert('cool fan still on after speed change', await ch(coolFan, C.Active)._get(), C.Active.ACTIVE);
    assert('fan only still off', await ch(fanOnly, C.Active)._get(), C.Active.INACTIVE);
    assert('slider reads back 100', await ch(coolFan, C.RotationSpeed)._get(), 100);
    assert('AC tile slider mirrors the cool tile', await ch(acService, C.RotationSpeed)._get(), 100);

    // The fan slider on the HeaterCooler must behave exactly like the Cool tile:
    // set the shared speed, never touch mode or power.
    writes.length = 0;
    await ch(acService, C.RotationSpeed)._set(67);
    assert('AC tile slider 67% picks low', writes.map(w => `${w.key}=${w.value}`), ['fan-speed::ac-fan-speed=fan-speed-2-050']);
    assert('AC tile slider no mode write', writes.some(w => w.key === 'mode'), false);
    assert('AC tile slider no power write', writes.some(w => w.key === 'power'), false);
    await ch(coolFan, C.RotationSpeed)._set(100);

    writes.length = 0;
    await ch(coolFan, C.RotationSpeed)._set(67);
    assert('67% picks low speed', writes.map(w => `${w.key}=${w.value}`), ['fan-speed::ac-fan-speed=fan-speed-2-050']);
    assert('AC still on', await ch(acService, C.Active)._get(), C.Active.ACTIVE);

    writes.length = 0;
    await ch(coolFan, C.RotationSpeed)._set(33);
    assert('low end of slider picks Low, never Auto', writes.map(w => `${w.key}=${w.value}`), ['fan-speed::ac-fan-speed=fan-speed-2-050']);
    assert('AC still on', await ch(acService, C.Active)._get(), C.Active.ACTIVE);

    // --- mode button still works
    writes.length = 0;
    await ch(acService, C.TargetHeaterCoolerState)._set(C.TargetHeaterCoolerState.COOL);
    assert('Cool writes mode only', writes.map(w => `${w.key}=${w.value}`), ['mode=cool']);

    // --- temperature
    writes.length = 0;
    await ch(acService, C.CoolingThresholdTemperature)._set(20.3);
    assert('target snapped to 0.5 step', writes.map(w => `${w.key}=${w.value}`), ['temperature::cooling-target=20.5']);
    writes.length = 0;
    await ch(acService, C.CoolingThresholdTemperature)._set(45);
    assert('target clamped to device max', writes.map(w => `${w.key}=${w.value}`), ['temperature::cooling-target=30']);

    // --- mutual exclusion (the unit has one mode at a time)
    writes.length = 0;
    await ch(fanOnly, C.Active)._set(C.Active.ACTIVE);
    // Device is already on a real speed here, so only the mode changes.
    assert('fan takes over: mode only', writes.map(w => `${w.key}=${w.value}`), ['mode=fan']);
    assert('fan on', await ch(fanOnly, C.Active)._get(), C.Active.ACTIVE);
    assert('cool fan turns itself off', await ch(coolFan, C.Active)._get(), C.Active.INACTIVE);
    assert('AC tile turns itself off', await ch(acService, C.Active)._get(), C.Active.INACTIVE);
    // The fix: the cool tiles are pushed OFF in HomeKit immediately, not left
    // showing ON until the next poll.
    assert('cool tiles pushed OFF in HomeKit', [ch(acService, C.Active).value, ch(coolFan, C.Active).value],
        [C.Active.INACTIVE, C.Active.INACTIVE]);
    assert('cool fan slider reads 0', await ch(coolFan, C.RotationSpeed)._get(), 0);
    assert('fan slider shows Low (50%)', await ch(fanOnly, C.RotationSpeed)._get(), 50);

    writes.length = 0;
    await ch(fanOnly, C.RotationSpeed)._set(100);
    assert('fan only High', writes.map(w => `${w.key}=${w.value}`), ['fan-speed::ac-fan-speed=fan-speed-2-100']);
    assert('no mode write from fan only slider', writes.some(w => w.key === 'mode'), false);
    assert('fan only still on', await ch(fanOnly, C.Active)._get(), C.Active.ACTIVE);

    writes.length = 0;
    await ch(coolFan, C.Active)._set(C.Active.ACTIVE);
    assert('cool tile takes back over', writes.map(w => `${w.key}=${w.value}`), ['mode=cool']);
    assert('fan now off', await ch(fanOnly, C.Active)._get(), C.Active.INACTIVE);
    assert('fan tile pushed OFF in HomeKit', ch(fanOnly, C.Active).value, C.Active.INACTIVE);
    assert('fan slider reads 0', await ch(fanOnly, C.RotationSpeed)._get(), 0);

    // --- turning the idle tile off must not kill the running one
    writes.length = 0;
    await ch(fanOnly, C.Active)._set(C.Active.INACTIVE);
    assert('fan only off does not cut cooling', writes.length, 0);
    assert('cool fan still on', await ch(coolFan, C.Active)._get(), C.Active.ACTIVE);

    writes.length = 0;
    await ch(coolFan, C.Active)._set(C.Active.INACTIVE);
    assert('cool off powers down', writes.map(w => `${w.key}=${w.value}`), ['power=off']);
    assert('everything off', [
        await ch(acService, C.Active)._get(),
        await ch(coolFan, C.Active)._get(),
        await ch(fanOnly, C.Active)._get()
    ], [C.Active.INACTIVE, C.Active.INACTIVE, C.Active.INACTIVE]);

    // --- fan only from a cold start
    writes.length = 0;
    await ch(fanOnly, C.Active)._set(C.Active.ACTIVE);
    // Speed is already a real one here, so it is left alone.
    assert('fan only from off sets mode and power',
        writes.map(w => `${w.key}=${w.value}`),
        ['mode=fan', 'power=on']);
    writes.length = 0;
    await ch(fanOnly, C.Active)._set(C.Active.INACTIVE);
    assert('fan only off powers down', writes.map(w => `${w.key}=${w.value}`), ['power=off']);

    assert('dehumidify never written', writes.some(w => String(w.value).includes('dehumid')), false);

    console.log(results.join('\n'));
    console.log('\n--- warnings/errors ---');
    console.log(logLines.filter(l => l.startsWith('WARN') || l.startsWith('ERROR')).join('\n') || '(none)');

    const failures = results.filter(r => r.startsWith('FAIL'));
    if(failures.length > 0){
        console.log(`\n${failures.length} FAILURE(S)`);
        process.exitCode = 1;
    }else{
        console.log(`\nAll ${results.length} checks passed.`);
    }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
