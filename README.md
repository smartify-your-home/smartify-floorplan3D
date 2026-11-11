# smartify Floorplan 3D

Drehbarer 3D-Grundriss als Home-Assistant-Integration: liefert die Lovelace-Karte aus, verwaltet die Plan-Dateien (Geschosse und Bereiche) und bringt einen Editor mit Import und Drag & Drop.

## Installation über HACS

1. HACS → Benutzerdefinierte Repositories → `https://github.com/smartify-your-home/smartify-floorplan3d`, Typ **Integration**.
2. „smartify Floorplan 3D“ installieren und Home Assistant neu starten.
3. Einstellungen → Geräte & Dienste → Integration hinzufügen → **smartify Floorplan 3D**.

Die Karte wird danach in allen Dashboards automatisch geladen, eine Ressource muss nicht eingetragen werden.
Wer die Karte bisher als Ressource `/local/smartify-floorplan3d.js` eingetragen hatte, entfernt diesen Eintrag.

## Plan-Dateien und Pakete importieren

Pläne liegen unter `/config/smartify_floorplan3d/` (Modelle und Texturen unter `assets/<plan>/`) und sind nur angemeldet erreichbar.

- **Im Karten-Editor:** Dashboard bearbeiten → Karte öffnen → **Pläne** → „Plan importieren …“. Es gehen einzelne `.json`-Pläne oder `.zip`-Pakete. „Als Ansicht“ nimmt einen Plan in den Geschoss-Umschalter auf. Offene Karten laden geänderte Pläne sofort neu.
- **Dienst `smartify_floorplan3d.import_plan`:** aus einer Datei unter `/config` (`path:`) oder von einer URL (`url:`), jeweils `.json` oder `.zip`; optional `file` und `overwrite`.
- **Dienst `smartify_floorplan3d.delete_plan`:** `file: garten.json` (löscht auch die Paketdateien).

Ein Paket ist ein Zip mit der Plan-Datei (`plan.json` oder genau eine `.json` im Hauptordner) und den Dateien, auf die sie verweist:

```
eg.zip
├── plan.json
├── models/sofa.glb
└── textures/parkett.jpg
```

Erlaubt sind `.glb .gltf .bin .jpg .jpeg .png .webp .ktx2`, entpackt höchstens 80 MB. Fehlt eine Datei, auf die der Plan verweist, wird das Paket abgelehnt. Import und Löschen sind Administratoren vorbehalten.

## Karte

```yaml
type: custom:smartify-floorplan3d
floors:
  - eg                       # Plan eg.json
  - og
  - id: wohnen               # Bereich: Ausschnitt aus dem EG
    name: Wohnen
    files: [eg.json]
    region: [wohnen, kueche]
  - id: aussen               # mehrere Pläne zu einer Ansicht zusammensetzen
    name: Außen
    files: [eg.json, garten.json]
```

| Option | Bedeutung |
|---|---|
| `floors[].files` | Plan-Dateien der Ansicht, Standard `<id>.json` |
| `floors[].region` | Ausschnitt: Raum-Schlüssel, Liste davon oder `[x0, y0, x1, y1]` in Metern |
| `floors[].clip` | `false` zeigt beim Ausschnitt auch die Umgebung |
| `model_lights` | Leuchten: `wohnen: light.x` oder `{entity, pos, size, disc, icon, power, range, type, floor}` |
| `openings` | Fenster, Türen, Tore: `{contact, cover, card}` je Name aus der Plan-Datei |
| `elements` | wie bei picture-elements, Position `pos: [x, y]` oder `[x, y, h]`, optional `floor` |
| `aspect_ratio` / `height` | Größe der Karte, z. B. `1 / 1` |
| `walls` | `full` startet mit voller Wandhöhe |
| `colors` | Farben je Material, z. B. `{ cream: '#3a3a3a', light: '#ffd8a0' }` |
| `lighting` | `mode: auto` (nach `sun.sun`), `night` oder `day`; `night_ambient` Restlicht nachts (0.22); `shadows: false` ohne Lampenschatten; `sun` andere Sonnen-Entität |
| `plans_path` | nur ohne Integration: Ordner unter `/local`, z. B. `/local/smartify-floorplan3d/` |

### Licht

Jede gebundene Leuchte ist eine echte Lichtquelle: Deckenleuchten strahlen als weicher Spot nach unten, Steh- und Tischlampen (`type: lamp`) rundum. Das Licht nimmt mit der Entfernung ab und endet an Wänden (Lampenschatten), die Ecke unter einer Lampe ist also heller als der Rest des Raums. Helligkeit, Farbe und Farbtemperatur kommen von der Licht-Entität. Nachts (Sonne unter dem Horizont) wird das Tageslicht gedimmt; der Knopf in der Werkzeugleiste schaltet automatisch / Nacht / Tag.

### Bearbeiten direkt auf der Karte (ab 1.4.0)

**Korrektur in 1.4.1:** Auch Format-2-Einrichtung (`items` als Objekte) wird in der 2D-Draufsicht fehlerfrei dargestellt. Auf kleinen Bildschirmen erscheinen die Bearbeitungsfelder unter dem Plan; „+ / − / Einpassen“ vergrößert den Grundriss in einer horizontal verschiebbaren Ansicht.

Die Karte besitzt ein **Stift-Symbol**. Es öffnet eine bildschirmfüllende
2D-Draufsicht, unabhängig vom schmalen Lovelace-Konfigurationseditor:

- **+ Element**: im Grundriss platzieren und Home-Assistant-Entität auswählen.
- **+ Leuchte**: hinzufügen, positionieren und eine `light.*`- oder `switch.*`-Entität zuordnen.
- **3D-Gegenstände** (z. B. Boiler, Möbel, Geräte): Symbol ziehen, antippen und bei Bedarf **Kopieren**, **Drehen** oder **Entfernen**.
- Positionen folgen einem 5-cm-Raster. Die Kopie eines Objekts nutzt denselben
  3D-Baustein mit eigenen Koordinaten.
- **Änderungen im Plan speichern** schreibt die 3D-Objektpositionen, neue
  Entitätsmarker, Leuchtenzuordnungen und die Plan-Hintergrundfarbe in die
  jeweiligen JSON-Dateien. Ohne Speichern bleiben die Änderungen unveröffentlicht.
- Unter **Weitere Einstellungen** kann die Karten-Hintergrundfarbe
  über `background_color: '#f3f3f3'` überschrieben werden.

Direktes Speichern erfordert Administratorrechte und die HA-Integration.
Die Kartenkonfiguration bleibt für Grundeinstellungen und Planverwaltung vorgesehen.


## Format der Plan-Dateien

Version 2, Koordinaten in Metern, x von West, y von Nord. Alle Pläne eines Hauses teilen sich ein Koordinatensystem, damit Geschosse und Bereiche passgenau zusammengesetzt werden können. Die Optik steckt vollständig im Plan, die Integration rendert nur.

| Feld | Inhalt |
|---|---|
| `id`, `name`, `size`, `heights`, `level` | Kopf |
| `rooms`, `floors` | Räume mit Belag (`mat`) und Umriss |
| `walls`, `foot`, `openings`, `stairs`, `decks`, `attika`, `rails` | Bau |
| `materials` | `{name: {color, roughness, metalness, opacity, emissive, texture, repeat}}`; überschreibt auch Wand, Boden, Glas usw. |
| `blocks` | Bauteile aus Grundformen: `[art, maße, [x, h, y], [rx, ry, rz]\|0, [sx, sy, sz]\|0, material, oben]`, Arten `box`, `cyl`, `ico`, `sphere`, `ring`, `glb` |
| `items` | Einrichtung: `{block, pos: [x, y], rot: grad}` |
| `lights` | Raumleuchten: `{name: {pos: [x, y, h], type, power, range}}` |

Pläne im Format 1 (Einrichtung als Bausteine der eingebauten Bibliothek) laufen weiter. Neue Pläne liefere ich im Format 2 mit „eingefrorener“ Einrichtung, damit ein Update der Integration das Aussehen nicht verändert.

## Entwicklung

```bash
pip install pytest-homeassistant-custom-component
pytest -q
```

## Bewegliche Bauteile (ab 1.3.0)

Raffstores/Jalousien und Sektionaltore lassen sich optional in `openings` definieren und über Home-Assistant-`cover`-Entitäten darstellen. Details, JSON-Beispiele und Grenzen: [Plandateiformat](docs/FLOORPLAN_FORMAT.md). Regeln für Änderungen: [AGENTS.md](AGENTS.md).


### 2D-Editor auf Mobilgeräten (ab 1.4.2)

- Leuchtenpositionen aus dem Planformat `{"pos":[x,y]}` werden korrekt angezeigt.
- Leuchten und Entitäten sind kleine, verschiebbare Marker; Gegenstände werden zunächst ausgeblendet und können über **Gegenstände anzeigen** eingeblendet werden.
- Im Grundriss mit einem Finger über freie Fläche verschieben, mit zwei Fingern zoomen und gleichzeitig verschieben; zum Platzieren/Bewegen einzelner Marker direkt auf diesen ziehen.
- Die Zoomtasten und **Einpassen** funktionieren weiterhin. Objekte lassen sich nach Anzeige auswählen und ihre Positionen im jeweiligen Plan speichern.

### Karteneditor v1.4.3: Entitäten und Gegenstände

- Im 2D-Editor werden Möbel und technische Geräte aus Format-2-`blocks` als maßstäbliche Grundrissflächen gezeichnet und sind direkt antippbar. Ein selektierter Gegenstand kann verschoben, gedreht oder kopiert werden.
- Die Entitätenauswahl verwendet im Kartenmodus eine integrierte, durchsuchbare Liste statt eines Home-Assistant-Pickers im Popup. Für Elemente sind alle HA-Domänen, für Leuchten nur `light` und `switch` auswählbar.
- Such- und Eingabefelder passen sich an schmale Bildschirme an; die Liste belegt höchstens 36 % der Bildschirmhöhe.
- Positionen und Objekte werden erst mit „Änderungen im Plan speichern“ in die Plan-JSON geschrieben.

### Fix 1.4.4: Entitäten-Bearbeitungsdialog

Bei ausgewählten Elementen, Leuchten und Gegenständen öffnet die 2D-Draufsicht jetzt einen **deckenden, responsiven Dialog** über der Kartenfläche. Er ist unabhängig vom Plan-Zoom, hat einen eigenen Scrollbereich und eine Schließen-Schaltfläche. Entitätssuche und Dropdowns sind innerhalb des Dialogs anklickbar. Auf Mobilgeräten wird der Dialog als Bottom-Sheet dargestellt.

### Fix 1.4.5: Nativer Vordergrund-Dialog

Die Entitäten- und Gegenstandsauswahl verwendet jetzt das native HTML-`dialog`-Element mit `showModal()`. Dadurch liegt sie in der Browser-Top-Layer statt in einem durch Scrollcontainer und CSS-Stapelkontexte beeinflussbaren `div`. Einfache rechteckige Dialogfläche, deckender Hintergrund, gerundete Ecken und auf schmalen Displays ein Bottom-Sheet. Die normale Karten- und Planansicht bleibt unverändert.
