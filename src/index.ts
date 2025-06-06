import "./editor/editor.js";
import "./scroll-out/scroll-out.js";
import "./buffer_view/buffer_view.js";

import { Editor_Window } from "./editor/editor.js";
import { compile } from "./emulator/compiler.js";
import { Clock } from "./emulator/devices/clock.js";
import { Console_IO } from "./emulator/devices/console-io.js";
import { Color_Mode, Display } from "./emulator/devices/display.js";
import { Gamepad_Key, Gamepad_Axis, Pad } from "./emulator/devices/gamepad.js";
import { Gl_Display } from "./emulator/devices/gl-display.js";
import { Keyboard } from "./emulator/devices/keyboard.js";
import { KeyboardPad } from "./emulator/devices/keyboardpad.js";
import { Mouse } from "./emulator/devices/mouse.js";
import { RNG } from "./emulator/devices/rng.js";
import { Sound } from "./emulator/devices/sound.js";
import { Storage } from "./emulator/devices/storage.js";
import { Emulator, Step_Result } from "./emulator/emulator.js";
import { parse } from "./emulator/parser.js";
import { Arr, enum_from_str, enum_strings, expand_warning, registers_to_string, memoryToString, format_int, registers_to_string_ } from "./emulator/util.js";
import { Scroll_Out } from "./scroll-out/scroll-out.js";
import { register_count } from "./emulator/instructions.js";
import { BufferView } from "./buffer_view/buffer_view.js";
import { Iris_Display } from "./emulator/devices/iris/iris-display.js";
import { urcl2c } from "./emulator/urcl2c.js";
import { Run_Type } from "./emulator/wasm/urcl2wasm.js";

let animation_frame: number | undefined;
let running = false;
let started = false;
let input = false;
let last_step = performance.now();
let clock_speed = 0;
let clock_count = 0;

const source_input = document.getElementById("urcl-source") as Editor_Window;
source_input.profile_check.addEventListener("change", update_views);
const output_element = document.getElementById("output") as HTMLOutputElement;
const debug_output_element = document.getElementById("debug-output") as HTMLElement;
const memory_view = document.getElementById("memory-view") as BufferView;
const register_view = document.getElementById("register-view") as HTMLElement;

const console_input = document.getElementById("stdin") as HTMLTextAreaElement;
const console_output = document.getElementById("stdout") as Scroll_Out;
const null_terminate_input = document.getElementById("null-terminate") as HTMLInputElement;
const console_copy = document.getElementById("copy-console") as HTMLButtonElement;
const share_button = document.getElementById("share-button") as HTMLButtonElement;
const auto_run_input = document.getElementById("auto-run-input") as HTMLInputElement;
const storage_input = document.getElementById("storage-input") as HTMLInputElement;
const storage_msg = document.getElementById("storage-msg") as HTMLInputElement;
const storage_size = document.getElementById("storage-size") as HTMLInputElement;
const storage_little = document.getElementById("storage-little") as HTMLInputElement;
const storage_update = document.getElementById("storage-update") as HTMLInputElement;
const storage_download = document.getElementById("storage-download") as HTMLInputElement;
const clock_speed_input = document.getElementById("clock-speed-input") as HTMLInputElement;
const clock_speed_output = document.getElementById("clock-speed-output") as HTMLInputElement;

const cout = document.getElementById("c-out") as HTMLElement;
const cout_check = document.getElementById("c-out-check") as HTMLInputElement;

const memory_update_input = document.getElementById("update-mem-input") as HTMLInputElement;

const jit_radio_js = document.getElementById("jit-radio-js") as HTMLInputElement;
const jit_radio_wasm = document.getElementById("jit-radio-wasm") as HTMLInputElement;
const count_radio_jumps = document.getElementById("count-radio-jumps") as HTMLInputElement;
const count_radio_none = document.getElementById("count-radio-none") as HTMLInputElement;



// IRIS stuff

const font_file = document.getElementById("font-file") as HTMLInputElement;

font_file.oninput = e => {
    const font = font_file.files?.[0];
    if (font === undefined) {
        return;
    }
    iris_display.load_font(font);
}

const call_stack = document.getElementById("call-stack") as HTMLOutputElement;
const data_stack = document.getElementById("data-stack") as HTMLOutputElement;
const register_save_stack = document.getElementById("register-save-stack") as HTMLOutputElement;

const url = new URL(location.href, location.origin)
const srcurl = url.searchParams.get("srcurl");
const storage_url = url.searchParams.get("storage");
const width = parseInt(url.searchParams.get("width") ?? "") || 128;
const height = parseInt(url.searchParams.get("height") ?? "") || 96;
const color = enum_from_str(Color_Mode, url.searchParams.get("color") ?? "") ?? Color_Mode.Bin;

memory_update_input.oninput = () => update_views();

const max_clock_speed = 10_000_000_000;
const max_its = 1.2 * max_clock_speed / 16;
clock_speed_input.oninput = change_clockspeed
function change_clockspeed() {
    clock_speed = Math.min(max_clock_speed, Math.max(0, Number(clock_speed_input.value) || 0));
    clock_speed_output.value = ""+clock_speed;
    last_step = performance.now();
}
change_clockspeed();

share_button.onclick = e => {
    const srcurl = `data:text/plain;base64,${btoa(source_input.value)}`;
    const share = new URL(location.href);
    share.searchParams.set("srcurl", srcurl);
    share.searchParams.set("width", ""+canvas.width);
    share.searchParams.set("height", ""+canvas.height);
    share.searchParams.set("color", Color_Mode[display.color_mode]);
    navigator.clipboard.writeText(share.href);
}

let storage_uploaded: undefined | Uint8Array;
let storage_device: undefined | Storage;
let storage_loads = 0;

function load_array_buffer(buffer: ArrayBuffer) {
    storage_uploaded = new Uint8Array(buffer);
    const bytes = storage_uploaded.slice();
    emulator.add_io_device(storage_device = new Storage(emulator._bits, storage_little.checked, (Number(storage_size.value) || 0) * emulator._bits / 8));
    storage_device.set_bytes(bytes);
    storage_msg.innerText = `loaded storage device with ${storage_device.word_count} words`;
}

storage_size.oninput =
storage_little.oninput =
storage_input.oninput = on_storage_update;
async function on_storage_update() {
    storage_msg.classList.remove("error");
    const files = storage_input.files;
    let buffer;
    if (files === null || files.length < 1){
        storage_msg.classList.add("error");
        storage_msg.innerText = "No file specified loading empty file";
        buffer = new ArrayBuffer(0);
    } else {
        const file = files[0];
        buffer = await file.arrayBuffer();
    }
    try {
        load_array_buffer(buffer);
    } catch (error: any) {
        storage_msg.classList.add("error");
        storage_msg.innerText = ""+error;
    }
}
storage_update.onclick = e => {
    if (storage_device === undefined){
        storage_msg.innerText = `No storage to update`;
        return;
    }
    storage_uploaded = storage_device.get_bytes();
    storage_msg.innerText = `Updated storage`;
}

storage_download.onclick = e => {
    if (storage_device === undefined && storage_uploaded === undefined){
        storage_msg.innerText = `No storage to download`;
        return;
    }
    if (storage_device !== undefined){
        storage_uploaded = storage_device.get_bytes();
    }
    const url = URL.createObjectURL(new Blob([storage_uploaded as Uint8Array]));
    const a = document.createElement("a");
    const file_name = storage_input.value.split(/\\|\//).at(-1);
    a.download = file_name || "storage.bin";
    a.href = url;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let input_callback: undefined | (() => void);


console_input.addEventListener("keydown", e => {
    if (!e.shiftKey && e.key === "Enter" && input_callback){
        e.preventDefault();
        if (null_terminate_input.checked){
            console_input.value += "\0";   
        } else {
            console_input.value += "\n";
        }
        
        input_callback();
    }
})

console_copy.addEventListener("click", e => {
    navigator.clipboard.writeText(console_output.get_text());
});


const canvas = document.getElementsByTagName("canvas")[0];
let ctx = canvas.getContext("webgl2");

if (!ctx) {
    throw new Error("Unable to get rendering context");
}

canvas.width = width || 32;
canvas.height = height || 32;

const display = new Gl_Display(ctx, color);
const color_mode_input = document.getElementById("color-mode") as HTMLOptionElement;
if (color !== undefined) color_mode_input.value = Color_Mode[color];
color_mode_input.addEventListener("change", change_color_mode);
function change_color_mode(){
    const color_mode = enum_from_str(Color_Mode, color_mode_input.value);
    display.color_mode = color_mode ?? display.color_mode;
    display.update_display();
}

const do_bin_to_color_input = document.getElementById("do_bin_to_color") as HTMLInputElement;
do_bin_to_color_input.addEventListener("change", change_do_bin_to_color);
function change_do_bin_to_color() {
    display.do_bin_to_color = do_bin_to_color_input.checked;
    display.update_display();
}
change_do_bin_to_color();

const width_input = document.getElementById("display-width") as HTMLInputElement;
const height_input = document.getElementById("display-height") as HTMLInputElement;
const fullscreen_button = document.getElementById("display-fullscreen") as HTMLButtonElement;
fullscreen_button.onclick = () => {
    canvas.requestPointerLock();
    canvas.requestFullscreen();
}

width_input.value = ""+canvas.width
height_input.value = ""+canvas.height
width_input.addEventListener("input", resize_display);
height_input.addEventListener("input", resize_display);
resize_display();
function resize_display(){
    const width = parseInt(width_input.value) || 16;
    const height = parseInt(height_input.value) || 16;
    display.resize(width, height);
}


const console_io = new Console_IO({
    read(callback){
        input_callback = callback;
    },
    get text(){
        return console_input.value;
    },
    set text(value: string){
        console_input.value = value;
    }
}, 
(text) => {
    iris_display.write_text(text);
    console_output.write(text)
},
() => {
    console_output.clear();
    input_callback = undefined
}
);

const emulator = new Emulator({
    on_continue: frame,
    warn: (msg) => {
        const line_nr = emulator.get_line_nr();
        if (line_nr >= 0) {
            const end = msg.indexOf("\n");
            if (end >= 0) {
                msg = msg.substring(0, end);
            }
            source_input.add_error(line_nr, msg);
        }
        output_element.innerText += `${msg}\n`
    },
    error: (msg) => {
        const line_nr = emulator.get_line_nr();
        if (line_nr >= 0) {
            const end = msg.indexOf("\n");
            if (end >= 0) {
                msg = msg.substring(0, end);
            }
            source_input.add_error(line_nr, msg);
        }
        throw new Error(msg);
    }
});
emulator.add_io_device(new Sound())
emulator.add_io_device(console_io);
emulator.add_io_device(display);
const iris_display = new Iris_Display(display);
emulator.add_io_device(iris_display);
emulator.add_io_device(new Clock());
const gamepad = new Pad();
gamepad.add_pad(new KeyboardPad())
emulator.add_io_device(gamepad);
emulator.add_io_device(new RNG());
emulator.add_io_device(new Keyboard());
emulator.add_io_device(new Mouse(canvas));

source_input.oninput = oninput;
auto_run_input.onchange = oninput;

let save_timeout: undefined | NodeJS.Timeout;
let save_timeout_time = 5000;


function oninput(){
    if (started){
        if (save_timeout) {
            clearTimeout(save_timeout);
            save_timeout = undefined;
        }
        save_timeout = setTimeout(save, save_timeout_time);
    }
    if (auto_run_input.checked){
        compile_and_run();
    }
}

document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.key == "s") {
        save();
        e.preventDefault();
    }
})

const history_size = 8;// Math.max(1, 0| (Number(localStorage.getItem("history-size")) || 8));
function save() {
    if (source_input.saved) {
        return;
    }

    if (save_timeout) {
        clearTimeout(save_timeout);
        save_timeout = undefined;
    }
    localStorage.setItem("history-size", ""+history_size);
    const offset = (Math.max(0, 0| (Number(localStorage.getItem("history-offset")) || 0)) + 1)  % history_size;
    localStorage.setItem("history-offset", ""+offset);
    localStorage.setItem(`history-${offset}`, source_input.value);
    source_input.mark_saved();
}

source_input.forward_button.addEventListener("click", e => {
    if (!source_input.saved) {
        save()
    }

    const offset = (Math.max(0, 0| (Number(localStorage.getItem("history-offset")) || 0)) + 1)  % history_size;
    const value = localStorage.getItem(`history-${offset}`);
    if (value == null) {
        return;
    }
    localStorage.setItem("history-offset", ""+offset);
    source_input.set_value_saved(value);
});

source_input.back_button.addEventListener("click", e => {
    if (!source_input.saved) {
        save()
    }
    const offset = (Math.max(0, 0| (Number(localStorage.getItem("history-offset")) || 0)) + history_size - 1)  % history_size;
    const value = localStorage.getItem(`history-${offset}`);
    if (value == null) {
        return;
    }
    localStorage.setItem("history-offset", ""+offset);
    source_input.set_value_saved(value);
});

const compile_and_run_button = document.getElementById("compile-and-run-button") as HTMLButtonElement;
const pause_button = document.getElementById("pause-button") as HTMLButtonElement;
const compile_and_reset_button = document.getElementById("compile-and-reset-button") as HTMLButtonElement;
const step_button = document.getElementById("step-button") as HTMLButtonElement;

compile_and_run_button.addEventListener("click", compile_and_run);
compile_and_reset_button.addEventListener("click", compile_and_reset);
pause_button.addEventListener("click", pause);
step_button.addEventListener("click", step);

function step(){
    process_step_result(emulator.step(), 1);
    clock_speed_output.value = `stepping, executed ${format_int(clock_count)} instructions`;
    console_output.flush();
}

function pause(){
    if (running){
        if (animation_frame){
            cancelAnimationFrame(animation_frame);
        }
        animation_frame = undefined;
        pause_button.textContent = "Start";
        running = false;
        step_button.disabled = running || input;
    } else {
        animation_frame = requestAnimationFrame(frame);
        pause_button.textContent = "Pause";
        running = true;
        step_button.disabled = running;
    }

}

function compile_and_run(){
    if (!compile_and_reset()) {
        return;
    }
    pause_button.textContent = "Pause";
    pause_button.disabled = false;
    if (!running){
        running = true;
        step_button.disabled = running;
        frame();
    }
}
function compile_and_reset(): boolean {
    clock_count = 0;
    output_element.innerText = "";
try {
    const source = source_input.value;
    const parsed = parse(source, {
        constants: Object.fromEntries([
            ...enum_strings(Gamepad_Key).map(key => [`@${key}`, `${1 << (Gamepad_Key[key as any] as any)}`]),
            ...enum_strings(Gamepad_Axis).map(key => [`@${key}`, `${Gamepad_Axis[key as any]}`])
        ]),
    });

    source_input.set_errors([...parsed.errors, ...parsed.warnings]);

    if (parsed.errors.length > 0){
        output_element.innerText = parsed.errors.map(v => expand_warning(v, parsed.lines)+"\n").join("");
        output_element.innerText += parsed.warnings.map(v => expand_warning(v, parsed.lines)+"\n").join("");
        return false;
    }
    output_element.innerText += parsed.warnings.map(v => expand_warning(v, parsed.lines)+"\n").join("");
    const [program, debug_info] = compile(parsed);
    emulator.load_program(program, debug_info);
    if (cout_check.checked) {
        try {
            cout.innerText = urcl2c(program, debug_info);
        } catch (e) {
            cout.innerText = "" + e;
        }
    } else {
        cout.innerHTML = "";
    }

    if (storage_uploaded){
        const bytes = storage_uploaded.slice();
        emulator.add_io_device(storage_device = new Storage(emulator._bits, storage_little.checked, (Number(storage_size.value) || 0) * emulator._bits / 8));
        storage_device.set_bytes(bytes);
        storage_msg.innerText = `loaded storage device with ${storage_device.word_count} words, ${storage_loads++ % 2 === 0 ? "flip" : "flop"}`;
    }

    if (animation_frame){
        cancelAnimationFrame(animation_frame);
    }
    animation_frame = undefined;
    pause_button.textContent = "Start";
    pause_button.disabled = false;
    step_button.disabled = false;
    running = false;
    update_views();
    return true;
} catch (e){
    output_element.innerText += (e as Error).message;
    throw e;
}
}

function frame(){
    if (running){
        try {
            if (jit_radio_js.checked) {  
                emulator.jit_init();
            } else  if (jit_radio_wasm.checked) {
                if (count_radio_jumps.checked) {
                    emulator.jit_init_wasm(Run_Type.Count_Jumps);
                } else if (count_radio_none.checked) {
                    emulator.jit_init_wasm(Run_Type.Uninterrupted);
                } else {
                    emulator.jit_init_wasm(Run_Type.Count_Instrutions);
                }
            } else {
                emulator.jit_delete();
            }

        if (clock_speed > 0){
            const start_time = performance.now();
            const dt = start_time - last_step;
            const its = Math.min(max_its, 0| dt * clock_speed / 1000);
            const [res, steps] = emulator.burst(its, 16);
            process_step_result(res, steps);
            if (its === max_its || (res === Step_Result.Continue && steps !== its)){
                last_step = start_time;
                clock_speed_output.value = `${format_int(clock_speed)}Hz slowdown to ${format_int(steps*1000/16)}Hz, executed ${format_int(clock_count)} instructions`;
            } else {
                last_step += its * 1000 / clock_speed;
                clock_speed_output.value = `${format_int(clock_speed)}Hz, executed ${format_int(clock_count)} instructions`;
            }
        } else {
            const start_time = performance.now();
            const [res, steps] = emulator.run(16);
            const end_time = performance.now();
            const dt = Math.max(0.1, end_time - start_time);
            process_step_result(res, steps);
            clock_speed_output.value = `${format_int(steps*1000/(dt))}Hz, executed ${format_int(clock_count)} instructions`;
        }
        } catch (e){
            output_element.innerText += (e as Error).message + "\nProgram Halted";
            update_views();
            throw e;
        }
    } else {
        step_button.disabled = false;
        pause_button.disabled = false;
    }
}
function process_step_result(result: Step_Result, steps: number){
    clock_count += steps;
    animation_frame = undefined;
    input = false;
    debug_output_element.innerText = "";
    switch (result){
        case Step_Result.Continue: {
            if (running){
                animation_frame = requestAnimationFrame(frame);
                running = true;
                step_button.disabled = running;
                pause_button.disabled = false;
            }
        } break;
        case Step_Result.Input: {
            step_button.disabled = true;
            pause_button.disabled = false;
            input = true;
        } break;
        case Step_Result.Halt: {
            output_element.innerText += "Program halted";
            step_button.disabled = true;
            pause_button.disabled = true;
            pause_button.textContent = "Start";
            running = false
        } break;
        case Step_Result.Debug: {
            if (running){
                pause();
            }
            const msg = emulator.get_debug_message();
            if (msg !== undefined){
                debug_output_element.innerText = msg;
            } else {
                throw new Error("Debug not handled");
            }
        } break;
        default: {
            console.warn("unkown step result");
        }
    }
    update_views();
}
function update_views(){
    if (memory_update_input.checked){
        memory_view.memory = emulator.memory;
        memory_view.update();
    }
    register_view.innerText = 
        registers_to_string(emulator)
    const lines = emulator.debug_info.pc_line_nrs
    const line = lines[Math.min(emulator.pc, lines.length-1)];
    source_input.set_pc_line(line);
    source_input.set_line_profile(lines, emulator.pc_counters);
    console_output.flush();
    display.flush();

    //---- IRIS stuff
    register_save_stack.value = emulator.reg_save_stack.map((reg, i) => registers_to_string_(reg, emulator._bits, i === 0)).join("\n");
    data_stack.value = emulator.data_stack.subarray(0, emulator.dsp).join("\n");
    call_stack.value = "";
    for (let i = 0; i < emulator.csp; i++) {
        const v = emulator.call_stack[i];
        const hex = `0x${v.toString(16).padStart(4, "0")}`;
        const line_num = emulator.debug_info.pc_line_nrs[v];
        const line = line_num ? `${hex} ${line_num} | ${emulator.debug_info.lines[line_num-1].trim()}` : v;
        call_stack.value += line + "\n";
    }
}
change_color_mode();

let storage_promise: undefined | Promise<unknown>;

started = true;
if (srcurl){
    fetch(srcurl).then(res => res.text()).then(async (text) => {
        await storage_promise;
        if (source_input.value){
            return;
        }
        save();
        source_input.value = text;
        if (auto_run_input.checked) {
            compile_and_run();
        }
    });
}
else
autofill:
{
    const offset = Number(localStorage.getItem("history-offset"));
    if (!Number.isInteger(offset)){
        break autofill;
    }
    source_input.set_value_saved(localStorage.getItem(`history-${offset}`) ?? "");
}

if (storage_url) {
    storage_promise = fetch(storage_url).then(res => res.arrayBuffer()).then(buffer => {
        if (storage_uploaded != null) {
            return;
        }
        load_array_buffer(buffer);
    }) 
}
