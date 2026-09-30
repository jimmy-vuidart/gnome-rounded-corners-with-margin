// Corners filled with the same static blur as Blur my Shell's panel/dock.
//
// Blur my Shell (BMS) blurs a monitor-sized copy of the wallpaper anchored at
// the monitor origin, then clips it to the panel/dock. We do the same, but only
// on a small box around each corner (corner + padding, cut at the monitor
// edges): with enough padding the blurred pixels inside the corner are the
// same as BMS's, for a tiny fraction of the cost. A concave mask shader is then
// applied on top.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';

export const BMS_UUID = 'blur-my-shell@aunetx';
const BMS_SCHEMA = 'org.gnome.shell.extensions.blur-my-shell';

// Shape effects would round the edges of our small blur box: skip them.
const SKIPPED_EFFECTS = ['corner'];

// Anti-aliasing formula taken from BMS's corner.glsl, inverted: keep what is
// outside the quarter circle.
const MASK_SHADER = `
uniform sampler2D tex;
uniform float size;
uniform float center_x;
uniform float center_y;

void main(void) {
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec4 c = texture2D(tex, uv);
    float dist = distance(uv * size, vec2(center_x, center_y));
    float alpha = clamp(dist - size + 0.5, 0.0, 1.0);
    cogl_color_out = c * alpha;
}`;

function floatValue(v) {
    const value = new GObject.Value();
    value.init(GObject.TYPE_FLOAT);
    value.set_float(v);
    return value;
}

const ConcaveCornerMask = GObject.registerClass({
    GTypeName: 'RoundedCornersConcaveCornerMask',
}, class ConcaveCornerMask extends Clutter.ShaderEffect {
    constructor(corner, size) {
        super();
        this.set_shader_source(MASK_SHADER);
        // circle center, in the corner's own coordinates
        this.set_uniform_value('size', floatValue(size));
        this.set_uniform_value('center_x', floatValue(corner[1] === 'l' ? size : 0));
        this.set_uniform_value('center_y', floatValue(corner[0] === 't' ? size : 0));
    }
});

/// Read-only access to BMS's settings and live effect managers.
export class BlurMyShellLink {
    constructor(onChange) {
        this._onChange = onChange;
        this._settings = null;
        this._settingsIds = [];
        this._stateId = Main.extensionManager.connect('extension-state-changed',
            (_, ext) => { if (ext.uuid === BMS_UUID) this._reload() });
        this._reload();
    }

    _reload() {
        this._disconnectSettings();

        const ext = Main.extensionManager.lookup(BMS_UUID);
        const schemaDir = ext?.dir.get_child('schemas');
        if (schemaDir?.query_exists(null)) {
            try {
                const source = Gio.SettingsSchemaSource.new_from_directory(
                    schemaDir.get_path(), Gio.SettingsSchemaSource.get_default(), false);
                const schema = source.lookup(BMS_SCHEMA, true);
                if (schema) this._settings = new Gio.Settings({ settings_schema: schema });
            } catch (e) {
                console.warn(`[Rounded Corners] cannot read Blur my Shell settings: ${e}`);
            }
        }

        if (this._settings) {
            this._settingsIds.push([this._settings,
                this._settings.connect('changed::pipelines', () => this._onChange())]);
            for (const child of ['panel', 'dash-to-dock']) {
                const s = this._settings.get_child(child);
                this._settingsIds.push([s, s.connect('changed::pipeline', () => this._onChange())]);
            }
        }

        this._onChange();
    }

    /// The BMS managers, or null if BMS is not running.
    get managers() {
        const bms = global.blur_my_shell;
        if (!bms?._effects_manager || !bms?._pipelines_manager) return null;
        return { effects: bms._effects_manager, pipelines: bms._pipelines_manager };
    }

    /// Effects descriptors of the pipeline used by `source` ('panel' or 'dash-to-dock').
    getPipelineEffects(source) {
        const managers = this.managers;
        if (!managers || !this._settings) return null;
        const id = this._settings.get_child(source).get_string('pipeline');
        const pipeline = managers.pipelines.pipelines[id] ?? managers.pipelines.pipelines['pipeline_default'];
        if (!pipeline) return null;
        return pipeline.effects.filter(effect =>
            !SKIPPED_EFFECTS.includes(effect.type) &&
            `new_${effect.type}_effect` in managers.effects);
    }

    _disconnectSettings() {
        for (const [s, id] of this._settingsIds) s.disconnect(id);
        this._settingsIds = [];
        this._settings = null;
    }

    destroy() {
        this._disconnectSettings();
        Main.extensionManager.disconnect(this._stateId);
    }
}

/// Largest blur radius of the pipeline, used to size the padding.
function pipelineBlurRadius(effects) {
    let radius = 0;
    for (const { params } of effects) {
        for (const key of ['radius', 'unscaled_radius']) {
            if (typeof params?.[key] === 'number') radius = Math.max(radius, params[key]);
        }
    }
    return radius || 30;
}

/// A corner actor showing the BMS-blurred wallpaper of `monitor`.
/// `x`, `y`, `size` are stage coordinates of the corner square.
export class BlurredCorner {
    constructor(bms, effects, monitor, corner, x, y, size, scale) {
        this._effectsManager = bms.effects;
        this._effects = [];
        this._bgManager = null;
        try {
            this._build(effects, monitor, corner, x, y, size, scale);
        } catch (e) {
            this.destroy();
            throw e;
        }
    }

    _build(effects, monitor, corner, x, y, size, scale) {

        // Enough padding for the blur kernel to see the same pixels as the
        // monitor-sized blur of BMS.
        const padding = Math.ceil(3 * pipelineBlurRadius(effects) * scale);
        const bx0 = Math.max(monitor.x, x - padding);
        const by0 = Math.max(monitor.y, y - padding);
        const bx1 = Math.min(monitor.x + monitor.width, x + size + padding);
        const by1 = Math.min(monitor.y + monitor.height, y + size + padding);

        this.actor = new Clutter.Actor({
            name: `rounded-corner-blur-${monitor.index}-${corner}`,
            reactive: false,
            x, y, width: size, height: size,
            clip_to_allocation: true,
        });
        // the stage may destroy us first (e.g. at shell shutdown)
        this.actor.connect('destroy', () => { this._actorDestroyed = true });

        this._blurBox = new Clutter.Actor({
            x: bx0 - x, y: by0 - y,
            width: bx1 - bx0, height: by1 - by0,
            clip_to_allocation: true,
        });
        this.actor.add_child(this._blurBox);

        // wallpaper anchored at the monitor origin, as in BMS
        const wallpaper = new Clutter.Actor({
            x: monitor.x - bx0, y: monitor.y - by0,
            width: monitor.width, height: monitor.height,
        });
        this._blurBox.add_child(wallpaper);
        this._bgManager = new Background.BackgroundManager({
            container: wallpaper,
            monitorIndex: monitor.index,
            controlPosition: false,
        });

        // same construction as BMS's Pipeline.update_effects_from_pipeline
        for (const { type, params } of effects)
            this._effects.push(this._effectsManager[`new_${type}_effect`](params ?? {}));
        this._effects.reverse();
        for (const effect of this._effects) this._blurBox.add_effect(effect);

        this.actor.add_effect(new ConcaveCornerMask(corner, size));
    }

    destroy() {
        if (this._actorDestroyed) return;
        // give the effects back to BMS's pool before destroying their actor
        for (const effect of this._effects) this._effectsManager.remove(effect);
        this._effects = [];
        this._bgManager?.destroy();
        this.actor?.destroy();
    }
}
