use crate::CoverageView;

const TEXTURE_RADIUS: f32 = 12.0;
const GRAIN_SEED: u32 = 0x2545_F491;

#[inline]
fn to16(value: f32) -> u16 {
    (value.clamp(0.0, 1.0) * 65_535.0 + 0.5) as u16
}

#[inline]
fn coverage(view: CoverageView<'_>, index: usize) -> f32 {
    view.coverage.map_or(1.0, |mask| mask[index] as f32 / 255.0)
}

fn map_rgb(
    pixels: &mut [u16],
    coverage_view: CoverageView<'_>,
    transform: impl Fn(f32, f32, f32) -> (f32, f32, f32),
) {
    for index in 0..(coverage_view.width * coverage_view.height) as usize {
        let amount = coverage(coverage_view, index);
        if amount <= 0.0 {
            continue;
        }
        let offset = index * 4;
        let original = [
            pixels[offset] as f32 / 65_535.0,
            pixels[offset + 1] as f32 / 65_535.0,
            pixels[offset + 2] as f32 / 65_535.0,
        ];
        let result = transform(original[0], original[1], original[2]);
        pixels[offset] = to16(original[0] + (result.0 - original[0]) * amount);
        pixels[offset + 1] = to16(original[1] + (result.1 - original[1]) * amount);
        pixels[offset + 2] = to16(original[2] + (result.2 - original[2]) * amount);
    }
}

#[allow(clippy::too_many_arguments)]
pub fn camera_raw(
    pixels: &mut [u16],
    view: CoverageView<'_>,
    temp: f32,
    exposure: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    clarity: f32,
    dehaze: f32,
    vibrance: f32,
    saturation: f32,
    grain: f32,
) {
    let exposure = 2f32.powf(exposure);
    let contrast = 1.0 + contrast.clamp(-1.0, 1.0);
    let clarity = clarity.clamp(-1.0, 1.0);
    let dehaze = dehaze.clamp(-1.0, 1.0);
    map_rgb(pixels, view, |or, og, ob| {
        let mut r = (or * (1.0 + temp * 0.3) * exposure - 0.5) * contrast + 0.5;
        let mut g = (og * exposure - 0.5) * contrast + 0.5;
        let mut b = (ob * (1.0 - temp * 0.3) * exposure - 0.5) * contrast + 0.5;
        let lum = 0.299 * r + 0.587 * g + 0.114 * b;
        let tone = highlights * (lum * 2.0 - 1.0).clamp(0.0, 1.0) * 0.5
            + shadows * (1.0 - lum * 2.0).clamp(0.0, 1.0) * 0.5;
        r += tone;
        g += tone;
        b += tone;
        let lum = 0.299 * r + 0.587 * g + 0.114 * b;
        let midtone = (1.0 - (lum - 0.5).abs() * 2.0).clamp(0.0, 1.0);
        let target = ((lum - 0.5) * (1.0 + clarity * 0.75 * midtone) + 0.5).clamp(0.0, 1.0);
        let scale = if lum > 1e-4 { target / lum } else { 1.0 };
        r *= scale;
        g *= scale;
        b *= scale;
        if dehaze.abs() > 1e-5 {
            let factor = 1.0 + dehaze * 0.45;
            r = (r - 0.5) * factor + 0.5 - dehaze * 0.03;
            g = (g - 0.5) * factor + 0.5 - dehaze * 0.03;
            b = (b - 0.5) * factor + 0.5 - dehaze * 0.03;
        }
        let lum = 0.299 * r + 0.587 * g + 0.114 * b;
        let maximum = r.max(g).max(b);
        let minimum = r.min(g).min(b);
        let current_saturation = if maximum > 1e-4 {
            (maximum - minimum) / maximum
        } else {
            0.0
        };
        let factor =
            (1.0 + saturation + vibrance * (1.0 - current_saturation) + dehaze * 0.15).max(0.0);
        r = (lum + (r - lum) * factor).clamp(0.0, 1.0);
        g = (lum + (g - lum) * factor).clamp(0.0, 1.0);
        b = (lum + (b - lum) * factor).clamp(0.0, 1.0);
        (r, g, b)
    });
    if grain > 0.0 {
        for index in 0..(view.width * view.height) as usize {
            let amount = coverage(view, index);
            if amount <= 0.0 {
                continue;
            }
            let mut hash = (index as u32)
                .wrapping_mul(747_796_405)
                .wrapping_add(2_891_336_453);
            hash ^= hash >> 16;
            hash = hash.wrapping_mul(2_246_822_519);
            hash ^= hash >> 13;
            let noise =
                (hash as f32 / u32::MAX as f32 - 0.5) * grain.clamp(0.0, 1.0) * 0.18 * amount;
            for channel in 0..3 {
                let offset = index * 4 + channel;
                pixels[offset] = to16(pixels[offset] as f32 / 65_535.0 + noise);
            }
        }
    }
}

pub fn white_balance_and_endpoints(
    pixels: &mut [u16],
    view: CoverageView<'_>,
    tint: f32,
    whites: f32,
    blacks: f32,
) {
    if tint != 0.0 {
        let green = 1.0 + tint * 0.3;
        let magenta = 1.0 - tint * 0.3;
        map_rgb(pixels, view, |r, g, b| {
            (r * magenta, g * green, b * magenta)
        });
    }
    if whites != 0.0 || blacks != 0.0 {
        let white = 1.0 - whites * 0.5;
        let black = -blacks * 0.5;
        let width = (white - black).max(1e-4);
        map_rgb(pixels, view, |r, g, b| {
            (
                ((r - black) / width).clamp(0.0, 1.0),
                ((g - black) / width).clamp(0.0, 1.0),
                ((b - black) / width).clamp(0.0, 1.0),
            )
        });
    }
}

pub fn blur_f32(buffer: &mut [f32], width: u32, height: u32, radius: f32) {
    let radius = radius.round() as i32;
    if radius <= 0 {
        return;
    }
    let (width, height) = (width as i32, height as i32);
    for _ in 0..3 {
        let source = buffer.to_vec();
        for y in 0..height {
            for x in 0..width {
                let mut sum = 0.0;
                for dx in -radius..=radius {
                    sum += source[(y * width + (x + dx).clamp(0, width - 1)) as usize];
                }
                buffer[(y * width + x) as usize] = sum / (radius * 2 + 1) as f32;
            }
        }
        let source = buffer.to_vec();
        for y in 0..height {
            for x in 0..width {
                let mut sum = 0.0;
                for dy in -radius..=radius {
                    sum += source[((y + dy).clamp(0, height - 1) * width + x) as usize];
                }
                buffer[(y * width + x) as usize] = sum / (radius * 2 + 1) as f32;
            }
        }
    }
}

pub fn texture(
    pixels: &mut [u16],
    width: u32,
    height: u32,
    view: CoverageView<'_>,
    amount: f32,
    radius: f32,
) {
    if amount == 0.0 || radius <= 0.0 {
        return;
    }
    let mut luminance = Vec::with_capacity((width * height) as usize);
    for pixel in pixels.chunks_exact(4) {
        luminance.push(0.299 * pixel[0] as f32 + 0.587 * pixel[1] as f32 + 0.114 * pixel[2] as f32);
    }
    let mut base = luminance.clone();
    blur_f32(&mut base, width, height, radius);
    for index in 0..luminance.len() {
        let detail = (luminance[index] - base[index]) * amount * coverage(view, index);
        for channel in 0..3 {
            let offset = index * 4 + channel;
            pixels[offset] = (pixels[offset] as f32 + detail).clamp(0.0, 65_535.0) as u16;
        }
    }
}

fn curves(pixels: &mut [u16], view: CoverageView<'_>, params: &[f32]) {
    for index in 0..(view.width * view.height) as usize {
        let amount = coverage(view, index);
        if amount <= 0.0 {
            continue;
        }
        let offset = index * 4;
        for (channel, base) in [(0, 282), (1, 538), (2, 794)] {
            let original = pixels[offset + channel];
            let master = params[26 + (original >> 8) as usize]
                .round()
                .clamp(0.0, 255.0) as usize;
            let result = params[base + master].round().clamp(0.0, 255.0) / 255.0;
            pixels[offset + channel] =
                to16(original as f32 / 65_535.0 + (result - original as f32 / 65_535.0) * amount);
        }
    }
}

#[inline]
fn sample_index(x: i32, y: i32, width: i32, height: i32) -> usize {
    (y.clamp(0, height - 1) * width + x.clamp(0, width - 1)) as usize * 4
}

fn reduce_color_noise(pixels: &mut [u16], width: u32, height: u32, amount: f32) {
    let radius = (1.0 + amount.clamp(0.0, 1.0) * 3.0).round() as i32;
    let (wi, hi) = (width as i32, height as i32);
    let count = (width * height) as usize;
    let source = pixels.to_vec();
    let mut y = vec![0.0; count];
    let mut cb = vec![0.0; count];
    let mut cr = vec![0.0; count];
    for index in 0..count {
        let r = source[index * 4] as f32;
        let g = source[index * 4 + 1] as f32;
        let b = source[index * 4 + 2] as f32;
        y[index] = 0.299 * r + 0.587 * g + 0.114 * b;
        cb[index] = b - y[index];
        cr[index] = r - y[index];
    }
    let blur = |channel: &[f32]| {
        let mut output = vec![0.0; count];
        for yy in 0..hi {
            for xx in 0..wi {
                let mut sum = 0.0;
                for dy in -radius..=radius {
                    for dx in -radius..=radius {
                        let sx = (xx + dx).clamp(0, wi - 1);
                        let sy = (yy + dy).clamp(0, hi - 1);
                        sum += channel[(sy * wi + sx) as usize];
                    }
                }
                output[(yy * wi + xx) as usize] =
                    sum / ((radius * 2 + 1) * (radius * 2 + 1)) as f32;
            }
        }
        output
    };
    let cb = blur(&cb);
    let cr = blur(&cr);
    for index in 0..count {
        let r = (y[index] + cr[index]).clamp(0.0, 65_535.0);
        let b = (y[index] + cb[index]).clamp(0.0, 65_535.0);
        let g = ((y[index] - 0.299 * r - 0.114 * b) / 0.587).clamp(0.0, 65_535.0);
        pixels[index * 4] = r.round() as u16;
        pixels[index * 4 + 1] = g.round() as u16;
        pixels[index * 4 + 2] = b.round() as u16;
    }
}

pub fn reduce_noise(
    pixels: &mut [u16],
    width: u32,
    height: u32,
    view: CoverageView<'_>,
    strength: f32,
    color: f32,
    details: f32,
    sharpen_details: f32,
) {
    let (wi, hi) = (width as i32, height as i32);
    let source = pixels.to_vec();
    let mut filtered = source.clone();
    let sigma_color = 0.04 + strength.clamp(0.0, 1.0) * 0.20;
    let inverse_spatial = 1.0 / 8.0;
    let inverse_color = 1.0 / (2.0 * sigma_color * sigma_color);
    for y in 0..hi {
        for x in 0..wi {
            let center = (y * wi + x) as usize * 4;
            let rgb = [
                source[center] as f32 / 65_535.0,
                source[center + 1] as f32 / 65_535.0,
                source[center + 2] as f32 / 65_535.0,
            ];
            let mut sum = [0.0; 3];
            let mut weight_sum = 0.0;
            for dy in -2..=2 {
                for dx in -2..=2 {
                    let sample = sample_index(x + dx, y + dy, wi, hi);
                    let sample_rgb = [
                        source[sample] as f32 / 65_535.0,
                        source[sample + 1] as f32 / 65_535.0,
                        source[sample + 2] as f32 / 65_535.0,
                    ];
                    let color_distance = (sample_rgb[0] - rgb[0]).powi(2)
                        + (sample_rgb[1] - rgb[1]).powi(2)
                        + (sample_rgb[2] - rgb[2]).powi(2);
                    let spatial_distance = (dx * dx + dy * dy) as f32;
                    let weight = (-spatial_distance * inverse_spatial
                        - color_distance * inverse_color)
                        .exp();
                    for channel in 0..3 {
                        sum[channel] += sample_rgb[channel] * weight;
                    }
                    weight_sum += weight;
                }
            }
            for channel in 0..3 {
                let denoised = sum[channel] / weight_sum;
                let result = denoised + details.clamp(0.0, 1.0) * (rgb[channel] - denoised);
                filtered[center + channel] =
                    (result * 65_535.0).round().clamp(0.0, 65_535.0) as u16;
            }
        }
    }
    if color > 0.0 {
        reduce_color_noise(&mut filtered, width, height, color);
    }
    if sharpen_details > 0.0 {
        let source = filtered.clone();
        let blurred = gaussian_blur(&source, width, height, 1.5);
        for index in 0..(width * height) as usize {
            for channel in 0..3 {
                let offset = index * 4 + channel;
                let value = source[offset] as f32;
                filtered[offset] = (value
                    + (value - blurred[offset] as f32) * sharpen_details.clamp(0.0, 1.0) * 2.0)
                    .clamp(0.0, 65_535.0) as u16;
            }
        }
    }
    blend_back(pixels, &filtered, view);
}

fn gaussian_blur(pixels: &[u16], width: u32, height: u32, radius: f32) -> Vec<u16> {
    if radius < 0.1 {
        return pixels.to_vec();
    }
    let (wi, hi) = (width as i32, height as i32);
    let kernel_radius = radius.ceil() as i32;
    let sigma = (radius / 2.0).max(0.5);
    let mut kernel = Vec::new();
    let mut kernel_sum = 0.0;
    for offset in -kernel_radius..=kernel_radius {
        let value = (-(offset * offset) as f32 / (2.0 * sigma * sigma)).exp();
        kernel.push(value);
        kernel_sum += value;
    }
    for value in &mut kernel {
        *value /= kernel_sum;
    }
    let count = (width * height) as usize;
    let mut premultiplied = vec![0.0; count * 4];
    for index in 0..count {
        let alpha = pixels[index * 4 + 3] as f32 / 65_535.0;
        for channel in 0..3 {
            premultiplied[index * 4 + channel] =
                pixels[index * 4 + channel] as f32 / 65_535.0 * alpha;
        }
        premultiplied[index * 4 + 3] = alpha;
    }
    let mut temporary = vec![0.0; count * 4];
    for y in 0..hi {
        for x in 0..wi {
            let destination = (y * wi + x) as usize * 4;
            for (kernel_index, weight) in kernel.iter().enumerate() {
                let sx = (x + kernel_index as i32 - kernel_radius).clamp(0, wi - 1);
                let source = (y * wi + sx) as usize * 4;
                for channel in 0..4 {
                    temporary[destination + channel] += premultiplied[source + channel] * weight;
                }
            }
        }
    }
    let mut blurred = vec![0.0; count * 4];
    for y in 0..hi {
        for x in 0..wi {
            let destination = (y * wi + x) as usize * 4;
            for (kernel_index, weight) in kernel.iter().enumerate() {
                let sy = (y + kernel_index as i32 - kernel_radius).clamp(0, hi - 1);
                let source = (sy * wi + x) as usize * 4;
                for channel in 0..4 {
                    blurred[destination + channel] += temporary[source + channel] * weight;
                }
            }
        }
    }
    let mut output = vec![0; count * 4];
    for index in 0..count {
        let alpha = blurred[index * 4 + 3];
        if alpha > 1e-4 {
            for channel in 0..3 {
                output[index * 4 + channel] = to16(blurred[index * 4 + channel] / alpha);
            }
        }
        output[index * 4 + 3] = to16(alpha);
    }
    output
}

pub fn gaussian_blur_in_place(
    pixels: &mut [u16],
    width: u32,
    height: u32,
    view: CoverageView<'_>,
    radius: f32,
) {
    let filtered = gaussian_blur(pixels, width, height, radius);
    blend_back(pixels, &filtered, view);
}

pub fn unsharp_mask(
    pixels: &mut [u16],
    width: u32,
    height: u32,
    view: CoverageView<'_>,
    amount: f32,
    radius: f32,
    threshold: f32,
) {
    let source = pixels.to_vec();
    let blurred = gaussian_blur(&source, width, height, radius);
    let mut filtered = source.clone();
    for index in 0..(width * height) as usize {
        for channel in 0..3 {
            let offset = index * 4 + channel;
            let value = source[offset] as f32 / 65_535.0;
            let low = blurred[offset] as f32 / 65_535.0;
            let difference = value - low;
            if difference.abs() >= threshold {
                filtered[offset] =
                    ((value + amount * difference).clamp(0.0, 1.0) * 65_535.0).round() as u16;
            }
        }
    }
    blend_back(pixels, &filtered, view);
}

pub fn film_grain(
    pixels: &mut [u16],
    view: CoverageView<'_>,
    amount: f32,
    highlight: f32,
    intensity: f32,
    seed: u32,
) {
    let mut state = seed | 1;
    let amplitude = amount * (0.08 + 0.12 * intensity.clamp(0.0, 1.0)) * 65_535.0;
    let threshold = (1.0 - highlight.clamp(0.0, 1.0)) * 65_535.0;
    for index in 0..(view.width * view.height) as usize {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        let amount = coverage(view, index);
        if amount <= 0.0 {
            continue;
        }
        let offset = index * 4;
        let luminance = 0.299 * pixels[offset] as f32
            + 0.587 * pixels[offset + 1] as f32
            + 0.114 * pixels[offset + 2] as f32;
        let protection = if luminance <= threshold {
            1.0
        } else {
            ((65_535.0 - luminance) / (65_535.0 - threshold).max(1.0)).clamp(0.0, 1.0)
        };
        let delta = (state as f32 / u32::MAX as f32 * 2.0 - 1.0) * amplitude * protection * amount;
        for channel in 0..3 {
            pixels[offset + channel] =
                (pixels[offset + channel] as f32 + delta).clamp(0.0, 65_535.0) as u16;
        }
    }
}

fn blend_back(pixels: &mut [u16], filtered: &[u16], view: CoverageView<'_>) {
    for index in 0..(view.width * view.height) as usize {
        let amount = coverage(view, index);
        if amount <= 0.0 {
            continue;
        }
        for channel in 0..4 {
            let offset = index * 4 + channel;
            pixels[offset] = (pixels[offset] as f32
                + (filtered[offset] as f32 - pixels[offset] as f32) * amount)
                as u16;
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn lens_correction(
    pixels: &mut [u16],
    width: u32,
    height: u32,
    view: CoverageView<'_>,
    distortion: f32,
    vignette: f32,
    aberration: f32,
    scale: f32,
    vignette_midpoint: f32,
) {
    let (wi, hi) = (width as i32, height as i32);
    let source = pixels.to_vec();
    let mut filtered = source.clone();
    let (cx, cy) = (wi as f32 / 2.0, hi as f32 / 2.0);
    let maximum_radius = (cx * cx + cy * cy).sqrt().max(1.0);
    let midpoint = vignette_midpoint.clamp(0.0, 0.95);
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let sample = |fx: f32, fy: f32| {
        let x0 = fx.floor() as i32;
        let y0 = fy.floor() as i32;
        let mut output = [0.0; 4];
        if x0 < -1 || y0 < -1 || x0 > wi || y0 > hi {
            return output;
        }
        let (tx, ty) = (fx - x0 as f32, fy - y0 as f32);
        for (oy, wy) in [(0, 1.0 - ty), (1, ty)] {
            for (ox, wx) in [(0, 1.0 - tx), (1, tx)] {
                let source_offset =
                    ((y0 + oy).clamp(0, hi - 1) * wi + (x0 + ox).clamp(0, wi - 1)) as usize * 4;
                for channel in 0..4 {
                    output[channel] += source[source_offset + channel] as f32 * wx * wy;
                }
            }
        }
        output
    };
    for y in 0..hi {
        for x in 0..wi {
            let destination = (y * wi + x) as usize * 4;
            let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
            let radius = (dx * dx + dy * dy).sqrt() / maximum_radius;
            let factor = (1.0 + distortion * radius * radius) / scale;
            let base = sample(cx + dx * factor - 0.5, cy + dy * factor - 0.5);
            let sample_value = if aberration != 0.0 {
                let red = sample(
                    cx + dx * factor * (1.0 + aberration * radius) - 0.5,
                    cy + dy * factor * (1.0 + aberration * radius) - 0.5,
                );
                let blue = sample(
                    cx + dx * factor * (1.0 - aberration * radius) - 0.5,
                    cy + dy * factor * (1.0 - aberration * radius) - 0.5,
                );
                [red[0], base[1], blue[2], base[3]]
            } else {
                base
            };
            let vignette_radius = if midpoint > 0.0 {
                ((radius - midpoint) / (1.0 - midpoint)).max(0.0)
            } else {
                radius
            };
            let gain = (1.0 + vignette * vignette_radius * vignette_radius).clamp(0.0, 4.0);
            for channel in 0..3 {
                filtered[destination + channel] =
                    (sample_value[channel] * gain).round().clamp(0.0, 65_535.0) as u16;
            }
            filtered[destination + 3] = sample_value[3].round() as u16;
        }
    }
    blend_back(pixels, &filtered, view);
}

pub fn defringe(pixels: &mut [u16], width: u32, height: u32, view: CoverageView<'_>, size: i32) {
    let (wi, hi) = (width as i32, height as i32);
    let alpha = |buffer: &[u16], x: i32, y: i32| {
        if x < 0 || y < 0 || x >= wi || y >= hi {
            0
        } else {
            buffer[(y * wi + x) as usize * 4 + 3]
        }
    };
    let fringe = |buffer: &[u16], x: i32, y: i32| {
        alpha(buffer, x, y) > 0
            && (alpha(buffer, x - 1, y) == 0
                || alpha(buffer, x + 1, y) == 0
                || alpha(buffer, x, y - 1) == 0
                || alpha(buffer, x, y + 1) == 0)
    };
    let mut output = pixels.to_vec();
    for _ in 0..size.max(1) {
        let source = output.clone();
        for y in 0..hi {
            for x in 0..wi {
                if !fringe(&source, x, y) {
                    continue;
                }
                let mut sum = [0.0; 3];
                let mut count = 0.0;
                for (dx, dy) in [
                    (-1, -1),
                    (0, -1),
                    (1, -1),
                    (-1, 0),
                    (1, 0),
                    (-1, 1),
                    (0, 1),
                    (1, 1),
                ] {
                    if alpha(&source, x + dx, y + dy) > 0 && !fringe(&source, x + dx, y + dy) {
                        let offset = ((y + dy) * wi + x + dx) as usize * 4;
                        for channel in 0..3 {
                            sum[channel] += source[offset + channel] as f32;
                        }
                        count += 1.0;
                    }
                }
                if count > 0.0 {
                    let offset = (y * wi + x) as usize * 4;
                    for channel in 0..3 {
                        output[offset + channel] = (sum[channel] / count).round() as u16;
                    }
                }
            }
        }
    }
    blend_back(pixels, &output, view);
}

fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let maximum = r.max(g).max(b);
    let minimum = r.min(g).min(b);
    let lightness = (maximum + minimum) * 0.5;
    if (maximum - minimum).abs() < 1e-6 {
        return (0.0, 0.0, lightness);
    }
    let difference = maximum - minimum;
    let saturation = if lightness > 0.5 {
        difference / (2.0 - maximum - minimum)
    } else {
        difference / (maximum + minimum)
    };
    let hue = if maximum == r {
        (g - b) / difference + if g < b { 6.0 } else { 0.0 }
    } else if maximum == g {
        (b - r) / difference + 2.0
    } else {
        (r - g) / difference + 4.0
    };
    (hue * 60.0, saturation, lightness)
}

fn hsl_to_rgb(hue: f32, saturation: f32, lightness: f32) -> (f32, f32, f32) {
    if saturation.abs() < 1e-6 {
        return (lightness, lightness, lightness);
    }
    let q = if lightness < 0.5 {
        lightness * (1.0 + saturation)
    } else {
        lightness + saturation - lightness * saturation
    };
    let p = 2.0 * lightness - q;
    let convert = |mut value: f32| {
        if value < 0.0 {
            value += 1.0;
        }
        if value > 1.0 {
            value -= 1.0;
        }
        if value < 1.0 / 6.0 {
            p + (q - p) * 6.0 * value
        } else if value < 0.5 {
            q
        } else if value < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - value) * 6.0
        } else {
            p
        }
    };
    let hue = hue / 360.0;
    (
        convert(hue + 1.0 / 3.0),
        convert(hue),
        convert(hue - 1.0 / 3.0),
    )
}

fn hsl(pixels: &mut [u16], view: CoverageView<'_>, params: &[f32]) {
    const ANCHORS: [f32; 8] = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 285.0, 330.0];
    map_rgb(pixels, view, |r, g, b| {
        let (mut hue, mut saturation, mut lightness) = rgb_to_hsl(r, g, b);
        let confidence = {
            let value = (saturation / 0.15).clamp(0.0, 1.0);
            value * value * (3.0 - 2.0 * value)
        };
        if confidence <= 0.0 {
            return (r, g, b);
        }
        let (first, second, blend) = if hue >= ANCHORS[7] {
            (7, 0, (hue - ANCHORS[7]) / (360.0 - ANCHORS[7]))
        } else {
            let first = (0..7).find(|index| hue < ANCHORS[index + 1]).unwrap_or(7);
            (
                first,
                first + 1,
                (hue - ANCHORS[first]) / (ANCHORS[first + 1] - ANCHORS[first]),
            )
        };
        let mix = |base: usize| {
            (params[base + first] * (1.0 - blend) + params[base + second] * blend) * confidence
        };
        hue = (hue + mix(1053) * 30.0).rem_euclid(360.0);
        saturation = (saturation * (1.0 + mix(1061))).clamp(0.0, 1.0);
        let luminance = mix(1069);
        lightness = if luminance >= 0.0 {
            lightness + (1.0 - lightness) * luminance
        } else {
            lightness * (1.0 + luminance)
        };
        hsl_to_rgb(hue, saturation, lightness)
    });
}

fn color_grading(pixels: &mut [u16], view: CoverageView<'_>, params: &[f32]) {
    let shift = |region: usize| {
        let (r, g, b) = hsl_to_rgb(params[1077 + region * 2], 1.0, 0.5);
        let saturation = params[1078 + region * 2];
        [
            (r - 0.5) * 2.0 * saturation,
            (g - 0.5) * 2.0 * saturation,
            (b - 0.5) * 2.0 * saturation,
        ]
    };
    let shadows = shift(0);
    let midtones = shift(1);
    let highlights = shift(2);
    map_rgb(pixels, view, |r, g, b| {
        let luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        let shadow_weight = (1.0 - luminance).powi(2);
        let highlight_weight = luminance.powi(2);
        let midtone_weight = (1.0 - (2.0 * luminance - 1.0).abs()).max(0.0);
        let value = [r, g, b];
        let mut output = [0.0; 3];
        for channel in 0..3 {
            output[channel] = (value[channel]
                + 0.25
                    * (shadows[channel] * shadow_weight
                        + midtones[channel] * midtone_weight
                        + highlights[channel] * highlight_weight))
                .clamp(0.0, 1.0);
        }
        (output[0], output[1], output[2])
    });
}

fn sample_bilinear_transparent(
    source: &[u16],
    width: i32,
    height: i32,
    x: f32,
    y: f32,
) -> [u16; 4] {
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    if x0 < -1 || y0 < -1 || x0 > width || y0 > height {
        return [0; 4];
    }
    let (tx, ty) = (x - x0 as f32, y - y0 as f32);
    let mut result = [0.0; 4];
    for (oy, wy) in [(0, 1.0 - ty), (1, ty)] {
        for (ox, wx) in [(0, 1.0 - tx), (1, tx)] {
            let (sx, sy) = (x0 + ox, y0 + oy);
            if sx >= 0 && sy >= 0 && sx < width && sy < height {
                let offset = (sy * width + sx) as usize * 4;
                for channel in 0..4 {
                    result[channel] += source[offset + channel] as f32 * wx * wy;
                }
            }
        }
    }
    result.map(|value| value.round().clamp(0.0, 65_535.0) as u16)
}

fn square_to_quad(points: [[f32; 2]; 4]) -> Option<[f32; 9]> {
    let [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = points;
    let dx1 = x1 - x2;
    let dx2 = x3 - x2;
    let dx3 = x0 - x1 + x2 - x3;
    let dy1 = y1 - y2;
    let dy2 = y3 - y2;
    let dy3 = y0 - y1 + y2 - y3;
    if dx3.abs() < 1e-6 && dy3.abs() < 1e-6 {
        return Some([x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0.0, 0.0, 1.0]);
    }
    let denominator = dx1 * dy2 - dx2 * dy1;
    if denominator.abs() < 1e-9 {
        return None;
    }
    let g = (dx3 * dy2 - dx2 * dy3) / denominator;
    let h = (dx1 * dy3 - dx3 * dy1) / denominator;
    Some([
        x1 - x0 + g * x1,
        x3 - x0 + h * x3,
        x0,
        y1 - y0 + g * y1,
        y3 - y0 + h * y3,
        y0,
        g,
        h,
        1.0,
    ])
}

fn invert_matrix(matrix: [f32; 9]) -> Option<[f32; 9]> {
    let determinant = matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7])
        - matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6])
        + matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6]);
    if determinant.abs() < 1e-10 {
        return None;
    }
    let inverse = 1.0 / determinant;
    Some([
        (matrix[4] * matrix[8] - matrix[5] * matrix[7]) * inverse,
        (matrix[2] * matrix[7] - matrix[1] * matrix[8]) * inverse,
        (matrix[1] * matrix[5] - matrix[2] * matrix[4]) * inverse,
        (matrix[5] * matrix[6] - matrix[3] * matrix[8]) * inverse,
        (matrix[0] * matrix[8] - matrix[2] * matrix[6]) * inverse,
        (matrix[2] * matrix[3] - matrix[0] * matrix[5]) * inverse,
        (matrix[3] * matrix[7] - matrix[4] * matrix[6]) * inverse,
        (matrix[1] * matrix[6] - matrix[0] * matrix[7]) * inverse,
        (matrix[0] * matrix[4] - matrix[1] * matrix[3]) * inverse,
    ])
}

fn blend_pixel(
    source: &[u16],
    output: &mut [u16],
    view: CoverageView<'_>,
    index: usize,
    value: [u16; 4],
) {
    let amount = coverage(view, index);
    let offset = index * 4;
    for channel in 0..4 {
        output[offset + channel] = (source[offset + channel] as f32
            + (value[channel] as f32 - source[offset + channel] as f32) * amount)
            .round() as u16;
    }
}

fn bounded_texture(
    pixels: &mut [u16],
    scratch: &mut [u16],
    width: u32,
    height: u32,
    view: CoverageView<'_>,
    amount: f32,
    radius: f32,
) {
    let radius = radius.round().max(1.0) as i32;
    let (wi, hi) = (width as i32, height as i32);
    let read = |buffer: &[u16], index: usize, lane: usize| {
        f32::from_bits(
            buffer[index * 4 + lane * 2] as u32 | ((buffer[index * 4 + lane * 2 + 1] as u32) << 16),
        )
    };
    let write = |buffer: &mut [u16], index: usize, lane: usize, value: f32| {
        let bits = value.to_bits();
        buffer[index * 4 + lane * 2] = bits as u16;
        buffer[index * 4 + lane * 2 + 1] = (bits >> 16) as u16;
    };
    for index in 0..(width * height) as usize {
        let offset = index * 4;
        write(
            scratch,
            index,
            0,
            0.299 * pixels[offset] as f32
                + 0.587 * pixels[offset + 1] as f32
                + 0.114 * pixels[offset + 2] as f32,
        );
    }
    let mut source_lane = 0;
    for horizontal in [true, false].into_iter().cycle().take(6) {
        let output_lane = 1 - source_lane;
        for y in 0..hi {
            for x in 0..wi {
                let mut sum = 0.0;
                for delta in -radius..=radius {
                    let (sample_x, sample_y) = if horizontal {
                        ((x + delta).clamp(0, wi - 1), y)
                    } else {
                        (x, (y + delta).clamp(0, hi - 1))
                    };
                    sum += read(scratch, (sample_y * wi + sample_x) as usize, source_lane);
                }
                write(
                    scratch,
                    (y * wi + x) as usize,
                    output_lane,
                    sum / (radius * 2 + 1) as f32,
                );
            }
        }
        source_lane = output_lane;
    }
    for index in 0..(width * height) as usize {
        let offset = index * 4;
        let luminance = 0.299 * pixels[offset] as f32
            + 0.587 * pixels[offset + 1] as f32
            + 0.114 * pixels[offset + 2] as f32;
        let detail =
            (luminance - read(scratch, index, source_lane)) * amount * coverage(view, index);
        for channel in 0..3 {
            pixels[offset + channel] =
                (pixels[offset + channel] as f32 + detail).clamp(0.0, 65_535.0) as u16;
        }
    }
}

fn bounded_noise(
    source: &[u16],
    output: &mut [u16],
    width: u32,
    height: u32,
    view: CoverageView<'_>,
    strength: f32,
    color: f32,
    details: f32,
) {
    let (wi, hi) = (width as i32, height as i32);
    let sigma_color = 0.04 + strength.clamp(0.0, 1.0) * 0.20;
    let inverse_color = 1.0 / (2.0 * sigma_color * sigma_color);
    let chroma_radius = (1.0 + color.clamp(0.0, 1.0) * 3.0).round() as i32;
    for y in 0..hi {
        for x in 0..wi {
            let index = (y * wi + x) as usize;
            let offset = index * 4;
            let center = [
                source[offset] as f32 / 65_535.0,
                source[offset + 1] as f32 / 65_535.0,
                source[offset + 2] as f32 / 65_535.0,
            ];
            let mut sum = [0.0; 3];
            let mut weight_sum = 0.0;
            for dy in -2..=2 {
                for dx in -2..=2 {
                    let sample = sample_index(x + dx, y + dy, wi, hi);
                    let rgb = [
                        source[sample] as f32 / 65_535.0,
                        source[sample + 1] as f32 / 65_535.0,
                        source[sample + 2] as f32 / 65_535.0,
                    ];
                    let color_distance = (rgb[0] - center[0]).powi(2)
                        + (rgb[1] - center[1]).powi(2)
                        + (rgb[2] - center[2]).powi(2);
                    let spatial_distance = (dx * dx + dy * dy) as f32;
                    let weight = (-spatial_distance / 8.0 - color_distance * inverse_color).exp();
                    for channel in 0..3 {
                        sum[channel] += rgb[channel] * weight;
                    }
                    weight_sum += weight;
                }
            }
            let mut value = [0; 4];
            for channel in 0..3 {
                let denoised = sum[channel] / weight_sum;
                value[channel] =
                    to16(denoised + details.clamp(0.0, 1.0) * (center[channel] - denoised));
            }
            if color > 0.0 {
                let mut cb = 0.0;
                let mut cr = 0.0;
                let mut count = 0.0;
                for dy in -chroma_radius..=chroma_radius {
                    for dx in -chroma_radius..=chroma_radius {
                        let sample = sample_index(x + dx, y + dy, wi, hi);
                        let r = source[sample] as f32;
                        let g = source[sample + 1] as f32;
                        let b = source[sample + 2] as f32;
                        let luminance = 0.299 * r + 0.587 * g + 0.114 * b;
                        cb += b - luminance;
                        cr += r - luminance;
                        count += 1.0;
                    }
                }
                let luminance =
                    0.299 * value[0] as f32 + 0.587 * value[1] as f32 + 0.114 * value[2] as f32;
                let r = (luminance + cr / count).clamp(0.0, 65_535.0);
                let b = (luminance + cb / count).clamp(0.0, 65_535.0);
                value[0] = r.round() as u16;
                value[1] = ((luminance - 0.299 * r - 0.114 * b) / 0.587)
                    .clamp(0.0, 65_535.0)
                    .round() as u16;
                value[2] = b.round() as u16;
            }
            value[3] = source[offset + 3];
            blend_pixel(source, output, view, index, value);
        }
    }
}

fn gaussian_kernel(radius: f32) -> Vec<f32> {
    let kernel_radius = radius.ceil() as i32;
    let sigma = (radius / 2.0).max(0.5);
    let mut kernel: Vec<f32> = (-kernel_radius..=kernel_radius)
        .map(|offset| (-(offset * offset) as f32 / (2.0 * sigma * sigma)).exp())
        .collect();
    let sum: f32 = kernel.iter().sum();
    for value in &mut kernel {
        *value /= sum;
    }
    kernel
}

/// Camera Raw ▸ Optics ▸ Defringe hue windows for the native export. Its params
/// carry no v5 tail, so the develop windows are the recipe defaults (#444).
const DEFRINGE_PURPLE_HUE: [f32; 2] = [30.0, 70.0];
const DEFRINGE_GREEN_HUE: [f32; 2] = [40.0, 60.0];
/// The 0..100 hue sliders map linearly onto these (start°, span°) arcs.
const DEFRINGE_PURPLE_ARC: (f32, f32) = (180.0, 180.0);
const DEFRINGE_GREEN_ARC: (f32, f32) = (30.0, 180.0);
/// Luma Sobel magnitude ramp (0..1 luma) from "not an edge" to "full edge".
const DEFRINGE_EDGE: [f32; 2] = [0.25, 0.5];
/// Fringe reach from an edge, in full-resolution px (scaled to the proxy).
const DEFRINGE_REACH: f32 = 5.0;

// Port of the engine's `filters::defringe_color` (same float-op order), so the
// full-res export matches the wasm preview's colour Defringe.
#[allow(clippy::too_many_arguments)]
fn defringe_color(
    pixels: &mut [u16],
    width: u32,
    height: u32,
    view: CoverageView<'_>,
    purple: f32,
    purple_hue: [f32; 2],
    green: f32,
    green_hue: [f32; 2],
    proxy_scale: f32,
) {
    let (purple, green) = (purple.clamp(0.0, 1.0), green.clamp(0.0, 1.0));
    if purple <= 0.0 && green <= 0.0 {
        return;
    }
    let (wi, hi) = (width as i32, height as i32);
    let n = (width * height) as usize;
    let src = pixels.to_vec();
    let luma = |x: i32, y: i32| {
        let i = (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize * 4;
        (0.299 * src[i] as f32 + 0.587 * src[i + 1] as f32 + 0.114 * src[i + 2] as f32) / 65535.0
    };
    let mut near = vec![0f32; n];
    for y in 0..hi {
        for x in 0..wi {
            let gx = luma(x + 1, y - 1) + 2.0 * luma(x + 1, y) + luma(x + 1, y + 1)
                - luma(x - 1, y - 1)
                - 2.0 * luma(x - 1, y)
                - luma(x - 1, y + 1);
            let gy = luma(x - 1, y + 1) + 2.0 * luma(x, y + 1) + luma(x + 1, y + 1)
                - luma(x - 1, y - 1)
                - 2.0 * luma(x, y - 1)
                - luma(x + 1, y - 1);
            let magnitude = (gx * gx + gy * gy).sqrt();
            near[(y * wi + x) as usize] =
                ((magnitude - DEFRINGE_EDGE[0]) / (DEFRINGE_EDGE[1] - DEFRINGE_EDGE[0])).clamp(0.0, 1.0);
        }
    }
    let reach = (DEFRINGE_REACH * proxy_scale).round().max(1.0) as i32;
    for (sx, sy) in [(1, 0), (0, 1)] {
        let from = near.clone();
        for y in 0..hi {
            for x in 0..wi {
                let mut best = 0f32;
                for d in -reach..=reach {
                    let (nx, ny) = (x + d * sx, y + d * sy);
                    if nx >= 0 && ny >= 0 && nx < wi && ny < hi {
                        let falloff = 1.0 - d.abs() as f32 / (reach + 1) as f32;
                        best = best.max(from[(ny * wi + nx) as usize] * falloff);
                    }
                }
                near[(y * wi + x) as usize] = best;
            }
        }
    }
    let in_window = |hue: f32, arc: (f32, f32), window: [f32; 2]| {
        hue >= arc.0 + window[0].clamp(0.0, 100.0) / 100.0 * arc.1
            && hue <= arc.0 + window[1].clamp(0.0, 100.0) / 100.0 * arc.1
    };
    let mut filtered = src.clone();
    for (i, &proximity) in near.iter().enumerate() {
        if proximity <= 0.0 {
            continue;
        }
        let o = i * 4;
        let (r, g, b) = (
            src[o] as f32 / 65535.0,
            src[o + 1] as f32 / 65535.0,
            src[o + 2] as f32 / 65535.0,
        );
        let (hue, sat, _) = rgb_to_hsl(r, g, b);
        if sat <= 0.0 {
            continue;
        }
        let amount = if purple > 0.0 && in_window(hue, DEFRINGE_PURPLE_ARC, purple_hue) {
            purple
        } else if green > 0.0 && in_window(hue, DEFRINGE_GREEN_ARC, green_hue) {
            green
        } else {
            continue;
        };
        let k = amount * proximity;
        let y = 0.299 * r + 0.587 * g + 0.114 * b;
        for (c, v) in [r, g, b].into_iter().enumerate() {
            filtered[o + c] = ((v + (y - v) * k) * 65535.0).round().clamp(0.0, 65535.0) as u16;
        }
    }
    blend_back(pixels, &filtered, view);
}

fn bounded_unsharp(
    source: &[u16],
    output: &mut [u16],
    width: u32,
    height: u32,
    view: CoverageView<'_>,
    amount: f32,
    radius: f32,
) {
    let (wi, hi) = (width as i32, height as i32);
    let kernel = gaussian_kernel(radius.max(0.1));
    let kr = (kernel.len() / 2) as i32;
    for y in 0..hi {
        for x in 0..wi {
            let index = (y * wi + x) as usize;
            let offset = index * 4;
            let mut value = [0; 4];
            for channel in 0..3 {
                let mut blurred = 0.0;
                for (ky, wy) in kernel.iter().enumerate() {
                    for (kx, wx) in kernel.iter().enumerate() {
                        let sample = sample_index(x + kx as i32 - kr, y + ky as i32 - kr, wi, hi);
                        blurred += source[sample + channel] as f32 * wx * wy;
                    }
                }
                let original = source[offset + channel] as f32;
                value[channel] =
                    (original + (original - blurred) * amount).clamp(0.0, 65_535.0) as u16;
            }
            value[3] = source[offset + 3];
            blend_pixel(source, output, view, index, value);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn bounded_lens(
    source: &[u16],
    output: &mut [u16],
    width: u32,
    height: u32,
    view: CoverageView<'_>,
    distortion: f32,
    vignette: f32,
    aberration: f32,
    scale: f32,
    midpoint: f32,
) {
    let (wi, hi) = (width as i32, height as i32);
    let (cx, cy) = (wi as f32 / 2.0, hi as f32 / 2.0);
    let maximum_radius = (cx * cx + cy * cy).sqrt().max(1.0);
    for y in 0..hi {
        for x in 0..wi {
            let index = (y * wi + x) as usize;
            let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
            let radius = (dx * dx + dy * dy).sqrt() / maximum_radius;
            let factor = (1.0 + distortion * radius * radius) / scale.max(f32::EPSILON);
            let base = sample_bilinear_transparent(
                source,
                wi,
                hi,
                cx + dx * factor - 0.5,
                cy + dy * factor - 0.5,
            );
            let mut value = base;
            if aberration != 0.0 {
                value[0] = sample_bilinear_transparent(
                    source,
                    wi,
                    hi,
                    cx + dx * factor * (1.0 + aberration * radius) - 0.5,
                    cy + dy * factor * (1.0 + aberration * radius) - 0.5,
                )[0];
                value[2] = sample_bilinear_transparent(
                    source,
                    wi,
                    hi,
                    cx + dx * factor * (1.0 - aberration * radius) - 0.5,
                    cy + dy * factor * (1.0 - aberration * radius) - 0.5,
                )[2];
            }
            let midpoint = midpoint.clamp(0.0, 0.95);
            let vr = if midpoint > 0.0 {
                ((radius - midpoint) / (1.0 - midpoint)).max(0.0)
            } else {
                radius
            };
            let gain = (1.0 + vignette * vr * vr).clamp(0.0, 4.0);
            for channel in 0..3 {
                value[channel] = (value[channel] as f32 * gain).round().clamp(0.0, 65_535.0) as u16;
            }
            blend_pixel(source, output, view, index, value);
        }
    }
}

fn bounded_geometry(
    source: &[u16],
    output: &mut [u16],
    width: u32,
    height: u32,
    vertical: f32,
    horizontal: f32,
    rotate: f32,
) {
    let vertical = vertical.clamp(-1.0, 1.0) * 0.25;
    let horizontal = horizontal.clamp(-1.0, 1.0) * 0.25;
    let (sin, cos) = (rotate.clamp(-1.0, 1.0) * 15.0_f32.to_radians()).sin_cos();
    let base = [
        (-vertical, -horizontal),
        (1.0 + vertical, horizontal),
        (1.0 - vertical, 1.0 - horizontal),
        (vertical, 1.0 + horizontal),
    ];
    let mut destination = [[0.0; 2]; 4];
    for (index, (x, y)) in base.into_iter().enumerate() {
        let (dx, dy) = (x - 0.5, y - 0.5);
        destination[index] = [
            (dx * cos - dy * sin + 0.5) * width as f32,
            (dx * sin + dy * cos + 0.5) * height as f32,
        ];
    }
    let Some(inverse) = square_to_quad(destination).and_then(invert_matrix) else {
        output.copy_from_slice(source);
        return;
    };
    for y in 0..height as i32 {
        for x in 0..width as i32 {
            let dx = x as f32 + 0.5;
            let dy = y as f32 + 0.5;
            let denominator = inverse[6] * dx + inverse[7] * dy + inverse[8];
            let offset = (y * width as i32 + x) as usize * 4;
            if denominator.abs() < 1e-8 {
                output[offset..offset + 4].fill(0);
                continue;
            }
            let sx =
                (inverse[0] * dx + inverse[1] * dy + inverse[2]) / denominator * width as f32 - 0.5;
            let sy = (inverse[3] * dx + inverse[4] * dy + inverse[5]) / denominator * height as f32
                - 0.5;
            output[offset..offset + 4].copy_from_slice(&sample_bilinear_transparent(
                source,
                width as i32,
                height as i32,
                sx,
                sy,
            ));
        }
    }
}

pub(crate) fn apply_bounded(
    pixels: &mut Vec<u16>,
    scratch: &mut Vec<u16>,
    width: u32,
    height: u32,
    view: CoverageView<'_>,
    params: &[f32],
    checkpoint: &mut impl FnMut(&'static str) -> Result<(), &'static str>,
) -> Result<usize, &'static str> {
    let get = |index: usize| params.get(index).copied().unwrap_or(0.0);
    let scale = if get(1) > 0.0 { get(1) } else { 1.0 };
    let mut stages = 0;
    macro_rules! stage {
        ($name:literal, $body:block) => {{
            checkpoint($name)?;
            $body
            stages += 1;
        }};
    }
    if [2, 4, 5, 6, 7, 11, 12, 13, 14]
        .into_iter()
        .any(|index| get(index) != 0.0)
    {
        stage!("basic", {
            camera_raw(
                pixels,
                view,
                get(2),
                get(4),
                get(5),
                get(6),
                get(7),
                get(11),
                get(12),
                get(13),
                get(14),
                0.0,
            );
        });
    }
    if get(3) != 0.0 || get(8) != 0.0 || get(9) != 0.0 {
        stage!("white-balance", {
            white_balance_and_endpoints(pixels, view, get(3), get(8), get(9));
        });
    }
    if get(10) != 0.0 {
        stage!("texture", {
            bounded_texture(
                pixels,
                scratch,
                width,
                height,
                view,
                get(10),
                TEXTURE_RADIUS * scale,
            );
        });
    }
    if get(25) >= 0.5 {
        stage!("curves", {
            curves(pixels, view, params);
        });
    }
    if get(17) != 0.0 || get(18) != 0.0 {
        stage!("noise-reduction", {
            bounded_noise(
                pixels,
                scratch,
                width,
                height,
                view,
                get(17),
                get(18),
                get(19),
            );
            std::mem::swap(pixels, scratch);
        });
    }
    if get(15) != 0.0 {
        stage!("sharpen", {
            bounded_unsharp(
                pixels,
                scratch,
                width,
                height,
                view,
                get(15),
                get(16) * scale,
            );
            std::mem::swap(pixels, scratch);
        });
    }
    if get(20) != 0.0 {
        stage!("grain", {
            film_grain(pixels, view, get(20), get(21), get(22), GRAIN_SEED);
        });
    }
    if get(23) != 0.0 {
        stage!("vignette", {
            bounded_lens(
                pixels,
                scratch,
                width,
                height,
                view,
                0.0,
                get(23),
                0.0,
                1.0,
                get(24),
            );
            std::mem::swap(pixels, scratch);
        });
    }
    if get(1050) != 0.0 || get(1051) != 0.0 {
        stage!("lens", {
            bounded_lens(
                pixels,
                scratch,
                width,
                height,
                view,
                get(1050) * 0.5,
                0.0,
                get(1051) * 0.05,
                1.0,
                0.0,
            );
            std::mem::swap(pixels, scratch);
        });
    }
    if get(1052) > 0.0 {
        stage!("defringe", {
            defringe_color(
                pixels,
                width,
                height,
                view,
                get(1052),
                DEFRINGE_PURPLE_HUE,
                0.0,
                DEFRINGE_GREEN_HUE,
                scale,
            );
        });
    }
    if (1053..1077).any(|index| get(index) != 0.0) {
        stage!("color-mixer", {
            hsl(pixels, view, params);
        });
    }
    if (0..3).any(|region| get(1078 + region * 2) != 0.0) {
        stage!("color-grading", {
            color_grading(pixels, view, params);
        });
    }
    if get(1083) != 0.0 || get(1084) != 0.0 || get(1085) != 0.0 {
        stage!("geometry", {
            bounded_geometry(
                pixels,
                scratch,
                width,
                height,
                get(1083),
                get(1084),
                get(1085),
            );
            std::mem::swap(pixels, scratch);
        });
    }
    Ok(stages)
}

#[cfg(test)]
mod defringe_color_tests {
    use super::*;

    #[test]
    fn a_purple_fringe_beside_an_edge_desaturates_and_zero_is_a_no_op() {
        let (w, h) = (16u32, 8u32);
        let mut src = vec![0u16; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let o = ((y * w + x) * 4) as usize;
                let v = if x >= 8 { 56000 } else { 8000 };
                src[o..o + 4].copy_from_slice(&[v, v, v, 65535]);
                if x == 7 {
                    src[o..o + 3].copy_from_slice(&[30000, 10000, 40000]);
                }
            }
        }
        let view = CoverageView {
            width: w,
            height: h,
            coverage: None,
        };
        let fringe = ((3 * w + 7) * 4) as usize;
        let chroma = |px: &[u16]| {
            px[fringe..fringe + 3].iter().max().unwrap() - px[fringe..fringe + 3].iter().min().unwrap()
        };
        let mut out = src.clone();
        defringe_color(&mut out, w, h, view, 1.0, DEFRINGE_PURPLE_HUE, 0.0, DEFRINGE_GREEN_HUE, 1.0);
        assert!(chroma(&out) < chroma(&src), "the in-window fringe desaturates");
        let mut off = src.clone();
        defringe_color(&mut off, w, h, view, 0.0, DEFRINGE_PURPLE_HUE, 0.0, DEFRINGE_GREEN_HUE, 1.0);
        assert_eq!(off, src, "zero amounts are a no-op");
    }
}
