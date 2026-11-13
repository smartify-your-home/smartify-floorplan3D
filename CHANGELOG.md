# Änderungsverlauf – Smartify Floorplan 3D

Dieses Projekt verwendet Semantic Versioning: **MAJOR.MINOR.PATCH**.
Jeder Versions-Commit erhält einen lesbaren Titel nach dem Schema
`vX.Y.Z – Kurzbeschreibung`. Die automatisch erzeugte Git-Commit-ID
(SHA) ist davon unabhängig und kann technisch nicht ersetzt werden.

## Unveröffentlicht
- Eigenes Icon und Logo (Ordner `brand/`, hell und dunkel) – wird ab Home Assistant 2026.3 angezeigt; Vorlage als SVG unter `docs/brand/icon.svg`.
- Logo im README ergänzt.
- Keine Änderung an Code oder Planformat.

## v1.4.8 – Eigenschaftsdialog und Marker eindeutig trennen
- Fehlerursache: `.sel` wurde zugleich für Auswahlmarker und Dialog verwendet, wodurch die Suche den falschen Knoten traf.
- Dialog auf `fp-sel` und feste Dialogreferenz umgestellt; Touch-Folgeklick-Schutz ergänzt.
- CSS und Regressionstests gegen die Selektorverwechslung angepasst.
- Keine Änderung des Planformats.

## v1.4.7 – Dialog-CSS bereinigt
- Alte Vollbild-CSS-Regeln aus dem 2D-Entitätendialog entfernt, die den modalen Dialog fälschlich bildschirmgroß und oval dargestellt haben.
- Nur noch eine zusammenhängende CSS-Definition für den nativen Dialog, inklusive deckendem Hintergrund und mobiler Ansicht.
- Plandatenformat und Funktionen unverändert.

## v1.4.6 – Einheitliche Versionskennzeichnung
- Versionsnummern in Home-Assistant-Manifest, Python-Konstanten und JavaScript synchronisiert.
- Verbindliches Schema für lesbare Versions-Commit-Titel und Änderungsverlauf eingeführt.
- Keine Änderungen am Planformat.

## v1.4.5 – Entitätenauswahl im Vordergrund
- Nativer Dialog in der obersten Browserebene für die 2D-Bearbeitung.

## v1.4.4 – Eigenschaftsdialog
- Verbesserungen an der Darstellung der Auswahlfelder und Dialogbedienung.

## v1.4.3 – Möbel und Entitäten
- Möbel-Grundrissflächen und überarbeitete Entitätensuche.

## v1.4.2 – Positionen und Touch-Steuerung
- Leuchtenkoordinaten, kleinere Marker und Gesten zum Navigieren.

## v1.4.1 – 2D-Darstellung
- Korrekturen am Zeichnen von Planobjekten im Format 2.

## v1.4.0 – Kartenbasierter 2D-Editor
- Drag & Drop, Kopieren von Objekten, Speichern in Plan-JSON, Hintergrundfarbe.

## v1.3.1 – Leuchtenauswahl
- Durchsuchbare Liste für die Licht-Entität.

## v1.3.0 – Bauteile
- Raffstores, Jalousien und Sektionaltore im Grundriss.

## v1.2.0
- Ausgangsversion der Integration vor den Erweiterungen.
