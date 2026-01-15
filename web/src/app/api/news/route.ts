import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { aggregateSources } from "@/lib/aggregator";
import { SourceConfig, defaultSources } from "@/lib/sources";
import { fetchArticlesForSource } from "@/lib/scraper";
import { z } from "zod";

const createSlug = (input: string) =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 48) || randomUUID();

const customSourceSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  url: z.string().url("A valid RSS/Atom feed URL is required."),
  category: z.string().default("Custom"),
  description: z
    .string()
    .max(200, "Description should be short.")
    .optional()
    .nullable(),
  type: z.enum(["rss"]).default("rss"),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceFilter = searchParams.get("sources");
  const categoryFilter = searchParams.get("categories");
  const query = searchParams.get("q");

  let filteredSources: SourceConfig[] = defaultSources;

  if (sourceFilter) {
    const ids = new Set(
      sourceFilter
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    filteredSources = filteredSources.filter((source) => ids.has(source.id));
  }

  if (filteredSources.length === 0) {
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      articles: [],
      sources: [],
      errors: [],
      message: "No sources matched the requested filters.",
    });
  }

  const aggregated = await aggregateSources(filteredSources);

  const categoryMap = new Map(
    aggregated.sources.map((source) => [source.id, source.category.toLowerCase()]),
  );

  let articles = aggregated.articles;

  if (categoryFilter) {
    const categories = new Set(
      categoryFilter
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
    articles = articles.filter((article) => {
      const category = categoryMap.get(article.sourceId);
      if (!category) return true;
      return categories.has(category);
    });
  }

  if (query) {
    const normalized = query.toLowerCase();
    articles = articles.filter((article) => {
      const haystack = [
        article.title,
        article.summary ?? "",
        article.sourceName,
        article.author ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }

  return NextResponse.json({
    ...aggregated,
    articles,
  });
}

export async function POST(request: Request) {
  const payload = await request.json();
  const parsed = customSourceSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid feed configuration.",
        issues: parsed.error.format(),
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const source: SourceConfig = {
    id: `custom-${createSlug(parsed.data.name)}-${randomUUID()}`,
    name: parsed.data.name,
    url: parsed.data.url,
    description: parsed.data.description ?? "Custom feed.",
    category: parsed.data.category,
    type: parsed.data.type,
    homepage: parsed.data.url,
  };

  const articles = await fetchArticlesForSource(source);

  return NextResponse.json({
    source: {
      ...source,
      articleCount: articles.length,
      lastFetched: now,
    },
    articles,
  });
}
