'use client';

import { useState, useEffect, useCallback } from 'react';
import { AutosaveHeader, useAutosave } from '@/components/admin/useAutosave';
import { DEFAULT_ROOM_BLOCK_MESSAGE } from '@/lib/roomBlock';
import {
    DEFAULT_MENU_TITLE, MAX_MENU_DESCRIPTION, MAX_MENU_LABEL, MAX_MENU_OPTIONS, MENU_TAGS, MENU_TAG_LABELS,
    menuOf, parseMenu, slugFor, type DietaryEntry, type MenuOption, type MenuTag,
} from '@/lib/dietary';

/** The menu as this editor holds it: every text present, so the inputs are controlled. */
interface MenuDraft {
    enabled: boolean;
    title: string;
    hint: string;
    options: MenuOption[];
}

const EMPTY_DRAFT: MenuDraft = { enabled: false, title: '', hint: '', options: [] };

export default function AdminSettings() {
    const [config, setConfig] = useState({
        brideName: '',
        groomName: '',
        weddingDate: '',
        weddingTime: '',
        weddingLocation: '',
        weddingVenue: '',
        rsvpDeadline: '',
        contactEmail: '',
        roomBlockHotel: '',
        roomBlockUrl: '',
        roomBlockMessage: '',
        countdownMode: 'full',
        logoMode: false,
        rsvpMenu: EMPTY_DRAFT,
    });
    const [loaded, setLoaded] = useState(false);
    // Why the menu is not being saved, when it is not: an option without a name
    // while it is still being typed, most often.
    const [menuError, setMenuError] = useState<string | null>(null);
    // A dish with answers against it is not deleted on one click.
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    // How many attending people chose each dish, so deleting one says what it costs.
    const [chosen, setChosen] = useState<Record<string, number>>({});

    useEffect(() => {
        fetch('/api/admin/site-config')
            .then(res => res.json())
            // Only this page's own fields. Spreading the whole config into
            // state and posting it back overwrote every other editor's keys
            // with whatever this tab had loaded — the Colour page's save could
            // be undone by pressing Save here a minute later.
            .then(data => setConfig(prev => {
                const next = { ...prev };
                for (const key of Object.keys(prev) as (keyof typeof prev)[]) {
                    if (data[key] !== undefined) (next as Record<string, unknown>)[key] = data[key];
                }
                // Pre-fill the room-block message with the default wording so
                // it's visible and overwritable when nothing has been saved yet.
                next.roomBlockMessage = data.roomBlockMessage || DEFAULT_ROOM_BLOCK_MESSAGE;
                const menu = menuOf(data);
                next.rsvpMenu = { enabled: menu.enabled, title: menu.title ?? '', hint: menu.hint ?? '', options: menu.options };
                return next;
            }))
            .then(() => setLoaded(true));
    }, []);

    // The RSVPs, read once, for the count beside each dish. Counted with the
    // menu treated as on, so the numbers show while it is switched off too.
    useEffect(() => {
        fetch('/api/admin/rsvps')
            .then(res => (res.ok ? res.json() : { rsvps: [] }))
            .then((data: { rsvps?: { attending: boolean | null; dietary_restrictions: unknown }[] }) => {
                const counts: Record<string, number> = {};
                for (const rsvp of data.rsvps ?? []) {
                    if (rsvp.attending !== true || !Array.isArray(rsvp.dietary_restrictions)) continue;
                    for (const entry of rsvp.dietary_restrictions as DietaryEntry[]) {
                        const id = typeof entry?.meal === 'string' && !entry.kids_meal && !entry.no_meal ? entry.meal : null;
                        if (id) counts[id] = (counts[id] ?? 0) + 1;
                    }
                }
                setChosen(counts);
            })
            .catch(() => undefined);
    }, []);

    const save = useCallback(async (body: typeof config) => {
        // A half-typed menu (a dish with no name yet) is not posted: the route
        // would refuse the whole save, and the rest of the page with it. It is
        // held back and said so, and goes with the next save once it is whole.
        const { rsvpMenu, ...rest } = body;
        const menu = parseMenu(rsvpMenu);
        setMenuError(typeof menu === 'string' ? menu : null);
        const res = await fetch('/api/admin/site-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(typeof menu === 'string' ? rest : { ...rest, rsvpMenu: menu }),
        });
        if (!res.ok) throw new Error(String(res.status));
    }, []);

    const menu = config.rsvpMenu;
    const setMenu = (patch: Partial<MenuDraft>) => setConfig(prev => ({ ...prev, rsvpMenu: { ...prev.rsvpMenu, ...patch } }));
    const updateOption = (id: string, patch: Partial<MenuOption>) =>
        setMenu({ options: menu.options.map(o => (o.id === id ? { ...o, ...patch } : o)) });
    /**
     * A new dish gets a placeholder id and its real one from its name the first
     * time the name field is left — `slugFor` — after which the id never changes,
     * because it is what every guest's answer stores.
     */
    const addOption = () => {
        if (menu.options.length >= MAX_MENU_OPTIONS) return;
        const id = slugFor('neu', menu.options.map(o => o.id));
        setMenu({ options: [...menu.options, { id, label: '' }] });
    };
    const settleId = (option: MenuOption) => {
        if (!/^neu(-\d+)?$/.test(option.id) || !option.label.trim() || chosen[option.id]) return;
        const id = slugFor(option.label, menu.options.filter(o => o.id !== option.id).map(o => o.id));
        if (id !== option.id) updateOption(option.id, { id });
    };
    const moveOption = (id: string, by: -1 | 1) => {
        const index = menu.options.findIndex(o => o.id === id);
        const target = index + by;
        if (index < 0 || target < 0 || target >= menu.options.length) return;
        const next = [...menu.options];
        [next[index], next[target]] = [next[target], next[index]];
        setMenu({ options: next });
    };
    const removeOption = (id: string) => {
        setMenu({ options: menu.options.filter(o => o.id !== id) });
        setConfirmDelete(null);
    };
    const toggleTag = (option: MenuOption, tag: MenuTag) => {
        const tags = option.diet ?? [];
        updateOption(option.id, { diet: tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag] });
    };
    const FIELD = 'block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900';

    const { state, retry } = useAutosave({ value: config, ready: loaded, save });

    return (
        <div className="max-w-2xl">
            <AutosaveHeader
                title="Allgemeine Einstellungen"
                subtitle="Legt die Angaben zu eurer Hochzeitswebsite und ihr Erscheinungsbild fest. Änderungen werden automatisch gespeichert."
                state={state}
                onRetry={retry}
            />

            <div className="space-y-6 bg-white p-8 rounded-2xl border border-gray-200 shadow-lg">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Name der Braut</label>
                        <input
                            type="text"
                            value={config.brideName}
                            onChange={(e) => setConfig({ ...config, brideName: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Name des Bräutigams</label>
                        <input
                            type="text"
                            value={config.groomName}
                            onChange={(e) => setConfig({ ...config, groomName: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Hochzeitsdatum</label>
                    <input
                        type="text"
                        value={config.weddingDate}
                        onChange={(e) => setConfig({ ...config, weddingDate: e.target.value })}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border"
                        placeholder="z. B. 15. Juni 2027"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Uhrzeit der Hochzeit</label>
                    <input
                        type="text"
                        value={config.weddingTime}
                        onChange={(e) => setConfig({ ...config, weddingTime: e.target.value })}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border"
                        placeholder="z. B. 16:00 Uhr"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Anzeige des Countdowns</label>
                    <select
                        value={config.countdownMode || 'full'}
                        onChange={(e) => setConfig({ ...config, countdownMode: e.target.value })}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                    >
                        <option value="full">Vollständig (Tage, Stunden, Minuten, Sekunden)</option>
                        <option value="simple">Einfach (nur Tage und Stunden)</option>
                        <option value="days-only">Nur Tage (große Anzeige)</option>
                    </select>
                    <p className="mt-1 text-sm text-gray-500">
                        Wähle den Stil des Countdowns – „Nur Tage“ zeigt eine größere, auffälligere Anzeige
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Name der Location</label>
                    <input
                        type="text"
                        value={config.weddingVenue || ''}
                        onChange={(e) => setConfig({ ...config, weddingVenue: e.target.value })}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border"
                        placeholder="z. B. Hotel Seeblick"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Ort (Stadt, Bundesland)</label>
                    <input
                        type="text"
                        value={config.weddingLocation}
                        onChange={(e) => setConfig({ ...config, weddingLocation: e.target.value })}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border"
                    />
                </div>

                <div className="pt-6 border-t border-gray-100">
                    <div className="bg-gradient-to-br from-accent/10 to-accent-light/20 rounded-xl p-6 mb-6 border border-accent/20">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">Darstellung der Navigation</h2>
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold text-gray-900">Logo-Modus</h3>
                                <p className="text-sm text-gray-600 mt-1">
                                    Hochzeitslogo statt der Namen in der Navigationsleiste anzeigen
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.logoMode || false}
                                    onChange={(e) => setConfig({ ...config, logoMode: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-accent/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:start-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-accent"></div>
                            </label>
                        </div>
                        <div className="mt-4 p-4 bg-white/50 rounded-lg border border-accent/30">
                            <p className="text-sm text-gray-700">
                                <strong>Namen-Modus (Standard):</strong> Zeigt die Namen von Braut und Bräutigam in der Navigationsleiste
                            </p>
                            <p className="text-sm text-gray-700 mt-2">
                                <strong>Logo-Modus:</strong> Zeigt euer Hochzeitslogo. Das Logo legst du unter Admin → Fotos → „Hochzeitslogo festlegen“ fest
                            </p>
                        </div>
                    </div>
                </div>

                <div className="pt-6 border-t border-gray-100">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4">Rückmeldungen</h2>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700">Kontakt-E-Mail</label>
                        <input
                            type="email"
                            value={config.contactEmail || ''}
                            onChange={(e) => setConfig({ ...config, contactEmail: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                            placeholder="ihr@beispiel.de"
                        />
                        <p className="mt-1 text-xs text-gray-500">Wird auf der Rückmeldeseite für Gäste mit Problemen angezeigt.</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Rückmeldefrist</label>
                        <input
                            type="date"
                            value={config.rsvpDeadline || ''}
                            onChange={(e) => setConfig({ ...config, rsvpDeadline: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                        />
                        <p className="mt-1 text-xs text-gray-500">Die öffentliche Rückmeldeseite zeigt dieses Datum und zählt die verbleibenden Tage herunter.</p>
                    </div>

                    {/* The menu: what the RSVP form asks each attending person to
                        choose. Stored beside the deadline because it is content
                        the couple writes, not schema — see src/lib/dietary.ts. */}
                    <div className="mt-6 pt-6 border-t border-gray-100">
                        <h3 className="text-base font-semibold text-gray-900">Menüwahl</h3>
                        <p className="mt-1 text-sm text-gray-500">
                            Gäste wählen bei der Rückmeldung für jede Person ein Gericht. „Kindermenü“ und „Isst nicht mit“
                            stehen immer zur Wahl und müssen hier nicht angelegt werden.
                        </p>
                        <label className="mt-4 flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={menu.enabled}
                                onChange={(e) => setMenu({ enabled: e.target.checked })}
                                className="mt-1 h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent"
                            />
                            <span className="text-sm text-gray-800">
                                <span className="font-medium">Gäste wählen ihren Hauptgang</span>
                                <span className="block text-xs text-gray-500">
                                    An: die Wahl ist im Formular Pflicht für jede Person, die kommt. Aus: nichts wird gefragt,
                                    gespeicherte Antworten bleiben erhalten.
                                </span>
                            </span>
                        </label>
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Überschrift im Formular</label>
                                <input
                                    type="text"
                                    value={menu.title}
                                    maxLength={40}
                                    onChange={(e) => setMenu({ title: e.target.value })}
                                    className={`mt-1 ${FIELD}`}
                                    placeholder={DEFAULT_MENU_TITLE}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Hinweis über den Gerichten</label>
                                <input
                                    type="text"
                                    value={menu.hint}
                                    maxLength={300}
                                    onChange={(e) => setMenu({ hint: e.target.value })}
                                    className={`mt-1 ${FIELD}`}
                                    placeholder="z. B. Vorspeise und Dessert sind für alle gleich, den Hauptgang wählt ihr."
                                />
                            </div>
                        </div>
                        <div className="mt-4">
                            <p className="text-sm font-medium text-gray-700">
                                Gerichte <span className="font-normal text-gray-400">– in dieser Reihenfolge im Formular, im Export und in der Statistik</span>
                            </p>
                            <div className="mt-2 space-y-2">
                                {menu.options.map((option, index) => {
                                    const count = chosen[option.id] ?? 0;
                                    return (
                                        <div key={option.id} className="rounded-xl border border-gray-200 p-3">
                                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-2">
                                                <input
                                                    type="text"
                                                    value={option.label}
                                                    maxLength={MAX_MENU_LABEL}
                                                    onChange={(e) => updateOption(option.id, { label: e.target.value })}
                                                    onBlur={() => settleId(option)}
                                                    className={FIELD}
                                                    placeholder="Name des Gerichts"
                                                    aria-label="Name des Gerichts"
                                                />
                                                <input
                                                    type="text"
                                                    value={option.description ?? ''}
                                                    maxLength={MAX_MENU_DESCRIPTION}
                                                    onChange={(e) => updateOption(option.id, { description: e.target.value })}
                                                    className={FIELD}
                                                    placeholder="Kurze Beschreibung (optional)"
                                                    aria-label="Beschreibung"
                                                />
                                            </div>
                                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600">
                                                {MENU_TAGS.map(tag => (
                                                    <label key={tag} className="inline-flex items-center gap-1.5 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={(option.diet ?? []).includes(tag)}
                                                            onChange={() => toggleTag(option, tag)}
                                                            className="h-3.5 w-3.5 rounded border-gray-300 text-accent focus:ring-accent"
                                                        />
                                                        {MENU_TAG_LABELS[tag]}
                                                    </label>
                                                ))}
                                                <span className={`ml-auto rounded-full border px-2 py-0.5 tabular-nums ${count ? 'border-gray-200 bg-gray-50 text-gray-600' : 'border-gray-100 text-gray-400'}`}>
                                                    {count ? `${count} ${count === 1 ? 'Gast' : 'Gäste'}` : 'noch nicht gewählt'}
                                                </span>
                                                <span className="inline-flex gap-1">
                                                    <button type="button" onClick={() => moveOption(option.id, -1)} disabled={index === 0} className="px-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Nach oben" aria-label="Nach oben">↑</button>
                                                    <button type="button" onClick={() => moveOption(option.id, 1)} disabled={index === menu.options.length - 1} className="px-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Nach unten" aria-label="Nach unten">↓</button>
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => (count ? setConfirmDelete(option.id) : removeOption(option.id))}
                                                    className="text-red-600 hover:text-red-800 underline"
                                                >
                                                    Löschen
                                                </button>
                                            </div>
                                            {confirmDelete === option.id && (
                                                <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                                                    <span>
                                                        <strong>{count} {count === 1 ? 'Gast hat' : 'Gäste haben'}</strong> dieses Gericht gewählt. Nach dem Löschen gelten sie als
                                                        „offen“ und erscheinen im Filter „Menü fehlt“ der Gästeliste.
                                                    </span>
                                                    <button type="button" onClick={() => removeOption(option.id)} className="rounded-full bg-red-600 px-3 py-1 font-medium text-white hover:bg-red-700">Trotzdem löschen</button>
                                                    <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-full bg-white border border-gray-200 px-3 py-1 text-gray-700 hover:bg-gray-50">Abbrechen</button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <button
                                type="button"
                                onClick={addOption}
                                disabled={menu.options.length >= MAX_MENU_OPTIONS}
                                className="mt-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-gray-400 hover:text-gray-800 disabled:opacity-40"
                            >
                                + Gericht hinzufügen{menu.options.length >= MAX_MENU_OPTIONS ? ` (höchstens ${MAX_MENU_OPTIONS})` : ''}
                            </button>
                            {menuError && (
                                <p className="mt-2 text-sm text-red-600">Menü noch nicht gespeichert: {menuError}.</p>
                            )}
                            <p className="mt-3 text-xs text-gray-500 border-l-2 border-accent pl-3">
                                Schaltet ihr die Wahl ein, nachdem schon Rückmeldungen da sind, zeigt der Tab <strong>Rückmeldungen</strong>, wem
                                sie noch fehlt. Ein Gericht umbenennen ist jederzeit sicher; löschen fragt nach, wenn es schon gewählt wurde.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="pt-6 border-t border-gray-100">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4">Unterkunft / Zimmerkontingent</h2>
                    <p className="text-sm text-gray-500 mb-4">
                        Wird Gästen nach der Rückmeldung angezeigt. Lass den Hotelnamen leer, um die Karte zum Zimmerkontingent ganz auszublenden.
                    </p>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Hotel / Name des Zimmerkontingents</label>
                            <input
                                type="text"
                                value={config.roomBlockHotel || ''}
                                onChange={(e) => setConfig({ ...config, roomBlockHotel: e.target.value })}
                                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                                placeholder="z. B. Hotel Hafenblick"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Buchungs-URL</label>
                            <input
                                type="url"
                                value={config.roomBlockUrl || ''}
                                onChange={(e) => setConfig({ ...config, roomBlockUrl: e.target.value })}
                                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                                placeholder="https://www.choicehotels.com/reservations/groups/tk74b5"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Text zum Zimmerkontingent</label>
                            <textarea
                                rows={5}
                                value={config.roomBlockMessage || ''}
                                onChange={(e) => setConfig({ ...config, roomBlockMessage: e.target.value })}
                                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                                placeholder="Leer lassen, um den Standardtext zu verwenden."
                            />
                            <div className="mt-2 text-xs text-gray-500 space-y-1">
                                <p>Wird auf der Bestätigungskarte nach der Rückmeldung angezeigt. Leer lassen, um den Standardtext zu verwenden. Diese Platzhalter sind möglich:</p>
                                <ul className="list-disc list-inside space-y-0.5">
                                    <li><code className="text-accent font-mono">{'{names}'}</code> – die Namen des Paares (z. B. Anna &amp; Max)</li>
                                    <li><code className="text-accent font-mono">{'{hotel}'}</code> – der Hotel- bzw. Kontingentname von oben</li>
                                    <li><code className="text-accent font-mono">{'{book}'}</code> – ein anklickbarer Link „Zimmer buchen“. Die Adresse stammt aus der Buchungs-URL oben, sodass das Bearbeiten des Textes den Link nie kaputt machen kann.</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div >
    );
}
