import { Emulator, WordArray } from "./emulator.js";
import { Register, register_count } from "./instructions.js";

export type i53 = number;
export type Reg = number;
export type Word = number;
export type Ln_Nr = number;

export interface Warning {
    line_nr: number,
    message: string
}
export function warn(line_nr: number, message: string): Warning {
    return {line_nr, message};
}
export function expand_warnings(warnings: Warning[], lines: string[], file_name?: string): string {
    return warnings.map(w => expand_warning(w, lines, file_name)).join("\n\n");
}
export function expand_warning(warning: Warning, lines: string[], file_name?: string){
    const {message, line_nr} = warning;
    return `${file_name ?? "urcl"}:${line_nr+1} - ${message}\n   ${lines[line_nr]}`;
}

export function pad_left(str: string, size: number, char = " "){
    const pad = Math.max(0, size - str.length);
    return char.repeat(pad) + str;
}
export function pad_right(str: string, size: number, char = " "){
    const pad = Math.max(0, size - str.length);
    return str + char.repeat(pad);
}
export function pad_center(str: string, size: number, left_char = " ", right_char = left_char){
    const pad = Math.max(0, size - str.length);
    const left = 0| pad /2;
    const right = pad - left;
    return left_char.repeat(left) + str + right_char.repeat(right);
}
export function hex(num: number, size: number, pad=" "){
    return pad_left(num.toString(16), size, pad).toUpperCase();
}
export function hex_size(bits: number){
    return Math.ceil(bits / 4);
}

export function registers_to_string(emu: Emulator) {
    return registers_to_string_(emu.registers, emu._bits);
}

export function registers_to_string_(registers: WordArray, bits: number, do_headers = true) {
    const nibbles = hex_size(bits);
    return (
            !do_headers ? "" : Array.from({ length: register_count }, (_,i) => pad_center(Register[i], nibbles) + " ").join("") +
            Array.from({ length: registers.length - register_count }, (_, i) => pad_left(`R${i + 1}`, nibbles) + " ").join("") + "\n"
        ) +
        Array.from(registers, (v)=> hex(v, nibbles) + " ").join("");
}

export function memoryToString(view: Arr, from = 0x0, length = 0x1000, bits = 8) {
    const width = 0x10;
    const end = Math.min(from + length, view.length);
    const hexes = hex_size(bits);
    let lines: string[] = [
        // " ".repeat(hexes) + Array.from({ length: width }, (_, i) => {
        //     return pad_left(hex(i, 1), hexes);
        // }).join(" ")
    ];

    for (let i = from; i < end;) {
        const sub_end = Math.min(i + width, end);
        let subs = [];
        const addr = hex(0 | i / width, hexes - 1, " ");
        for (; i < sub_end; i++) {
            subs.push(hex(view[i], hexes));
        }
        const line = subs.join(" ");
        lines.push(addr + ":" + " ".repeat(hexes - addr.length) + line);
    }
    return lines.join("\n");
}

export function indent(string: string, spaces: number){
    const left = " ".repeat(spaces);
    return string.split("\n").map(line=>left + line).join("\n")
}

export interface Arr<T = number, L extends number = number> {
    [K: number]: T; 
    length: L;
    fill(a: number): this
    map(callback: (v: T, i: keyof this, arr:this)=>T): this
    join(sepperator?: string): string;
}
export function object_map<T, Res extends {}>
(obj: T, callback: (key: keyof T, value: T[keyof T])=>[keyof Res, Res[keyof Res]], target = {})
{
    const res = target as Res
    for (const key in obj){
        const value = obj[key];
        const [new_key, new_value] = callback(key, value);
        res[new_key] = new_value;
    }
    return res;
}

const char_code_0 = "0".charCodeAt(0);
const char_code_9 = char_code_0 + 9;
export function is_digit(str: string, index = 0){
    const char_code = str.charCodeAt(index);
    return char_code >= char_code_0 && char_code <= char_code_9; 
}
type Enum_Obj<T = unknown> = Record<string, T>

export function enum_last(enum_obj: Record<string, unknown> ){
    let last = -1;
    for (const key in enum_obj){
        const value = enum_obj[key];
        if (typeof value === "number"){
            last = Math.max(last, value);
        }
    }
    return last;
}

export function enum_count(enum_obj: Enum_Obj){
    return enum_last(enum_obj) + 1;
}

export function enum_strings<T>(enum_obj: Enum_Obj<T>): (T&string)[]
{
    const strings: (T&string)[] = [];
    for (const key in enum_obj){
        const value = enum_obj[key];
        if (typeof value === "string"){
            strings.push(value);
        }
    }
    return strings;
}
export function enum_numbers<T>(enum_obj: Enum_Obj<T>): (T&number)[]
{
    const strings: (T&number)[] = [];
    for (const key in enum_obj){
        const value = enum_obj[key];
        if (typeof value === "number"){
            strings.push(value);
        }
    }
    return strings;
}

export function enum_from_str<T>
    (enum_obj: Enum_Obj<T>, str: string): undefined | (T & number)
{
    if (is_digit(str)){
        return undefined;
    }
    const value = enum_obj[str];
    return value as T & number;
}

export function with_defaults<T>(defaults: T, options: Partial<T>): T {
    const with_defaults = {...defaults};
    for (const name in options){
        if (options[name] !== undefined){
            with_defaults[name] = options[name] as any;
        }
    }
    return with_defaults;
}

const conversion_buffer = new DataView(new ArrayBuffer(8)); 
export function f32_decode(int: number){
    conversion_buffer.setInt32(0, int, true);
    return conversion_buffer.getFloat32(0, true);
}
export function f32_encode(float: number){
    conversion_buffer.setFloat32(0, float, true);
    return conversion_buffer.getInt32(0, true);
}

// IRIS SPECIFIC: bias, normally 15 for IEEE
const f16_bias = 16;
const f16_exp_bits = 5;
const f16_frac_bits = 15 - f16_exp_bits;
const f16_max = ((2 << f16_frac_bits) - 1) << ((1 << f16_exp_bits) - 1 - f16_bias - f16_frac_bits);

export function f16_decode(int: number){
    if (int === 0){return 0;}
    const sign = (int >>> 15) & 1;
    // IRIS SPECIFIC: invert exponent and fraction
    int ^= sign * 0x7fff;
    const exponent = (int >>> 10) & 31;
    const fraction = int & 1023;
    let mag = ((fraction/1024) + 1) * 2**(exponent-f16_bias);

    if (mag >= f16_max) {
        mag = Infinity;
    }

    return sign ? -mag : mag;
}
export function f16_encode(float: number){
    const sign = Math.sign(float);
    float *= sign;

    let exponent = Math.floor(Math.log2(float));
    let fraction = (float / 2**exponent) - 1;
    if (exponent < -f16_bias) {
        return 0 * sign;
    }
    if (float >= f16_max) {
        exponent = 31 - f16_bias;
        fraction = 1;
    }

    let output = ((sign < 0 ? 1 : 0) << 15) | (((exponent + f16_bias) & 31) << 10) | (Math.min(1023, Math.round(fraction * 1024)) & 1023);
    // IRIS SPECIFIC: invert exponent and fraction
    output ^= sign < 0 ? 0x7fff : 0;
    return output;
}

export function read16(data: Uint8Array, little_endian: boolean, size: number): Uint16Array {
    size = Math.max(data.byteLength, size);
    const word_size = Math.ceil(size / 2);
    const buffer =new ArrayBuffer(word_size * 2);
    new Uint8Array(buffer).set(data);
    const view = new DataView(buffer);
    const out = new Uint16Array(word_size);
    for (let i = 0; i < word_size; i++) {
        out[i] = view.getUint16(i*2, little_endian);
    }
    return out;
}
export function read32(data: Uint8Array, little_endian: boolean, size: number): Uint32Array {
    size = Math.max(data.byteLength, size);
    const word_size = Math.ceil(size / 4);
    const buffer = new ArrayBuffer(word_size * 4);
    new Uint8Array(buffer).set(data);
    const view = new DataView(buffer);
    const out = new Uint32Array(word_size);
    for (let i = 0; i < word_size; i++) {
        out[i] = view.getUint32(i*4, little_endian);
    }
    return out;
}

export function write16(arr: Uint16Array, little_endian: boolean): Uint8Array {
    const out = new Uint8Array(arr.length*2);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    for (let i = 0; i < arr.length; i++){
        view.setUint16(i*2, arr[i], little_endian);
    }
    return out;
}
export function write32(arr: Uint32Array, little_endian: boolean): Uint8Array {
    const out = new Uint8Array(arr.length*4);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    for (let i = 0; i < arr.length; i++){
        view.setUint32(i*4, arr[i], little_endian);
    }
    return out;
}

export function format_int(n: number){
    const base = Math.floor(n).toString();
    let out = "";
    let i = base.length;
    out = base.substring(i-3, i)
    for (i-=3; i > 3; i-=3){
        out = base.substring(i-3, i) + "_" + out;
        
    }
    if (i > 0){
        out = base.substring(0, i) + "_" + out;
    }
    return out;
}

export function bound(n: number, min: number, max: number){
    return Math.max(min, Math.min(max, n));
}
