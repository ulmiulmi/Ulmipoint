ULMIPOINT v134 – Startseite server-eindeutig

Geändert:
- index.html zeigt nicht mehr zuerst eine leere lokale Organisation als vermeintlichen Stand.
- Startseite lädt Häuser/Gruppen ausschliesslich über /api/org-structure.
- Anzeige mit Serverstatus: Anzahl Standorte, Anzahl Gruppen/Bereiche, Revision/updatedAt.
- Wenn 0 Häuser/Gruppen erscheinen, ist das der geladene Serverstand oder ein Ladefehler wird klar angezeigt.

Wichtig:
- Organisation und Gruppen sollen nicht aus lokalen Browserdaten rekonstruiert werden.
- Der Planer kann weiterhin eine temporäre Arbeitskopie für offene Bearbeitung verwenden; die Organisationsauswahl kommt aber nur vom Server.
