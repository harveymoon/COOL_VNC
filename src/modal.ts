import type { SavedServer } from "./storage.js";

export type ServerModalResult =
  | { action: "save"; server: SavedServer }
  | { action: "delete"; id: string }
  | { action: "cancel" };

export function showServerModal(existing?: SavedServer): Promise<ServerModalResult> {
  return new Promise((resolve) => {
    const isEdit = !!existing;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <form class="modal">
        <h2></h2>
        <label>Name<input name="name" required placeholder="prod-01" autocomplete="off" /></label>
        <label>Host<input name="host" required placeholder="192.168.1.10" autocomplete="off" /></label>
        <label>VNC port<input name="port" type="number" required value="5900" /></label>
        <label>Password (optional)<input name="password" type="password" autocomplete="off" /></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-danger" data-delete>Delete</button>
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    `;

    const form = backdrop.querySelector("form") as HTMLFormElement;
    const h2 = form.querySelector("h2") as HTMLHeadingElement;
    const deleteBtn = form.querySelector("[data-delete]") as HTMLButtonElement;
    const nameInput = form.elements.namedItem("name") as HTMLInputElement;

    h2.textContent = isEdit ? "Edit server" : "Add server";

    if (isEdit && existing) {
      nameInput.value = existing.name;
      (form.elements.namedItem("host") as HTMLInputElement).value = existing.host;
      (form.elements.namedItem("port") as HTMLInputElement).value = String(existing.port);
      (form.elements.namedItem("password") as HTMLInputElement).value = existing.password ?? "";
    } else {
      deleteBtn.style.display = "none";
    }

    const close = (result: ServerModalResult) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close({ action: "cancel" });
    };
    document.addEventListener("keydown", onKey);

    (form.querySelector("[data-cancel]") as HTMLButtonElement).addEventListener("click", () =>
      close({ action: "cancel" }),
    );

    deleteBtn.addEventListener("click", () => {
      if (existing && confirm(`Delete "${existing.name}"?`)) {
        close({ action: "delete", id: existing.id });
      }
    });

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close({ action: "cancel" });
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const password = String(data.get("password") ?? "");
      close({
        action: "save",
        server: {
          id: existing?.id ?? crypto.randomUUID(),
          name: String(data.get("name")),
          host: String(data.get("host")),
          port: Number(data.get("port")),
          password: password || undefined,
        },
      });
    });

    document.body.appendChild(backdrop);
    nameInput.focus();
    nameInput.select();
  });
}
