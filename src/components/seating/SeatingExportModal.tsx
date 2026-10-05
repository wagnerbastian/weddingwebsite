'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toCsv } from '@/lib/mailing';
import {
    A4_CONTENT_WIDTH, DEFAULT_EXPORT_OPTIONS, csvHeaders, csvRows,
    exportFilename, fitScale, pageCount, seatedPeople,
    type ExportOptions, type SeatingExportData,
} from '@/lib/seatingExport';
import SeatingExportSheet from './SeatingExportSheet';

/**
 * Export the seating chart — as paper, or as a spreadsheet.
 *
 * The options are on the left and the actual sheet is on the right, live: the
 * preview is the same component the printer gets, shrunk to fit, so "both
 * sections, counts only, new page per table" is a thing you look at rather than
 * a thing you guess at and then print thirty pages to find out.
 */

/** The printable width of A4, which is what the sheet lays out at. */
const PAGE_WIDTH = A4_CONTENT_WIDTH;

function Segment<T extends string>({ label, value, options, onChange }: {
    label: string;
    value: T;
    options: { value: T; label: string; hint?: string }[];
    onChange: (value: T) => void;
}) {
    return (
        <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">{label}</h3>
            <div className="flex flex-col gap-1.5">
                {options.map(opt => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-left transition-colors ${
                            value === opt.value
                                ? 'bg-gray-900 text-white'
                                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                        {opt.label}
                        {opt.hint && (
                            <span className={`ml-auto text-[10px] ${value === opt.value ? 'text-white/60' : 'text-gray-400'}`}>
                                {opt.hint}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}

function Check({ checked, onChange, label, hint, disabled }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    hint?: string;
    disabled?: boolean;
}) {
    return (
        <label className={`flex items-start gap-2.5 rounded-xl px-2 py-1.5 text-xs ${
            disabled ? 'cursor-not-allowed text-gray-400' : 'cursor-pointer text-gray-700 hover:bg-gray-50'
        }`}>
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={e => onChange(e.target.checked)}
                className="mt-0.5 accent-gray-900"
            />
            <span>
                {label}
                {hint && <span className="block text-[10px] text-gray-400 leading-snug">{hint}</span>}
            </span>
        </label>
    );
}

export default function SeatingExportModal({ onClose }: { onClose: () => void }) {
    const [data, setData] = useState<SeatingExportData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);

    const paneRef = useRef<HTMLDivElement>(null);
    const sheetRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const [sheetHeight, setSheetHeight] = useState(0);

    const set = useCallback(<K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => {
        setOptions(prev => ({ ...prev, [key]: value }));
    }, []);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/admin/seating/export')
            .then(res => (res.ok ? res.json() : Promise.reject(new Error('Failed to load the chart'))))
            .then(json => { if (!cancelled) setData(json); })
            .catch(() => { if (!cancelled) setError('Der Sitzplan konnte nicht geladen werden.'); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // The preview is the real sheet at real width, scaled down to the pane. Its
    // height has to be measured rather than assumed: a transform does not change
    // how much room the element takes, so without this the pane scrolls through
    // a page and a half of empty space below a short chart.
    useLayoutEffect(() => {
        const pane = paneRef.current;
        const sheet = sheetRef.current;
        if (!pane || !sheet) return;
        const measure = () => {
            const available = pane.clientWidth - 32;
            setScale(Math.min(1, Math.max(0.3, available / PAGE_WIDTH)));
            setSheetHeight(sheet.scrollHeight);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(pane);
        observer.observe(sheet);
        return () => observer.disconnect();
    }, [data, options]);

    const downloadCsv = useCallback(() => {
        if (!data) return;
        const csv = toCsv(csvHeaders(options), csvRows(data, options));
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = exportFilename('csv');
        a.click();
        URL.revokeObjectURL(url);
        onClose();
    }, [data, options, onClose]);

    const run = useCallback(() => {
        if (options.format === 'csv') { downloadCsv(); return; }
        window.print();
    }, [options.format, downloadCsv]);

    const people = data ? seatedPeople(data).length + data.unseated.length : 0;

    /*
     * Counts only is meant to be the one sheet you pin up in the kitchen, so it
     * is fitted to a single page: measured at the real printable width, then
     * shrunk by however much it is over. The layout does most of the work (three
     * columns, no vendor roster) and this is the guarantee behind it — "fits on
     * one page" should be true at thirteen tables and at thirty.
     *
     * Not when a new page per table is asked for, which is a request for many
     * pages, and not in the other detail modes, where a hundred names cannot
     * become one page at any readable size.
     */
    const fitsOnePage = options.format === 'print'
        && options.detail === 'counts'
        && !options.pageBreak;
    const printScale = fitsOnePage ? fitScale(sheetHeight) : 1;
    const printPages = pageCount(sheetHeight, printScale);
    const shrunk = printScale < 1;
    // The floor in `fitScale` is a refusal to print something unreadable, so a
    // sheet that hits it still runs to more than one page and has to say so.
    const overflows = fitsOnePage && printPages > 1;

    return (
        <>
            <div
                className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 print:hidden"
                role="dialog"
                aria-modal="true"
                aria-label="Sitzplan exportieren"
                onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            >
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                        <div>
                            <h2 className="font-serif text-lg font-bold text-gray-800">Sitzplan exportieren</h2>
                            <p className="text-xs text-gray-500">
                                {data ? `${data.tables.length} ${data.tables.length === 1 ? 'Tisch' : 'Tische'} · ${people} ${people === 1 ? 'Person' : 'Personen'}` : 'Wird geladen …'}
                                {data && options.format === 'print' && sheetHeight > 0 && (
                                    <span className={overflows ? 'text-amber-700' : 'text-gray-400'}>
                                        {' · '}
                                        {overflows
                                            ? `${printPages} Seiten – zu viel für eine, auch verkleinert`
                                            : printPages === 1
                                                ? shrunk
                                                    ? `passt auf eine Seite, verkleinert auf ${Math.round(printScale * 100)} %`
                                                    : 'passt auf eine Seite'
                                                : `${printPages} Seiten`}
                                    </span>
                                )}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="ml-auto w-8 h-8 rounded-full bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            aria-label="Schließen"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
                        {/* Options */}
                        <div className="md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-gray-100 overflow-y-auto p-5 flex flex-col gap-5">
                            <Segment
                                label="Inhalt"
                                value={options.sections}
                                onChange={v => set('sections', v)}
                                options={[
                                    { value: 'table', label: 'Nach Tisch', hint: 'Sitzordnung' },
                                    { value: 'list', label: 'Alphabetische Liste', hint: 'Namen finden' },
                                    { value: 'both', label: 'Beides', hint: '2 Abschnitte' },
                                ]}
                            />
                            <Segment
                                label="Detailgrad"
                                value={options.detail}
                                onChange={v => set('detail', v)}
                                options={[
                                    { value: 'names', label: 'Alle Namen' },
                                    { value: 'counts', label: 'Nur Zahlen' },
                                    { value: 'both', label: 'Namen + Zahlen' },
                                ]}
                            />
                            <div>
                                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Zusätzlich anzeigen</h3>
                                <Check checked={options.kitchen} onChange={v => set('kitchen', v)} label="Küchenübersicht" hint="Gesamtzahlen der Hochzeit auf Seite eins" />
                                <Check checked={options.household} onChange={v => set('household', v)} label="Gruppe" hint="Mit welcher Einladung die Person eingeladen wurde" />
                                <Check checked={options.side} onChange={v => set('side', v)} label="Seite" />
                                <Check checked={options.empty} onChange={v => set('empty', v)} label="Freie Plätze" />
                                <Check checked={options.unseated} onChange={v => set('unseated', v)} label="Noch ohne Platz" />
                                <Check
                                    checked={options.vendors}
                                    onChange={v => set('vendors', v)}
                                    label="Dienstleister"
                                    hint={
                                        data && data.vendors.length === 0
                                            ? 'Noch keine angelegt – im Tab „Dienstleister“ der Gästeliste'
                                            : 'Wer vor Ort ist und wer verpflegt wird'
                                    }
                                />
                                <Check checked={options.pageBreak} onChange={v => set('pageBreak', v)} label="Neue Seite pro Tisch" />
                                <Check
                                    checked={false}
                                    onChange={() => {}}
                                    disabled
                                    label="Menüwahl"
                                    hint="Wird nicht erfasst – die Rückmeldung fragt nur Ernährungshinweise ab"
                                />
                            </div>
                            <Segment
                                label="Format"
                                value={options.format}
                                onChange={v => set('format', v)}
                                options={[
                                    { value: 'print', label: 'Drucken / PDF' },
                                    { value: 'csv', label: 'Tabelle', hint: '.csv' },
                                ]}
                            />
                        </div>

                        {/* Preview */}
                        <div ref={paneRef} className="flex-1 min-w-0 bg-gray-100 overflow-auto p-4">
                            {error && <p className="text-xs text-red-600">{error}</p>}
                            {!data && !error && <p className="text-xs text-gray-400">Blatt wird erstellt …</p>}
                            {data && options.format === 'csv' && (
                                <div className="bg-white rounded-lg shadow p-5 text-[11px] text-gray-600">
                                    <p className="font-medium text-gray-800 mb-2">{exportFilename('csv')}</p>
                                    <p className="mb-3">
                                        Eine Zeile pro Person – {csvRows(data, options).length} Zeilen,{' '}
                                        {csvHeaders(options).length} Spalten. Jeder Ernährungshinweis hat eine eigene
                                        Ja/leer-Spalte, sodass eine Pivot-Tabelle dieselben Zahlen liefert wie das gedruckte Blatt.
                                    </p>
                                    <pre className="bg-gray-50 rounded p-3 overflow-x-auto font-mono text-[10px] leading-5">
{[csvHeaders(options).join(','), ...csvRows(data, options).slice(0, 8).map(r => r.join(','))].join('\n')}
{csvRows(data, options).length > 8 ? `\n… ${csvRows(data, options).length - 8} weitere Zeilen` : ''}
                                    </pre>
                                </div>
                            )}
                            {data && options.format === 'print' && (
                                <div
                                    className="mx-auto bg-white shadow-lg"
                                    style={{ width: PAGE_WIDTH * scale, height: sheetHeight * scale || undefined }}
                                >
                                    <div
                                        ref={sheetRef}
                                        style={{ width: PAGE_WIDTH, transform: `scale(${scale})`, transformOrigin: 'top left' }}
                                    >
                                        <SeatingExportSheet data={data} options={options} preview />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-3">
                        <p className="text-[11px] text-gray-400 hidden sm:block">
                            {options.format === 'print'
                                ? 'Öffnet den Druckdialog – wähle dort „Als PDF speichern“.'
                                : 'Lädt eine Tabelle herunter, die sich in Excel oder Sheets öffnen lässt.'}
                        </p>
                        <button
                            onClick={onClose}
                            className="ml-auto px-5 py-2 rounded-full text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100"
                        >
                            Abbrechen
                        </button>
                        <button
                            onClick={run}
                            disabled={!data}
                            className="px-5 py-2 rounded-full text-xs font-semibold text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-40"
                        >
                            {options.format === 'print' ? 'Drucken' : 'Herunterladen'}
                        </button>
                    </div>
                </div>
            </div>

            {/* The copy that actually prints: a direct child of <body>, because the
                admin shell is a fixed, overflow-hidden box that would clip it to one
                page. `.print-sheet` is the existing rule that hides everything else. */}
            {data && options.format === 'print' && typeof document !== 'undefined' && createPortal(
                <div
                    className="print-sheet hidden print:block"
                    // `zoom`, not `transform: scale()` — a transform leaves the
                    // element's flow height untouched, so the page would break in
                    // exactly the place the scaling was meant to prevent.
                    style={printScale < 1 ? { zoom: printScale } : undefined}
                >
                    <SeatingExportSheet data={data} options={options} />
                </div>,
                document.body,
            )}
        </>
    );
}
