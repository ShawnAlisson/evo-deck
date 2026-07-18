import { ImageResponse } from "next/og";

export const alt =
  "EvoDeck — an AI-native collaborative canvas that turns conversation into an evolving workspace";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, #1c1914 0%, #27362b 100%)",
          color: "#f3efe6",
          padding: "66px 72px",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 650,
            height: 650,
            borderRadius: 650,
            background: "#f0e2c0",
            opacity: 0.16,
            right: -160,
            top: -250,
            display: "flex",
          }}
        />
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                display: "flex",
                width: 54,
                height: 54,
                borderRadius: 15,
                background: "#f3efe6",
                color: "#1c1914",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 30,
                fontWeight: 800,
              }}
            >
              E
            </div>
            <span style={{ fontFamily: "serif", fontSize: 44, fontWeight: 700 }}>
              EvoDeck
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <span style={{ fontFamily: "serif", fontSize: 76, lineHeight: 1.02 }}>
              Your workspace,
              <br />
              shaped by conversation.
            </span>
            <span style={{ fontSize: 27, color: "#d6d0c5" }}>
              AI-native collaborative canvas · interactive widgets · rewindable decisions
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 230,
                height: 16,
                borderRadius: 999,
                background: "#b65c38",
                display: "flex",
              }}
            />
            <div
              style={{
                width: 150,
                height: 16,
                borderRadius: 999,
                background: "#8fb49a",
                display: "flex",
              }}
            />
          </div>
        </div>
      </div>
    ),
    size,
  );
}
