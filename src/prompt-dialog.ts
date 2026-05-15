interface InputDialogOptions {
  title: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
}

export function showInputDialog(opts: InputDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <form class="modal" style="width: 320px">
        <h2></h2>
        <input name="value" autocomplete="off" />
        <div class="modal-actions">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="submit" class="btn btn-primary"></button>
        </div>
      </form>
    `;

    const form = backdrop.querySelector("form") as HTMLFormElement;
    const h2 = form.querySelector("h2") as HTMLHeadingElement;
    const input = form.querySelector('input[name="value"]') as HTMLInputElement;
    const okBtn = form.querySelector("button[type=submit]") as HTMLButtonElement;
    const cancelBtn = form.querySelector("[data-cancel]") as HTMLButtonElement;

    h2.textContent = opts.title;
    okBtn.textContent = opts.okLabel ?? "OK";
    input.value = opts.defaultValue ?? "";
    input.placeholder = opts.placeholder ?? "";

    const close = (result: string | null) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(null);
    };
    document.addEventListener("keydown", onKey);

    cancelBtn.addEventListener("click", () => close(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(null);
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      close(v || null);
    });

    document.body.appendChild(backdrop);
    input.focus();
    input.select();
  });
}
