"use client";

import { useCallback, useEffect, useState } from "react";
import { IconPlus, IconRefresh, IconTrash, IconUsers } from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Segmented,
  Select,
} from "@/components/ui/primitives";

interface CachedMember {
  id?: string;
  displayName: string;
  email: string;
  source: "entra" | "static";
}

interface RecipientGroupItem {
  id: string;
  name: string;
  description: string;
  entraGroupId: string | null;
  entraDisplayName: string | null;
  managedByArgus: boolean;
  staticMembers: string[];
  cachedEntraMembers: CachedMember[];
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  resolvedEmails: string[];
  memberCount: number;
}

interface EntraGroupOption {
  id: string;
  displayName: string;
  description: string;
  securityEnabled: boolean;
}

interface EntraUserOption {
  id: string;
  displayName: string;
  email: string;
}

type CreateMode = "create_entra" | "link_entra" | "local";

export default function RecipientGroupsPage() {
  const [groups, setGroups] = useState<RecipientGroupItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Create group state
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("create_entra");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newStaticEmails, setNewStaticEmails] = useState("");
  const [entraGroups, setEntraGroups] = useState<EntraGroupOption[]>([]);
  const [selectedEntraGroupId, setSelectedEntraGroupId] = useState("");
  const [directoryConnected, setDirectoryConnected] = useState<boolean>(false);
  const [creating, setCreating] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);

  // Member editing state
  const [userQuery, setUserQuery] = useState("");
  const [entraUsers, setEntraUsers] = useState<EntraUserOption[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [staticEmailInput, setStaticEmailInput] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);

  const loadGroups = useCallback(async () => {
    const res = await fetch("/api/recipient-groups");
    const body = await res.json();
    if (body.success) {
      const list = body.data as RecipientGroupItem[];
      setGroups(list);
      setSelectedId((prev) => (prev && list.some((g) => g.id === prev) ? prev : list[0]?.id ?? null));
    }
    setLoading(false);
  }, []);

  const loadEntraGroups = useCallback(async () => {
    const res = await fetch("/api/directory?kind=groups");
    const body = await res.json();
    if (body.success) {
      const items = (body.data?.items ?? []) as EntraGroupOption[];
      setDirectoryConnected(Boolean(body.data?.connected));
      setEntraGroups(items);
      setSelectedEntraGroupId((prev) => prev || items[0]?.id || "");
    }
  }, []);

  const searchEntraUsers = useCallback(async (q: string) => {
    setSearchingUsers(true);
    try {
      const res = await fetch(`/api/directory?kind=users&q=${encodeURIComponent(q)}`);
      const body = await res.json();
      if (body.success) {
        setDirectoryConnected(Boolean(body.data?.connected));
        setEntraUsers((body.data?.items ?? []) as EntraUserOption[]);
      }
    } finally {
      setSearchingUsers(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
    void loadEntraGroups();
    void searchEntraUsers("");
  }, [loadGroups, loadEntraGroups, searchEntraUsers]);

  const selected = groups.find((g) => g.id === selectedId) ?? null;

  function upsertGroup(item: RecipientGroupItem) {
    setGroups((prev) => {
      const exists = prev.some((g) => g.id === item.id);
      const next = exists ? prev.map((g) => (g.id === item.id ? item : g)) : [...prev, item];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
    setSelectedId(item.id);
  }

  async function bootstrapDefaults() {
    setBootstrapping(true);
    setMsg(null);
    try {
      const res = await fetch("/api/recipient-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bootstrap" }),
      });
      const body = await res.json();
      if (body.success) {
        await loadGroups();
        await loadEntraGroups();
        const warnCount = body.data.warnings?.length ?? 0;
        setMsg({
          ok: warnCount === 0,
          text:
            body.data.createdCount > 0
              ? `Created ${body.data.createdCount} standard group(s) (${body.data.skippedCount} already existed)${warnCount ? ` — ${warnCount} fallback(s) to local: ${body.data.warnings[0]}` : " in Entra ID"}.`
              : `All ${body.data.skippedCount} standard group(s) already exist.`,
        });
      } else {
        setMsg({ ok: false, text: body.error?.message ?? "Failed to create standard groups." });
      }
    } finally {
      setBootstrapping(false);
    }
  }

  async function createGroup() {
    setCreating(true);
    setMsg(null);
    const staticMembers = newStaticEmails
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const linked = entraGroups.find((g) => g.id === selectedEntraGroupId);
    const effectiveName =
      createMode === "link_entra" && !newName.trim() ? linked?.displayName ?? "" : newName.trim();

    try {
      const res = await fetch("/api/recipient-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          mode: createMode,
          name: effectiveName,
          description: newDesc.trim(),
          entraGroupId: createMode === "link_entra" ? selectedEntraGroupId : undefined,
          staticMembers,
        }),
      });
      const body = await res.json();
      if (body.success) {
        upsertGroup(body.data);
        setShowCreate(false);
        setNewName("");
        setNewDesc("");
        setNewStaticEmails("");
        setMsg({ ok: true, text: `Created group "${body.data.name}".` });
      } else {
        setMsg({ ok: false, text: body.error?.message ?? "Failed to create group." });
      }
    } finally {
      setCreating(false);
    }
  }

  async function syncSelected() {
    if (!selected) return;
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/recipient-groups/${selected.id}/sync`, { method: "POST" });
      const body = await res.json();
      if (body.success) {
        upsertGroup(body.data);
        setMsg({ ok: true, text: `Synced ${body.data.cachedEntraMembers.length} Entra user(s) for "${selected.name}".` });
      } else {
        await loadGroups();
        setMsg({ ok: false, text: body.error?.message ?? "Sync failed." });
      }
    } finally {
      setSyncing(false);
    }
  }

  async function deleteSelected() {
    if (!selected) return;
    const targetName = selected.name;
    const res = await fetch(`/api/recipient-groups/${selected.id}`, { method: "DELETE" });
    const body = await res.json();
    if (body.success) {
      const remaining = groups.filter((g) => g.id !== selected.id);
      setGroups(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setMsg({ ok: true, text: `Deleted recipient group "${targetName}".` });
    }
  }

  async function addStaticMember() {
    if (!selected || !staticEmailInput.trim()) return;
    setMemberBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/recipient-groups/${selected.id}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "static", email: staticEmailInput.trim() }),
      });
      const body = await res.json();
      if (body.success) {
        upsertGroup(body.data);
        setStaticEmailInput("");
      } else {
        setMsg({ ok: false, text: body.error?.message ?? "Could not add address." });
      }
    } finally {
      setMemberBusy(false);
    }
  }

  async function removeStaticMember(email: string) {
    if (!selected) return;
    setMemberBusy(true);
    try {
      const res = await fetch(`/api/recipient-groups/${selected.id}/members`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "static", email }),
      });
      const body = await res.json();
      if (body.success) upsertGroup(body.data);
    } finally {
      setMemberBusy(false);
    }
  }

  async function addEntraUser(userId: string) {
    if (!selected) return;
    setMemberBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/recipient-groups/${selected.id}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "entra", userId }),
      });
      const body = await res.json();
      if (body.success) {
        upsertGroup(body.data);
      } else {
        setMsg({ ok: false, text: body.error?.message ?? "Failed to add Entra user." });
      }
    } finally {
      setMemberBusy(false);
    }
  }

  async function removeEntraUser(userId: string) {
    if (!selected) return;
    setMemberBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/recipient-groups/${selected.id}/members`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "entra", userId }),
      });
      const body = await res.json();
      if (body.success) upsertGroup(body.data);
      else setMsg({ ok: false, text: body.error?.message ?? "Failed to remove Entra user." });
    } finally {
      setMemberBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="recipients-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">Managed recipient groups</h2>
          <p className="mt-0.5 text-xs text-fg-muted leading-relaxed">
            Provision and manage Entra ID Security Groups or local distribution lists, inspect resolved member emails, and attach them to scheduled jobs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void bootstrapDefaults()}
            disabled={bootstrapping}
            data-testid="bootstrap-groups-btn"
          >
            {bootstrapping ? "Provisioning…" : "Create standard groups (3)"}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setShowCreate((s) => !s)}
            data-testid="toggle-create-group"
          >
            <IconPlus className="h-3.5 w-3.5" /> New group
          </Button>
        </div>
      </div>

      {msg && (
        <p
          className={`rounded-md border px-3 py-2 text-xs ${
            msg.ok ? "border-success/30 bg-success/5 text-success" : "border-warning/30 bg-warning/5 text-warning"
          }`}
          data-testid="recipient-groups-msg"
        >
          {msg.ok ? "✓" : "!"} {msg.text}
        </p>
      )}

      {showCreate && (
        <Card data-testid="create-group-card">
          <CardHeader>
            <CardTitle>Create or link recipient group</CardTitle>
            <Segmented<CreateMode>
              value={createMode}
              onChange={setCreateMode}
              options={[
                { value: "create_entra", label: "Create Entra Group" },
                { value: "link_entra", label: "Link Existing Entra" },
                { value: "local", label: "Local Group" },
              ]}
            />
          </CardHeader>
          <CardContent className="space-y-4">
            {createMode === "link_entra" && (
              <div>
                <Label>Entra ID group</Label>
                <Select
                  value={selectedEntraGroupId}
                  onChange={(e) => setSelectedEntraGroupId(e.target.value)}
                  disabled={!entraGroups.length}
                  data-testid="link-entra-select"
                >
                  {!entraGroups.length ? (
                    <option value="">
                      {directoryConnected ? "No Entra groups found" : "Connect Microsoft 365 first"}
                    </option>
                  ) : (
                    entraGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.displayName} {g.securityEnabled ? "(Security)" : "(M365)"}
                      </option>
                    ))
                  )}
                </Select>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Group name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={createMode === "link_entra" ? "Defaults to Entra group name" : "Argus - SecOps"}
                  data-testid="new-group-name"
                />
              </div>
              <div>
                <Label>Description <span className="text-fg-muted/50">(optional)</span></Label>
                <Input
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Receives security and risk digests"
                  data-testid="new-group-desc"
                />
              </div>
            </div>

            <div>
              <Label>Additional static / external emails <span className="text-fg-muted/50">(comma-separated, optional)</span></Label>
              <Input
                value={newStaticEmails}
                onChange={(e) => setNewStaticEmails(e.target.value)}
                placeholder="soc@contoso.com, oncall@contoso.com"
                data-testid="new-group-static"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="primary" size="sm" onClick={() => void createGroup()} disabled={creating} data-testid="submit-create-group">
                {creating ? "Creating…" : "Create group"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-xs text-fg-muted">Loading recipient groups…</p>
      ) : groups.length === 0 ? (
        <EmptyState
          title="No recipient groups yet"
          hint="Create standard Entra-backed distribution groups or build a custom group, then attach them to report jobs."
          action={
            <Button type="button" variant="primary" size="sm" onClick={() => void bootstrapDefaults()} disabled={bootstrapping}>
              Create 3 standard groups
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          {/* Left pane: group list */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xs">
                <IconUsers className="h-3.5 w-3.5 text-fg-muted" />
                Groups ({groups.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border/40 p-0">
              {groups.map((g) => {
                const active = g.id === selected?.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setSelectedId(g.id)}
                    data-testid={`group-row-${g.id}`}
                    className={`flex w-full items-start justify-between gap-2 px-4 py-3 text-left transition-colors ${
                      active ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/40 hover:text-fg"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-fg">{g.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge className="text-[9px]">
                          {g.entraGroupId ? (g.managedByArgus ? "Entra Managed" : "Entra Linked") : "Local"}
                        </Badge>
                        {g.lastSyncError && (
                          <span className="text-[10px] text-warning">sync warning</span>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
                      {g.memberCount}
                    </span>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* Right pane: member management */}
          {selected && (
            <Card data-testid="group-detail">
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle className="truncate">{selected.name}</CardTitle>
                  {selected.description && (
                    <p className="mt-0.5 text-xs text-fg-muted">{selected.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selected.entraGroupId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={syncing}
                      onClick={() => void syncSelected()}
                      data-testid="sync-group-btn"
                    >
                      <IconRefresh className="h-3.5 w-3.5" /> {syncing ? "Syncing…" : "Sync Entra"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void deleteSelected()}
                    data-testid="delete-group-btn"
                  >
                    <IconTrash className="h-3.5 w-3.5 text-danger" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {selected.entraGroupId ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-fg-muted">
                        Entra Group ID: <code className="font-mono text-fg">{selected.entraGroupId}</code>
                      </span>
                      <span className="text-[11px] text-fg-muted">
                        Last synced: {selected.lastSyncedAt ? new Date(selected.lastSyncedAt).toLocaleString() : "never"}
                      </span>
                    </div>
                    {selected.lastSyncError && (
                      <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning">
                        ! {selected.lastSyncError}
                      </p>
                    )}

                    {/* Directory user picker */}
                    <div className="space-y-2 rounded-lg border border-border/50 bg-surface-2/20 p-3">
                      <div className="flex items-center gap-2">
                        <Input
                          value={userQuery}
                          onChange={(e) => setUserQuery(e.target.value)}
                          placeholder="Filter Entra users by name or email…"
                          data-testid="entra-user-search"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={searchingUsers}
                          onClick={() => void searchEntraUsers(userQuery)}
                        >
                          {searchingUsers ? "…" : "Search"}
                        </Button>
                      </div>
                      <div className="max-h-40 divide-y divide-border/40 overflow-auto rounded border border-border/40 bg-surface">
                        {entraUsers.length === 0 ? (
                          <p className="px-3 py-2 text-[11px] text-fg-muted">
                            {directoryConnected ? "No matching Entra users." : "Connect Microsoft 365 to browse directory users."}
                          </p>
                        ) : (
                          entraUsers.slice(0, 20).map((u) => {
                            const already = selected.cachedEntraMembers.some(
                              (m) => m.id === u.id || m.email.toLowerCase() === u.email.toLowerCase(),
                            );
                            return (
                              <div key={u.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-fg">{u.displayName}</p>
                                  <p className="truncate font-mono text-[10px] text-fg-muted">{u.email}</p>
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={already || memberBusy}
                                  onClick={() => void addEntraUser(u.id)}
                                >
                                  {already ? "Added" : "Add"}
                                </Button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Current Entra members */}
                    <div>
                      <Label>Entra group members ({selected.cachedEntraMembers.length})</Label>
                      {selected.cachedEntraMembers.length === 0 ? (
                        <p className="text-xs text-fg-muted">No Entra members synced yet.</p>
                      ) : (
                        <div className="divide-y divide-border/40 rounded-lg border border-border/50">
                          {selected.cachedEntraMembers.map((m) => (
                            <div key={m.email} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                              <div className="min-w-0">
                                <span className="font-medium text-fg">{m.displayName}</span>{" "}
                                <span className="font-mono text-[11px] text-fg-muted">({m.email})</span>
                              </div>
                              {m.id && (
                                <button
                                  type="button"
                                  onClick={() => void removeEntraUser(m.id!)}
                                  disabled={memberBusy}
                                  className="text-[11px] text-fg-muted hover:text-danger"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="rounded border border-border/50 bg-surface-2/30 px-3 py-2 text-xs text-fg-muted">
                    Local group — manages explicit static email addresses without modifying Entra ID.
                  </p>
                )}

                {/* Static / external email addresses */}
                <div className="space-y-2 border-t border-border/40 pt-4">
                  <Label>Static / external addresses ({selected.staticMembers.length})</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="email"
                      value={staticEmailInput}
                      onChange={(e) => setStaticEmailInput(e.target.value)}
                      placeholder="external-soc@contoso.com"
                      data-testid="static-member-input"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={memberBusy || !staticEmailInput.trim()}
                      onClick={() => void addStaticMember()}
                      data-testid="add-static-member-btn"
                    >
                      Add email
                    </Button>
                  </div>
                  {selected.staticMembers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {selected.staticMembers.map((email) => (
                        <span
                          key={email}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-surface-2/40 px-2.5 py-1 font-mono text-[11px] text-fg"
                        >
                          {email}
                          <button
                            type="button"
                            onClick={() => void removeStaticMember(email)}
                            className="text-fg-muted hover:text-danger"
                            aria-label={`Remove ${email}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Resolved recipients preview */}
                <div className="space-y-1.5 border-t border-border/40 pt-4">
                  <Label className="mb-0">Effective delivery recipients ({selected.resolvedEmails.length})</Label>
                  {selected.resolvedEmails.length === 0 ? (
                    <p className="text-xs text-fg-muted">No deliverable addresses yet.</p>
                  ) : (
                    <p className="font-mono text-[11px] text-fg-muted" data-testid="group-resolved-emails">
                      {selected.resolvedEmails.join(", ")}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
