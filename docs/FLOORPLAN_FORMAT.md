# Smartify Floorplan 3D – Plandateiformat

## Status und Kompatibilität

JSON in UTF-8, Dateiname `*.json`, `format: "smartify-floorplan3d"`, `version: 2`. Die App v1.3.0 erweitert **optional** das Format 2 um Raffstores und Sektionaltore. Alte v2-Pläne bleiben lesbar. Versionsnummer der Integration und `version` der Plandatei sind unabhängig.

## Grundschema

```json
{
  "format": "smartify-floorplan3d", "version": 2, "id": "erdgeschoss",
  "name": "Erdgeschoss", "size": [12.0, 9.0],
  "walls": [], "openings": [], "floors": [], "lights": {}
}
```

`size` enthält Breite und Tiefe in **Metern**. Die x/y-Koordinaten in `p` und `q` liegen in der Grundrissebene; z/Höhe wird im Öffnungsobjekt durch `par`, `bottom` bzw. `top` angegeben. `walls`, `foot`, `floors`, `openings`, `decks`, `attika`, `rails`, `items` sind Listen, `lights`, `rooms`, `materials`, `blocks` Objekte. `id`, `format`, `size` sind Pflicht; `version` fehlt im Legacy-Fall implizit (Version 1).

**Aussparungen:** Die Renderer-Engine zeichnet Wände und Öffnungen getrennt. Wandpolygone müssen derzeit bereits an der Öffnung ausgespart sein; das Hinzufügen eines Öffnungsobjekts schneidet **keine** beliebige durchgehende Wand automatisch aus. Die Öffnung erzeugt Sturz und ggf. Brüstung. Ein neuer Plan muss daher die passende Wandlücke im Polygon enthalten.

## Fenster, Türen, Tore

`openings` ist ein Array von Objekten mit `kind`, `p: [x,y]`, `q: [x,y]`, `t` (Wanddicke Meter), `top` (Oberkante Meter), optional `name` (eindeutiger HA-Schlüssel), `par` (Brüstungshöhe Meter), `in` (Orientierung ±1). Gültige `kind`-Werte: `w` Fenster, `b` Fenstertür, `f` Festverglasung, `d` Innentür, `e` Eingangstür, `gate` Legacy-Tor, `sectional_door` Sektionaltor. Fenster `w` brauchen für korrekte Darstellung `par`.

### Raffstore / Jalousie

```json
{"name":"fenster_buero","kind":"w","p":[2,0],"q":[3.2,0],"t":0.4,"par":0.9,"top":2.4,"in":1,
 "shading":{"type":"raffstore","slat_width":0.08,"slat_spacing":0.075,"color":"#A0A0A0"}}
```

`shading.type`: `none`, `roller_shutter`, `raffstore`, `venetian_blind`. `raffstore` und `venetian_blind` werden durch einzelne Lamellen mit Winkelsteuerung gerendert. `roller_shutter` benutzt vorerst die bisherige durchgehende Fläche. `slat_width`, `slat_spacing` und `offset` (Abstand normal zur Öffnung) sind in Metern. Farbe als 6-stelliger Hexwert. Bei `none` ist kein Sonnenschutz sichtbar. Für Legacy-Fenster ohne `shading` gilt die bisherige Logik über `in`.

### Sektionaltor

```json
{"name":"garagentor","kind":"sectional_door","p":[4,0],"q":[7,0],"t":0.3,"top":2.5,
 "sectional":{"panel_height":0.5,"track_type":"standard","radius":0.35,"ceiling_clearance":0.35,"color":"#707070"}}
```

`sectional` optional auch für `kind: "gate"` zur Aufwertung von Legacy-Toren. `panel_height`, `radius`, `ceiling_clearance`, `horizontal_length`, `high_lift`, `offset` in Metern. `track_type`: `standard` (Umlenkung unter Decke), `high_lift` (erhöhte Umlenkung), `vertical` (senkrechtes Tor). Es werden Paneele und Führungsschienen erzeugt. Torfenstersektionen und physikalische Antriebssimulation sind noch nicht implementiert.

## Home Assistant

Die Plan-Datei definiert **Geometrie**; die Kartenkonfiguration verknüpft über `openings.<name>` die Sensoren:

```yaml
openings:
  fenster_buero:
    contact: binary_sensor.fenster_buero
    cover: cover.raffstore_buero
  garagentor:
    cover: cover.garagentor
```

Die Karte nutzt `current_position` und `current_tilt_position` (je 0–100) aus dem HA-`cover`; sofern keine Positionsrückmeldung existiert, wird aus den Zuständen `open`, `closed` oder Zwischenzustand eine grobe Stellung visualisiert, keine verifizierte Torposition. Bewegung ist momentan zustandsgetrieben, keine zeitabhängige Antriebsinterpolation. **Kein Ersatz für Endlagensensorik oder Sicherheitssteuerung.**

## Qualitätssicherung

Neue Pläne mit `validate_plan()` prüfen; Musterdateien `examples/plans/eg.json`, `og.json` als Grundlage nutzen. Namen müssen eindeutig sein. Auf passende Aussparungen in Wänden sowie geschlossene/offene Tor- und Raffstore-Positionen testen. Bei Formatänderungen Beispiele, Tests, `AGENTS.md` und dieses Dokument aktualisieren.
