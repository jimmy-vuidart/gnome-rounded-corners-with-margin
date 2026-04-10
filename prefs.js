import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    let settings = window._settings = this.getSettings();

    const page = new Adw.PreferencesPage();

    // --- Corner radius ---
    const radiusGroup = new Adw.PreferencesGroup({ title: "General" });

    const radiusRow = new Adw.ActionRow({ title: "Corner radius" });
    const radiusSpin = new Gtk.SpinButton({
      adjustment: new Gtk.Adjustment({ lower: 4, upper: 32, step_increment: 1, value: settings.get_int('corner-radius') }),
      valign: Gtk.Align.CENTER,
    });
    radiusSpin.connect('value-changed', () => {
      settings.set_int('corner-radius', radiusSpin.get_value_as_int());
    });
    radiusRow.add_suffix(radiusSpin);
    radiusGroup.add(radiusRow);
    page.add(radiusGroup);

    // --- Per-monitor margins ---
    const display = Gdk.Display.get_default();
    const monitorsModel = display.get_monitors();
    const nMonitors = monitorsModel.get_n_items();

    let marginsData = [];
    try { marginsData = JSON.parse(settings.get_string('corner-margins')); } catch(e) {}

    const saveMargins = () => {
      settings.set_string('corner-margins', JSON.stringify(marginsData));
    };

    for (let i = 0; i < nMonitors; i++) {
      const monitor = monitorsModel.get_item(i);
      const monitorLabel = monitor.get_description?.() || monitor.get_model?.() || `Monitor ${i + 1}`;

      if (!marginsData[i] || typeof marginsData[i] !== 'object') {
        marginsData[i] = { top: 0, right: 0, bottom: 0, left: 0 };
      }

      const group = new Adw.PreferencesGroup({
        title: nMonitors > 1 ? `Margin — ${monitorLabel}` : 'Margin',
      });

      for (const dir of ['top', 'right', 'bottom', 'left']) {
        const row = new Adw.ActionRow({ title: dir.charAt(0).toUpperCase() + dir.slice(1) });
        const spin = new Gtk.SpinButton({
          adjustment: new Gtk.Adjustment({
            lower: 0,
            upper: 512,
            step_increment: 1,
            value: marginsData[i][dir] ?? 0,
          }),
          valign: Gtk.Align.CENTER,
        });
        const idx = i;
        spin.connect('value-changed', () => {
          marginsData[idx][dir] = spin.get_value_as_int();
          saveMargins();
        });
        row.add_suffix(spin);
        group.add(row);
      }

      page.add(group);
    }

    window.add(page);
  }
}
