'use client';

import {
    ALL_DIET_CODES, DIET_LABELS, dietNote, isMealCode, isOn, mealCode, menuActive, menuTitle, setMeal, setNote,
    toggleRestriction, type DietCode, type DietaryEntry, type RsvpMenu,
} from '@/lib/dietary';

/**
 * One person's answer, as rows of pills.
 *
 * In the guest editor rather than on the RSVP itself, because the answers that
 * need typing in are the ones given in person — and those people often never
 * filled the form at all. Shared with the vendors tab, whose dietary answer is
 * the same shape and wants the same editor: a photographer's nut allergy reaches
 * the kitchen sheet by exactly the route a guest's does.
 *
 * With a menu switched on there are two rows: the plate (one of the dishes, the
 * kids' plate, or no plate — one at a time) and then the restrictions. With it
 * off there is the one row there always was, kids' meal and not eating among
 * the toggles.
 */
export default function DietaryPills({ entry, onChange, codes = ALL_DIET_CODES, menu = null, mealRequired = false }: {
    entry: DietaryEntry;
    onChange: (entry: DietaryEntry) => void;
    /**
     * Which answers to offer. Everything, by default. Vendors are given the
     * restrictions alone: a kids' meal for the DJ is nonsense, and "not eating"
     * is already their *Needs a meal* checkbox — two controls for one fact is
     * how the two come to disagree.
     */
    codes?: readonly DietCode[];
    /** The dishes, as the first row. Null or off: no first row. */
    menu?: RsvpMenu | null;
    /** Say so when the plate is still to be chosen. Guests, not vendors. */
    mealRequired?: boolean;
}) {
    const askMeal = menuActive(menu);
    const choice = askMeal ? mealCode(entry, menu) : null;
    const restrictionCodes = askMeal ? codes.filter(code => !isMealCode(code)) : codes;
    const plateCodes = askMeal ? codes.filter(isMealCode) : [];
    const pill = (on: boolean, dark = 'bg-gray-900 text-white') => `px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        on ? dark : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
    }`;

    return (
        <div className="mt-2">
            {askMeal && menu && (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={menuTitle(menu)}>
                    {menu.options.map(option => {
                        const on = choice === option.id;
                        return (
                            <button
                                key={option.id}
                                type="button"
                                aria-pressed={on}
                                title={option.description || undefined}
                                onClick={() => onChange(setMeal(entry, on ? null : option.id))}
                                className={pill(on)}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                    {plateCodes.length > 0 && <span className="w-px h-4 bg-gray-200" aria-hidden="true" />}
                    {plateCodes.map(code => {
                        const on = choice === code;
                        return (
                            <button
                                key={code}
                                type="button"
                                aria-pressed={on}
                                onClick={() => onChange(setMeal(entry, on ? null : code))}
                                className={pill(on, code === 'NOM' ? 'bg-slate-600 text-white' : 'bg-gray-900 text-white')}
                            >
                                {DIET_LABELS[code]}
                            </button>
                        );
                    })}
                    {mealRequired && choice === null && (
                        <span className="w-full text-[10px] font-medium text-amber-700 leading-snug">
                            {menuTitle(menu)} fehlt
                        </span>
                    )}
                    {choice === 'NOM' && (
                        <span className="w-full text-[10px] text-gray-400 leading-snug">
                            Belegt einen Platz, isst aber nicht mit – wird bei den Essenszahlen nicht mitgezählt.
                        </span>
                    )}
                </div>
            )}
            <div className={`flex flex-wrap items-center gap-1.5 ${askMeal ? 'mt-1.5' : ''}`}>
                {restrictionCodes.map(code => {
                    const on = isOn(entry, code);
                    return (
                        <button
                            key={code}
                            type="button"
                            aria-pressed={on}
                            onClick={() => onChange(toggleRestriction(entry, code))}
                            className={pill(on, code === 'NOM' ? 'bg-slate-600 text-white' : 'bg-gray-900 text-white')}
                        >
                            {DIET_LABELS[code]}
                        </button>
                    );
                })}
                {!askMeal && isOn(entry, 'NOM') && (
                    <span className="w-full text-[10px] text-gray-400 leading-snug">
                        Belegt einen Platz, isst aber nicht mit – wird bei den Essenszahlen nicht mitgezählt.
                    </span>
                )}
                {isOn(entry, 'OTH') && (
                    <input
                        type="text"
                        value={dietNote(entry)}
                        onChange={e => onChange(setNote(entry, e.target.value))}
                        placeholder="Was sollte die Küche wissen?"
                        className="flex-1 min-w-[12rem] px-3 py-1.5 border border-gray-200 rounded-full bg-gray-50 text-xs text-gray-900 placeholder-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                    />
                )}
            </div>
        </div>
    );
}
