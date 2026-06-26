"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  IconButton,
  InlineLoading,
  InlineNotification,
  Modal,
  TextInput,
  Select,
  SelectItem,
  FilterableMultiSelect,
  Tag,
  Tile,
} from "@carbon/react";
import { Add, TrashCan, Renew, Information } from "@carbon/icons-react";
import type {
  Site,
  Floor,
  SpotType,
  SpotWithAvailability,
  SpotGroupListItem,
  SiteCapacity,
  AssignedSpot,
} from "@reservation/shared";
import { api, ApiError, type AdminUserItem } from "@/lib/api";

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Etichetta typeahead di una postazione nel sottoinsieme filtrato (sede/piano/
// tipo sono già fissati dai filtri sopra, quindi basta codice + zona) +
// eventuale "· riservata a X" se già assegnata ad altro gruppo.
// Uguaglianza tra due Set<string> (per rilevare modifiche non salvate).
function setEq(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// Etichetta di un utente nella multiselect membri: aggiunge "— già in «X»" se
// l'utente appartiene già a un ALTRO gruppo (C7.1: appartenenza esclusiva →
// assegnarlo qui lo sposterebbe).
function memberOptionLabel(u: AdminUserItem, currentGroupName: string): string {
  const base = `${u.displayName} (${u.email})`;
  return u.reservedGroupName && u.reservedGroupName !== currentGroupName
    ? `${base} — già in «${u.reservedGroupName}»`
    : base;
}

function spotLabel(s: SpotWithAvailability, currentGroupName: string): string {
  const zone = s.zoneName ? ` - ${s.zoneName}` : "";
  const otherGroup =
    s.reservedGroupName && s.reservedGroupName !== currentGroupName
      ? ` · riservata a ${s.reservedGroupName}`
      : "";
  return `${s.code}${zone}${otherGroup}`;
}

export function AdminSpotGroupsList() {
  const [groups, setGroups] = useState<SpotGroupListItem[]>([]);
  const [capacity, setCapacity] = useState<SiteCapacity[]>([]);
  // Toggle del riquadro "info" che spiega come è calcolata la capienza.
  const [capacityInfoOpen, setCapacityInfoOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [sites, setSites] = useState<Site[]>([]);

  // Gruppo selezionato (editor aperto sotto la lista).
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SpotGroupListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.listAdminUsers().then(setUsers).catch(() => setUsers([]));
    api.listSites().then(setSites).catch(() => setSites([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    api
      .listSpotGroups()
      .then((res) => {
        if (cancelled) return;
        setGroups(res.groups);
        setCapacity(res.capacity);
      })
      .catch((e: ApiError) => {
        if (cancelled) return;
        setError(`Caricamento gruppi: ${e.message}`);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteSpotGroup(deleteTarget.id);
      setSuccessMsg(`Gruppo "${deleteTarget.name}" eliminato (postazioni liberate).`);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
      setReloadTick((t) => t + 1);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Errore imprevisto";
      setError(`Eliminazione fallita: ${msg}`);
    } finally {
      setDeleting(false);
    }
  }


  return (
    <main>
      <div className="rsv-page-header-row">
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>
            Amministrazione — Postazioni riservate
          </h1>
          <p style={{ marginBottom: 0, color: "#525252" }}>
            Riserva postazioni a gruppi di utenti (es. Stagisti, Tutor). Solo i
            membri del gruppo potranno prenotare le postazioni assegnate.
          </p>
        </div>
      </div>

      {capacity.length > 0 && (
        <Tile style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <strong>Capienza per sede</strong>
            <IconButton
              kind="ghost"
              size="sm"
              label="Come si calcola la capienza"
              align="bottom"
              onClick={() => setCapacityInfoOpen((v) => !v)}
            >
              <Information />
            </IconButton>
          </div>
          {capacityInfoOpen && (
            <p style={{ color: "#525252", fontSize: "0.8125rem", margin: "0.25rem 0 0.5rem" }}>
              Per ogni sede e tipo: <strong>totale</strong> = postazioni attive;{" "}
              <strong>riservate</strong> = assegnate a un gruppo (prenotabili solo
              dai membri); <strong>libere</strong> = prenotabili da tutti
              (totale − riservate).
            </p>
          )}
          <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
            <table className="rsv-capacity-table">
              <thead>
                <tr>
                  <th>Sede</th>
                  <th>Posti auto (ris./tot · liberi)</th>
                  <th>Scrivanie (ris./tot · liberi)</th>
                </tr>
              </thead>
              <tbody>
                {capacity.map((c) => (
                  <tr key={c.siteId}>
                    <td>{c.siteName}</td>
                    <td>
                      {c.PARKING.reserved}/{c.PARKING.total} · {c.PARKING.free} liberi
                    </td>
                    <td>
                      {c.DESK.reserved}/{c.DESK.total} · {c.DESK.free} liberi
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tile>
      )}

      {error && (
        <InlineNotification
          kind="error"
          title="Errore"
          subtitle={error}
          onCloseButtonClick={() => setError(null)}
          style={{ marginBottom: "1rem" }}
        />
      )}
      {successMsg && (
        <InlineNotification
          kind="success"
          title="Operazione completata"
          subtitle={successMsg}
          onCloseButtonClick={() => setSuccessMsg(null)}
          style={{ marginBottom: "1rem" }}
        />
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
        }}
      >
        <Button kind="tertiary" size="sm" renderIcon={Add} onClick={() => setAddOpen(true)}>
          Aggiungi gruppo
        </Button>
        <IconButton
          kind="ghost"
          size="sm"
          label="Aggiorna"
          align="bottom-right"
          onClick={() => setReloadTick((t) => t + 1)}
          disabled={loading}
        >
          <Renew />
        </IconButton>
      </div>

      {loading ? (
        <InlineLoading description="Carico i gruppi…" />
      ) : groups.length === 0 ? (
        <p style={{ color: "#525252" }}>Nessun gruppo. Creane uno per iniziare.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {groups.map((g) => (
            <Tile
              key={g.id}
              className={
                selectedId === g.id ? "rsv-group-tile rsv-group-tile--active" : "rsv-group-tile"
              }
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="rsv-group-tile-main"
                  onClick={() => setSelectedId(selectedId === g.id ? null : g.id)}
                >
                  <strong>{g.name}</strong>
                  <span style={{ color: "#525252", marginLeft: "0.75rem" }}>
                    {g.memberCount} membr{g.memberCount === 1 ? "o" : "i"} ·{" "}
                    {g.spotCount} postazion{g.spotCount === 1 ? "e" : "i"}
                  </span>
                </button>
                <div style={{ display: "flex", gap: "0.25rem" }}>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() => setSelectedId(selectedId === g.id ? null : g.id)}
                  >
                    {selectedId === g.id ? "Chiudi" : "Gestisci"}
                  </Button>
                  <IconButton
                    kind="ghost"
                    size="sm"
                    label="Elimina gruppo"
                    align="bottom-right"
                    onClick={() => setDeleteTarget(g)}
                  >
                    <TrashCan />
                  </IconButton>
                </div>
              </div>

              {selectedId === g.id && (
                <GroupEditor
                  groupId={g.id}
                  groupName={g.name}
                  users={users}
                  sites={sites}
                  // Solo refresh (lista + capienza); il messaggio di successo
                  // è mostrato inline dall'editor, vicino al gruppo.
                  onSaved={() => setReloadTick((t) => t + 1)}
                  onError={(msg) => setError(msg)}
                />
              )}
            </Tile>
          ))}
        </div>
      )}

      <AddGroupDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(name) => {
          setSuccessMsg(`Gruppo "${name}" creato.`);
          setAddOpen(false);
          setReloadTick((t) => t + 1);
        }}
        onError={(msg) => setError(msg)}
      />

      <Modal
        open={deleteTarget !== null}
        danger
        modalHeading="Eliminare il gruppo?"
        primaryButtonText={deleting ? "Eliminazione…" : "Elimina"}
        secondaryButtonText="Annulla"
        primaryButtonDisabled={deleting}
        onRequestClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onRequestSubmit={confirmDelete}
      >
        {deleteTarget && (
          <p>
            Stai per eliminare il gruppo <strong>{deleteTarget.name}</strong>. Le
            sue {deleteTarget.spotCount} postazioni torneranno{" "}
            <strong>aperte a tutti</strong>; i membri non vengono cancellati. Le
            prenotazioni esistenti non vengono toccate.
          </p>
        )}
      </Modal>
    </main>
  );
}

// ───────────────────────── Editor membri + postazioni ─────────────────────────

interface GroupEditorProps {
  groupId: string;
  groupName: string;
  users: AdminUserItem[];
  sites: Site[];
  // Notifica il parent che dati sono cambiati → refresh lista/capienza
  // (il messaggio di successo è mostrato INLINE nell'editor, non dal parent).
  onSaved: () => void;
  onError: (msg: string) => void;
}

function GroupEditor({ groupId, groupName, users, sites, onSaved, onError }: GroupEditorProps) {
  const [loading, setLoading] = useState(true);
  const [editorMsg, setEditorMsg] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  // Insieme COMPLETO delle postazioni assegnate (persiste tra i cambi filtro:
  // i filtri sotto restringono solo il sottoinsieme visibile nella multiselect).
  const [assignedSpotIds, setAssignedSpotIds] = useState<Set<string>>(new Set());
  // Stato salvato (al load / dopo Salva): serve a rilevare se ci sono modifiche
  // da salvare ("dirty") e mostrare i tasti Salva solo quando servono.
  const [savedMemberIds, setSavedMemberIds] = useState<Set<string>>(new Set());
  const [savedSpotIds, setSavedSpotIds] = useState<Set<string>>(new Set());
  // id → dettaglio (sede/piano/zona/codice) per mostrare l'elenco completo delle
  // riservate come chip, SENZA filtrare sede per sede. Seminata dal dettaglio
  // gruppo e arricchita quando si selezionano spot dal filtro corrente.
  const [spotInfo, setSpotInfo] = useState<Map<string, AssignedSpot>>(new Map());
  const [savingMembers, setSavingMembers] = useState(false);
  const [savingSpots, setSavingSpots] = useState(false);
  // Conferma spostamento: aperto quando si salvano membri che appartengono già
  // a un altro gruppo (C7.1: assegnarli qui li sposta).
  const [moveConfirmOpen, setMoveConfirmOpen] = useState(false);

  // Filtri che scopano il sottoinsieme di postazioni mostrato nella multiselect.
  const [siteId, setSiteId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [type, setType] = useState<SpotType>("PARKING");
  const [floors, setFloors] = useState<Floor[]>([]);
  const [spots, setSpots] = useState<SpotWithAvailability[]>([]);

  // Carica dettaglio gruppo al mount / cambio gruppo.
  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    api
      .getSpotGroup(groupId)
      .then((d) => {
        if (cancelled) return;
        const m = new Set(d.members.map((mm) => mm.id));
        const sp = new Set(d.spots.map((s) => s.id));
        setMemberIds(m);
        setSavedMemberIds(m);
        setAssignedSpotIds(sp);
        setSavedSpotIds(sp);
        setSpotInfo(new Map(d.spots.map((s) => [s.id, s])));
      })
      .catch((e: ApiError) => onError(`Caricamento gruppo: ${e.message}`))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, onError]);

  useEffect(() => {
    if (!siteId) {
      setFloors([]);
      setFloorId("");
      return;
    }
    setFloorId("");
    api.listFloors(siteId).then(setFloors).catch(() => setFloors([]));
  }, [siteId]);

  // Sottoinsieme di postazioni per la multiselect (filtrato per sede/piano/tipo).
  useEffect(() => {
    if (!siteId) {
      setSpots([]);
      return;
    }
    let cancelled = false;
    api
      .listAdminSpots({ type, date: todayIso(), siteId, floorId: floorId || undefined })
      .then((res) => {
        if (!cancelled) setSpots(res.items);
      })
      .catch(() => {
        if (!cancelled) setSpots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [type, siteId, floorId]);

  const selectedUsers = useMemo(
    () => users.filter((u) => memberIds.has(u.id)),
    [users, memberIds],
  );
  // Membri selezionati che appartengono già a un ALTRO gruppo → verranno
  // spostati al salvataggio (C7.1). Usato per l'avviso di conferma.
  const membersToMove = useMemo(
    () =>
      selectedUsers.filter(
        (u) => u.reservedGroupName && u.reservedGroupName !== groupName,
      ),
    [selectedUsers, groupName],
  );
  // Postazioni del sottoinsieme corrente che sono assegnate (per la multiselect).
  const selectedSpots = useMemo(
    () => spots.filter((s) => assignedSpotIds.has(s.id)),
    [spots, assignedSpotIds],
  );

  // Merge: la multiselect gestisce solo il sottoinsieme filtrato. Aggiorniamo
  // l'insieme completo rimpiazzando solo la porzione del filtro corrente, così
  // le selezioni fatte con altri filtri NON vengono perse.
  function onSpotsChange(selected: SpotWithAvailability[]) {
    setAssignedSpotIds((prev) => {
      const subsetIds = new Set(spots.map((s) => s.id));
      const keptOutside = [...prev].filter((id) => !subsetIds.has(id));
      return new Set([...keptOutside, ...selected.map((s) => s.id)]);
    });
    // Arricchisco la mappa info con i nomi (sede/piano dal contesto del filtro
    // corrente) così le chip mostrano l'etichetta anche cambiando filtro.
    const siteName = sites.find((s) => s.id === siteId)?.name ?? "—";
    setSpotInfo((prev) => {
      const next = new Map(prev);
      for (const s of selected) {
        next.set(s.id, {
          id: s.id,
          code: s.code,
          type: s.type,
          zoneName: s.zoneName,
          siteName,
          floorName: floors.find((f) => f.id === s.floorId)?.name ?? "—",
        });
      }
      return next;
    });
  }

  // Ci sono modifiche non salvate? (confronto col set salvato). I tasti Salva
  // compaiono solo se "dirty".
  const membersDirty = useMemo(
    () => !setEq(memberIds, savedMemberIds),
    [memberIds, savedMemberIds],
  );
  const spotsDirty = useMemo(
    () => !setEq(assignedSpotIds, savedSpotIds),
    [assignedSpotIds, savedSpotIds],
  );

  // Elenco completo delle riservate (per le chip), ordinato per sede→codice.
  const assignedList = useMemo(() => {
    return [...assignedSpotIds]
      .map((id) => spotInfo.get(id) ?? null)
      .filter((s): s is AssignedSpot => s !== null)
      .sort(
        (a, b) =>
          a.siteName.localeCompare(b.siteName) || a.code.localeCompare(b.code),
      );
  }, [assignedSpotIds, spotInfo]);

  function removeSpot(id: string) {
    setAssignedSpotIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function removeMember(id: string) {
    setMemberIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // Click su "Salva membri": se ci sono utenti da spostare da un altro gruppo
  // chiedo conferma, altrimenti salvo subito.
  function saveMembers() {
    if (membersToMove.length > 0) {
      setMoveConfirmOpen(true);
      return;
    }
    void doSaveMembers();
  }

  async function doSaveMembers() {
    setMoveConfirmOpen(false);
    setSavingMembers(true);
    try {
      await api.setSpotGroupMembers(groupId, Array.from(memberIds));
      // Messaggio INLINE nell'editor (vicino al gruppo): se sto modificando un
      // gruppo in fondo alla lista, un banner in cima alla pagina mi sfuggirebbe.
      setEditorMsg(`Membri aggiornati (${memberIds.size}).`);
      setSavedMemberIds(new Set(memberIds)); // reset "dirty"
      onSaved();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Errore salvataggio membri");
    } finally {
      setSavingMembers(false);
    }
  }

  async function saveSpots() {
    setSavingSpots(true);
    try {
      await api.setSpotGroupSpots(groupId, Array.from(assignedSpotIds));
      setEditorMsg(`Postazioni aggiornate (${assignedSpotIds.size}).`);
      setSavedSpotIds(new Set(assignedSpotIds)); // reset "dirty"
      onSaved();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Errore salvataggio postazioni");
    } finally {
      setSavingSpots(false);
    }
  }

  if (loading) {
    return <InlineLoading description="Carico il gruppo…" />;
  }

  return (
    <div
      style={{
        marginTop: "1rem",
        paddingTop: "1rem",
        borderTop: "1px solid #e0e0e0",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      }}
    >
      {editorMsg && (
        <InlineNotification
          kind="success"
          title="Salvato"
          subtitle={editorMsg}
          onCloseButtonClick={() => setEditorMsg(null)}
          lowContrast
          style={{ maxWidth: "none" }}
        />
      )}

      {/* ── Sezione MEMBRI ──
          Struttura simmetrica alla sezione Postazioni: label+conteggio →
          chip della selezione corrente (con "rimuovi tutti" e nota di salvataggio)
          → controllo per aggiungere (multiselect + Salva). */}
      <div>
        <h4 className="rsv-group-section-title">Membri ({memberIds.size})</h4>

        {/* Selezione corrente: chip blu rimovibili (tutte insieme col tasto).
            Il blocco è sempre visibile (anche senza chip) per coerenza. */}
        <div style={{ marginBottom: "0.75rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              flexWrap: "wrap",
              marginBottom: "0.25rem",
            }}
          >
            <span style={{ color: "#525252", fontSize: "0.8125rem" }}>
              Elenco membri attuali (clicca la × per toglierne uno o il tasto per
              rimuoverli tutti):
            </span>
            <Button
              kind="danger--ghost"
              size="sm"
              renderIcon={TrashCan}
              onClick={() => setMemberIds(new Set())}
              disabled={selectedUsers.length === 0}
            >
              Rimuovi tutti i membri
            </Button>
          </div>
          {selectedUsers.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
              {selectedUsers.map((u) => (
                <Tag
                  key={u.id}
                  type="blue"
                  filter
                  onClose={() => removeMember(u.id)}
                  title="Togli dal gruppo"
                >
                  <span title={`${u.displayName} · ${u.email}`}>{u.displayName}</span>
                </Tag>
              ))}
            </div>
          ) : (
            <p style={{ color: "#8d8d8d", fontSize: "0.8125rem", margin: 0 }}>
              Nessun membro selezionato.
            </p>
          )}
          <p style={{ color: "#8d8d8d", fontSize: "0.75rem", margin: "0.25rem 0 0" }}>
            Le modifiche (rimozioni incluse) si applicano con{" "}
            <strong>Salva membri</strong>.
          </p>
        </div>

        {/* Aggiungi membri: typeahead multiselezione. */}
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <FilterableMultiSelect
            id={`group-members-${groupId}`}
            titleText=""
            placeholder="Cerca e seleziona utenti…"
            items={users}
            itemToString={(u: AdminUserItem | null) =>
              u ? memberOptionLabel(u, groupName) : ""
            }
            selectedItems={selectedUsers}
            onChange={({ selectedItems }: { selectedItems: AdminUserItem[] | null }) =>
              setMemberIds(new Set((selectedItems ?? []).map((u) => u.id)))
            }
          />
        </div>

        {/* Salva membri: riga propria sotto la select. Compare solo quando ci
            sono modifiche da salvare. */}
        {membersDirty && (
          <div style={{ marginTop: "0.5rem" }}>
            <Button size="md" onClick={saveMembers} disabled={savingMembers}>
              {savingMembers ? "Salvataggio…" : "Salva membri"}
            </Button>
          </div>
        )}
      </div>

      {/* ── Sezione POSTAZIONI RISERVATE ──
          Stessa struttura: label+conteggio → chip della selezione corrente
          (tutte le sedi, così non serve filtrare per vederle) → controllo per
          aggiungere (filtri Sede/Piano/Tipo che scopano il sottoinsieme + una
          FilterableMultiSelect su quel sottoinsieme + Salva). Il conteggio è
          sull'insieme COMPLETO, anche selezioni fatte con altri filtri. */}
      <div>
        <h4 className="rsv-group-section-title">
          Postazioni riservate ({assignedSpotIds.size} assegnate in totale)
        </h4>

        {/* Selezione corrente: chip (viola=auto, giallo=scrivania) rimovibili.
            Il blocco è sempre visibile (anche senza chip) per coerenza. */}
        <div style={{ marginBottom: "0.75rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              flexWrap: "wrap",
              marginBottom: "0.25rem",
            }}
          >
            <span style={{ color: "#525252", fontSize: "0.8125rem" }}>
              Elenco postazioni attualmente riservate (clicca la × per toglierne
              una o il tasto per rimuoverle tutte):
            </span>
            <Button
              kind="danger--ghost"
              size="sm"
              renderIcon={TrashCan}
              onClick={() => setAssignedSpotIds(new Set())}
              disabled={assignedSpotIds.size === 0}
            >
              Rimuovi tutte le postazioni
            </Button>
          </div>
          {assignedSpotIds.size > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
              {assignedList.map((s) => (
                <Tag
                  key={s.id}
                  className={
                    s.type === "PARKING" ? "rsv-spot-tag--parking" : "rsv-spot-tag--desk"
                  }
                  filter
                  onClose={() => removeSpot(s.id)}
                  title="Togli dalla riserva"
                >
                  {/* title sullo span = tooltip nativo del TESTO (il title del Tag
                      con filter è invece quello del bottone ×). Mostra l'etichetta
                      completa se la chip viene troncata. */}
                  <span
                    title={[
                      s.code,
                      s.zoneName,
                      `${s.siteName} · ${s.floorName}`,
                      s.type === "PARKING" ? "Posto auto" : "Scrivania",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {s.code}
                    {s.zoneName ? ` · ${s.zoneName}` : ""} · {s.siteName}
                  </span>
                </Tag>
              ))}
              {assignedList.length < assignedSpotIds.size && (
                <span style={{ color: "#8d8d8d", fontSize: "0.8125rem", alignSelf: "center" }}>
                  +{assignedSpotIds.size - assignedList.length} in attesa di dettagli…
                </span>
              )}
            </div>
          ) : (
            <p style={{ color: "#8d8d8d", fontSize: "0.8125rem", margin: 0 }}>
              Nessuna postazione riservata.
            </p>
          )}
          <p style={{ color: "#8d8d8d", fontSize: "0.75rem", margin: "0.25rem 0 0" }}>
            Le modifiche (rimozioni incluse) si applicano con{" "}
            <strong>Salva postazioni</strong>.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "0.75rem",
            marginBottom: "0.75rem",
          }}
        >
          <Select
            id={`group-site-${groupId}`}
            labelText="Sede"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
          >
            <SelectItem value="" text="Seleziona sede…" />
            {sites.map((s) => (
              <SelectItem key={s.id} value={s.id} text={s.name} />
            ))}
          </Select>
          <Select
            id={`group-floor-${groupId}`}
            labelText="Piano (opzionale)"
            value={floorId}
            onChange={(e) => setFloorId(e.target.value)}
            disabled={!siteId}
          >
            <SelectItem value="" text="Tutti i piani" />
            {floors.map((f) => (
              <SelectItem key={f.id} value={f.id} text={f.name} />
            ))}
          </Select>
          <Select
            id={`group-type-${groupId}`}
            labelText="Tipo"
            value={type}
            onChange={(e) => setType(e.target.value as SpotType)}
          >
            <SelectItem value="PARKING" text="Posti auto" />
            <SelectItem value="DESK" text="Scrivanie" />
          </Select>
        </div>

        {!siteId ? (
          <p style={{ color: "#525252" }}>Seleziona una sede per assegnare le postazioni.</p>
        ) : (
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <FilterableMultiSelect
              id={`group-spots-${groupId}`}
              titleText=""
              placeholder="Cerca e seleziona postazioni (codice, zona)…"
              items={spots}
              itemToString={(s: SpotWithAvailability | null) =>
                s ? spotLabel(s, groupName) : ""
              }
              selectedItems={selectedSpots}
              onChange={({ selectedItems }: { selectedItems: SpotWithAvailability[] | null }) =>
                onSpotsChange(selectedItems ?? [])
              }
            />
          </div>
        )}
        <p style={{ color: "#525252", fontSize: "0.8125rem", marginTop: "0.5rem" }}>
          Cambiando filtro le selezioni fatte con altri filtri restano (il
          conteggio in alto è il totale). Le postazioni &ldquo;riservata a
          …&rdquo; sono già di un altro gruppo: selezionandole le sposti qui.
        </p>

        {/* Salva postazioni: fuori dal blocco "sede selezionata" così resta
            disponibile anche solo per rimozioni (chip / rimuovi tutte). Compare
            solo quando ci sono modifiche da salvare. */}
        {spotsDirty && (
          <div style={{ marginTop: "0.5rem" }}>
            <Button size="md" onClick={saveSpots} disabled={savingSpots}>
              {savingSpots ? "Salvataggio…" : "Salva postazioni"}
            </Button>
          </div>
        )}
      </div>

      {/* Conferma spostamento membri da altri gruppi (C7.1: appartenenza
          esclusiva). Elenca chi verrà spostato e da dove. */}
      <Modal
        open={moveConfirmOpen}
        modalHeading="Spostare questi utenti?"
        primaryButtonText={savingMembers ? "Salvataggio…" : "Sposta e salva"}
        secondaryButtonText="Annulla"
        primaryButtonDisabled={savingMembers}
        onRequestClose={() => {
          if (!savingMembers) setMoveConfirmOpen(false);
        }}
        onRequestSubmit={() => void doSaveMembers()}
      >
        <p style={{ marginBottom: "0.75rem" }}>
          Un utente può appartenere a un solo gruppo. Questi utenti sono già in
          un altro gruppo e verranno <strong>spostati</strong> in «{groupName}»
          (lasciando il gruppo precedente):
        </p>
        <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
          {membersToMove.map((u) => (
            <li key={u.id}>
              {u.displayName} — da «{u.reservedGroupName}»
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

// ───────────────────────── Dialog crea gruppo ─────────────────────────

interface AddGroupDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
  onError: (msg: string) => void;
}

function AddGroupDialog({ open, onClose, onCreated, onError }: AddGroupDialogProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const g = await api.createSpotGroup({ name: name.trim() });
      onCreated(g.name);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Errore creazione gruppo");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      modalHeading="Aggiungi gruppo"
      primaryButtonText={submitting ? "Creazione…" : "Crea gruppo"}
      secondaryButtonText="Annulla"
      primaryButtonDisabled={!name.trim() || submitting}
      onRequestClose={() => {
        if (!submitting) onClose();
      }}
      onRequestSubmit={handleSubmit}
    >
      <TextInput
        id="new-group-name"
        labelText="Nome del gruppo"
        placeholder="Es. Stagisti, Tutor, Primo intervento"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </Modal>
  );
}
