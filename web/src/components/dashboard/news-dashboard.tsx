"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  formatDistanceToNow,
  parseISO,
  isValid,
  format,
  differenceInMinutes,
} from "date-fns";
import { defaultSources } from "@/lib/sources";

export type DashboardArticle = {
  id: string;
  title: string;
  link: string;
  summary: string | null;
  publishedAt: string | null;
  sourceId: string;
  sourceName: string;
  author: string | null;
  score?: number | null;
  image?: string | null;
};

export type DashboardSource = {
  id: string;
  name: string;
  url: string;
  homepage?: string;
  description: string;
  category: string;
  articleCount?: number;
  lastFetched?: string;
  isCustom?: boolean;
};

type ApiResponse = {
  generatedAt: string;
  articles: DashboardArticle[];
  sources: (DashboardSource & {
    articleCount: number;
    lastFetched: string;
    error?: string;
  })[];
  errors: {
    sourceId: string;
    articleCount: number;
    lastFetched: string;
    error?: string;
  }[];
};

type CustomSourcePayload = {
  name: string;
  url: string;
  category: string;
  description?: string;
  type: "rss";
};

type AvailableSource = {
  id: string;
  name: string;
  description: string;
  category: string;
  url: string;
  lastFetched?: string;
  articleCount: number;
  isCustom?: boolean;
};

const LOCAL_STORAGE_KEY = "agentic-news-dashboard-custom-sources";

const loadCustomSources = (): DashboardSource[] => {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as DashboardSource[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const persistCustomSources = (sources: DashboardSource[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sources));
};

const formatTimestamp = (iso?: string | null) => {
  if (!iso) return "Unknown";
  try {
    const parsed = parseISO(iso);
    if (!isValid(parsed)) return "Unknown";
    const diffMinutes = differenceInMinutes(new Date(), parsed);
    if (diffMinutes < 60 * 24) {
      return `${formatDistanceToNow(parsed, { addSuffix: true })}`;
    }
    return format(parsed, "MMM d, yyyy HH:mm");
  } catch {
    return "Unknown";
  }
};

const groupBySource = (articles: DashboardArticle[]) => {
  return articles.reduce<Record<string, DashboardArticle[]>>((acc, article) => {
    if (!acc[article.sourceId]) acc[article.sourceId] = [];
    acc[article.sourceId].push(article);
    return acc;
  }, {});
};

const SORT_OPTIONS = [
  { label: "Newest first", value: "newest" },
  { label: "Oldest first", value: "oldest" },
  { label: "Highest score", value: "score" },
  { label: "Alphabetical", value: "alpha" },
];

export const NewsDashboard = () => {
  const [articles, setArticles] = useState<DashboardArticle[]>([]);
  const [baseSources, setBaseSources] = useState<ApiResponse["sources"]>([]);
  const [customSources, setCustomSources] = useState<DashboardSource[]>([]);
  const [customArticles, setCustomArticles] = useState<
    Record<string, DashboardArticle[]>
  >({});
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    () => new Set(defaultSources.map((source) => source.id)),
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOrder, setSortOrder] = useState<(typeof SORT_OPTIONS)[number]["value"]>("newest");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  // Load stored custom sources on boot.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = loadCustomSources();
    setCustomSources(saved);
    saved.forEach((source) => {
      setSelectedSources((prev) => new Set(prev).add(source.id));
    });
  }, []);

  const fetchBaseArticles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("sources", defaultSources.map((source) => source.id).join(","));
      const response = await fetch(`/api/news?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Failed to load news (${response.status})`);
      }
      const payload = (await response.json()) as ApiResponse;
      setArticles(payload.articles);
      setBaseSources(payload.sources);
      setGeneratedAt(payload.generatedAt);
      if (payload.errors.length > 0) {
        setError(
          "Some sources failed to load. Check the alerts section for details.",
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unexpected error while scraping news.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBaseArticles();
  }, [fetchBaseArticles]);

  const handleRefresh = async () => {
    await fetchBaseArticles();
    await Promise.all(
      customSources.map(async (source) => {
        await fetchCustomSource(source);
      }),
    );
  };

  const fetchCustomSource = useCallback(
    async (source: DashboardSource) => {
      try {
        const response = await fetch("/api/news", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: source.name,
            url: source.url,
            category: source.category,
            description: source.description,
            type: "rss",
          } satisfies CustomSourcePayload),
        });

        if (!response.ok) {
          throw new Error(`Failed to load ${source.name}`);
        }

        const payload = (await response.json()) as {
          source: DashboardSource & { articleCount: number; lastFetched: string };
          articles: DashboardArticle[];
        };

        setCustomArticles((prev) => ({
          ...prev,
          [source.id]: payload.articles.map((article) => ({
            ...article,
            sourceId: source.id,
            sourceName: source.name,
          })),
        }));
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : `Failed to load custom source ${source.name}`,
        );
      }
    },
    [],
  );

  useEffect(() => {
    if (customSources.length === 0) return;
    customSources.forEach((source) => {
      fetchCustomSource(source);
    });
  }, [customSources, fetchCustomSource]);

  const combinedArticles = useMemo(() => {
    let all = [...articles];
    Object.values(customArticles).forEach((entries) => {
      all = all.concat(entries);
    });

    let filtered = all.filter((article) =>
      selectedSources.size === 0 ? true : selectedSources.has(article.sourceId),
    );

    if (searchTerm.trim().length > 0) {
      const needle = searchTerm.toLowerCase();
      filtered = filtered.filter((article) => {
        const haystack = [
          article.title,
          article.summary ?? "",
          article.sourceName,
          article.author ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      });
    }

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortOrder) {
        case "newest": {
          const aTime = a.publishedAt ? parseISO(a.publishedAt).getTime() : 0;
          const bTime = b.publishedAt ? parseISO(b.publishedAt).getTime() : 0;
          return bTime - aTime;
        }
        case "oldest": {
          const aTime = a.publishedAt ? parseISO(a.publishedAt).getTime() : 0;
          const bTime = b.publishedAt ? parseISO(b.publishedAt).getTime() : 0;
          return aTime - bTime;
        }
        case "score": {
          return (b.score ?? 0) - (a.score ?? 0);
        }
        case "alpha":
        default:
          return a.title.localeCompare(b.title);
      }
    });
    return sorted;
  }, [articles, customArticles, selectedSources, searchTerm, sortOrder]);

  const groupedArticles = useMemo(
    () => groupBySource(combinedArticles),
    [combinedArticles],
  );

  const availableSources = useMemo<AvailableSource[]>(() => {
    const defaults: AvailableSource[] = baseSources.map((source) => ({
      id: source.id,
      name: source.name,
      description: source.description,
      category: source.category,
      url: source.homepage ?? source.url,
      lastFetched: source.lastFetched,
      articleCount: source.articleCount,
      isCustom: false,
    }));

    const customs: AvailableSource[] = customSources.map((source) => ({
      id: source.id,
      name: source.name,
      description: source.description,
      category: source.category,
      url: source.homepage ?? source.url,
      lastFetched: undefined,
      articleCount: customArticles[source.id]?.length ?? 0,
      isCustom: true,
    }));

    return [...defaults, ...customs];
  }, [baseSources, customSources, customArticles]);

  const handleSourceToggle = (id: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAddCustomSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);

    const name = String(formData.get("name") ?? "").trim();
    const url = String(formData.get("url") ?? "").trim();
    const category = String(formData.get("category") ?? "Custom").trim();
    const description = String(formData.get("description") ?? "").trim();

    if (!name || !url) {
      setError("Name and URL are required for a custom feed.");
      return;
    }

    try {
      const response = await fetch("/api/news", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name,
          url,
          category: category || "Custom",
          description: description || "Custom RSS source",
          type: "rss",
        } satisfies CustomSourcePayload),
      });

      if (!response.ok) {
        throw new Error(`Unable to add ${name}. The feed might be invalid.`);
      }

      const payload = (await response.json()) as {
        source: DashboardSource & { articleCount: number; lastFetched: string };
        articles: DashboardArticle[];
      };

      const normalizedSource: DashboardSource = {
        id: payload.source.id,
        name: payload.source.name,
        url: payload.source.url,
        homepage: payload.source.homepage ?? payload.source.url,
        description: description || payload.source.description,
        category: payload.source.category ?? "Custom",
        isCustom: true,
      };

      setCustomSources((prev) => {
        const updated = [...prev, normalizedSource];
        persistCustomSources(updated);
        return updated;
      });

      setCustomArticles((prev) => ({
        ...prev,
        [normalizedSource.id]: payload.articles.map((article) => ({
          ...article,
          sourceId: normalizedSource.id,
          sourceName: normalizedSource.name,
        })),
      }));

      setSelectedSources((prev) => new Set(prev).add(normalizedSource.id));
      event.currentTarget.reset();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to add the custom feed.",
      );
    }
  };

  const handleRemoveCustomSource = (id: string) => {
    const updated = customSources.filter((source) => source.id !== id);
    setCustomSources(updated);
    persistCustomSources(updated);
    setCustomArticles((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSelectedSources((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const totalArticles = combinedArticles.length;
  const activeSourcesCount = selectedSources.size || availableSources.length;

  return (
    <div className="w-full space-y-8">
      <header className="flex flex-col gap-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              Real-time News Dashboard
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Monitor and search the latest headlines from curated sources, or add your own feeds.
            </p>
          </div>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
          >
            Refresh sources
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Articles
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {isLoading ? "Loading…" : totalArticles}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Active sources
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {activeSourcesCount}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Last sync
            </p>
            <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {generatedAt ? formatTimestamp(generatedAt) : "Pending"}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Filters active
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {searchTerm ? "Search" : selectedSources.size
                ? selectedSources.size
                : "All"}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex w-full items-center rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <span className="px-3 text-sm text-zinc-500">Search</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Find topics, authors, or sources…"
              className="w-full rounded-r-lg bg-transparent px-3 py-2 text-sm text-zinc-900 focus:outline-none dark:text-zinc-50"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="sort" className="text-zinc-600 dark:text-zinc-400">
              Sort by
            </label>
            <select
              id="sort"
              value={sortOrder}
              onChange={(event) =>
                setSortOrder(event.target.value as typeof SORT_OPTIONS[number]["value"])
              }
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          {error}
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {isLoading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ) : combinedArticles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 p-10 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              No articles match your filters yet. Try adjusting the search or add a custom feed.
            </div>
          ) : (
            <div className="space-y-4">
              {combinedArticles.map((article) => (
                <article
                  key={article.id}
                  className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-blue-200 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-blue-500/30"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                    <span className="font-medium text-blue-600 dark:text-blue-400">
                      {article.sourceName}
                    </span>
                    <span>{formatTimestamp(article.publishedAt)}</span>
                  </div>
                  <h2 className="mt-3 text-xl font-semibold text-zinc-900 group-hover:text-blue-600 dark:text-zinc-50 dark:group-hover:text-blue-400">
                    <a href={article.link} target="_blank" rel="noreferrer">
                      {article.title}
                    </a>
                  </h2>
                  {article.summary && (
                    <p className="mt-3 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                      {article.summary}
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-500">
                    {article.author && (
                      <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-900/60">
                        {article.author}
                      </span>
                    )}
                    {article.score ? (
                      <span className="rounded-full bg-orange-100 px-3 py-1 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300">
                        Score {article.score}
                      </span>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        <aside className="space-y-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Source filters
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Toggle visibility of individual feeds.
            </p>
            <div className="mt-4 space-y-3 text-sm">
              {availableSources.map((source) => (
                <label
                  key={source.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 p-3 transition hover:border-blue-200 dark:border-zinc-800 dark:hover:border-blue-500/30"
                >
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      <input
                        type="checkbox"
                        checked={selectedSources.has(source.id)}
                        onChange={() => handleSourceToggle(source.id)}
                        className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700"
                      />
                      <span>{source.name}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {source.description}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                      <span>{source.category}</span>
                      {source.articleCount !== undefined && (
                        <span>{source.articleCount} stories</span>
                      )}
                    </div>
                  </div>
                  {source.isCustom && (
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomSource(source.id)}
                      className="text-xs font-medium text-red-500 hover:text-red-400"
                    >
                      Remove
                    </button>
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Add custom RSS feed
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Provide any publicly accessible RSS or Atom feed URL.
            </p>
            <form onSubmit={handleAddCustomSource} className="mt-4 space-y-3 text-sm">
              <div className="space-y-1">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  Name
                </label>
                <input
                  name="name"
                  required
                  placeholder="Feed name"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  RSS/Atom URL
                </label>
                <input
                  name="url"
                  required
                  type="url"
                  placeholder="https://example.com/feed.xml"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  Category
                </label>
                <input
                  name="category"
                  placeholder="Custom"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  Description
                </label>
                <textarea
                  name="description"
                  rows={2}
                  placeholder="Optional short description"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-offset-zinc-950"
              >
                Add feed
              </button>
            </form>
          </div>
        </aside>
      </section>

      {Object.keys(groupedArticles).length > 0 && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Source breakdown
            </h3>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Updated {generatedAt ? formatTimestamp(generatedAt) : "recently"}
            </span>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            {Object.entries(groupedArticles).map(([sourceId, items]) => {
              const source =
                availableSources.find((entry) => entry.id === sourceId) ?? null;
              return (
                <div
                  key={sourceId}
                  className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {source?.name ?? sourceId}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {source?.description ?? "Custom source"}
                      </p>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                      {items.length} stories
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {items.slice(0, 6).map((item) => (
                      <a
                        key={item.id}
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        {item.title}
                      </a>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};

export default NewsDashboard;
