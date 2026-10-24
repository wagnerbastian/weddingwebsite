'use client';

import {
    ALL_DIET_CODES, DIET_CODES, DIET_DISPLAY_CODES, DIET_LABELS, NO_RESTRICTION_LABEL, OPEN_MEAL_LABEL,
    alphabetical, freeSeats, grandTotal, mealLabelFor, mealTally, mealTallyChips, mealTallyParts, mealsOn,
    seatedPeople, sortedVendors, tableTypeLabel, tally, tallyChips, tallyParts, vendorMeals,
    type DietCode, type ExportOptions, type ExportPerson, type ExportTable, type ExportVendor,
    type RsvpMenu, type SeatingExportData,
} from '@/lib/seatingExport';
import { isMealCode, menuTitle } from '@/lib/dietary';
import { sideLabel } from '@/lib/seating';

/**
 * The seating chart as a sheet of paper.
 *
 * One component, drawn twice: shrunk inside the export dialog as the preview,
 * and full size portalled to `<body>` as the thing that actually prints. That is
 * the whole point — a preview rendered by different code from the printout is a
 * preview you cannot trust, and the reason to look before printing 30 pages is
 * to trust it.
 *
 * No colour is load-bearing: restrictions are letter codes with a legend, so the
 * sheet survives the black-and-white printer at a venue.
 */

const CODE_CLASS: Record<DietCode, string> = {
    VEG: 'text-green-700 border-green-700',
    VGN: 'text-teal-700 border-teal-700',
    GF: 'text-amber-700 border-amber-700',
    NUT: 'text-red-700 border-red-700',
    OTH: 'text-slate-600 border-slate-600',
    KID: 'text-blue-700 border-blue-700',
    // Filled rather than outlined: "no plate here" is the one mark a kitchen
    // must not skim past, and it has to survive a black-and-white printer.
    NOM: 'text-white bg-slate-700 border-slate-700',
};

function Chip({ code }: { code: DietCode }) {
    return (
        <span
            className={`inline-block px-1 rounded border text-[9px] font-mono leading-4 tracking-wide ${CODE_CLASS[code]}`}
            title={DIET_LABELS[code]}
        >
            {DIET_DISPLAY_CODES[code]}
        </span>
    );
}

/** A person's — or a vendor's — restrictions, as chips. A dash is the chicken. */
function Diet({ diet }: { diet: DietCode[] }) {
    if (diet.length === 0) return <span className="text-gray-300">—</span>;
    return (
        <span className="inline-flex gap-1 flex-wrap justify-end">
            {diet.map(code => <Chip key={code} code={code} />)}
        </span>
    );
}

/** The plate, as the roster prints it: the dish, or that it is still to be chosen. */
function Meal({ person, menu }: { person: { meal: string | null; diet: DietCode[] }; menu: RsvpMenu }) {
    const label = mealLabelFor(person, menu);
    return label
        ? <span className="text-gray-800">{label}</span>
        : <span className="text-[10px] uppercase tracking-wide text-amber-700">offen</span>;
}

function TallyLine({ people, seatCount, compact = false, lead, menu = null }: {
    people: { diet: DietCode[]; meal: string | null }[];
    seatCount?: number | null;
    compact?: boolean;
    /** What the leading number counts. "seated" unless told otherwise. */
    lead?: string;
    /** The dishes, when the line is to count plates as well as restrictions. */
    menu?: RsvpMenu | null;
}) {
    const t = tally(people);
    const m = menu ? mealTally(people, menu) : null;

    // Counts only: the codes are drawn as the very chips the legend defines, so
    // the green box beside "3" and the green box in the legend are visibly the
    // same mark. Spelled in plain grey text they were not. A dish has no code,
    // so it is its name.
    if (compact) {
        const chips = menu && m ? mealTallyChips(t, m, menu) : tallyChips(t);
        return (
            <p className="mt-1 px-2 py-1 bg-gray-50 rounded text-[11px] text-gray-700 flex flex-wrap items-center gap-x-2.5 gap-y-1 tabular-nums">
                {chips.map(({ code, count, label }) => (
                    <span key={code ?? label ?? 'none'} className="inline-flex items-center gap-1">
                        <span className={code || (label && label !== OPEN_MEAL_LABEL) ? 'font-semibold text-gray-900' : 'text-gray-400'}>{count}</span>
                        {code
                            ? <Chip code={code} />
                            : <span className={label && label !== OPEN_MEAL_LABEL ? 'text-gray-700' : 'text-gray-400'}>{label ?? NO_RESTRICTION_LABEL}</span>}
                    </span>
                ))}
            </p>
        );
    }

    const parts = menu && m
        ? mealTallyParts(t, m, menu, seatCount ?? null, lead)
        : tallyParts(t, seatCount ?? null, lead);
    return (
        <p className="mt-1.5 px-3 py-1.5 gap-x-4 bg-gray-50 rounded text-[11px] text-gray-700 flex flex-wrap gap-y-0.5 tabular-nums">
            {parts.map((part, i) => {
                const [n, ...rest] = part.split(' ');
                const last = i === parts.length - 1;
                return (
                    <span key={part} className={last ? 'text-gray-400' : undefined}>
                        <span className={last ? undefined : 'font-semibold text-gray-900'}>{n}</span>
                        {' '}{rest.join(' ')}
                    </span>
                );
            })}
        </p>
    );
}

function Roster({ people, options, withSeat, menu = null }: {
    people: ExportPerson[];
    options: ExportOptions;
    withSeat: boolean;
    /** A column for the dish, when there is a menu to name one from. */
    menu?: RsvpMenu | null;
}) {
    return (
        <table className="w-full mt-2 text-[11.5px] border-collapse">
            <thead>
                <tr className="text-[9px] uppercase tracking-widest text-gray-400">
                    {withSeat && <th className="text-left font-semibold pb-1 pr-2 w-9">Platz</th>}
                    <th className="text-left font-semibold pb-1 pr-2">Name</th>
                    {!withSeat && <th className="text-left font-semibold pb-1 pr-2">Tisch</th>}
                    {options.household && <th className="text-left font-semibold pb-1 pr-2">Gruppe</th>}
                    {options.side && <th className="text-left font-semibold pb-1 pr-2">Seite</th>}
                    {menu && <th className="text-left font-semibold pb-1 pr-2">{menuTitle(menu)}</th>}
                    <th className="text-right font-semibold pb-1">Ernährung</th>
                </tr>
            </thead>
            <tbody>
                {people.map((person, i) => (
                    <tr key={`${person.table_name}-${person.seat}-${person.name}-${i}`} className="border-t border-gray-100 align-top">
                        {withSeat && <td className="py-1 pr-2 font-mono text-gray-400 tabular-nums">{person.seat ?? '—'}</td>}
                        <td className="py-1 pr-2 font-medium text-gray-900">
                            {person.name}
                            {person.rsvp_status === 'declined' && (
                                <span className="ml-1.5 text-[9px] uppercase tracking-wide text-red-700">kommt nicht</span>
                            )}
                            {person.note && <span className="block text-[10px] italic text-gray-500">{person.note}</span>}
                        </td>
                        {!withSeat && (
                            <td className="py-1 pr-2 text-gray-500">
                                {person.table_name ?? 'Ohne Platz'}
                                {person.seat !== null && <span className="text-gray-400"> · {person.seat}</span>}
                            </td>
                        )}
                        {options.household && <td className="py-1 pr-2 text-gray-500">{person.household}</td>}
                        {options.side && <td className="py-1 pr-2 text-gray-500">{person.side ? sideLabel(person.side) : '—'}</td>}
                        {/* With the plate in its own column, the two plate codes are
                            said there in words and are not chips as well. */}
                        {menu && <td className="py-1 pr-2 whitespace-nowrap"><Meal person={person} menu={menu} /></td>}
                        <td className="py-1 text-right whitespace-nowrap">
                            <Diet diet={menu ? person.diet.filter(code => !isMealCode(code)) : person.diet} />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function TableBlock({ table, options, compact = false, menu = null }: {
    table: ExportTable;
    options: ExportOptions;
    /** The two-column counts sheet, where every line has to earn its width. */
    compact?: boolean;
    menu?: RsvpMenu | null;
}) {
    const free = freeSeats(table);
    // Counts only is a heading and one line of numbers, so it does not need the
    // breathing room a roster does — and the point of that mode is fitting.
    const spacing = compact ? 'mb-3' : options.detail === 'counts' ? 'mb-4' : 'mb-7';
    return (
        <section className={`${spacing} break-inside-avoid ${options.pageBreak ? 'break-after-page last:break-after-auto' : ''}`}>
            <div className="flex items-baseline gap-2 border-b border-gray-300 pb-1">
                <h3 className="font-serif text-base font-semibold text-gray-900">{table.name}</h3>
                <span className="text-[10px] uppercase tracking-widest text-gray-400">{tableTypeLabel(table.table_type)}</span>
                <span className="ml-auto font-mono text-[11px] text-gray-500 tabular-nums">
                    {table.people.length}/{table.seat_count}
                </span>
            </div>
            {options.detail !== 'names' && (
                <TallyLine people={table.people} seatCount={table.seat_count} compact={compact} menu={menu} />
            )}
            {options.detail !== 'counts' && table.people.length > 0 && (
                <Roster people={table.people} options={options} withSeat menu={menu} />
            )}
            {table.people.length === 0 && <p className="mt-2 text-[11px] italic text-gray-400">Hier sitzt noch niemand.</p>}
            {options.empty && free > 0 && (
                <p className="mt-1.5 text-[11px] text-gray-400">{free} {free === 1 ? 'freier Platz' : 'freie Plätze'}</p>
            )}
        </section>
    );
}

function Tile({ label, value, lead = false, warn = false }: { label: string; value: number; lead?: boolean; warn?: boolean }) {
    return (
        <div className="bg-white px-3 py-2">
            <div className="text-[9px] text-gray-500 leading-tight">{label}</div>
            <div
                className={`font-serif text-xl font-semibold tabular-nums ${warn && value > 0 ? 'text-amber-700' : ''}`}
                style={lead ? { color: 'var(--accent)' } : undefined}
            >
                {value}
            </div>
        </div>
    );
}

/**
 * The kitchen numbers with a menu on: two rows, the plates and then the
 * restrictions, because they are two different questions — "how many of each
 * dish" is the order, "how many of those without nuts" is the note on it.
 *
 * Column counts come from the menu, so they are set inline rather than as a
 * breakpoint class the build would have to know in advance.
 */
function MealTiles({ people, menu, lead, notEating }: {
    people: { meal: string | null; diet: DietCode[] }[];
    menu: RsvpMenu;
    /** What the leading tile counts and says. */
    lead: { label: string; value: number };
    /** The not-eating tile, when it is not this group's own tally (a vendor's contract). */
    notEating?: number;
}) {
    const t = tally(people);
    const m = mealTally(people, menu);
    const GRID = 'grid gap-px bg-gray-200 border border-gray-200 rounded overflow-hidden';
    const ROW_LABEL = 'text-[8px] uppercase tracking-widest text-gray-400 mb-1';
    const columns = (n: number) => ({ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` });
    return (
        <>
            <p className={ROW_LABEL}>{menuTitle(menu)}</p>
            <div className={GRID} style={columns(3 + menu.options.length)}>
                <Tile label={lead.label} value={lead.value} lead />
                {menu.options.map(option => (
                    <Tile key={option.id} label={option.label} value={m.dishes[option.id] ?? 0} />
                ))}
                <Tile label={DIET_LABELS.KID} value={m.KID} />
                <Tile label={OPEN_MEAL_LABEL} value={m.open} warn />
            </div>
            <p className={`${ROW_LABEL} mt-2`}>Hinweise</p>
            <div className={GRID} style={columns(DIET_CODES.length + 1)}>
                {DIET_CODES.map(code => <Tile key={code} label={DIET_LABELS[code]} value={t[code]} />)}
                <Tile label={DIET_LABELS.NOM} value={notEating ?? t.NOM} />
            </div>
        </>
    );
}

/**
 * The whole-wedding numbers, on page one.
 *
 * Guests and vendors are counted apart, because a vendor meal is usually its own
 * line on its own contract and often its own (cheaper) plate — so totalling them
 * silently would hand a caterer a number that is wrong for both. The grand total
 * sits underneath so that nobody has to add the two tiles up by hand either.
 */
function Kitchen({ people, vendors, showVendors, menu = null }: {
    people: ExportPerson[];
    vendors: ExportVendor[];
    showVendors: boolean;
    /** The dishes: two rows of tiles per group instead of one. */
    menu?: RsvpMenu | null;
}) {
    const t = tally(people);
    const fed = vendorMeals(vendors);
    const vt = tally(fed);
    const withVendors = showVendors && vendors.length > 0;
    const unfed = vendors.length - fed.length;
    const GRID = 'grid grid-cols-3 sm:grid-cols-9 gap-px bg-gray-200 border border-gray-200 rounded overflow-hidden';
    const ROW_LABEL = 'text-[9px] uppercase tracking-widest text-gray-400 mb-1.5';
    return (
        <section className="mb-6 break-inside-avoid">
            <h3 className="text-[9px] uppercase tracking-widest text-gray-400 mb-2">Für die Küche</h3>
            {withVendors && <p className={ROW_LABEL}>Gäste</p>}
            {/* Plates, not the headcount: it is the number a caterer is being
                asked for, and once anybody is marked "not eating" the two stop
                being the same. The chairs are not a kitchen number — each table
                heading already carries them — so the gap is explained by the
                *Not eating* tile and the total line rather than by a tile that
                would read 0 for every vendor. */}
            {menu ? (
                <MealTiles people={people} menu={menu} lead={{ label: 'Mahlzeiten', value: t.plates }} />
            ) : (
                <div className={GRID}>
                    <Tile label="Mahlzeiten" value={t.plates} lead />
                    {ALL_DIET_CODES.map(code => <Tile key={code} label={DIET_LABELS[code]} value={t[code]} />)}
                    <Tile label={NO_RESTRICTION_LABEL} value={t.none} />
                </div>
            )}
            {withVendors && (
                <>
                    {/* The same columns as the guests above, so the two rows read
                        straight down: a caterer comparing "how many vegetarian"
                        across them is looking at one column, not hunting two
                        differently-shaped summaries. A vendor's "not eating" is
                        their contract (`needs_meal`), not a dietary answer, so
                        that tile is counted from the vendors rather than from
                        their tally. */}
                    <p className={`${ROW_LABEL} mt-3`}>Dienstleister</p>
                    {menu ? (
                        <MealTiles people={fed} menu={menu} lead={{ label: 'Mahlzeiten', value: fed.length }} notEating={unfed} />
                    ) : (
                        <div className={GRID}>
                            <Tile label="Mahlzeiten" value={fed.length} lead />
                            {ALL_DIET_CODES.map(code => (
                                <Tile
                                    key={code}
                                    label={DIET_LABELS[code]}
                                    value={code === 'NOM' ? unfed : vt[code]}
                                />
                            ))}
                            <Tile label={NO_RESTRICTION_LABEL} value={vt.none} />
                        </div>
                    )}
                    <p className="mt-2 text-[10px] text-gray-500 tabular-nums">
                        <span className="font-semibold text-gray-800">
                            {grandTotal(people, vendors)} Mahlzeiten insgesamt
                        </span>
                        {' – '}{t.plates} {t.plates === 1 ? 'Gast' : 'Gäste'}
                        {' und '}{fed.length} {fed.length === 1 ? 'Dienstleister' : 'Dienstleister'}
                        {(t.NOM > 0 || unfed > 0) && (
                            <span className="text-gray-400">
                                {' '}(isst nicht mit: {[
                                    t.NOM > 0 ? `${t.NOM} ${t.NOM === 1 ? 'Gast' : 'Gäste'}` : null,
                                    unfed > 0 ? `${unfed} Dienstleister` : null,
                                ].filter(Boolean).join(', ')})
                            </span>
                        )}
                    </p>
                </>
            )}
            {!withVendors && t.NOM > 0 && (
                <p className="mt-2 text-[10px] text-gray-500 tabular-nums">
                    <span className="font-semibold text-gray-800">{t.plates} Mahlzeiten</span>
                    {' – '}{t.NOM} von {t.total} {t.NOM === 1 ? 'Sitzplatz isst' : 'Sitzplätzen essen'} nicht mit
                </p>
            )}
        </section>
    );
}

/**
 * The vendors, as their own block at the end of the sheet.
 *
 * Deliberately not folded into a table roster: a vendor has no chair, and the
 * question this block answers is the planner's — who is in the building, and
 * which of them is being fed. A vendor whose contract has no meal in it is still
 * listed, greyed, because "the DJ is not eating" is exactly the thing somebody
 * asks at six o'clock.
 */
function Vendors({ vendors, compact = false, menu = null }: {
    vendors: ExportVendor[];
    /** Counts only: the tally, and the names of whoever is *not* being fed. */
    compact?: boolean;
    menu?: RsvpMenu | null;
}) {
    const list = sortedVendors(vendors);
    const fed = vendorMeals(list);
    const unfed = list.filter(v => !v.needs_meal);

    // Counts only suppresses guest names, so printing a full vendor roster in
    // the same document would be the sheet disagreeing with itself — and it is
    // the single tallest block on a page that is meant to be one page. What
    // survives is the part a count cannot carry: who is *not* getting a plate.
    if (compact) {
        return (
            <section className="mb-4 break-inside-avoid">
                <div className="flex items-baseline gap-2 border-b border-gray-300 pb-1">
                    <h3 className="font-serif text-base font-semibold text-gray-900">Dienstleister</h3>
                    <span className="text-[10px] uppercase tracking-widest text-gray-400">ohne Platz</span>
                    <span className="ml-auto font-mono text-[11px] text-gray-500 tabular-nums">
                        {fed.length}/{list.length} essen mit
                    </span>
                </div>
                {fed.length > 0 && <TallyLine people={fed} compact menu={menu} />}
                {unfed.length > 0 && (
                    <p className="mt-1 text-[10px] text-gray-500">
                        Ohne Mahlzeit: {unfed.map(v => v.name).join(', ')}
                    </p>
                )}
            </section>
        );
    }

    return (
        <section className="mb-7 break-inside-avoid">
            <div className="flex items-baseline gap-2 border-b border-gray-300 pb-1">
                <h3 className="font-serif text-base font-semibold text-gray-900">Dienstleister</h3>
                <span className="text-[10px] uppercase tracking-widest text-gray-400">ohne Platz</span>
                <span className="ml-auto font-mono text-[11px] text-gray-500 tabular-nums">
                    {fed.length}/{list.length} essen mit
                </span>
            </div>
            {fed.length > 0 && <TallyLine people={fed} lead="Mahlzeiten" menu={menu} />}
            {list.length === 0 ? (
                <p className="mt-2 text-[11px] italic text-gray-400">Noch keine Dienstleister angelegt.</p>
            ) : (
                <table className="w-full mt-2 text-[11.5px] border-collapse">
                    <thead>
                        <tr className="text-[9px] uppercase tracking-widest text-gray-400">
                            <th className="text-left font-semibold pb-1 pr-2">Rolle</th>
                            <th className="text-left font-semibold pb-1 pr-2">Name</th>
                            <th className="text-left font-semibold pb-1 pr-2 w-14">Mahlzeit</th>
                            {menu && <th className="text-left font-semibold pb-1 pr-2">{menuTitle(menu)}</th>}
                            <th className="text-right font-semibold pb-1">Ernährung</th>
                        </tr>
                    </thead>
                    <tbody>
                        {list.map(vendor => (
                            <tr key={vendor.id} className="border-t border-gray-100 align-top">
                                <td className="py-1 pr-2 text-gray-500">{vendor.role || '—'}</td>
                                <td className={`py-1 pr-2 font-medium ${vendor.needs_meal ? 'text-gray-900' : 'text-gray-400'}`}>
                                    {vendor.name}
                                    {vendor.company && <span className="text-gray-400"> · {vendor.company}</span>}
                                    {vendor.note && <span className="block text-[10px] italic text-gray-500">{vendor.note}</span>}
                                </td>
                                <td className="py-1 pr-2 text-[10px] uppercase tracking-wide text-gray-500">
                                    {vendor.needs_meal ? 'Ja' : 'Nein'}
                                </td>
                                {/* A vendor's dish is optional: none is a dash, never "offen". */}
                                {menu && (
                                    <td className="py-1 pr-2 whitespace-nowrap text-gray-800">
                                        {vendor.needs_meal ? (mealLabelFor(vendor, menu) ?? <span className="text-gray-300">—</span>) : <span className="text-gray-300">—</span>}
                                    </td>
                                )}
                                <td className="py-1 text-right whitespace-nowrap">
                                    {vendor.needs_meal ? <Diet diet={vendor.diet} /> : <span className="text-gray-300">—</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}

function Legend() {
    return (
        <div className="mb-5 px-3 py-2 bg-gray-50 rounded flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-600">
            {ALL_DIET_CODES.map(code => (
                <span key={code} className="inline-flex items-center gap-1.5">
                    <Chip code={code} />{DIET_LABELS[code]}
                </span>
            ))}
        </div>
    );
}

function SheetHeader({ data, subtitle }: { data: SeatingExportData; subtitle: string }) {
    const printed = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
    const meta = [subtitle, data.date, data.venue, `Gedruckt am ${printed}`].filter(Boolean) as string[];
    return (
        <header className="border-b-2 border-gray-900 pb-3 mb-5">
            <h2 className="font-serif text-xl font-semibold text-gray-900">{data.title}</h2>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[10px] text-gray-500">
                {meta.map(m => <span key={m}>{m}</span>)}
            </div>
        </header>
    );
}

/**
 * Where the printed copy starts a new page.
 *
 * Only drawn in the preview: on paper the break is the break, and a dashed line
 * across the top of a page would be a printed dashed line. On screen it is the
 * only way to see a page break at all.
 */
function PageBreak() {
    return (
        <div className="flex items-center gap-3 my-4 text-[9px] uppercase tracking-widest text-gray-400">
            <span className="flex-1 border-t border-dashed border-gray-300" />
            neue Seite
            <span className="flex-1 border-t border-dashed border-gray-300" />
        </div>
    );
}

export default function SeatingExportSheet({ data, options, preview = false }: {
    data: SeatingExportData;
    options: ExportOptions;
    /** Draw the page breaks, which paper shows by simply being a new sheet. */
    preview?: boolean;
}) {
    const seated = seatedPeople(data);
    // The dishes, when they are to be shown; null makes every block draw as it
    // did before there was a menu.
    const menu = mealsOn(data, options) ? (data.menu ?? null) : null;
    const showNames = options.detail !== 'counts';
    const showTables = options.sections === 'table' || options.sections === 'both';
    const showList = options.sections === 'list' || options.sections === 'both';
    // Counts only is a narrow column of headings and numbers — a page of it is
    // mostly margin, and thirteen tables run onto a second sheet for no reason.
    // Two columns puts a normal wedding on one page. Not when every table is
    // meant to start its own page, where columns would be arguing with that.
    // Counts only is a heading and one line of numbers per table. Two columns put
    // a normal wedding on one page; thirteen tables plus the kitchen summary and
    // the vendors no longer did, and a third column is free width rather than a
    // compromise — at 703px a column is still 215px, which the chips fit in.
    const countsMode = options.detail === 'counts' && !options.pageBreak;
    const columns = countsMode ? (data.tables.length > 8 ? 3 : 2) : 1;
    const twoColumn = countsMode;

    return (
        <div className="bg-white text-gray-900 p-8 text-[12px] leading-relaxed">
            {showTables && (
                <>
                    <SheetHeader data={data} subtitle="Sitzplan · nach Tisch" />
                    {options.kitchen && (
                        <Kitchen people={seated} vendors={data.vendors} showVendors={options.vendors} menu={menu} />
                    )}
                    {(showNames || twoColumn) && <Legend />}
                    {data.tables.length === 0 && (
                        <p className="text-[11px] italic text-gray-400">Noch keine Tische im Plan.</p>
                    )}
                    <div className={countsMode ? `${columns === 3 ? 'columns-3 gap-x-5' : 'columns-2 gap-x-8'}` : undefined}>
                    {data.tables.map((table, i) => (
                        <div key={table.id} className={twoColumn ? 'break-inside-avoid' : undefined}>
                            {preview && options.pageBreak && i > 0 && <PageBreak />}
                            <TableBlock table={table} options={options} compact={twoColumn} menu={menu} />
                        </div>
                    ))}
                    {options.unseated && data.unseated.length > 0 && (
                        <section className={`${twoColumn ? 'mb-4' : 'mb-7'} break-inside-avoid`}>
                            <div className="flex items-baseline gap-2 border-b border-gray-300 pb-1">
                                <h3 className="font-serif text-base font-semibold text-gray-900">Noch ohne Platz</h3>
                                <span className="ml-auto font-mono text-[11px] text-gray-500 tabular-nums">
                                    {data.unseated.length}
                                </span>
                            </div>
                            {options.detail !== 'names' && <TallyLine people={data.unseated} compact={twoColumn} menu={menu} />}
                            {showNames && <Roster people={data.unseated} options={options} withSeat={false} menu={menu} />}
                        </section>
                    )}
                    </div>
                </>
            )}

            {showList && preview && showTables && <PageBreak />}
            {showList && (
                <div className={showTables ? 'break-before-page pt-2' : ''}>
                    <SheetHeader data={data} subtitle="Sitzplan · alle Gäste, A–Z" />
                    {options.kitchen && !showTables && (
                        <Kitchen people={seated} vendors={data.vendors} showVendors={options.vendors} menu={menu} />
                    )}
                    {options.detail !== 'names' && <TallyLine people={seated} menu={menu} />}
                    {showNames ? (
                        <>
                            <div className="mt-4"><Legend /></div>
                            <Roster
                                people={alphabetical(data, options.unseated)}
                                options={options}
                                withSeat={false}
                                menu={menu}
                            />
                        </>
                    ) : (
                        <p className="mt-2 text-[11px] italic text-gray-400">
                            Nur Zahlen – aktiviere „Alle Namen“, um hier die Gäste aufzulisten.
                        </p>
                    )}
                </div>
            )}

            {/* Once, at the end, whichever sections are on — a vendor belongs to
                no table and sorts under no surname, so there is nowhere else for
                the block to sit and no reason to print it twice. */}
            {options.vendors && (
                <div className={(showTables || showList) ? (countsMode ? 'mt-4' : 'mt-8 pt-2') : ''}>
                    <Vendors vendors={data.vendors} compact={countsMode} menu={menu} />
                </div>
            )}

            <p className="mt-6 pt-2 border-t border-gray-100 text-[10px] text-gray-400">
                {menu
                    ? <>{menuTitle(menu)} und Ernährungshinweise stammen aus der Rückmeldung. „Offen“ bedeutet: noch kein Gericht gewählt.</>
                    : <>Ernährungshinweise stammen aus der Rückmeldung. Ein Strich bedeutet: nichts angegeben –
                        diese Mahlzeit ist das Gericht „{NO_RESTRICTION_LABEL}“.</>}
            </p>
        </div>
    );
}
