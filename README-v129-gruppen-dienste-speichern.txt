ULMIPOINT v129 – Gruppen-Dienste speichern

Wichtig:
- Organisation erstellt und pflegt den zentralen Dienstkatalog.
- Gruppe wählt ihre Dienste selbst aus.
- Arbeit / Gruppe / Auto / Manuell werden pro Gruppe gespeichert.
- Andere Gruppen werden durch diese Auswahl nicht verändert.

Neue / geänderte Seiten:
- dienstkatalog.html
  Zentraler Dienstkatalog der Organisation.

- gruppen-dienste.html
  Gruppenspezifische Auswahl aus dem zentralen Dienstkatalog.
  Speichert nach Haus + Gruppe in group-duties.

- bereich-dyn.html
  Im Reiter Dienste gibt es jetzt:
  "Gruppen-Dienste auf Server speichern"
  und "Aus zentralem Katalog wählen".

Neue / geänderte API:
- /api/duty-catalog
  GET: zentralen Dienstkatalog lesen
  POST: zentralen Dienstkatalog speichern

- /api/group-duties
  GET/POST: Dienste dieser Gruppe lesen/speichern

Speichertrennung:
- org-structure speichert Organisation, Häuser, Gruppen und zentralen Dienstkatalog.
- group-duties speichert nur die Dienst-Auswahl einer einzelnen Gruppe.
- group-state bleibt der komplette Gruppen-Arbeitsstand des Planers.
- group-plan, group-employees und group-wishes bleiben unverändert.

Test:
1. /organisation.html öffnen und einloggen.
2. Dienstkatalog öffnen.
3. POLYPOINT-Grundliste einsetzen und speichern.
4. Gruppen-Dienste öffnen.
5. Haus und Gruppe wählen.
6. Dienste anklicken und Arbeit / Gruppe / Auto / Manuell setzen.
7. Gruppen-Dienste speichern.
8. /gruppen-speicher.html?admin=1 öffnen und prüfen, ob Bereich "Gruppen-Dienste" Revision/Hash zeigt.
