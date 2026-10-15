"""
Generates the sample images shipped in public/samples/.

The app needs example photos of unfinished spaces for its "Try sample photos"
button. To avoid licensing questions, they are rendered here from scratch with
a tiny numpy ray-caster: a box-shaped room with bare blockwork, brick and
concrete, daylight from a window opening and a little lens blur and grain.

Usage:  python3 tools/make_samples.py   (needs numpy and Pillow)
"""
import math
import os

import numpy as np
from PIL import Image, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'samples')
rng = np.random.default_rng(7)


# ---------------------------------------------------------------- noise ----
def _hash(ix, iy, seed):
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h & 0xFFFF) / 65535.0


def value_noise(x, y, seed=0):
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = _hash(ix, iy, seed), _hash(ix + 1, iy, seed)
    c, d = _hash(ix, iy + 1, seed), _hash(ix + 1, iy + 1, seed)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy


def fbm(x, y, octaves=5, seed=0):
    total, amp, norm = 0.0, 1.0, 0.0
    for o in range(octaves):
        total = total + amp * value_noise(x, y, seed + o * 17)
        norm += amp
        x, y, amp = x * 2.03, y * 2.03, amp * 0.5
    return total / norm


# ------------------------------------------------------------- materials ----
def concrete(u, v, base, seed):
    n = fbm(u * 1.5, v * 1.5, 5, seed)
    fine = value_noise(u * 60, v * 60, seed + 3)
    stain = np.clip((fbm(u * 0.6, v * 0.6, 3, seed + 9) - 0.55) * 3, 0, 1)
    tone = 0.82 + 0.3 * (n - 0.5) + 0.08 * (fine - 0.5) - 0.18 * stain
    return np.asarray(base)[None, :] * tone[:, None]


def masonry(u, v, unit_w, unit_h, mortar, base, mortar_col, seed, jitter=0.12):
    row = np.floor(v / unit_h)
    uu = u + (row % 2) * unit_w * 0.5
    col = np.floor(uu / unit_w)
    fu, fv = uu - col * unit_w, v - row * unit_h
    is_mortar = (fu < mortar) | (fv < mortar)
    unit_tone = 1 + jitter * (_hash(col, row, seed) - 0.5) * 2
    grain = 0.9 + 0.2 * fbm(u * 12, v * 12, 3, seed + 5)
    unit = np.asarray(base)[None, :] * (unit_tone * grain)[:, None]
    mort = np.asarray(mortar_col)[None, :] * (0.85 + 0.3 * value_noise(u * 40, v * 40, seed + 2))[:, None]
    return np.where(is_mortar[:, None], mort, unit)


def formwork(u, v, base, seed):
    plank = np.floor(u / 0.12)
    tone = 0.9 + 0.12 * (_hash(plank, plank * 0 + 3, seed) - 0.5) * 2
    seam = (np.abs(u / 0.12 - np.round(u / 0.12)) < 0.04) * 0.12
    out = concrete(u, v, base, seed)
    return out * (tone - seam)[:, None]


# --------------------------------------------------------------- render ----
def render_room(spec, w=1600, h=1200):
    hfov = math.radians(spec.get('hfov', 68))
    f = (w / 2) / math.tan(hfov / 2)
    cx, cy = w / 2 + spec.get('shift_x', 0), h / 2 + spec.get('shift_y', 0)
    yaw = math.radians(spec.get('yaw', 0))
    eye = np.array([spec.get('eye_x', 0.0), spec.get('eye_y', 1.5), 0.0])
    x0, x1, z0, z1, top = spec['x0'], spec['x1'], spec['z_back'], spec['z_front'], spec['height']

    us, vs = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    d = np.stack([(us - cx) / f, -(vs - cy) / f, -np.ones_like(us)], -1).reshape(-1, 3)
    c, s = math.cos(yaw), math.sin(yaw)
    d = np.stack([c * d[:, 0] + s * d[:, 2], d[:, 1], -s * d[:, 0] + c * d[:, 2]], -1)

    inf = np.full(len(d), np.inf)
    planes = {
        'floor': (1, 0.0), 'ceiling': (1, top), 'left': (0, x0), 'right': (0, x1), 'back': (2, z0), 'front': (2, z1),
    }
    best_t, best_face = inf.copy(), np.full(len(d), -1)
    names = list(planes)
    for i, name in enumerate(names):
        axis, value = planes[name]
        with np.errstate(divide='ignore', invalid='ignore'):
            t = (value - eye[axis]) / d[:, axis]
        t = np.where(t > 1e-6, t, np.inf)
        closer = t < best_t
        best_t = np.where(closer, t, best_t)
        best_face = np.where(closer, i, best_face)
    p = eye[None, :] + d * best_t[:, None]
    face = np.array(names)[best_face]
    color = np.zeros((len(d), 3))

    def apply(name, fn):
        m = face == name
        if m.any():
            color[m] = fn(p[m])

    apply('floor', lambda q: concrete(q[:, 0], q[:, 2], spec['floor_col'], 11))
    apply('ceiling', lambda q: formwork(q[:, 0], q[:, 2], (0.62, 0.62, 0.61), 21))
    for wall in ('left', 'right', 'back', 'front'):
        kind = spec['walls'].get(wall, 'block')
        horiz = (lambda q: q[:, 2]) if wall in ('left', 'right') else (lambda q: q[:, 0])
        if kind == 'brick':
            apply(wall, lambda q, hz=horiz: masonry(hz(q), q[:, 1], 0.23, 0.075, 0.012, (0.62, 0.33, 0.24), (0.66, 0.64, 0.6), 31))
        elif kind == 'plaster':
            apply(wall, lambda q, hz=horiz: concrete(hz(q) * 1.6, q[:, 1] * 1.6, (0.7, 0.69, 0.66), 41))
        else:
            apply(wall, lambda q, hz=horiz: masonry(hz(q), q[:, 1], 0.4, 0.2, 0.012, (0.6, 0.6, 0.58), (0.52, 0.51, 0.49), 51, 0.08))

    # Light: daylight through window openings plus a dim ambient term.
    light = np.full(len(d), spec.get('ambient', 0.18))
    normals = {'floor': (0, 1, 0), 'ceiling': (0, -1, 0), 'left': (1, 0, 0), 'right': (-1, 0, 0), 'back': (0, 0, 1), 'front': (0, 0, -1)}
    nrm = np.array([normals[n] for n in names])[best_face]
    opening = np.zeros(len(d), bool)
    for win in spec.get('windows', []):
        wall, (a0, a1), (b0, b1) = win['wall'], win['span'], win['y']
        axis, value = planes[wall]
        along = 2 if wall in ('left', 'right') else 0
        inside = (face == wall) & (p[:, along] > a0) & (p[:, along] < a1) & (p[:, 1] > b0) & (p[:, 1] < b1)
        opening |= inside
        if win.get('dark'):
            continue
        # Area light sampled on a grid.
        wn = np.array(normals[wall], float)
        acc = np.zeros(len(d))
        samples = [(a, b) for a in np.linspace(a0, a1, 6) for b in np.linspace(b0, b1, 4)]
        area = (a1 - a0) * (b1 - b0)
        for a, b in samples:
            q = np.zeros(3)
            q[axis], q[along], q[1] = value, a, b
            v = q[None, :] - p
            dist2 = (v ** 2).sum(1) + 1e-4
            vn = v / np.sqrt(dist2)[:, None]
            cos_p = np.clip((vn * nrm).sum(1), 0, 1)
            cos_w = np.clip(-(vn @ wn), 0, 1)
            acc += cos_p * cos_w / dist2
        light += win.get('power', 2.2) * acc * area / len(samples)
        # Direct sun patch.
        sun = np.array(win.get('sun', (0, 0, 0)), float)
        if sun.any():
            sun = sun / np.linalg.norm(sun)
            with np.errstate(divide='ignore', invalid='ignore'):
                t = (value - p[:, axis]) / sun[axis]
            hit = p + sun[None, :] * t[:, None]
            lit = (t > 0) & (hit[:, along] > a0) & (hit[:, along] < a1) & (hit[:, 1] > b0) & (hit[:, 1] < b1)
            cos_s = np.clip(nrm @ sun, 0, 1)
            light += lit * cos_s * win.get('sun_power', 1.6)

    # Ambient occlusion: darker near edges and corners.
    for i, name in enumerate(names):
        axis, value = planes[name]
        dist = np.abs(p[:, axis] - value)
        light *= np.where(face == name, 1.0, 1 - 0.35 * np.exp(-dist / 0.35))

    rgb = color * light[:, None]
    # Openings: bright sky / garden, or a dark unlit room.
    for win in spec.get('windows', []):
        wall, (a0, a1), (b0, b1) = win['wall'], win['span'], win['y']
        along = 2 if wall in ('left', 'right') else 0
        inside = (face == wall) & (p[:, along] > a0) & (p[:, along] < a1) & (p[:, 1] > b0) & (p[:, 1] < b1)
        if win.get('dark'):
            rgb[inside] = np.array([0.05, 0.048, 0.045]) * (0.8 + 0.4 * value_noise(p[inside, along] * 3, p[inside, 1] * 3, 5))[:, None]
        else:
            yy = (p[inside, 1] - b0) / (b1 - b0)
            greenery = fbm(p[inside, along] * 2.2, p[inside, 1] * 2.2, 4, 77)
            sky = np.stack([2.6 + 0 * yy, 2.75 + 0 * yy, 3.0 + 0 * yy], -1)
            tree = np.stack([0.5 * greenery, 0.75 * greenery, 0.35 * greenery], -1) * 2.2
            mix = np.clip((0.55 - yy) * 3 + (greenery - 0.5) * 2, 0, 1)[:, None]
            rgb[inside] = sky * (1 - mix) + tree * mix

    exposure = spec.get('exposure', 1.6)
    rgb = 1 - np.exp(-rgb * exposure)          # soft film-like tone curve
    rgb = np.clip(rgb, 0, 1) ** (1 / 2.2)
    img = (rgb.reshape(h, w, 3) * 255).astype(np.uint8)
    return finish_photo(img)


def finish_photo(img):
    """Lens softness, vignette and sensor grain so the render reads as a photo."""
    h, w, _ = img.shape
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    out = img.astype(float) * (1 - 0.18 * r[..., None] ** 2)
    out += rng.normal(0, 3.2, out.shape)
    pil = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    return pil.filter(ImageFilter.GaussianBlur(0.7))


def render_exterior(w=1600, h=1100):
    f = (w / 2) / math.tan(math.radians(62) / 2)
    cx, cy = w / 2, h * 0.58
    us, vs = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    dx, dy = (us - cx) / f, -(vs - cy) / f
    eye_y, facade_z, half_w, roof = 1.6, 11.0, 6.0, 6.6
    rgb = np.zeros((h, w, 3))
    # Sky.
    sky_t = np.clip(dy * 2, 0, 1)[..., None]
    rgb[:] = np.array([0.78, 0.86, 0.95]) * (1 - sky_t) + np.array([0.45, 0.62, 0.86]) * sky_t
    clouds = np.clip((fbm(dx * 4, dy * 9, 5, 3) - 0.55) * 3, 0, 1)[..., None]
    rgb = rgb * (1 - clouds * 0.7) + clouds * 0.7 * np.array([0.97, 0.97, 0.97])
    # Distant trees along the horizon.
    tree_h = 0.03 + 0.06 * fbm(dx * 6, dx * 0, 4, 9)
    trees = (dy > 0) & (dy < tree_h)
    rgb[trees] = (np.array([0.22, 0.32, 0.18]) * (0.7 + 0.5 * fbm(dx * 40, dy * 40, 3, 4))[..., None])[trees]
    # Ground (dirt and gravel) where the ray hits y = 0 before the facade.
    with np.errstate(divide='ignore', invalid='ignore'):
        tg = np.where(dy < 0, eye_y / -dy, np.inf)
    gx, gz = dx * tg, tg
    ground = dy < 0
    dirt = concrete(gx[ground] * 0.8, gz[ground] * 0.8, (0.58, 0.5, 0.4), 61)
    rgb[ground] = dirt * 0.95
    # Facade: plane z = facade_z between -half_w..half_w, 0..roof.
    fx, fy = dx * facade_z, eye_y + dy * facade_z
    facade = (np.abs(fx) < half_w) & (fy > 0) & (fy < roof) & ~((dy < 0) & (gz < facade_z))
    block = masonry(fx[facade] + 10, fy[facade], 0.4, 0.2, 0.012, (0.66, 0.65, 0.62), (0.55, 0.54, 0.5), 71, 0.08)
    shade = 0.95 + 0.0 * fx[facade]
    rgb[facade] = block * shade[:, None]
    # Slab edges (exposed concrete bands) and window/door openings.
    for y0 in (0.0, 3.1, 6.25):
        band = facade & (fy > y0) & (fy < y0 + 0.32)
        rgb[band] = concrete(fx[band] * 2, fy[band] * 2, (0.72, 0.71, 0.69), 81)
    openings = [(-4.6, -2.8, 0.9, 2.4), (-0.7, 0.7, 0.0, 2.4), (2.8, 4.6, 0.9, 2.4),
                (-4.6, -2.8, 4.0, 5.5), (-1.0, 1.0, 4.0, 5.5), (2.8, 4.6, 4.0, 5.5)]
    for a0, a1, b0, b1 in openings:
        hole = facade & (fx > a0) & (fx < a1) & (fy > b0) & (fy < b1)
        rgb[hole] = np.array([0.06, 0.058, 0.055]) * (0.8 + 0.4 * value_noise(fx[hole] * 3, fy[hole] * 3, 1))[:, None]
    # Shadow at the base of the facade.
    near_base = ground & (gz > facade_z - 1.2) & (gz < facade_z) & (np.abs(gx) < half_w + 0.5)
    rgb[near_base] *= (0.75 + 0.25 * np.clip((facade_z - gz[near_base]) / 1.2, 0, 1))[:, None]
    rgb = np.clip(rgb * 1.05, 0, 1) ** (1 / 1.25)
    return finish_photo((rgb * 255).astype(np.uint8))


def oak_sample(size=900):
    yy, xx = np.mgrid[0:size, 0:size] / size * 1.0  # one metre square
    plank_w = 0.19
    col = np.floor(xx / plank_w)
    offset = _hash(col, col * 0 + 1, 3) * 1.4
    row = np.floor((yy + offset) / 1.4)
    tone = 0.9 + 0.2 * (_hash(col, row, 5) - 0.5)
    grain = fbm((xx - col * plank_w) * 60, (yy + offset) * 3, 4, int(7)) * 0.25
    rings = 0.06 * np.sin((xx * 90 + fbm(xx * 4, yy * 4, 3, 9) * 12))
    base = np.array([0.80, 0.63, 0.43])
    rgb = base[None, None, :] * (tone * (0.85 + grain + rings))[..., None]
    gap = ((xx - col * plank_w) < 0.003) | (np.abs(((yy + offset) % 1.4)) < 0.003)
    rgb[gap] *= 0.45
    light = 1.05 - 0.15 * ((xx - 0.3) ** 2 + (yy - 0.3) ** 2)
    rgb *= light[..., None]
    return finish_photo((np.clip(rgb, 0, 1) ** (1 / 1.1) * 255).astype(np.uint8))


def palette_card(w=1000, h=700):
    colors = ['#f1ebe0', '#a8b5a2', '#c97b5a', '#d8b46a', '#3e4a4f']
    img = Image.new('RGB', (w, h), '#fbfaf7')
    arr = np.array(img).astype(float)
    sw = (w - 120) // len(colors)
    for i, c in enumerate(colors):
        rgb = [int(c[k:k + 2], 16) for k in (1, 3, 5)]
        arr[90:h - 90, 60 + i * sw + 8:60 + (i + 1) * sw - 8] = rgb
    return finish_photo(arr.astype(np.uint8))


SAMPLES = {
    'sample-living.jpg': dict(
        x0=-2.4, x1=2.5, z_back=-5.6, z_front=1.0, height=3.0, floor_col=(0.6, 0.58, 0.55),
        walls={'back': 'brick', 'left': 'block', 'right': 'block', 'front': 'block'},
        windows=[dict(wall='left', span=(-4.3, -2.3), y=(0.85, 2.25), sun=(-0.75, 0.6, -0.25), power=2.6, sun_power=1.4),
                 dict(wall='right', span=(-5.3, -4.35), y=(0.0, 2.15), dark=True)],
        ambient=0.2, exposure=1.7, shift_y=-20),
    'sample-bedroom.jpg': dict(
        x0=-1.9, x1=2.0, z_back=-4.3, z_front=1.0, height=2.9, floor_col=(0.57, 0.56, 0.54),
        walls={'back': 'block', 'left': 'plaster', 'right': 'block', 'front': 'block'},
        windows=[dict(wall='back', span=(-0.9, 0.9), y=(0.9, 2.2), sun=(0.3, 0.55, 0.78), power=2.4, sun_power=1.3)],
        ambient=0.2, exposure=1.8, yaw=-4, shift_y=10),
    'sample-kitchen.jpg': dict(
        x0=-1.8, x1=2.2, z_back=-4.0, z_front=1.0, height=2.95, floor_col=(0.58, 0.57, 0.55),
        walls={'back': 'plaster', 'left': 'block', 'right': 'brick', 'front': 'block'},
        windows=[dict(wall='right', span=(-3.4, -2.2), y=(1.05, 2.15), sun=(0.7, 0.55, -0.4), power=2.4, sun_power=1.2)],
        ambient=0.22, exposure=1.7, eye_x=-0.2),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, spec in SAMPLES.items():
        render_room(spec).save(os.path.join(OUT, name), quality=88)
        print('wrote', name)
    render_exterior().save(os.path.join(OUT, 'sample-exterior.jpg'), quality=88)
    oak_sample().save(os.path.join(OUT, 'ref-oak-floor.jpg'), quality=90)
    palette_card().save(os.path.join(OUT, 'ref-palette.jpg'), quality=90)
    print('wrote exterior and references')


if __name__ == '__main__':
    main()
