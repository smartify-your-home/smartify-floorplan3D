# Verbindliche Entwicklerregeln – Smartify Floorplan 3D

1. **Vor jeder Änderung** an Plan-Import, -Export, Wandgeometrie, Öffnungen, Raffstores, Sektionaltoren oder HA-Steuerung `docs/FLOORPLAN_FORMAT.md`, `README.md`, `custom_components/smartify_floorplan3d/store.py` und die betroffenen Tests lesen.
2. **Schema ist maßgeblich:** `validate_plan` ist die serverseitige Eingangsprüfung; der 3D-Renderer muss das dokumentierte Format unterstützen. Format und Beispiele synchron pflegen. Keine undokumentierten Pflichtfelder.
3. Bestehende Pläne mit `format: smartify-floorplan3d`, `version: 2` dürfen durch neue optionale Attribute nicht ungültig werden. Bei inkompatiblen Änderungen: Formatversion anheben, Migration implementieren und testen.
4. Vor Commit: `node --check custom_components/smartify_floorplan3d/frontend/smartify-floorplan3d.js`, `python -m compileall -q custom_components/smartify_floorplan3d`, HA-/pytest-Tests sowie Test der Beispieldateien. Tests bei Änderungen erweitern. Fehlgeschlagene Prüfungen nicht umgehen.
5. Öffnungsgeometrie darf **nicht** durch eine durchgehende Wand verdeckt sein: Aussparung im Wandpolygon berücksichtigen. Bei neuen automatischen Wand-Aussparungen Geometrie und Kollisionen ausdrücklich testen.
6. HA-Cover: `current_position` ist Öffnungsgrad (0=geschlossen, 100=offen); `current_tilt_position` ist Lamellenposition. Nicht verfügbare Attribute defensiv behandeln; bei Toren mit reinen Endlagensensoren keine reale Zwischenposition vortäuschen.
7. Änderungen an Funktion, UI, Konfiguration, Version und Dokumentation zusammen aktualisieren. Release nur nach bestandenem Test und überprüftem GitHub-Stand behaupten.
