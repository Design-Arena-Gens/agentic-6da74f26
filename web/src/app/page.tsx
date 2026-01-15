import NewsDashboard from "@/components/dashboard/news-dashboard";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-100 p-6 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 md:p-10">
      <div className="mx-auto max-w-6xl">
        <NewsDashboard />
      </div>
    </main>
  );
}
