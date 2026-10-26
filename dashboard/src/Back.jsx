import React from "react";
import { ArrowLeft } from "lucide-react";

// A small back arrow for the top-left of a pop-up or detail screen, so you can step back
// without going up to the tabs.
export default function BackButton({ onClick, label = "Back" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        width: 30,
        height: 30,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid #C9C4B6",
        background: "#fff",
        color: "#1C2430",
        cursor: "pointer",
        transition: "background .12s, border-color .12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "#F2EFE4";
        e.currentTarget.style.borderColor = "#8A8577";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "#fff";
        e.currentTarget.style.borderColor = "#C9C4B6";
      }}
    >
      <ArrowLeft size={15} />
    </button>
  );
}
