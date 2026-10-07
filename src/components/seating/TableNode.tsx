'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position } from '@xyflow/react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SeatingTableData, SeatData, SeatTransferPayload, ColorMode } from './types';
import {
  canRotate, normaliseRotation, rsvpLabel, seatRunDirection, seatSides, sideDirection, TableLayout,
} from '@/lib/seating';
import { CHIP_NAME_MAX, chipName } from './seatChip';

interface TableNodeProps {
  data: {
    table: SeatingTableData;
    /** Worked out by the page, which also needs its anchor to place the node. */
    layout: TableLayout;
    colorMode: ColorMode;
    onDropGuest: (tableId: number, guestId: string) => void;
    onDropPerson: (tableId: number, payload: string) => void;
    onMoveSeat: (payload: SeatTransferPayload, toTableId: number) => void;
    onUnassignParty: (tableId: number, partyGroupId: number) => void;
    onUnassignSeat: (tableId: number, seatIndex: number) => void;
    onReorderSeats: (tableId: number, orderedSeatIndices: { seat_index: number; display_name: string; guest_list_id: number | null; party_group_id: number | null }[]) => void;
    onDeleteTable: (tableId: number) => void;
    onRenameTable: (tableId: number, name: string) => void;
    /** Show the table at this angle without saving it — while the handle is dragged. */
    onRotatePreview: (tableId: number, rotation: number) => void;
    onRotateCommit: (tableId: number, rotation: number) => void;
    splitPartyGroupIds: Set<number>;
  };
}

// ── Seat chip ──────────────────────────────────────────────────────────────

function SeatChip({
  seat,
  tableId,
  isSplit,
  colorMode,
  onRemoveSeat,
  onRemoveParty,
}: {
  seat: SeatData;
  tableId: number;
  isSplit: boolean;
  colorMode: ColorMode;
  onRemoveSeat: () => void;
  onRemoveParty: () => void;
}) {
  const [hover, setHover] = useState(false);
  const name = chipName(seat);

  const transfer: SeatTransferPayload = {
    fromTableId: tableId,
    seatIndex: seat.seat_index,
    displayName: name,
    partyGroupId: seat.party_group_id,
    guestListId: seat.guest_list_id,
  };

  // Determine chip color classes based on mode
  const isLikelyNotComing = seat.rsvp_status === 'likely_not_coming';
  const hasDeclined = seat.rsvp_status === 'declined';
  let chipClass: string;
  if (isLikelyNotComing) {
    chipClass = 'bg-orange-100 border-orange-400 text-orange-700';
  } else if (hasDeclined) {
    // Red in *both* modes, not just RSVP mode: someone who said no is sitting in
    // a chair that needs freeing, which is not a fact about the colour toggle.
    chipClass = 'bg-red-100 border-red-400 text-red-800 line-through decoration-red-400/70';
  } else if (colorMode === 'rsvp') {
    // Coming green, no answer yet white.
    chipClass = seat.rsvp_status
      ? 'bg-green-100 border-green-400 text-green-800'
      : 'bg-white border-gray-300 text-gray-600';
  } else {
    // party mode
    chipClass = isSplit
      ? 'bg-yellow-100 border-yellow-400 text-yellow-800'
      : 'bg-green-50 border-green-300 text-green-800';
  }

  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('seatTransfer', JSON.stringify(transfer));
        e.stopPropagation();
      }}
      className={`nodrag relative flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border select-none cursor-grab active:cursor-grabbing ${chipClass}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={hasDeclined
        ? `${name} kommt nicht – von diesem Tisch entfernen`
        : colorMode === 'rsvp'
          ? (seat.rsvp_status ? `Rückmeldung: ${rsvpLabel(seat.rsvp_status)}` : 'Noch keine Rückmeldung')
          : (isSplit ? 'Gruppe ist getrennt – zum Verschieben ziehen' : `${name} auf einen anderen Tisch ziehen`)}
    >
      {colorMode === 'party' && isSplit && <span className="text-yellow-500 mr-0.5">⚠</span>}
      <span className="truncate" style={{ maxWidth: CHIP_NAME_MAX }}>{name}</span>
      {hover && (
        // Over the chip's corner rather than beside the name: the table is
        // sized by the chips' measured widths, so a chip that grew on hover
        // would push into its neighbour.
        <button
          className="nodrag absolute -top-2 -right-2 w-4 h-4 flex items-center justify-center rounded-full bg-white border border-gray-300 text-[11px] leading-none text-gray-500 shadow-sm hover:text-red-500 hover:border-red-300 transition-colors"
          // Removes this one person. It used to clear the whole party, so freeing
          // the one chair a declined plus-one was sitting in took the other two
          // with it. Hold Alt (or Shift) to remove the party, as before.
          onClick={e => {
            e.stopPropagation();
            if (e.altKey || e.shiftKey) onRemoveParty();
            else onRemoveSeat();
          }}
          title={`${name} von diesem Tisch entfernen (Alt-Klick entfernt die ganze Gruppe)`}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── Sortable row inside the reorder modal ─────────────────────────────────

/**
 * How the list maps onto the table — the order tableLayout() walks it in — in
 * the directions the table actually faces on screen once it is turned.
 */
function orderHint(tableType: string, rotation: number): string {
  if (tableType === 'round') return 'Im Uhrzeigersinn, oben beginnend';
  const { from, to } = seatRunDirection(rotation);
  const first = sideDirection('top', rotation) ?? '';
  if (tableType === 'head') return `${first.charAt(0).toUpperCase()}${first.slice(1)}, von ${from} nach ${to}`;
  return `Im Uhrzeigersinn: ${first} von ${from} nach ${to}, dann ${sideDirection('bottom', rotation)} zurück`;
}

function SortableSeatRow({ seat, side }: { seat: SeatData; side: string | null }) {
  const name = chipName(seat);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: seat.seat_index,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm"
    >
      {/* drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing shrink-0"
      >
        <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
          <circle cx="3.5" cy="3" r="1.5" /><circle cx="3.5" cy="8" r="1.5" /><circle cx="3.5" cy="13" r="1.5" />
          <circle cx="8.5" cy="3" r="1.5" /><circle cx="8.5" cy="8" r="1.5" /><circle cx="8.5" cy="13" r="1.5" />
        </svg>
      </div>
      <span className="text-sm text-gray-800 font-medium truncate">{name}</span>
      {side && (
        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-gray-400">{side}</span>
      )}
    </div>
  );
}

// ── Seat reorder modal ────────────────────────────────────────────────────

function ReorderModal({
  table,
  onSave,
  onClose,
}: {
  table: SeatingTableData;
  onSave: (ordered: SeatData[]) => void;
  onClose: () => void;
}) {
  const [seats, setSeats] = useState<SeatData[]>([...table.seats]);
  const [mounted, setMounted] = useState(false);
  // Where each row lands, by its place in the list: on a long table the order
  // decides who sits on which side, so the list has to say so.
  const sides = seatSides(table.table_type, seats.length);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSeats(prev => {
        const oldIndex = prev.findIndex(s => s.seat_index === active.id);
        const newIndex = prev.findIndex(s => s.seat_index === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  const modal = (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center"
      style={{ zIndex: 99999 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-80 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-800">{table.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Ziehen, um die Reihenfolge festzulegen</p>
            <p className="text-xs text-gray-400">{orderHint(table.table_type, table.rotation)}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Sortable list */}
        <div className="flex-1 overflow-y-auto p-4">
          {seats.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-6">Hier sitzt noch niemand.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={seats.map(s => s.seat_index)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {seats.map((seat, i) => (
                    <SortableSeatRow key={seat.seat_index} seat={seat} side={sideDirection(sides[i], table.rotation)} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
          <button
            onClick={() => onSave(seats)}
            className="flex-1 text-sm font-medium text-white py-2 rounded-lg"
            style={{ backgroundColor: 'var(--accent, #6366f1)' }}
          >
            Reihenfolge speichern
          </button>
          <button
            onClick={onClose}
            className="flex-1 text-sm font-medium text-gray-600 py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modal, document.body);
}

// ── Table controls (rendered inside table on hover) ────────────────────────

function TableControls({
  table,
  onDelete,
  onRename,
  onReorder,
  onRotate90,
}: {
  table: SeatingTableData;
  onDelete: () => void;
  onRename: (name: string) => void;
  onReorder: () => void;
  /** Absent for a table that cannot turn. */
  onRotate90?: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(table.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setValue(table.name);
    setRenaming(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = () => {
    if (value.trim()) onRename(value.trim());
    setRenaming(false);
  };

  return (
    <div className="nodrag flex items-center gap-1 mt-1" onClick={e => e.stopPropagation()}>
      {renaming ? (
        <input
          ref={inputRef}
          className="text-xs border border-gray-300 rounded px-1 py-0.5 w-24 outline-none bg-white"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setRenaming(false); }}
        />
      ) : (
        <button
          className="nodrag p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-white/50 transition-colors"
          title="Umbenennen"
          onClick={startRename}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      )}

      {/* Reorder seats button */}
      {table.seats.length > 1 && (
        <button
          className="nodrag p-1 rounded text-gray-400 hover:text-indigo-500 hover:bg-white/50 transition-colors"
          title="Plätze neu anordnen"
          onClick={e => { e.stopPropagation(); onReorder(); }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
            <polyline points="8 3 5 6 8 9" />
            <polyline points="16 15 19 18 16 21" />
          </svg>
        </button>
      )}

      {onRotate90 && (
        <button
          className="nodrag p-1 rounded text-gray-400 hover:text-indigo-500 hover:bg-white/50 transition-colors"
          title="Um 90° drehen (oder am Griff ziehen)"
          onClick={e => { e.stopPropagation(); onRotate90(); }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
      )}

      {confirmDelete ? (
        <div className="flex items-center gap-1">
          <span className="text-xs text-red-500">Löschen?</span>
          <button
            className="nodrag text-xs bg-red-100 text-red-700 rounded px-1.5 py-0.5 hover:bg-red-200"
            onClick={e => { e.stopPropagation(); onDelete(); }}
          >Ja</button>
          <button
            className="nodrag text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 hover:bg-gray-200"
            onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
          >Nein</button>
        </div>
      ) : (
        <button
          className="nodrag p-1 rounded text-red-400 hover:text-red-600 hover:bg-white/50 transition-colors"
          title="Tisch löschen"
          onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── Rotate handle ──────────────────────────────────────────────────────────

/**
 * The grip at a long table's end. Dragging it turns the table about its centre,
 * in 15° steps — Shift for single degrees. Only the release saves; every step
 * before it is a preview the page draws without a request.
 */
function RotateHandle({
  rotation,
  shapeRef,
  onActiveChange,
  onPreview,
  onCommit,
}: {
  rotation: number;
  shapeRef: React.RefObject<HTMLDivElement | null>;
  onActiveChange: (active: boolean) => void;
  onPreview: (rotation: number) => void;
  onCommit: (rotation: number) => void;
}) {
  const drag = useRef<{ cx: number; cy: number; from: number; start: number; last: number } | null>(null);
  const angleAt = (e: React.PointerEvent, cx: number, cy: number) =>
    (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;

  return (
    // The padding bridges the gap to the table: the grip only shows while the
    // table is hovered, and a gap to cross would hide it on the way there.
    <div className="absolute" style={{ left: '100%', top: '50%', marginTop: -12, paddingLeft: 8 }}>
      <div
        aria-label="Tisch drehen"
        title="Ziehen, um den Tisch zu drehen (Umschalt: ohne Raster)"
        // `nodrag` keeps React Flow from moving the table instead; no touch
        // scrolling, so a finger can turn it too.
        className="nodrag flex items-center justify-center w-6 h-6 rounded-full bg-white border border-gray-300 text-gray-500 shadow-sm hover:text-indigo-500 hover:border-indigo-300 cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onPointerDown={e => {
          e.stopPropagation();
          e.preventDefault();
          const box = shapeRef.current?.getBoundingClientRect();
          if (!box) return;
          // A turned element's box is the box of what is drawn, so its middle is
          // the table's centre at any angle.
          const cx = box.left + box.width / 2;
          const cy = box.top + box.height / 2;
          drag.current = { cx, cy, from: rotation, start: angleAt(e, cx, cy), last: rotation };
          e.currentTarget.setPointerCapture(e.pointerId);
          onActiveChange(true);
        }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d) return;
          // Relative to where the grip was taken, so taking it off-centre does not
          // jolt the table.
          const step = e.shiftKey ? 1 : 15;
          const next = normaliseRotation(Math.round((d.from + angleAt(e, d.cx, d.cy) - d.start) / step) * step);
          if (next !== d.last) {
            d.last = next;
            onPreview(next);
          }
        }}
        onPointerUp={() => {
          const d = drag.current;
          if (!d) return;
          drag.current = null;
          onActiveChange(false);
          if (d.last !== d.from) onCommit(d.last);
        }}
        onPointerCancel={() => {
          const d = drag.current;
          if (!d) return;
          drag.current = null;
          onActiveChange(false);
          onPreview(d.from);
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </div>
    </div>
  );
}

// ── Table shapes ───────────────────────────────────────────────────────────

function TableBody({
  table,
  width: tableW,
  height: tableH,
  rotation,
  onRotatePreview,
  onRotateCommit,
  splitPartyGroupIds,
  onDropGuest,
  onDropPerson,
  onMoveSeat,
  onUnassignParty,
  onDeleteTable,
  onRenameTable,
  onReorderSeats,
}: {
  table: SeatingTableData;
  width: number;
  height: number;
  /** The angle it is drawn at — the preview's while the handle is dragged. */
  rotation: number;
  onRotatePreview: (tableId: number, rotation: number) => void;
  onRotateCommit: (tableId: number, rotation: number) => void;
  splitPartyGroupIds: Set<number>;
  onDropGuest: (tableId: number, guestId: string) => void;
  onDropPerson: (tableId: number, payload: string) => void;
  onMoveSeat: (payload: SeatTransferPayload, toTableId: number) => void;
  onUnassignParty: (tableId: number, partyGroupId: number) => void;
  onDeleteTable: (tableId: number) => void;
  onRenameTable: (tableId: number, name: string) => void;
  onReorderSeats: (tableId: number, ordered: SeatData[]) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const shapeRef = useRef<HTMLDivElement>(null);
  const seatCount = table.seats.filter(s => s.rsvp_status !== 'likely_not_coming').length;
  const totalSeatCount = table.seats.length;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const seatTransferRaw = e.dataTransfer.getData('seatTransfer');
    if (seatTransferRaw) {
      const payload: SeatTransferPayload = JSON.parse(seatTransferRaw);
      if (payload.fromTableId !== table.id) {
        onMoveSeat(payload, table.id);
      }
      return;
    }

    // One person of a party, dragged on their own from the guest list.
    const partyPerson = e.dataTransfer.getData('partyPerson');
    if (partyPerson) { onDropPerson(table.id, partyPerson); return; }

    const guestId = e.dataTransfer.getData('guestId');
    if (guestId) onDropGuest(table.id, guestId);
  };

  const isRound = table.table_type === 'round';
  const turnable = canRotate(table.table_type);
  // The label stays upright inside a turned table, so it gets the table's
  // width across the screen — on a table stood on its end, its depth.
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const across = Math.min(cos > 1e-6 ? tableW / cos : Infinity, sin > 1e-6 ? tableH / sin : Infinity);

  const baseClasses = `relative flex flex-col items-center justify-center
    border-2 transition-colors cursor-grab select-none
    ${dragOver ? 'border-blue-400 bg-blue-50' : hovered ? 'border-gray-400 bg-gray-50' : 'border-gray-300 bg-white'}
    ${isRound ? 'rounded-full' : 'rounded-xl'}`;

  return (
    <>
      <div
        ref={shapeRef}
        className={baseClasses}
        style={{ width: tableW, height: tableH }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {/* Turned back by the table's own angle, so the writing reads level. */}
        <div
          className="flex flex-col items-center"
          style={{ transform: rotation ? `rotate(${-rotation}deg)` : undefined, maxWidth: Math.max(90, across) }}
        >
          <span className="text-xs font-semibold text-gray-600 px-3 text-center leading-tight">
            {table.name}
          </span>
          {rotating ? (
            <span className="text-xs text-indigo-500 font-medium mt-0.5 tabular-nums">{rotation}°</span>
          ) : totalSeatCount === 0 ? (
            <span className="text-xs text-gray-400 mt-0.5">Gäste hierher ziehen</span>
          ) : seatCount < totalSeatCount ? (
            <span className="text-center mt-0.5 leading-tight flex flex-col items-center">
              <span className="text-xs text-gray-400">{seatCount} {seatCount === 1 ? 'Person' : 'Personen'}</span>
              <span className="text-[9px] text-orange-400 font-medium">+{totalSeatCount - seatCount} wahrscheinlich nicht dabei</span>
            </span>
          ) : (
            <span className="text-xs text-gray-400 mt-0.5">{seatCount} {seatCount === 1 ? 'Person' : 'Personen'}</span>
          )}

          {hovered && !rotating && (
            <TableControls
              table={table}
              onDelete={() => onDeleteTable(table.id)}
              onRename={name => onRenameTable(table.id, name)}
              onReorder={() => setReorderOpen(true)}
              onRotate90={turnable ? () => onRotateCommit(table.id, normaliseRotation(rotation + 90)) : undefined}
            />
          )}
        </div>

        {turnable && (hovered || rotating) && (
          <RotateHandle
            rotation={rotation}
            shapeRef={shapeRef}
            onActiveChange={setRotating}
            onPreview={r => onRotatePreview(table.id, r)}
            onCommit={r => onRotateCommit(table.id, r)}
          />
        )}
      </div>

      {reorderOpen && (
        <ReorderModal
          table={table}
          onSave={ordered => {
            onReorderSeats(table.id, ordered);
            setReorderOpen(false);
          }}
          onClose={() => setReorderOpen(false)}
        />
      )}
    </>
  );
}

// ── Seat chips, where tableLayout() puts them ──────────────────────────────

function SeatsDisplay({
  table,
  layout,
  splitPartyGroupIds,
  colorMode,
  onUnassignParty,
  onUnassignSeat,
}: {
  table: SeatingTableData;
  layout: TableLayout;
  splitPartyGroupIds: Set<number>;
  colorMode: ColorMode;
  onUnassignParty: (tableId: number, partyGroupId: number) => void;
  onUnassignSeat: (tableId: number, seatIndex: number) => void;
}) {
  if (table.seats.length === 0) return null;

  const { spots } = layout;
  return (
    <>
      {table.seats.map((seat, i) => {
        const isSplit = seat.party_group_id !== null && splitPartyGroupIds.has(seat.party_group_id);
        return (
          <div
            key={seat.seat_index}
            className="absolute w-max"
            style={{ left: spots[i].x, top: spots[i].y, transform: 'translate(-50%, -50%)' }}
          >
            <SeatChip
              seat={seat}
              tableId={table.id}
              isSplit={isSplit}
              colorMode={colorMode}
              onRemoveSeat={() => onUnassignSeat(table.id, seat.seat_index)}
              onRemoveParty={() => seat.party_group_id !== null && onUnassignParty(table.id, seat.party_group_id)}
            />
          </div>
        );
      })}
    </>
  );
}

// ── Main node export ───────────────────────────────────────────────────────

export default function TableNode({ data }: TableNodeProps) {
  const { table, layout, colorMode, onDropGuest, onDropPerson, onMoveSeat, onUnassignParty, onUnassignSeat, onReorderSeats, onDeleteTable, onRenameTable, onRotatePreview, onRotateCommit, splitPartyGroupIds } = data;

  // The node is the table and its chairs, so the chairs are inside what React
  // Flow measures, selects and fits to the screen.
  return (
    <div
      style={{
        width: layout.node.width,
        height: layout.node.height,
        position: 'relative',
      }}
    >
      <Handle type="source" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />

      <div
        style={{
          position: 'absolute',
          left: layout.table.x,
          top: layout.table.y,
          width: layout.table.width,
          height: layout.table.height,
          // About its centre, which is where the layout turned it.
          transform: layout.rotation ? `rotate(${layout.rotation}deg)` : undefined,
        }}
      >
        <TableBody
          table={table}
          width={layout.table.width}
          height={layout.table.height}
          rotation={layout.rotation}
          onRotatePreview={onRotatePreview}
          onRotateCommit={onRotateCommit}
          splitPartyGroupIds={splitPartyGroupIds}
          onDropGuest={onDropGuest}
          onDropPerson={onDropPerson}
          onMoveSeat={onMoveSeat}
          onUnassignParty={onUnassignParty}
          onDeleteTable={onDeleteTable}
          onRenameTable={onRenameTable}
          onReorderSeats={onReorderSeats}
        />
      </div>

      <SeatsDisplay
        table={table}
        layout={layout}
        splitPartyGroupIds={splitPartyGroupIds}
        colorMode={colorMode}
        onUnassignParty={onUnassignParty}
        onUnassignSeat={onUnassignSeat}
      />
    </div>
  );
}
