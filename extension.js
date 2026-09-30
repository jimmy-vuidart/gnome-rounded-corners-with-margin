import St from "gi://St"
import GLib from "gi://GLib"
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Gio from "gi://Gio"
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { BlurMyShellLink, BlurredCorner } from './blur.js';

export default class extends Extension {
    _monitorListener = null
    _bindHandle = null
    _redrawId = 0
    _signals = []

    constructor(metadata) {
        super(metadata)
        this.corners = {}
    }

    enable() {
        this._settings = this.getSettings();
        this._bindHandle = this._settings.connect('changed', () => this.queueRedraw())
        this._monitorListener = Gio.DBus.session.signal_subscribe(
            'org.gnome.Mutter.DisplayConfig',
            'org.gnome.Mutter.DisplayConfig',
            'MonitorsChanged',
            '/org/gnome/Mutter/DisplayConfig',
            null,
            Gio.DBusSignalFlags.NONE,
            () => this.queueRedraw()
        )
        this._signals = [
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this.queueRedraw())],
            [global.display, global.display.connect('workareas-changed', () => this.queueRedraw())],
            // at shell shutdown the stage goes away before extensions are disabled
            [Main.uiGroup, Main.uiGroup.connect('destroy', () => this._cancelRedraw(true))],
        ]
        // the wallpaper itself is followed by each corner's BackgroundManager
        this._bms = new BlurMyShellLink(() => this.queueRedraw())
        this.drawCorners()
    }

    disable() {
        this._cancelRedraw(false)
        this.destroyCorners()
        this._bms.destroy()
        this._bms = null
        for (const [obj, id] of this._signals) obj.disconnect(id)
        this._signals = []
        if (this._monitorListener) Gio.DBus.session.signal_unsubscribe(this._monitorListener)
        this._settings.disconnect(this._bindHandle)
        this._settings = null
    }

    // Several signals often fire together (monitors, work area, settings):
    // rebuild only once.
    queueRedraw() {
        if (this._redrawId || !this._settings || this._stageGone) return
        this._redrawId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._redrawId = 0
            this.drawCorners()
            return GLib.SOURCE_REMOVE
        })
    }

    _cancelRedraw(stageGone) {
        if (this._redrawId) GLib.source_remove(this._redrawId)
        this._redrawId = 0
        this._stageGone = stageGone
    }

    drawCorners() {
        const radius = this._settings.get_int('corner-radius')

        let marginsData = []
        try { marginsData = JSON.parse(this._settings.get_string('corner-margins')) } catch(e) {}

        // blur settings, or null to use the plain color
        let blur = null
        if (this._settings.get_string('corner-style') === 'blur' && this._bms) {
            const managers = this._bms.managers
            const effects = this._bms.getPipelineEffects(this._settings.get_string('blur-source'))
            if (managers && effects)
                blur = { managers, effects }
            else
                console.warn('[Rounded Corners] Blur my Shell is not running, using the plain color')
        }

        this.destroyCorners()

        for (let monitor of Main.layoutManager.monitors) {
            let geometryScale = monitor.geometry_scale || 1
            const m = marginsData[monitor.index] ?? {}
            const margins = {
                top:    m.top    ?? 0,
                right:  m.right  ?? 0,
                bottom: m.bottom ?? 0,
                left:   m.left   ?? 0,
            }

            for (let corner of ['tl', 'tr', 'bl', 'br']) {
                const isLeft = corner[1] === 'l'
                const isTop  = corner[0] === 't'

                let x = monitor.x + (isLeft
                    ? margins.left
                    : monitor.width - geometryScale * radius - margins.right)
                let y = monitor.y + (isTop
                    ? margins.top
                    : monitor.height - geometryScale * radius - margins.bottom)

                const key = `${monitor.index}-${corner}`
                const size = geometryScale * radius
                if (blur) {
                    try {
                        const blurred = new BlurredCorner(blur.managers, blur.effects,
                            monitor, corner, x, y, size, geometryScale)
                        this.corners[key] = blurred
                        Main.uiGroup.add_child(blurred.actor)
                        continue
                    } catch (e) {
                        console.warn(`[Rounded Corners] blurred corner failed, using the plain color: ${e}`)
                    }
                }
                this.corners[key] = this.createColorCorner(corner, x, y, size)
                Main.uiGroup.add_child(this.corners[key])
            }
        }
    }

    createColorCorner(corner, x, y, size) {
        const cornerDir = this.dir.get_child('corners').get_path();
        return new St.Bin({
            style_class: `corner-decoration corner-{${corner}}`,
            reactive: false,
            x, y,
            width: size,
            height: size,
            can_focus: false,
            track_hover: false,
            style: `
                background-image: url("${cornerDir}/corner-${corner}.svg");
                background-size: contain;
            `
        })
    }

    destroyCorners() {
        for (let corner of Object.values(this.corners)) {
            corner.destroy()
        }
        this.corners = {}
    }
}
