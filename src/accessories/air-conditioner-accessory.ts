import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { tryGetDeviceFunctionDef } from '../models/device-functions';
import type { DeviceFunctionResponse } from '../responses/device-function-response';
import { type MetadeviceStateValue, stateKey } from '../responses/metadevice-state-response';
import type { HubspacePlatform } from '../platform';
import { HubspaceAccessory } from './hubspace-accessory';

/** Function classes and instances advertised by Hubspace portable air conditioners. */
const FC_POWER = 'power';
const FC_MODE = 'mode';
const FC_FAN_SPEED = 'fan-speed';
const FI_AC_FAN_SPEED = 'ac-fan-speed';
const FC_TEMPERATURE = 'temperature';
const FI_CURRENT_TEMP = 'current-temp';
const FI_COOLING_TARGET = 'cooling-target';

const SUBTYPE_COOL_FAN = 'ac-cool-fan';
const SUBTYPE_FAN_ONLY = 'ac-fan-only';

/** How long a cached state read stays valid before another fetch is made. */
const STATE_CACHE_MS = 5000;

/**
 * After a write we trust our own optimistic value for this long. Afero takes a
 * couple of seconds to reflect a change, and without this the Home app slider
 * visibly snaps back to the old value before settling.
 */
const WRITE_GRACE_MS = 8000;

/** Default background refresh so external changes reach HomeKit. */
const DEFAULT_POLLING_SECONDS = 30;

const FALLBACK_MIN_TEMP = 16;
const FALLBACK_MAX_TEMP = 30;

interface ModeNames{
    cool?: string;
    auto?: string;
    fan?: string;
}

interface FanSpeedNames{
    /** Device value meaning "let the unit choose", if it has one. */
    auto?: string;
    /** Discrete speeds, slowest first. */
    speeds: string[];
}

/** A position on a HomeKit rotation-speed slider. */
interface SpeedStop{
    percentage: number;
    name: string;
}

interface TemperatureRange{
    min: number;
    max: number;
    step: number;
}

/**
 * Portable air conditioner (Hubspace device class `portable-air-conditioner`).
 *
 * The Apple Home app does not render a fan-speed slider on a HeaterCooler
 * service, so fan speed lives on two Fanv2 services instead. The unit can only
 * be doing one thing at a time, so the two fan tiles are mutually exclusive:
 * whichever one you switch on turns the other off.
 *
 * 1. HeaterCooler - power, Auto/Cool, current and target temperature.
 * 2. Fanv2 "Cool" - on means the unit is cooling; the slider sets the fan
 *    speed used while cooling (Auto / Low / High).
 * 3. Fanv2 "Fan Only" - on means fan-only mode; the slider sets Low / High.
 *
 * Both fan sliders write the same underlying device setting, because the unit
 * has a single fan-speed value shared across modes. Moving a slider never
 * changes the mode; only the on/off controls do.
 *
 * Dehumidify and Sleep are intentionally not exposed.
 *
 * Every device value (mode names, fan speed names, temperature range) is read
 * from the metadata the device advertises rather than hard-coded, so units that
 * label things differently still work.
 */
export class AirConditionerAccessory extends HubspaceAccessory{
    private readonly _acService: Service;
    private readonly _coolFanService: Service;
    private readonly _fanOnlyService: Service;

    private readonly _modes: ModeNames;
    private readonly _fanSpeeds: FanSpeedNames;
    private readonly _targetRange: TemperatureRange;

    /** Slider stops while cooling: Auto plus every discrete speed. */
    private readonly _coolFanStops: SpeedStop[];
    /** Slider stops in fan-only mode: the discrete speeds, Auto makes no sense here. */
    private readonly _fanOnlyStops: SpeedStop[];

    private readonly _currentRange: TemperatureRange;

    private _state = new Map<string, unknown>();
    private _stateFetchedAt = 0;
    private _lastWriteAt = 0;
    private _pendingRefresh?: NodeJS.Timeout;

    constructor(platform: HubspacePlatform, accessory: PlatformAccessory) {
        const name = accessory.context.device.name;
        const coolFan = new platform.Service.Fanv2(`${name} Cool`, SUBTYPE_COOL_FAN);
        const fanOnly = new platform.Service.Fanv2(`${name} Fan Only`, SUBTYPE_FAN_ONLY);

        super(platform, accessory, [
            platform.Service.HeaterCooler,
            coolFan,
            fanOnly
        ]);

        this._acService = this.services[0];
        this._coolFanService = this.services[1];
        this._fanOnlyService = this.services[2];

        this._modes = this.resolveModeNames();
        this._fanSpeeds = this.resolveFanSpeedNames();
        this._targetRange = this.resolveRange(FI_COOLING_TARGET, FALLBACK_MIN_TEMP, FALLBACK_MAX_TEMP, 0.5);
        this._currentRange = this.resolveRange(FI_CURRENT_TEMP, -20, 60, 0.1);

        this._coolFanStops = AirConditionerAccessory.buildStops(
            this._fanSpeeds.auto ? [this._fanSpeeds.auto, ...this._fanSpeeds.speeds] : this._fanSpeeds.speeds
        );
        this._fanOnlyStops = AirConditionerAccessory.buildStops(this._fanSpeeds.speeds);

        this.logCapabilities();

        this.configureName(this._acService, this.device.name);
        this.configureName(this._coolFanService, `${this.device.name} Cool`);
        this.configureName(this._fanOnlyService, `${this.device.name} Fan Only`);

        this.configureAirConditioner();
        this.configureCoolFan();
        this.configureFanOnly();
        this.removeStaleServices();

        this.startPolling();
    }

    // ------------------------------------------------------------------
    // Capability discovery
    // ------------------------------------------------------------------

    private functionDef(functionClass: string, functionInstance?: string): DeviceFunctionResponse | undefined{
        return tryGetDeviceFunctionDef(this.device.functions, functionClass, functionInstance);
    }

    private valueNames(functionClass: string, functionInstance?: string): string[]{
        return (this.functionDef(functionClass, functionInstance)?.values ?? [])
            .map(v => v.name)
            .filter((name): name is string => typeof name === 'string');
    }

    private static pick(names: string[], patterns: RegExp[]): string | undefined{
        for(const pattern of patterns){
            const match = names.find(name => pattern.test(name));
            if(match) return match;
        }

        return undefined;
    }

    /** Spreads slider stops evenly over 1-100%, leaving 0% to mean off. */
    private static buildStops(names: string[]): SpeedStop[]{
        return names.map((name, index) => ({
            percentage: Math.round((100 * (index + 1)) / names.length),
            name: name
        }));
    }

    private resolveModeNames(): ModeNames{
        const names = this.valueNames(FC_MODE);

        return {
            // Plain `cool` must win over `auto-cool`, hence the anchored pattern first.
            cool: AirConditionerAccessory.pick(names, [/^cool$/i, /^(?!auto).*cool.*$/i]),
            auto: AirConditionerAccessory.pick(names, [/^auto-cool$/i, /^auto$/i, /auto/i]),
            fan: AirConditionerAccessory.pick(names, [/^fan$/i, /^fan-only$/i, /fan/i])
        };
    }

    private resolveFanSpeedNames(): FanSpeedNames{
        const names = this.valueNames(FC_FAN_SPEED, FI_AC_FAN_SPEED);
        const auto = names.find(name => /auto/i.test(name));

        const speeds = names
            .filter(name => name !== auto)
            .map(name => ({ name: name, weight: AirConditionerAccessory.speedWeight(name) }))
            .sort((a, b) => a.weight - b.weight)
            .map(entry => entry.name);

        return { auto: auto, speeds: speeds };
    }

    /**
     * Orders speed names such as `fan-speed-2-050` / `fan-speed-2-100`, or
     * `low` / `medium` / `high`, from slowest to fastest.
     */
    private static speedWeight(name: string): number{
        const trailingNumber = /(\d+)\s*%?\s*$/.exec(name);
        if(trailingNumber) return Number.parseInt(trailingNumber[1], 10);

        if(/low|min|slow/i.test(name)) return 1;
        if(/med|mid|normal/i.test(name)) return 2;
        if(/high|max|full|turbo/i.test(name)) return 3;

        return 99;
    }

    private resolveRange(functionInstance: string, min: number, max: number, step: number): TemperatureRange{
        const range = this.functionDef(FC_TEMPERATURE, functionInstance)?.values?.[0]?.range;

        return {
            min: typeof range?.min === 'number' ? range.min : min,
            max: typeof range?.max === 'number' ? range.max : max,
            step: typeof range?.step === 'number' && range.step > 0 ? range.step : step
        };
    }

    private logCapabilities(): void{
        const missing: string[] = [];

        if(!this.functionDef(FC_POWER)) missing.push(FC_POWER);
        if(!this.functionDef(FC_MODE)) missing.push(FC_MODE);
        if(!this.functionDef(FC_FAN_SPEED, FI_AC_FAN_SPEED)) missing.push(`${FC_FAN_SPEED}/${FI_AC_FAN_SPEED}`);
        if(!this.functionDef(FC_TEMPERATURE, FI_CURRENT_TEMP)) missing.push(`${FC_TEMPERATURE}/${FI_CURRENT_TEMP}`);
        if(!this.functionDef(FC_TEMPERATURE, FI_COOLING_TARGET)) missing.push(`${FC_TEMPERATURE}/${FI_COOLING_TARGET}`);

        if(missing.length > 0){
            this.log.warn(
                `[${this.device.name}] Device does not advertise: ${missing.join(', ')}. ` +
                'The related HomeKit controls will not work.'
            );
        }

        const describe = (stops: SpeedStop[]) => stops.map(s => `${s.percentage}%=${s.name}`).join(', ');

        this.log.debug(
            `[${this.device.name}] modes -> cool: ${this._modes.cool ?? 'n/a'}, ` +
            `auto: ${this._modes.auto ?? 'n/a'}, fan: ${this._modes.fan ?? 'n/a'}; ` +
            `cool fan stops -> [${describe(this._coolFanStops)}]; ` +
            `fan only stops -> [${describe(this._fanOnlyStops)}]; ` +
            `target ${this._targetRange.min}-${this._targetRange.max} step ${this._targetRange.step}`
        );
    }

    // ------------------------------------------------------------------
    // State handling
    // ------------------------------------------------------------------

    private async ensureState(force = false): Promise<void>{
        const now = Date.now();

        if(!force && this._stateFetchedAt > 0){
            // Immediately after a write our optimistic value is more accurate
            // than anything the cloud will report, so keep it.
            if(now - this._lastWriteAt < WRITE_GRACE_MS) return;
            if(now - this._stateFetchedAt < STATE_CACHE_MS) return;
        }

        const values = await this.deviceService.getMetadeviceState(this.device.id);

        // Keep the last known state rather than blanking the accessory; the
        // characteristic getters decide whether to raise a HomeKit error.
        if(!values) return;

        this._state = AirConditionerAccessory.toStateMap(values);
        this._stateFetchedAt = Date.now();
    }

    private static toStateMap(values: MetadeviceStateValue[]): Map<string, unknown>{
        const map = new Map<string, unknown>();

        for(const value of values){
            map.set(stateKey(value.functionClass, value.functionInstance), value.value);
        }

        return map;
    }

    private read(functionClass: string, functionInstance?: string): unknown{
        return this._state.get(stateKey(functionClass, functionInstance));
    }

    private readString(functionClass: string, functionInstance?: string): string | undefined{
        const value = this.read(functionClass, functionInstance);
        return typeof value === 'string' ? value.trim() : undefined;
    }

    private readNumber(functionClass: string, functionInstance?: string): number | undefined{
        const value = this.read(functionClass, functionInstance);

        if(typeof value === 'number') return value;

        if(typeof value === 'string'){
            const parsed = Number.parseFloat(value);
            if(!Number.isNaN(parsed)) return parsed;
        }

        return undefined;
    }

    private async write(
        functionClass: string,
        functionInstance: string | undefined,
        value: string | number
    ): Promise<void>{
        const succeeded = await this.deviceService.setMetadeviceState(
            this.device.id, functionClass, functionInstance, value
        );

        if(!succeeded) throw this.communicationFailure();

        this._state.set(stateKey(functionClass, functionInstance), value);
        this._lastWriteAt = Date.now();
        this.scheduleRefresh(WRITE_GRACE_MS + 1000);
    }

    private communicationFailure(): Error{
        return new this.platform.api.hap.HapStatusError(
            this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
        );
    }

    private scheduleRefresh(delayMs: number): void{
        if(this._pendingRefresh) clearTimeout(this._pendingRefresh);

        this._pendingRefresh = setTimeout(() => {
            this._pendingRefresh = undefined;
            this.refresh().catch(() => undefined);
        }, delayMs);
    }

    private startPolling(): void{
        const configured = Number(this.config.pollingInterval);
        const seconds = Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_POLLING_SECONDS;

        // Prime HomeKit with a first reading right away.
        this.refresh().catch(() => undefined);

        if(seconds === 0){
            this.log.debug(`[${this.device.name}] Background polling disabled.`);
            return;
        }

        const intervalMs = Math.max(10, seconds) * 1000;
        setInterval(() => this.refresh().catch(() => undefined), intervalMs);
    }

    /** Fetches fresh state and pushes it into HomeKit. */
    private async refresh(): Promise<void>{
        await this.ensureState(true);
        if(this._stateFetchedAt === 0) return;

        const C = this.platform.Characteristic;

        this._acService.updateCharacteristic(C.Active, this.computeCoolActive());
        this._acService.updateCharacteristic(C.CurrentHeaterCoolerState, this.computeCurrentState());
        this._acService.updateCharacteristic(C.TargetHeaterCoolerState, this.computeTargetState());

        const currentTemp = this.readNumber(FC_TEMPERATURE, FI_CURRENT_TEMP);
        if(currentTemp !== undefined){
            this._acService.updateCharacteristic(C.CurrentTemperature, this.clampCurrent(currentTemp));
        }

        const targetTemp = this.readNumber(FC_TEMPERATURE, FI_COOLING_TARGET);
        if(targetTemp !== undefined){
            this._acService.updateCharacteristic(C.CoolingThresholdTemperature, this.clampTarget(targetTemp));
        }

        this._coolFanService.updateCharacteristic(C.Active, this.computeCoolActive());
        this._coolFanService.updateCharacteristic(C.RotationSpeed, this.computeCoolFanSpeed());

        this._fanOnlyService.updateCharacteristic(C.Active, this.computeFanOnlyActive());
        this._fanOnlyService.updateCharacteristic(C.RotationSpeed, this.computeFanOnlySpeed());
    }

    // ------------------------------------------------------------------
    // Device level helpers
    // ------------------------------------------------------------------

    private isPoweredOn(): boolean{
        const value = this.readString(FC_POWER);
        if(value === undefined) return false;
        return /^(on|1|true)$/i.test(value);
    }

    private currentMode(): string | undefined{
        return this.readString(FC_MODE);
    }

    private isFanOnlyMode(): boolean{
        const mode = this.currentMode();
        return mode !== undefined && this._modes.fan !== undefined && mode === this._modes.fan;
    }

    private isAutoMode(): boolean{
        const mode = this.currentMode();
        return mode !== undefined && this._modes.auto !== undefined && mode === this._modes.auto;
    }

    private async setPower(on: boolean): Promise<void>{
        const names = this.valueNames(FC_POWER);
        const target = AirConditionerAccessory.pick(names, on ? [/^on$/i] : [/^off$/i]) ?? (on ? 'on' : 'off');
        await this.write(FC_POWER, undefined, target);
    }

    private async setMode(mode: string): Promise<void>{
        await this.write(FC_MODE, undefined, mode);
    }

    private async ensurePowerOn(): Promise<void>{
        if(!this.isPoweredOn()) await this.setPower(true);
    }

    /** Switches the unit into a cooling mode, preserving Auto if it was already set. */
    private async ensureCoolingMode(): Promise<void>{
        if(!this.isFanOnlyMode() && this.currentMode() !== undefined) return;

        const target = this._modes.cool ?? this._modes.auto;
        if(target) await this.setMode(target);
    }

    private clampTarget(value: number): number{
        return Math.min(this._targetRange.max, Math.max(this._targetRange.min, value));
    }

    private clampCurrent(value: number): number{
        return Math.min(this._currentRange.max, Math.max(this._currentRange.min, value));
    }

    private currentSpeedName(): string | undefined{
        return this.readString(FC_FAN_SPEED, FI_AC_FAN_SPEED);
    }

    /** Reads the device's fan speed back as a slider percentage. */
    private speedToPercentage(stops: SpeedStop[], fallbackToFirst: boolean): number{
        if(stops.length === 0) return 0;

        const current = this.currentSpeedName();
        const stop = stops.find(s => s.name === current);

        if(stop) return stop.percentage;

        // The device is on a speed this slider does not offer (Auto while in
        // fan-only mode, for example). Show the slowest rather than 0, which
        // HomeKit would read as "off".
        return fallbackToFirst ? stops[0].percentage : 0;
    }

    /** Maps a slider percentage to the nearest device speed. */
    private static percentageToSpeed(stops: SpeedStop[], percentage: number): string | undefined{
        if(stops.length === 0) return undefined;

        let best = stops[0];
        for(const stop of stops){
            if(Math.abs(stop.percentage - percentage) < Math.abs(best.percentage - percentage)) best = stop;
        }

        return best.name;
    }

    // ------------------------------------------------------------------
    // HeaterCooler service (power, mode, temperature)
    // ------------------------------------------------------------------

    private configureAirConditioner(): void{
        const C = this.platform.Characteristic;
        const service = this._acService;

        service.getCharacteristic(C.Active)
            .onGet(this.getCoolActive.bind(this))
            .onSet(this.setCoolActive.bind(this));

        service.getCharacteristic(C.CurrentHeaterCoolerState)
            .setProps({
                validValues: [
                    C.CurrentHeaterCoolerState.INACTIVE,
                    C.CurrentHeaterCoolerState.IDLE,
                    C.CurrentHeaterCoolerState.COOLING
                ]
            })
            .onGet(this.getCurrentState.bind(this));

        const validTargets = [C.TargetHeaterCoolerState.COOL];
        if(this._modes.auto) validTargets.unshift(C.TargetHeaterCoolerState.AUTO);

        service.getCharacteristic(C.TargetHeaterCoolerState)
            .setProps({ validValues: validTargets })
            .onGet(this.getTargetState.bind(this))
            .onSet(this.setTargetState.bind(this));

        service.getCharacteristic(C.CurrentTemperature)
            .setProps({
                minValue: this._currentRange.min,
                maxValue: this._currentRange.max,
                minStep: this._currentRange.step
            })
            .onGet(this.getCurrentTemperature.bind(this));

        service.getCharacteristic(C.CoolingThresholdTemperature)
            .setProps({
                minValue: this._targetRange.min,
                maxValue: this._targetRange.max,
                minStep: this._targetRange.step
            })
            .onGet(this.getTargetTemperature.bind(this))
            .onSet(this.setTargetTemperature.bind(this));

        // No RotationSpeed here on purpose: the Home app does not render a fan
        // slider on a HeaterCooler, and having one would fight the Fanv2 tiles.
    }

    private computeCurrentState(): number{
        const C = this.platform.Characteristic.CurrentHeaterCoolerState;

        if(!this.isPoweredOn() || this.isFanOnlyMode()) return C.INACTIVE;

        const current = this.readNumber(FC_TEMPERATURE, FI_CURRENT_TEMP);
        const target = this.readNumber(FC_TEMPERATURE, FI_COOLING_TARGET);

        if(current !== undefined && target !== undefined && current <= target) return C.IDLE;

        return C.COOLING;
    }

    private async getCurrentState(): Promise<CharacteristicValue>{
        await this.ensureState();
        if(this._stateFetchedAt === 0) throw this.communicationFailure();
        return this.computeCurrentState();
    }

    private computeTargetState(): number{
        const C = this.platform.Characteristic.TargetHeaterCoolerState;
        return this._modes.auto && this.isAutoMode() ? C.AUTO : C.COOL;
    }

    private async getTargetState(): Promise<CharacteristicValue>{
        await this.ensureState();
        if(this._stateFetchedAt === 0) throw this.communicationFailure();
        return this.computeTargetState();
    }

    private async setTargetState(value: CharacteristicValue): Promise<void>{
        await this.ensureState();
        const C = this.platform.Characteristic.TargetHeaterCoolerState;

        const target = Number(value) === C.AUTO
            ? this._modes.auto ?? this._modes.cool
            : this._modes.cool ?? this._modes.auto;

        if(!target){
            this.log.warn(`[${this.device.name}] Device does not advertise a usable cooling mode.`);
            throw this.communicationFailure();
        }

        await this.setMode(target);
        await this.ensurePowerOn();
        this.scheduleRefresh(1500);
    }

    private async getCurrentTemperature(): Promise<CharacteristicValue>{
        await this.ensureState();
        const value = this.readNumber(FC_TEMPERATURE, FI_CURRENT_TEMP);
        if(value === undefined) throw this.communicationFailure();
        return this.clampCurrent(value);
    }

    private async getTargetTemperature(): Promise<CharacteristicValue>{
        await this.ensureState();
        const value = this.readNumber(FC_TEMPERATURE, FI_COOLING_TARGET);
        if(value === undefined) throw this.communicationFailure();
        return this.clampTarget(value);
    }

    private async setTargetTemperature(value: CharacteristicValue): Promise<void>{
        const step = this._targetRange.step;
        const snapped = Math.round(Number(value) / step) * step;
        // Guard against floating point noise such as 22.500000000000004.
        const temperature = Math.round(this.clampTarget(snapped) * 100) / 100;

        await this.write(FC_TEMPERATURE, FI_COOLING_TARGET, temperature);
    }

    // ------------------------------------------------------------------
    // Cooling fan tile
    // ------------------------------------------------------------------

    private configureCoolFan(): void{
        const C = this.platform.Characteristic;
        const service = this._coolFanService;

        service.getCharacteristic(C.Active)
            .onGet(this.getCoolActive.bind(this))
            .onSet(this.setCoolActive.bind(this));

        service.getCharacteristic(C.RotationSpeed)
            .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
            .onGet(this.getCoolFanSpeed.bind(this))
            .onSet(this.setCoolFanSpeed.bind(this));
    }

    private computeCoolActive(): number{
        const C = this.platform.Characteristic.Active;
        return this.isPoweredOn() && !this.isFanOnlyMode() ? C.ACTIVE : C.INACTIVE;
    }

    private async getCoolActive(): Promise<CharacteristicValue>{
        await this.ensureState();
        if(this._stateFetchedAt === 0) throw this.communicationFailure();
        return this.computeCoolActive();
    }

    private async setCoolActive(value: CharacteristicValue): Promise<void>{
        await this.ensureState();
        const shouldBeActive = Number(value) === this.platform.Characteristic.Active.ACTIVE;

        if(!shouldBeActive){
            // Only cut power if fan-only is not the thing keeping the unit on.
            if(!this.isFanOnlyMode()) await this.setPower(false);
            this.scheduleRefresh(1500);
            return;
        }

        await this.ensureCoolingMode();
        await this.ensurePowerOn();
        this.scheduleRefresh(1500);
    }

    private computeCoolFanSpeed(): number{
        if(this.computeCoolActive() === this.platform.Characteristic.Active.INACTIVE) return 0;
        return this.speedToPercentage(this._coolFanStops, true);
    }

    private async getCoolFanSpeed(): Promise<CharacteristicValue>{
        await this.ensureState();
        if(this._stateFetchedAt === 0) throw this.communicationFailure();
        return this.computeCoolFanSpeed();
    }

    private async setCoolFanSpeed(value: CharacteristicValue): Promise<void>{
        await this.ensureState();
        const percentage = Number(value);

        // HomeKit sends 0% as part of switching a fan off; Active handles that.
        if(percentage <= 0) return;

        const speed = AirConditionerAccessory.percentageToSpeed(this._coolFanStops, percentage);
        if(!speed) return;

        // Deliberately does not touch the mode. Changing fan speed must never
        // stop the unit cooling.
        await this.write(FC_FAN_SPEED, FI_AC_FAN_SPEED, speed);
        this.scheduleRefresh(1500);
    }

    // ------------------------------------------------------------------
    // Fan only tile
    // ------------------------------------------------------------------

    private configureFanOnly(): void{
        const C = this.platform.Characteristic;
        const service = this._fanOnlyService;

        service.getCharacteristic(C.Active)
            .onGet(this.getFanOnlyActive.bind(this))
            .onSet(this.setFanOnlyActive.bind(this));

        service.getCharacteristic(C.RotationSpeed)
            .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
            .onGet(this.getFanOnlySpeed.bind(this))
            .onSet(this.setFanOnlySpeed.bind(this));
    }

    private computeFanOnlyActive(): number{
        const C = this.platform.Characteristic.Active;
        return this.isPoweredOn() && this.isFanOnlyMode() ? C.ACTIVE : C.INACTIVE;
    }

    private async getFanOnlyActive(): Promise<CharacteristicValue>{
        await this.ensureState();
        if(this._stateFetchedAt === 0) throw this.communicationFailure();
        return this.computeFanOnlyActive();
    }

    private async setFanOnlyActive(value: CharacteristicValue): Promise<void>{
        await this.ensureState();
        const shouldBeActive = Number(value) === this.platform.Characteristic.Active.ACTIVE;

        if(!shouldBeActive){
            // Only cut power if fan-only is what is currently running.
            if(this.isFanOnlyMode()) await this.setPower(false);
            this.scheduleRefresh(1500);
            return;
        }

        if(!this._modes.fan){
            this.log.warn(`[${this.device.name}] Device does not advertise a fan-only mode.`);
            throw this.communicationFailure();
        }

        await this.setMode(this._modes.fan);

        // Auto fan speed is meaningless without cooling, so pick a real speed.
        const current = this.currentSpeedName();
        if(this._fanSpeeds.speeds.length > 0 && (current === undefined || !this._fanSpeeds.speeds.includes(current))){
            await this.write(FC_FAN_SPEED, FI_AC_FAN_SPEED, this._fanSpeeds.speeds[0]);
        }

        await this.ensurePowerOn();
        this.scheduleRefresh(1500);
    }

    private computeFanOnlySpeed(): number{
        if(this.computeFanOnlyActive() === this.platform.Characteristic.Active.INACTIVE) return 0;
        return this.speedToPercentage(this._fanOnlyStops, true);
    }

    private async getFanOnlySpeed(): Promise<CharacteristicValue>{
        await this.ensureState();
        if(this._stateFetchedAt === 0) throw this.communicationFailure();
        return this.computeFanOnlySpeed();
    }

    private async setFanOnlySpeed(value: CharacteristicValue): Promise<void>{
        await this.ensureState();
        const percentage = Number(value);

        if(percentage <= 0) return;

        const speed = AirConditionerAccessory.percentageToSpeed(this._fanOnlyStops, percentage);
        if(!speed) return;

        // Deliberately does not touch the mode either; the Active control owns
        // which mode the unit is in.
        await this.write(FC_FAN_SPEED, FI_AC_FAN_SPEED, speed);
        this.scheduleRefresh(1500);
    }
}
