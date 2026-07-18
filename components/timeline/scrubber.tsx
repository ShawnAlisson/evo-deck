"use client";

import { useEffect, useRef, useState } from "react";

export type TimelineRevision = {
  id: string;
  seq: number;
  cause: string;
  label: string | null;
  createdAt: string | Date;
};

export function TimelineScrubber({
  revisions,
  playhead,
  onPlayheadChange,
  live,
}: {
  revisions: TimelineRevision[];
  playhead: number;
  onPlayheadChange: (value: number) => void;
  live: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);

  const max = Math.max(0, revisions.length - 1);

  useEffect(() => {
    if (!playing || max <= 0) return;

    const tick = (now: number) => {
      if (!last.current) last.current = now;
      const dt = (now - last.current) / 1000;
      last.current = now;
      const next = playhead + dt * speed;
      if (next >= max) {
        onPlayheadChange(max);
        setPlaying(false);
        last.current = 0;
        return;
      }
      onPlayheadChange(next);
      raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      last.current = 0;
    };
  }, [playing, speed, max, playhead, onPlayheadChange]);

  return (
    <div className="echo-timeline is-inline">
      <button
        type="button"
        className="echo-timeline-play"
        onClick={() => setPlaying((p) => !p)}
        disabled={max <= 0}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="echo-timeline-track">
        <input
          className="echo-scrub"
          type="range"
          min={0}
          max={max || 0}
          step={0.01}
          value={Math.min(playhead, max)}
          disabled={max <= 0}
          onChange={(e) => {
            setPlaying(false);
            onPlayheadChange(Number(e.target.value));
          }}
        />
      </div>
      <select
        className="echo-timeline-speed"
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        aria-label="Playback speed"
      >
        <option value={0.5}>½×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={4}>4×</option>
      </select>
      <span
        className={live ? "echo-live-dot is-on" : "echo-live-dot"}
        title={live ? "Live" : "Scrubbing"}
        aria-label={live ? "Live" : "Scrubbing"}
      />
      <span className="echo-seq">
        {max === 0 ? "0/0" : `${Math.round(playhead)}/${max}`}
      </span>
    </div>
  );
}
