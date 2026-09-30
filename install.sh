#!/usr/bin/env bash
# Installe l'extension dans le dossier utilisateur de GNOME Shell.
# Usage : ./install.sh [--uninstall]
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

UUID=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' metadata.json)
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

if [[ "${1:-}" == "--uninstall" ]]; then
    gnome-extensions disable "$UUID" 2>/dev/null || true
    rm -rf "$DEST"
    echo "Extension $UUID désinstallée."
    exit 0
fi

echo "Compilation des schémas..."
glib-compile-schemas schemas/

echo "Installation dans $DEST..."
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r *.js metadata.json corners schemas README.md LICENSE CREDITS "$DEST/"

gnome-extensions enable "$UUID" 2>/dev/null || true

echo "Extension $UUID installée."
if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    echo "Déconnectez-vous puis reconnectez-vous pour charger la nouvelle version."
else
    echo "Redémarrez GNOME Shell (Alt+F2, puis 'r') pour charger la nouvelle version."
fi
