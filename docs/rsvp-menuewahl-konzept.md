# Menüwahl in der Rückmeldung — Konzept

**Stand:** 2026-10-24 · **Status:** Entwurf, noch nichts gebaut · **Bezug:** SEAT-1 in
`docs/parkinglot.md` · **Mockup:** `docs/mockups/rsvp-menuewahl.html` (klickbar, ohne
Server zu öffnen)

> Gäste sollen bei der Rückmeldung auch ihr Essen wählen, damit die Information da
> ist, wenn der Caterer sie braucht.

## 1. Ziel und Nicht-Ziele

**Ziel.** Jede Person, die kommt und mitisst, wählt im Rückmeldeformular genau ein
Gericht. Die Wahl landet dort, wo heute schon die Ernährungshinweise liegen, ist im
Admin pro Person sichtbar, lässt sich dort auch nachtragen (für alle, die am Telefon
antworten), und der Küchenexport zählt sie: pro Tisch, für die ganze Hochzeit, in der
Tabelle.

**Nicht-Ziele (bewusst).**

- Keine Auswahl pro Gang (Vorspeise, Hauptgang, Dessert). Eine Frage, der Hauptgang.
  Die Datenform lässt einen zweiten Gang später zu (siehe 12), ohne dass die erste
  Frage wandern muss.
- Keine Erinnerungs-Mails aus der App heraus. Die Liste, wem die Wahl fehlt, gibt es;
  das Anschreiben bleibt beim Brautpaar (siehe 10).
- Keine Preise, keine Mengen, keine Getränke.

## 2. Ist-Stand

- Das Formular (`src/components/RSVPForm.tsx`) zeigt pro Person eine Karte mit
  *Kommt / Kommt nicht* und sieben Kästchen: Vegetarisch, Vegan, Glutenfrei,
  Nussallergie, Sonstiges (+ Freitext), Kindermenü, Isst nicht mit.
- Gespeichert wird das als ein Array pro Haushalt in `rsvps.dietary_restrictions`
  (JSONB), ein `DietaryEntry` pro mitkommender Person, zugeordnet **über den Namen**
  (`src/lib/dietary.ts`). Die Gästeliste schreibt dasselbe Array über
  `PUT /api/admin/rsvps`, der Sitzplan-Export liest es.
- Der Code trennt heute schon zwei Dinge, die auch das Konzept trennt:
  `DIET_CODES` (VEG, VGN, GF, NUT, OTH) *verändern* einen Teller, `MEAL_CODES`
  (KID, NOM) *entscheiden* ihn (Kinderteller, kein Teller).
- Der Export (`src/lib/seatingExport.ts`) druckt jeden Teller ohne Hinweis als
  **„Hähnchen“** (`NO_RESTRICTION_LABEL`), weil das das Einzige ist, was sich ohne zu
  fragen sagen lässt. Ein Gast, der Fisch gewollt hätte, ist heute nicht von einem zu
  unterscheiden, der Hähnchen wollte. Der Export-Dialog trägt die Option „Menüwahl“
  bereits, ausgegraut, mit genau dieser Begründung.
- Rund ein Drittel der Gästeliste hat schon geantwortet. Jede dieser Gruppen muss
  die Wahl nachtragen; das ist der Grund, warum SEAT-1 geparkt war, und ist in
  Abschnitt 10 der Plan dafür.

## 3. Das Modell: eine Frage, ein Teller

Pro mitkommender Person gibt es künftig **zwei Fragen**, die der Code schon kennt,
und die das Formular jetzt auch so zeigt:

| Frage | Art | Antworten |
|---|---|---|
| **Hauptgang** — *Was kommt auf den Teller?* | genau eine | die Gerichte aus den Einstellungen, dazu **Kindermenü** und **Isst nicht mit** |
| **Ernährungshinweise** — *Was muss die Küche wissen?* | beliebig viele | Vegetarisch, Vegan, Glutenfrei, Nussallergie, Sonstiges + Text |

Kindermenü und „Isst nicht mit“ wandern also aus der Kästchenreihe in die
Einzelauswahl, wo sie sachlich hingehören (sie *entscheiden* den Teller). Gespeichert
werden sie weiterhin als die Booleans, die es heute gibt; nichts, was sie liest,
ändert sich.

**Datenform.** `DietaryEntry` bekommt ein Feld:

```ts
export interface DietaryEntry {
    // … wie bisher …
    /** Das gewählte Gericht: die `id` einer Option aus `rsvpMenu.options`.
     *  null = noch nicht gewählt. Fehlt das Feld, hat die Person nie die Frage
     *  gesehen (Antwort von vor der Menüwahl). */
    meal?: string | null;
}
```

Regeln, alle in `src/lib/dietary.ts`, rein und von `check:seating` abgedeckt:

- `no_meal === true` ⇒ `meal` ist `null` und alle Hinweise sind aus (die
  bestehende Exklusivität in `toggleRestriction('NOM')` wird um `meal` erweitert).
- `kids_meal === true` ⇒ `meal` ist `null`. Hinweise bleiben erlaubt: ein Kind kann
  eine Nussallergie haben.
- Ein Gericht wählen ⇒ `kids_meal` und `no_meal` werden `false`.
- **„Offen“** ist eine Person, die kommt, bei der weder `meal` auf eine *existierende*
  Option zeigt noch `kids_meal` noch `no_meal` gesetzt ist. Das gilt für alte
  Antworten ohne das Feld genauso wie für eine Option, die inzwischen gelöscht wurde.
- Gespeichert wird die **`id`** der Option, nie der Name, damit ein Umbenennen in den
  Einstellungen („Lachs“ → „Lachsfilet auf Blattspinat“) keine Antwort verliert.

Neue Helfer: `mealOf(entry, menu)` (Option | `'KID'` | `'NOM'` | `null`),
`mealMissing(entry, menu)`, `mealTally(people, menu)`, `setMeal(entry, id)`.

## 4. Konfiguration: das Brautpaar nennt sein Menü

Die Gerichte sind Inhalt, kein Schema, also leben sie wie Rückmeldefrist und
Kontakt-E-Mail in `public/config/site.json`, Schlüssel `rsvpMenu`, geschrieben über
`updateSiteConfig()` und `POST /api/admin/site-config` (der Editor schickt den
ganzen `rsvpMenu`-Block, der Merge ist flach):

```json
"rsvpMenu": {
  "enabled": true,
  "title": "Hauptgang",
  "hint": "Es gibt ein 3-Gänge-Menü. Vorspeise und Dessert sind für alle gleich, den Hauptgang wählt ihr.",
  "options": [
    { "id": "rind",    "label": "Rinderfilet", "description": "mit Rosmarinkartoffeln und Marktgemüse", "diet": [] },
    { "id": "lachs",   "label": "Lachsfilet",  "description": "auf Blattspinat mit Zitronenrisotto",   "diet": ["gluten_free"] },
    { "id": "risotto", "label": "Pilzrisotto", "description": "mit Parmesan und Trüffelöl",            "diet": ["vegetarian", "gluten_free"] }
  ]
}
```

- `enabled: false` (der Default, solange nichts eingetragen ist) ⇒ das Formular
  fragt nichts, der Admin zeigt keine Spalte, der Export bleibt, wie er ist. Das
  Feature ist nach dem Deploy unsichtbar, bis ihr es einschaltet.
- `id` wird beim Anlegen einmal aus dem Namen gebildet (`lachs`) und danach nie
  geändert. Reihenfolge der Liste = Reihenfolge im Formular, Export und Statistik.
- `diet` sind Hinweis-Tags am Gericht (🌱 vegetarisch, vegan, 🌾 glutenfrei). Sie
  werden im Formular angezeigt, damit jemand mit Hinweis sieht, welches Gericht
  passt. **Keine Automatik**: wer „Vegan“ ankreuzt und das Rind wählt, darf das; die
  Hinweise gelten für den ganzen Abend (Häppchen, Torte, Mitternachtssnack), der
  Hauptgang ist nur ein Gang.
- Maximal 8 Optionen, Name ≤ 60 Zeichen, Beschreibung ≤ 160 (Server-Validierung in
  der site-config-Route, Fehlertext im Editor).
- **Löschen einer Option, die schon gewählt wurde:** der Editor zeigt die Zahl
  („12 Gäste haben dieses Gericht gewählt“) und fragt nach. Nach dem Löschen gelten
  diese Personen als *offen* und tauchen im Filter „Menü fehlt“ auf. Die gespeicherte
  `id` bleibt in den Antworten stehen; eine Option mit derselben `id` wieder
  anzulegen stellt sie her.

## 5. Das Gästeformular

Ablauf wie heute: Name prüfen → Formular → Beleg. Neu ist nur die Karte pro Person.

**Die Karte** (nur sichtbar, wenn die Person kommt):

1. Kopf: Name, *Kommt / Kommt nicht* (unverändert).
2. **Hauptgang**, ein Block aus wählbaren Karten (Radio-Verhalten, groß genug zum
   Tippen): Name des Gerichts, Beschreibung, Tags. Darunter, kleiner und grau:
   *Kindermenü* und *Isst nicht mit* als zwei weitere Radios derselben Gruppe.
   Über dem Block der `hint` aus den Einstellungen, wenn gesetzt.
3. **Ernährungshinweise**: die fünf Kästchen, wie heute; *Sonstiges* öffnet den Text.
   Bei *Isst nicht mit* sind sie ausgegraut, mit der bestehenden Baby-Erklärung.

**Pflicht.** Solange die Menüwahl eingeschaltet ist, ist der Hauptgang Pflicht für
jede Person, die kommt (siehe 13 für die Alternative). Das Formular nutzt dafür das
Muster, das es für *Kommt / Kommt nicht* schon hat:

- Karte ohne Wahl: gelber Rand (`bg-amber-50 border-amber-300`), wie heute bei
  fehlender Zu-/Absage.
- Unter dem Formular: *„Für 2 Personen fehlt noch die Wahl des Hauptgangs.“*
- Der Senden-Knopf ist deaktiviert, bis nichts mehr fehlt (`unansweredCount`
  bekommt die fehlenden Gerichte dazu).

**Rückkehrer** (haben vor der Menüwahl geantwortet): die Karten kommen mit ihren
Hinweisen vorbefüllt, der Hauptgang ist leer und gelb; das blaue Willkommen-Banner
sagt es ausdrücklich: *„Neu seit eurer Rückmeldung: Bitte wählt für jede Person ein
Gericht.“* Alles andere bleibt, wie sie es gespeichert haben.

**Beleg.** Die Erfolgsseite listet heute die Namen. Künftig pro Zeile
*Name · Gericht · Hinweise*: „Julia Weber · Lachsfilet · glutenfrei“, „Emma Weber ·
Kindermenü“. Das ist die Stelle, an der ein Gast merkt, dass er sich verklickt hat.

**Texte** (deutsch, du/ihr wie der Rest des Formulars):

| Stelle | Text |
|---|---|
| Blocküberschrift | `rsvpMenu.title`, Default **Hauptgang** |
| Leerer Block | *Bitte wählt ein Gericht.* |
| Kindermenü-Erklärung | *Ein eigener Teller für Kinder. Hinweise (z. B. eine Allergie) bitte trotzdem ankreuzen.* |
| Fehlhinweis | *Für {n} Person(en) fehlt noch die Wahl des Hauptgangs.* |
| Banner Rückkehrer | *Neu seit eurer Rückmeldung: Bitte wählt für jede Person ein Gericht.* |

## 6. API und Validierung

**`POST/PUT /api/rsvp`** (`parseInput`): jeder Eintrag in `dietaryRestrictions`
darf `meal` als String ≤ 64 Zeichen oder `null` tragen. Ist die Menüwahl
eingeschaltet, muss ein String eine existierende Option-`id` sein, sonst 400
*„Ungültige Menüwahl“* (ein handgebauter Request, nicht das Formular). Ist sie
ausgeschaltet, schickt das Formular das Feld nicht, und **der Server behält den
gespeicherten Wert der Person** (Merge über den Namen, wie `alignEntries`), damit
ein kurz ausgeschaltetes Menü keine Antworten löscht. Nur ein ausdrückliches `null`
löscht.

Die Pflicht wird **serverseitig nicht** erzwungen: ein Haushalt soll seine Zusage
immer speichern können, auch wenn die Küche noch nicht feststeht; „offen“ ist ein
Zustand, den der Admin sieht, kein Fehler. (Das Formular erzwingt sie, Abschnitt 5.)

**`PUT /api/admin/rsvps`** (Gästeliste-Editor): nimmt `meal` mit durch; dieselbe
Prüfung gegen die Optionen.

**`POST /api/guest-verification`**: unverändert, `existingRsvp.dietaryRestrictions`
trägt das Feld automatisch mit.

**`POST /api/admin/site-config`**: validiert `rsvpMenu` (Form, Längen, eindeutige
`id`s, max. 8). Die Route ist schon für genau solche Blöcke da.

**Kein SQL.** `dietary_restrictions` ist JSONB, `database/init.sql` bleibt
unangetastet. Es gibt keine Migration und nichts, was eine frische Installation
anders aufsetzt.

## 7. Admin

**Einstellungen → Rückmeldungen** bekommt unter Kontakt-E-Mail und Frist den Block
**Menüwahl**: Schalter *„Gäste wählen ihren Hauptgang“*, Titel, Hinweistext, die
Liste der Gerichte (Name, Beschreibung, Tags, Zahl der bisherigen Wahlen, Löschen,
Reihenfolge per Pfeil), *„+ Gericht hinzufügen“*. Darunter der Satz, der die
Konsequenz nennt: *„Schaltet ihr die Wahl ein, nachdem schon Rückmeldungen da sind,
zeigt der Tab Rückmeldungen, wem sie noch fehlt.“*

**Rückmeldungen-Tab** (`src/app/admin/rsvps/page.tsx`):

- Neue Spalte **Hauptgang** zwischen *Gäste* und *Ernährung*, pro Hauptzeile und pro
  Mitglieds-Unterzeile: Gericht, *Kindermenü*, *Isst nicht mit*, oder in Gelb
  **fehlt**. Die Spalte gehört in die Liste der Spalten, die bei Platzmangel
  wegfallen (`columnWidths`), hinter *Nachricht*.
- Neue **Statistikkarte „Hauptgang“**: *Rind 24 · Lachs 18 · Risotto 9 · Kinder 4 ·
  offen 7*; „offen“ ist ein Link auf den Filter.
- Neuer **Filter „🍽 Menü fehlt“** in der Gästeliste (`GuestFilter`): Haushalte mit
  Zusage, in denen mindestens eine mitkommende Person offen ist. Zusammen mit dem
  bestehenden CSV-Export ist das die Nachfass-Liste (Abschnitt 10).
- Der **Gästeliste-Editor** (`DietaryPills`) zeigt pro Person zwei Pill-Reihen:
  oben die Einzelauswahl (Gerichte, Kindermenü, Isst nicht mit; eine gedrückt,
  dunkel), unten die Hinweise wie heute. So trägt ihr eine telefonische Antwort in
  zehn Sekunden nach. Die Paar-Karte (`kind = 'couple'`) nutzt dieselbe Komponente.
- **Dienstleister** (`VendorsTab`): bekommen dieselbe Einzelauswahl, optional. Ein
  Dienstleister ohne Wahl zählt als *ohne Wahl*, nie als *fehlt*; der Filter meint
  Gäste.

**Dashboard**: kein Pflichtteil. Wenn, dann eine Zeile unter den RSVP-Zahlen
(*„7 Personen ohne Menüwahl“*, Link auf den Filter).

## 8. Küchenexport

Alles in `src/lib/seatingExport.ts` und `SeatingExportSheet.tsx`, von `check:seating`
abgedeckt. `SeatingExportData` bekommt `menu: MenuOption[]` mit (die Export-Route
liest die Config), `ExportPerson` und `ExportVendor` bekommen `meal: string | null`.

- **„Für die Küche“** wird zwei Reihen Kacheln: oben **Hauptgang** (Mahlzeiten als
  Leitzahl, dann je Gericht, Kindermenü, *Ohne Wahl*), unten **Hinweise** (die fünf
  Hinweise, Isst nicht mit). Die Dienstleister-Reihe bekommt dieselben Spalten wie
  bisher, damit es untereinander lesbar bleibt.
- **Tischzeile** (`tallyParts`): *„8 besetzt von 8 · 4 Rinderfilet · 2 Lachsfilet ·
  1 Pilzrisotto · 1 Kindermenü · 1 glutenfrei“*. Gerichte zuerst, dann Hinweise;
  Nullen werden weiterhin weggelassen.
- **`NO_RESTRICTION_LABEL` („Hähnchen“) hört auf, eine Konstante zu sein.** Mit
  eingeschalteter Menüwahl heißt die letzte Kachel *Ohne Wahl* und zählt die
  Offenen. Mit ausgeschalteter Menüwahl bleibt alles beim Alten, inklusive
  „Hähnchen“; die Annahme bleibt dort als Fallback dokumentiert.
- **Tabelle (CSV)**: eine Spalte *Hauptgang* hinter *Rückmeldung*, mit dem Namen
  des Gerichts; *Kindermenü*/*Isst nicht mit* bleiben eigene ja/leer-Spalten, wie
  heute. Eine Pivot-Tabelle über *Hauptgang* ist die Caterer-Bestellung.
- **Export-Dialog**: die Option *Menüwahl* wird aktiv (Standard an), Hinweis
  *„Hauptgang je Person und je Tisch“*. Mit ausgeschalteter Menüwahl bleibt sie
  ausgegraut, mit dem bisherigen Text.

## 9. Benachrichtigungen

Beide Mails aus `/api/rsvp` (SMTP ist optional, konfiguriert über die
Portainer-Variablen):

- **An das Brautpaar** (`NOTIFICATION_EMAIL`, Klartext): pro Person eine Zeile
  *„Julia Weber: Lachsfilet, glutenfrei“*. Heute steht da nur Zusage/Personenzahl.
- **An den Gast** (Bestätigung, HTML): dieselben Zeilen als Beleg, mit
  `escapeHtml` wie der Name.

## 10. Die, die schon geantwortet haben

Das ist der Teil, der kein Code ist, und der Grund, warum SEAT-1 lag. Der Plan:

1. **Deploy.** Nach dem Push ist nichts sichtbar (`enabled: false`).
2. **Menü eintragen** in Einstellungen → Rückmeldungen, mit Beschreibungen und Tags.
   Dann einschalten.
3. **Nachfass-Liste ziehen:** Gästeliste → Filter *Menü fehlt* → *CSV exportieren*.
   Das sind die Haushalte mit Zusage, denen die Wahl fehlt (die Karte *Hauptgang*
   im Rückmeldungen-Tab sagt, wie viele Personen).
4. **Anschreiben** (per Hand, mit eurer Mail): *„Wir haben das Menü, bitte wählt
   unter /rsvp für jede Person ein Gericht; euer Name reicht zum Einloggen.“*
   Wer sich meldet, trägt es selbst ein; wer am Telefon antwortet, bekommt es von
   euch über die Pills im Gästeeditor.
5. **Vor dem Caterer-Termin:** Filter noch einmal ziehen. Wer dann noch offen ist,
   steht im Export als *Ohne Wahl*, und ihr entscheidet (Standardgericht beim
   Caterer nennen, oder nachtelefonieren).

Wer **neu** antwortet, sieht die Frage von Anfang an, kann ohne Wahl nicht senden
und taucht nie in der Liste auf.

## 11. Randfälle

| Fall | Verhalten |
|---|---|
| Menüwahl aus, Gast ändert seine Rückmeldung | Formular schickt kein `meal`, Server behält den gespeicherten Wert |
| Option gelöscht, war gewählt | Person ist *offen*; Haushalt im Filter; `id` bleibt in der Antwort, Wiederanlegen stellt her |
| Option umbenannt | nichts passiert, die `id` bleibt |
| Person wird in der Gästeliste umbenannt | wie heute: `guest-list` PUT schreibt den Namen im Array um, `meal` wandert mit |
| Person sagt ab, hatte gewählt | Eintrag fällt aus dem Array (nur Mitkommende stehen drin, wie heute) |
| Zusage per Gästeliste ohne Formular (`rsvpSync`) | Rückmeldung entsteht ohne Gerichte ⇒ alle offen ⇒ im Filter |
| „Isst nicht mit“ und ein Gericht | nicht möglich; `toggleRestriction` und das Formular halten es exklusiv, `dietCodes()` liefert bei `no_meal` weiterhin nur `NOM` |
| Kindermenü + Nussallergie | erlaubt und sinnvoll |
| Alte Antwort ohne `meal`-Feld | *offen*, nicht *null*: beides zählt gleich, der Unterschied ist nur für die Anzeige („nie gefragt“) |
| Demo-Instanz | `seed:demo` verteilt Gerichte zufällig über die Zusagen und schreibt ein Beispielmenü in `site.json`; die Demo-FAQ erwähnt das Menü heute schon |
| Offline-Modus | kein neuer Pfad, keine neue Seite; `check:offline` bleibt grün |

## 12. Was sich im Code ändert

| Datei | Änderung | Aufwand |
|---|---|---|
| `src/lib/dietary.ts` | `meal` im Typ, Exklusivität, `mealOf`/`mealMissing`/`mealTally`/`setMeal` | S |
| `src/lib/config.ts` | `rsvpMenu` im `SiteConfig`, `MenuOption`-Typ, Default | XS |
| `src/app/api/admin/site-config/route.ts` | Validierung von `rsvpMenu` | S |
| `src/components/RSVPForm.tsx` | Hauptgang-Block, Pflicht, Banner, Beleg; Kindermenü/Isst nicht mit in die Einzelauswahl | M |
| `src/app/api/rsvp/route.ts` | `meal` parsen, prüfen, Merge bei ausgeschaltetem Menü; Mails | S |
| `src/app/api/admin/rsvps/route.ts` | `meal` durchreichen, prüfen | XS |
| `src/components/admin/DietaryPills.tsx` | zweite Pill-Reihe (Einzelauswahl) | S |
| `src/app/admin/settings/page.tsx` | Block Menüwahl mit Optionsliste | M |
| `src/app/admin/rsvps/page.tsx` | Spalte, Statistikkarte, Filter, Editor-Props | M |
| `src/app/admin/rsvps/VendorsTab.tsx` | Einzelauswahl optional | XS |
| `src/lib/seatingExport.ts`, `SeatingExportSheet.tsx`, `SeatingExportModal.tsx`, `api/admin/seating/export/route.ts` | `meal` je Person, Kachelreihe, Tischzeile, CSV-Spalte, Option aktiv | M |
| `src/lib/demoSeed.ts` | Beispielmenü und zufällige Wahl | XS |
| `scripts/verify-seating.mts` | Tally, Exklusivität, offen/gelöscht, CSV-Spalte, Tischzeile | S |

XS = Minuten, S = unter einer Stunde, M = ein Nachmittag. Zusammen ein bis zwei
Tage inklusive Doku; der Export ist die größte Einzelstelle, weil Vorschau und Druck
aus demselben Code kommen und beides geprüft werden muss.

**Tests.** Alle neuen Regeln sind reine Funktionen und kommen in `check:seating`
(läuft in CI, ohne Datenbank). Zusätzlich die bestehenden Checks: `check:types`,
`lint`, `check:changelog`, `check:offline`.

**Doku („document everything“).** README (Abschnitt Rückmeldungen und der
„Hähnchen“-Absatz beim Sitzplan), Wiki (*Seating and the Export*, die Seiten zu
Rückmeldungen/Gästeliste und *Features*), ein `CHANGELOG.md`-Eintrag mit Patch-Bump,
SEAT-1 im Parking Lot durchstreichen, Vault-Eintrag.

**Späterer Ausbau, ohne Umbau:** ein zweiter Gang wird ein `meals: Record<gangId,
optionId>` neben `meal`; die Settings-Liste wird zu Listen pro Gang. Nichts im
Konzept legt sich dagegen fest, aber nichts davon ist jetzt nötig.

## 13. Offene Entscheidungen

Das sind die Punkte, die nicht aus dem Code folgen. Empfehlung jeweils zuerst.

| # | Frage | Empfehlung | Alternative |
|---|---|---|---|
| 1 | **Pflicht oder optional?** | **Pflicht**, solange die Wahl eingeschaltet ist. Der Zweck ist, die Zahl zu haben; ein „weiß ich noch nicht“ ist eine Rückfrage später. | Ein zweiter Schalter *„Wahl ist Pflicht“*; aus = Gäste dürfen ohne senden, die Karte *Hauptgang* zählt die Offenen trotzdem. |
| 2 | **Kindermenü als eigene Option oder als Hinweis lassen?** | **Als Option** in der Einzelauswahl (es entscheidet den Teller). Gespeichert wird es unverändert als `kids_meal`. | Kästchen lassen; dann muss das Formular den Hauptgang bei Kindermenü ausblenden, zwei Stellen für eine Regel. |
| 3 | **Dienstleister wählen mit?** | **Ja, optional.** Dieselbe Komponente, null Mehraufwand, und der Caterer sieht es in derselben Reihe. | Weglassen; Dienstleister-Essen läuft oft über einen eigenen Vertrag. |
| 4 | **Wann einschalten?** | Erst wenn das Menü feststeht, dann einmal nachfassen. | Sofort mit Platzhaltern einschalten; dann wählen die ersten Gäste Gerichte, die sich noch ändern. |
| 5 | **Tags am Gericht?** | **Ja** (vegetarisch/vegan/glutenfrei als Anzeige). Hilft genau den Gästen, die ohnehin einen Hinweis setzen. | Weglassen; Beschreibungstext reicht. |

Steht 1 und 2 fest, ist der Rest Bauarbeit.
