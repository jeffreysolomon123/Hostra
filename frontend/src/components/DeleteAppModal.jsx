import { useState } from "react";
import { Button, Input, Modal } from "./ui";

/** Type-the-name confirmation, like GitHub/Vercel. */
export function DeleteAppModal({ name, open, onClose, onConfirm }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm(e) {
    e.preventDefault();
    if (typed !== name) return;
    setBusy(true);
    await onConfirm();
    setBusy(false);
    setTyped("");
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Delete ${name}`}
      description="This removes the container, the image, all deployments, logs, metrics and environment variables. This cannot be undone."
    >
      <form onSubmit={confirm} className="space-y-4">
        <label className="block text-sm text-muted" htmlFor="confirm-name">
          Type <span className="font-mono text-fg">{name}</span> to confirm
        </label>
        <Input
          id="confirm-name"
          data-autofocus
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="font-mono"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={typed !== name} loading={busy}>
            Delete project
          </Button>
        </div>
      </form>
    </Modal>
  );
}
