/**
 * What people cannot eat, and where that answer lives.
 *
 * One array per household, on the RSVP (`rsvps.dietary_restrictions`), one entry
 * per attending person, matched to them by name. The RSVP form writes it; the
 * guest list editor now writes it too, for the people who tell the couple in
 * person; the seating export reads it.
 *
 * Pure — no DOM, no network, no database. Covered by `npm run check:seating`.
 */
import { cleanName } from './names';

/** One person's answer, as `rsvps.dietary_restrictions` stores it. */
export interface DietaryEntry {
    name?: string | null;
    vegetarian?: boolean;
    vegan?: boolean;
    gluten_free?: boolean;
    nut_allergy?: boolean;
    other?: boolean;
    /** A child's plate rather than the adult one. A meal, not a restriction. */
    kids_meal?: boolean;
    /** No plate at all — they still take a chair. A baby whose food comes with them. */
    no_meal?: boolean;
    /** The form's own field. `note` is the pre-JSONB migration's name for it. */
    other_text?: string | null;
    note?: string | null;
    /**
     * The dish they chose: the `id` of one of `rsvpMenu.options`. `null` is "not
     * chosen yet"; a missing field is an answer given before the menu existed.
     * Both read as *open* — the difference is only whether they were ever asked.
     */
    meal?: string | null;
}

/**
 * The restrictions — things that change what is *on* a plate.
 *
 * Not the whole list of answers: see `MEAL_CODES` for the two that change
 * whether there is a plate, and what kind.
 */
export const DIET_CODES = ['VEG', 'VGN', 'GF', 'NUT', 'OTH'] as const;

/**
 * Which plate, or none at all.
 *
 * Kept apart from the restrictions because they are counted differently and the
 * difference is the whole point: a restriction modifies a plate, `KID` *is* a
 * different plate, and `NOM` is a chair with no plate against it — the baby
 * whose mother brings their food. A caterer asked for "111 meals" when one of
 * them eats nothing has been told the wrong number.
 */
export const MEAL_CODES = ['KID', 'NOM'] as const;

/** Everything one person's answer can say, in the order it reads best. */
export const ALL_DIET_CODES = [...DIET_CODES, ...MEAL_CODES] as const;

export type RestrictionCode = (typeof DIET_CODES)[number];
export type DietCode = (typeof ALL_DIET_CODES)[number];

export const DIET_LABELS: Record<DietCode, string> = {
    VEG: 'Vegetarisch',
    VGN: 'Vegan',
    GF: 'Glutenfrei',
    NUT: 'Nussallergie',
    OTH: 'Sonstiges',
    KID: 'Kindermenü',
    NOM: 'Isst nicht mit',
};

/** The entry field each code is stored in — the editor toggles these by name. */
export const DIET_FIELDS: Record<DietCode, keyof DietaryEntry> = {
    VEG: 'vegetarian',
    VGN: 'vegan',
    GF: 'gluten_free',
    NUT: 'nut_allergy',
    OTH: 'other',
    KID: 'kids_meal',
    NOM: 'no_meal',
};

/** Is this code one of the two that decide the plate rather than modify it? */
export function isMealCode(code: DietCode): boolean {
    return (MEAL_CODES as readonly string[]).includes(code);
}

/**
 * The codes an answer carries.
 *
 * "Other" counts on the strength of its text as well as its checkbox: an entry
 * migrated from the old free-text column has the words and no boolean, and a
 * caterer reading "no shellfish" does not care which release wrote it.
 */
export function dietCodes(entry: DietaryEntry | null | undefined): DietCode[] {
    if (!entry) return [];
    // Not eating is the whole answer. Restrictions on a plate that is not being
    // served say nothing, and printing "no meal · gluten free" beside a name
    // invites someone to make the gluten-free plate anyway. Enforced here rather
    // than only in the editor, so a row written by an older release — or by
    // hand — still reads sensibly.
    if (entry.no_meal) return ['NOM'];
    const codes: DietCode[] = [];
    if (entry.vegetarian) codes.push('VEG');
    if (entry.vegan) codes.push('VGN');
    if (entry.gluten_free) codes.push('GF');
    if (entry.nut_allergy) codes.push('NUT');
    if (entry.other || dietNote(entry)) codes.push('OTH');
    if (entry.kids_meal) codes.push('KID');
    return codes;
}

/** The free text behind an "other", from either of the two fields that hold it. */
export function dietNote(entry: DietaryEntry | null | undefined): string {
    return (entry?.other_text ?? entry?.note ?? '').trim();
}

/** Nothing reported — worth knowing, because it is not the same as no entry. */
export function isEmptyEntry(entry: DietaryEntry | null | undefined): boolean {
    return dietCodes(entry).length === 0 && typeof entry?.meal !== 'string';
}

/**
 * The entry belonging to one person, by name.
 *
 * Both sides are hand-entered and either can carry a note — the guest list
 * writes a plus-one as "Steve Reesman (Lauren's Boyfriend)" — so the note comes
 * off both before they are compared.
 */
export function entryFor(entries: DietaryEntry[] | null | undefined, name: string): DietaryEntry | null {
    if (!Array.isArray(entries)) return null;
    const wanted = cleanName(name).toLowerCase();
    if (!wanted) return null;
    return entries.find(e => cleanName(e?.name).toLowerCase() === wanted) ?? null;
}

/**
 * The household's answers lined up with the household's people.
 *
 * The editor shows one row per person, so it needs an entry per person in that
 * order, whether or not the RSVP has one for them. An answer whose name matches
 * nobody in the party — someone renamed since they answered — is kept on the end
 * rather than dropped, or saving the form would quietly delete it.
 */
export function alignEntries(people: string[], entries: DietaryEntry[] | null | undefined): DietaryEntry[] {
    const list = Array.isArray(entries) ? entries : [];
    const used = new Set<DietaryEntry>();
    const aligned = people.map(person => {
        const found = entryFor(list, person);
        if (found) used.add(found);
        return { ...(found ?? {}), name: person };
    });
    const orphans = list.filter(e => !used.has(e) && !isEmptyEntry(e));
    return [...aligned, ...orphans];
}

/**
 * The array to store back, from the rows the editor holds.
 *
 * Only the people who are coming, because that is what the array means
 * everywhere else: `database/init.sql` recovers each person's own RSVP answer
 * from *being listed here*, and the export counts plates from it. An unnamed
 * slot cannot be matched to anybody, so it is left out rather than stored under
 * a placeholder.
 */
export function entriesToStore(
    rows: { entry: DietaryEntry; name: string; attending?: boolean | null }[],
): DietaryEntry[] {
    return rows
        .filter(row => row.attending !== false && cleanName(row.name) !== '')
        .map(row => ({
            name: cleanName(row.name),
            vegetarian: !!row.entry.vegetarian,
            vegan: !!row.entry.vegan,
            gluten_free: !!row.entry.gluten_free,
            nut_allergy: !!row.entry.nut_allergy,
            other: !!row.entry.other,
            kids_meal: !!row.entry.kids_meal,
            no_meal: !!row.entry.no_meal,
            other_text: row.entry.other ? dietNote(row.entry) : '',
            // Carried as stored, even while the menu is switched off: the editor
            // then shows no dish, but a save must not wipe the one on file.
            meal: typeof row.entry.meal === 'string' ? row.entry.meal : null,
        }));
}

/** Is this restriction set on this answer? */
export function isOn(entry: DietaryEntry | null | undefined, code: DietCode): boolean {
    return dietCodes(entry).includes(code);
}

/**
 * Turn one restriction on or off.
 *
 * Switching "other" off clears its text as well — a note left behind would keep
 * the restriction on, because `dietCodes` counts the words as the answer.
 */
export function toggleRestriction(entry: DietaryEntry, code: DietCode): DietaryEntry {
    // "Not eating" and everything else are mutually exclusive, in both
    // directions: turning it on clears the rest, and answering anything else
    // turns it off. Otherwise a form can hold "not eating, vegetarian" and
    // whoever reads the sheet has to decide which of the two the kitchen meant.
    if (code === 'NOM') {
        if (entry.no_meal) return { ...entry, no_meal: false };
        return { name: entry.name, no_meal: true, other_text: '', note: null };
    }

    const next: DietaryEntry = { ...entry, no_meal: false };
    switch (code) {
        case 'VEG': next.vegetarian = !next.vegetarian; break;
        case 'VGN': next.vegan = !next.vegan; break;
        case 'GF': next.gluten_free = !next.gluten_free; break;
        case 'NUT': next.nut_allergy = !next.nut_allergy; break;
        // A kids' plate *is* the plate, so choosing it un-chooses the dish.
        case 'KID': next.kids_meal = !next.kids_meal; if (next.kids_meal) next.meal = null; break;
        case 'OTH':
            next.other = !isOn(entry, 'OTH');
            if (!next.other) { next.other_text = ''; next.note = null; }
            break;
    }
    return next;
}

/** The note behind "other", replaced. The legacy field is cleared with it. */
export function setNote(entry: DietaryEntry, text: string): DietaryEntry {
    return { ...entry, other: true, other_text: text, note: null };
}

/**
 * What a set of answers amounts to, for telling whether anything changed.
 *
 * Compares what is *recorded* — the person, their restrictions, their note —
 * and not how it is stored, so an answer written by the RSVP form and the same
 * answer written by the editor come out identical.
 */
export function signature(entries: DietaryEntry[] | null | undefined): string {
    const list = Array.isArray(entries) ? entries : [];
    return JSON.stringify(
        list
            .filter(e => !isEmptyEntry(e))
            .map(e => [cleanName(e?.name).toLowerCase(), dietCodes(e).join('+'), dietNote(e), typeof e?.meal === 'string' ? e.meal : ''])
            .sort((a, b) => a[0].localeCompare(b[0])),
    );
}

/* ------------------------------------------------------------------------- */
/* The menu: which plate, chosen from the dishes the couple offers.            */
/*                                                                             */
/* The restrictions above say what must not be on a plate; this says which     */
/* plate. The couple names the dishes in Settings (`site.json`, `rsvpMenu`),   */
/* every attending guest picks one on the RSVP form, and the answer is stored  */
/* beside the restrictions as `meal`. Kids' meal and not eating are the two    */
/* answers to the same question that are not a dish, which is why the form     */
/* offers them in the same single-choice group.                                */
/* ------------------------------------------------------------------------- */

/** The restrictions a dish can be said to suit. Tags on the form; never enforced. */
export const MENU_TAGS = ['vegetarian', 'vegan', 'gluten_free'] as const;
export type MenuTag = (typeof MENU_TAGS)[number];

export const MENU_TAG_LABELS: Record<MenuTag, string> = {
    vegetarian: 'vegetarisch',
    vegan: 'vegan',
    gluten_free: 'glutenfrei',
};

export interface MenuOption {
    /**
     * What an answer stores. Slug-shaped, made once from the first name the
     * dish had, never shown and never changed — so renaming "Lachs" to
     * "Lachsfilet auf Blattspinat" loses nobody's answer.
     */
    id: string;
    label: string;
    description?: string;
    diet?: MenuTag[];
}

export interface RsvpMenu {
    /** Off: the form asks nothing, nothing shows a dish, and stored answers are kept. */
    enabled: boolean;
    /** The block's heading on the form; `DEFAULT_MENU_TITLE` when empty. */
    title?: string;
    /** A sentence above the dishes: "Vorspeise und Dessert sind für alle gleich." */
    hint?: string;
    options: MenuOption[];
}

export const DEFAULT_MENU_TITLE = 'Hauptgang';
export const MAX_MENU_OPTIONS = 8;
export const MAX_MENU_LABEL = 60;
export const MAX_MENU_DESCRIPTION = 160;
export const EMPTY_MENU: RsvpMenu = { enabled: false, options: [] };

const MENU_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * The menu as `site.json` holds it, checked — or a sentence saying what is wrong.
 *
 * Shared by the settings editor (which refuses to save what would be refused)
 * and the config route (which refuses it anyway, because the editor is not the
 * only possible caller). Nothing stored is a menu, and `enabled` is never
 * guessed: a missing block is a menu that is off.
 */
export function parseMenu(raw: unknown): RsvpMenu | string {
    if (raw === undefined || raw === null) return { ...EMPTY_MENU, options: [] };
    if (typeof raw !== 'object' || Array.isArray(raw)) return 'Das Menü muss ein Objekt sein';
    const r = raw as Record<string, unknown>;
    if (r.enabled !== undefined && typeof r.enabled !== 'boolean') return '„enabled“ muss wahr oder falsch sein';
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (title.length > 40) return 'Die Überschrift darf höchstens 40 Zeichen haben';
    const hint = typeof r.hint === 'string' ? r.hint.trim() : '';
    if (hint.length > 300) return 'Der Hinweis darf höchstens 300 Zeichen haben';
    if (r.options !== undefined && !Array.isArray(r.options)) return 'Die Gerichte müssen eine Liste sein';
    const list = Array.isArray(r.options) ? r.options : [];
    if (list.length > MAX_MENU_OPTIONS) return `Höchstens ${MAX_MENU_OPTIONS} Gerichte`;

    const seen = new Set<string>();
    const options: MenuOption[] = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') return 'Ein Gericht ist kein Objekt';
        const o = item as Record<string, unknown>;
        const id = typeof o.id === 'string' ? o.id.trim() : '';
        if (!MENU_ID.test(id)) return 'Ein Gericht hat keine gültige Kennung';
        if (seen.has(id)) return 'Zwei Gerichte haben dieselbe Kennung';
        seen.add(id);
        const label = typeof o.label === 'string' ? o.label.trim() : '';
        if (!label || label.length > MAX_MENU_LABEL) {
            return `Jedes Gericht braucht einen Namen (höchstens ${MAX_MENU_LABEL} Zeichen)`;
        }
        const description = typeof o.description === 'string' ? o.description.trim() : '';
        if (description.length > MAX_MENU_DESCRIPTION) {
            return `Die Beschreibung darf höchstens ${MAX_MENU_DESCRIPTION} Zeichen haben`;
        }
        const diet = Array.isArray(o.diet)
            ? (o.diet.filter((t): t is MenuTag => (MENU_TAGS as readonly string[]).includes(t as string)))
            : [];
        options.push({
            id,
            label,
            ...(description ? { description } : {}),
            ...(diet.length ? { diet: [...new Set(diet)] } : {}),
        });
    }
    return {
        enabled: r.enabled === true,
        ...(title ? { title } : {}),
        ...(hint ? { hint } : {}),
        options,
    };
}

/** The menu out of a site config, tolerant of whatever the file holds. */
export function menuOf(config: { rsvpMenu?: unknown } | null | undefined): RsvpMenu {
    const parsed = parseMenu(config?.rsvpMenu);
    return typeof parsed === 'string' ? { ...EMPTY_MENU, options: [] } : parsed;
}

/** Is the question being asked? On, with at least one dish to choose. */
export function menuActive(menu: RsvpMenu | null | undefined): boolean {
    return !!menu && menu.enabled === true && menu.options.length > 0;
}

export function menuOption(menu: RsvpMenu | null | undefined, id: string | null | undefined): MenuOption | null {
    if (!menu || !id) return null;
    return menu.options.find(o => o.id === id) ?? null;
}

export function menuTitle(menu: RsvpMenu | null | undefined): string {
    return (menu?.title ?? '').trim() || DEFAULT_MENU_TITLE;
}

/**
 * A stable id for a new dish, from its name: "Lachsfilet auf Spinat" →
 * `lachsfilet-auf-spinat`. Umlauts are spelled out rather than dropped, so
 * "Käse" and "Kase" do not collide; a name that leaves nothing becomes
 * `gericht`; a clash with an existing id gets a number.
 */
export function slugFor(label: string, taken: Iterable<string> = []): string {
    const base = label
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 36)
        .replace(/-+$/g, '') || 'gericht';
    const used = new Set(taken);
    if (!used.has(base)) return base;
    for (let n = 2; ; n += 1) {
        const candidate = `${base}-${n}`;
        if (!used.has(candidate)) return candidate;
    }
}

/**
 * Which plate one person asked for: a dish's id, `'KID'`, `'NOM'` — or null,
 * meaning the question is *open*: never answered, or answered with a dish that
 * has since been taken off the menu. Not eating wins over everything, the
 * kids' plate over a dish, the same order `dietCodes()` keeps.
 */
export function mealCode(entry: DietaryEntry | null | undefined, menu: RsvpMenu | null | undefined): string | null {
    if (!entry) return null;
    if (entry.no_meal) return 'NOM';
    if (entry.kids_meal) return 'KID';
    const id = typeof entry.meal === 'string' ? entry.meal : null;
    return id && menuActive(menu) && menuOption(menu, id) ? id : null;
}

/**
 * One person's whole answer, as words: the plate first, then the restrictions,
 * with the free text standing in for "Sonstiges". What the confirmation mail,
 * the form's receipt and the admin's table all print, so they cannot disagree.
 */
export function answerParts(entry: DietaryEntry | null | undefined, menu: RsvpMenu | null | undefined): string[] {
    const parts: string[] = [];
    const meal = mealLabel(entry, menu);
    if (meal) parts.push(meal);
    for (const code of dietCodes(entry)) {
        if (isMealCode(code)) continue; // already said by the plate
        parts.push(code === 'OTH' ? (dietNote(entry) || DIET_LABELS.OTH) : DIET_LABELS[code]);
    }
    return parts;
}

/** The plate, as words: the dish's name, "Kindermenü", "Isst nicht mit", or null while open. */
export function mealLabel(entry: DietaryEntry | null | undefined, menu: RsvpMenu | null | undefined): string | null {
    const code = mealCode(entry, menu);
    if (code === 'NOM') return DIET_LABELS.NOM;
    if (code === 'KID') return DIET_LABELS.KID;
    return code ? (menuOption(menu, code)?.label ?? null) : null;
}

/**
 * Is this person's plate still to be chosen?
 *
 * Only ever true while the menu is being asked — with it off, nobody is missing
 * anything. Callers decide who is *attending*; a person who declined has no
 * plate to choose.
 */
export function mealMissing(entry: DietaryEntry | null | undefined, menu: RsvpMenu | null | undefined): boolean {
    return menuActive(menu) && mealCode(entry, menu) === null;
}

/**
 * Answer the plate question. One answer at a time, as the form's radio group
 * holds it: a dish clears the two plate codes, a plate code clears the dish,
 * and not eating clears the restrictions too (nothing on a plate that is not
 * served). `null` clears the whole answer.
 */
export function setMeal(entry: DietaryEntry, choice: string | null): DietaryEntry {
    if (choice === 'NOM') return { name: entry.name, no_meal: true, kids_meal: false, meal: null, other_text: '', note: null };
    if (choice === 'KID') return { ...entry, no_meal: false, kids_meal: true, meal: null };
    return { ...entry, no_meal: false, kids_meal: false, meal: choice };
}

/**
 * Keep the dishes of the previous save where the new one says nothing about
 * them. The form leaves `meal` out entirely while the menu is switched off, so
 * a guest editing their email during that window must not lose the dish they
 * chose; an explicit `null` is a real answer and stays null.
 */
export function carryMeals(next: DietaryEntry[], previous: DietaryEntry[] | null | undefined): DietaryEntry[] {
    return next.map(entry => {
        if (entry.meal !== undefined) return entry;
        const before = entryFor(previous, entry.name ?? '');
        return { ...entry, meal: typeof before?.meal === 'string' ? before.meal : null };
    });
}

/**
 * The dietary array as a request may send it, reduced to what is stored.
 *
 * Every field is typed on the way in, so a hand-built request cannot write a
 * string where a boolean goes or a dish nobody offers. While the menu is being
 * asked, a dish has to be one on it; while it is off, whatever id is there is
 * kept as is (nothing reads it, and dropping it would be the one way to lose an
 * answer). `meal` left out stays left out, for `carryMeals` to fill.
 */
export function sanitiseEntries(raw: unknown, menu: RsvpMenu | null | undefined): DietaryEntry[] | string {
    if (!Array.isArray(raw)) return [];
    const out: DietaryEntry[] = [];
    for (const item of raw.slice(0, 50)) {
        if (!item || typeof item !== 'object') continue;
        const e = item as Record<string, unknown>;
        const entry: DietaryEntry = {
            name: typeof e.name === 'string' ? e.name.slice(0, 255) : null,
            vegetarian: e.vegetarian === true,
            vegan: e.vegan === true,
            gluten_free: e.gluten_free === true,
            nut_allergy: e.nut_allergy === true,
            other: e.other === true,
            kids_meal: e.kids_meal === true,
            no_meal: e.no_meal === true,
            other_text: typeof e.other_text === 'string' ? e.other_text.slice(0, 500) : '',
        };
        if (typeof e.note === 'string' && e.note.trim()) entry.note = e.note.slice(0, 500);
        if (e.meal === null) {
            entry.meal = null;
        } else if (typeof e.meal === 'string') {
            const id = e.meal.trim().slice(0, 64);
            if (menuActive(menu) && !menuOption(menu, id)) return 'Ungültige Menüwahl';
            entry.meal = id || null;
        }
        // The exclusivity, enforced at the boundary as well as in the editors.
        if (entry.no_meal) {
            entry.kids_meal = false;
            entry.meal = null;
            entry.vegetarian = entry.vegan = entry.gluten_free = entry.nut_allergy = entry.other = false;
            entry.other_text = '';
            delete entry.note;
        } else if (entry.kids_meal) {
            entry.meal = null;
        }
        out.push(entry);
    }
    return out;
}
