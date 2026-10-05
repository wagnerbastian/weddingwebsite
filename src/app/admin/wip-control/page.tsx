'use client';

import { useEffect, useState } from 'react';

interface WipToggle {
  id: number;
  page_path: string;
  page_label: string;
  is_wip: boolean;
  is_hidden: boolean;
  updated_at: string;
}

const publicPages = [
  { path: '/', label: 'Start' },
  { path: '/about', label: 'Über uns' },
  { path: '/our-story', label: 'Unsere Geschichte' },
  { path: '/wedding-party', label: 'Trauzeugen & Team' },
  { path: '/schedule', label: 'Ablauf' },
  { path: '/photos', label: 'Fotos' },
  { path: '/registry', label: 'Wunschliste' },
  { path: '/rsvp', label: 'Rückmeldung' },
];

export default function WipControlPage() {
  const [toggles, setToggles] = useState<WipToggle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [basicMode, setBasicMode] = useState(false);
  const [basicModeShowVenue, setBasicModeShowVenue] = useState(false);
  const [savingBasicMode, setSavingBasicMode] = useState(false);
  const [savingBasicModeVenue, setSavingBasicModeVenue] = useState(false);

  useEffect(() => {
    fetchToggles();
    fetchBasicMode();
  }, []);

  const fetchBasicMode = async () => {
    try {
      const response = await fetch('/api/admin/site-config');
      const data = await response.json();
      setBasicMode(data.basicMode || false);
      setBasicModeShowVenue(data.basicModeShowVenue || false);
    } catch (error) {
      console.error('Error fetching basic mode:', error);
    }
  };

  const fetchToggles = async () => {
    try {
      const response = await fetch('/api/admin/wip-toggles');
      const data = await response.json();

      const toggleMap = new Map(data.map((t: WipToggle) => [t.page_path, t]));

      const allToggles: WipToggle[] = publicPages.map((page): WipToggle => {
        const existing = toggleMap.get(page.path);
        if (existing !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { ...(existing as WipToggle), is_hidden: (existing as any).is_hidden ?? false };
        }
        return {
          id: 0,
          page_path: page.path,
          page_label: page.label,
          is_wip: false,
          is_hidden: false,
          updated_at: new Date().toISOString(),
        } as WipToggle;
      });

      setToggles(allToggles);
    } catch (error) {
      console.error('Error fetching toggles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBasicModeToggle = async () => {
    setSavingBasicMode(true);
    try {
      const configResponse = await fetch('/api/admin/site-config');
      const config = await configResponse.json();
      config.basicMode = !basicMode;
      const response = await fetch('/api/admin/site-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (response.ok) setBasicMode(!basicMode);
    } catch (error) {
      console.error('Error updating basic mode:', error);
    } finally {
      setSavingBasicMode(false);
    }
  };

  const handleBasicModeVenueToggle = async () => {
    setSavingBasicModeVenue(true);
    try {
      const configResponse = await fetch('/api/admin/site-config');
      const config = await configResponse.json();
      config.basicModeShowVenue = !basicModeShowVenue;
      const response = await fetch('/api/admin/site-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (response.ok) setBasicModeShowVenue(!basicModeShowVenue);
    } catch (error) {
      console.error('Error updating basic mode venue:', error);
    } finally {
      setSavingBasicModeVenue(false);
    }
  };

  const handleToggle = async (page_path: string, field: 'is_wip' | 'is_hidden') => {
    setSaving(`${page_path}-${field}`);
    try {
      const toggle = toggles.find(t => t.page_path === page_path);
      if (!toggle) return;

      const updated = {
        ...toggle,
        [field]: !toggle[field],
      };

      const response = await fetch('/api/admin/wip-toggles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_path: updated.page_path,
          page_label: updated.page_label,
          is_wip: updated.is_wip,
          is_hidden: updated.is_hidden,
        }),
      });

      if (response.ok) {
        await fetchToggles();
      }
    } catch (error) {
      console.error('Error updating toggle:', error);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-gray-600">Wird geladen …</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-2">Bald verfügbar</h1>
      <p className="text-gray-600 mb-8">
        Lege fest, welche Seiten online sind, eine „Bald verfügbar“-Meldung zeigen oder komplett aus der Navigation ausgeblendet werden.
        Als Admin hast du immer vollen Zugriff.
      </p>

      {/* Basic Mode Section */}
      <div className="bg-gradient-to-br from-accent/10 to-accent-light/20 rounded-2xl shadow-lg p-8 mb-8 border border-accent/20">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-gray-900">Basismodus</h2>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                basicMode ? 'bg-accent text-white' : 'bg-gray-200 text-gray-600'
              }`}>
                {basicMode ? 'AKTIV' : 'INAKTIV'}
              </span>
            </div>
            <p className="text-gray-700 mb-3">
              Vorab-Modus – zeigt nur die wichtigsten Seiten, bevor die Website ganz fertig ist
            </p>
            <div className="bg-white/60 rounded-xl p-4 backdrop-blur-sm">
              <p className="text-sm font-medium text-gray-800 mb-2">Wenn aktiviert, sehen Besucher nur:</p>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>• <strong>Start</strong> – die komplette Startseite</li>
                <li>• <strong>Über uns</strong> – nur den Einleitungsabschnitt (Details & Fragen bleiben verborgen)</li>
                <li>• <strong>Unsere Geschichte</strong> – euren Zeitstrahl</li>
                <li>• <strong>Fotos</strong> – die Fotogalerie</li>
              </ul>
              <p className="text-sm text-gray-600 mt-3 italic">
                Alle anderen Seiten (Trauzeugen & Team, Ablauf, Rückmeldung) erscheinen gar nicht in der Navigation.
              </p>
            </div>

            {basicMode && (
              <div className="mt-4 bg-white/80 rounded-xl p-4 border-2 border-accent/30">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-bold text-gray-900">Infos zur Location zeigen</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        basicModeShowVenue ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {basicModeShowVenue ? 'AN' : 'AUS'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">
                      Ort der Location auf der Startseite und Location-Abschnitt auf „Über uns“ anzeigen
                    </p>
                  </div>
                  <button
                    onClick={handleBasicModeVenueToggle}
                    disabled={savingBasicModeVenue}
                    className={`relative inline-flex h-6 w-12 items-center rounded-full transition-all duration-300 ${
                      basicModeShowVenue ? 'bg-green-500' : 'bg-gray-300'
                    } ${savingBasicModeVenue ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${
                      basicModeShowVenue ? 'translate-x-7' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="ml-6">
            <button
              onClick={handleBasicModeToggle}
              disabled={savingBasicMode}
              className={`relative inline-flex h-8 w-16 items-center rounded-full transition-all duration-300 shadow-lg ${
                basicMode ? 'bg-accent' : 'bg-gray-300'
              } ${savingBasicMode ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-xl'}`}
            >
              <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform duration-300 shadow-md ${
                basicMode ? 'translate-x-9' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </div>
      </div>

      {/* Individual Page Toggles */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Einstellungen pro Seite</h2>
          <p className="text-sm text-gray-600 mt-1">
            <strong>Bald:</strong> Besucher sehen eine „Bald verfügbar“-Meldung &nbsp;|&nbsp;
            <strong>Versteckt:</strong> Seite wird komplett aus der Navigation entfernt
          </p>
        </div>

        {/* Column headers */}
        <div className="hidden sm:flex items-center px-6 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          <div className="flex-1">Seite</div>
          <div className="flex items-center gap-8 mr-2">
            <span className="w-24 text-center">Bald-Modus</span>
            <span className="w-24 text-center">In Navigation verstecken</span>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {toggles.map((toggle) => {
            const savingWip = saving === `${toggle.page_path}-is_wip`;
            const savingHidden = saving === `${toggle.page_path}-is_hidden`;

            // Status badge
            let statusLabel = '✓ Online';
            let statusClass = 'bg-green-100 text-green-800';
            if (toggle.is_hidden) {
              statusLabel = '🙈 Versteckt';
              statusClass = 'bg-gray-100 text-gray-600';
            } else if (toggle.is_wip) {
              statusLabel = '🚧 Bald';
              statusClass = 'bg-yellow-100 text-yellow-800';
            }

            return (
              <div
                key={toggle.page_path}
                className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-lg text-gray-900">{toggle.page_label}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <p className="text-gray-400 text-sm font-mono">{toggle.page_path}</p>
                </div>

                <div className="flex items-center gap-8">
                  {/* WIP toggle */}
                  <div className="flex flex-col items-center gap-1 w-24">
                    <span className="text-xs text-gray-500 font-medium">Bald</span>
                    <button
                      onClick={() => handleToggle(toggle.page_path, 'is_wip')}
                      disabled={savingWip}
                      title="Besuchern die „Bald verfügbar“-Meldung zeigen"
                      className={`relative inline-flex h-7 w-14 items-center rounded-full transition-all duration-300 ${
                        toggle.is_wip ? 'bg-yellow-500' : 'bg-gray-300'
                      } ${savingWip ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-300 shadow-sm ${
                        toggle.is_wip ? 'translate-x-8' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>

                  {/* Hidden toggle */}
                  <div className="flex flex-col items-center gap-1 w-24">
                    <span className="text-xs text-gray-500 font-medium">Versteckt</span>
                    <button
                      onClick={() => handleToggle(toggle.page_path, 'is_hidden')}
                      disabled={savingHidden}
                      title="Seite komplett aus der Navigation entfernen"
                      className={`relative inline-flex h-7 w-14 items-center rounded-full transition-all duration-300 ${
                        toggle.is_hidden ? 'bg-gray-500' : 'bg-gray-300'
                      } ${savingHidden ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-300 shadow-sm ${
                        toggle.is_hidden ? 'translate-x-8' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 p-6 bg-blue-50 rounded-2xl border border-blue-100">
        <h3 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
          <span className="text-xl">ℹ️</span>
          So funktioniert es
        </h3>
        <ul className="text-sm text-blue-800 space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">•</span>
            <span><strong>✓ Online</strong> – Die Seite ist für alle Besucher frei zugänglich</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">•</span>
            <span><strong>🚧 Bald</strong> – Besucher, die die Seite aufrufen, sehen stattdessen eine „Bald verfügbar“-Meldung</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">•</span>
            <span><strong>🙈 Versteckt</strong> – Die Seite verschwindet komplett aus der Navigation; Besucher, die trotzdem dort landen, werden auf die Startseite weitergeleitet</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">•</span>
            <span>Als Admin siehst du immer alle Seiten, unabhängig von diesen Einstellungen</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
