import React, { useState, useEffect, useMemo } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { BRAND_GREEN_BRIGHT, glassPanel } from "./theme.jsx";

// Splits a list into pages. The page snaps back to 1 when the list is searched or
// filtered (resetKey changes) and never points past the last page.
export function usePaging(items, pageSize, resetKey) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => {
    setPage(1);
  }, [resetKey]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [pageCount, page]);
  const pageItems = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);
  return { page, setPage, pageCount, pageItems };
}

// The same page buttons as the Clients tab: ‹ 1 2 ··· 6 ›. Shows nothing for a single page.
export function Pager({ page, pageCount, onPage, total, pageSize }) {
  if (pageCount <= 1) return null;
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1)
    .reduce((acc, p, i, arr) => {
      if (i > 0 && p - arr[i - 1] > 1) acc.push("…" + p);
      acc.push(p);
      return acc;
    }, []);
  const arrow = (disabled) => ({
    ...glassPanel(0.5, 8),
    width: 30,
    height: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
  });
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 16, flexWrap: "wrap" }}>
      <button type="button" aria-label="Previous page" onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1} style={arrow(page === 1)}>
        <ArrowLeft size={13} />
      </button>
      {pages.map((p) =>
        typeof p === "string" ? (
          <span key={p} style={{ color: "#8A8577", fontSize: 12, padding: "0 2px" }}>···</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            style={{
              ...(p === page
                ? { background: BRAND_GREEN_BRIGHT, border: `1px solid ${BRAND_GREEN_BRIGHT}`, boxShadow: "0 4px 14px rgba(47,168,102,0.35)" }
                : glassPanel(0.5, 8)),
              width: 30,
              height: 30,
              fontSize: 12,
              fontWeight: p === page ? 700 : 600,
              color: p === page ? "#FFFFFF" : "#1C2430",
              cursor: "pointer",
            }}
          >
            {p}
          </button>
        )
      )}
      <button type="button" aria-label="Next page" onClick={() => onPage(Math.min(pageCount, page + 1))} disabled={page === pageCount} style={arrow(page === pageCount)}>
        <ArrowRight size={13} />
      </button>
      <span style={{ fontSize: 11.5, color: "#8A8577", marginLeft: 8 }}>
        {from}–{to} of {total}
      </span>
    </div>
  );
}
