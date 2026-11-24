"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "./use-form-action";

/** Run a plain server action with toast feedback. */
export function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error, { duration: 8_000 });
      else {
        toast.success(res.message);
        for (const w of res.warnings ?? [])
          toast.warning(w, { duration: 10_000 });
        onOk?.();
      }
    });
  return [run, pending] as const;
}
