import { l } from "../../../l";
import { IO_Port } from "../../instructions";
import { Device } from "../device";
import { Display } from "../display";
import { Gl_Display } from "../gl-display";

const tw = 4, th = 8, tile_count = 255;

const canvas = (document.getElementById("font-canvas") ?? document.createElement("canvas")) as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

const font_msg = (document.getElementById("font-msg") ?? document.createElement("font")) as HTMLOutputElement;


const iris_font = "0123456789ABCDEFGHIJKLMNOPQRSTUV"
                + "WXYZabcdefghijklmnopqrstuvwxyz+-"
                + "=/*!?%.,()[]{}<>  :;_| ^~\\°&  '$"
                + "                                "
                + "                                "
                + "                                "
                + "                                "
                + "                                \n"
                ;
export const font_mapping: Map<number, number> = font_map(iris_font);

function font_map(font: string) {
    // console.log("space", " ".codePointAt(0));
    const map = new Map<number, number>();
    for (let i = 0; i < font.length; i++) {
        map.set(font.charCodeAt(i) ?? -1, i);
    }
    map.set(160, 255);
    // console.log(map, map.get(" ".codePointAt(0) ?? 0));
    return map;
}

export class Iris_Display implements Device {
    bits = 16;
    colors = new Uint32Array(tw*th * tile_count);
    masks = new Uint32Array(tw*th * tile_count);
    x1 = 0; y1 = 0;
    x2 = 0; y2 = 0;


    constructor(public display: Gl_Display) {
        this.colors.set([
            1, 1, 1, 1,
            1, 0 ,0, 1,
            1, 0, 0, 1,
            1, 0, 0, 1,
            1, 0, 0, 1,
            1, 0, 0, 1,
            1, 0, 0, 1,
            1, 1, 1, 1,
        ]);
        this.masks.set([
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
            1, 1, 1, 1,
        ])

        fetch("src/emulator/devices/iris/iris-font.png").then(res => res.blob()).then(blob => {
            this.load_font(blob);
        })
    }
    async load_font(font_img: ImageBitmapSource) {
        let font = await createImageBitmap(font_img);

        canvas.width = font.width;
        canvas.height = font.height;
        
        ctx.drawImage(font, 0, 0);
        const img = ctx.getImageData(0, 0, font.width, font.height);
        for (let y = 0, dest_i = 0; y < img.height; y += th) {
            for (let x = 0; x < img.width; x += tw) {
                for (let ty = 0; ty < th; ty += 1) {
                    for (let tx = 0; tx < tw; tx += 1, dest_i += 1) {
                        const src_i = 4 * ((x + tx) + (y + ty) * img.width);
                        this.colors[dest_i] = img.data[src_i] + img.data[src_i + 1] + img.data[src_i + 2] < 128*3 ? 0xffffff : 0;
                        this.masks[dest_i] = img.data[src_i + 3] >= 128 ? 0xffffff : 0;
                    }
                }

                ctx.fillStyle = ((x / 4) + (y / 8) & 1) ? "wheat" : "BurlyWood";
                ctx.fillRect(x, y, tw, th);
            }
        }
        ctx.drawImage(font, 0, 0);
    }
    sign_extend(x: number) {
        if (this.bits == 32) {
            return 0|x;
        } else {
            return (x << this.bits) >> this.bits;
        }
    }
    tile_out(index: number) {
        const src_offset = index * tw * th;
        const sx = this.sign_extend(this.display.x);
        const sy = this.sign_extend(this.display.y);

        for (let y = 0 ; y < th; y++) {
            const yy = sy + y;
            for (let x = 0; x < tw; x++) {
                const xx = sx + x;
                if (this.display.includes(xx, yy) && this.masks[src_offset + x + y*tw]) {
                    this.display.buffer[xx + yy * this.display.width] = this.colors[src_offset + x + y*tw];
                }
            }
        }
            // 
            // const sx = Math.max(0, rx), ex = Math.min(rx + tw, this.display.width), dx = ex - rx;
            // const sy = Math.max(0, ry), ey = Math.min(ry + th, this.display.height), dy = ey - ry;
            // for (let y = sy - ry; y < dy; ++y) {
            //     for (let x = sx - rx; x < dx; ++x) {
            //         const src_i = src_offset + x + y*tw;
            //         const dest_i = dest_offset + x + y * this.display.width;
            //         if (this.masks[src_i]) {
            //             this.display.buffer[dest_i] = this.colors[src_i];
            //         }
            //     }
            // }
        this.display.x += tw;
        this.display.dirty_display();
    }
    // TODO: make this hardware accurate
    line_out(color: number) {
        let dx = this.x2 - this.x1;
        let dy = this.y2 - this.y1;

        const max = Math.max(Math.abs(dx), Math.abs(dy));
        dx /= max;
        dy /= max;

        let x = this.x1 + 0.5;
        let y = this.y1 + 0.5;
        for (let i = 0; i < max; i++) {
            if (this.display.includes(0|x, 0|y)) {
                this.display.buffer[(0|x) + this.display.width*(0|y)] = color;
            }
            x += dx, y += dy
        }
        if (this.display.includes(0|x, 0|y)) {
            this.display.buffer[(0|x) + this.display.width*(0|y)] = color;
        }
        this.display.dirty_display();
    }

    outputs = {
        [IO_Port.TILE]: this.tile_out,
        [IO_Port.X1]: (x: number) => {this.x1 = x;},
        [IO_Port.Y1]: (y: number) => {this.y1 = y;},
        [IO_Port.X2]: (x: number) => {this.x2 = x;},
        [IO_Port.Y2]: (y: number) => {this.y2 = y;},
        [IO_Port.LINE]: this.line_out,
        [IO_Port.TEXT]: (i: number) => {
            const x = font_mapping.get(i) ?? 500;
            if (x == 256) {
                this.display.x = 0;
                this.display.y += th;
            } else {
                this.tile_out(x);
            }
        },
        [IO_Port.NUMB]: (x: number) => {
            for (const char of ""+x) {
                this.tile_out(char.charCodeAt(0) - '0'.charCodeAt(0));
            }
        }
    };

    inputs = {

    };
}