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

  // Member editing state (staged locally until explicit Save)
  const [userQuery, setUserQuery] = useState("");
  const [entraUsers, setEntraUsers] = useState<EntraUserOption[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [staticEmailInput, setStaticEmailInput] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);
  const [pendingAddUserIds, setPendingAddUserIds] = useState<string[]>([]);
  const [pendingRemoveUserIds, setPendingRemoveUserIds] = useState<string[]>([]);
  const [pendingAddEmails, setPendingAddEmails] = useState<string[]>([]);
  const [pendingRemoveEmails, setPendingRemoveEmails] = useState<string[]>([]);

  const clearPendingMembers = useCallback(() => {
    setPendingAddUserIds([]);
    setPendingRemoveUserIds([]);
    setPendingAddEmails([]);
    setPendingRemoveEmails([]);
  }, []);

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
    clearPendingMembers();
  }

  function selectGroup(id: string) {
    if (id !== selectedId) {
      setSelectedId(id);
      clearPendingMembers();
      setMsg(null);
    }
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
      clearPendingMembers();
      setMsg({ ok: true, text: `Deleted recipient group "${targetName}".` });
    }
  }

  function isEntraMember(u: EntraUserOption): boolean {
    if (!selected) return false;
    return selected.cachedEntraMembers.some(
      (m) => m.id === u.id || m.email.toLowerCase() === u.email.toLowerCase(),
    );
  }

  function toggleStageEntraUser(u: EntraUserOption) {
    if (!selected || memberBusy) return;
    setMsg(null);
    if (isEntraMember(u)) {
      setPendingRemoveUserIds((prev) =>
        prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id],
      );
      return;
    }
    setPendingAddUserIds((prev) =>
      prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id],
    );
  }

  function toggleStageRemoveMember(userId: string) {
    if (memberBusy) return;
    setMsg(null);
    setPendingRemoveUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  }

  function stageStaticEmail() {
    if (!selected || memberBusy) return;
    const email = staticEmailInput.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setMsg({ ok: false, text: "Enter a valid email address." });
      return;
    }
    setMsg(null);
    const key = email.toLowerCase();
    if (pendingRemoveEmails.some((e) => e.toLowerCase() === key)) {
      setPendingRemoveEmails((prev) => prev.filter((e) => e.toLowerCase() !== key));
      setStaticEmailInput("");
      return;
    }
    const alreadyExisting = selected.staticMembers.some((e) => e.toLowerCase() === key);
    const alreadyStaged = pendingAddEmails.some((e) => e.toLowerCase() === key);
    if (!alreadyExisting && !alreadyStaged) {
      setPendingAddEmails((prev) => [...prev, email]);
    }
    setStaticEmailInput("");
  }

  function unstageOrRemoveStaticEmail(email: string) {
    if (memberBusy) return;
    setMsg(null);
    const key = email.toLowerCase();
    if (pendingAddEmails.some((e) => e.toLowerCase() === key)) {
      setPendingAddEmails((prev) => prev.filter((e) => e.toLowerCase() !== key));
      return;
    }
    setPendingRemoveEmails((prev) =>
      prev.some((e) => e.toLowerCase() === key)
        ? prev.filter((e) => e.toLowerCase() !== key)
        : [...prev, email],
    );
  }

  const addCount = pendingAddUserIds.length + pendingAddEmails.length;
  const removeCount = pendingRemoveUserIds.length + pendingRemoveEmails.length;
  const pendingCount = addCount + removeCount;

  async function saveMemberChanges() {
    if (!selected || pendingCount === 0 || memberBusy) return;
    setMemberBusy(true);
    setMsg(null);
    const total = pendingCount;
    try {
      const res = await fetch(`/api/recipient-groups/${selected.id}/members`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          addEntraUserIds: pendingAddUserIds,
          removeEntraUserIds: pendingRemoveUserIds,
          addStaticEmails: pendingAddEmails,
          removeStaticEmails: pendingRemoveEmails,
        }),
      });
      const body = await res.json();
      if (body.success) {
        upsertGroup(body.data);
        setMsg({
          ok: true,
          text: `Saved ${total} member change(s) for "${selected.name}".`,
        });
      } else {
        setMsg({ ok: false, text: body.error?.message ?? "Failed to save member changes." });
      }
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
                    onClick={() => selectGroup(g.id)}
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
                <div className="flex shrink-0 items-center gap-2">
                  {selected.entraGroupId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={syncing || memberBusy}
                      onClick={() => void syncSelected()}
                      className="whitespace-nowrap shrink-0"
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

                    {/* Multi-select directory user picker */}
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
                          className="whitespace-nowrap shrink-0"
                        >
                          {searchingUsers ? "…" : "Search"}
                        </Button>
                      </div>
                      {(() => {
                        const q = userQuery.trim().toLowerCase();
                        const visibleUsers = entraUsers
                          .filter(
                            (u) =>
                              !q ||
                              u.displayName.toLowerCase().includes(q) ||
                              u.email.toLowerCase().includes(q),
                          )
                          .slice(0, 50);
                        return (
                          <>
                            <div className="flex items-center justify-between text-[11px] text-fg-muted">
                              <span>Check users to add or uncheck current members, then click Save changes below.</span>
                              {pendingAddUserIds.length > 0 && (
                                <span className="font-medium text-primary">
                                  {pendingAddUserIds.length} selected to add
                                </span>
                              )}
                            </div>
                            <div className="max-h-48 divide-y divide-border/40 overflow-auto rounded border border-border/40 bg-surface">
                              {visibleUsers.length === 0 ? (
                                <p className="px-3 py-2 text-[11px] text-fg-muted">
                                  {directoryConnected
                                    ? "No matching Entra users."
                                    : "Connect Microsoft 365 to browse directory users."}
                                </p>
                              ) : (
                                visibleUsers.map((u) => {
                                  const already = isEntraMember(u);
                                  const stagedAdd = pendingAddUserIds.includes(u.id);
                                  const stagedRemove = pendingRemoveUserIds.includes(u.id);
                                  const checked = (already && !stagedRemove) || stagedAdd;
                                  return (
                                    <label
                                      key={u.id}
                                      className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-xs transition-colors hover:bg-surface-2/40 ${
                                        stagedAdd
                                          ? "bg-primary/5"
                                          : stagedRemove
                                            ? "bg-danger/5"
                                            : ""
                                      }`}
                                    >
                                      <span className="flex min-w-0 items-center gap-2.5">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={memberBusy}
                                          onChange={() => toggleStageEntraUser(u)}
                                          className="h-3.5 w-3.5 shrink-0 accent-primary"
                                          data-testid={`entra-user-check-${u.id}`}
                                        />
                                        <span className="min-w-0">
                                          <span className="block truncate font-medium text-fg">{u.displayName}</span>
                                          <span className="block truncate font-mono text-[10px] text-fg-muted">{u.email}</span>
                                        </span>
                                      </span>
                                      <span className="shrink-0 font-mono text-[10px]">
                                        {stagedAdd ? (
                                          <span className="text-primary">+ Add</span>
                                        ) : stagedRemove ? (
                                          <span className="text-danger">− Remove</span>
                                        ) : already ? (
                                          <span className="text-fg-muted">Member</span>
                                        ) : null}
                                      </span>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    {/* Current Entra members */}
                    <div>
                      <Label>Entra group members ({selected.cachedEntraMembers.length})</Label>
                      {selected.cachedEntraMembers.length === 0 ? (
                        <p className="text-xs text-fg-muted">No Entra members synced yet.</p>
                      ) : (
                        <div className="divide-y divide-border/40 rounded-lg border border-border/50">
                          {selected.cachedEntraMembers.map((m) => {
                            const stagedRemove = Boolean(m.id && pendingRemoveUserIds.includes(m.id));
                            return (
                              <div
                                key={m.email}
                                className={`flex items-center justify-between gap-2 px-3 py-2 text-xs ${
                                  stagedRemove ? "bg-danger/5 opacity-60" : ""
                                }`}
                              >
                                <div className={`min-w-0 ${stagedRemove ? "line-through" : ""}`}>
                                  <span className="font-medium text-fg">{m.displayName}</span>{" "}
                                  <span className="font-mono text-[11px] text-fg-muted">({m.email})</span>
                                </div>
                                {m.id && (
                                  <button
                                    type="button"
                                    onClick={() => toggleStageRemoveMember(m.id!)}
                                    disabled={memberBusy}
                                    className={`shrink-0 text-[11px] ${
                                      stagedRemove ? "font-medium text-primary hover:underline" : "text-fg-muted hover:text-danger"
                                    }`}
                                  >
                                    {stagedRemove ? "Undo" : "Remove"}
                                  </button>
                                )}
                              </div>
                            );
                          })}
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
                  <Label>Static / external addresses ({selected.staticMembers.length + pendingAddEmails.length})</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="email"
                      value={staticEmailInput}
                      onChange={(e) => setStaticEmailInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          stageStaticEmail();
                        }
                      }}
                      placeholder="external-soc@contoso.com"
                      data-testid="static-member-input"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={memberBusy || !staticEmailInput.trim()}
                      onClick={stageStaticEmail}
                      className="whitespace-nowrap shrink-0"
                      data-testid="add-static-member-btn"
                    >
                      Add email
                    </Button>
                  </div>
                  {(selected.staticMembers.length > 0 || pendingAddEmails.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {selected.staticMembers.map((email) => {
                        const stagedRemove = pendingRemoveEmails.some((e) => e.toLowerCase() === email.toLowerCase());
                        return (
                          <span
                            key={email}
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] ${
                              stagedRemove
                                ? "border-danger/40 bg-danger/10 text-danger line-through"
                                : "border-border/60 bg-surface-2/40 text-fg"
                            }`}
                          >
                            {email}
                            <button
                              type="button"
                              onClick={() => unstageOrRemoveStaticEmail(email)}
                              className="text-fg-muted hover:text-danger"
                              aria-label={stagedRemove ? `Undo remove ${email}` : `Remove ${email}`}
                            >
                              {stagedRemove ? "↺" : "×"}
                            </button>
                          </span>
                        );
                      })}
                      {pendingAddEmails.map((email) => (
                        <span
                          key={`pending-${email}`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-2.5 py-1 font-mono text-[11px] text-primary"
                        >
                          +{email}
                          <button
                            type="button"
                            onClick={() => unstageOrRemoveStaticEmail(email)}
                            className="text-primary/80 hover:text-danger"
                            aria-label={`Unstage ${email}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Staged batch Save bar */}
                {pendingCount > 0 && (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3.5 py-2.5"
                    data-testid="save-members-bar"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-fg">{pendingCount} unsaved change(s)</span>
                      {addCount > 0 && <span className="font-mono text-[11px] text-primary">+{addCount} add</span>}
                      {removeCount > 0 && <span className="font-mono text-[11px] text-danger">−{removeCount} remove</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={memberBusy}
                        onClick={clearPendingMembers}
                        className="whitespace-nowrap"
                      >
                        Discard
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={memberBusy}
                        onClick={() => void saveMemberChanges()}
                        className="whitespace-nowrap"
                        data-testid="save-group-members-btn"
                      >
                        {memberBusy ? "Saving…" : "Save changes"}
                      </Button>
                    </div>
                  </div>
                )}

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
