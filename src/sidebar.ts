import type { SavedServer, ServerGroup, SortMode } from "./storage.js";
import type { SessionManager, SessionStatus } from "./sessions.js";

interface Handlers {
  onSelect: (server: SavedServer) => void;
  onActivate: (server: SavedServer) => void;
  onAdd: () => void;
  onEdit: (server: SavedServer) => void;
  onClose: (server: SavedServer) => void;
  onSortChange: (mode: SortMode) => void;
  onCollapseChange: (collapsed: boolean) => void;
  onScan: () => void;
  onGrid: () => void;
  onAddGroup: () => void;
  onRenameGroup: (group: ServerGroup) => void;
  onDeleteGroup: (group: ServerGroup) => void;
  onToggleGroup: (group: ServerGroup) => void;
  onMoveServerToGroup: (serverId: string, groupId: string | null) => void;
}

interface InitState {
  sort: SortMode;
  collapsed: boolean;
}

export class Sidebar {
  private root: HTMLElement;
  private list: HTMLDivElement;
  private items = new Map<string, HTMLDivElement>();
  private statuses = new Map<string, SessionStatus | "disconnected">();
  private activeId: string | null = null;
  private query = "";
  private sort: SortMode;
  private collapsed: boolean;
  private collapsedHandle: HTMLButtonElement;
  private searchInput: HTMLInputElement;
  private sortSelect: HTMLSelectElement;
  private groups: ServerGroup[] = [];

  constructor(
    root: HTMLElement,
    private servers: SavedServer[],
    sessions: SessionManager,
    private handlers: Handlers,
    init: InitState,
  ) {
    this.root = root;
    this.sort = init.sort;
    this.collapsed = init.collapsed;

    const header = document.createElement("div");
    header.className = "sidebar-header";
    const title = document.createElement("div");
    title.className = "sidebar-title";
    title.textContent = "cool-vnc";
    header.appendChild(title);

    const gridBtn = document.createElement("button");
    gridBtn.type = "button";
    gridBtn.className = "icon-btn";
    gridBtn.title = "Grid view";
    gridBtn.textContent = "▦";
    gridBtn.addEventListener("click", () => this.handlers.onGrid());
    header.appendChild(gridBtn);

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "icon-btn";
    collapseBtn.title = "Collapse sidebar";
    collapseBtn.textContent = "«";
    collapseBtn.addEventListener("click", () => this.setCollapsed(true));
    header.appendChild(collapseBtn);
    root.appendChild(header);

    const controls = document.createElement("div");
    controls.className = "sidebar-controls";

    this.searchInput = document.createElement("input");
    this.searchInput.type = "search";
    this.searchInput.className = "search-input";
    this.searchInput.placeholder = "Search...";
    this.searchInput.addEventListener("input", () => {
      this.query = this.searchInput.value;
      this.render();
    });
    controls.appendChild(this.searchInput);

    this.sortSelect = document.createElement("select");
    this.sortSelect.className = "sort-select";
    this.sortSelect.title = "Sort by";
    const opts: { value: SortMode; label: string }[] = [
      { value: "name", label: "Name" },
      { value: "recent", label: "Recent" },
      { value: "frequent", label: "Frequent" },
    ];
    for (const o of opts) {
      const el = document.createElement("option");
      el.value = o.value;
      el.textContent = o.label;
      this.sortSelect.appendChild(el);
    }
    this.sortSelect.value = this.sort;
    this.sortSelect.addEventListener("change", () => {
      this.sort = this.sortSelect.value as SortMode;
      this.handlers.onSortChange(this.sort);
      this.render();
    });
    controls.appendChild(this.sortSelect);

    root.appendChild(controls);

    this.list = document.createElement("div");
    this.list.className = "server-list";
    root.appendChild(this.list);

    const actions = document.createElement("div");
    actions.className = "server-actions";

    const addWrap = document.createElement("div");
    addWrap.className = "add-menu-wrap";
    const addBtn = document.createElement("button");
    addBtn.className = "btn";
    addBtn.type = "button";
    addBtn.textContent = "+ Add";
    const addPopover = document.createElement("div");
    addPopover.className = "add-menu-popover";
    const addServerItem = document.createElement("button");
    addServerItem.type = "button";
    addServerItem.className = "add-menu-item";
    addServerItem.textContent = "Server";
    addServerItem.addEventListener("click", () => {
      addPopover.classList.remove("open");
      this.handlers.onAdd();
    });
    const addGroupItem = document.createElement("button");
    addGroupItem.type = "button";
    addGroupItem.className = "add-menu-item";
    addGroupItem.textContent = "Group";
    addGroupItem.addEventListener("click", () => {
      addPopover.classList.remove("open");
      this.handlers.onAddGroup();
    });
    addPopover.appendChild(addServerItem);
    addPopover.appendChild(addGroupItem);
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      addPopover.classList.toggle("open");
    });
    document.addEventListener("click", (e) => {
      if (!addWrap.contains(e.target as Node)) addPopover.classList.remove("open");
    });
    addWrap.appendChild(addBtn);
    addWrap.appendChild(addPopover);

    const scanBtn = document.createElement("button");
    scanBtn.className = "btn";
    scanBtn.type = "button";
    scanBtn.textContent = "Scan";
    scanBtn.addEventListener("click", () => this.handlers.onScan());

    actions.appendChild(addWrap);
    actions.appendChild(scanBtn);
    root.appendChild(actions);

    this.collapsedHandle = document.createElement("button");
    this.collapsedHandle.type = "button";
    this.collapsedHandle.className = "collapsed-handle";
    this.collapsedHandle.title = "Expand sidebar";
    this.collapsedHandle.textContent = "»";
    this.collapsedHandle.addEventListener("click", () => this.setCollapsed(false));
    root.appendChild(this.collapsedHandle);

    sessions.onStatusChange((id, status) => {
      this.statuses.set(id, status);
      this.setStatus(id, status);
      if (status === "connected" && (this.sort === "recent" || this.sort === "frequent")) {
        this.render();
      }
    });

    this.applyCollapsed();
    this.render();
  }

  setServers(servers: SavedServer[]): void {
    this.servers = servers;
    if (this.activeId && !servers.some((s) => s.id === this.activeId)) {
      this.activeId = null;
    }
    this.render();
  }

  setGroups(groups: ServerGroup[]): void {
    this.groups = groups;
    this.render();
  }

  setActive(id: string | null): void {
    this.activeId = id;
    for (const [sid, el] of this.items) {
      el.classList.toggle("active", sid === id);
    }
  }

  setSort(sort: SortMode): void {
    this.sort = sort;
    this.sortSelect.value = sort;
    this.render();
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.applyCollapsed();
    this.handlers.onCollapseChange(collapsed);
  }

  private applyCollapsed(): void {
    this.root.classList.toggle("collapsed", this.collapsed);
  }

  private setStatus(id: string, status: SessionStatus): void {
    const item = this.items.get(id);
    if (!item) return;
    const btn = item.querySelector(".status-btn") as HTMLButtonElement | null;
    if (!btn) return;
    btn.classList.remove("connecting", "connected", "error");
    if (status !== "disconnected") btn.classList.add(status);
  }

  private filterAndSort(servers: SavedServer[]): SavedServer[] {
    const q = this.query.trim().toLowerCase();
    if (q) {
      return servers
        .map((s) => ({ s, score: fuzzyScore(q, s.name) || fuzzyScore(q, s.host) * 0.5 }))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((m) => m.s);
    }
    const list = [...servers];
    switch (this.sort) {
      case "name":
        return list.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        );
      case "recent":
        return list.sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0));
      case "frequent":
        return list.sort((a, b) => (b.connectCount ?? 0) - (a.connectCount ?? 0));
    }
  }

  private render(): void {
    this.list.innerHTML = "";
    this.items.clear();
    const searching = this.query.trim().length > 0;

    if (searching) {
      const flat = this.filterAndSort(this.servers);
      if (flat.length === 0) {
        const empty = document.createElement("div");
        empty.className = "list-empty";
        empty.textContent = "No matches";
        this.list.appendChild(empty);
        return;
      }
      for (const server of flat) {
        this.list.appendChild(this.renderServerItem(server));
      }
      return;
    }

    const ungrouped = this.servers.filter((s) => !s.groupId || !this.groups.some((g) => g.id === s.groupId));
    const ungroupedSorted = this.filterAndSort(ungrouped);

    if (this.servers.length === 0) {
      const empty = document.createElement("div");
      empty.className = "list-empty";
      empty.textContent = "No servers";
      this.list.appendChild(empty);
      return;
    }

    for (const group of this.groups) {
      this.list.appendChild(this.renderGroup(group));
    }

    // Ungrouped zone at the bottom, below all groups
    if (ungroupedSorted.length > 0 || this.groups.length > 0) {
      const ungroupedZone = this.renderUngroupedZone(ungroupedSorted);
      this.list.appendChild(ungroupedZone);
    }
  }

  private renderUngroupedZone(servers: SavedServer[]): HTMLElement {
    const zone = document.createElement("div");
    zone.className = "group-zone ungrouped-zone";
    if (servers.length === 0 && this.groups.length > 0) {
      const hint = document.createElement("div");
      hint.className = "ungrouped-hint";
      hint.textContent = "Drag here to ungroup";
      zone.appendChild(hint);
    }
    for (const server of servers) {
      zone.appendChild(this.renderServerItem(server));
    }
    this.attachDropTarget(zone, null);
    return zone;
  }

  private renderGroup(group: ServerGroup): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "group-zone";
    if (!group.expanded) wrapper.classList.add("collapsed");

    const header = document.createElement("div");
    header.className = "group-header";
    header.draggable = false;

    const chevron = document.createElement("span");
    chevron.className = "group-chevron";
    chevron.textContent = group.expanded ? "▾" : "▸";
    header.appendChild(chevron);

    const name = document.createElement("div");
    name.className = "group-name";
    name.textContent = group.name;
    header.appendChild(name);

    const count = document.createElement("span");
    count.className = "group-count";
    const inGroup = this.servers.filter((s) => s.groupId === group.id);
    count.textContent = String(inGroup.length);
    header.appendChild(count);

    const renameBtn = document.createElement("button");
    renameBtn.className = "group-action";
    renameBtn.type = "button";
    renameBtn.textContent = "✎";
    renameBtn.title = "Rename group";
    renameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handlers.onRenameGroup(group);
    });
    header.appendChild(renameBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "group-action";
    deleteBtn.type = "button";
    deleteBtn.textContent = "🗑";
    deleteBtn.title = "Delete group";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handlers.onDeleteGroup(group);
    });
    header.appendChild(deleteBtn);

    header.addEventListener("click", () => this.handlers.onToggleGroup(group));

    wrapper.appendChild(header);

    const body = document.createElement("div");
    body.className = "group-body";
    const sorted = this.filterAndSort(inGroup);
    for (const server of sorted) {
      body.appendChild(this.renderServerItem(server));
    }
    if (sorted.length === 0) {
      const hint = document.createElement("div");
      hint.className = "ungrouped-hint";
      hint.textContent = "Drag servers here";
      body.appendChild(hint);
    }
    wrapper.appendChild(body);

    this.attachDropTarget(wrapper, group.id);
    return wrapper;
  }

  private attachDropTarget(el: HTMLElement, groupId: string | null): void {
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", (e) => {
      if (e.target === el) el.classList.remove("drag-over");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const serverId = e.dataTransfer?.getData("text/plain");
      if (!serverId) return;
      this.handlers.onMoveServerToGroup(serverId, groupId);
    });
  }

  private renderServerItem(server: SavedServer): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "server-item";
    item.draggable = true;
    if (server.id === this.activeId) item.classList.add("active");

    item.addEventListener("dragstart", (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.setData("text/plain", server.id);
      e.dataTransfer.effectAllowed = "move";
      item.classList.add("dragging");
      document.body.classList.add("dragging-server");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      document.body.classList.remove("dragging-server");
    });

    const statusBtn = document.createElement("button");
    statusBtn.type = "button";
    statusBtn.className = "status-btn";
    const current = this.statuses.get(server.id);
    if (current && current !== "disconnected") statusBtn.classList.add(current);
    const closeX = document.createElement("span");
    closeX.className = "close-x";
    closeX.textContent = "×";
    statusBtn.appendChild(closeX);
    statusBtn.addEventListener("click", (e) => {
      if (statusBtn.classList.contains("connected") || statusBtn.classList.contains("connecting")) {
        e.stopPropagation();
        this.handlers.onClose(server);
      }
    });

    const name = document.createElement("div");
    name.className = "server-name";
    name.textContent = server.name;

    const editBtn = document.createElement("button");
    editBtn.className = "server-edit";
    editBtn.type = "button";
    editBtn.title = "Edit";
    editBtn.textContent = "⋯";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handlers.onEdit(server);
    });

    item.appendChild(statusBtn);
    item.appendChild(name);
    item.appendChild(editBtn);
    item.addEventListener("click", () => this.handlers.onSelect(server));
    item.addEventListener("dblclick", () => this.handlers.onActivate(server));

    this.items.set(server.id, item);
    return item;
  }
}

function fuzzyScore(query: string, target: string): number {
  const t = target.toLowerCase();
  if (t === query) return 100;
  if (t.startsWith(query)) return 50;
  if (t.includes(query)) return 25;
  let ti = 0;
  for (const ch of query) {
    const idx = t.indexOf(ch, ti);
    if (idx < 0) return 0;
    ti = idx + 1;
  }
  return 5;
}
