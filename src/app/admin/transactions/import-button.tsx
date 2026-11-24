"use client";

import { useRef } from "react";
import { buttonClass } from "@/components/vf/ui";
import { useFormAction } from "@/components/vf/use-form-action";
import { importTransactions } from "./actions";

export function ImportButton() {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, action, pending] = useFormAction(importTransactions, () =>
    formRef.current?.reset(),
  );

  return (
    <form ref={formRef} action={action}>
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={() => formRef.current?.requestSubmit()}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className={buttonClass("outline")}
        title="Cột: date, type, asset_class, symbol, account, quantity, price, fee, tax, note"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3v12" />
          <path d="M7 8l5-5 5 5" />
          <path d="M5 21h14" />
        </svg>
        {pending ? "Đang nhập…" : "Import CSV"}
      </button>
    </form>
  );
}
