/* eslint-disable */
// Self-contained stand-ins for the `homebridge` (HAP) and `axios` modules the
// accessory code depends on, so `npx tsx sim/simulate.ts` runs from a clean
// checkout with no extra setup.
//
// These stubs previously lived in a gitignored `node_modules` shadow and never
// made it into version control; this file replaces that mechanism. Only the
// surface the portable-AC code path actually touches is implemented.
import axios from 'axios';

// ---- fake HAP (homebridge) ---------------------------------------------

/** A single characteristic instance living on a service. */
class FakeCharacteristic {
    UUID: string;
    value: any = null;
    props: any = {};
    private _getter?: () => any;
    private _setter?: (v: any) => any;

    constructor(uuid: string){
        this.UUID = uuid;
    }

    onGet(fn: () => any){ this._getter = fn; return this; }
    onSet(fn: (v: any) => any){ this._setter = fn; return this; }
    setProps(p: any){ this.props = { ...this.props, ...p }; return this; }
    updateValue(v: any){ this.value = v; return this; }
    setValue(v: any){ this.value = v; return this; }

    /** Sim helper: invoke the registered onGet handler. */
    async _get(){ return this._getter ? await this._getter() : this.value; }
    /** Sim helper: invoke the registered onSet handler. */
    async _set(v: any){ this.value = v; if(this._setter) return await this._setter(v); }
}

class FakeService {
    static UUID = 'Service';
    UUID: string;
    subtype?: string;
    displayName: string;
    private _chars = new Map<string, FakeCharacteristic>();

    constructor(displayName?: string, subtype?: string){
        this.displayName = displayName ?? '';
        this.subtype = subtype;
        this.UUID = (this.constructor as any).UUID;
    }

    getCharacteristic(charClass: any): FakeCharacteristic{
        const uuid = charClass.UUID;
        let c = this._chars.get(uuid);
        if(!c){
            c = new FakeCharacteristic(uuid);
            this._chars.set(uuid, c);
        }
        return c;
    }

    testCharacteristic(charClass: any): boolean{
        return this._chars.has(charClass.UUID);
    }

    setCharacteristic(charClass: any, value: any){
        this.getCharacteristic(charClass).value = value;
        return this;
    }

    updateCharacteristic(charClass: any, value: any){
        this.getCharacteristic(charClass).value = value;
        return this;
    }

    addCharacteristic(charClass: any){ return this.getCharacteristic(charClass); }
    addOptionalCharacteristic(_charClass: any){ return this; }
}

class Fanv2 extends FakeService{ static UUID = 'Fanv2'; }
class HeaterCooler extends FakeService{ static UUID = 'HeaterCooler'; }
class TemperatureSensor extends FakeService{ static UUID = 'TemperatureSensor'; }
class AccessoryInformation extends FakeService{ static UUID = 'AccessoryInformation'; }
class ProtocolInformation extends FakeService{ static UUID = 'ProtocolInformation'; }

(FakeService as any).Fanv2 = Fanv2;
(FakeService as any).HeaterCooler = HeaterCooler;
(FakeService as any).TemperatureSensor = TemperatureSensor;
(FakeService as any).AccessoryInformation = AccessoryInformation;
(FakeService as any).ProtocolInformation = ProtocolInformation;

const Characteristic: any = {
    Active: { UUID: 'Active', INACTIVE: 0, ACTIVE: 1 },
    CurrentHeaterCoolerState: { UUID: 'CurrentHeaterCoolerState', INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3 },
    TargetHeaterCoolerState: { UUID: 'TargetHeaterCoolerState', AUTO: 0, HEAT: 1, COOL: 2 },
    CurrentTemperature: { UUID: 'CurrentTemperature' },
    CoolingThresholdTemperature: { UUID: 'CoolingThresholdTemperature' },
    HeatingThresholdTemperature: { UUID: 'HeatingThresholdTemperature' },
    RotationSpeed: { UUID: 'RotationSpeed' },
    Name: { UUID: 'Name' },
    ConfiguredName: { UUID: 'ConfiguredName' },
    Manufacturer: { UUID: 'Manufacturer' },
    Model: { UUID: 'Model' },
    SerialNumber: { UUID: 'SerialNumber' }
};

class HapStatusError extends Error{
    hapStatus: number;
    constructor(status: number){
        super(`HapStatusError ${status}`);
        this.hapStatus = status;
    }
}

const HAPStatus = { SERVICE_COMMUNICATION_FAILURE: -70402 };

export const hap: any = {
    Service: FakeService,
    Characteristic,
    HapStatusError,
    HAPStatus,
    // Deterministic stand-in for HAP's UUID generator; the sim only needs a
    // stable string per device id, not a real v5 UUID.
    uuid: { generate: (seed: string) => `uuid-${seed}` }
};

// ---- fake axios --------------------------------------------------------

/**
 * Replaces `axios.create` so every client the code builds routes its requests
 * to the handlers on the returned holder. The sim assigns
 * `holder.__handlers.get` / `.put` to stand in for the Afero cloud.
 */
export function installAxiosStub(): { __handlers: any }{
    const handlers: any = {};

    const dispatch = (name: string) => (url: string, ...rest: any[]) => {
        const fn = handlers[name];
        if(typeof fn !== 'function') return Promise.reject(new Error(`unexpected ${name.toUpperCase()} ${url}`));
        return fn(url, ...rest);
    };

    const makeClient = () => ({
        interceptors: {
            request: { use: () => undefined },
            response: { use: () => undefined }
        },
        defaults: { headers: {} },
        get: dispatch('get'),
        put: dispatch('put'),
        post: dispatch('post'),
        delete: dispatch('delete'),
        request: dispatch('request')
    });

    const ax: any = axios;
    ax.create = () => makeClient();
    if(ax.default) ax.default.create = ax.create;

    return { __handlers: handlers };
}
