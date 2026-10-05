// Default RSVP-confirmation room-block message. Shared between the admin editor
// (pre-fills the textarea so it's visible/overwritable) and the public RSVP form
// (fallback when nothing is saved). Supports {names}, {hotel}, and {book} tokens.
// Plain module with no server deps so it's safe to import in client components.
export const DEFAULT_ROOM_BLOCK_MESSAGE =
    "Ihr braucht noch eine Unterkunft? {names} haben im {hotel} ein Zimmerkontingent nur für unsere Gäste reserviert. Tippt auf {book}, um euch einen Platz in unserem Kontingent zu sichern. Ihr möchtet lieber anrufen oder euch anders um eure Übernachtung kümmern? Auch das ist völlig in Ordnung – Hauptsache, die Reise zu uns wird für euch so schön wie möglich. ♥";
