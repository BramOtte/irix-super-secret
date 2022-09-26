import { l } from "../../../l";
import { IO_Port } from "../../instructions";
import { Device } from "../device";
import { Display } from "../display";
import { Gl_Display } from "../gl-display";

const tw = 4, th = 8, tile_count = 255;

const canvas = (document.getElementById("font-canvas") ?? document.createElement("canvas")) as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

const font_msg = (document.getElementById("font-msg") ?? document.createElement("font")) as HTMLOutputElement;

export class Iris_Display implements Device {
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
    tile_out(index: number) {
        const src_offset = index * tw * th;
            const dest_offset = this.display.x + this.display.y * this.display.width;
            const sx = this.display.x, ex = Math.min(sx + tw, this.display.width ), dx = ex - sx;
            const sy = this.display.y, ey = Math.min(sy + th, this.display.height), dy = ey - sy;
            for (let y = 0; y < dy; ++y) {
                for (let x = 0; x < dx; ++x) {
                    const src_i = src_offset + x + y*tw;
                    const dest_i = dest_offset + x + y * this.display.width;
                    if (this.masks[src_i]) {
                        this.display.buffer[dest_i] = this.colors[src_i];
                    }
                }
            }
            this.display.x += tw;
            this.display.dirty_display();
    }
    line_out(color: number) {
        let dx = this.x2 - this.x1;
            let dy = this.y2 - this.y1;

            const max = Math.max(Math.abs(dx), Math.abs(dy));
            dx /= max;
            dy /= max;

            let x = this.x1 + 0.5;
            let y = this.y1 + 0.5;
            for (; ((0|x) != this.x2 || (0|y) != this.y2) && this.display.includes(0|x, 0|y); x += dx, y += dy) {
                this.display.buffer[(0|x) + this.display.width*(0|y)] = color;
            }
            this.display.buffer[(0|x) + this.display.width*(0|y)] = color;

            this.display.dirty_display();
    }

    outputs = {
        [IO_Port.TILE]: this.tile_out,
        [IO_Port.X1]: (x: number) => {this.x1 = x;},
        [IO_Port.Y1]: (y: number) => {this.y1 = y;},
        [IO_Port.X2]: (x: number) => {this.x2 = x;},
        [IO_Port.Y2]: (y: number) => {this.y2 = y;},
        [IO_Port.LINE]: this.line_out,
        [IO_Port.NUMB]: (x: number) => {
            for (const char of ""+x) {
                this.tile_out(char.charCodeAt(0) - '0'.charCodeAt(0));
            }
        }
    };

    inputs = {

    };
}