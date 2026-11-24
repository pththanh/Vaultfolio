"use client";

import { useActionState } from "react";
import { toast } from "sonner";

export interface ActionResult {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Shown after a successful save (e.g. a budget running out). */
  warnings?: string[];
}

/** useActionState + toast feedback; `onSuccess` runs inside the action transition. */
export function useFormAction<S extends ActionResult>(
  fn: (prev: S, formData: FormData) => Promise<S>,
  onSuccess?: (result: S) => void,
) {
  return useActionState<S, FormData>(async (prev, formData): Promise<S> => {
    const result = await fn(prev, formData);
    if (result.error) toast.error(result.error, { duration: 8_000 });
    else if (result.ok) {
      if (result.message) toast.success(result.message);
      for (const w of result.warnings ?? [])
        toast.warning(w, { duration: 10_000 });
      onSuccess?.(result);
    }
    return result;
  }, {} as Awaited<S>);
}
