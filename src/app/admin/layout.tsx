import { signOut } from "@/auth";
import { QuickEntryProvider } from "@/components/vf/quick-entry";
import { Sidebar } from "@/components/vf/sidebar";
import { buttonClass } from "@/components/vf/ui";
import { loadQuickEntry } from "@/server/cashbook";
import { requireUser } from "@/server/session";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireUser();
  const quickEntry = await loadQuickEntry(user.id);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  const footer = (
    <form
      action={logout}
      className="flex flex-col gap-2 border-t border-line-soft px-3 pt-4"
    >
      <span className="truncate text-xs text-subtle" title={user.email}>
        {user.email}
      </span>
      <button type="submit" className={buttonClass("outline", "w-full")}>
        Đăng xuất
      </button>
    </form>
  );

  return (
    <div className="flex min-h-screen flex-col bg-canvas md:flex-row">
      <Sidebar footer={footer} />
      <main className="flex min-w-0 flex-1 flex-col gap-6 px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-8">
        <QuickEntryProvider data={quickEntry}>{children}</QuickEntryProvider>
      </main>
    </div>
  );
}
