ULMIPOINT v136 – Gruppen-Speicher sicher getrennt

Geändert:
- Globales Speichern/Laden im Planer ist deaktiviert.
- Der Button oben öffnet nur den Speicher der aktuell geöffneten Gruppe.
- /api/group-* verlangt jetzt siteId + groupKey, damit nie aus Versehen eine Standardgruppe überschrieben wird.
- Auto-Speichern des alten globalen Server-Hauptspeichers ist deaktiviert.
- Speichern/Laden betrifft nur die aktuelle Gruppe und ihren Bereich im Server: state, employees, plan, duties, wishes.

Wichtig:
- Organisation bleibt für Struktur, Benutzer/Rechte und zentralen Dienstkatalog.
- Gruppenplaner bleibt für Mitarbeitende, Plan, Dienste, Wünsche und Gruppen-Speicher.
- System & Speicher bleibt für technische Verwaltung, nicht für normale Gruppenarbeit.
